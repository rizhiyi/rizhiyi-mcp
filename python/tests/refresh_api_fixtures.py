from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any

import httpx

from tests.support import API_RESPONSES_DIR, REPO_ROOT


def load_env_overrides(env_file: Path | None) -> dict[str, str]:
    if env_file is None or not env_file.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            values[key] = value
    return values


def resolve_live_settings(env_file: Path | None) -> tuple[str, str]:
    merged = dict(os.environ)
    merged.update(load_env_overrides(env_file))

    base_url = (merged.get("LOGEASE_BASE_URL") or "").strip()
    auth_header = (merged.get("LOGEASE_AUTH_HEADER") or "").strip()
    if not auth_header:
        api_key = (merged.get("LOGEASE_API_KEY") or "").strip()
        if api_key:
            auth_header = f"apikey {api_key}"

    if not base_url:
        raise ValueError("缺少 LOGEASE_BASE_URL，无法访问真实环境。")
    if not auth_header:
        raise ValueError("缺少 LOGEASE_AUTH_HEADER 或 LOGEASE_API_KEY，无法访问真实环境。")

    return base_url.rstrip("/"), auth_header


def normalize_output_path(output: str) -> Path:
    output_path = Path(output)
    if not output_path.is_absolute():
        output_path = REPO_ROOT / output_path
    return output_path


def parse_json_argument(raw_value: str | None, field_name: str) -> Any:
    if raw_value is None or not raw_value.strip():
        return None
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} 不是合法 JSON: {exc}") from exc


async def fetch_fixture(
    *,
    base_url: str,
    auth_header: str,
    method: str,
    path: str,
    params: Any,
    body: Any,
    timeout: float,
) -> Any:
    async with httpx.AsyncClient(
        base_url=base_url,
        headers={"Authorization": auth_header, "Accept": "application/json"},
        timeout=timeout,
        verify=False,
    ) as client:
        response = await client.request(method.upper(), path, params=params, json=body)
        response.raise_for_status()
        return response.json()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="显式刷新 api-responses 下的真实样本。默认测试不会调用它。"
    )
    parser.add_argument("--allow-live", action="store_true", help="必须显式提供，避免误打真实环境。")
    parser.add_argument("--env-file", type=Path, default=None, help="可选，显式指定 .env 文件。")
    parser.add_argument("--method", default="GET", help="HTTP 方法，默认 GET。")
    parser.add_argument("--path", required=True, help="上游 API 路径，例如 /api/v3/search/sheets/。")
    parser.add_argument("--params", default=None, help="JSON 字符串形式的 query 参数。")
    parser.add_argument("--body", default=None, help="JSON 字符串形式的请求体。")
    parser.add_argument("--output", required=True, help="输出文件路径；相对路径默认相对仓库根目录。")
    parser.add_argument("--timeout", type=float, default=30.0, help="请求超时时间，默认 30 秒。")
    return parser


async def run_cli(args: argparse.Namespace) -> int:
    if not args.allow_live:
        raise SystemExit(
            "默认测试不会访问真实环境。若要刷新 fixture，请显式添加 --allow-live。"
        )

    base_url, auth_header = resolve_live_settings(args.env_file)
    params = parse_json_argument(args.params, "params")
    body = parse_json_argument(args.body, "body")
    payload = await fetch_fixture(
        base_url=base_url,
        auth_header=auth_header,
        method=args.method,
        path=args.path,
        params=params,
        body=body,
        timeout=args.timeout,
    )

    output_path = normalize_output_path(args.output)
    if API_RESPONSES_DIR not in output_path.parents and output_path != API_RESPONSES_DIR:
        raise ValueError("输出路径必须位于 api-responses 目录下，避免误写其他文件。")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"fixture refreshed: {output_path}")
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return asyncio.run(run_cli(args))


if __name__ == "__main__":
    raise SystemExit(main())
