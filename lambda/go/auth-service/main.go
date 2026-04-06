package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// handler is the single Lambda entry point. It routes based on HTTP method + path.
func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Initialize clients on first invocation (warm start reuses them).
	if err := initDynamo(ctx); err != nil {
		return serverError("init dynamo: " + err.Error())
	}
	if err := initCognito(ctx); err != nil {
		return serverError("init cognito: " + err.Error())
	}

	// Normalize path: /auth/register, /auth/login, etc.
	path := strings.TrimSuffix(req.Path, "/")
	method := req.HTTPMethod

	log.Printf("%s %s", method, path)

	// OPTIONS handled by API Gateway CORS config, but handle here as safety net.
	if method == "OPTIONS" {
		return corsResponse(200, ""), nil
	}

	switch {
	case method == "POST" && path == "/auth/register":
		return handleRegister(ctx, req)
	case method == "POST" && path == "/auth/login":
		return handleLogin(ctx, req)
	case method == "POST" && path == "/auth/google":
		return handleGoogleLogin(ctx, req)
	case method == "POST" && path == "/auth/logout":
		return handleLogout(ctx, req)
	case method == "GET" && path == "/auth/me":
		return handleMe(ctx, req)
	case method == "POST" && path == "/auth/refresh":
		return handleRefresh(ctx, req)
	default:
		return jsonResponse(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// POST /auth/register
// Ported from: app/routers/auth_routes.py → register_user()
func handleRegister(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body RegisterRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Invalid request body"})
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" || body.Password == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email and password are required"})
	}
	if len(body.Password) < 6 {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Password must be at least 6 characters"})
	}

	// Check for existing user in DynamoDB
	existing, err := GetUserByEmail(ctx, email)
	if err != nil {
		return serverError("check existing user: " + err.Error())
	}
	if existing != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email is already registered"})
	}

	// Register in Cognito (auto-confirms, Post-Confirmation trigger creates DynamoDB row)
	sub, err := CognitoSignUp(ctx, email, body.Password, body.FullName)
	if err != nil {
		// Handle Cognito-specific errors
		if strings.Contains(err.Error(), "UsernameExistsException") {
			return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email is already registered"})
		}
		if strings.Contains(err.Error(), "InvalidPasswordException") {
			return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Password does not meet requirements (min 8 chars, uppercase, lowercase, digit)"})
		}
		return serverError("cognito signup: " + err.Error())
	}

	// Create initial invoice for the current month
	if err := CreateInitialInvoice(ctx, sub); err != nil {
		log.Printf("WARN: create initial invoice for %s: %v", email, err)
	}

	// Return the same shape as the Python endpoint
	return jsonResponse(http.StatusOK, UserOut{
		ID:        sub,
		Email:     email,
		IsActive:  true,
		CreatedAt: NowISO(),
	})
}

// POST /auth/login
// Ported from: app/routers/auth_routes.py → login()
func handleLogin(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body LoginRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Invalid request body"})
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" || body.Password == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Email and password are required"})
	}

	// Authenticate via Cognito
	accessToken, refreshToken, expiresIn, err := CognitoLogin(ctx, email, body.Password)
	if err != nil {
		if strings.Contains(err.Error(), "NotAuthorizedException") {
			return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Invalid credentials"})
		}
		if strings.Contains(err.Error(), "UserNotFoundException") {
			return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Invalid credentials"})
		}
		return serverError("cognito login: " + err.Error())
	}

	// Look up user in DynamoDB for billing refresh
	user, err := GetUserByEmail(ctx, email)
	if err != nil {
		log.Printf("WARN: billing refresh lookup failed: %v", err)
	}
	if user != nil {
		// Run billing refresh on login (matches Python behavior)
		status, err := RefreshBillingStatus(ctx, user)
		if err != nil {
			log.Printf("WARN: billing refresh failed: %v", err)
		}
		// Block BLOCKED or REJECTED users from logging in
		if status == StatusBlocked {
			return jsonResponse(http.StatusForbidden, ErrorResponse{Detail: "Account is blocked due to billing"})
		}
		if status == StatusRejected {
			return jsonResponse(http.StatusForbidden, ErrorResponse{Detail: "Account has been rejected"})
		}
	}

	return jsonResponse(http.StatusOK, TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "bearer",
		ExpiresIn:    expiresIn,
		RefreshToken: refreshToken,
	})
}

