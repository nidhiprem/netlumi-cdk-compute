#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ComputeStack } from '../lib/compute-stack';

const app = new cdk.App();
new ComputeStack(app, 'NetlumiComputeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Netlumi E2E test: Lambda + SecurityGroup (depends on foundation + iam-access)',
});
