# 🧑‍💻 Developer 1 — Go Control Plane + AWS Infrastructure
## NeuroRouter AWS Migration — 9-Day Plan (No Code, Tasks Only)

> **Stack:** Go · AWS CDK · Cognito · DynamoDB · API Gateway · Lambda · EventBridge · S3 · Secrets Manager
> **Owns:** All AWS infrastructure, all Go Lambda functions, MongoDB migration, frontend integration, admin panel backend

---

## Day 1 — AWS Infrastructure Foundation

**Topic:** Provision every AWS resource the entire project depends on.

**Description:**
This is the most critical day. Everything both developers build plugs into the infrastructure you create today. Dev 2 cannot deploy Lambdas until the DynamoDB tables, API Gateway, and S3 bucket exist. Do not proceed to Day 2 without a successful `cdk deploy`.

**What to do:**

- **Initialize CDK Project** — Create an `infra/` folder at the root of the repo and set up a new AWS CDK TypeScript project inside it. This project will define and version-control every cloud resource.

- **Create DynamoDB Tables** — Create the following 8 tables in on-demand billing mode. Share the exact schema with Dev 2 immediately after creation so they can start writing to these tables from Day 2:
  - [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) — stores user profiles, account status, plan, Cognito link
  - [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) — stores hashed API keys, prefix, masked reference, active state
  - `usage_monthly` — stores aggregated token counts per user per month per model per key
  - `usage_events` — stores one raw event per inference request (90-day TTL)
  - [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) — stores billing cycle records and invoice snapshots
  - `activity_log` — stores user-visible activity feed entries
  - `admin_audit_log` — stores every admin action for audit trail
  - `plan_catalog` — stores plan definitions (free, developer, enterprise)

