#!/usr/bin/env python3
"""Small LLMRelayService OpenAPI helper with local ignored auth storage."""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_AUTH_FILE = SKILL_DIR / ".auth.json"
AUTH_FILE = Path(os.environ.get("LRS_OPENAPI_AUTH_FILE", DEFAULT_AUTH_FILE)).expanduser()
API_PREFIX = "/api/v1"


class ConfigError(RuntimeError):
    pass


def mask_secret(value: str) -> str:
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


def normalize_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    if not base_url:
        raise ConfigError("base_url is required")
    if not base_url.startswith(("http://", "https://")):
        raise ConfigError("base_url must start with http:// or https://")
    return base_url


def load_config() -> dict[str, str]:
    if not AUTH_FILE.exists():
        raise ConfigError(
            "Missing LLMRelayService OpenAPI auth. Ask the user for base URL and GATEWAY_API_KEY, then run:\n"
            "  python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py configure "
            "--base-url http://127.0.0.1:3300 --token <GATEWAY_API_KEY>"
        )
    try:
        data = json.loads(AUTH_FILE.read_text())
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Invalid auth file JSON: {AUTH_FILE}: {exc}") from exc

    base_url = normalize_base_url(str(data.get("base_url", "")))
    token = str(data.get("token", "")).strip()
    if not token:
        raise ConfigError(f"Auth file is missing token: {AUTH_FILE}")
    return {"base_url": base_url, "token": token}


def save_config(base_url: str, token: str) -> None:
    token = token.strip()
    if not token:
        raise ConfigError("token is required")
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "base_url": normalize_base_url(base_url),
        "token": token,
    }
    AUTH_FILE.write_text(json.dumps(payload, indent=2) + "\n")
    AUTH_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)


def normalize_api_path(path: str) -> str:
    normalized = path.strip()
    if not normalized:
        raise ConfigError("path is required")
    if not normalized.startswith("/"):
        normalized = "/" + normalized
    if normalized == API_PREFIX or normalized.startswith(API_PREFIX + "/"):
        return normalized
    return API_PREFIX + normalized


def parse_json_payload(value: str | None) -> bytes | None:
    if value is None:
        return None
    raw = value
    if value.startswith("@"):
        raw = Path(value[1:]).read_text()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"--data must be valid JSON: {exc}") from exc
    return json.dumps(parsed, separators=(",", ":")).encode()


def build_url(base_url: str, path: str, query: list[str]) -> str:
    api_path = normalize_api_path(path)
    params: list[tuple[str, str]] = []
    for item in query:
        if "=" not in item:
            raise ConfigError(f"--query must be key=value, got: {item}")
        key, value = item.split("=", 1)
        if not key:
            raise ConfigError(f"--query key cannot be empty: {item}")
        params.append((key, value))
    qs = urllib.parse.urlencode(params)
    return f"{base_url}{api_path}" + (f"?{qs}" if qs else "")


def request_json(
    method: str,
    path: str,
    data: bytes | None = None,
    query: list[str] | None = None,
    timeout: float = 30,
    use_auth: bool = True,
) -> tuple[int, Any]:
    config = load_config()
    url = build_url(config["base_url"], path, query or [])
    headers = {"accept": "application/json"}
    if data is not None:
        headers["content-type"] = "application/json"
    if use_auth:
        headers["authorization"] = f"Bearer {config['token']}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
            return response.status, decode_body(body)
    except urllib.error.HTTPError as exc:
        body = exc.read()
        return exc.code, decode_body(body)


def decode_body(body: bytes) -> Any:
    if not body:
        return None
    text = body.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def cmd_configure(args: argparse.Namespace) -> int:
    save_config(args.base_url, args.token)
    print_json({
        "ok": True,
        "auth_file": str(AUTH_FILE),
        "base_url": normalize_base_url(args.base_url),
        "token": mask_secret(args.token),
    })
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    config = load_config()
    health_status, health_payload = request_json("GET", "/health", timeout=args.timeout, use_auth=False)
    providers_status, providers_payload = request_json("GET", "/providers", timeout=args.timeout)
    print_json({
        "auth_file": str(AUTH_FILE),
        "base_url": config["base_url"],
        "token": mask_secret(config["token"]),
        "health": {"status": health_status, "body": health_payload},
        "providers": {
            "status": providers_status,
            "count": len(providers_payload.get("data", [])) if isinstance(providers_payload, dict) else None,
        },
    })
    return 0 if health_status < 400 and providers_status < 400 else 1


def cmd_request(args: argparse.Namespace) -> int:
    data = parse_json_payload(args.data)
    status_code, payload = request_json(
        args.method,
        args.path,
        data=data,
        query=args.query,
        timeout=args.timeout,
    )
    output = payload if args.raw else {"status": status_code, "body": payload}
    print_json(output)
    return 0 if status_code < 400 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LLMRelayService OpenAPI helper")
    sub = parser.add_subparsers(dest="command", required=True)

    configure = sub.add_parser("configure", help="Save local ignored OpenAPI credentials")
    configure.add_argument("--base-url", required=True, help="LLMRelayService base URL, e.g. http://127.0.0.1:3300")
    configure.add_argument("--token", required=True, help="GATEWAY_API_KEY")
    configure.set_defaults(func=cmd_configure)

    status = sub.add_parser("status", help="Check saved credentials and API reachability")
    status.add_argument("--timeout", type=float, default=30)
    status.set_defaults(func=cmd_status)

    request = sub.add_parser("request", help="Call an /api/v1 endpoint")
    request.add_argument("method", choices=["GET", "POST", "PATCH", "DELETE", "get", "post", "patch", "delete"])
    request.add_argument("path", help="Endpoint path, with or without /api/v1 prefix")
    request.add_argument("--query", action="append", default=[], help="Query parameter as key=value; repeatable")
    request.add_argument("--data", help="JSON request body, or @path/to/body.json")
    request.add_argument("--timeout", type=float, default=30)
    request.add_argument("--raw", action="store_true", help="Print response body without wrapping status")
    request.set_defaults(func=cmd_request)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except ConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except urllib.error.URLError as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