// POST /auth/google
// Ported from: app/routers/auth_routes.py → login_google()
// Google ID token verification is done via Cognito federated identity, not manually.
// For simplicity, we accept the Google token, create/find the user via Cognito admin APIs,
// and issue Cognito tokens.
func handleGoogleLogin(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body GoogleAuthRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Invalid request body"})
	}
	if body.Token == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Google token is required"})
	}

	// Verify the Google token by calling Google's tokeninfo endpoint
	googleEmail, googleSub, err := verifyGoogleToken(ctx, body.Token)
	if err != nil {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Invalid Google token"})
	}

	// Check if user already exists in DynamoDB
	user, err := GetUserByEmail(ctx, googleEmail)
	if err != nil {
		return serverError("lookup user: " + err.Error())
	}

	if user != nil {
		if !user.IsActive {
			return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "User inactive"})
		}
		// Update google_id if missing
		if user.GoogleID == "" {
			_ = UpdateUserFields(ctx, user.ID, map[string]interface{}{
				"google_id":     googleSub,
				"auth_provider": "google",
			})
		}
		// Refresh billing
		status, _ := RefreshBillingStatus(ctx, user)
		if status == StatusBlocked {
			return jsonResponse(http.StatusForbidden, ErrorResponse{Detail: "Account is blocked due to billing"})
		}
	} else {
		// New Google user — create via Cognito admin
		cognitoSub, err := CognitoAdminCreateUser(ctx, googleEmail, "")
		if err != nil {
			if strings.Contains(err.Error(), "UsernameExistsException") {
				// User exists in Cognito but not DynamoDB — look up the sub
				cogUser, cerr := cognitoClient.AdminGetUser(ctx, &cip.AdminGetUserInput{
					UserPoolId: &userPoolID,
					Username:   &googleEmail,
				})
				if cerr != nil {
					return serverError("cognito get user: " + cerr.Error())
				}
				for _, attr := range cogUser.UserAttributes {
					if aws.ToString(attr.Name) == "sub" {
						cognitoSub = aws.ToString(attr.Value)
					}
				}
			} else {
				return serverError("create google user: " + err.Error())
			}
		}

		// Create DynamoDB record directly (Post-Confirmation trigger doesn't fire for admin-created users)
		now := time.Now().UTC().Format(time.RFC3339)
		newUser := &User{
			ID:            cognitoSub,
			Email:         googleEmail,
			GoogleID:      googleSub,
			AuthProvider:  "google",
			IsActive:      true,
			AccountStatus: "PENDING_APPROVAL",
			PlanID:        "free",
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := PutUser(ctx, newUser); err != nil {
			return serverError("create google user record: " + err.Error())
		}

		// Create initial invoice for the current month
		if err := CreateInitialInvoice(ctx, cognitoSub); err != nil {
			log.Printf("WARN: create initial invoice for %s: %v", googleEmail, err)
		}
	}

	// Derive a deterministic password from the Google sub so we can use Cognito password auth.
	h := sha256.Sum256([]byte("neurorouter-google:" + googleSub))
	derivedPassword := "G!" + hex.EncodeToString(h[:16]) // meets Cognito password policy

	// Set the derived password on the Cognito user
	if err := CognitoAdminSetPassword(ctx, googleEmail, derivedPassword); err != nil {
		log.Printf("WARN: set password for google user: %v", err)
		return serverError("set google user password: " + err.Error())
	}

	// Now authenticate with real Cognito tokens
	accessToken, refreshToken, expiresIn, err := CognitoLogin(ctx, googleEmail, derivedPassword)
	if err != nil {
		log.Printf("WARN: cognito login for google user: %v", err)
		return serverError("google user login: " + err.Error())
	}

	return jsonResponse(http.StatusOK, TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "bearer",
		ExpiresIn:    expiresIn,
	})
}

