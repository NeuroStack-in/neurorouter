"""
Invoice PDF Service — Lambda Handler (Day 4 Implementation)
============================================================
Generates branded NeuroRouter invoice PDFs and stores them in S3.

HOW IT WORKS:
    1. Caller (Dev 1's billing-service or admin-service) invokes this Lambda
       with { "invoiceId": "...", "userId": "..." }
    2. Handler checks if a PDF already exists (idempotency via pdfS3Key field)
    3. If not, it fetches invoice + user from DynamoDB, generates the PDF,
       uploads to S3, and stamps the invoice record with the S3 key
    4. Returns { "s3Key": "invoices/{id}.pdf", "bucket": "..." }

ENVIRONMENT VARIABLES (set in Lambda console or CDK):
    INVOICES_TABLE  — DynamoDB table name for invoices  (default: invoices)
    USERS_TABLE     — DynamoDB table name for users     (default: users)
    PDF_BUCKET      — S3 bucket for storing PDFs        (default: neurorouter-invoice-pdfs)
"""

import json
import os
from io import BytesIO
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

# --- reportlab imports for PDF generation ---
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import inch

# ─────────────────────────────────────────────
# AWS clients — created once per cold start
# ─────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb")
s3_client = boto3.client("s3")

INVOICES_TABLE = os.environ.get("INVOICES_TABLE", "invoices")
USERS_TABLE = os.environ.get("USERS_TABLE", "users")
PDF_BUCKET = os.environ.get("PDF_BUCKET", "neurorouter-invoice-pdfs")


# ─────────────────────────────────────────────
# PDF Generation  (ported from app/billing_utils.py)
# ─────────────────────────────────────────────
def generate_invoice_pdf(invoice: dict, user: dict) -> BytesIO:
    """
    Generates a NeuroRouter-branded PDF invoice.

    Parameters
    ----------
    invoice : dict
        A DynamoDB invoice item. Expected keys:
        - invoice_number (str)
        - created_at (str, ISO date)
        - due_date (str, ISO date)
        - status (str: PENDING | PAID | OVERDUE | VOID)
        - plan_name (str, optional — e.g. "Pro", "Starter")
        - snapshot_data.total_input_tokens (int)
        - snapshot_data.total_output_tokens (int)
        - snapshot_data.fixed_fee_inr (Decimal/float)
        - calculated_costs.variable_cost_usd (Decimal/float)
        - calculated_costs.total_due_display (str)

    user : dict
        A DynamoDB user item. Expected keys:
        - full_name (str or None)
        - email (str)

    Returns
    -------
    BytesIO
        In-memory buffer containing the finished PDF.
    """
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # ── Safely pull nested dicts ──
    snapshot = invoice.get("snapshot_data", {})
    costs = invoice.get("calculated_costs", {})

    # ── Header ──
    # Changed from "NeuroStack Invoice" → "NeuroRouter Invoice"
    c.setFont("Helvetica-Bold", 24)
    c.drawString(1 * inch, height - 1 * inch, "NeuroRouter Invoice")

    c.setFont("Helvetica", 10)
    c.drawRightString(
        width - 1 * inch,
        height - 1 * inch,
        f"Invoice #: {invoice.get('invoice_number', 'N/A')}",
    )
    c.drawRightString(
        width - 1 * inch,
        height - 1.2 * inch,
        f"Date: {invoice.get('created_at', 'N/A')[:10]}",
    )
    c.drawRightString(
        width - 1 * inch,
        height - 1.4 * inch,
        f"Due Date: {invoice.get('due_date', 'N/A')[:10]}",
    )

    # ── Status badge (colour-coded) ──
    inv_status = invoice.get("status", "PENDING")
    status_color = (
        colors.red if inv_status == "OVERDUE"
        else colors.green if inv_status == "PAID"
        else colors.orange
    )
    c.setFillColor(status_color)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(width - 1 * inch, height - 1.7 * inch, f"Status: {inv_status}")
    c.setFillColor(colors.black)

    # ── Bill To ──
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1 * inch, height - 2.5 * inch, "Bill To:")
    c.setFont("Helvetica", 12)
    c.drawString(
        1 * inch,
        height - 2.7 * inch,
        f"{user.get('full_name') or 'NeuroRouter User'}",
    )
    c.drawString(1 * inch, height - 2.9 * inch, f"{user.get('email', '')}")

    # ── Plan Name (new line added for AWS migration) ──
    plan_name = invoice.get("plan_name", "Standard")
    c.drawString(1 * inch, height - 3.1 * inch, f"Plan: {plan_name}")

    # ── Line Items ──
    y = height - 4 * inch
    c.line(1 * inch, y + 0.2 * inch, width - 1 * inch, y + 0.2 * inch)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1 * inch, y, "Description")
    c.drawRightString(width - 1 * inch, y, "Amount")
    c.line(1 * inch, y - 0.1 * inch, width - 1 * inch, y - 0.1 * inch)

    y -= 0.5 * inch
    c.setFont("Helvetica", 12)

    # Item 1: Fixed Fee
    fixed_fee = float(snapshot.get("fixed_fee_inr", 1599.00))
    c.drawString(1 * inch, y, "Infrastructure Access Fee (Monthly)")
    c.drawRightString(width - 1 * inch, y, f"INR {fixed_fee:.2f}")

    y -= 0.3 * inch

    # Item 2: Variable Usage
    variable_usd = float(costs.get("variable_cost_usd", 0.0))
    c.drawString(1 * inch, y, "NeuroRouter LLM Usage (Variable)")
    c.drawRightString(width - 1 * inch, y, f"USD {variable_usd:.2f}")

    # Token details (grey, smaller font)
    y -= 0.2 * inch
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.grey)
    input_tokens = int(snapshot.get("total_input_tokens", 0))
    output_tokens = int(snapshot.get("total_output_tokens", 0))
    c.drawString(1.2 * inch, y, f"Input Tokens: {input_tokens:,}")
    c.drawString(1.2 * inch, y - 0.2 * inch, f"Output Tokens: {output_tokens:,}")
    c.setFillColor(colors.black)

    # ── Total ──
    y -= 1 * inch
    c.line(1 * inch, y + 0.2 * inch, width - 1 * inch, y + 0.2 * inch)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(1 * inch, y, "Total Due:")
    c.drawRightString(
        width - 1 * inch, y, f"{costs.get('total_due_display', 'N/A')}"
    )

    # ── Footer ──
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.grey)
    c.drawCentredString(
        width / 2, 0.5 * inch, "Thank you for building with NeuroRouter."
    )

    c.save()
    buffer.seek(0)
    return buffer


