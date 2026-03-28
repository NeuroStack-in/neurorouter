package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Ported from: app/jobs/daily_enforcement.py
// Triggered by EventBridge daily at 02:00 UTC.
// Scans ALL users and runs the billing state machine for each one.

var (
	ddbClient     *dynamodb.Client
	usersTable    string
	invoicesTable string
)

type User struct {
	ID            string `dynamodbav:"id"`
	Email         string `dynamodbav:"email"`
	AccountStatus string `dynamodbav:"account_status"`
	IsManualBlock bool   `dynamodbav:"is_manual_block"`
}

type Invoice struct {
	ID             string `dynamodbav:"id"`
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
	usersTable = envOr("TABLE_USERS", "neurorouter-users-dev")
	invoicesTable = envOr("TABLE_INVOICES", "neurorouter-invoices-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type EnforcementResult struct {
	UsersChecked  int `json:"users_checked"`
	StatusUpdates int `json:"status_updates"`
}

func handler(ctx context.Context, event interface{}) (EnforcementResult, error) {
	log.Println("Starting daily billing enforcement...")

	if err := initClients(ctx); err != nil {
		return EnforcementResult{}, fmt.Errorf("init: %w", err)
	}

	// Scan all users
	var users []User
	var lastKey map[string]dbtypes.AttributeValue

	for {
		input := &dynamodb.ScanInput{TableName: &usersTable}
		if lastKey != nil {
			input.ExclusiveStartKey = lastKey
		}
		out, err := ddbClient.Scan(ctx, input)
		if err != nil {
			return EnforcementResult{}, fmt.Errorf("scan users: %w", err)
		}
		var batch []User
		attributevalue.UnmarshalListOfMaps(out.Items, &batch)
		users = append(users, batch...)
		lastKey = out.LastEvaluatedKey
		if lastKey == nil {
			break
		}
	}

	log.Printf("Checking %d users...", len(users))
	updates := 0

	for _, user := range users {
		if user.IsManualBlock {
			continue
		}

		newStatus := refreshBilling(ctx, &user)
		if newStatus != user.AccountStatus {
			log.Printf("User %s (%s): %s -> %s", user.ID, user.Email, user.AccountStatus, newStatus)
			updates++
		}
	}

	log.Printf("Enforcement complete. %d status updates out of %d users.", updates, len(users))
	return EnforcementResult{UsersChecked: len(users), StatusUpdates: updates}, nil
}

func refreshBilling(ctx context.Context, user *User) string {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &invoicesTable,
		IndexName:              aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("(#st = :pending OR #st = :overdue)"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid":     &dbtypes.AttributeValueMemberS{Value: user.ID},
			":pending": &dbtypes.AttributeValueMemberS{Value: "PENDING"},
			":overdue": &dbtypes.AttributeValueMemberS{Value: "OVERDUE"},
		},
	})
	if out == nil {
		return user.AccountStatus
	}

	var invoices []Invoice
	attributevalue.UnmarshalListOfMaps(out.Items, &invoices)

	now := time.Now().UTC()
	shouldBlock := false
	shouldGrace := false

	for _, inv := range invoices {
		due, _ := time.Parse(time.RFC3339, inv.DueDate)
		grace, _ := time.Parse(time.RFC3339, inv.GracePeriodEnd)

		if inv.Status == "PENDING" && now.After(grace) {
			// Transition PENDING → OVERDUE
			ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
				TableName: &invoicesTable,
				Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: inv.ID}},
				UpdateExpression: aws.String("SET #st = :s, updated_at = :u"),
				ExpressionAttributeNames: map[string]string{"#st": "status"},
				ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
					":s": &dbtypes.AttributeValueMemberS{Value: "OVERDUE"},
					":u": &dbtypes.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
				},
			})
			shouldBlock = true
		} else if inv.Status == "OVERDUE" {
			shouldBlock = true
		} else if inv.Status == "PENDING" && now.After(due) {
			shouldGrace = true
		}
	}

	newStatus := user.AccountStatus
	if shouldBlock {
		newStatus = "BLOCKED"
	} else if shouldGrace {
		newStatus = "GRACE"
	} else if user.AccountStatus == "GRACE" || user.AccountStatus == "BLOCKED" {
		newStatus = "ACTIVE"
	}

	if newStatus != user.AccountStatus {
		ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &usersTable,
			Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: user.ID}},
			UpdateExpression: aws.String("SET account_status = :s, updated_at = :u"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
				":s": &dbtypes.AttributeValueMemberS{Value: newStatus},
				":u": &dbtypes.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			},
		})
	}

	return newStatus
}

func main() {
	lambda.Start(handler)
}
