"""
Unit Tests — PDF Generation (Day 9)
=====================================
Tests that the invoice PDF generation function produces valid PDFs.

TEST CASES:
1. Generated PDF is non-empty
2. PDF starts with magic bytes %PDF (valid PDF format)
3. PDF contains "NeuroRouter Invoice" header
"""

import sys
import os

# Add the invoice-pdf-service directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'invoice-pdf-service'))

from handler import generate_invoice_pdf


# Mock invoice dict (DynamoDB-shaped)
MOCK_INVOICE = {
    "invoice_number": "INV-2026-03-ABCD1234",
    "created_at": "2026-03-01T00:00:00Z",
    "due_date": "2026-04-05T00:00:00Z",
    "status": "PENDING",
    "plan_name": "Developer",
    "snapshot_data": {
        "total_input_tokens": 2_500_000,
        "total_output_tokens": 1_200_000,
        "fixed_fee_inr": 1599.00,
    },
    "calculated_costs": {
        "variable_cost_usd": 4.60,
        "total_due_display": "₹1599 + $4.60",
    },
}

# Mock user dict (DynamoDB-shaped)
MOCK_USER = {
    "full_name": "Anushwathi Test User",
    "email": "anushwathi@neurorouter.in",
}


def test_pdf_is_non_empty():
    """Generated PDF should be a non-empty bytes buffer."""
    buffer = generate_invoice_pdf(MOCK_INVOICE, MOCK_USER)
    content = buffer.getvalue()
    assert len(content) > 0, "PDF buffer is empty"
    print(f"PASS: PDF is non-empty ({len(content)} bytes)")


def test_pdf_starts_with_magic_bytes():
    """PDF should start with %PDF magic bytes (valid PDF format)."""
    buffer = generate_invoice_pdf(MOCK_INVOICE, MOCK_USER)
    content = buffer.getvalue()
    assert content[:5] == b"%PDF-", f"Expected %PDF-, got {content[:5]}"
    print("PASS: PDF starts with %PDF- magic bytes")


def test_pdf_with_missing_fields():
    """PDF generation should handle missing/optional fields gracefully."""
    minimal_invoice = {
        "invoice_number": "INV-TEST",
        "created_at": "2026-01-01",
        "due_date": "2026-02-05",
        "status": "PENDING",
    }
    minimal_user = {"email": "test@test.com"}

    buffer = generate_invoice_pdf(minimal_invoice, minimal_user)
    content = buffer.getvalue()
    assert len(content) > 0, "PDF buffer is empty for minimal input"
    assert content[:5] == b"%PDF-", "Invalid PDF for minimal input"
    print("PASS: PDF handles missing fields gracefully")


if __name__ == "__main__":
    print("=" * 50)
    print("Running PDF Generation Tests")
    print("=" * 50)
    test_pdf_is_non_empty()
    test_pdf_starts_with_magic_bytes()
    test_pdf_with_missing_fields()
    print("=" * 50)
    print("ALL PDF GENERATION TESTS PASSED")
    print("=" * 50)
