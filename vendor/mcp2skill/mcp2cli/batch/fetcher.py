"""Fetch MCP server list from mcpmarket.com for batch conversion."""

from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

import click

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _fetch_html(url: str) -> str:
    """Fetch HTML content from a URL with browser-like headers."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def _extract_leaderboard_list(html: str) -> list[dict]:
    """Extract server list from the JSON-LD ItemList on the leaderboard page."""
    chunks = re.findall(
        r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.DOTALL,
    )
    for chunk in chunks:
        if "ItemList" not in chunk:
            continue
        unescaped = chunk.encode().decode("unicode_escape")
        match = re.search(
            r'\{"@context":"https://schema\.org","@type":"ItemList".*?\}',
            unescaped,
        )
        if not match:
            continue
        # The JSON may be followed by other data; find the balanced end
        text = unescaped[match.start():]
        data = _parse_balanced_json(text)
        if data and "itemListElement" in data:
            return [
                {
                    "position": item["position"],
                    "name": item["item"]["name"],
                    "url": item["item"]["url"],
                    "slug": item["item"]["url"].rstrip("/").rsplit("/", 1)[-1],
                    "description": item["item"].get("description", ""),
                    "stars": (
                        item["item"]
                        .get("interactionStatistic", {})
                        .get("userInteractionCount", 0)
                    ),
                }
                for item in data["itemListElement"]
            ]
    return []


def _parse_balanced_json(text: str) -> dict | None:
    """Parse a JSON object from the start of text using balanced braces."""
    if not text.startswith("{"):
        return None
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[: i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _extract_tool_data(html: str) -> dict | None:
    """Extract tool metadata from a server detail page's RSC payload."""
    chunks = re.findall(
        r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.DOTALL,
    )
    for chunk in chunks:
        if "npm_package" not in chunk and "mcpTools" not in chunk:
            continue
        unescaped = chunk.encode().decode("unicode_escape")
        # There may be multiple "tool":{} objects; find the one with server data
        for m in re.finditer(r'"tool":\{', unescaped):
            start = m.start() + 7
            data = _parse_balanced_json(unescaped[start:])
            if data and ("npm_package" in data or "mcpTools" in data):
                return data
    return None


def _npm_url_to_package(npm_url: str) -> str | None:
    """Extract npm package name from an npmjs.com URL.

    Example: https://www.npmjs.com/package/@upstash/context7-mcp -> @upstash/context7-mcp
    """
    m = re.match(r"https?://(?:www\.)?npmjs\.com/package/(.+)", npm_url)
    return m.group(1).rstrip("/") if m else None


def _pypi_url_to_package(pypi_url: str) -> str | None:
    """Extract pip package name from a pypi.org URL.

    Example: https://pypi.org/project/mcp-server-fetch/ -> mcp-server-fetch
    """
    m = re.match(r"https?://pypi\.org/project/([^/]+)", pypi_url)
    return m.group(1).rstrip("/") if m else None


def _derive_entry(server_info: dict, tool_data: dict | None) -> dict:
    """Build a batch entry dict from leaderboard info + detail page data."""
    entry: dict = {
        "name": server_info["name"].lower().replace(" ", "-"),
        "package": "",
        "type": "npm",
        "command": "npx",
        "args": [],
        "description": server_info.get("description", ""),
        "stars": server_info.get("stars", 0),
        "github": "",
    }

    if tool_data:
        entry["github"] = tool_data.get("github", "")
        npm_url = tool_data.get("npm_package") or ""
        pypi_url = tool_data.get("pypi_package") or ""

        npm_pkg = _npm_url_to_package(npm_url) if npm_url else None
        pypi_pkg = _pypi_url_to_package(pypi_url) if pypi_url else None

        if npm_pkg:
            entry["package"] = npm_pkg
            entry["type"] = "npm"
            entry["command"] = "npx"
            entry["args"] = ["-y", npm_pkg]
        elif pypi_pkg:
            entry["package"] = pypi_pkg
            entry["type"] = "pip"
            entry["command"] = "uvx"
            entry["args"] = [pypi_pkg]
        else:
            # No package URL found; leave empty for manual fill
            entry["package"] = ""
            entry["args"] = []

    return entry


def _fetch_with_retry(url: str, retries: int = 2, delay: float = 1.0) -> str | None:
    """Fetch a URL with retries on failure."""
    for attempt in range(retries + 1):
        try:
            return _fetch_html(url)
        except Exception:
            if attempt < retries:
                time.sleep(delay * (attempt + 1))
            else:
                return None
    return None


def fetch_mcpmarket_list(
    top: int = 100,
    fetch_details: bool = True,
    delay: float = 0.5,
) -> list[dict]:
    """Fetch top MCP servers from mcpmarket.com leaderboard.

    Args:
        top: Number of top servers to fetch.
        fetch_details: If True, also fetch each server's detail page
            to extract npm/pip package info.
        delay: Delay between detail page requests (seconds).

    Returns:
        List of dicts suitable for saving as servers.json.
    """
    click.echo("Fetching leaderboard from mcpmarket.com...")
    html = _fetch_html("https://mcpmarket.com/leaderboards")
    servers = _extract_leaderboard_list(html)

    if not servers:
        click.echo("Error: could not parse leaderboard data.", err=True)
        return []

    servers = servers[:top]
    click.echo(f"Found {len(servers)} servers on leaderboard.")

    entries: list[dict] = []

    for i, server in enumerate(servers, 1):
        slug = server["slug"]
        tool_data = None

        if fetch_details:
            click.echo(f"  [{i}/{len(servers)}] Fetching {server['name']}...")
            detail_html = _fetch_with_retry(
                f"https://mcpmarket.com/server/{slug}",
            )
            if detail_html:
                tool_data = _extract_tool_data(detail_html)
            else:
                click.echo(f"    Warning: could not fetch details after retries", err=True)

            if delay > 0 and i < len(servers):
                time.sleep(delay)

        entry = _derive_entry(server, tool_data)
        entries.append(entry)

    # Summary
    with_pkg = sum(1 for e in entries if e["package"])
    click.echo(f"\n{len(entries)} servers fetched ({with_pkg} with package info).")

    return entries
