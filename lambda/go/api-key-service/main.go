package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// --- Config ---

var (
	ddbClient     *dynamodb.Client
	cogClient     *cognitoidentityprovider.Client
	apiKeysTable  string
	usersTable    string
	activityTable string
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
	cogClient = cognitoidentityprovider.NewFromConfig(cfg)

	apiKeysTable = envOrDefault("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	usersTable = envOrDefault("TABLE_USERS", "neurorouter-users-dev")
	activityTable = envOrDefault("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	return nil
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// --- Models ---

type ApiKey struct {
	ID              string `dynamodbav:"id"              json:"id"`
	UserID          string `dynamodbav:"user_id"         json:"-"`
	KeyHash         string `dynamodbav:"key_hash"        json:"-"`
	KeyPrefix       string `dynamodbav:"key_prefix"      json:"key_prefix"`
	MaskedReference string `dynamodbav:"masked_reference" json:"masked_reference,omitempty"`
	Name            string `dynamodbav:"name,omitempty"  json:"name,omitempty"`
	IsActive        bool   `dynamodbav:"is_active"       json:"is_active"`
	CreatedAt       string `dynamodbav:"created_at"      json:"created_at"`
	LastUsedAt      string `dynamodbav:"last_used_at,omitempty" json:"last_used_at,omitempty"`
	RevokedAt       string `dynamodbav:"revoked_at,omitempty"   json:"-"`
}

type CreateRequest struct {
	Name string `json:"name,omitempty"`
}

type CreateResponse struct {
	ID        string `json:"id"`
	APIKey    string `json:"api_key"` // raw key — returned ONLY ONCE
	KeyPrefix string `json:"key_prefix"`
	Name      string `json:"name,omitempty"`
	CreatedAt string `json:"created_at"`
}

type ErrorResponse struct {
	Detail string `json:"detail"`
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

	// Authenticate via Cognito JWT (set by API Gateway Cognito authorizer).
	// The authorizer puts the user sub into requestContext.authorizer.claims.sub
	userID := extractCognitoSub(req)
	if userID == "" {
		// Fallback: try Authorization header directly (for local testing)
		userID = extractUserFromToken(ctx, req)
	}
	if userID == "" {
		return jsonResp(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	switch {
	case method == "POST" && path == "/api-keys":
		return handleCreate(ctx, req, userID)
	case method == "GET" && path == "/api-keys":
		return handleList(ctx, userID)
	case method == "DELETE" && strings.HasPrefix(path, "/api-keys/"):
		keyID := strings.TrimPrefix(path, "/api-keys/")
		return handleRevoke(ctx, userID, keyID)
	default:
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// POST /api-keys — Ported from auth_routes.py:128-149
func handleCreate(ctx context.Context, req events.APIGatewayProxyRequest, userID string) (events.APIGatewayProxyResponse, error) {
	var body CreateRequest
	if req.Body != "" {
		json.Unmarshal([]byte(req.Body), &body)
	}

	rawKey, keyPrefix, keyHash := generateAPIKey()
	maskedRef := keyPrefix + "****"
	now := time.Now().UTC().Format(time.RFC3339)
	id := generateID()

	key := ApiKey{
		ID:              id,
		UserID:          userID,
		KeyHash:         keyHash,
		KeyPrefix:       keyPrefix,
		MaskedReference: maskedRef,
		Name:            body.Name,
		IsActive:        true,
		CreatedAt:       now,
	}

	item, _ := attributevalue.MarshalMap(key)
	_, err := ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &apiKeysTable,
		Item:      item,
	})
	if err != nil {
		return serverError("put api key: " + err.Error())
	}

	// Write activity log
	writeActivity(ctx, userID, "api_key_created", fmt.Sprintf("API key created: %s", maskedRef))

	return jsonResp(http.StatusCreated, CreateResponse{
		ID:        id,
		APIKey:    rawKey, // returned ONLY ONCE
		KeyPrefix: keyPrefix,
		Name:      body.Name,
		CreatedAt: now,
	})
}

// GET /api-keys — Ported from auth_routes.py:152-173
func handleList(ctx context.Context, userID string) (events.APIGatewayProxyResponse, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &apiKeysTable,
		IndexName:              aws.String("user_id-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // newest first
	})
	if err != nil {
		return serverError("query api keys: " + err.Error())
	}

	var keys []ApiKey
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &keys); err != nil {
		return serverError("unmarshal keys: " + err.Error())
	}

	// Return JSON-safe list (json tags hide sensitive fields)
	return jsonResp(http.StatusOK, keys)
}

// DELETE /api-keys/{id} — Ported from auth_routes.py:176-204
func handleRevoke(ctx context.Context, userID, keyID string) (events.APIGatewayProxyResponse, error) {
	if keyID == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "API key ID required"})
	}

	// Fetch the key to verify ownership
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &apiKeysTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: keyID},
		},
	})
	if err != nil {
		return serverError("get key: " + err.Error())
	}
	if out.Item == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "API key not found"})
	}

	var key ApiKey
	attributevalue.UnmarshalMap(out.Item, &key)

	if key.UserID != userID {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "API key not found"})
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err = ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &apiKeysTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: keyID},
		},
		UpdateExpression: aws.String("SET is_active = :f, revoked_at = :r"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":f": &dbtypes.AttributeValueMemberBOOL{Value: false},
			":r": &dbtypes.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return serverError("revoke key: " + err.Error())
	}

	writeActivity(ctx, userID, "api_key_revoked", fmt.Sprintf("API key revoked: %s", key.MaskedReference))

	return jsonResp(http.StatusOK, map[string]string{"detail": "API key revoked successfully"})
}

