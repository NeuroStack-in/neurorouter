package main

import (
	"context"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	ciptypes "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
)

var (
	cognitoClient *cip.Client
	userPoolID    string
	appClientID   string
)

func initCognito(ctx context.Context) error {
	if cognitoClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("load aws config: %w", err)
	}
	cognitoClient = cip.NewFromConfig(cfg)

	userPoolID = os.Getenv("COGNITO_USER_POOL_ID")
	appClientID = os.Getenv("COGNITO_APP_CLIENT_ID")
	return nil
}

// CognitoSignUp registers a new user in Cognito, then auto-confirms them.
// Returns the Cognito user sub (UUID).
func CognitoSignUp(ctx context.Context, email, password, fullName string) (string, error) {
	attrs := []ciptypes.AttributeType{
		{Name: aws.String("email"), Value: aws.String(email)},
	}
	if fullName != "" {
		attrs = append(attrs, ciptypes.AttributeType{
			Name: aws.String("name"), Value: aws.String(fullName),
		})
	}

	signUpOut, err := cognitoClient.SignUp(ctx, &cip.SignUpInput{
		ClientId: &appClientID,
		Username: &email,
		Password: &password,
		UserAttributes: attrs,
	})
	if err != nil {
		return "", fmt.Errorf("cognito sign up: %w", err)
	}

	// Auto-confirm so the Post-Confirmation trigger fires immediately.
	_, err = cognitoClient.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{
		UserPoolId: &userPoolID,
		Username:   &email,
	})
	if err != nil {
		return "", fmt.Errorf("cognito admin confirm: %w", err)
	}

	return aws.ToString(signUpOut.UserSub), nil
}

// CognitoLogin authenticates with email+password via USER_PASSWORD_AUTH.
// Returns access token, refresh token, and expires-in seconds.
func CognitoLogin(ctx context.Context, email, password string) (accessToken, refreshToken string, expiresIn int, err error) {
	out, err := cognitoClient.InitiateAuth(ctx, &cip.InitiateAuthInput{
		ClientId: &appClientID,
		AuthFlow: ciptypes.AuthFlowTypeUserPasswordAuth,
		AuthParameters: map[string]string{
			"USERNAME": email,
			"PASSWORD": password,
		},
	})
	if err != nil {
		return "", "", 0, fmt.Errorf("cognito login: %w", err)
	}
	if out.AuthenticationResult == nil {
		return "", "", 0, fmt.Errorf("cognito login: no auth result (challenge required)")
	}
	r := out.AuthenticationResult
	return aws.ToString(r.AccessToken), aws.ToString(r.RefreshToken), int(r.ExpiresIn), nil
}

// CognitoRefreshToken exchanges a refresh token for a new access token.
func CognitoRefreshToken(ctx context.Context, refreshToken string) (accessToken string, expiresIn int, err error) {
	out, err := cognitoClient.InitiateAuth(ctx, &cip.InitiateAuthInput{
		ClientId: &appClientID,
		AuthFlow: ciptypes.AuthFlowTypeRefreshTokenAuth,
		AuthParameters: map[string]string{
			"REFRESH_TOKEN": refreshToken,
		},
	})
	if err != nil {
		return "", 0, fmt.Errorf("cognito refresh: %w", err)
	}
	if out.AuthenticationResult == nil {
		return "", 0, fmt.Errorf("cognito refresh: no auth result")
	}
	r := out.AuthenticationResult
	return aws.ToString(r.AccessToken), int(r.ExpiresIn), nil
}

// CognitoGlobalSignOut invalidates all tokens for the user.
func CognitoGlobalSignOut(ctx context.Context, accessToken string) error {
	_, err := cognitoClient.GlobalSignOut(ctx, &cip.GlobalSignOutInput{
		AccessToken: &accessToken,
	})
	if err != nil {
		return fmt.Errorf("cognito sign out: %w", err)
	}
	return nil
}

// CognitoGetUser fetches user attributes from an access token.
// Returns the sub (user ID) and email.
func CognitoGetUser(ctx context.Context, accessToken string) (sub, email string, err error) {
	out, err := cognitoClient.GetUser(ctx, &cip.GetUserInput{
		AccessToken: &accessToken,
	})
	if err != nil {
		return "", "", fmt.Errorf("cognito get user: %w", err)
	}
	for _, attr := range out.UserAttributes {
		switch aws.ToString(attr.Name) {
		case "sub":
			sub = aws.ToString(attr.Value)
		case "email":
			email = aws.ToString(attr.Value)
		}
	}
	if sub == "" {
		return "", "", fmt.Errorf("cognito get user: no sub attribute")
	}
	return sub, email, nil
}

// CognitoAdminAddUserToGroup adds a user to a Cognito group.
func CognitoAdminAddUserToGroup(ctx context.Context, username, groupName string) error {
	_, err := cognitoClient.AdminAddUserToGroup(ctx, &cip.AdminAddUserToGroupInput{
		UserPoolId: &userPoolID,
		Username:   &username,
		GroupName:  &groupName,
	})
	return err
}

// CognitoAdminCreateUser creates a user in Cognito (for Google federated users).
// Suppresses the welcome email.
func CognitoAdminCreateUser(ctx context.Context, email, fullName string) (string, error) {
	attrs := []ciptypes.AttributeType{
		{Name: aws.String("email"), Value: aws.String(email)},
		{Name: aws.String("email_verified"), Value: aws.String("true")},
	}
	if fullName != "" {
		attrs = append(attrs, ciptypes.AttributeType{
			Name: aws.String("name"), Value: aws.String(fullName),
		})
	}

	out, err := cognitoClient.AdminCreateUser(ctx, &cip.AdminCreateUserInput{
		UserPoolId:        &userPoolID,
		Username:          &email,
		UserAttributes:    attrs,
		MessageAction:     ciptypes.MessageActionTypeSuppress,
	})
	if err != nil {
		return "", fmt.Errorf("cognito admin create user: %w", err)
	}
	// Extract sub from attributes
	for _, attr := range out.User.Attributes {
		if aws.ToString(attr.Name) == "sub" {
			return aws.ToString(attr.Value), nil
		}
	}
	return "", fmt.Errorf("cognito admin create user: no sub in response")
}
