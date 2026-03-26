# 🧑‍💻 Developer 2 — Python AI Plane + Lambda
## NeuroRouter AWS Migration — 9-Day Plan (No Code, Tasks Only)

> **Stack:** Python · AWS Lambda · API Gateway (REST, streaming) · DynamoDB · S3 · Secrets Manager · EventBridge
> **Owns:** All Python Lambda functions — inference routing, provider adapters, streaming SSE, usage recording, invoice PDF generation, CSV export, monthly invoice batch job
> **Does NOT touch:** Go code, CDK infra, DynamoDB table schemas, Cognito configuration

---

## What You Read From DynamoDB (Defined by Dev 1 on Day 1)

Dev 1 will share the exact table schemas after Day 1 deployment. Key tables you interact with:

| Table | Your Access | Purpose |
|-------|-------------|---------|
| [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) | Read only | Get user plan, account status, Groq API key reference |
| [api_keys](file:///d:/Neurostack/neurorouter/app/routers/auth_routes.py#152-174) | Never directly | Authorizer (Dev 1's Go Lambda) reads this and injects context for you |
| `usage_events` | Write only | One record per completed inference request |
| `usage_monthly` | Read + Write | Incremental token count aggregates per user/month/model/key |
| [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) | Read + Write | Monthly job reads pending invoices, writes finalized snapshots |
| `plan_catalog` | Read only | Get billing rates for invoice calculation |
| `admin_audit_log` | Write only | Monthly job audit entries |

## What the Authorizer Gives You

When your Lambda handles any `/v1/*` request, Dev 1's Go authorizer has already validated the API key. It injects the following values into the API Gateway request context that you can read directly in your Lambda event — you do not need to make any additional database calls to get these:

- `userId` — the authenticated user's ID
- `apiKeyId` — the API key that was used
- `planId` — the user's current plan (free or developer)
- `accountStatus` — ACTIVE or GRACE (BLOCKED users are already denied before reaching you)

---

## Day 1 — Python Lambda Project Setup + Provider Adapter Foundation

**Topic:** Establish the full Python Lambda project structure, abstract the provider interface, and get a deployable base Lambda running in AWS.

**Description:**
Everything you build for the next 8 days lives inside this project structure. Setting it up correctly now — with a clean separation between Lambda handlers, provider adapters, DynamoDB helpers, and Secrets Manager access — means each day's work slots in without restructuring. The provider adapter pattern is critical: it means adding a new AI provider (OpenAI, Anthropic) in the future requires zero changes to the Lambda handler logic.

**What to do:**

- **Create the Python Lambda folder structure** — Under a `lambda/python/` directory, create separate sub-folders for each Lambda: `router-service`, `invoice-pdf-service`, `analytics-export-service`, and `monthly-invoice-job`. Each sub-folder is its own independently deployable unit with its own `handler.py`, [requirements.txt](file:///d:/Neurostack/neurorouter/requirements.txt), and helper modules.

- **Define the Provider Adapter Interface** — In `router-service/`, create a `provider_adapter.py` file that defines an abstract base class. This class defines the interface that every AI provider adapter must implement: a method for chat completions (both streaming and non-streaming), a method for listing models, and a method for extracting token usage from a response. Every provider adapter you write must inherit from this class.

- **Implement the Groq Adapter** — Create `router-service/providers/groq_adapter.py`. This is a concrete implementation of the provider adapter that talks to Groq's OpenAI-compatible API. Port the logic directly from [app/proxy.py](file:///d:/Neurostack/neurorouter/app/proxy.py) — specifically the [groq_headers()](file:///d:/Neurostack/neurorouter/app/proxy.py#13-20), [build_groq_payload()](file:///d:/Neurostack/neurorouter/app/proxy.py#22-30), [forward_to_groq()](file:///d:/Neurostack/neurorouter/app/proxy.py#67-108), and [stream_sse()](file:///d:/Neurostack/neurorouter/app/proxy.py#32-65) functions. The adapter must handle both streaming and non-streaming requests, and must build the correct Groq payload by forcing the model to `llama-3.3-70b-versatile` as the current backend does.

- **Create a Stub OpenAI Adapter** — Create `router-service/providers/openai_adapter.py` as a stub that inherits the interface. It does not need to work yet — just define the class and its methods with `NotImplementedError`. This is the extensibility point for later.

- **Create the DynamoDB Helper Module** — Create `router-service/dynamo_client.py`. This module provides a clean way to get a boto3 DynamoDB table resource by table name. It reads table names from Lambda environment variables so the same code works across dev, staging, and prod environments without any changes.

- **Create the Secrets Manager Helper Module** — Create `router-service/secrets_client.py`. This module provides a function to retrieve a secret value from AWS Secrets Manager by secret name. It must cache the result in memory so that subsequent calls within the same Lambda invocation do not make repeated API calls. Use it to fetch the Groq API key instead of reading from an environment variable directly.

- **Create a Model Catalog Module** — Create `router-service/model_catalog.py`. This holds the list of supported models as a structured data object. For now it is a hardcoded list — it will be consumed by the `/v1/models` handler on Day 5. Each model entry should include a model ID, display name, provider name, and tags.

- **Write the Deployment Script** — Create a `deploy.sh` script inside each Lambda sub-folder. The script should install dependencies into a build directory, copy the Python files, zip everything, and upload to the corresponding Lambda function using the AWS CLI. This replaces any need for a complex CI pipeline for now.

- **Deploy the Base Lambda** — Deploy the `router-service` handler with a placeholder response to AWS Lambda. Coordinate with Dev 1 to confirm the Lambda ARN so they can wire the API Gateway integration for the `/v1/*` routes.

**Deliverable:** Project structure created. GroqAdapter and provider interface implemented. DynamoDB and Secrets Manager helpers ready. Base Lambda deployed as a placeholder. Lambda ARN shared with Dev 1.

---

## Day 2 — router-service: Non-Streaming Completions + Usage Recording

**Topic:** Implement the non-streaming inference path and write usage data to DynamoDB.

**Description:**
This is the core of what NeuroRouter does: accept an OpenAI-compatible request, forward it to Groq, return the response, and record how many tokens were used. The current Python backend does this in [app/routers/openai_proxy.py](file:///d:/Neurostack/neurorouter/app/routers/openai_proxy.py) and [app/proxy.py](file:///d:/Neurostack/neurorouter/app/proxy.py). Today you port that logic into the Lambda handler and replace MongoDB/Beanie with DynamoDB/boto3.

**What to do:**

- **Create the Usage Recording Module** — Create `router-service/usage.py`. This module provides two functions. The first writes a single raw usage event to the `usage_events` DynamoDB table — one record per completed inference request. The second function atomically increments the token counts in the `usage_monthly` table for the correct user/month/model/key combination. Both functions must read the user ID, API key ID, and model from parameters passed in, not from any global state.

- **Understand the usage_monthly Table Key Format** — The sort key for the `usage_monthly` table is a composite string in the format `YYYY-MM#MODEL#{modelName}#KEY#{apiKeyId}`. Dev 1 defined this on Day 1. You must construct the sort key in exactly this format when writing or querying aggregates.

- **Implement the Non-Streaming Chat Completions Handler** — In `handler.py`, implement the logic for `POST /v1/chat/completions` when [stream](file:///d:/Neurostack/neurorouter/app/proxy.py#32-65) is false in the request body. The handler must: read the userId, apiKeyId, and planId from the authorizer context (injected by Dev 1's Go authorizer), parse the request body, get the Groq API key from Secrets Manager, call the GroqAdapter with the payload in non-streaming mode, extract the usage block from the response (prompt_tokens and completion_tokens), call the usage module to write the event and update the aggregate, and return the response to the caller in the same JSON format Groq sends it.

- **Implement the Non-Streaming Completions Handler** — The `POST /v1/completions` endpoint does the same thing as chat completions. Per the existing Python backend logic, it routes through chat/completions internally. Implement it as an alias.

- **Implement the Route Dispatcher** — At the top of `handler.py`, add the main `handler(event, context)` function that reads the HTTP method and path from the API Gateway event and routes to the correct handler function.

- **Handle Errors Correctly** — Wrap the Groq API call in error handling. If Groq returns a 4xx or 5xx, pass through the same status code and error body to the caller. If there is a network error connecting to Groq, return a 502 Bad Gateway.

- **Test the Non-Streaming Path Locally** — Before deploying, write a simple test script that constructs a fake API Gateway event (with fake authorizer context) and calls the handler function directly. Verify the response matches an expected OpenAI-compatible completion response.

- **Deploy and Test in AWS** — Deploy the updated Lambda. Use the AWS CLI to invoke it with a test payload. Check that the response is correct and that records appear in the `usage_events` and `usage_monthly` DynamoDB tables in the AWS console.

**Deliverable:** Non-streaming `POST /v1/chat/completions` and `POST /v1/completions` work end to end. Usage is written to DynamoDB. Verified by direct Lambda invocation.

---

## Day 3 — router-service: Streaming Completions

**Topic:** Implement the streaming inference path using AWS Lambda response streaming.

**Description:**
Streaming is the most technically complex part of your work. The current Python backend uses FastAPI's `StreamingResponse` to stream SSE chunks from Groq to the client. In AWS Lambda, streaming works differently — you need to use Lambda's response streaming mode, which was made available for REST API Gateway in November 2025. Work with Dev 1 to ensure the Lambda is configured with `InvokeMode: RESPONSE_STREAM` in CDK today.

**What to do:**

- **Coordinate Lambda Streaming Config with Dev 1** — Send Dev 1 the Lambda ARN for the streaming-capable Lambda. They need to set `InvokeMode: RESPONSE_STREAM` on the API Gateway integration for the `/v1/chat/completions` and `/v1/completions` routes in CDK. This must be done today before you can test streaming end to end.

- **Understand Lambda Response Streaming** — Research how Lambda response streaming works with the `awslambdaric` package and the `streamifyResponse`/`HttpResponseStream` wrapper. The key difference from a regular Lambda is that instead of returning a response dict at the end, you write bytes to a response stream object progressively and close it when done.

- **Implement the Streaming Chat Completions Handler** — Create a separate streaming handler entry point. This handler must: read authorizer context from the event, parse the request body, get the Groq API key from Secrets Manager, call the GroqAdapter in streaming mode to get a live httpx response object back, set the correct SSE response headers (Content-Type: text/event-stream, Cache-Control: no-cache), iterate over the streaming lines from Groq using async iteration, write each line to the response stream as it arrives, detect and capture the final usage block from the SSE stream (the usage data appears in the last non-DONE chunk or in the DONE event), after the stream closes call the usage module to record the event and update the aggregate, close the response stream.

- **Handle Per-User Groq API Keys in Streaming** — The current Python backend resolves `user.groq_cloud_api_key or settings.groq_api_key`. In your Lambda, the per-user Groq key is stored in Secrets Manager. Fetch it by a user-specific secret name. If it does not exist, fall back to the default Groq key from Secrets Manager.

- **Handle Streaming Errors** — If Groq returns an error status on the streaming response, read the full error body, close the stream cleanly, and return an appropriate error to the caller.

- **Test Streaming Locally** — Write a test that calls the streaming handler with a fake event and streams the output to stdout. Verify you can see SSE chunks being emitted progressively.

- **Test Streaming End to End via API Gateway** — Use curl with the `-N` flag (no buffering) to call the production `/v1/chat/completions` endpoint with `"stream": true` in the body. Verify chunks arrive progressively in real time. After the stream ends, check DynamoDB to confirm usage was recorded.

- **Handle the case where stream=true reaches the non-streaming handler** — If the streaming Lambda configuration is not yet in place, your non-streaming handler will receive a request with `stream: true`. Return a clear error response in this case so the issue is obvious during debugging.

**Deliverable:** Streaming `POST /v1/chat/completions` sends chunked SSE responses to the caller in real time. Usage is recorded in DynamoDB after stream completes. Verified via curl and DynamoDB console.

---

## Day 4 — invoice-pdf-service Lambda

**Topic:** Build a standalone Lambda that generates invoice PDFs and stores them in S3.

**Description:**
The current Python backend generates invoice PDFs in [app/billing_utils.py](file:///d:/Neurostack/neurorouter/app/billing_utils.py) using the reportlab library and returns them as a streaming response. In the AWS architecture, PDFs must be stored in S3 and returned to the caller as a presigned download URL. Today you port the PDF generation and change the delivery mechanism to S3 + presigned URL.

**What to do:**

- **Create the invoice-pdf-service Lambda** — Set up `lambda/python/invoice-pdf-service/` with its own handler and requirements. The only dependency needed beyond boto3 is `reportlab`.

- **Port the PDF Generation Logic** — Copy and adapt [generate_invoice_pdf()](file:///d:/Neurostack/neurorouter/app/billing_utils.py#147-222) from [app/billing_utils.py](file:///d:/Neurostack/neurorouter/app/billing_utils.py). The function receives an invoice record and a user record and produces a PDF buffer. Update it to read from a DynamoDB-shaped invoice dict instead of the Beanie model. Update the header to say "NeuroRouter Invoice" instead of "NeuroStack Invoice". Add a new line for the plan name. Keep all other content and formatting identical.

- **Implement the Lambda Handler** — The handler receives an event containing an `invoiceId` and `userId`. It must: look up the invoice in the DynamoDB [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) table by invoiceId, look up the user in the DynamoDB [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table by userId, call the PDF generation function with both records, upload the resulting PDF buffer to S3 using the key naming convention `invoices/{invoiceId}.pdf`, update the invoice record in DynamoDB to store the `pdfS3Key` so future requests do not regenerate the PDF unnecessarily, and return the S3 key and bucket name to the caller.

- **Make the Handler Idempotent** — Before generating a new PDF, check whether `pdfS3Key` already exists on the invoice record. If it does, skip generation and just return the existing key. This prevents unnecessary regeneration when Dev 1's billing-service calls this Lambda multiple times for the same invoice.

- **Share the Lambda ARN with Dev 1** — After deployment, share the Lambda ARN with Dev 1 so they can wire the synchronous call from their billing-service and admin-service Lambdas on Day 6 and Day 7.

- **Test Manually** — Invoke the Lambda using the AWS CLI with a real invoice ID and user ID from the DynamoDB migration. Verify a PDF file appears in the S3 bucket at `invoices/{invoiceId}.pdf`. Open the PDF and confirm the content is correct.

**Deliverable:** `invoice-pdf-service` Lambda deployed. Calling it with an invoice ID generates a NeuroRouter-branded PDF, stores it in S3, and returns the S3 key. Lambda ARN shared with Dev 1.

---

## Day 5 — analytics-export-service Lambda + Model Catalog

**Topic:** Build the CSV analytics export Lambda and integrate the model catalog into the router.

**Description:**
The current dashboard has a placeholder for web search count that always returns zero. This day replaces it with a real feature: users can export their usage data as a CSV. Additionally, the `/v1/models` endpoint currently forwards to Groq, which means it always returns Groq's full model list including models not supported by NeuroRouter. Today you make it return only the officially supported models from your own catalog.

**What to do:**

- **Create the analytics-export-service Lambda** — Set up `lambda/python/analytics-export-service/` with its own handler and requirements. No special dependencies needed beyond boto3.

- **Implement the CSV Generation Logic** — Create `analytics-export-service/exporter.py`. This module takes a `userId` and optional `yearMonth` filter. It queries the `usage_monthly` DynamoDB table for all matching records. It writes the results to a CSV with columns: yearMonth, model, apiKeyId, inputTokens, outputTokens, totalTokens, requestCount, updatedAt. It returns a bytes buffer containing the CSV content.

- **Implement the analytics-export-service Handler** — The handler receives an event containing a `userId`, optional `yearMonth`, and an `exportId`. It calls the CSV generation logic, uploads the result to S3 under the key `exports/{exportId}.csv`, and returns the S3 key, bucket name, and status `DONE` to the caller.

- **Coordinate Export Triggering with Dev 1** — Dev 1's dashboard-service Lambda will trigger your analytics-export-service Lambda asynchronously when the user clicks "Export". Share the Lambda ARN with Dev 1 today.

- **Update the /v1/models Handler to Use Internal Catalog** — Currently the models handler forwards the request to Groq's models endpoint and returns whatever Groq says. Change this to call `get_model_list_response()` from your `model_catalog.py` module instead. This returns only the officially supported models in the OpenAI-compatible format. This prevents exposing unsupported models to users.

- **Remove the Web Searches Placeholder** — The current Python dashboard returns `total_web_searches: 0` as a placeholder. This field does not exist in the new DynamoDB schema. This endpoint is owned by Dev 1 (dashboard-service), but flag this to Dev 1 so they know to remove the field entirely from the response.

- **Test Export Lambda Manually** — Invoke the analytics-export-service Lambda via AWS CLI with a real user ID. Verify a CSV file appears in S3 at `exports/{exportId}.csv`. Download and open the file to confirm the data is correct.

- **Test Model Catalog Endpoint** — Call `GET /v1/models` through API Gateway with a valid API key. Verify the response contains only the models from your catalog and not the full Groq model list.

**Deliverable:** `analytics-export-service` Lambda deployed and tested. `/v1/models` returns internal model catalog. Lambda ARN shared with Dev 1.

---

## Day 6 — monthly-invoice-job Lambda

**Topic:** Port the monthly invoice batch job to a standalone Lambda that runs automatically on the 1st of every month.

**Description:**
The current monthly billing job lives in [app/jobs/monthly_billing.py](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py) and is run manually or scheduled externally. In the AWS architecture it becomes an EventBridge-triggered Lambda. Today you port all the billing logic, shift from MongoDB to DynamoDB, and coordinate with Dev 1 to wire the EventBridge schedule target.

**What to do:**

- **Create the monthly-invoice-job Lambda** — Set up `lambda/python/monthly-invoice-job/` with its own handler and requirements.

- **Port the Invoice Generation Logic** — Create `monthly-invoice-job/billing_job.py`. This is a direct port of [app/jobs/monthly_billing.py](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py) with MongoDB/Beanie replaced by DynamoDB/boto3. The core logic remains identical:
  - Determine the target month from the event or default to the previous month
  - Compute the due date as the 5th of the month following the billing cycle
  - Compute the grace period end as 5 days after the due date
  - Scan the [users](file:///d:/Neurostack/neurorouter/app/routers/billing.py#204-249) table for all users whose status is ACTIVE or GRACE
  - For each user, check whether an invoice already exists for the target month in the [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) table
  - If a PENDING invoice exists, finalize it by recalculating costs from the stored token snapshot, updating the due date, grace period, and plan rates, and saving it
  - If no invoice exists, aggregate the user's token usage from the `usage_monthly` table for the target month, calculate the variable cost, create a new invoice record with all required fields, and write it to the [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) table
  - Write an entry to `admin_audit_log` for every invoice processed

- **Port the Cost Calculation Logic** — Port the [calculate_variable_cost()](file:///d:/Neurostack/neurorouter/app/billing_utils.py#14-26) function from [app/billing_utils.py](file:///d:/Neurostack/neurorouter/app/billing_utils.py). This function deducts 1 million free tokens from both input and output counts before applying the overage rates. Rates must be read from the plan's record in the `plan_catalog` DynamoDB table, not hardcoded.

- **Handle Pagination for Large User Sets** — The DynamoDB scan for users may return results in pages if there are many users. Handle `LastEvaluatedKey` pagination so all users are processed even if there are more than one page of results.

- **Implement the Lambda Handler** — The handler reads an optional `yearMonth` override from the event. If not provided, it calculates the previous month as the target. It calls the billing job logic and returns the generated and skipped counts.

- **Coordinate EventBridge Wiring with Dev 1** — Share the Lambda ARN with Dev 1. They will wire the EventBridge monthly schedule rule (created on Day 1) to target this Lambda. The schedule is: the 1st of every month at 01:00 UTC.

- **Test the Lambda Manually** — Invoke the Lambda via AWS CLI with a specific `yearMonth` value pointing to a past month with known usage data. Verify invoice records appear in the DynamoDB [invoices](file:///d:/Neurostack/neurorouter/app/jobs/monthly_billing.py#14-141) table with correct token counts, cost calculations, due dates, and grace period ends. Verify audit log entries were written.

**Deliverable:** `monthly-invoice-job` Lambda deployed. Tested manually with real data. Invoice records created correctly in DynamoDB. Lambda ARN shared with Dev 1 for EventBridge wiring.

---

## Day 7 — Full Integration Testing

**Topic:** Test all Python Lambdas working together with the full AWS stack and verify the authorizer context flows correctly.

**Description:**
Until today, most testing has been isolated — invoking Lambdas directly via the AWS CLI bypassing API Gateway and the authorizer. Today you test the full path: real API keys created by Dev 1's api-key-service, validated by Dev 1's authorizer, flowing into your router-service with the correct context. This is also the day to verify that Dev 1's billing-service correctly calls your invoice-pdf-service, and that Dev 1's dashboard-service correctly triggers your analytics-export-service.

**What to do:**

- **End-to-End Non-Streaming Test** — Using a real API key created through the frontend, make a `POST /v1/chat/completions` call through API Gateway. Verify the response is a complete OpenAI-compatible completion. Verify the `usage_events` and `usage_monthly` DynamoDB tables are updated with the correct token counts for the correct user and key.

- **End-to-End Streaming Test** — Using the same real API key, make a streaming `POST /v1/chat/completions` call through API Gateway. Verify that chunks arrive progressively (not all at once). Verify usage is recorded after the stream closes.

- **Verify Authorizer Context Fields** — Add temporary logging to your handler that prints the authorizer context fields. Confirm that `userId`, `apiKeyId`, `planId`, and `accountStatus` are all present and correct. Remove the logging after verification.

- **Test Blocked Account Denial** — Coordinate with Dev 1 to block a test user's account. Attempt a `/v1/chat/completions` call with that user's API key. Verify the response is a 403 or 402 before the request reaches your Lambda.

- **Test GRACE Account Access** — Set a test user to GRACE status. Confirm their API calls are still accepted. Confirm `accountStatus: GRACE` appears in the authorizer context passed to your Lambda.

- **Test Invoice PDF Generation Flow** — Go to the billing dashboard in the frontend (now pointed to AWS APIs via Dev 1's Day 8 work). Click "Download Invoice" on a past invoice. Verify Dev 1's billing-service calls your invoice-pdf-service Lambda, a PDF appears in S3, and a presigned URL is returned to the browser. Open the presigned URL and verify the PDF content is correct.

- **Test Analytics Export Flow** — Click "Export Usage" in the dashboard. Verify Dev 1's dashboard-service calls your analytics-export-service Lambda, a CSV appears in S3, and the export is confirmed. Download the CSV and verify the data is correct.

- **Test /v1/models Endpoint** — Call `GET /v1/models` through API Gateway. Verify the response only contains your supported model list, not the full Groq catalog.

- **Test Monthly Invoice Job with Real Data** — Invoke the monthly-invoice-job Lambda with a past month that has real usage data in `usage_monthly`. Verify the generated invoice amounts match what you expect based on the token counts and plan rates.

**Deliverable:** All Python Lambdas tested end to end through API Gateway with real API keys. Authorizer context verified. PDF generation, CSV export, and monthly job all confirmed working with real data.

---

## Day 8 — Idempotency, Error Handling + Usage Reconciliation

**Topic:** Harden the usage pipeline against retries, network failures, and duplicate events.

**Description:**
In a serverless environment, Lambda functions can be invoked more than once for the same request due to retries at the API Gateway or EventBridge layer, or due to client retries. If your usage recording is not idempotent, a single inference request could be counted twice — resulting in incorrect billing. Today you add duplicate prevention and a repair mechanism.

**What to do:**

- **Make usage_events Writes Idempotent** — Add a DynamoDB conditional expression to the `usage_events` put_item call that only succeeds if the `requestId` does not already exist in the table. If the condition fails (meaning the event was already recorded), catch the ConditionalCheckFailedException and log a message but do not raise an error. This ensures that retrying the same request never creates a duplicate usage event.

- **Understand Why usage_monthly Updates Are Already Safe** — The `usage_monthly` update uses DynamoDB's `ADD` operation which is atomic and idempotent in the sense that it always increments by the correct amount. However, if the Lambda retries after recording a usage_event but before updating usage_monthly, the monthly aggregate could miss the increment. Document this edge case and flag it.

- **Build a Usage Repair Function** — Create `router-service/usage_repair.py`. This function takes a `yearMonth` parameter. It scans the `usage_events` table for all events in that month, re-aggregates them by user/model/key, and writes the correct totals back to the `usage_monthly` table using `put_item` (not `update_item`). This is a full recompute from the raw events and should only be run manually when drift is suspected.

- **Add Structured Error Responses** — Standardize all error responses from your Lambda handler. Every error should return a consistent JSON body with a `message` field and an HTTP status code. This makes debugging from the frontend and API Gateway logs much easier.

- **Add Retry Logic for Groq Calls** — If Groq returns a 429 (rate limit) or 503 (service unavailable), add an exponential backoff retry with up to 3 attempts before returning an error to the caller. Do not retry on 4xx client errors.

- **Add CloudWatch Logging** — Ensure your Lambda logs structured JSON to CloudWatch. Every request should log: userId, apiKeyId, model, stream flag, response status, input tokens, output tokens, and total latency. This is critical for debugging billing discrepancies.

- **Handle Missing Authorizer Context Gracefully** — Add a validation step at the top of your handler that checks all required authorizer context fields are present. If any are missing (which should not happen in production but can happen during testing), return a clear 500 error with a descriptive message rather than a cryptic key error deep in the handler.

- **Add Provider Fallback Logging** — When using the per-user Groq API key from Secrets Manager, log whether the request used the user's key or the default key. This helps diagnose authorization issues.

**Deliverable:** Usage pipeline is idempotent. Duplicate events are safely ignored. Structured logging in CloudWatch. Error responses are consistent. Retry logic on Groq failures. Usage repair function available.

---

## Day 9 — Testing, Lambda Tuning + Production Deployment

**Topic:** Write automated tests, tune Lambda performance, and deploy everything to the production AWS environment.

**Description:**
No new features today. This day ensures everything is correct, performs well, and is production-ready. Lambda memory and timeout settings significantly affect both cost and reliability, especially for the long-running streaming connections and the PDF generation which is memory-intensive.

**What to do:**

- **Write Unit Tests for Cost Calculation** — Test the variable cost function: zero usage under the 1M free tier should produce zero cost, usage at exactly 1M tokens should still produce zero cost, usage of 1.5M input tokens should produce $1.00 in variable cost, usage of 2M input and 2M output should produce $10.00. Test with the developer plan rates from the `plan_catalog`.

- **Write Unit Tests for PDF Generation** — Call the PDF generation function with a mock invoice dict and user dict. Verify the output is a non-empty bytes buffer. Verify the buffer starts with the PDF magic bytes `%PDF`. This confirms the PDF was actually generated and not empty.

- **Write Unit Tests for Usage Recording** — Test that the usage event `put_item` call receives the correct item structure. Test that the monthly aggregate `update_item` call uses the correct sort key format. Test the idempotency path — when a ConditionalCheckFailedException is raised, verify it is caught and no exception propagates.

- **Write Unit Tests for Monthly Invoice Job** — Test the cost calculation logic with known inputs. Test the invoice creation path when no existing invoice is found. Test the invoice finalization path when a PENDING invoice already exists.

- **Write an Integration Test for the Full Inference Flow** — Invoke the router-service Lambda directly via the AWS CLI with a realistic event payload that includes authorizer context. Verify the response is a valid completion. Verify DynamoDB records were created.

- **Tune Lambda Memory Settings** — Set the following memory allocations based on the workload:
  - `router-service` (non-streaming): 512 MB — needs memory for httpx and boto3
  - `router-service` (streaming): 512 MB — long-running connections benefit from more memory
  - `invoice-pdf-service`: 768 MB — reportlab PDF generation is memory-intensive
  - `analytics-export-service`: 512 MB — CSV generation for potentially large datasets
  - `monthly-invoice-job`: 512 MB — batch processing with many DynamoDB calls

- **Set Lambda Timeout Settings** — Set the following timeouts:
  - `router-service`: 60 seconds — inference requests can be slow for large prompts
  - `invoice-pdf-service`: 30 seconds — PDF generation should be fast
  - `analytics-export-service`: 60 seconds — large exports may take time
  - `monthly-invoice-job`: 900 seconds (15 minutes) — batch processing all users at month end

- **Deploy All Python Lambdas to Production** — Run the deploy script for each Lambda targeting the production environment. Verify each Lambda is updated in the AWS console.

- **Verify Production Endpoints** — Call `GET /v1/models` through the production API Gateway URL with a real API key. Verify it returns the correct model list. Make a non-streaming completion request in production and verify a response is returned and usage is recorded.

- **Create CloudWatch Dashboards** — Create a CloudWatch dashboard showing: `router-service` invocation count per 5 minutes, error rate, p50 and p99 duration, `usage_events` DynamoDB write count, `monthly-invoice-job` invocation success and failure count.

- **Verify the Monthly Invoice Job Schedule** — Confirm with Dev 1 that the EventBridge rule is pointing to your production Lambda ARN and not the dev ARN. Trigger the Lambda manually one final time in production with a past month and verify the output.

**Deliverable:** All unit tests passing. All Lambdas deployed to production with correct memory and timeout settings. CloudWatch dashboards live. Production endpoints verified working. Monthly invoice job confirmed scheduled.

---

## Dev 2 Summary by Day

| Day | Topic | Status |
|-----|-------|--------|
| 1 | Python Lambda project structure, provider adapter interface, Groq adapter, deploy helpers | New setup |
| 2 | Non-streaming `/v1/chat/completions` + DynamoDB usage recording | Port + New |
| 3 | Streaming completions via Lambda response streaming, SSE chunked output | Port + New |
| 4 | `invoice-pdf-service`: PDF generation → S3, idempotent, branded NeuroRouter | Port + New |
| 5 | `analytics-export-service`: CSV → S3, `/v1/models` from internal catalog | New |
| 6 | `monthly-invoice-job`: ported from Python batch job, EventBridge scheduled | Port + New |
| 7 | Full integration testing: authorizer context, streaming E2E, PDF, export, model catalog | Testing |
| 8 | Idempotency, retry logic, structured logging, usage repair function | Hardening |
| 9 | Unit tests, Lambda tuning, production deploy, CloudWatch dashboards | Validation |

---

## Shared Contract with Developer 1 (Do not modify without coordination)

| Item | Who Owns | Notes |
|------|----------|-------|
| DynamoDB table schemas | Dev 1 | You use as defined. Never add attributes without sign-off. |
| S3 bucket name and key structure | Dev 1 | Bucket created by Dev 1's CDK. Your key naming: `invoices/{invoiceId}.pdf`, `exports/{exportId}.csv`. |
| Authorizer context field names | Dev 1 | `userId`, `apiKeyId`, `planId`, `accountStatus`. Do not change how you read these. |
| API Gateway `/v1/*` route + Lambda integration | Shared | Dev 1 configures the route and streaming mode. You provide the Lambda ARN. |
| `InvokeMode: RESPONSE_STREAM` for streaming Lambda | Dev 1 sets in CDK | Coordinate Lambda ARN on Day 3. |
| EventBridge monthly invoice schedule target | Dev 1 sets the rule | You provide monthly-invoice-job Lambda ARN on Day 6. |
| invoice-pdf-service Lambda ARN | You share | Dev 1's billing-service calls this on Day 6. Share ARN on Day 4. |
| analytics-export-service Lambda ARN | You share | Dev 1's dashboard-service triggers this on Day 5. Share ARN on Day 5. |
