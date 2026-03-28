package main

import (
	"context"
	"log"
	"time"
)

// RefreshBillingStatus evaluates unpaid invoices and updates the user's account status.
// Ported from app/billing_utils.py → refresh_user_billing_status().
//
// Rules (priority: BLOCKED > GRACE > ACTIVE):
//   - If any invoice is OVERDUE → User = BLOCKED
//   - If any PENDING invoice is past grace_period_end → mark OVERDUE, User = BLOCKED
//   - If any PENDING invoice is past due_date → User = GRACE
//   - If no issues and user was billing-blocked → User = ACTIVE
//
// Returns the new account status.
func RefreshBillingStatus(ctx context.Context, user *User) (string, error) {
	// Respect manual admin blocks — don't auto-unblock.
	if user.IsManualBlock {
		return user.AccountStatus, nil
	}

	invoices, err := GetUnpaidInvoices(ctx, user.ID)
	if err != nil {
		return user.AccountStatus, err
	}

	now := time.Now().UTC()
	shouldBeBlocked := false
	shouldBeGrace := false

	for i := range invoices {
		inv := &invoices[i]
		dueDate, _ := time.Parse(time.RFC3339, inv.DueDate)
		graceEnd, _ := time.Parse(time.RFC3339, inv.GracePeriodEnd)

		if inv.Status == BillingPending && now.After(graceEnd) {
			// Transition PENDING → OVERDUE
			if err := UpdateInvoiceStatus(ctx, inv.ID, BillingOverdue); err != nil {
				log.Printf("ERROR updating invoice %s to OVERDUE: %v", inv.ID, err)
			}
			shouldBeBlocked = true
		} else if inv.Status == BillingOverdue {
			shouldBeBlocked = true
		} else if inv.Status == BillingPending && now.After(dueDate) {
			shouldBeGrace = true
		}
	}

	newStatus := user.AccountStatus

	if shouldBeBlocked {
		newStatus = StatusBlocked
	} else if shouldBeGrace {
		newStatus = StatusGrace
	} else {
		// No billing issues — auto-restore if previously billing-blocked.
		if user.AccountStatus == StatusGrace || user.AccountStatus == StatusBlocked {
			newStatus = StatusActive
		}
	}

	if newStatus != user.AccountStatus {
		if err := UpdateUserStatus(ctx, user.ID, newStatus); err != nil {
			return user.AccountStatus, err
		}
		log.Printf("User %s: %s -> %s", user.ID, user.AccountStatus, newStatus)
		user.AccountStatus = newStatus
	}

	return newStatus, nil
}