- **Set Up Cognito User Pool** — Create a Cognito User Pool named `neurorouter-users`. Enable email as the login alias. Create two app clients: one for the public web app and one for the admin app. Create four groups: `customer`, `customer-pending`, [admin](file:///d:/Neurostack/neurorouter/app/auth.py#81-97), `ops`. Configure Google as a federated identity provider so Google login works through Cognito.

- **Configure Cognito Triggers** — Wire a Post-Confirmation Lambda trigger that fires whenever a new user confirms their account. This trigger will create the user's row in the DynamoDB [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table with status `PENDING_APPROVAL` and plan `free`. Wire a Pre-Token Generation trigger that injects custom claims like `role`, `accountStatus`, and `planId` into every JWT.

- **Create API Gateway REST API** — Create a single REST API named `neurorouter-api`. Define all resource paths now even if the Lambda integrations are not yet wired. Paths to create: `/auth/{proxy+}`, `/api-keys/{proxy+}`, `/dashboard/{proxy+}`, `/billing/{proxy+}`, `/admin/{proxy+}`, `/v1/{proxy+}`, `/config/{proxy+}`. Enable CORS for the production frontend URL and localhost. Enable response streaming on the `/v1/chat/completions` and `/v1/completions` routes specifically.

- **Create Cognito Authorizer** — Attach a Cognito-backed JWT authorizer to all routes except `/v1/{proxy+}` and `/config/{proxy+}`. The `/v1/{proxy+}` route gets a custom Go Lambda request authorizer instead (the Lambda itself is built on Day 4, but create the authorizer resource in API Gateway today).

- **Create S3 Bucket** — Create a private S3 bucket named `neurorouter-invoices-{env}`. This is where Dev 2 will upload generated invoice PDFs and CSV exports. Block all public access.

- **Create Secrets Manager Entries** — Create secret entries for the Groq API key, JWT secret, and Google client ID. These will be populated with real values manually. Lambda functions will read from here instead of environment variables.

- **Create EventBridge Scheduler Rules** — Create two schedule rules: one for daily enforcement at 02:00 UTC every day, and one for monthly invoice generation at 01:00 UTC on the 1st of every month. Leave the Lambda targets empty for now — they will be wired when the respective Lambdas are built.

- **Set Up CloudWatch** — Create log groups for each Lambda with 30-day retention. Create alarms for Lambda error rate above 1%, p99 latency above 5 seconds, and authorizer failures above 10 per minute.

- **Seed Plan Catalog** — After deployment, run a one-time script to insert the `free` and `developer` plan records into the `plan_catalog` DynamoDB table with their pricing and token allowances.

**Deliverable:** `cdk deploy` succeeds in the `dev` environment. All 8 tables, Cognito pool, API Gateway, S3 bucket, Secrets Manager entries, EventBridge rules, and CloudWatch alarms exist and are verified in the AWS console.

---

## Day 2 — MongoDB to DynamoDB Migration + Cognito Backfill

**Topic:** Move all existing operational data from MongoDB to DynamoDB and create Cognito identities for all existing users.

**Description:**
The current system runs on MongoDB using Beanie/Motor. All existing users, API keys, billing records, usage data, and audit logs must be migrated to DynamoDB. Existing users must also get Cognito accounts so they can log in through the new system without needing to re-register.

**What to do:**

- **Export MongoDB Collections** — Write a Python script using pymongo that connects to the existing MongoDB and exports all documents from these collections into JSON files: [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249), [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174), `monthly_usage`, `billing_cycles`, `admin_audit_logs`. Store the exports in a `scripts/exports/` folder. Transform MongoDB ObjectId fields to plain strings and datetime fields to ISO format strings during export.

- **Transform and Import Users** — Write a DynamoDB import script that reads the exported users JSON and writes each user into the DynamoDB [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table. Key transformations: use the string version of MongoDB `_id` as `userId`, lowercase the email and store it as `emailLower` for GSI lookup, preserve `accountStatus` as-is, set `planId` to `developer` for currently active users and `free` for pending ones, add `isManualBlock: false`, add `isActive: true`.

- **Transform and Import API Keys** — Import the exported [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) collection into the DynamoDB [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) table. Key transformations: use string `_id` as `apiKeyId`, preserve `keyHash` and `keyPrefix` exactly, compute a `maskedReference` by appending `****` after the key prefix, preserve `isActive`, `createdAt`, and `lastUsedAt`.

- **Transform and Import Usage Records** — Import `monthly_usage` into the DynamoDB `usage_monthly` table. The sort key `periodKey` must be constructed by combining `yearMonth`, model name, and API key ID in the format `YYYY-MM#MODEL#{model}#KEY#{apiKeyId}`. This is important — Dev 2 will write to this table using the same key format.

- **Transform and Import Billing Cycles** — Import `billing_cycles` into the DynamoDB [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) table. Flatten the nested `snapshot_data` and `calculated_costs` objects into top-level attributes. Map field names as defined in the schema shared with Dev 2.

- **Transform and Import Audit Logs** — Import `admin_audit_logs` into the DynamoDB `admin_audit_log` table using string `_id` as `auditId`. Copy all remaining fields.

- **Cognito User Backfill for Local-Password Users** — For every user in MongoDB with `auth_provider = "local"`, create a Cognito user using `AdminCreateUser`. Suppress the welcome email. Set `email_verified` to true. Add them to the `customer` Cognito group if their status is `ACTIVE`, or `customer-pending` if their status is `PENDING_APPROVAL`.

- **Cognito User Backfill for Google Users** — For every user with `auth_provider = "google"`, create the Cognito user and link their Google identity using Cognito's federated identity linking. This ensures their Google login will continue to work through Cognito.

- **Validate Migration Completeness** — After import, verify row counts match between MongoDB and DynamoDB for each collection. Spot-check 10 random users to confirm all fields mapped correctly. Test a DynamoDB GSI query on the `emailLower-index` to confirm it returns the correct user.

- **Validate Cognito Backfill** — Confirm every user from MongoDB exists in Cognito. Confirm group assignments are correct. Test one login using the existing credentials through the new Cognito-backed `/auth/login` endpoint (even if it's not fully built yet, test the Cognito auth flow directly).

**Deliverable:** All MongoDB data is present in DynamoDB. All existing users have Cognito identities. Migration and backfill scripts are committed to `scripts/`. Row counts verified. Spot checks passed.

---

## Day 3 — Go Lambda: Auth Service + Cognito Wrappers

**Topic:** Build the authentication Lambda that wraps Cognito and preserves the existing login/register API contracts exactly.

**Description:**
The frontend currently calls `/auth/register`, `/auth/login`, `/auth/google`, and `/auth/logout` against the Python FastAPI backend. This Go Lambda must expose the exact same URL contracts and response shapes so the frontend requires no changes. Internally, it delegates identity management to Cognito instead of the custom JWT system.

**What to do:**

- **Set Up Go Lambda Project** — Create `lambda/auth-service/` with a Go module. Pull in the AWS Lambda Go SDK, AWS SDK v2 for Cognito and DynamoDB, and any JSON/HTTP helper libraries needed.

- **Build Internal DynamoDB Package** — Create an internal helper package for DynamoDB operations on the [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table. It should support: get user by `userId`, get user by `emailLower` (via GSI), create a new user row, and update user fields. This package will be reused by other Go Lambdas.

- **Build Internal Cognito Package** — Create an internal helper package that wraps the Cognito SDK calls needed: `SignUp`, `AdminConfirmSignUp`, `InitiateAuth` for password auth, `InitiateAuth` for refresh token, `GlobalSignOut`, and Google federated identity linking.

- **Build Internal Billing Refresh Package** — Create an internal billing package with a `RefreshBillingStatus` function. This function reads all non-paid, non-void invoices for a user from DynamoDB and computes whether the user should be ACTIVE, GRACE, or BLOCKED based on due dates and grace period ends. It then updates the user's status in DynamoDB if it changed. This logic is ported from `app/billing_utils.py → refresh_user_billing_status()`.

- **Implement POST /auth/register** — Accept email, full name, and password. Validate format. Call Cognito to sign up and auto-confirm the user. The Post-Confirmation Lambda trigger (configured on Day 1) will automatically create the DynamoDB user row. Return the same response shape as the current Python endpoint: id, email, is_active, created_at.

- **Implement POST /auth/login** — Accept email and password. Call Cognito with USER_PASSWORD_AUTH flow. On success, run billing refresh to update account status. Return the Cognito AccessToken in the same response shape as today: access_token, token_type, expires_in. Reject users with BLOCKED or REJECTED status before issuing tokens.

- **Implement POST /auth/google** — Accept a Google OAuth ID token from the frontend. Verify it against Google's public keys. Link or create the user in Cognito using federated identity. Create or update the DynamoDB user row. Return the same TokenResponse shape.

- **Implement POST /auth/logout** — Accept the user's current access token. Call Cognito GlobalSignOut to invalidate all sessions for this user. Return the same success message as today.

- **Implement GET /auth/me** — Validate the Cognito JWT from the Authorization header. Look up the user in DynamoDB using the Cognito sub claim. Return a merged profile including userId, email, fullName, accountStatus, planId, and role.

- **Implement POST /auth/refresh** — Accept a Cognito refresh token. Call Cognito's REFRESH_TOKEN_AUTH flow. Return a new access token. This endpoint is new — it did not exist in the Python backend but is required for proper frontend token lifecycle management.

- **Deploy to Lambda and Wire API Gateway** — Deploy the built Go binary to the auth-service Lambda function. Wire the `/auth/{proxy+}` API Gateway route to this Lambda.

**Deliverable:** All auth endpoints live on API Gateway and return correct responses. Register, login, Google login, logout, me, and refresh all tested and working.

---

## Day 4 — Go Lambda: API Key Service + Request Authorizer

**Topic:** Build the API key management service and the critical gateway guard that protects all AI inference routes.

**Description:**
The API key authorizer is the most performance-sensitive piece in the entire system. Every single inference request goes through it. It must validate the key, check the user's billing status in real time, and inject context (userId, planId, accountStatus) into the request so Dev 2's Python Lambda can use it without making any additional database calls.

**What to do:**

- **Set Up Go Lambda Project** — Create `lambda/api-key-service/` and `lambda/api-key-authorizer/` with separate Go modules. Share the internal billing and DynamoDB packages from Day 3 via a common internal module.

- **Implement POST /api-keys** — Accept an optional name. Generate a new API key in the format `neurorouter_` followed by 13 random alphanumeric characters. Hash the raw key using SHA-256 and store only the hash in DynamoDB. Return the raw key once in the response — it must never be stored or shown again. Write an entry to the `activity_log` table.

- **Implement GET /api-keys** — Query the DynamoDB [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) table using the `userId-createdAt-index` GSI for the current user. Return a list showing id, name, keyPrefix, maskedReference, isActive, createdAt, and lastUsedAt for each key.

- **Implement DELETE /api-keys/{apiKeyId}** — Verify the key belongs to the currently authenticated user. Set `isActive` to false and record `revokedAt`. Write an entry to the `activity_log` table.

- **Build the API Key Request Authorizer** — This is a Go Lambda that API Gateway calls before forwarding any `/v1/*` request. It receives the raw Authorization header and must:
  - Extract the Bearer token
  - Validate the format matches `neurorouter_` + 13 alphanumeric characters
  - Hash the token and query the [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) table using the `keyHash-index` GSI
  - If the key is not found or is inactive, return a Deny policy immediately
  - Look up the user in the [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table
  - Run billing refresh to compute the current account status
  - If the user is BLOCKED, return a Deny policy with a billing blocked message
  - If the user is PENDING_APPROVAL, return a Deny policy with a pending message
  - If the user is ACTIVE or GRACE, return an Allow policy
  - Update `lastUsedAt` on the API key record
  - Inject the following context fields into the Allow policy for Dev 2 to read: `userId`, `apiKeyId`, `planId`, `accountStatus`, `graceDaysRemaining`

- **Set Authorizer Caching to Zero** — The authorizer must not cache responses. Every request must be checked live because account status can change at any moment due to billing events.

- **Wire Authorizer to API Gateway** — Attach the Go authorizer Lambda to all `/v1/*` routes in API Gateway. Test with a valid key, an invalid key, and a key belonging to a blocked user.

**Deliverable:** API key CRUD works. The authorizer is live on all `/v1/*` routes. Valid keys pass through. Invalid, revoked, and blocked-account keys are denied. Context fields are visible in the downstream Lambda event.

---

## Day 5 — Go Lambda: Dashboard Service + Config Service

**Topic:** Build the dashboard data APIs and the public configuration endpoints that drive the frontend's plan and model display.

**Description:**
The dashboard currently pulls usage data from MongoDB. This Go Lambda replaces that with DynamoDB queries. The config service is new — it makes the plan list and model list dynamic, driven by backend data instead of hardcoded frontend values.

**What to do:**

- **Set Up Go Lambda Projects** — Create `lambda/dashboard-service/` and `lambda/config-service/`.

- **Implement GET /dashboard/overview** — Query the `usage_monthly` table for all records belonging to the current user. Sum up total tokens and total request count across all periods. Count active API keys from the [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) table. Query the `activity_log` table for the 10 most recent entries for this user. Look up the user's account status and compute the grace banner data. Return all of this in the DashboardOverview response shape. Also include a new `graceBanner` field with `show`, `daysRemaining`, and `billingMessage` — this is a new field that the Python backend did not return.

- **Implement GET /dashboard/usage** — Accept query parameters for period (Day/Week/Month), model filter, and API key ID filter. Query the `usage_monthly` table and apply filters. Aggregate results by year-month for the chart data. Return total input tokens, total output tokens, total requests, and chart data points.

- **Implement POST /dashboard/usage/export** — Accept a request to export usage data to CSV. Do not generate the CSV here — instead invoke Dev 2's `analytics-export-service` Lambda asynchronously and return an `exportId` and status `QUEUED` immediately. The frontend can poll for completion.

- **Implement GET /config/plans** — Query the `plan_catalog` DynamoDB table and return only records where `isPublic` is true. Return plan id, name, monthly fee, included token counts, and overage rates. This endpoint requires no authentication — it is public. The frontend pricing page should call this instead of using hardcoded values.

- **Implement GET /config/models** — Return the list of supported models with display name, provider, and tags. Initially this can be a hardcoded list inside the Lambda, but structured so it can later be moved to DynamoDB. No authentication required. The frontend docs and pricing pages should call this endpoint.

- **Wire to API Gateway** — Deploy both Lambdas and wire their routes in API Gateway. Dashboard routes require the Cognito authorizer. Config routes are public.

**Deliverable:** Dashboard overview and usage APIs return correct data from DynamoDB. Grace banner field is present in overview response. Config endpoints return plan list and model list. Frontend can consume these without hardcoding values.

---

## Day 6 — Go Lambda: Billing Service (Full Gap Closure)

**Topic:** Build the complete billing service including all features missing from the current Python backend.

**Description:**
The current Python billing dashboard returns basic data but is missing several fields required by the PDF plan: the current plan details, the exact days remaining in grace period, an invoice detail view, and a PDF download URL. All of these gaps are closed today.

**What to do:**

- **Set Up Go Lambda Project** — Create `lambda/billing-service/`. Reuse the internal billing package from Day 3.

- **Build the Billing State Machine in Go** — Port the full state machine from [app/billing_utils.py](file:///d:/Neurostack/neurorouter/app/billing_utils.py). The function takes a userId, reads all non-paid non-void invoices from DynamoDB, evaluates their due dates and grace period ends against the current time, determines the correct state (ACTIVE, GRACE, BLOCKED), updates the user's record in DynamoDB if the state has changed, and returns the new state. This is the same logic already in Python — just rewritten in Go and reading from DynamoDB instead of MongoDB.

- **Implement GET /billing/me** — Fetch the current month's invoice for the user. Fetch the user's plan from `plan_catalog`. Compute the live variable cost from current token usage. If the user is in GRACE status, compute the exact number of days remaining until the grace period ends. Return a full billing dashboard response including: current plan details, current month usage, fixed fee, estimated variable cost, total display, grace banner with exact days remaining, past invoice list, and account status.

- **Implement GET /billing/invoices/{invoiceId}** — This endpoint is new — it did not exist in the Python backend. Fetch a single invoice by its ID from DynamoDB. Verify the invoice belongs to the currently authenticated user. Return all invoice fields for a detail view or modal in the frontend.

- **Implement POST /billing/invoices/{invoiceId}/download** — This endpoint is new. Check whether the invoice already has a `pdfS3Key` stored. If it does, generate an S3 presigned URL for that key with a 15-minute expiry and return it. If it does not, first invoke Dev 2's `invoice-pdf-service` Lambda synchronously, wait for the result, and then generate the presigned URL. Return the download URL and expiry time to the frontend.

- **Wire to API Gateway** — Deploy the billing Lambda and attach it to all `/billing/*` routes with the Cognito authorizer.

**Deliverable:** Billing dashboard returns complete data including current plan, grace banner with exact days remaining, invoice detail endpoint works, PDF download URL endpoint works.

---

## Day 7 — Go Lambda: Admin Service + EventBridge Jobs

**Topic:** Build the complete admin backend including all flows that were missing or incomplete in the current system.

**Description:**
The admin panel currently has several disabled or unwired buttons: the reject button, the mark-unpaid button, the due date override, and the manual invoice generation. This day closes all of those gaps on the backend side. The EventBridge scheduled jobs are also wired to their Lambda targets today.

**What to do:**

- **Set Up Go Lambda Project** — Create `lambda/admin-service/`. All endpoints in this Lambda require the user to be in the Cognito [admin](file:///d:/Neurostack/neurorouter/app/auth.py#81-97) or `ops` group. Add a backend group check to every handler in addition to the Cognito authorizer.

- **Implement GET /admin/users** — List all users in the system. For each user, fetch their current month invoice, their plan from `plan_catalog`, compute costs, and return: userId, email, fullName, accountStatus, planId, plan name, masked API key reference, current month input tokens, current month output tokens, infrastructure fee, LLM usage cost, total bill, due date, and payment status. This is the main admin user queue.

- **Implement GET /admin/users/{userId}** — Return the full financial and usage detail for a single user. Same data as the list view but for one user.

- **Implement POST /admin/users/{userId}/approve** — Accept a Groq API key in the request body. Validate that key by making a request to the Groq models endpoint. If validation succeeds, store the key in Secrets Manager (not in DynamoDB plain text), set the user's status to ACTIVE, set their plan to `developer`, and move them to the `customer` Cognito group. Write an entry to `admin_audit_log`.

- **Implement POST /admin/users/{userId}/reject** — This is a new endpoint that did not exist in the Python backend. Accept a mandatory reason string. Set the user's `accountStatus` to REJECTED. Update their Cognito group. Write the reason and action to `admin_audit_log`. Write an entry to the user's `activity_log`.

- **Implement POST /admin/users/{userId}/status** — Force a status change to any AccountStatus value. Accept a reason. Use a separate `isManualBlock` flag on the user record to distinguish a deliberate admin security block from a billing-driven block. This means the daily enforcement job will not accidentally unblock a user that was manually blocked by an admin for a security reason. Write to `admin_audit_log`.

- **Implement GET /admin/users/{userId}/billing** — Same as the user-facing `GET /billing/me` but callable by admin for any user ID.

- **Implement PUT /admin/invoices/{invoiceId}** — Allow editing of invoice [status](file:///d:/Neurostack/neurorouter/app/routers/billing.py#379-409), `dueDate`, and `gracePeriodEnd`. After any edit, re-run the billing state machine for the affected user immediately so their account status reflects the change in real time. Write all changes to `admin_audit_log`.

- **Implement POST /admin/invoices/{invoiceId}/pay** — Mark an invoice as PAID. Set payment details including who marked it and when. Set the user's status to ACTIVE. Re-enable all API keys belonging to this user by setting `isActive: true`. Write to `admin_audit_log`.

- **Implement POST /admin/invoices/{invoiceId}/unpay** — This is a new endpoint. Mark a PAID invoice back to PENDING. Re-run the billing state machine immediately so the user's status is recalculated. Write to `admin_audit_log`.

- **Implement POST /admin/users/{userId}/invoice** — Manually generate an invoice for a specific user and month. Check for an existing record and handle it appropriately. Write to `admin_audit_log`.

- **Implement GET /admin/invoices/{invoiceId}/pdf** — Trigger Dev 2's `invoice-pdf-service` Lambda and return a presigned S3 URL for the generated PDF.

- **Implement GET /admin/audit-logs** — Query the `admin_audit_log` table with optional filters by target user ID or action type.

- **Build the Daily Enforcement Go Lambda** — Create a separate Lambda that scans all users and runs the billing state machine for each one. This is the Go port of [app/jobs/daily_enforcement.py](file:///d:/Neurostack/neurorouter/app/jobs/daily_enforcement.py). Wire it to the EventBridge daily schedule rule created on Day 1.

- **Wire EventBridge Monthly Job** — Update the EventBridge monthly invoice schedule rule (created on Day 1) to target Dev 2's `monthly-invoice-job` Lambda. Coordinate with Dev 2 to get the Lambda ARN.

**Deliverable:** All admin endpoints live. Reject, unpaid, due-date override all working. Daily enforcement job running on EventBridge. Monthly invoice job scheduled.

---

## Day 8 — Frontend Integration: AWS APIs + UI Gap Closure

**Topic:** Update the Next.js frontend to call the new AWS APIs and wire all previously disabled or missing UI elements.

**Description:**
The frontend currently points to the Python backend on Render. Today it is switched to point to API Gateway. The Cognito token flow replaces the custom JWT flow. All disabled admin buttons are wired to the new admin endpoints. The billing dashboard is updated to show the new fields.

**What to do:**

- **Update API Base URL** — Add an environment variable `NEXT_PUBLIC_API_URL` pointing to the API Gateway production URL. Update all service files in `neurostack-web/src/services/` to use this variable as the base URL.

- **Update Auth Flow for Cognito** — The response from `/auth/login` is the same shape as before (access_token, token_type, expires_in) so token storage does not change. Add a call to `/auth/me` on application load to get the current user's profile including plan and account status. Add a call to `/auth/refresh` to handle token expiry silently.

- **Update Dashboard to Use New Fields** — The `GET /dashboard/overview` response now includes a `graceBanner` object. Add a banner component to the dashboard that shows when `graceBanner.show` is true. Display the exact number of days remaining from `graceBanner.daysRemaining`. Display the billing message from `graceBanner.billingMessage`.

- **Update Billing Page** — Add an invoice detail view or modal that opens when the user clicks on a past invoice. Call `GET /billing/invoices/{id}` to populate it. Add a Download PDF button that calls `POST /billing/invoices/{id}/download` and opens the presigned URL in a new tab. Show the current plan name prominently — get it from the `currentPlan` field now returned by `GET /billing/me`.

- **Wire Admin Reject Button** — Add a Reject button on the admin user approval queue. When clicked, show a modal asking for a mandatory reason. On confirm, call `POST /admin/users/{id}/reject` with the reason.

- **Wire Mark Invoice Unpaid Button** — Add a "Mark Unpaid" button next to the existing "Mark Paid" button on each invoice in the admin view. On click, call `POST /admin/invoices/{id}/unpay`.

- **Wire Due Date Override** — The due date edit button is currently disabled in the admin invoice detail view. Enable it and wire it to `PUT /admin/invoices/{id}` with the new due date value.

- **Wire Grace Period Override** — Same as due date — enable the grace period date picker and wire it to `PUT /admin/invoices/{id}`.

- **Show Masked API Key Reference in Admin** — In the admin user detail view, show the `maskedReference` field from the `GET /admin/users/{id}` response so admins can identify which key belongs to which user.

- **Wire Manual Invoice Generation** — Wire the admin "Generate Invoice" button to `POST /admin/users/{id}/invoice`.

- **Replace Hardcoded Plan Data** — Update the pricing page to call `GET /config/plans` instead of using hardcoded plan values. Update the plan badge or label in the dashboard and billing views to use the plan name returned by the backend.

- **Replace Hardcoded Model List** — Update the docs page and any model selector components to call `GET /config/models` instead of using a static list.

- **Normalize Product Naming** — Search the entire `neurostack-web/src/` directory for instances of "NeuroStack" as a product name and replace them with "NeuroRouter". Update page titles, meta descriptions, heading text, and invoice PDF copy.

- **Secure Admin Surface** — Ensure all `/ops-panel/*` routes in the Next.js router require the user to be in the `admin` Cognito group. Remove any links to the admin panel from public navigation. Add an environment variable `NEXT_PUBLIC_ADMIN_DOMAIN` for future separation to a dedicated subdomain.

**Deliverable:** Frontend points to AWS APIs. Cognito auth works. Grace banner displayed with days remaining. Admin buttons wired. Plan and model data from backend. NeuroRouter naming consistent throughout.

---

## Day 9 — Testing, Hardening + Production Deployment

**Topic:** Validate the entire system end to end, harden security and performance, and deploy to production.

**Description:**
No new features today. This day is for ensuring everything works together correctly, catching edge cases in billing logic, tuning Lambda performance, and making the final production deployment.

**What to do:**

- **Write Unit Tests for Billing State Machine** — Test every state transition: user with no invoices stays ACTIVE, user past due date moves to GRACE, user past grace period moves to BLOCKED, admin marks invoice paid and user goes to ACTIVE, admin marks invoice unpaid and user goes back to GRACE or BLOCKED.

- **Write Unit Tests for Auth Logic** — Test token parsing from Cognito JWT claims, error handling for expired tokens, and account status checks during login.

- **Write Unit Tests for API Key Logic** — Test key generation format, SHA-256 hashing, duplicate detection, and masked reference generation.

- **Write Integration Tests — Auth Flow** — Register a new user and verify a DynamoDB row is created with PENDING_APPROVAL. Log in and verify a valid Cognito access token is returned. Call `/auth/me` and verify profile data is correct.

- **Write Integration Tests — API Key and Authorizer** — Create an API key and verify it is stored hashed. Call a `/v1/*` route with the key and verify the authorizer allows it. Call with an invalid key and verify it is denied. Block a user's account and verify their key is denied.

- **Write Integration Tests — Billing Flow** — Approve a user and verify status changes to ACTIVE. Pass the invoice due date and verify user moves to GRACE. Pass the grace period end and verify user moves to BLOCKED. Mark invoice paid and verify user returns to ACTIVE and all API keys are re-enabled. Mark invoice unpaid and verify enforcement re-runs.

- **Write Integration Tests — Admin Flow** — Reject a user and verify status is REJECTED and reason is in audit log. Override a due date and verify the change is reflected in the user's billing dashboard. Generate an invoice manually and verify it appears in the invoice list.

- **Validate Lambda Cold Starts** — Test Go Lambda cold start times. Auth service and authorizer cold starts should be well under 200ms due to Go's fast startup. If they are slow, check for unnecessary initialization in the package-level code.

- **Set Lambda Memory Appropriately** — Set all Go Lambdas to 256MB. Go is memory-efficient and does not need 1GB allocations. Review CloudWatch metrics after initial test traffic to confirm.

- **Run Final Branding Check** — Grep the entire `neurostack-web/src/` directory one more time for "NeuroStack" as a product name to catch any missed instances.

- **Validate Admin Surface Security** — Confirm that accessing any `/ops-panel/*` route without an admin Cognito group token returns a 403. Confirm there are no public navigation links to the admin panel.

- **Deploy to Production** — Run `cdk deploy --context env=prod` to create or update the production AWS environment. Update Vercel environment variables to point to the production API Gateway URL and production Cognito pool details.

- **Freeze MongoDB and Run Final Delta Migration** — Stop all writes to the MongoDB instance. Run the migration scripts one more time in delta mode to capture any records created since Day 2. Verify final row counts match. After validation, decommission the Python FastAPI backend on Render (or keep it in read-only mode for 7 days as a safety net).

- **Verify Production End to End** — Test the full user journey in production: register, wait for approval, approve via admin panel, create API key, make an inference request, view usage in dashboard, view billing invoice, download PDF.

**Deliverable:** All tests passing. Production AWS stack deployed. Vercel frontend pointed to production APIs. MongoDB writes frozen. Python backend decommissioned or in standby. System fully running on Go + Python + AWS.

---

## Dev 1 Summary by Day

| Day | Topic | Status |
|-----|-------|--------|
| 1 | AWS infrastructure: CDK, DynamoDB, Cognito, API Gateway, S3, EventBridge | New setup |
| 2 | MongoDB to DynamoDB migration + Cognito user backfill | Migration |
| 3 | Go auth-service Lambda: register, login, Google, me, logout, refresh | Port + New |
| 4 | Go api-key-service + request authorizer Lambda | Port + New |
| 5 | Go dashboard-service + config-service Lambdas | Port + New |
| 6 | Go billing-service Lambda: full state machine + invoice detail + PDF download URL | Port + New |
| 7 | Go admin-service Lambda: reject, unpaid, due-date override + EventBridge jobs | Port + New |
| 8 | Frontend integration: AWS APIs, grace banner, admin buttons wired, branding | New + Fix |
| 9 | Tests, hardening, production deploy, MongoDB decommission | Validation |
