package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Ported from: app/auth.py → verify_api_key() + app/billing_utils.py → check_billing_access()
//
// This Lambda is called by API Gateway before every /v1/* request.
// It must:
//   1. Extract Bearer token from Authorization header
//   2. Validate format: neurorouter_ + 13 alphanumeric chars
//   3. Hash token, look up in api_keys table via keyHash-index GSI
//   4. If not found or inactive → Deny
//   5. Look up user in users table
//   6. Run billing refresh (check unpaid invoices)
//   7. If BLOCKED → Deny, if PENDING_APPROVAL → Deny
//   8. If ACTIVE or GRACE → Allow
//   9. Update lastUsedAt on the key
//   10. Inject context: userId, apiKeyId, planId, accountStatus, graceDaysRemaining

var (
	ddbClient     *dynamodb.Client
	apiKeysTable  string
	usersTable    string
	invoicesTable string
	apiKeyPattern = regexp.MustCompile(`^neurorouter_[a-zA-Z0-9]{13}$`)
)

// Account status constants
const (
	StatusActive          = "ACTIVE"
	StatusGrace           = "GRACE"
	StatusBlocked         = "BLOCKED"
	StatusPendingApproval = "PENDING_APPROVAL"
	StatusRejected        = "REJECTED"
	BillingPending        = "PENDING"
	BillingOverdue        = "OVERDUE"
)

// DynamoDB models
type ApiKey struct {
	ID         string `dynamodbav:"id"`
	UserID     string `dynamodbav:"user_id"`
	KeyHash    string `dynamodbav:"key_hash"`
	IsActive   bool   `dynamodbav:"is_active"`
	LastUsedAt string `dynamodbav:"last_used_at,omitempty"`
}

type User struct {
	ID            string `dynamodbav:"id"`
	Email         string `dynamodbav:"email"`
	IsActive      bool   `dynamodbav:"is_active"`
	AccountStatus string `dynamodbav:"account_status"`
	PlanID        string `dynamodbav:"plan_id"`
	IsManualBlock bool   `dynamodbav:"is_manual_block"`
}

type Invoice struct {
	ID             string `dynamodbav:"id"`
	UserID         string `dynamodbav:"user_id"`
	Status         string `dynamodbav:"status"`
	DueDate        string `dynamodbav:"due_date"`
	GracePeriodEnd string `dynamodbav:"grace_period_end"`
}

