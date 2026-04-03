package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Ported from: lambda/python/analytics-export-service/exporter.py + handler.py

var (
	ddbClient    *dynamodb.Client
	s3Client     *s3.Client
	usageTable   string
	exportBucket string
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
	s3Client = s3.NewFromConfig(cfg)
	usageTable = envOr("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")
	exportBucket = envOr("EXPORT_BUCKET", "neurorouter-invoice-pdfs-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type ExportEvent struct {
	UserID    string `json:"userId"`
	ExportID  string `json:"exportId"`
	YearMonth string `json:"yearMonth"`
}

type ExportResult struct {
	S3Key  string `json:"s3Key"`
	Status string `json:"status"`
}

type UsageRow struct {
	UserID      string `dynamodbav:"userId"`
	SK          string `dynamodbav:"sk"`
	InputTokens  int64 `dynamodbav:"input_tokens"`
	OutputTokens int64 `dynamodbav:"output_tokens"`
	TotalTokens  int64 `dynamodbav:"total_tokens"`
	RequestCount int64 `dynamodbav:"request_count"`
	UpdatedAt    string `dynamodbav:"updated_at"`
}

func handler(ctx context.Context, event ExportEvent) (ExportResult, error) {
	log.Printf("Export: userId=%s exportId=%s yearMonth=%s", event.UserID, event.ExportID, event.YearMonth)

	if event.UserID == "" || event.ExportID == "" {
		return ExportResult{}, fmt.Errorf("userId and exportId are required")
	}

	if err := initClients(ctx); err != nil {
		return ExportResult{}, err
	}

	// Generate CSV
	csvBytes, err := generateCSV(ctx, event.UserID, event.YearMonth)
	if err != nil {
		return ExportResult{}, fmt.Errorf("generate csv: %w", err)
	}

	// Upload to S3
	s3Key := fmt.Sprintf("exports/%s.csv", event.ExportID)
	contentType := "text/csv"
	_, err = s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &exportBucket,
		Key:         &s3Key,
		Body:        bytes.NewReader(csvBytes),
		ContentType: &contentType,
	})
	if err != nil {
		return ExportResult{}, fmt.Errorf("upload to s3: %w", err)
	}

	log.Printf("Export uploaded: s3://%s/%s (%d bytes)", exportBucket, s3Key, len(csvBytes))
	return ExportResult{S3Key: s3Key, Status: "COMPLETED"}, nil
}

func generateCSV(ctx context.Context, userID, yearMonth string) ([]byte, error) {
	// Query usage_monthly with optional yearMonth filter
	queryInput := &dynamodb.QueryInput{
		TableName:              &usageTable,
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
	}
	if yearMonth != "" {
		queryInput.KeyConditionExpression = aws.String("userId = :uid AND begins_with(sk, :ym)")
		queryInput.ExpressionAttributeValues[":ym"] = &dbtypes.AttributeValueMemberS{Value: yearMonth}
	}

	// Handle pagination
	var allRows []UsageRow
	var lastKey map[string]dbtypes.AttributeValue
	for {
		if lastKey != nil {
			queryInput.ExclusiveStartKey = lastKey
		}
		out, err := ddbClient.Query(ctx, queryInput)
		if err != nil {
			return nil, err
		}
		var batch []UsageRow
		attributevalue.UnmarshalListOfMaps(out.Items, &batch)
		allRows = append(allRows, batch...)
		lastKey = out.LastEvaluatedKey
		if lastKey == nil {
			break
		}
	}

	// Write CSV
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	w.Write([]string{"yearMonth", "model", "apiKeyId", "inputTokens", "outputTokens", "totalTokens", "requestCount", "updatedAt"})

	for _, row := range allRows {
		ym, model, keyID := parseSortKey(row.SK)
		w.Write([]string{
			ym, model, keyID,
			fmt.Sprintf("%d", row.InputTokens),
			fmt.Sprintf("%d", row.OutputTokens),
			fmt.Sprintf("%d", row.TotalTokens),
			fmt.Sprintf("%d", row.RequestCount),
			row.UpdatedAt,
		})
	}
	w.Flush()
	return buf.Bytes(), nil
}

// parseSortKey splits "YYYY-MM#MODEL#{model}#KEY#{keyId}"
func parseSortKey(sk string) (yearMonth, model, keyID string) {
	parts := strings.Split(sk, "#")
	if len(parts) >= 1 {
		yearMonth = parts[0]
	}
	if len(parts) >= 3 && parts[1] == "MODEL" {
		model = parts[2]
	}
	if len(parts) >= 5 && parts[3] == "KEY" {
		keyID = parts[4]
	}
	return
}

func main() {
	lambda.Start(handler)
}