// --- API Key Generation (ported from auth.py:133-141) ---

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateAPIKey() (rawKey, keyPrefix, keyHash string) {
	suffix := make([]byte, 13)
	for i := range suffix {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		suffix[i] = charset[n.Int64()]
	}
	rawKey = "neurorouter_" + string(suffix)
	keyPrefix = rawKey[:16]
	keyHash = hashKey(rawKey)
	return
}

func hashKey(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// --- Auth helpers ---

// extractCognitoSub gets the user ID from API Gateway Cognito authorizer claims.
func extractCognitoSub(req events.APIGatewayProxyRequest) string {
	if req.RequestContext.Authorizer == nil {
		return ""
	}
	claims, ok := req.RequestContext.Authorizer["claims"]
	if !ok {
		return ""
	}
	claimsMap, ok := claims.(map[string]interface{})
	if !ok {
		return ""
	}
	sub, _ := claimsMap["sub"].(string)
	return sub
}

// extractUserFromToken validates a Cognito access token directly (for local testing / fallback).
func extractUserFromToken(ctx context.Context, req events.APIGatewayProxyRequest) string {
	auth := req.Headers["Authorization"]
	if auth == "" {
		auth = req.Headers["authorization"]
	}
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	token := parts[1]

	poolID := os.Getenv("COGNITO_USER_POOL_ID")
	if poolID == "" || cogClient == nil {
		return ""
	}

	out, err := cogClient.GetUser(ctx, &cognitoidentityprovider.GetUserInput{
		AccessToken: &token,
	})
	if err != nil {
		return ""
	}
	for _, attr := range out.UserAttributes {
		if aws.ToString(attr.Name) == "sub" {
			return aws.ToString(attr.Value)
		}
	}
	return ""
}

// --- Activity log ---

func writeActivity(ctx context.Context, userID, actType, message string) {
	now := time.Now().UTC().Format(time.RFC3339)
	item := map[string]dbtypes.AttributeValue{
		"userId":    &dbtypes.AttributeValueMemberS{Value: userID},
		"timestamp": &dbtypes.AttributeValueMemberS{Value: now},
		"type":      &dbtypes.AttributeValueMemberS{Value: actType},
		"message":   &dbtypes.AttributeValueMemberS{Value: message},
		"icon_type": &dbtypes.AttributeValueMemberS{Value: "key"},
	}
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &activityTable,
		Item:      item,
	})
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
			"Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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
			"Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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
