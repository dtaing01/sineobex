import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  stage: string;
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
}

/**
 * Aurora PostgreSQL with PostGIS, plus the buckets that hold attachments and
 * archived audit logs.
 *
 * PostGIS rather than a key-value store because this application is
 * fundamentally geospatial: patient pins, movement clustering, hotspot radii,
 * nearest-facility lookups, and route ordering are all natural PostGIS
 * queries and awkward everywhere else.
 */
export class DataStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly credentials: secretsmanager.ISecret;
  /**
   * Credentials for the least-privilege application role. This is what the
   * API connects with — never the master credential.
   */
  public readonly apiCredentials: secretsmanager.Secret;
  public readonly attachments: s3.Bucket;
  public readonly auditArchive: s3.Bucket;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';

    this.securityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc: props.vpc,
      description: 'Aurora PostgreSQL',
      allowAllOutbound: false,
    });

    // The only thing that may speak to Postgres is the API's Lambdas. The
    // credential-rotation function adds its own rule to this group, which is
    // why the group is declared alongside the cluster rather than in
    // NetworkStack.
    this.securityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'API Lambdas to Aurora',
    );

    // A customer-managed key, not the AWS-managed default: CMKs give an
    // auditable key policy and a rotation schedule you control.
    this.encryptionKey = new kms.Key(this, 'PhiKey', {
      description: 'Sineobex PHI encryption key',
      enableKeyRotation: true,
      rotationPeriod: cdk.Duration.days(365),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      alias: `alias/sineobex-${props.stage}-phi`,
    });

    this.credentials = new secretsmanager.Secret(this, 'DbCredentials', {
      description: 'Sineobex Aurora master credentials',
      encryptionKey: this.encryptionKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'sineobex_admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        passwordLength: 32,
      },
    });

    // The application role's password.
    //
    // The API must NOT connect as the master user: master is a superuser, and
    // a superuser bypasses row-level security entirely, which would make
    // every policy in 002_row_level_security.sql decorative. This secret is
    // consumed by that migration (to set the role's password) and by the
    // Lambdas (to connect as it).
    this.apiCredentials = new secretsmanager.Secret(this, 'ApiDbCredentials', {
      description:
        'Sineobex application database role (sineobex_api) — least ' +
        'privilege, subject to row-level security',
      encryptionKey: this.encryptionKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'sineobex_api' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        passwordLength: 32,
      },
    });

    this.cluster = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(this.credentials),
      defaultDatabaseName: 'sineobex',
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],

      // Serverless v2 so an outreach team of twelve doesn't pay for a
      // provisioned instance overnight, but can absorb a morning shift.
      serverlessV2MinCapacity: isProd ? 1 : 0.5,
      serverlessV2MaxCapacity: isProd ? 16 : 4,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        enablePerformanceInsights: true,
        performanceInsightEncryptionKey: this.encryptionKey,
      }),
      readers: isProd
        ? [
            rds.ClusterInstance.serverlessV2('reader', {
              scaleWithWriter: true,
            }),
          ]
        : [],

      storageEncrypted: true,
      storageEncryptionKey: this.encryptionKey,

      // Encryption in transit is mandatory, not negotiable — a parameter
      // group with rds.force_ssl=1 rejects any unencrypted connection.
      parameterGroup: new rds.ParameterGroup(this, 'ClusterParams', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        parameters: {
          'rds.force_ssl': '1',
          log_statement: 'ddl',
          log_min_duration_statement: '1000',
        },
      }),

      backup: {
        retention: cdk.Duration.days(isProd ? 35 : 7),
        preferredWindow: '07:00-08:00',
      },
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_YEAR,
      monitoringInterval: cdk.Duration.seconds(60),
      deletionProtection: isProd,
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.SNAPSHOT,
    });

    // Rotate the master credential on a schedule rather than never.
    this.cluster.addRotationSingleUser({
      automaticallyAfter: cdk.Duration.days(30),
      excludeCharacters: '"@/\\\'',
    });

    const accessLogs = new s3.Bucket(this, 'AccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(400) }],
    });

    // Wound photographs and consent forms.
    this.attachments = new s3.Bucket(this, 'Attachments', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: 'attachments/',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Keep old versions recoverable for a year, then let them go.
          noncurrentVersionExpiration: cdk.Duration.days(365),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // Audit log archive. Object Lock in compliance mode means nobody — not an
    // administrator, not the root account — can shorten the retention or
    // delete a record inside it. That is the point of an audit trail.
    this.auditArchive = new s3.Bucket(this, 'AuditArchive', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.compliance(
        // HIPAA §164.316(b)(2)(i): retain documentation for six years.
        cdk.Duration.days(2192),
      ),
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: 'audit/',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
    });
    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.credentials.secretArn,
      description:
        'Master credential. Use for migrations only — never for the API.',
    });
    new cdk.CfnOutput(this, 'ApiDbSecretArn', {
      value: this.apiCredentials.secretArn,
      description:
        'Application role credential. Pass its password to migration 002 as '
        + '-v api_password=..., and it is what the API Lambdas connect with.',
    });
  }
}
