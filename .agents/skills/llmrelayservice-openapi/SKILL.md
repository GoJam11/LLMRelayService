---
name: llmrelayservice-openapi
description: Use when Codex needs to inspect or manage a running LLMRelayService instance through its OpenAPI-compatible management API, including providers, managed API keys, model aliases, request logs, and stats. Also use when a user asks to connect to LLMRelayService with local cached credentials, configure LRS OpenAPI access, query `/api/v1/*`, or automate LRS administration without using the web console.
---

# LLMRelayService OpenAPI

## Core Rule

Use the bundled helper first:

```bash
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py request GET /providers
```

The helper reads local credentials from `.agents/skills/llmrelayservice-openapi/.auth.json`. If that file is missing, ask the user for:

- Base URL, for example `http://127.0.0.1:3300`
- `GATEWAY_API_KEY`

Then save it with:

```bash
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py configure \
  --base-url "http://127.0.0.1:3300" \
  --token "<GATEWAY_API_KEY>"
```

Never print, commit, summarize, or paste the token. The credential file is intentionally ignored by `.gitignore`.

## Workflow

1. Check the task scope. Use `/api/v1/*` for management: providers, keys, aliases, requests, and stats.
2. Check credentials with `status`. If missing, request credentials from the user and run `configure`.
3. Run the smallest OpenAPI request that answers the task.
4. Summarize results with sensitive fields redacted. Do not expose provider auth values or gateway tokens.
5. For mutations, read current state first, then apply the smallest change, then read back to verify.

## Commands

```bash
# Check local config and server reachability
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py status

# List providers
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py request GET /providers

# Read recent requests
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py request GET /requests \
  --query limit=10 --query range=24h

# Read stats
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py request GET /stats \
  --query range=24h

# Create an OpenAI-compatible provider
python .agents/skills/llmrelayservice-openapi/scripts/lrs_openapi.py request POST /providers --data '{
  "channelName": "example-openai",
  "type": "openai",
  "targetBaseUrl": "https://api.example.com/v1",
  "models": ["example-model"],
  "priority": 10,
  "auth": { "header": "authorization", "value": "<UPSTREAM_API_KEY>" },
  "responsesMode": "chat_compat"
}'
```

## Endpoint Reference

Read `references/openapi.md` when you need endpoint shapes, request bodies, filters, or routing examples.

Important defaults:

- Base path: `/api/v1`
- Auth header: `Authorization: Bearer <GATEWAY_API_KEY>`
- Health endpoint: `GET /api/v1/health` does not require auth.
- Provider auth values are secrets. Treat them as write-only unless the user explicitly asks to inspect local config.

## Safety

- Do not use console cookie endpoints for this skill unless the user explicitly asks for web-console behavior.
- Do not write credentials into `.env`, `SKILL.md`, references, changelog, commits, or command output.
- If a mutating call fails, report HTTP status and the error message only; avoid dumping full request bodies that contain credentials.
- Prefer disabling providers or aliases over deleting them when the user intent is reversible or ambiguous.
