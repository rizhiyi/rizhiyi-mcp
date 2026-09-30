"""Shared per-process fan-out limit for analysis requests."""
import os

try:
    _parsed = int(os.getenv("MCP_ANALYSIS_MAX_CONCURRENCY", "4"))
except ValueError:
    _parsed = 4

ANALYSIS_MAX_CONCURRENCY = min(max(_parsed, 1), 8)
