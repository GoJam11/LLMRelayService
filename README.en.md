# LRS — LLM Relay Service

> Self-hosted LLM relay gateway + observability console

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org)
[![Docker Image](https://img.shields.io/badge/ghcr.io-gojam11%2Fllmrelayservice-blue?logo=docker)](https://github.com/GoJam11/LLMRelayService/pkgs/container/llmrelayservice)

LRS is a lightweight LLM relay service built on **Bun + Hono**. It unifies multiple AI providers behind a single entry point and, through its built-in web console, lets you observe the latency, token usage, and cache hits of every single request.

- **🪶 Lightweight pass-through** — No format conversion by default; whatever the client sends is forwarded as-is (only the auth header is swapped), avoiding dropped fields, broken streaming protocols, and other compatibility issues.
- **🔍 Full request recording** — Stores each request's original body, the actual forwarded body, and the response in full, so you can open the logs and pinpoint issues directly.
- **🔀 Dual protocol + Responses compatibility** — Supports both Anthropic and OpenAI upstream formats; an optional `chat_compat` mode auto-translates between the Responses API and Chat Completions, letting Codex CLI / App connect to upstreams that don't support Responses.
- **📊 Observability console** — A built-in dashboard shows first-token latency, cache hit rate, and token usage trends, with per-API-key statistics and quota control.

![LRS console](docs/screenshots/lrs.png)

> **Who it's for**: LRS targets individual developers or small internal teams. It has no sign-up/invite or other commercialization mechanisms — just a single admin account, with simple per-API-key cost-quota control. If you need full multi-tenant commercial capabilities, consider NewAPI / One-API. If you just want a clean, observable LLM relay for your own toolchain, LRS is the lighter choice.

---

## Table of contents

- [Why LRS?](#why-lrs)
- [Features](#features)
- [Quick start](#quick-start)
- [Send your first request](#send-your-first-request)
- [Deployment](#deployment)
- [Web console](#web-console)
- [Environment variables](#environment-variables)
- [Routing rules](#routing-rules)
- [Responses API compatibility layer](#responses-api-compatibility-layer-connecting-codex)
- [System prompt injection](#system-prompt-injection)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Why LRS?

| Scenario | How LRS solves it |
|----------|-------------------|
| Use multiple AI providers, want a single API entry point | Configure multiple providers; route by path prefix or model name |
| Don't want to expose real API keys to clients | The gateway fills in upstream credentials; clients only hold a gateway key |
| Want to know token cost and cache hits per request | The built-in console shows first-token latency, cache hit rate, and usage trends |
| Multiple channels configure the same model, want controllable priority | Auto-selects the highest-`priority` channel |
| Want to preset a system prompt for a specific channel | Set `systemPrompt` in the provider config; injected automatically |
| Multiple apps share one gateway, want separate usage stats | Generate a dedicated key per app; filter usage and logs by key |
| Hit compatibility issues from format conversion in other proxies | LRS does no format conversion by default — whatever the upstream supports, the client can use |
| Want Codex CLI / App against an upstream without Responses API | Set `responsesMode: chat_compat`; the gateway translates automatically |

---

## Features

- **Lightweight by design, no format conversion by default** — Requests are forwarded as-is, introducing no format-compatibility issues
- **Full request recording** — Stores both the original and forwarded request bodies for easy debugging
- **Dual protocol support** — Compatible with both Anthropic- and OpenAI-format upstreams
- **Responses API compatibility layer** — A channel can set `responsesMode: chat_compat` to auto-convert `/v1/responses` requests into Chat Completions for forwarding, to connect Codex CLI / App and other Responses API clients
- **Explicit prefix routing** — `/providers/{channel}/...` matches a specific channel precisely
- **Model auto-routing** — Standard paths like `/v1/chat/completions` route by the `model` in the request body
- **Priority control** — When multiple channels offer the same model, select by `priority` from high to low
- **Multi-key management** — Generate a dedicated key per app to track usage, stats, and cost quota separately
- **Credential filling** — The gateway holds the upstream key; clients access with only the gateway key
- **System prompt injection** — Anthropic channels can preset a system prompt, merged with the request's `system`
- **Model aliases** — Expose custom model names externally, mapped internally to real upstream models
- **CORS support** — Cross-origin handling built in
- **Web console** — A built-in observability dashboard

---

## Quick start

### Prerequisites

- [Bun](https://bun.sh) >= 1.1
- A PostgreSQL database

### Install and run

```bash
# 1. Clone the repo
git clone https://github.com/GoJam11/LLMRelayService.git
cd LLMRelayService

# 2. Install dependencies
bun install

# 3. Configure environment variables (see .env.example)
cp .env.example .env
# Edit .env and fill in DATABASE_URL and GATEWAY_API_KEY

# 4. Initialize the database
bun run db:migrate

# 5. Start the service (backend + frontend dev server together)
bun run dev
```

The service listens on port `3300` by default. Open `http://localhost:3300` to access the console and add your first channel on the Providers page.

### Other commands

```bash
bun run dev:server   # Backend only (watch mode)
bun run dev:client   # Frontend only (Vite dev server)
bun run build        # Build frontend static assets
bun start            # Start in production mode
bun test             # Run tests
```

---

## Send your first request

After adding a channel in the console, you can verify the gateway with `curl`. Choose the auth header by channel type (see [Routing rules](#routing-rules)):

```bash
# Anthropic-format channel
curl http://localhost:3300/v1/messages \
  -H "x-api-key: $GATEWAY_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 64,
    "messages": [{ "role": "user", "content": "ping" }]
  }'

# OpenAI-format channel
curl http://localhost:3300/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "ping" }]
  }'
```

Once sent, the request appears in the console's request log along with its original and forwarded payloads.

---

## Deployment

Prebuilt GHCR image: `ghcr.io/gojam11/llmrelayservice:main`, updated automatically on every push to the main branch — no local build needed.

### Docker Compose (recommended)

```bash
# 1. Copy and configure environment variables
cp .env.example .env
# Edit .env and fill in GATEWAY_API_KEY (required)

# 2. Pull the image and start (includes a bundled PostgreSQL)
GATEWAY_API_KEY=your-key docker compose up -d
```

Open `http://localhost:3001` to access the console (`docker-compose.yml` maps the container's port 3000 to host port 3001 by default).

To update later:

```bash
docker compose pull && docker compose up -d
```

> **Tip**: If you already have an external PostgreSQL, just remove the `postgres` service from `docker-compose.yml` and point `DATABASE_URL` at your connection string.

### Single-container Docker

If you already have your own PostgreSQL, run a single container (it listens on `3300` by default):

```bash
docker run -d \
  --name lrs \
  -p 3300:3300 \
  -e GATEWAY_API_KEY=your-key \
  -e DATABASE_URL=postgresql://user:password@host:5432/lrs \
  ghcr.io/gojam11/llmrelayservice:main
```

Open `http://localhost:3300` to access the console.

### Build from source

```bash
bun install && bun run build && bun start
```

The build command is the same when deploying on platforms like Railway / Render.

---

## Web console

Open the root path `/` to access the console. Features include:

- **Providers management** — Add, edit, and remove channel configs in the UI without restarting the service
- **Request logs** — A history list where you can inspect the original body, the forwarded body, and the response
- **Latency metrics** — First-byte time, first-token time, total time, generation time
- **Token stats** — Historical trends of input / output / cache tokens
- **Cache analysis** — Compares `cache_creation_input_tokens` / `cache_read_input_tokens` deltas between adjacent requests
- **API key management** — Create and manage gateway access keys, with model allowlists and cumulative cost quotas
- **Monitor** — A real-time traffic overview

| Providers | Request logs | Usage stats |
|:---:|:---:|:---:|
| ![Providers](docs/screenshots/providers.png) | ![Request logs](docs/screenshots/logs.png) | ![Usage stats](docs/screenshots/usage.png) |

> Setting the `GATEWAY_API_KEY` environment variable serves as both the gateway auth key and the console login password.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `GATEWAY_API_KEY` | ✅ | The key clients use to access the gateway; also the console login password |
| `PORT` | — | Listening port, default `3300` |
| `UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS` | — | Default timeout for normal requests waiting on upstream response headers, default `300000` ms; can be overridden persistently in the console Settings page |
| `UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS` | — | Default timeout for streaming requests waiting on upstream response headers, default `300000` ms; overridable in the console Settings page |
| `UPSTREAM_IMAGE_FIRST_BYTE_TIMEOUT_MS` | — | Default timeout for image endpoints waiting on upstream response headers, default `300000` ms; overridable in the console Settings page |
| `UPSTREAM_REQUEST_TIMEOUT_MS` | — | Legacy config name; used as a fallback when the split first-byte variables above are unset |
| `UPSTREAM_RESPONSE_IDLE_TIMEOUT_MS` | — | Idle timeout for the upstream response body, default `300000` ms; set to `0` to disable; also overridable in the console Settings page |
| `DEBUG_DB_MAX_RECORDS` | — | Maximum number of request records to retain, default `50000` |

See [`.env.example`](.env.example).

---

## Routing rules

LRS routes on a **per-provider / per-channel** basis instead of merging same-named models across channels into a single global model pool. A request always lands on one concrete channel, which then forwards it to its own upstream model. There are three ways to address a target:

- **Explicit prefix routing** — `POST /providers/{channel}/v1/messages`, matches a specific channel precisely and forwards the remaining path as-is.
- **Model auto-routing** — `POST /v1/messages`, matches candidate channels by the `model` in the request body and selects by `priority` from high to low.
- **Model alias / fallback** — An alias is an externally exposed virtual model with its own allowlist and fallback rules; use `channel:model` (e.g. `backup:gpt-4o-mini`) to point at a specific model on a specific channel.

> For the full routing model, alias semantics, fallback forms, and authentication, see **[docs/routing.en.md](docs/routing.en.md)**.

---

## Responses API compatibility layer (connecting Codex)

Clients like Codex CLI / Codex App use the OpenAI Responses API (`POST /v1/responses`) rather than Chat Completions. For channels whose upstream natively supports the Responses API, LRS passes through directly by default (`responsesMode: native`). For upstreams that **don't** support the Responses API (e.g. self-hosted models, third-party compatible services), set `responsesMode: chat_compat` in the channel config to let LRS handle the conversion automatically:

- **Request**: converts the Responses API format into Chat Completions before forwarding upstream
- **Response**: converts the upstream's Chat Completions format (including streaming SSE) back into the Responses API format for the client

`responsesMode` values:

| Value | Description |
|-------|-------------|
| `native` (default) | Direct pass-through; the upstream must natively support the Responses API |
| `chat_compat` | LRS handles Responses ↔ Chat Completions conversion |
| `disabled` | Rejects `/v1/responses` requests with a 400 error |

### Configuration example

When editing a channel on the console Providers page, set `responsesMode` to `chat_compat`; or in JSON config:

```json
{
  "my-channel": {
    "type": "openai",
    "baseUrl": "https://your-upstream-api.com",
    "auth": { "key": "sk-..." },
    "models": ["gpt-4o"],
    "responsesMode": "chat_compat"
  }
}
```

Then point the Codex App's API Base URL at the LRS gateway address (e.g. `http://your-lrs-host:3300`) and use the gateway key as the API key.

---

## System prompt injection

Set `systemPrompt` in the provider config, and the gateway will merge it into the request's `system` field before forwarding. If the request already carries a `system`, the two are merged rather than overwritten.

---

## Project structure

```
src/
  index.ts              # Hono entry: CORS, request dispatch, forwarding logic
  config.ts             # Route resolution (resolveRoute / resolveRouteByModel)
  console-ui.ts         # Console static asset hosting and /__console/* API
  providers/            # Anthropic / OpenAI adapters
  db/                   # Drizzle ORM + PostgreSQL
console/
  ai-proxy-dashboard/   # Vite + React console frontend
drizzle/                # Database migration files
```

---

## Contributing

Issues for bug reports and suggestions are welcome, as are pull requests. Please make sure `bun test` passes before opening a PR. Discussion also happens on the community thread: [linux.do](https://linux.do/t/topic/2056392).

---

## License

[MIT](LICENSE)

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
  <img alt="Star History Chart"
    src="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
</picture>