# ─────────────────────────────────────────────
# Lambda Handler
# ─────────────────────────────────────────────
def lambda_handler(event, context):
    """
    AWS Lambda entry point.

    Expected event payload:
        {
            "invoiceId": "abc123",
            "userId": "user456"
        }

    Returns:
        {
            "statusCode": 200,
            "body": {
                "s3Key": "invoices/abc123.pdf",
                "bucket": "neurorouter-invoice-pdfs"
            }
        }
    """
    # ── 1. Validate input ──
    invoice_id = event.get("invoiceId")
    user_id = event.get("userId")

    if not invoice_id or not user_id:
        return _error(400, "Both 'invoiceId' and 'userId' are required.")

    # ── 2. Fetch the invoice from DynamoDB ──
    invoices_table = dynamodb.Table(INVOICES_TABLE)
    try:
        inv_resp = invoices_table.get_item(Key={"id": invoice_id})
    except ClientError as e:
        return _error(500, f"DynamoDB error (invoices): {e.response['Error']['Message']}")

    invoice = inv_resp.get("Item")
    if not invoice:
        return _error(404, f"Invoice '{invoice_id}' not found.")

    # ── 3. Idempotency check ──
    # If pdfS3Key already exists on the invoice, skip regeneration.
    existing_key = invoice.get("pdfS3Key")
    if existing_key:
        return _success(existing_key, PDF_BUCKET)

    # ── 4. Fetch the user from DynamoDB ──
    users_table = dynamodb.Table(USERS_TABLE)
    try:
        user_resp = users_table.get_item(Key={"id": user_id})
    except ClientError as e:
        return _error(500, f"DynamoDB error (users): {e.response['Error']['Message']}")

    user = user_resp.get("Item")
    if not user:
        return _error(404, f"User '{user_id}' not found.")

    # ── 5. Generate the PDF ──
    pdf_buffer = generate_invoice_pdf(invoice, user)

    # ── 6. Upload to S3 ──
    s3_key = f"invoices/{invoice_id}.pdf"
    try:
        s3_client.put_object(
            Bucket=PDF_BUCKET,
            Key=s3_key,
            Body=pdf_buffer.getvalue(),
            ContentType="application/pdf",
        )
    except ClientError as e:
        return _error(500, f"S3 upload error: {e.response['Error']['Message']}")

    # ── 7. Stamp the invoice record with pdfS3Key ──
    try:
        invoices_table.update_item(
            Key={"id": invoice_id},
            UpdateExpression="SET pdfS3Key = :key",
            ExpressionAttributeValues={":key": s3_key},
        )
    except ClientError as e:
        # PDF is already in S3 — log but don't fail the caller
        print(f"WARNING: PDF uploaded but DynamoDB update failed: {e}")

    # ── 8. Return success ──
    return _success(s3_key, PDF_BUCKET)


# ─────────────────────────────────────────────
# Response helpers
# ─────────────────────────────────────────────
def _success(s3_key: str, bucket: str) -> dict:
    return {
        "statusCode": 200,
        "body": json.dumps({"s3Key": s3_key, "bucket": bucket}),
    }


def _error(code: int, message: str) -> dict:
    print(f"ERROR [{code}]: {message}")
    return {
        "statusCode": code,
        "body": json.dumps({"error": message}),
    }
