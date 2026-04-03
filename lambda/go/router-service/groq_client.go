package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Ported from: lambda/python/router-service/providers/groq_adapter.py

const (
	groqBaseURL  = "https://api.groq.com/openai/v1"
	defaultModel = "llama-3.3-70b-versatile"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// callGroq sends a chat completion request to Groq Cloud.
// Forces model to defaultModel. Returns the raw response body as a map and extracted usage.
func callGroq(ctx context.Context, apiKey string, body map[string]interface{}) (map[string]interface{}, *Usage, error) {
	// Force model
	body["model"] = defaultModel
	body["stream"] = false

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", groqBaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("groq request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, nil, &providerError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, nil, fmt.Errorf("decode response: %w", err)
	}

	// Extract usage
	var usage *Usage
	if u, ok := result["usage"].(map[string]interface{}); ok {
		usage = &Usage{
			PromptTokens:     toInt(u["prompt_tokens"]),
			CompletionTokens: toInt(u["completion_tokens"]),
			TotalTokens:      toInt(u["total_tokens"]),
		}
	}

	return result, usage, nil
}

type providerError struct {
	StatusCode int
	Body       string
}

func (e *providerError) Error() string {
	return fmt.Sprintf("groq returned %d: %s", e.StatusCode, e.Body)
}

func (e *providerError) IsRetryable() bool {
	return e.StatusCode == 429 || e.StatusCode == 503
}

func toInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