// POST /auth/logout
// Ported from: app/routers/auth_routes.py → logout()
func handleLogout(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract access token from Authorization header
	accessToken := extractBearerToken(req)
	if accessToken != "" {
		// Invalidate all sessions via Cognito
		if err := CognitoGlobalSignOut(ctx, accessToken); err != nil {
			log.Printf("WARN: cognito sign out failed: %v", err)
			// Don't fail the request — just log it
		}
	}
	return jsonResponse(http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

// GET /auth/me
// Ported from: app/auth.py → get_current_user() + returns merged profile
func handleMe(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	accessToken := extractBearerToken(req)
	if accessToken == "" {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	// Get user identity from Cognito
	sub, email, err := CognitoGetUser(ctx, accessToken)
	if err != nil {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Invalid token"})
	}

	// Look up user in DynamoDB
	user, err := GetUserByID(ctx, sub)
	if err != nil {
		return serverError("get user: " + err.Error())
	}
	if user == nil {
		// Fallback: try by email
		user, err = GetUserByEmail(ctx, email)
		if err != nil || user == nil {
			return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "User not found"})
		}
	}

	// Determine role (from Cognito groups or simple admin check)
	role := "customer"
	if user.AccountStatus == StatusPendingApproval {
		role = "customer-pending"
	}

	return jsonResponse(http.StatusOK, MeResponse{
		UserID:        user.ID,
		Email:         user.Email,
		FullName:      user.FullName,
		AccountStatus: user.AccountStatus,
		PlanID:        user.PlanID,
		Role:          role,
	})
}

// POST /auth/refresh (NEW — not in Python backend)
// Exchanges a Cognito refresh token for a new access token.
func handleRefresh(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body RefreshRequest
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "Invalid request body"})
	}
	if body.RefreshToken == "" {
		return jsonResponse(http.StatusBadRequest, ErrorResponse{Detail: "refresh_token is required"})
	}

	accessToken, expiresIn, err := CognitoRefreshToken(ctx, body.RefreshToken)
	if err != nil {
		return jsonResponse(http.StatusUnauthorized, ErrorResponse{Detail: "Invalid or expired refresh token"})
	}

	return jsonResponse(http.StatusOK, TokenResponse{
		AccessToken: accessToken,
		TokenType:   "bearer",
		ExpiresIn:   expiresIn,
	})
}

// --- Helpers ---

// verifyGoogleToken calls Google's tokeninfo endpoint to verify a Google ID token.
// Returns (email, sub) on success.
func verifyGoogleToken(ctx context.Context, idToken string) (string, string, error) {
	url := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken
	resp, err := http.Get(url)
	if err != nil {
		return "", "", fmt.Errorf("google tokeninfo request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("google tokeninfo returned %d", resp.StatusCode)
	}
	var info struct {
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", "", fmt.Errorf("decode tokeninfo: %w", err)
	}
	if info.Email == "" || info.Sub == "" {
		return "", "", fmt.Errorf("missing email or sub in tokeninfo")
	}
	return strings.ToLower(info.Email), info.Sub, nil
}

// extractBearerToken gets the token from the Authorization header.
func extractBearerToken(req events.APIGatewayProxyRequest) string {
	auth := req.Headers["authorization"]
	if auth == "" {
		auth = req.Headers["Authorization"]
	}
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return parts[1]
}

// jsonResponse builds an API Gateway response with JSON body and CORS headers.
func jsonResponse(statusCode int, body interface{}) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":                "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		},
		Body: string(b),
	}, nil
}

func corsResponse(statusCode int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		},
		Body: body,
	}
}

func serverError(msg string) (events.APIGatewayProxyResponse, error) {
	log.Printf("ERROR: %s", msg)
	return jsonResponse(http.StatusInternalServerError, ErrorResponse{Detail: "Internal server error"})
}

func main() {
	lambda.Start(handler)
}
