# Plan: Python → Go Lambda Migration (3 Services)

## Context

The NeuroRouter inference path has ~800ms Python cold starts on the **hottest Lambda** (router-service, invoked on every request). The optimization plan calls for moving 3 Python services to Go to achieve 27x faster cold starts, 6.7x lower warm latency, and 90% cost reduction on the router Lambda. None of the 3 Go replacements have been started yet.

## Current State

| Service | Language | Go Replacement | Status |
|---------|----------|---------------|--------|
| router-service (non-streaming) | Python (461 lines) | Needs creation | **NOT STARTED** |
| monthly-invoice-job | Python (431 lines) | Needs creation | **NOT STARTED** |
| analytics-export-service | Python (242 lines) | Needs creation | **NOT STARTED** |
| streaming-handler | Python | Stays Python | OK |
| invoice-pdf-service | Python | Stays Python | OK |

---

## Phase 1: Go Router Service (HIGHEST ROI)

**Create:** `lambda/go/router-service/`

### Files to create:

1. **`main.go`** (~250 lines) — Lambda handler + route dispatch
   - Routes: `POST /v1/chat/completions`, `POST /v1/completions`, `GET /v1/models`, `OPTIONS *`
   - Extract auth context from `req.RequestContext.Authorizer` (userId, apiKeyId, planId, accountStatus)
   - Parse JSON body, validate model field
   - Call GroqClient, record usage async, return response
   - Retry logic: 3 attempts with 2^n second backoff for 429/503

2. **`groq_client.go`** (~80 lines) — HTTP proxy to Groq
   - Port from `providers/groq_adapter.py` (271 lines → ~80 Go)
   - Endpoint: `https://api.groq.com/openai/v1/chat/completions`
   - Force model to `llama-3.3-70b-versatile`
   - Headers: `Authorization: Bearer {key}`, `Content-Type: application/json`
   - Parse response, extract usage block

3. **`secrets.go`** (~40 lines) — Secrets Manager with in-memory cache
   - Port from `secrets_client.py` (129 lines → ~40 Go)
   - Global `sync.Once` or mutex-guarded map
   - Env var: `GROQ_SECRET_NAME`, fallback `GROQ_API_KEY`

4. **`usage.go`** (~80 lines) — Async DynamoDB usage recording
   - Port from `usage.py` (276 lines → ~80 Go)
   - Write to `usage_events` table (PutItem with ConditionExpression for idempotency)
   - Atomic increment `usage_monthly` table (UpdateItem with ADD)
   - Composite sort key: `"YYYY-MM#MODEL#{model}#KEY#{keyId}"`
   - **Fire-and-forget goroutine** — return Groq response before usage write completes
   - Use `context.WithTimeout` (5s) to ensure writes complete before Lambda freeze

5. **`model_catalog.go`** (~50 lines) — Static model list
   - Port from `model_catalog.py` (142 lines → ~50 Go)
   - Hardcoded 5 models, return OpenAI `/v1/models` format

6. **`models.go`** (~40 lines) — Request/response structs
   - `ChatRequest`, `ChatResponse`, `Usage`, `Choice`, `Message`

7. **`go.mod`** + **`go.sum`** — Dependencies
   - aws-lambda-go, aws-sdk-go-v2 (config, dynamodb, secretsmanager)
   - Match exact versions from existing services (go 1.24, lambda-go v1.54.0)

8. **`deploy.sh`** — Standard deploy script (identical pattern to other services)

### Key implementation details:
- Follow existing Go patterns: global `ddbClient`, `initClients()`, `envOr()`, `jsonResp()`/`corsResp()`/`serverError()`
- DynamoDB tables: `usage_events` (PK: userId, SK: timestamp), `usage_monthly` (PK: user_id, SK: composite)
- Env vars: `GROQ_SECRET_NAME`, `TABLE_USAGE_EVENTS`, `TABLE_USAGE_MONTHLY`

---

## Phase 2: Go Monthly Invoice Job (MEDIUM ROI)

**Create:** `lambda/go/monthly-invoice-job/`

### Files to create:

