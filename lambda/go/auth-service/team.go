package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

var teamTable string

func initTeam() {
	if teamTable == "" {
		teamTable = teamEnv("TABLE_TEAM", "neurorouter-team-dev")
	}
}

func teamEnv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type TeamMember struct {
	OwnerID     string `dynamodbav:"owner_id"     json:"ownerId"`
	MemberEmail string `dynamodbav:"member_email" json:"memberEmail"`
	MemberName  string `dynamodbav:"member_name"  json:"memberName"`
	Role        string `dynamodbav:"role"          json:"role"`
	Status      string `dynamodbav:"status"        json:"status"`
	InviteToken string `dynamodbav:"invite_token"  json:"-"`
	InvitedAt   string `dynamodbav:"invited_at"    json:"invitedAt"`
	AcceptedAt  string `dynamodbav:"accepted_at,omitempty" json:"acceptedAt,omitempty"`
}

type InviteRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type MemberOut struct {
	Email  string `json:"email"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

// GET /auth/team
func handleTeamList(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	initTeam()

	userID := extractAuthUserID(ctx, req)
	if userID == "" {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	user, _ := GetUserByID(ctx, userID)
	if user == nil {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "User not found"})
	}

	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &teamTable,
		KeyConditionExpression: aws.String("owner_id = :oid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":oid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return serverError("query team: " + err.Error())
	}

	var members []TeamMember
	attributevalue.UnmarshalListOfMaps(out.Items, &members)

	result := []MemberOut{
		{Email: user.Email, Name: user.FullName, Role: "Owner", Status: "ACCEPTED"},
	}
	for _, m := range members {
		result = append(result, MemberOut{
			Email:  m.MemberEmail,
			Name:   m.MemberName,
			Role:   m.Role,
			Status: m.Status,
		})
	}

	return jsonResponse(http.StatusOK, result)
}

// POST /auth/team/invite — generate invite link
func handleTeamInvite(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	initTeam()

	userID := extractAuthUserID(ctx, req)
	if userID == "" {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	var body InviteRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Invalid request"})
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email is required"})
	}
	role := body.Role
	if role == "" {
		role = "Editor"
	}

	// Check if already invited
	existing, _ := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &teamTable,
		Key: map[string]dbtypes.AttributeValue{
			"owner_id":     &dbtypes.AttributeValueMemberS{Value: userID},
			"member_email": &dbtypes.AttributeValueMemberS{Value: email},
		},
	})
	if existing.Item != nil {
		return jsonResponse(http.StatusConflict, ErrorResponse{Detail: "Already invited"})
	}

	// Generate invite token
	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	inviteToken := hex.EncodeToString(tokenBytes)

	// Look up invited user's name if they exist
	memberName := ""
	if existingUser, _ := GetUserByEmail(ctx, email); existingUser != nil {
		memberName = existingUser.FullName
	}

	member := TeamMember{
		OwnerID:     userID,
		MemberEmail: email,
		MemberName:  memberName,
		Role:        role,
		Status:      "PENDING",
		InviteToken: inviteToken,
		InvitedAt:   NowISO(),
	}
	item, _ := attributevalue.MarshalMap(member)
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &teamTable, Item: item})

	apiBase := teamEnv("API_BASE_URL", "https://u87jos3lg5.execute-api.ap-south-1.amazonaws.com/dev")
	acceptLink := fmt.Sprintf("%s/auth/team/accept?token=%s&owner=%s", apiBase, inviteToken, userID)

	return jsonResponse(http.StatusOK, map[string]interface{}{
		"status":     "invited",
		"email":      email,
		"role":       role,
		"acceptLink": acceptLink,
	})
}

// GET /auth/team/accept?token=xxx&owner=yyy
func handleTeamAccept(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	initTeam()

	token := req.QueryStringParameters["token"]
	ownerID := req.QueryStringParameters["owner"]
	if token == "" || ownerID == "" {
		return events.APIGatewayProxyResponse{
			StatusCode: 400,
			Headers:    map[string]string{"Content-Type": "text/html"},
			Body:       `<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1 style="color:#ef4444;">Invalid Link</h1><p>Missing token or owner.</p></body></html>`,
		}, nil
	}

	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &teamTable,
		KeyConditionExpression: aws.String("owner_id = :oid"),
		FilterExpression:       aws.String("invite_token = :t"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":oid": &dbtypes.AttributeValueMemberS{Value: ownerID},
			":t":   &dbtypes.AttributeValueMemberS{Value: token},
		},
	})
	if out == nil || len(out.Items) == 0 {
		return events.APIGatewayProxyResponse{
			StatusCode: 404,
			Headers:    map[string]string{"Content-Type": "text/html"},
			Body:       `<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1 style="color:#ef4444;">Invalid or Expired Link</h1><p>This invitation is no longer valid.</p></body></html>`,
		}, nil
	}

	var member TeamMember
	attributevalue.UnmarshalMap(out.Items[0], &member)

	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &teamTable,
		Key: map[string]dbtypes.AttributeValue{
			"owner_id":     &dbtypes.AttributeValueMemberS{Value: ownerID},
			"member_email": &dbtypes.AttributeValueMemberS{Value: member.MemberEmail},
		},
		UpdateExpression:         aws.String("SET #s = :s, accepted_at = :a"),
		ExpressionAttributeNames: map[string]string{"#s": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "ACCEPTED"},
			":a": &dbtypes.AttributeValueMemberS{Value: NowISO()},
		},
	})

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers:    map[string]string{"Content-Type": "text/html"},
		Body:       `<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1 style="color:#22c55e;">Invitation Accepted!</h1><p>You've joined the NeuroRouter team. You can close this page.</p></body></html>`,
	}, nil
}

// DELETE /auth/team/{email}
func handleTeamRemove(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	initTeam()

	userID := extractAuthUserID(ctx, req)
	if userID == "" {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	path := strings.TrimSuffix(req.Path, "/")
	email := strings.TrimPrefix(path, "/auth/team/")
	email, _ = url.PathUnescape(email) // decode %40 → @
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email required"})
	}

	ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &teamTable,
		Key: map[string]dbtypes.AttributeValue{
			"owner_id":     &dbtypes.AttributeValueMemberS{Value: userID},
			"member_email": &dbtypes.AttributeValueMemberS{Value: email},
		},
	})

	return jsonResponse(http.StatusOK, map[string]string{"status": "removed", "email": email})
}

// extractAuthUserID gets user ID from Authorization header via Cognito
func extractAuthUserID(ctx context.Context, req events.APIGatewayProxyRequest) string {
	token := extractBearerToken(req)
	if token == "" {
		return ""
	}
	sub, _, err := CognitoGetUser(ctx, token)
	if err != nil {
		return ""
	}
	return sub
}
