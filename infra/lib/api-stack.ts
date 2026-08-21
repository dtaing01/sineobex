import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  database: rds.DatabaseCluster;
  databaseSecret: secretsmanager.ISecret;
  attachmentsBucket: s3.Bucket;
  userPool: cognito.UserPool;
  encryptionKey: kms.Key;
}

/**
 * HTTP API in front of VPC-attached Lambdas.
 *
 * Two authorisation regimes:
 *  - `/v1/*` requires a Cognito JWT. Everything touching PHI lives here.
 *  - `/cron/*` is unauthenticated at the gateway and verifies an HMAC
 *    signature inside the handler, because cron-job.org cannot hold a Cognito
 *    session. Those endpoints trigger recomputation only; they never accept
 *    or return PHI.
 */
export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly cronSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // The cron signing key gets its own CMK rather than reusing the PHI key.
    //
    // Two reasons. It is not PHI — it is an HMAC key for scheduled triggers —
    // so it does not belong under the same key policy or rotation schedule.
    // And encrypting an ApiStack secret with a DataStack key would make
    // DataStack's key policy reference this stack's roles, which is the
    // dependency cycle described below.
    const cronKey = new kms.Key(this, 'CronKey', {
      description: 'Sineobex cron signing secret',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      alias: `alias/sineobex-${props.stage}-cron`,
    });

    // The shared secret cron-job.org signs its requests with.
    this.cronSecret = new secretsmanager.Secret(this, 'CronSigningSecret', {
      description:
        'HMAC-SHA256 key shared with cron-job.org. Never transmitted; only ' +
        'used to sign and verify timestamps.',
      encryptionKey: cronKey,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    const commonEnvironment = {
      NODE_OPTIONS: '--enable-source-maps',
      DB_SECRET_ARN: props.databaseSecret.secretArn,
      DB_HOST: props.database.clusterEndpoint.hostname,
      DB_NAME: 'sineobex',
      DB_PORT: String(props.database.clusterEndpoint.port),
      ATTACHMENTS_BUCKET: props.attachmentsBucket.bucketName,
      CRON_SECRET_ARN: this.cronSecret.secretArn,
      STAGE: props.stage,
      // Never log request or response bodies: they carry PHI.
      LOG_BODIES: 'false',
    };

    const makeFunction = (
      name: string,
      entry: string,
      options: Partial<nodejs.NodejsFunctionProps> = {},
    ) =>
      new nodejs.NodejsFunction(this, name, {
        entry: path.join(__dirname, '..', 'lambda', entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: cdk.Duration.seconds(30),
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [props.lambdaSecurityGroup],
        environment: commonEnvironment,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_YEAR,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        }),
        bundling: { minify: true, sourceMap: true, externalModules: [] },
        ...options,
      });

    const apiFn = makeFunction('ApiFunction', 'api/index.ts');
    const cronFn = makeFunction('CronFunction', 'cron/index.ts', {
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
    });

    // Permissions are attached to the functions' own roles as explicit
    // statements rather than through `grant*`.
    //
    // A cross-stack `grant*` writes into the *resource's* policy — the KMS key
    // policy and the S3 bucket policy, both owned by DataStack — referencing
    // this stack's role ARNs. Since this stack already reads the bucket name
    // and key ARN from DataStack, that closes a dependency loop CloudFormation
    // refuses to deploy. Principal-side statements point one way only, and
    // they document plainly what each function may touch.
    for (const fn of [apiFn, cronFn]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [props.databaseSecret.secretArn],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'kms:Decrypt',
            'kms:Encrypt',
            'kms:ReEncrypt*',
            'kms:GenerateDataKey*',
            'kms:DescribeKey',
          ],
          resources: [props.encryptionKey.keyArn],
        }),
      );
    }

    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
        ],
        resources: [props.attachmentsBucket.arnForObjects('*')],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [props.attachmentsBucket.bucketArn],
      }),
    );

    // The cron secret is owned by this stack, so a normal grant is fine.
    this.cronSecret.grantRead(cronFn);

    // Database ingress is granted once in DataStack (lambdaSecurityGroup →
    // the cluster's security group on 5432).

    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `sineobex-${props.stage}`,
      description: 'Sineobex street medicine API',
      corsPreflight: {
        // The web build is a secondary target; lock it to known origins
        // rather than allowing any.
        allowOrigins: [
          props.stage === 'prod'
            ? 'https://app.sineobex.org'
            : 'http://localhost:8080',
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['authorization', 'content-type'],
        allowCredentials: false,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Access logs deliberately omit the query string and body — a patient id
    // in an access log is a disclosure, and logs are retained for years.
    const defaultStage = this.httpApi.defaultStage!.node
      .defaultChild as apigwv2.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        httpMethod: '$context.httpMethod',
        routeKey: '$context.routeKey',
        status: '$context.status',
        protocol: '$context.protocol',
        responseLength: '$context.responseLength',
        userSub: '$context.authorizer.claims.sub',
      }),
    };
    defaultStage.defaultRouteSettings = {
      throttlingBurstLimit: 200,
      throttlingRateLimit: 100,
    };

    const jwtAuthorizer = new authorizers.HttpUserPoolAuthorizer(
      'CognitoAuthorizer',
      props.userPool,
    );

    const apiIntegration = new integrations.HttpLambdaIntegration(
      'ApiIntegration',
      apiFn,
    );
    const cronIntegration = new integrations.HttpLambdaIntegration(
      'CronIntegration',
      cronFn,
    );

    // Authenticated routes. Patient identifiers travel in request bodies,
    // never in paths, so they stay out of access logs and browser history.
    for (const [methods, routePath] of [
      [[apigwv2.HttpMethod.GET], '/v1/reference'],
      [[apigwv2.HttpMethod.GET], '/v1/insights'],
      [[apigwv2.HttpMethod.GET], '/v1/patients'],
      [[apigwv2.HttpMethod.POST], '/v1/patients/lookup'],
      [[apigwv2.HttpMethod.POST], '/v1/sync/mutations'],
      [[apigwv2.HttpMethod.POST], '/v1/audit'],
      [[apigwv2.HttpMethod.POST], '/v1/attachments/presign'],
    ] as const) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [...methods],
        integration: apiIntegration,
        authorizer: jwtAuthorizer,
      });
    }

    // Scheduled refresh, HMAC-verified inside the handler.
    this.httpApi.addRoutes({
      path: '/cron/{job}',
      methods: [apigwv2.HttpMethod.POST],
      integration: cronIntegration,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'Pass to the app as SINEOBEX_API_URL (append /v1)',
    });
    new cdk.CfnOutput(this, 'CronSecretArn', {
      value: this.cronSecret.secretArn,
      description:
        'Read this value and configure it as the signing key in cron-job.org',
    });
  }
}
