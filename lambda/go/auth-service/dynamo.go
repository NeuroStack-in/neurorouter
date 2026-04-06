package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/expression"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

var (
	ddbClient  *dynamodb.Client
	usersTable string
	invoicesTable string
	activityTable string
)

func initDynamo(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("load aws config: %w", err)
	}
	ddbClient = dynamodb.NewFromConfig(cfg)

	usersTable = os.Getenv("TABLE_USERS")
	if usersTable == "" {
		usersTable = "neurorouter-users-dev"
	}
	invoicesTable = os.Getenv("TABLE_INVOICES")
	if invoicesTable == "" {
		invoicesTable = "neurorouter-invoices-dev"
	}
	activityTable = os.Getenv("TABLE_ACTIVITY_LOG")
	if activityTable == "" {
		activityTable = "neurorouter-activity-log-dev"
	}
	return nil
}

// GetUserByID fetches a user by partition key (id).
func GetUserByID(ctx context.Context, userID string) (*User, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &usersTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	var u User
	if err := attributevalue.UnmarshalMap(out.Item, &u); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}
	return &u, nil
}

// GetUserByEmail fetches a user via the email-index GSI.
func GetUserByEmail(ctx context.Context, email string) (*User, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &usersTable,
		IndexName:              aws.String("email-index"),
		KeyConditionExpression: aws.String("email = :e"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":e": &types.AttributeValueMemberS{Value: email},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("query user by email: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, nil
	}
	var u User
	if err := attributevalue.UnmarshalMap(out.Items[0], &u); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}
	return &u, nil
}

// GetUserByGoogleID fetches a user via the googleId-index GSI.
func GetUserByGoogleID(ctx context.Context, googleID string) (*User, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &usersTable,
		IndexName:              aws.String("googleId-index"),
		KeyConditionExpression: aws.String("google_id = :g"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":g": &types.AttributeValueMemberS{Value: googleID},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("query user by google_id: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, nil
	}
	var u User
	if err := attributevalue.UnmarshalMap(out.Items[0], &u); err != nil {
		return nil, fmt.Errorf("unmarshal user: %w", err)
	}
	return &u, nil
}

// CreateInitialInvoice creates a PENDING invoice for the current month when a new user signs up.
func CreateInitialInvoice(ctx context.Context, userID string) error {
	now := NowISO()
	ym := now[:7] // "2026-04"
	invID := fmt.Sprintf("INV-%s-%s", ym, userID[:8])

	// Due date: 1st of next month. Grace: 5th of next month.
	t, _ := time.Parse("2006-01", ym)
	nextMonth := t.AddDate(0, 1, 0)
	dueDate := time.Date(nextMonth.Year(), nextMonth.Month(), 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	graceEnd := time.Date(nextMonth.Year(), nextMonth.Month(), 5, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	_, err := ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &invoicesTable,
		Item: map[string]types.AttributeValue{
			"id":                    &types.AttributeValueMemberS{Value: invID},
			"user_id":               &types.AttributeValueMemberS{Value: userID},
			"invoice_number":        &types.AttributeValueMemberS{Value: invID},
			"year_month":            &types.AttributeValueMemberS{Value: ym},
			"status":                &types.AttributeValueMemberS{Value: "PENDING"},
			"due_date":              &types.AttributeValueMemberS{Value: dueDate},
			"grace_period_end":      &types.AttributeValueMemberS{Value: graceEnd},
			"total_input_tokens":    &types.AttributeValueMemberN{Value: "0"},
			"total_output_tokens":   &types.AttributeValueMemberN{Value: "0"},
			"rate_input_usd_per_1m": &types.AttributeValueMemberN{Value: "2"},
			"rate_output_usd_per_1m": &types.AttributeValueMemberN{Value: "8"},
			"fixed_fee_inr":         &types.AttributeValueMemberN{Value: "1599"},
			"variable_cost_usd":     &types.AttributeValueMemberN{Value: "0"},
			"fixed_cost_inr":        &types.AttributeValueMemberN{Value: "1599"},
			"total_due_display":     &types.AttributeValueMemberS{Value: "₹1,599.00 + $0.00"},
			"created_at":            &types.AttributeValueMemberS{Value: now},
			"updated_at":            &types.AttributeValueMemberS{Value: now},
		},
		ConditionExpression: aws.String("attribute_not_exists(id)"), // don't overwrite
	})
	if err != nil && !isConditionalCheckFailed(err) {
		return err
	}
	return nil
}

func isConditionalCheckFailed(err error) bool {
	return err != nil && strings.Contains(err.Error(), "ConditionalCheckFailedException")
}

// PutUser writes a full user record to DynamoDB.
func PutUser(ctx context.Context, u *User) error {
	item, err := attributevalue.MarshalMap(u)
	if err != nil {
		return fmt.Errorf("marshal user: %w", err)
	}
	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &usersTable,
		Item:      item,
	})
	return err
}

