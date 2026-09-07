# LRS — LLM Relay Service

> **Intelligent LLM Traffic Hub + Self-Healing Gateway + Full-Observability Console** crafted for individual developers and agile teams

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org)
[![Docker Image](https://img.shields.io/badge/ghcr.io-gojam11%2Fllmrelayservice-blue?logo=docker)](https://github.com/GoJam11/LLMRelayService/pkgs/container/llmrelayservice)

---

LRS is a lightweight, high-availability LLM relay gateway built on **Bun + Hono**. It consolidates credentials across disparate AI providers under a unified entry point while offering **multi-tiered routing orchestration, virtual model aliases, automatic self-healing failover, deep ecosystem compatibility**, and **microscopic full-text logging with precise Prompt Cache cost accounting**.

![LRS Monitoring Dashboard](docs/screenshots/lrs-monitor.png)

> 💡 **Why LRS over commercialized multi-tenant gateways?**  
> Platforms like One-API or NewAPI carry heavy commercial baggage: user registrations, invite systems, prepaid balances, complex role groups, and heavyweight dependencies.  
> **LRS is purpose-built for individual developers**:
> - **Zero Maintenance Overhead**: Native SQLite single-file database; spin up a container in 5 seconds with negligible memory footprint.
> - **Bulletproof Safety Rails**: Issue dedicated API keys per application, enforce model whitelists, and set **hard USD cost quotas** to physically eliminate runaway AI agent loops from draining your wallet.
> - **Advanced Traffic Orchestration**: First-class virtual model aliases (Alias), ordered multi-target fallbacks, and automatic cross-provider failover on timeouts or 429s.
> - **True Pass-Through Fidelity**: No unnecessary format conversions by default to prevent streaming corruption; tailored compatibility layers for Codex (Responses API translation) and Claude Code (cloaking bypass).

---

## Table of Contents

- [Core Pain Points & Solutions](#core-pain-points--solutions)
- [Core Strength 1: Advanced Routing & Self-Healing Architecture](#core-strength-1-advanced-routing--self-healing-architecture)
- [Core Strength 2: Tailored for Personal Developer Workflows & Safety](#core-strength-2-tailored-for-personal-developer-workflows--safety)
- [Toolchain Integration Guide](#toolchain-integration-guide)
- [Quick Start](#quick-start)
- [Deployment Guide](#deployment-guide)
- [Web Console](#web-console)
- [Environment Variables](#environment-variables)
- [OpenAPI Management Surface](#openapi-management-surface)
- [License](#license)

---

## Core Pain Points & Solutions

| Everyday Developer Pain Point | How LRS Solves It |
| :--- | :--- |
| **Scattered tool configurations**: Cursor, Claude Code, Cline, Codex, and Raycast all require real upstream API keys | Centralize into LRS. The gateway manages upstream secrets securely; local tools only need the local gateway URL and sub-keys. |
| **Upstream rate limits and outages**: Flow interrupted by sudden 429s or 5xx server errors, breaking autonomous coding agents | **Multi-tier self-healing**: Automatically retries on timeouts/429/network errors and fails over to backup channels or fallback models. |
| **Cumbersome model identifiers**: Switching upstream providers requires tedious configuration changes across every tool | **Virtual Model Aliases**: Expose virtual names like `fast` or `code` externally while freely binding multiple providers and fallback sequences internally. |
| **Codex CLI/App unable to use third-party models**: Codex strictly depends on `/v1/responses`, unsupported by third-party upstreams | **Bidirectional compatibility layer**: Set `responsesMode: chat_compat` to let LRS automatically translate between Responses API and Chat Completions in real-time. |
| **Claude Code proxy cloaking**: OAuth proxies drop custom System Prompts when detecting non-official clients | **Cloaking bypass mode**: Enable `claudeCodeCompat` to automatically migrate `system` prompts into the first `user` turn, bypassing proxy censorship. |
| **Runaway Agent loops draining balances**: Complex autonomous agents stuck in recursive loops racking up huge API bills | **Per-key hard cost quota**: Automatically cut off requests (HTTP 429) once an assigned budget (e.g. $5.00) is exhausted. |
| **Inaccurate Prompt Cache accounting**: Most proxies treat cached tokens as free ($0) or miss granular TTL rates | **High-precision pricing engine**: Accurately accounts for Anthropic 5m vs. 1h cache writes, cache reads, and OpenAI cached inputs with fully transparent formulas. |
| **Debugging mysterious upstream errors**: An upstream returns 500, but there is no record of the exact payload transmitted | **Full-text request audit**: Preserves raw client request bodies, forwarded request bodies, and upstream responses for instant side-by-side inspection. |

---

## Core Strength 1: Advanced Routing & Self-Healing Architecture

In LRS, **Providers (Channels)** are treated as first-class citizens, forming a complete lifecycle covering addressing, dispatching, rewriting, and automatic self-healing.

```mermaid
flowchart TD
    A[Client Request] --> B{Addressing Mode}
    B -->|Explicit /providers/:channel/*| C[Direct Channel Bypass]
    B -->|Type Forced /openai/* or /anthropic/*| D[Enforce Protocol Type]
    B -->|Standard Entry /v1/*| E{Is Model an Alias?}
    D --> E
    
    E -->|Yes| F[Resolve Alias Target Chain: Provider + Model]
    E -->|No| G[Match Provider Candidates, Sort by Priority]
    
    F --> H[Dispatch Upstream Call]
    G --> H
    C --> H
    
    H --> I{Request Succeeded?}
    I -->|Yes 200| J[Record Full Payload / Usage & Return]
    I -->|Failure Trigger: Timeout, 429, 5xx, Network Error| K{Matches Failover Policy?}
    
    K -->|Yes| L{Select Fallback Mode}
    L -->|Alias Next Target| M[Try Next Provider/Model in Alias]
    L -->|same_model| N[Switch to Next Channel with Same Model]
    L -->|custom_fallbacks| O[Fallback to Configured Model or Channel]
    
    M --> H
    N --> H
    O --> H
    K -->|No or Retries Exhausted| P[Return Upstream Error with Complete failover_chain Trace]
```

### 1. Multi-Dimensional Addressing Modes
*   **Model Auto-Routing (`/v1/*`)**: Extracts the `model` parameter from the request body, matches available channels offering that model, and routes to the channel with the highest `priority`.
*   **Explicit Prefix Routing (`/providers/{channel}/...`)**: Pins the request to a specific channel, completely bypassing model matching. Ideal for testing dedicated providers or targeted workloads.
*   **Type-Forced Routing (`/openai/*` & `/anthropic/*`)**: Explicitly locks protocol matching to prevent cross-provider endpoint ambiguities.
*   **Routing Visibility Isolation**:
    *   `direct`: Participates in standard model auto-routing.
    *   `explicit_only`: **Hidden** from general model matching; only accessible via explicit path prefixes or as an explicit Alias target. Perfect for dedicated warm/cold standby channels.

### 2. First-Class Virtual Model Aliases (Virtual Route / Alias)
Aliases in LRS maintain an independent lifecycle beyond simple name replacements:
*   **Ordered Multi-Target Binding**: A virtual alias (e.g. `fast`) can bind multiple ordered targets (e.g. `primary:gpt-4o-mini` → `backup:claude-3-5-haiku`). If the primary target fails, the gateway proceeds to the next target automatically.
*   **Upstream Model Masking & Rewriting**: Toggle `returnRealModel`. When disabled, the gateway rewrites the model field in upstream responses back to the virtual alias name, keeping implementation details completely hidden from client tools.
*   **Independent Authorization & Policies**: API key model whitelists evaluate against the alias name directly. Aliases also maintain their own fallback rules, avoiding unwanted inheritance from underlying models.
*   **Catalog Visibility Toggle**: Choose whether an alias appears in `/v1/models` catalog listings exposed to clients.

### 3. Multi-Tiered Failover & Self-Healing (Failover Policy)
When network turbulence, rate limits (429), or service outages occur, LRS recovers silently in the background:
*   **Granular Triggers**: Freely toggle triggers for **Request Timeout**, **Network Errors**, **HTTP 429 (Rate Limit / Quota Exhaustion)**, and **HTTP 5xx (Server Errors)**.
*   **Hierarchical Fallback Stages**:
    1.  **In-Channel Retry** (`retryAttempts`): Mitigate transient network glitches on the current channel.
    2.  **Same-Model Cross-Channel Failover** (`same_model`): Automatically switch to the next highest priority provider hosting the identical model.
    3.  **Custom Cross-Model Cascade** (`customModelFallbacks`): Define custom degradation chains (e.g. `claude-3-7-sonnet` → `claude-3-5-sonnet` → `backup:gpt-4o`).
*   **Full Audit Trail**: Every attempt and hop is stored in the database (`failover_from`, `failover_chain`, `failover_reason`, `retry_attempt`), providing full transparency during post-incident reviews.

### 4. Deep Ecosystem Compatibility Layers
*   **OpenAI Responses API ↔ Chat Completions Real-time Conversion**:
    Codex CLI and Codex App rely natively on `/v1/responses`. For upstreams that only support standard Chat Completions, configure `responsesMode: chat_compat`. LRS translates request structures and bidirectional SSE streaming events on the fly, empowering Codex with any standard OpenAI-compatible provider.
*   **Claude Code Cloaking Bypass (`claudeCodeCompat`)**:
    Certain third-party Claude Code OAuth proxies (such as cliproxyapi) cloak non-official clients by dropping custom `system` prompts. Enabling this mode automatically migrates the `system` prompt into the first `user` turn before forwarding, ensuring your personalized instructions reach the model untouched.
*   **Channel-Level System Prompt Merge**:
    Configure preset system prompts per provider. The gateway intelligently combines them with any request-level `system` prompts rather than destructively overwriting them.

---

## Core Strength 2: Tailored for Personal Developer Workflows & Safety

### 1. Ultra-Lightweight with Zero Maintenance Overhead
*   **Native SQLite Engine**: Single-file storage with instant persistence. Avoids running heavy external PostgreSQL instances and operates smoothly on low-spec (512MB RAM) servers (full PostgreSQL support is also included for high-concurrency environments).
*   **Single Administrator Architecture**: A single `GATEWAY_API_KEY` serves as both the gateway master key and the web console password—no user management overhead.
*   **One-Click Provider Presets**: Built-in quick configurations for OpenAI, Anthropic, DeepSeek, and Volcengine Ark CodingPlan (dual OpenAI / Anthropic protocols).
*   **Upstream Model Probing & 24h Auto-Sync**: Probe and preview available models from `/v1/models` in one click. Enable `autoSyncModels` to schedule daily automatic model catalog refreshes.

### 2. Centralized Toolchain Management (Managed API Keys)
Issue separate sub-keys for different devices, projects, or applications (e.g. `cursor-macbook`, `claude-code-cli`, `raycast`):
*   **Model Whitelists (Allowed Models)**: Restrict specific keys to cheaper models or virtual aliases, preventing misconfigured plugins from invoking expensive flagship models.
*   **Hard Cost Quotas (Safety Interceptor)**: Assign exact USD budget limits (e.g. `$5.00`). Once the threshold is met, the gateway immediately rejects subsequent requests with HTTP 429, **physically preventing runaway autonomous agent loops from running up massive bills**.

### 3. Microscopic Full-Text Logging & Observability
*   **Full-Payload Historical Replay**: Stores the **raw client request**, the **forwarded upstream request**, and the **full upstream response**, with sensitive tokens automatically redacted. Troubleshoot agent failures directly in the web console without setting up local proxies or packet sniffers.
*   **Real-time Live Stream**: A 3-second polling live monitor lets you watch prompt traffic stream across providers as you code.
*   **Detailed Latency Breakdown**: Inspect First Chunk time, Time-to-First-Token (TTFT), total generation duration, and token generation velocities.

### 4. High-Precision Prompt Cache & Cost Accounting
*   **Deep Prompt Cache Support**: Accurately tracks Anthropic cache creations (differentiating 5-minute vs. 1-hour TTL pricing brackets), cache reads, and OpenAI cached prompt token discounts.
*   **Formula-Level Cost Breakdown**: The log viewer features an explicit "Cost Breakdown" tab showing the exact calculation formula (Input × Price + Output × Price + Cache Read/Write rates).
*   **Models.dev Integration with Manual Overrides**: Synchronizes global baseline pricing from models.dev automatically, with support for per-model and per-channel manual overrides.

---

## Toolchain Integration Guide

Once LRS is running, redirect your local developer tools to your gateway endpoint (default: `http://localhost:3300`).

### 1. Cursor / Windsurf
In your editor's AI settings, switch to a custom OpenAI-compatible endpoint:
*   **OpenAI Base URL**: `http://localhost:3300/v1`
*   **API Key**: Your master `GATEWAY_API_KEY` or a dedicated Managed Key
*   **Model**: Specify real models (e.g. `claude-3-7-sonnet`) or your configured aliases (e.g. `fast`)

### 2. Claude Code CLI
Easily redirect the official Claude Code CLI via environment variables:
```bash
export ANTHROPIC_BASE_URL="http://localhost:3300"
export ANTHROPIC_API_KEY="your-gateway-key"
claude
```
> 💡 When routing through third-party Claude Code proxies, enable `claudeCodeCompat: true` on the Anthropic channel to prevent system prompt cloaking.

### 3. Codex CLI / Codex App (Responses API)
For upstreams that do not natively support the Responses API, set `responsesMode` to `chat_compat` on the channel:
*   **API Base URL**: `http://localhost:3300`
*   **API Key**: Your gateway key
*   Requests targeting `/v1/responses` will be automatically translated into `/v1/chat/completions` and returned as valid Responses API streaming events.

### 4. Python / OpenAI SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3300/v1",
    api_key="your-gateway-key"
)

response = client.chat.completions.create(
    model="fast", # Can be a virtual alias
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## Quick Start

### Method 1: Docker Compose (Recommended, SQLite, 5 Seconds Setup)

Create a `docker-compose.yml`:

```yaml
services:
  lrs:
    image: ghcr.io/gojam11/llmrelayservice:main
    container_name: lrs
    restart: unless-stopped
    ports:
      - "3300:3300"
    environment:
      - GATEWAY_API_KEY=sk-lrs-your-secret-password-here
      - DATABASE_URL=sqlite:///data/llm-relay.db
    volumes:
      - lrs_data:/data

volumes:
  lrs_data:
```

Start the service:
```bash
docker compose up -d
```
Open `http://localhost:3300` in your browser and log in with your `GATEWAY_API_KEY`.

### Method 2: Local Development from Source (Bun)

```bash
# 1. Clone repository
git clone https://github.com/GoJam11/LLMRelayService.git
cd LLMRelayService

# 2. Install dependencies
bun install

# 3. Configure environment variables (defaults to SQLite)
cp .env.example .env
# Edit .env to set GATEWAY_API_KEY and DATABASE_URL

# 4. Run database migrations
bun run db:migrate

# 5. Start development servers (backend + frontend hot reload)
bun run dev
```

---

## Send Your First Request

After adding a provider in the console's **Providers** tab, verify connectivity using `curl`:

```bash
# OpenAI format request
curl http://localhost:3300/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "ping" }]
  }'

# Anthropic format request
curl http://localhost:3300/v1/messages \
  -H "x-api-key: $GATEWAY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 64,
    "messages": [{ "role": "user", "content": "ping" }]
  }'
```

View the detailed latency, token metrics, and payload in the console **Logs** view.

---

## Deployment Guide

### 1. SQLite Volume Mount (Single Container, Most Resource Efficient)
```bash
docker run -d \
  --name lrs \
  -p 3300:3300 \
  -e GATEWAY_API_KEY=your-secure-key \
  -e DATABASE_URL=sqlite:///data/llm-relay.db \
  -v lrs_data:/data \
  ghcr.io/gojam11/llmrelayservice:main
```

### 2. External PostgreSQL (Multi-Instance / High-Concurrency Setups)
```bash
docker run -d \
  --name lrs \
  -p 3300:3300 \
  -e GATEWAY_API_KEY=your-secure-key \
  -e DATABASE_URL=postgresql://user:password@host:5432/lrs_db \
  ghcr.io/gojam11/llmrelayservice:main
```

---

## Web Console

Access `http://localhost:3300` to interact with the web dashboard:

| Routing Overview & Failover | Model Catalog & Custom Pricing | Request Audit & Payload Inspection |
|:---:|:---:|:---:|
| ![Routing Rules](docs/screenshots/lrs-routing.png) | ![Model Catalog](docs/screenshots/lrs-models.png) | ![Request Logs](docs/screenshots/lrs-logs.png) |

*   **Monitor**: Real-time TTFT metrics, cache hit rate distribution, token trends, and traffic share by provider.
*   **Providers**: Enable/disable channels, adjust priority, probe reachability, configure 24h auto-sync, and import/export configs.
*   **Routes**: Configure virtual aliases, multi-target cascades, and failure mitigation policies.
*   **Models**: Review context windows, input/output/cache prices, and set manual overrides per model.
*   **Logs**: Master-detail request browser with Live mode, full payload views, header inspection, and transparent cost formulas.
*   **Keys**: Issue per-application API keys, configure model allowlists, and enforce USD spending limits.

---

## Environment Variables

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `GATEWAY_API_KEY` | ✅ | - | Master admin key used for client authentication and console login |
| `DATABASE_URL` | ✅ | - | Database URI. SQLite: `sqlite:./data/llm-relay.db`; PostgreSQL: `postgresql://...` |
| `PORT` | - | `3300` | Port for the HTTP server |
| `UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS` | - | `300000` | Timeout waiting for upstream response headers for standard requests (ms) |
| `UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS` | - | `300000` | Timeout waiting for upstream response headers for streaming requests (ms) |
| `UPSTREAM_RESPONSE_IDLE_TIMEOUT_MS` | - | `300000` | Idle timeout for streaming response bodies (ms); `0` disables |
| `DEBUG_DB_MAX_RECORDS` | - | `50000` | Maximum request logs retained before rolling cleanup |

---

## OpenAPI Management Surface

LRS exposes a comprehensive headless management API under `/api/v1/*` for automated orchestration via scripts, CLI tools, Raycast extensions, or AI agents.  
All endpoints require `Authorization: Bearer $GATEWAY_API_KEY`:

*   `GET/POST/PATCH/DELETE /api/v1/providers`: Manage and test provider channels
*   `GET/POST/PATCH/DELETE /api/v1/aliases`: Configure virtual model aliases and multi-target chains
*   `GET/PATCH /api/v1/settings/failover`: Dynamically update failover policies and triggers
*   `GET/POST/PUT/DELETE /api/v1/keys`: Manage sub-keys, model whitelists, and cost quotas
*   `GET /api/v1/requests` & `GET /api/v1/requests/:id`: Query audit logs and inspect payloads
*   `GET /api/v1/stats/overview`: Aggregate usage and latency telemetry

---

## License

Released under the [MIT](LICENSE) License. Issues and pull requests are warmly welcomed!  
Community discussion: [linux.do Thread](https://linux.do/t/topic/2056392)

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
  <img alt="Star History Chart"
    src="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
</picture>
