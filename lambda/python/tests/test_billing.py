"""
Unit Tests — Cost Calculation + Monthly Invoice Job (Day 9)
============================================================
Tests the variable cost calculation logic with known inputs.

TEST CASES:
1. Zero usage under free tier → $0.00
2. Exactly 1M tokens → $0.00 (free tier boundary)
3. 1.5M input tokens → $1.00 variable cost
4. 2M input + 2M output → $10.00 variable cost
5. Free plan (0 rates) → $0.00 regardless of usage
"""

import sys
import os
from decimal import Decimal

# Add the monthly-invoice-job directory to path so we can import billing_job
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'monthly-invoice-job'))

from billing_job import calculate_variable_cost


# Developer plan rates (from plan_catalog)
DEV_INPUT_RATE = Decimal("2")   # $2 per 1M input tokens
DEV_OUTPUT_RATE = Decimal("8")  # $8 per 1M output tokens


def test_zero_usage_produces_zero_cost():
    """Zero usage under the 1M free tier should produce zero cost."""
    result = calculate_variable_cost(
        input_tokens=0,
        output_tokens=0,
        rate_input_per_1m=DEV_INPUT_RATE,
        rate_output_per_1m=DEV_OUTPUT_RATE,
    )
    assert result == Decimal("0"), f"Expected 0, got {result}"
    print("PASS: zero usage → $0.00")


def test_exactly_1m_tokens_produces_zero_cost():
    """Usage at exactly 1M tokens should still produce zero cost (free tier)."""
    result = calculate_variable_cost(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        rate_input_per_1m=DEV_INPUT_RATE,
        rate_output_per_1m=DEV_OUTPUT_RATE,
    )
    assert result == Decimal("0"), f"Expected 0, got {result}"
    print("PASS: exactly 1M tokens → $0.00")


def test_1_5m_input_produces_1_dollar():
    """1.5M input tokens = 0.5M chargeable × $2/1M = $1.00."""
    result = calculate_variable_cost(
        input_tokens=1_500_000,
        output_tokens=0,
        rate_input_per_1m=DEV_INPUT_RATE,
        rate_output_per_1m=DEV_OUTPUT_RATE,
    )
    assert result == Decimal("1"), f"Expected 1.00, got {result}"
    print("PASS: 1.5M input tokens → $1.00")


def test_2m_input_2m_output_produces_10_dollars():
    """
    2M input + 2M output:
    - Input: (2M - 1M free) × $2/1M = $2.00
    - Output: (2M - 1M free) × $8/1M = $8.00
    - Total: $10.00
    """
    result = calculate_variable_cost(
        input_tokens=2_000_000,
        output_tokens=2_000_000,
        rate_input_per_1m=DEV_INPUT_RATE,
        rate_output_per_1m=DEV_OUTPUT_RATE,
    )
    assert result == Decimal("10"), f"Expected 10.00, got {result}"
    print("PASS: 2M input + 2M output → $10.00")


def test_free_plan_zero_rates():
    """Free plan ($0 rates) should produce $0 regardless of usage."""
    result = calculate_variable_cost(
        input_tokens=10_000_000,
        output_tokens=10_000_000,
        rate_input_per_1m=Decimal("0"),
        rate_output_per_1m=Decimal("0"),
    )
    assert result == Decimal("0"), f"Expected 0, got {result}"
    print("PASS: free plan (zero rates) → $0.00")


if __name__ == "__main__":
    print("=" * 50)
    print("Running Cost Calculation Tests")
    print("=" * 50)
    test_zero_usage_produces_zero_cost()
    test_exactly_1m_tokens_produces_zero_cost()
    test_1_5m_input_produces_1_dollar()
    test_2m_input_2m_output_produces_10_dollars()
    test_free_plan_zero_rates()
    print("=" * 50)
    print("ALL COST CALCULATION TESTS PASSED")
    print("=" * 50)
