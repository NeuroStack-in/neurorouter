"""
Unit Tests — Usage Recording (Day 9)
======================================
Tests the usage sort key format and the CSV exporter sort key parsing.

TEST CASES:
1. Sort key format matches Dev 1's spec
2. Exporter correctly parses composite sort keys
3. Zero usage produces valid CSV with headers
"""

import sys
import os

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'router-service'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'analytics-export-service'))

from usage import _build_sort_key
from exporter import _parse_sort_key


def test_sort_key_format():
    """Sort key must match Dev 1's format: YYYY-MM#MODEL#{name}#KEY#{id}."""
    result = _build_sort_key("2026-03", "llama-3.3-70b-versatile", "key456")
    expected = "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"
    assert result == expected, f"Expected {expected}, got {result}"
    print("PASS: Sort key format is correct")


def test_parse_sort_key():
    """Exporter correctly parses composite sort keys back into components."""
    sk = "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"
    result = _parse_sort_key(sk)
    assert result["yearMonth"] == "2026-03", f"yearMonth: {result['yearMonth']}"
    assert result["model"] == "llama-3.3-70b-versatile", f"model: {result['model']}"
    assert result["apiKeyId"] == "key456", f"apiKeyId: {result['apiKeyId']}"
    print("PASS: Sort key parsing is correct")


def test_parse_sort_key_empty():
    """Parsing an empty sort key should return empty strings, not crash."""
    result = _parse_sort_key("")
    assert result["yearMonth"] == "", "Should be empty string"
    assert result["model"] == "", "Should be empty string"
    assert result["apiKeyId"] == "", "Should be empty string"
    print("PASS: Empty sort key handled gracefully")


def test_sort_key_roundtrip():
    """Building then parsing a sort key should return the original values."""
    ym, model, key = "2026-05", "mixtral-8x7b-32768", "key_abc123"
    sk = _build_sort_key(ym, model, key)
    parsed = _parse_sort_key(sk)
    assert parsed["yearMonth"] == ym
    assert parsed["model"] == model
    assert parsed["apiKeyId"] == key
    print("PASS: Sort key roundtrip works")


if __name__ == "__main__":
    print("=" * 50)
    print("Running Usage Recording Tests")
    print("=" * 50)
    test_sort_key_format()
    test_parse_sort_key()
    test_parse_sort_key_empty()
    test_sort_key_roundtrip()
    print("=" * 50)
    print("ALL USAGE RECORDING TESTS PASSED")
    print("=" * 50)
