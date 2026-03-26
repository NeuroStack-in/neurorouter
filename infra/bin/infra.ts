#!/usr/bin/env node
/**
 * CDK App Entry Point — NeuroRouter AWS Infrastructure
 * =====================================================
 * This file creates the CDK app and instantiates our stack.
 *
 * WHAT IS THIS FILE?
 * - CDK apps have an "entry point" — the file that creates the App object
 * - The App object is the root of all CDK constructs
 * - We create our InfraStack inside the App, targeting eu-north-1
 *
 * HOW CDK WORKS (simplified):
 *   1. You write TypeScript code describing AWS resources
 *   2. `cdk synth` converts your code → CloudFormation JSON template
 *   3. `cdk deploy` sends that template to AWS CloudFormation
 *   4. CloudFormation creates/updates the actual AWS resources
 */

import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

new InfraStack(app, 'NeuroRouterStack', {
  // Deploy to ap-south-1 (Mumbai)
  env: {
    account: '896823725438',
    region: 'ap-south-1',
  },
  description: 'NeuroRouter AWS Migration — all infrastructure resources',
});
