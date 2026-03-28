package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Public endpoints — no authentication required.
// GET /config/plans  → plan catalog from DynamoDB
// GET /config/models → hardcoded model list (from model_catalog.py)

var (
	ddbClient       *dynamodb.Client
	planCatalogTable string
)

func initClients(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	ddbClient = dynamodb.NewFromConfig(cfg)
	planCatalogTable = envOr("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// --- Models ---

type Plan struct {
	PlanID             string  `dynamodbav:"planId"               json:"planId"`
	Name               string  `dynamodbav:"name"                 json:"name"`
	MonthlyFee         float64 `dynamodbav:"monthly_fee"          json:"monthlyFee"`
	IncludedInputTokens  int64 `dynamodbav:"included_input_tokens"  json:"includedInputTokens"`
	IncludedOutputTokens int64 `dynamodbav:"included_output_tokens" json:"includedOutputTokens"`
	OverageInputRate   float64 `dynamodbav:"overage_input_rate"    json:"overageInputRate"`
	OverageOutputRate  float64 `dynamodbav:"overage_output_rate"   json:"overageOutputRate"`
	IsPublic           bool    `dynamodbav:"is_public"             json:"-"` // filter, don't expose
	Currency           string  `dynamodbav:"currency"              json:"currency"`
}

type Model struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"display_name"`
	Provider    string   `json:"provider"`
	Tags        []string `json:"tags"`
}

type ErrorResponse struct {
	Detail string `json:"detail"`
}

// Hardcoded model catalog — ported from lambda/python/router-service/model_catalog.py
var modelCatalog = []Model{
	{ID: "llama-3.3-70b-versatile", DisplayName: "LLaMA 3.3 70B Versatile (Maverick)", Provider: "groq", Tags: []string{"chat", "large", "versatile", "default"}},
	{ID: "llama-3.1-8b-instant", DisplayName: "LLaMA 3.1 8B Instant", Provider: "groq", Tags: []string{"chat", "small", "fast"}},
	{ID: "llama-3.1-70b-versatile", DisplayName: "LLaMA 3.1 70B Versatile", Provider: "groq", Tags: []string{"chat", "large", "versatile"}},
	{ID: "mixtral-8x7b-32768", DisplayName: "Mixtral 8x7B", Provider: "groq", Tags: []string{"chat", "large", "moe"}},
	{ID: "gemma2-9b-it", DisplayName: "Gemma 2 9B IT", Provider: "groq", Tags: []string{"chat", "small", "instruction-tuned"}},
}

// --- Handler ---

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if err := initClients(ctx); err != nil {
		return serverError("init: " + err.Error())
	}

	path := strings.TrimSuffix(req.Path, "/")
	method := req.HTTPMethod
	log.Printf("%s %s", method, path)

	if method == "OPTIONS" {
		return corsResp(200, ""), nil
	}

	switch {
	case method == "GET" && path == "/config/plans":
		return handlePlans(ctx)
	case method == "GET" && path == "/config/models":
		return handleModels(ctx)
	default:
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// GET /config/plans — queries plan_catalog DynamoDB table, returns public plans only
func handlePlans(ctx context.Context) (events.APIGatewayProxyResponse, error) {
	out, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:        &planCatalogTable,
		FilterExpression: aws.String("is_public = :t"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":t": &dbtypes.AttributeValueMemberBOOL{Value: true},
		},
	})
	if err != nil {
		return serverError("scan plans: " + err.Error())
	}

	var plans []Plan
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &plans); err != nil {
		return serverError("unmarshal plans: " + err.Error())
	}

	return jsonResp(http.StatusOK, plans)
}

// GET /config/models — returns hardcoded model catalog
func handleModels(ctx context.Context) (events.APIGatewayProxyResponse, error) {
	return jsonResp(http.StatusOK, modelCatalog)
}

// --- Response helpers ---

func jsonResp(code int, body interface{}) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,OPTIONS",
		},
		Body: string(b),
	}, nil
}

func corsResp(code int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,OPTIONS",
		},
		Body: body,
	}
}

func serverError(msg string) (events.APIGatewayProxyResponse, error) {
	log.Printf("ERROR: %s", msg)
	return jsonResp(http.StatusInternalServerError, ErrorResponse{Detail: "Internal server error"})
}

func main() {
	lambda.Start(handler)
}
