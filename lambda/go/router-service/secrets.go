package main

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// Ported from: lambda/python/router-service/secrets_client.py
// In-memory cache persists across Lambda warm starts.

var (
	smClient    *secretsmanager.Client
	smOnce      sync.Once
	secretCache sync.Map // map[string]string
)

func initSecretsClient(ctx context.Context) {
	smOnce.Do(func() {
		cfg, err := awsconfig.LoadDefaultConfig(ctx)
		if err != nil {
			return
		}
		smClient = secretsmanager.NewFromConfig(cfg)
	})
}

// getSecret retrieves a secret from Secrets Manager with in-memory caching.
func getSecret(ctx context.Context, secretName string) (string, error) {
	// Check cache first
	if val, ok := secretCache.Load(secretName); ok {
		return val.(string), nil
	}

	initSecretsClient(ctx)
	if smClient == nil {
		return "", fmt.Errorf("secrets manager client not initialized")
	}

	out, err := smClient.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: &secretName,
	})
	if err != nil {
		return "", fmt.Errorf("get secret %s: %w", secretName, err)
	}

	val := aws.ToString(out.SecretString)
	secretCache.Store(secretName, val)
	return val, nil
}

// getGroqAPIKey gets the Groq key from Secrets Manager or env var fallback.
func getGroqAPIKey(ctx context.Context) (string, error) {
	secretName := os.Getenv("GROQ_SECRET_NAME")
	if secretName != "" {
		return getSecret(ctx, secretName)
	}
	// Fallback for local testing
	if key := os.Getenv("GROQ_API_KEY"); key != "" {
		return key, nil
	}
	return "", fmt.Errorf("neither GROQ_SECRET_NAME nor GROQ_API_KEY is set")
}