// UpdateUserStatus updates account_status and updated_at on a user record.
func UpdateUserStatus(ctx context.Context, userID, newStatus string) error {
	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression: aws.String("SET account_status = :s, updated_at = :u"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":s": &types.AttributeValueMemberS{Value: newStatus},
			":u": &types.AttributeValueMemberS{Value: NowISO()},
		},
	})
	return err
}

// UpdateUserFields updates arbitrary fields on a user record.
func UpdateUserFields(ctx context.Context, userID string, fields map[string]interface{}) error {
	update := expression.UpdateBuilder{}
	for k, v := range fields {
		update = update.Set(expression.Name(k), expression.Value(v))
	}
	update = update.Set(expression.Name("updated_at"), expression.Value(NowISO()))

	expr, err := expression.NewBuilder().WithUpdate(update).Build()
	if err != nil {
		return fmt.Errorf("build expression: %w", err)
	}

	_, err = ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: userID},
		},
		UpdateExpression:          expr.Update(),
		ExpressionAttributeNames:  expr.Names(),
		ExpressionAttributeValues: expr.Values(),
	})
	return err
}

// GetUnpaidInvoices returns all PENDING or OVERDUE invoices for a user.
// Uses the userId-yearMonth-index GSI (query by user_id, no sort key filter).
func GetUnpaidInvoices(ctx context.Context, userID string) ([]Invoice, error) {
	// Query all invoices for user, then filter client-side for non-PAID, non-VOID
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &invoicesTable,
		IndexName:              aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("(#st = :pending OR #st = :overdue)"),
		ExpressionAttributeNames: map[string]string{
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":uid":     &types.AttributeValueMemberS{Value: userID},
			":pending": &types.AttributeValueMemberS{Value: BillingPending},
			":overdue": &types.AttributeValueMemberS{Value: BillingOverdue},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query unpaid invoices: %w", err)
	}
	var invoices []Invoice
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &invoices); err != nil {
		return nil, fmt.Errorf("unmarshal invoices: %w", err)
	}
	return invoices, nil
}

// UpdateInvoiceStatus updates the status of an invoice.
func UpdateInvoiceStatus(ctx context.Context, invoiceID, newStatus string) error {
	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &invoicesTable,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: invoiceID},
		},
		UpdateExpression: aws.String("SET #st = :s, updated_at = :u"),
		ExpressionAttributeNames: map[string]string{
			"#st": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":s": &types.AttributeValueMemberS{Value: newStatus},
			":u": &types.AttributeValueMemberS{Value: NowISO()},
		},
	})
	return err
}

// WriteActivityLog writes an entry to the activity log table.
func WriteActivityLog(ctx context.Context, entry ActivityLogEntry) error {
	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return fmt.Errorf("marshal activity: %w", err)
	}
	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &activityTable,
		Item:      item,
	})
	return err
}
