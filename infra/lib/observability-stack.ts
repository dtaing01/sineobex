import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  stage: string;
  api: apigwv2.HttpApi;
  cluster: rds.DatabaseCluster;
  auditBucket: s3.Bucket;
}

/**
 * CloudTrail, alarms, and the operational dashboard.
 *
 * The audit story has two independent layers, and they answer different
 * questions. CloudTrail records what was done to the *infrastructure* — who
 * changed a security group, who read a secret. The application's own
 * `audit_log` table records what was done to *patient data* — who opened
 * which chart. HIPAA §164.312(b) needs both; neither substitutes for the
 * other.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: `Sineobex ${props.stage} alarms`,
    });

    const trail = new cloudtrail.Trail(this, 'Trail', {
      bucket: props.auditBucket,
      s3KeyPrefix: 'cloudtrail/',
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: logs.RetentionDays.ONE_YEAR,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      enableFileValidation: true,
    });

    // Reading an object out of the attachments bucket is reading a wound
    // photograph. Record every one.
    trail.addS3EventSelector(
      [{ bucket: props.auditBucket }],
      { readWriteType: cloudtrail.ReadWriteType.ALL },
    );

    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
      comparison = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    ) => {
      const a = new cloudwatch.Alarm(this, id, {
        metric,
        threshold,
        evaluationPeriods: 2,
        alarmDescription: description,
        comparisonOperator: comparison,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(new actions.SnsAction(alarmTopic));
      return a;
    };

    const apiMetric = (name: string, stat: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: name,
        dimensionsMap: { ApiId: props.api.apiId },
        statistic: stat,
        period: cdk.Duration.minutes(5),
      });

    alarm(
      'ServerErrorAlarm',
      apiMetric('5xx', 'Sum'),
      5,
      'API is returning server errors — field writes may be failing.',
    );
    alarm(
      'ClientErrorAlarm',
      apiMetric('4xx', 'Sum'),
      50,
      'Elevated 4xx. Could be expired tokens, could be credential stuffing.',
    );
    alarm(
      'LatencyAlarm',
      apiMetric('Latency', 'p99'),
      5000,
      'p99 latency above 5s — sync will be backing up on devices.',
    );
    alarm(
      'DatabaseCpuAlarm',
      props.cluster.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
      }),
      80,
      'Aurora CPU sustained above 80%.',
    );
    alarm(
      'DatabaseConnectionsAlarm',
      props.cluster.metricDatabaseConnections({
        period: cdk.Duration.minutes(5),
      }),
      80,
      'Connection count climbing — check for Lambda connection leaks.',
    );

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `Sineobex-${props.stage}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API requests and errors',
        left: [apiMetric('Count', 'Sum')],
        right: [apiMetric('4xx', 'Sum'), apiMetric('5xx', 'Sum')],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API latency',
        left: [apiMetric('Latency', 'p50'), apiMetric('Latency', 'p99')],
        width: 12,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aurora',
        left: [props.cluster.metricCPUUtilization()],
        right: [props.cluster.metricDatabaseConnections()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Aurora Serverless capacity',
        left: [
          props.cluster.metric('ServerlessDatabaseCapacity', {
            statistic: 'Average',
          }),
        ],
        width: 12,
      }),
    );

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'Subscribe on-call addresses to this topic',
    });
  }
}
