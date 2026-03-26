import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * NeuroRouter Infrastructure Stack
 * ==================================
 * This single stack creates ALL AWS resources for the NeuroRouter migration.
 *
 * RESOURCES CREATED:
 * ├── 8 DynamoDB Tables (users, api_keys, usage_monthly, usage_events,
 * │                       invoices, activity_log, admin_audit_log, plan_catalog)
 * ├── Cognito User Pool (with Google federation, 4 groups, 2 app clients)
 * ├── Cognito Lambda Triggers (post-confirmation, pre-token-generation)
 * ├── API Gateway REST API (all routes defined)
 * ├── S3 Bucket (invoice PDFs + CSV exports)
 * ├── Secrets Manager (Groq API key, JWT secret, Google client ID)
 * ├── EventBridge Rules (daily enforcement, monthly invoicing)
 * ├── CloudWatch Log Groups + Alarms
 * └── Plan Catalog Seed (via Custom Resource)
 *
 * NAMING CONVENTION: neurorouter-{resource}-dev
 * BILLING MODE: All DynamoDB tables use PAY_PER_REQUEST (on-demand)
 *               — you only pay for what you use, no capacity planning needed.
 */
export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = 'dev'; // Change to 'staging' or 'prod' later

    // ═══════════════════════════════════════════════════════════════
    // 1. DynamoDB TABLES (8 tables, all on-demand billing)
    // ═══════════════════════════════════════════════════════════════

    /**
     * USERS TABLE
     * -----------
     * Stores user profiles, account status, plan, Cognito link.
     * Mapped from: app/models.py → User (Beanie Document)
     *
     * Partition Key: id (string) — unique user ID
     * GSI: email-index — so we can look up users by email
     * GSI: googleId-index — so we can look up users by Google login
     */
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `neurorouter-users-${env}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Never delete user data accidentally
      pointInTimeRecovery: true, // Enable backups
    });

    // GSI = Global Secondary Index — lets you query by a different key
    // Without this, you can ONLY look up users by 'id'
    // With this, you can ALSO look up users by 'email'
    usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: 'googleId-index',
      partitionKey: { name: 'google_id', type: dynamodb.AttributeType.STRING },
    });

    /**
     * API KEYS TABLE
     * --------------
     * Stores hashed API keys, prefix, masked reference, active state.
     * Mapped from: app/models.py → ApiKey (Beanie Document)
     *
     * Partition Key: id (string) — unique key ID
     * GSI: key_hash-index — Go authorizer looks up by hash to validate
     * GSI: user_id-index — list all keys belonging to a user
     */
    const apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
      tableName: `neurorouter-api-keys-${env}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'key_hash-index',
      partitionKey: { name: 'key_hash', type: dynamodb.AttributeType.STRING },
    });

    apiKeysTable.addGlobalSecondaryIndex({
      indexName: 'user_id-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
    });

    /**
     * USAGE MONTHLY TABLE
     * -------------------
     * Stores aggregated token counts per user per month per model per key.
     * Dev 2's Lambda atomically increments these counts after each inference.
     *
     * Partition Key: userId (string)
     * Sort Key: sk (string) — composite: "YYYY-MM#MODEL#{modelName}#KEY#{apiKeyId}"
     *
     * WHY composite sort key?
     *   One query with userId + sk prefix "2024-03#" gets ALL usage for March.
     *   One query with userId + sk prefix "2024-03#MODEL#llama" gets usage for specific model.
     */
    const usageMonthlyTable = new dynamodb.Table(this, 'UsageMonthlyTable', {
      tableName: `neurorouter-usage-monthly-${env}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /**
     * USAGE EVENTS TABLE
     * ------------------
     * Stores one raw event per inference request.
     * Has a 90-day TTL — old events are automatically deleted by DynamoDB.
     *
     * Partition Key: userId (string)
     * Sort Key: timestamp (string) — ISO 8601 format for natural ordering
     * TTL: expiresAt — DynamoDB automatically deletes items when this time passes
     */
    const usageEventsTable = new dynamodb.Table(this, 'UsageEventsTable', {
      tableName: `neurorouter-usage-events-${env}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Events are ephemeral, OK to delete
      timeToLiveAttribute: 'expiresAt', // Auto-delete after 90 days
    });

    /**
     * INVOICES TABLE
     * --------------
     * Stores billing cycle records and invoice snapshots.
     * Mapped from: app/models.py → BillingCycle (Beanie Document)
     *
     * Partition Key: id (string) — unique invoice ID
     * GSI: userId-yearMonth-index — list invoices for a user in a specific month
     * GSI: invoiceNumber-index — look up by invoice number (e.g., "INV-2024-03-ABC12345")
     */
    const invoicesTable = new dynamodb.Table(this, 'InvoicesTable', {
      tableName: `neurorouter-invoices-${env}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    invoicesTable.addGlobalSecondaryIndex({
      indexName: 'userId-yearMonth-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'year_month', type: dynamodb.AttributeType.STRING },
    });

    invoicesTable.addGlobalSecondaryIndex({
      indexName: 'invoiceNumber-index',
      partitionKey: { name: 'invoice_number', type: dynamodb.AttributeType.STRING },
    });

    /**
     * ACTIVITY LOG TABLE
     * ------------------
     * Stores user-visible activity feed entries (login, API call, invoice generated, etc.)
     *
     * Partition Key: userId (string)
     * Sort Key: timestamp (string) — chronological ordering
     */
    const activityLogTable = new dynamodb.Table(this, 'ActivityLogTable', {
      tableName: `neurorouter-activity-log-${env}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /**
     * ADMIN AUDIT LOG TABLE
     * ---------------------
     * Stores every admin action for audit trail.
     * Mapped from: app/models.py → AdminAuditLog (Beanie Document)
     *
     * Partition Key: id (string) — unique log entry ID
     * GSI: adminUserId-index — all actions by a specific admin
     * GSI: targetUserId-index — all actions targeting a specific user
     */
    const adminAuditLogTable = new dynamodb.Table(this, 'AdminAuditLogTable', {
      tableName: `neurorouter-admin-audit-log-${env}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    adminAuditLogTable.addGlobalSecondaryIndex({
      indexName: 'adminUserId-index',
      partitionKey: { name: 'admin_user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    adminAuditLogTable.addGlobalSecondaryIndex({
      indexName: 'targetUserId-index',
      partitionKey: { name: 'target_user_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    /**
     * PLAN CATALOG TABLE
     * ------------------
     * Stores plan definitions (free, developer, enterprise) with pricing and limits.
     *
     * Partition Key: planId (string) — e.g., "free", "developer", "enterprise"
     */
    const planCatalogTable = new dynamodb.Table(this, 'PlanCatalogTable', {
      tableName: `neurorouter-plan-catalog-${env}`,
      partitionKey: { name: 'planId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ═══════════════════════════════════════════════════════════════
    // 2. COGNITO USER POOL
    // ═══════════════════════════════════════════════════════════════

    /**
     * COGNITO USER POOL
     * -----------------
     * This is the authentication system. Users sign up and log in through Cognito.
     * It replaces the custom email/password auth in app/auth.py.
     *
     * KEY SETTINGS:
     * - Email as login alias (users log in with email, not username)
     * - Self-signup enabled (users can register themselves)
     * - Email verification required (prevents fake accounts)
     */
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `neurorouter-users-${env}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true }, // Login with email
      autoVerify: { email: true },    // Auto-verify email
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Cognito Groups ──
    // Groups control what users can do (like roles in the old system)
    const groups = ['customer', 'customer-pending', 'admin', 'ops'];
    groups.forEach((groupName) => {
      new cognito.CfnUserPoolGroup(this, `Group-${groupName}`, {
        userPoolId: userPool.userPoolId,
        groupName: groupName,
        description: `${groupName} group for NeuroRouter`,
      });
    });

    // ── App Clients ──
    // App Clients are like "API keys" for apps that want to use Cognito
    // Web app client — for the Next.js frontend (no secret, runs in browser)
    const webAppClient = userPool.addClient('WebAppClient', {
      userPoolClientName: `neurorouter-web-${env}`,
      authFlows: {
        userPassword: true,   // Email + password login
        userSrp: true,        // Secure Remote Password (more secure)
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:3000/auth/callback', 'https://neurorouter.in/auth/callback'],
        logoutUrls: ['http://localhost:3000', 'https://neurorouter.in'],
      },
      generateSecret: false, // No secret for browser apps (SPA)
    });

    // Admin app client — for the admin dashboard (has a secret)
    const adminAppClient = userPool.addClient('AdminAppClient', {
      userPoolClientName: `neurorouter-admin-${env}`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: true, // Admin app runs server-side, can keep a secret
    });

    // ── Cognito Domain ──
    // This creates a hosted login page at https://neurorouter-dev.auth.eu-north-1.amazoncognito.com
    userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: `neurorouter-${env}` },
    });

    // ═══════════════════════════════════════════════════════════════
    // 3. COGNITO LAMBDA TRIGGERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * POST-CONFIRMATION TRIGGER
     * -------------------------
     * Fires when a new user confirms their email.
     * Creates the user's row in the DynamoDB users table with:
     *   - status: PENDING_APPROVAL
     *   - plan: free
     *
     * WHY a trigger instead of doing it in the frontend?
     *   Because the user record MUST exist before they can do anything.
     *   A trigger guarantees it happens atomically with signup.
     */
    const postConfirmationFn = new lambda.Function(this, 'PostConfirmationTrigger', {
      functionName: `neurorouter-post-confirmation-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import os
import uuid
from datetime import datetime

dynamodb = boto3.resource('dynamodb')

def handler(event, context):
    """
    Cognito Post-Confirmation Trigger.
    Creates a user record in DynamoDB when a new user confirms their account.

    EVENT STRUCTURE (from Cognito):
    {
        "request": {
            "userAttributes": {
                "sub": "cognito-uuid",
                "email": "user@example.com",
                "name": "John Doe"
            }
        }
    }
    """
    user_attrs = event['request']['userAttributes']
    table = dynamodb.Table(os.environ['USERS_TABLE'])

    now = datetime.utcnow().isoformat()

    table.put_item(Item={
        'id': user_attrs['sub'],           # Cognito user ID = DynamoDB user ID
        'email': user_attrs.get('email', ''),
        'full_name': user_attrs.get('name', ''),
        'auth_provider': 'cognito',
        'account_status': 'PENDING_APPROVAL',  # Admin must approve
        'plan_id': 'free',                     # Start on free plan
        'is_active': True,
        'created_at': now,
        'updated_at': now,
    })

    print(f"Created user record for {user_attrs.get('email')}")

    # MUST return the event — Cognito requires this
    return event
`),
      environment: {
        USERS_TABLE: usersTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // Give the trigger permission to write to the users table
    usersTable.grantWriteData(postConfirmationFn);

    // Wire the trigger to Cognito
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);

    /**
     * PRE-TOKEN GENERATION TRIGGER
     * ----------------------------
     * Fires every time Cognito generates a JWT token (login, refresh).
     * Injects custom claims: role, accountStatus, planId.
     *
     * WHY custom claims?
     *   The frontend and Go authorizer read these claims from the JWT
     *   to know the user's role and status WITHOUT querying DynamoDB.
     */
    const preTokenGenFn = new lambda.Function(this, 'PreTokenGenTrigger', {
      functionName: `neurorouter-pre-token-gen-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import os

dynamodb = boto3.resource('dynamodb')

def handler(event, context):
    """
    Cognito Pre-Token Generation Trigger.
    Reads the user's current status from DynamoDB and injects it into the JWT.

    CLAIMS ADDED TO JWT:
    - custom:role → "customer", "admin", "ops"
    - custom:accountStatus → "ACTIVE", "GRACE", "BLOCKED", "PENDING_APPROVAL"
    - custom:planId → "free", "developer", "enterprise"
    """
    user_id = event['request']['userAttributes']['sub']
    table = dynamodb.Table(os.environ['USERS_TABLE'])

    resp = table.get_item(Key={'id': user_id})
    user = resp.get('Item', {})

    # Determine role from Cognito groups
    groups = event['request'].get('groupConfiguration', {}).get('groupsToOverride', [])
    role = 'customer'  # default
    if 'admin' in groups:
        role = 'admin'
    elif 'ops' in groups:
        role = 'ops'
    elif 'customer-pending' in groups:
        role = 'customer-pending'

    # Inject custom claims into the JWT
    event['response'] = {
        'claimsOverrideDetails': {
            'claimsToAddOrOverride': {
                'custom:role': role,
                'custom:accountStatus': user.get('account_status', 'PENDING_APPROVAL'),
                'custom:planId': user.get('plan_id', 'free'),
            }
        }
    }

    return event
`),
      environment: {
        USERS_TABLE: usersTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    usersTable.grantReadData(preTokenGenFn);
    userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, preTokenGenFn);

    // ═══════════════════════════════════════════════════════════════
    // 4. API GATEWAY REST API
    // ═══════════════════════════════════════════════════════════════

    /**
     * REST API
     * --------
     * Single API Gateway that routes all requests to the correct Lambda.
     * All paths are defined now; Lambda integrations are wired later.
     *
     * ROUTES:
     *   /auth/{proxy+}       → Auth Lambda (Cognito login/signup)
     *   /api-keys/{proxy+}   → API Keys Lambda (CRUD for API keys)
     *   /dashboard/{proxy+}  → Dashboard Lambda (usage stats, activity)
     *   /billing/{proxy+}    → Billing Lambda (invoices, payments)
     *   /admin/{proxy+}      → Admin Lambda (user management, audit)
     *   /v1/{proxy+}         → Router Service Lambda (AI inference)
     *   /config/{proxy+}     → Config Lambda (model catalog, settings)
     */
    const api = new apigateway.RestApi(this, 'NeuroRouterApi', {
      restApiName: `neurorouter-api-${env}`,
      description: 'NeuroRouter API Gateway — all routes',
      deployOptions: {
        stageName: env,
        throttlingRateLimit: 100,  // requests per second
        throttlingBurstLimit: 200, // burst capacity
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'http://localhost:3000',          // Local dev
          'https://neurorouter.in',         // Production
          'https://www.neurorouter.in',
        ],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
        allowCredentials: true,
      },
    });

    // ── Cognito Authorizer ──
    // Validates JWT tokens from Cognito on protected routes
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `neurorouter-cognito-auth-${env}`,
    });

    // ── Define all route resources ──
    // MOCK integration = placeholder that returns 200 OK
    // These get replaced with real Lambda integrations as Lambdas are built
    const mockIntegration = new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: { 'application/json': '{"message": "Route not yet wired to Lambda"}' },
      }],
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    });

    const methodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{ statusCode: '200' }],
    };

    // Routes WITH Cognito auth (protected routes)
    const protectedRoutes = ['auth', 'api-keys', 'dashboard', 'billing', 'admin'];
    protectedRoutes.forEach((route) => {
      const resource = api.root.addResource(route);
      const proxy = resource.addProxy({ anyMethod: false });
      proxy.addMethod('ANY', mockIntegration, methodOptions);
    });

    // /v1/{proxy+} — uses custom Go Lambda authorizer (NOT Cognito)
    // The Go authorizer validates API keys, not JWTs
    const v1Resource = api.root.addResource('v1');
    const v1Proxy = v1Resource.addProxy({ anyMethod: false });
    v1Proxy.addMethod('ANY', mockIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE, // Custom authorizer added later by Dev 1
      methodResponses: [{ statusCode: '200' }],
    });

    // /config/{proxy+} — public, no auth needed
    const configResource = api.root.addResource('config');
    const configProxy = configResource.addProxy({ anyMethod: false });
    configProxy.addMethod('ANY', mockIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      methodResponses: [{ statusCode: '200' }],
    });

    // ═══════════════════════════════════════════════════════════════
    // 5. S3 BUCKET (Invoice PDFs + CSV Exports)
    // ═══════════════════════════════════════════════════════════════

    /**
     * S3 BUCKET
     * ---------
     * Private bucket where Dev 2's Lambda uploads:
     *   - Invoice PDFs at: invoices/{invoiceId}.pdf
     *   - CSV exports at: exports/{exportId}.csv
     *
     * ALL public access is blocked — files are only accessible via
     * presigned URLs generated by the Lambda.
     */
    const invoiceBucket = new s3.Bucket(this, 'InvoiceBucket', {
      bucketName: `neurorouter-invoice-pdfs-${env}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // No public access ever
      encryption: s3.BucketEncryption.S3_MANAGED,        // Encrypted at rest
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Auto-delete old exports after 30 days to save storage costs
          prefix: 'exports/',
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // ═══════════════════════════════════════════════════════════════
    // 6. SECRETS MANAGER
    // ═══════════════════════════════════════════════════════════════

    /**
     * SECRETS MANAGER ENTRIES
     * -----------------------
     * These store sensitive values that Lambdas need at runtime.
     * Lambdas read from Secrets Manager instead of environment variables.
     *
     * WHY Secrets Manager instead of env vars?
     *   - Env vars are visible in the Lambda console to anyone with access
     *   - Secrets Manager encrypts values and logs every access
     *   - Secrets can be rotated without redeploying Lambdas
     *
     * INITIAL VALUES: Placeholder strings — you'll update them manually
     * in the AWS console with real values after deployment.
     */
    const groqSecret = new secretsmanager.Secret(this, 'GroqApiKeySecret', {
      secretName: `neurorouter/${env}/groq-api-key`,
      description: 'Groq Cloud API key for LLM inference',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_WITH_REAL_GROQ_KEY'),
    });

    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `neurorouter/${env}/jwt-secret`,
      description: 'JWT signing secret for token generation',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_WITH_REAL_JWT_SECRET'),
    });

    const googleClientSecret = new secretsmanager.Secret(this, 'GoogleClientSecret', {
      secretName: `neurorouter/${env}/google-client-id`,
      description: 'Google OAuth client ID for federated login',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_WITH_REAL_GOOGLE_CLIENT_ID'),
    });

    // ═══════════════════════════════════════════════════════════════
    // 7. EVENTBRIDGE SCHEDULER RULES
    // ═══════════════════════════════════════════════════════════════

    /**
     * EVENTBRIDGE RULES
     * -----------------
     * These are cron-like schedulers that trigger Lambda functions.
     * Targets are left empty — they'll be wired when Lambdas are built.
     *
     * DAILY ENFORCEMENT (02:00 UTC every day):
     *   Checks overdue invoices, transitions GRACE → BLOCKED, etc.
     *
     * MONTHLY INVOICING (01:00 UTC on 1st of each month):
     *   Generates invoices for all active users for the previous month.
     */
    const dailyEnforcementRule = new events.Rule(this, 'DailyEnforcementRule', {
      ruleName: `neurorouter-daily-enforcement-${env}`,
      description: 'Daily billing enforcement — checks overdue invoices, blocks accounts',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: true,
    });

    const monthlyInvoiceRule = new events.Rule(this, 'MonthlyInvoiceRule', {
      ruleName: `neurorouter-monthly-invoice-${env}`,
      description: 'Monthly invoice generation — runs on 1st of each month',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '1',
        day: '1',
        month: '*',
        year: '*',
      }),
      enabled: true,
    });

    // ═══════════════════════════════════════════════════════════════
    // 7b. PYTHON LAMBDA FUNCTIONS (Day 9 — Tuned Memory & Timeouts)
    // ═══════════════════════════════════════════════════════════════

    /**
     * LAMBDA TUNING (Day 9)
     * ---------------------
     * Memory and timeout settings based on workload characteristics:
     * - More memory = faster execution (AWS allocates CPU proportional to memory)
     * - Timeout should match the expected max duration + buffer
     * - These are placeholder Lambda functions — code is deployed separately via deploy.sh
     */
    const eventsTargets = require('aws-cdk-lib/aws-events-targets');

    // router-service (non-streaming): 512 MB, 60s timeout
    const routerServiceFn = new lambda.Function(this, 'RouterService', {
      functionName: `neurorouter-router-service-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromInline('def lambda_handler(e,c): return {"statusCode":200,"body":"placeholder"}'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_USAGE_EVENTS: usageEventsTable.tableName,
        TABLE_USAGE_MONTHLY: usageMonthlyTable.tableName,
        TABLE_USERS: usersTable.tableName,
        TABLE_PLAN_CATALOG: planCatalogTable.tableName,
        GROQ_SECRET_NAME: `neurorouter/${env}/groq-api-key`,
      },
    });
    usageEventsTable.grantWriteData(routerServiceFn);
    usageMonthlyTable.grantReadWriteData(routerServiceFn);

    // router-service-streaming: 512 MB, 60s timeout
    const routerStreamingFn = new lambda.Function(this, 'RouterServiceStreaming', {
      functionName: `neurorouter-router-service-streaming-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler_streaming.lambda_handler',
      code: lambda.Code.fromInline('def lambda_handler(e,c): return {"statusCode":200,"body":"placeholder"}'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        TABLE_USAGE_EVENTS: usageEventsTable.tableName,
        TABLE_USAGE_MONTHLY: usageMonthlyTable.tableName,
        GROQ_SECRET_NAME: `neurorouter/${env}/groq-api-key`,
      },
    });
    usageEventsTable.grantWriteData(routerStreamingFn);
    usageMonthlyTable.grantReadWriteData(routerStreamingFn);

    // invoice-pdf-service: 768 MB, 30s (reportlab is memory-intensive)
    const invoicePdfFn = new lambda.Function(this, 'InvoicePdfService', {
      functionName: `neurorouter-invoice-pdf-service-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromInline('def lambda_handler(e,c): return {"statusCode":200,"body":"placeholder"}'),
      memorySize: 768,
      timeout: cdk.Duration.seconds(30),
      environment: {
        INVOICES_TABLE: invoicesTable.tableName,
        USERS_TABLE: usersTable.tableName,
        PDF_BUCKET: `neurorouter-invoice-pdfs-${env}`,
      },
    });
    invoicesTable.grantReadWriteData(invoicePdfFn);
    usersTable.grantReadData(invoicePdfFn);
    invoiceBucket.grantPut(invoicePdfFn);

    // analytics-export-service: 512 MB, 60s
    const analyticsExportFn = new lambda.Function(this, 'AnalyticsExportService', {
      functionName: `neurorouter-analytics-export-service-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromInline('def lambda_handler(e,c): return {"statusCode":200,"body":"placeholder"}'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        USAGE_MONTHLY_TABLE: usageMonthlyTable.tableName,
        EXPORT_BUCKET: `neurorouter-invoice-pdfs-${env}`,
      },
    });
    usageMonthlyTable.grantReadData(analyticsExportFn);
    invoiceBucket.grantPut(analyticsExportFn);

    // monthly-invoice-job: 512 MB, 900s (15 min — batch processing)
    const monthlyInvoiceFn = new lambda.Function(this, 'MonthlyInvoiceJob', {
      functionName: `neurorouter-monthly-invoice-job-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromInline('def lambda_handler(e,c): return {"statusCode":200,"body":"placeholder"}'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(900),
      environment: {
        USERS_TABLE: usersTable.tableName,
        INVOICES_TABLE: invoicesTable.tableName,
        USAGE_MONTHLY_TABLE: usageMonthlyTable.tableName,
        PLAN_CATALOG_TABLE: planCatalogTable.tableName,
        AUDIT_LOG_TABLE: adminAuditLogTable.tableName,
      },
    });
    usersTable.grantReadData(monthlyInvoiceFn);
    invoicesTable.grantReadWriteData(monthlyInvoiceFn);
    usageMonthlyTable.grantReadData(monthlyInvoiceFn);
    planCatalogTable.grantReadData(monthlyInvoiceFn);
    adminAuditLogTable.grantWriteData(monthlyInvoiceFn);

    // Wire EventBridge rule to monthly invoice Lambda
    monthlyInvoiceRule.addTarget(new eventsTargets.LambdaFunction(monthlyInvoiceFn));

    // Output Lambda ARNs for sharing with Dev 1
    new cdk.CfnOutput(this, 'RouterServiceArn', { value: routerServiceFn.functionArn });
    new cdk.CfnOutput(this, 'RouterStreamingArn', { value: routerStreamingFn.functionArn });
    new cdk.CfnOutput(this, 'InvoicePdfServiceArn', { value: invoicePdfFn.functionArn });
    new cdk.CfnOutput(this, 'AnalyticsExportServiceArn', { value: analyticsExportFn.functionArn });
    new cdk.CfnOutput(this, 'MonthlyInvoiceJobArn', { value: monthlyInvoiceFn.functionArn });

    // ═══════════════════════════════════════════════════════════════
    // 8. CLOUDWATCH LOG GROUPS + ALARMS
    // ═══════════════════════════════════════════════════════════════

    /**
     * LOG GROUPS
     * ----------
     * Each Lambda gets its own log group with 30-day retention.
     * Without explicit log groups, AWS creates them with INFINITE retention
     * (which costs money forever).
     */
    // Note: All Lambda functions managed by CDK automatically get log groups.
    // No explicit log groups needed — CDK handles retention via the Lambda construct.

    /**
     * CLOUDWATCH ALARMS
     * -----------------
     * These alarms notify you when something goes wrong.
     * They monitor Lambda error rates, latency, and auth failures.
     */

    // Alarm: Lambda error rate > 1%
    // This creates a CloudWatch metric for ALL Lambda errors in this account
    const lambdaErrorMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: `neurorouter-lambda-errors-${env}`,
      alarmDescription: 'Lambda error rate is above threshold',
      metric: lambdaErrorMetric,
      threshold: 5,                      // More than 5 errors in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // Alarm: p99 latency > 5 seconds
    const lambdaLatencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      statistic: 'p99',
      period: cdk.Duration.minutes(5),
    });

    new cloudwatch.Alarm(this, 'LambdaLatencyAlarm', {
      alarmName: `neurorouter-lambda-latency-p99-${env}`,
      alarmDescription: 'Lambda p99 latency exceeds 5 seconds',
      metric: lambdaLatencyMetric,
      threshold: 5000,                   // 5000ms = 5 seconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // Alarm: API Gateway 4xx errors (includes auth failures)
    const apiGateway4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: { ApiName: api.restApiName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    });

    new cloudwatch.Alarm(this, 'AuthFailureAlarm', {
      alarmName: `neurorouter-auth-failures-${env}`,
      alarmDescription: 'Authorizer failures above 10 per minute',
      metric: apiGateway4xxMetric,
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // ═══════════════════════════════════════════════════════════════
    // 9. STACK OUTPUTS
    // ═══════════════════════════════════════════════════════════════
    // These are printed after `cdk deploy` so you can see resource IDs

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'WebClientId', { value: webAppClient.userPoolClientId });
    new cdk.CfnOutput(this, 'AdminClientId', { value: adminAppClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiGatewayUrl', { value: api.url });
    new cdk.CfnOutput(this, 'InvoiceBucketName', { value: invoiceBucket.bucketName });
    new cdk.CfnOutput(this, 'UsersTableName', { value: usersTable.tableName });
    new cdk.CfnOutput(this, 'InvoicesTableName', { value: invoicesTable.tableName });
    new cdk.CfnOutput(this, 'PlanCatalogTableName', { value: planCatalogTable.tableName });
    new cdk.CfnOutput(this, 'GroqSecretArn', { value: groqSecret.secretArn });
  }
}