func initClients(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	ddbClient = dynamodb.NewFromConfig(cfg)

	apiKeysTable = envOr("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	usersTable = envOr("TABLE_USERS", "neurorouter-users-dev")
	invoicesTable = envOr("TABLE_INVOICES", "neurorouter-invoices-dev")
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// --- Lambda entry point ---
// API Gateway REQUEST authorizer receives an APIGatewayCustomAuthorizerRequest
// and must return an APIGatewayCustomAuthorizerResponse (Allow/Deny policy).

func handler(ctx context.Context, req events.APIGatewayCustomAuthorizerRequest) (events.APIGatewayCustomAuthorizerResponse, error) {
	if err := initClients(ctx); err != nil {
		log.Printf("ERROR init: %v", err)
		return denyResponse("Unauthorized"), nil
	}

	// 1. Extract Bearer token
	token := extractToken(req.AuthorizationToken)
	if token == "" {
		log.Println("DENY: missing or invalid Authorization header")
		return denyResponse("Unauthorized"), nil
	}

	// 2. Validate format
	if !apiKeyPattern.MatchString(token) {
		log.Println("DENY: invalid API key format")
		return denyResponse("Invalid API key format"), nil
	}

	// 3. Hash and look up
	keyHash := hashKey(token)
	apiKey, err := lookupKeyByHash(ctx, keyHash)
	if err != nil {
		log.Printf("ERROR lookup key: %v", err)
		return denyResponse("Unauthorized"), nil
	}
	if apiKey == nil || !apiKey.IsActive {
		log.Println("DENY: key not found or inactive")
		return denyResponse("Invalid API key"), nil
	}

	// 4. Look up user
	user, err := getUserByID(ctx, apiKey.UserID)
	if err != nil {
		log.Printf("ERROR lookup user: %v", err)
		return denyResponse("Unauthorized"), nil
	}
	if user == nil || !user.IsActive {
		log.Println("DENY: user not found or inactive")
		return denyResponse("Invalid API key owner"), nil
	}

	// 5. Run billing refresh
	graceDaysRemaining := 0
	newStatus, grDays, err := refreshBillingStatus(ctx, user)
	if err != nil {
		log.Printf("WARN: billing refresh error: %v", err)
		// Don't deny on billing check error — use current status
		newStatus = user.AccountStatus
	}
	graceDaysRemaining = grDays

	// 6. Check status
	switch newStatus {
	case StatusBlocked:
		log.Printf("DENY: user %s is BLOCKED", user.ID)
		return denyResponse("Account blocked due to billing"), nil
	case StatusPendingApproval:
		log.Printf("DENY: user %s is PENDING_APPROVAL", user.ID)
		return denyResponse("Account pending approval"), nil
	case StatusRejected:
		log.Printf("DENY: user %s is REJECTED", user.ID)
		return denyResponse("Account has been rejected"), nil
	}

	// 7. Update lastUsedAt (fire and forget)
	go updateLastUsed(context.Background(), apiKey.ID)

	// 8. Allow with context
	log.Printf("ALLOW: user=%s key=%s status=%s plan=%s", user.ID, apiKey.ID, newStatus, user.PlanID)
	return allowResponse(req.MethodArn, user.ID, map[string]interface{}{
		"userId":             user.ID,
		"apiKeyId":           apiKey.ID,
		"planId":             user.PlanID,
		"accountStatus":      newStatus,
		"graceDaysRemaining": fmt.Sprintf("%d", graceDaysRemaining),
	}), nil
}

// --- Key lookup ---

func hashKey(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func lookupKeyByHash(ctx context.Context, keyHash string) (*ApiKey, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &apiKeysTable,
		IndexName:              aws.String("key_hash-index"),
		KeyConditionExpression: aws.String("key_hash = :kh"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":kh": &dbtypes.AttributeValueMemberS{Value: keyHash},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, err
	}
	if len(out.Items) == 0 {
		return nil, nil
	}
	var key ApiKey
	if err := attributevalue.UnmarshalMap(out.Items[0], &key); err != nil {
		return nil, err
	}
	return &key, nil
}

func getUserByID(ctx context.Context, userID string) (*User, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &usersTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var u User
	if err := attributevalue.UnmarshalMap(out.Item, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

// --- Billing refresh (ported from billing_utils.py) ---

func refreshBillingStatus(ctx context.Context, user *User) (newStatus string, graceDaysRemaining int, err error) {
	if user.IsManualBlock {
		return user.AccountStatus, 0, nil
	}

	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &invoicesTable,
		IndexName:              aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("(#st = :pending OR #st = :overdue)"),
		ExpressionAttributeNames: map[string]string{
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid":     &dbtypes.AttributeValueMemberS{Value: user.ID},
			":pending": &dbtypes.AttributeValueMemberS{Value: BillingPending},
			":overdue": &dbtypes.AttributeValueMemberS{Value: BillingOverdue},
		},
	})
	if err != nil {
		return user.AccountStatus, 0, err
	}

	var invoices []Invoice
	attributevalue.UnmarshalListOfMaps(out.Items, &invoices)

	now := time.Now().UTC()
	shouldBeBlocked := false
	shouldBeGrace := false
	minGraceDays := 0

	for i := range invoices {
		inv := &invoices[i]
		dueDate, _ := time.Parse(time.RFC3339, inv.DueDate)
		graceEnd, _ := time.Parse(time.RFC3339, inv.GracePeriodEnd)

		if inv.Status == BillingPending && now.After(graceEnd) {
			// Transition PENDING → OVERDUE
			updateInvoiceStatus(ctx, inv.ID, BillingOverdue)
			shouldBeBlocked = true
		} else if inv.Status == BillingOverdue {
			shouldBeBlocked = true
		} else if inv.Status == BillingPending && now.After(dueDate) {
			shouldBeGrace = true
			daysLeft := int(math.Ceil(graceEnd.Sub(now).Hours() / 24))
			if daysLeft < 0 {
				daysLeft = 0
			}
			if minGraceDays == 0 || daysLeft < minGraceDays {
				minGraceDays = daysLeft
			}
		}
	}

	newStatus = user.AccountStatus
	if shouldBeBlocked {
		newStatus = StatusBlocked
	} else if shouldBeGrace {
		newStatus = StatusGrace
		graceDaysRemaining = minGraceDays
	} else if user.AccountStatus == StatusGrace || user.AccountStatus == StatusBlocked {
		newStatus = StatusActive
	}

	if newStatus != user.AccountStatus {
		updateUserStatus(ctx, user.ID, newStatus)
		user.AccountStatus = newStatus
	}

	return newStatus, graceDaysRemaining, nil
}

func updateInvoiceStatus(ctx context.Context, invoiceID, status string) {
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &invoicesTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: invoiceID},
		},
		UpdateExpression: aws.String("SET #st = :s, updated_at = :u"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: status},
			":u": &dbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
		},
	})
}

