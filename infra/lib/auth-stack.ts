import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Cognito user pool.
 *
 * The React prototype had no authentication at all — it hardcoded
 * `{ name: 'Sarah Chen, RN', isAdmin: true }`. Groups here map onto the three
 * access tiers the prototype already modelled in its Team Access screen, so
 * the authorisation model is the one the product already described; it is now
 * merely enforced.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly appClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `sineobex-${props.stage}`,
      selfSignUpEnabled: false, // Clinicians are provisioned by an admin.
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
        agency: new cognito.StringAttribute({ mutable: true }),
        team: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      // MFA is required, not optional. A single stolen password should not
      // open a caseload.
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Compromised-credential and adaptive-authentication checks.
      standardThreatProtectionMode:
        cognito.StandardThreatProtectionMode.FULL_FUNCTION,
      featurePlan: cognito.FeaturePlan.PLUS,
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // The three tiers the Team Access screen already displays.
    for (const [name, description, precedence] of [
      ['full-admin', 'Manage team access and all patient records', 1],
      ['standard', 'Create and edit patient records', 2],
      ['view-only', 'Read patient records without editing', 3],
    ] as const) {
      new cognito.CfnUserPoolGroup(this, `Group-${name}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: name,
        description,
        precedence,
      });
    }

    this.appClient = this.userPool.addClient('MobileClient', {
      userPoolClientName: 'sineobex-mobile',
      authFlows: { userSrp: true, custom: false, userPassword: false },
      generateSecret: false, // A public mobile client cannot keep a secret.
      preventUserExistenceErrors: true,
      // A field shift is long; a stolen refresh token should not be.
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      enableTokenRevocation: true,
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, fullname: true })
        .withCustomAttributes('role', 'agency', 'team'),
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Pass to the app as SINEOBEX_COGNITO_POOL_ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.appClient.userPoolClientId,
      description: 'Pass to the app as SINEOBEX_COGNITO_CLIENT_ID',
    });
  }
}