1. **`main.go`** (~120 lines) — Lambda handler (EventBridge trigger)
   - Accept `{"yearMonth": "YYYY-MM"}` or auto-calculate previous month
   - Call `generateInvoices()`, return counts {generated, skipped, errors}
   - Handler signature: `func handler(ctx context.Context, event json.RawMessage)`

2. **`billing.go`** (~200 lines) — Core invoice generation with goroutines
   - Port from `billing_job.py` (360 lines → ~200 Go)
   - Scan users table (ACTIVE/GRACE filter, handle pagination)
   - **Bounded goroutine pool** (10 workers via semaphore channel)
   - Per-user: query plan_catalog → aggregate usage_monthly → calculate costs → create/update invoice → write audit log
   - Cost calculation: free tier deduction, variable USD cost, fixed INR fee
   - Invoice ID: `inv_{uuid}`, number: `INV-{yearMonth}-{userId[:8]}`
   - Due date: 5th of next month, grace period: 10th of next month

3. **`models.go`** (~60 lines) — Structs
   - `Invoice`, `Plan`, `User`, `SnapshotData`, `CalculatedCosts`, `AuditEntry`

4. **`go.mod`** + **`go.sum`** + **`deploy.sh`**

### Key implementation details:
- DynamoDB tables: `users`, `invoices`, `usage_monthly`, `plan_catalog`, `admin_audit_log`
- GSI: `userId-yearMonth-index` on invoices table
- Use `float64` for cost calculations (matching existing Go billing-service pattern)
- Concurrent processing: `sync.WaitGroup` + buffered channel semaphore
- Per-user error isolation (one failure doesn't stop the batch)

---

## Phase 3: Go Analytics Export (LOWER ROI)

**Create:** `lambda/go/analytics-export-service/`

### Files to create:

1. **`main.go`** (~60 lines) — Lambda handler
   - Accept `{userId, exportId, yearMonth?}` from async invocation
   - Validate required fields, call exporter, return S3 location

2. **`exporter.go`** (~100 lines) — CSV generation + S3 upload
   - Port from `exporter.py` (145 lines → ~100 Go)
   - Query `usage_monthly` table (with optional `begins_with(yearMonth)` filter)
   - Parse composite sort key: `"YYYY-MM#MODEL#{model}#KEY#{keyId}"`
   - Generate CSV with `encoding/csv` to `bytes.Buffer`
   - Columns: yearMonth, model, apiKeyId, inputTokens, outputTokens, totalTokens, requestCount, updatedAt
   - Upload to S3: `exports/{exportId}.csv`, Content-Type: `text/csv`

3. **`go.mod`** + **`go.sum`** + **`deploy.sh`**

### Key implementation details:
- DynamoDB table: `usage_monthly` (PK: userId, SK: composite)
- S3 bucket: `EXPORT_BUCKET` env var
- Handle pagination on DynamoDB query
- AWS SDK v2 S3 client for PutObject

---

## Phase 4: CDK Infrastructure Updates

**Modify:** `infra/lib/infra-stack.ts`

Changes needed:
1. Add 3 new Go Lambda function definitions (router-service, monthly-invoice-job, analytics-export)
2. Point non-streaming `/v1/chat/completions` route to Go router Lambda
3. Point EventBridge monthly rule to Go monthly-invoice-job Lambda
4. Update dashboard-service async invocation target to Go analytics-export Lambda
5. Grant DynamoDB/S3/SecretsManager permissions to new Go Lambdas
6. Set memory to 128MB (down from 256MB) for Go Lambdas
7. Optionally add provisioned concurrency (1) to Python streaming Lambda

---


## Implementation Order & Estimated Effort

| Phase | Service | Priority | Est. Lines of Go |
|-------|---------|----------|-----------------|
| 1 | router-service | CRITICAL (every request) | ~540 lines |
| 2 | monthly-invoice-job | MEDIUM (monthly batch) | ~380 lines |
| 3 | analytics-export-service | LOWER (on-demand) | ~160 lines |
| 4 | CDK updates | Required for deployment | ~100 lines TS |

**Total new Go code:** ~1,080 lines + CDK changes
**Python code replaced:** ~1,134 lines (stays in repo for streaming + reference)
