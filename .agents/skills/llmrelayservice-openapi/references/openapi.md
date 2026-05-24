# LLMRelayService OpenAPI Reference

Base path: `/api/v1`

Authentication: `Authorization: Bearer <GATEWAY_API_KEY>` for every endpoint except `GET /health`.

Responses usually use:

```json
{ "data": {} }
```

Errors use:

```json
{ "error": "message" }
```

## Health

- `GET /health`

## Providers

- `GET /providers`
- `GET /providers/:channelName`
- `POST /providers`
- `PATCH /providers/:channelName`
- `DELETE /providers/:channelName`
- `PATCH /providers/:channelName/enabled`

Provider create/update body:

```json
{
  "channelName": "my-openai",
  "type": "openai",
  "targetBaseUrl": "https://api.openai.com/v1",
  "systemPrompt": null,
  "models": ["gpt-4o", "gpt-4o-mini"],
  "priority": 100,
  "auth": {
    "header": "authorization",
    "value": "sk-xxxx"
  },
  "responsesMode": "native",
  "extraFields": null
}
```

Provider fields:

- `type`: `openai` or `anthropic`
- `auth.header`: `authorization` for OpenAI-compatible upstreams, `x-api-key` for Anthropic-compatible upstreams
- `responsesMode`: OpenAI only. Use `native`, `chat_compat`, or `disabled`.
- `targetBaseUrl`: OpenAI-compatible URLs should include `/v1`; Anthropic-compatible URLs may omit `/v1`.

Enable/disable body:

```json
{ "enabled": true }
```

## Requests

- `GET /requests`
- `GET /requests/:requestId`

Query filters for `GET /requests`:

- `limit`
- `offset`
- `route`
- `model`
- `client`
- `api_key_name`
- `search`
- `status`: `success` or `error`
- `cache_state`: `hit`, `create`, `miss`, `bypass`, or `error`
- `range`: `1h`, `24h`, `72h`, `7d`, or `30d`
- `sort_by`
- `sort_order`

## Stats

- `GET /stats`

Accepts the same filters as `GET /requests` except pagination.

## Managed API Keys

- `GET /keys`
- `GET /keys/:id`
- `POST /keys`
- `PATCH /keys/:id`
- `DELETE /keys/:id`
- `PATCH /keys/:id/allowed-models`

Create or rename body:

```json
{ "name": "my-key" }
```

Set allowlist body:

```json
{ "models": ["gpt-4o", "gpt-4o-mini"] }
```

## Model Aliases

- `GET /aliases`
- `POST /aliases`
- `PATCH /aliases/:id`
- `PATCH /aliases/:id/enabled`
- `DELETE /aliases/:id`

Create/update body:

```json
{
  "alias": "gpt-4o",
  "provider": "my-openai",
  "model": "gpt-4o-2024-08-06",
  "description": "GPT-4o main model",
  "enabled": true
}
```

Enable/disable body:

```json
{ "enabled": true }
```

## Gateway Forwarding

OpenAPI management is separate from model forwarding. For forwarding tests, use gateway routes directly with the same `GATEWAY_API_KEY`:

```bash
curl -sS "$BASE_URL/providers/<channelName>/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "content-type: application/json" \
  --data '{"model":"<model>","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":16}'
```

Explicit route:

```text
{METHOD} /providers/{channelName}/{path...}
```

Model auto-route:

```text
{METHOD} /v1/{path...}
```

OpenAI-compatible clients use `Authorization: Bearer <GATEWAY_API_KEY>`. Anthropic-compatible clients use `x-api-key: <GATEWAY_API_KEY>`.
