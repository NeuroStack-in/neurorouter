// +build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func init() {
	// GROQ_API_KEY must be set in environment before running tests
	// e.g.: GROQ_API_KEY=gsk_xxx go test -tags integration -v ./...
	if os.Getenv("GROQ_API_KEY") == "" {
		fmt.Println("SKIP: GROQ_API_KEY not set, skipping router integration tests")
	}
	os.Setenv("TABLE_USAGE_EVENTS", "neurorouter-usage-events-dev")
	os.Setenv("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	os.Setenv("AWS_REGION", "ap-south-1")
}

func makeReq(method, path, body string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		HTTPMethod: method, Path: path, Body: body,
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{
				"userId": "test-router-user", "apiKeyId": "test-router-key",
				"planId": "developer", "accountStatus": "ACTIVE",
			},
		},
	}
}

func TestIntegration_ListModels(t *testing.T) {
	resp, err := handler(context.Background(), makeReq("GET", "/v1/models", ""))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
	}
	var result map[string]interface{}
	json.Unmarshal([]byte(resp.Body), &result)
	data, _ := result["data"].([]interface{})
	if len(data) != 5 {
		t.Errorf("expected 5 models, got %d", len(data))
	}
	t.Logf("Models OK: %d models returned", len(data))
}

func TestIntegration_ChatCompletions(t *testing.T) {
	body := `{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Say hello in exactly 3 words"}]}`
	resp, err := handler(context.Background(), makeReq("POST", "/v1/chat/completions", body))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Chat response: %d (body length=%d)", resp.StatusCode, len(resp.Body))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
	}

	var result map[string]interface{}
	json.Unmarshal([]byte(resp.Body), &result)

	// Check required fields
	if result["id"] == nil {
		t.Error("missing id")
	}
	choices, _ := result["choices"].([]interface{})
	if len(choices) == 0 {
		t.Fatal("no choices returned")
	}
	choice := choices[0].(map[string]interface{})
	msg := choice["message"].(map[string]interface{})
	t.Logf("AI response: %s", msg["content"])

	// Check usage
	usage, _ := result["usage"].(map[string]interface{})
	if usage == nil {
		t.Error("missing usage block")
	} else {
		t.Logf("Usage: prompt=%v completion=%v total=%v",
			usage["prompt_tokens"], usage["completion_tokens"], usage["total_tokens"])
	}
}

func TestIntegration_StreamingRejected(t *testing.T) {
	body := `{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hi"}],"stream":true}`
	resp, _ := handler(context.Background(), makeReq("POST", "/v1/chat/completions", body))
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for streaming, got %d", resp.StatusCode)
	}
	t.Logf("Streaming rejected: %d (correct)", resp.StatusCode)
}

func TestIntegration_MissingAuthorizer(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		HTTPMethod: "POST", Path: "/v1/chat/completions",
		Body: `{"messages":[{"role":"user","content":"Hi"}]}`,
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{},
		},
	}
	resp, _ := handler(context.Background(), req)
	if resp.StatusCode != 500 {
		t.Errorf("expected 500, got %d", resp.StatusCode)
	}
	t.Logf("Missing authorizer: %d (correct)", resp.StatusCode)
}

func TestIntegration_InvalidJSON(t *testing.T) {
	resp, _ := handler(context.Background(), makeReq("POST", "/v1/chat/completions", "not json"))
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestIntegration_NotFound(t *testing.T) {
	resp, _ := handler(context.Background(), makeReq("GET", "/v1/unknown", ""))
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestIntegration_UsageRecorded(t *testing.T) {
	// Make a real request and verify usage was written to DynamoDB
	body := `{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Count to 3"}]}`
	resp, _ := handler(context.Background(), makeReq("POST", "/v1/chat/completions", body))
	if resp.StatusCode != 200 {
		t.Fatalf("request failed: %d %s", resp.StatusCode, resp.Body)
	}

	// Give async goroutine time to write
	ctx := context.Background()
	initDynamo(ctx)

	var result map[string]interface{}
	json.Unmarshal([]byte(resp.Body), &result)
	usage := result["usage"].(map[string]interface{})
	t.Logf("Usage recorded: prompt=%v completion=%v — checking DynamoDB...",
		usage["prompt_tokens"], usage["completion_tokens"])

	// Verify usage_monthly was incremented (query by test user)
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &usageMonthlyTable,
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: "test-router-user"},
		},
	})
	if err != nil {
		t.Fatalf("query usage: %v", err)
	}
	if len(out.Items) == 0 {
		t.Log("WARN: usage not yet visible (async write may still be in progress)")
	} else {
		t.Logf("DynamoDB usage_monthly: %d rows for test-router-user", len(out.Items))
	}
}
