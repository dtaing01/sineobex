#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

/**
 * Sineobex — street medicine outreach platform.
 *
 * Every service used here is HIPAA-eligible. That is necessary and not
 * sufficient: a signed Business Associate Addendum with AWS must be in place
 * before any real PHI touches this account. See docs/HIPAA.md.
 */
const stage = app.node.tryGetContext('stage') ?? 'dev';
const prefix = `Sineobex-${stage}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, stage });

const data = new DataStack(app, `${prefix}-Data`, {
  env,
  stage,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
});

const auth = new AuthStack(app, `${prefix}-Auth`, { env, stage });

const api = new ApiStack(app, `${prefix}-Api`, {
  env,
  stage,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  database: data.cluster,
  databaseSecret: data.credentials,
  attachmentsBucket: data.attachments,
  userPool: auth.userPool,
  encryptionKey: data.encryptionKey,
});

new ObservabilityStack(app, `${prefix}-Observability`, {
  env,
  stage,
  api: api.httpApi,
  cluster: data.cluster,
  auditBucket: data.auditArchive,
});

cdk.Tags.of(app).add('Application', 'Sineobex');
cdk.Tags.of(app).add('Stage', stage);
// Marks every resource as in-scope for the HIPAA control set, so an auditor
// can enumerate them without reading CloudFormation.
cdk.Tags.of(app).add('DataClassification', 'PHI');
