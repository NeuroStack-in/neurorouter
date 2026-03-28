package main

import "time"

// Account status values — matches app/models.py AccountStatus enum
const (
	StatusActive          = "ACTIVE"
	StatusGrace           = "GRACE"
	StatusBlocked         = "BLOCKED"
	StatusPendingApproval = "PENDING_APPROVAL"
	StatusRejected        = "REJECTED"
)

// Billing status values — matches app/models.py BillingStatus enum
const (
	BillingPending = "PENDING"
	BillingPaid    = "PAID"
	BillingOverdue = "OVERDUE"
	BillingVoid    = "VOID"
)

// User represents a row in neurorouter-users-{env} DynamoDB table.
// Field names match the DynamoDB attribute names from infra-stack.ts.
type User struct {
	ID              string `dynamodbav:"id"`
	Email           string `dynamodbav:"email"`
	FullName        string `dynamodbav:"full_name,omitempty"`
	PasswordHash    string `dynamodbav:"password_hash,omitempty"`
	GoogleID        string `dynamodbav:"google_id,omitempty"`
	AuthProvider    string `dynamodbav:"auth_provider"`
	IsActive        bool   `dynamodbav:"is_active"`
	AccountStatus   string `dynamodbav:"account_status"`
	PlanID          string `dynamodbav:"plan_id"`
	IsManualBlock   bool   `dynamodbav:"is_manual_block"`
	GroqCloudAPIKey string `dynamodbav:"groq_cloud_api_key,omitempty"`
	CreatedAt       string `dynamodbav:"created_at"`
	UpdatedAt       string `dynamodbav:"updated_at"`
}

// Invoice represents a row in neurorouter-invoices-{env} DynamoDB table.
type Invoice struct {
	ID               string  `dynamodbav:"id"`
	UserID           string  `dynamodbav:"user_id"`
	InvoiceNumber    string  `dynamodbav:"invoice_number"`
	YearMonth        string  `dynamodbav:"year_month"`
	Status           string  `dynamodbav:"status"`
	DueDate          string  `dynamodbav:"due_date"`
	GracePeriodEnd   string  `dynamodbav:"grace_period_end"`
	TotalInputTokens int64   `dynamodbav:"total_input_tokens"`
	TotalOutputTokens int64  `dynamodbav:"total_output_tokens"`
	FixedFeeINR      float64 `dynamodbav:"fixed_fee_inr"`
	VariableCostUSD  float64 `dynamodbav:"variable_cost_usd"`
	TotalDueDisplay  string  `dynamodbav:"total_due_display"`
	CreatedAt        string  `dynamodbav:"created_at"`
	UpdatedAt        string  `dynamodbav:"updated_at"`
}

// ActivityLogEntry represents a row in neurorouter-activity-log-{env}.
type ActivityLogEntry struct {
	UserID    string `dynamodbav:"userId"`
	Timestamp string `dynamodbav:"timestamp"`
	Type      string `dynamodbav:"type"`
	Message   string `dynamodbav:"message"`
	IconType  string `dynamodbav:"icon_type"`
}

// --- Request / Response shapes (match app/schemas.py) ---

type RegisterRequest struct {
	Email    string `json:"email"`
	FullName string `json:"full_name,omitempty"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type GoogleAuthRequest struct {
	Token string `json:"token"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type UserOut struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	IsActive  bool   `json:"is_active"`
	CreatedAt string `json:"created_at"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type MeResponse struct {
	UserID        string `json:"userId"`
	Email         string `json:"email"`
	FullName      string `json:"full_name"`
	AccountStatus string `json:"account_status"`
	PlanID        string `json:"plan_id"`
	Role          string `json:"role"`
}

type ErrorResponse struct {
	Detail string `json:"detail"`
}

// NowISO returns current UTC time as ISO string.
func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
