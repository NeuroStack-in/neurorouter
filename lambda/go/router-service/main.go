package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// Ported from: lambda/python/router-service/handler.py
// Go replacement for the Python non-streaming router service.
// Handles POST /v1/chat/completions, POST /v1/completions, GET /v1/models.

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	path := strings.TrimSuffix(req.Path, "/")
	method := req.HTTPMethod

	if method == "OPTIONS" {
		return corsResp(204, ""), nil
	}

	switch {
	case method == "POST" && path == "/v1/chat/completions":
		return handleChatCompletions(ctx, req)
	case method == "POST" && path == "/v1/completions":
		return handleChatCompletions(ctx, req) // alias
	case method == "GET" && path == "/v1/models":
		return handleListModels()
	default:
		return jsonResp(http.StatusNotFound, ErrorBody{Error: ErrorDetail{
			Message: fmt.Sprintf("Unknown route: %s %s", method, path),
			Type:    "not_found",
		}})
	}
}

// POST /v1/chat/completions — non-streaming
func handleChatCompletions(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	startTime := time.Now()

	// Extract authorizer context (injected by Go api-key-authorizer)
	authorizer := req.RequestContext.Authorizer
	userID, _ := authorizer["userId"].(string)
	apiKeyID, _ := authorizer["apiKeyId"].(string)

	if userID == "" || apiKeyID == "" {
		return jsonResp(http.StatusInternalServerError, ErrorBody{Error: ErrorDetail{
			Message: fmt.Sprintf("Missing authorizer context: userId=%s, apiKeyId=%s", userID, apiKeyID),
			Type:    "authorizer_error",
		}})
	}

	// Parse body
	var body map[string]interface{}
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResp(http.StatusBadRequest, ErrorBody{Error: ErrorDetail{
			Message: "Invalid JSON body",
			Type:    "invalid_request_error",
		}})
	}

	// Reject streaming on this endpoint
	if stream, ok := body["stream"].(bool); ok && stream {
		return jsonResp(http.StatusBadRequest, ErrorBody{Error: ErrorDetail{
			Message: "Streaming not supported on this endpoint. Use the streaming Lambda or set stream=false.",
			Type:    "invalid_request_error",
		}})
	}

	requestedModel, _ := body["model"].(string)
	if requestedModel == "" {
		requestedModel = defaultModel
	}

	// Get Groq API key
	groqKey, err := getGroqAPIKey(ctx)
	if err != nil {
		return serverError("get groq key: " + err.Error())
	}

	// Call Groq with retry (3 attempts, exponential backoff for 429/503)
	var result map[string]interface{}
	var usage *Usage
	var lastErr error

	for attempt := 1; attempt <= 3; attempt++ {
		result, usage, err = callGroq(ctx, groqKey, body)
		if err == nil {
			break
		}
		lastErr = err

		if pe, ok := err.(*providerError); ok && pe.IsRetryable() && attempt < 3 {
			wait := time.Duration(1<<uint(attempt)) * time.Second // 2s, 4s
			log.Printf("retry attempt=%d status=%d wait=%v", attempt, pe.StatusCode, wait)
			time.Sleep(wait)
			continue
		}
		break // non-retryable
	}

	if result == nil {
		if pe, ok := lastErr.(*providerError); ok {
			return events.APIGatewayProxyResponse{
				StatusCode: pe.StatusCode,
				Headers:    corsHeaders(),
				Body:       pe.Body,
			}, nil
		}
		return serverError("groq: " + lastErr.Error())
	}

	// Record usage synchronously (goroutines get frozen in Lambda before completing)
	if usage != nil {
		if err := recordUsage(ctx, userID, apiKeyID, requestedModel, usage); err != nil {
			log.Printf("WARN: usage recording failed: %v", err)
		}
	}

	// Structured log
	latency := time.Since(startTime).Milliseconds()
	promptTk, completionTk := 0, 0
	if usage != nil {
		promptTk = usage.PromptTokens
		completionTk = usage.CompletionTokens
	}
	log.Printf(`{"event":"request_complete","userId":"%s","model":"%s","status":200,"promptTokens":%d,"completionTokens":%d,"latencyMs":%d}`,
		userID, requestedModel, promptTk, completionTk, latency)

	// Return Groq response directly
	respBody, _ := json.Marshal(result)
	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers:    corsHeaders(),
		Body:       string(respBody),
	}, nil
}

// GET /v1/models
func handleListModels() (events.APIGatewayProxyResponse, error) {
	return jsonResp(http.StatusOK, toOpenAIFormat())
}

// --- Response helpers ---

func corsHeaders() map[string]string {
	return map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	}
}

func jsonResp(code int, body interface{}) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers:    corsHeaders(),
		Body:       string(b),
	}, nil
}

func corsResp(code int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers:    corsHeaders(),
		Body:       body,
	}
}

func serverError(msg string) (events.APIGatewayProxyResponse, error) {
	log.Printf("ERROR: %s", msg)
	return jsonResp(http.StatusBadGateway, ErrorBody{Error: ErrorDetail{
		Message: "Failed to connect to AI provider",
		Type:    "upstream_error",
	}})
}

func main() {
	lambda.Start(handler)
}