func updateUserStatus(ctx context.Context, userID, status string) {
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression: aws.String("SET account_status = :s, updated_at = :u"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: status},
			":u": &dbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
		},
	})
}

func updateLastUsed(ctx context.Context, keyID string) {
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &apiKeysTable,
		Key: map[string]dbtypes.AttributeValue{
			"id": &dbtypes.AttributeValueMemberS{Value: keyID},
		},
		UpdateExpression: aws.String("SET last_used_at = :t"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":t": &dbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
		},
	})
}

// --- Token extraction ---

func extractToken(authHeader string) string {
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// --- IAM Policy responses ---

func allowResponse(methodArn, principalID string, context map[string]interface{}) events.APIGatewayCustomAuthorizerResponse {
	return events.APIGatewayCustomAuthorizerResponse{
		PrincipalID: principalID,
		PolicyDocument: events.APIGatewayCustomAuthorizerPolicy{
			Version: "2012-10-17",
			Statement: []events.IAMPolicyStatement{
				{
					Action:   []string{"execute-api:Invoke"},
					Effect:   "Allow",
					Resource: []string{buildResourceArn(methodArn)},
				},
			},
		},
		Context: context,
	}
}

func denyResponse(message string) events.APIGatewayCustomAuthorizerResponse {
	return events.APIGatewayCustomAuthorizerResponse{
		PrincipalID: "unauthorized",
		PolicyDocument: events.APIGatewayCustomAuthorizerPolicy{
			Version: "2012-10-17",
			Statement: []events.IAMPolicyStatement{
				{
					Action:   []string{"execute-api:Invoke"},
					Effect:   "Deny",
					Resource: []string{"*"},
				},
			},
		},
		Context: map[string]interface{}{
			"message": message,
		},
	}
}

// buildResourceArn converts a specific method ARN to a wildcard that covers all /v1/* routes.
func buildResourceArn(methodArn string) string {
	// methodArn looks like: arn:aws:execute-api:region:account:apiId/stage/METHOD/v1/path
	// We want: arn:aws:execute-api:region:account:apiId/stage/*/v1/*
	parts := strings.SplitN(methodArn, "/", 4)
	if len(parts) < 2 {
		return methodArn
	}
	return parts[0] + "/" + parts[1] + "/*"
}

func main() {
	lambda.Start(handler)
}
