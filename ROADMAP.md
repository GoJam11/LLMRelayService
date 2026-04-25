# Roadmap

This file tracks planned features and long-term directions for LLMRelayService.

---

## Planned

### OpenAI Responses API ↔ Chat Completions Adapter

**Goal**: Accept requests on the `/v1/responses` endpoint and proxy them to backend providers that only support `/v1/chat/completions` (i.e., almost every LLM provider today), then convert the response back to Responses API format.

This is bidirectional: the gateway also needs to support clients that speak Chat Completions talking to providers that expose Responses API.

**Why it's complex**:

The two APIs are structurally different at every layer:

| Dimension | Chat Completions | Responses API |
|---|---|---|
| Input | `messages[]{role, content}` | `input[]{role, content[]{type, text}}` |
| System prompt | `messages[0]{role:"system"}` | Top-level `instructions` field |
| Streaming events | `choices[].delta.content` | `response.output_text.delta` + typed event envelope |
| Tool calls | `tool_calls[]` in delta | `function_call_arguments.delta` events |
| Multi-turn state | Stateless (caller manages history) | Stateful via `previous_response_id` |
| Output structure | `choices[0].message.content` | Typed `output[]` items |

**Conversion work items**:

- [ ] Request translator: `ResponsesApiRequest` → `ChatCompletionsRequest`
  - Flatten `input[]` items into `messages[]`
  - Map `instructions` → system message
  - Handle `input_text`, `input_image`, `output_text` content types
  - Strip `previous_response_id` (stateful context management TBD)
- [ ] Response translator (non-streaming): `ChatCompletionsResponse` → `ResponsesApiResponse`
  - Wrap `choices[0].message.content` into typed `output[]` items
  - Map `finish_reason` → `status`
  - Map `usage` fields
- [ ] Streaming adapter: Convert `text/event-stream` from Chat Completions SSE format to Responses API SSE format
  - `delta.content` → `response.output_text.delta` events
  - Wrap with `response.created`, `response.in_progress`, `response.completed` lifecycle events
  - Tool call delta events: `tool_calls[].function.arguments` → `response.function_call_arguments.delta`
- [ ] Route configuration: let admins specify which endpoint format a route accepts
- [ ] Multi-turn `previous_response_id`: either store response history in DB or reject with a clear error

**References**:
- [Responses API Reference](https://platform.openai.com/docs/api-reference/responses)
- [Migration guide from Chat Completions](https://platform.openai.com/docs/guides/migrate-to-responses)

---

### Token Usage Fallback Estimation

**Goal**: When an upstream provider doesn't return usage data (returns all zeros), estimate `input_tokens` and `output_tokens` from the actual request/response text. This keeps cost tracking and analytics meaningful even for providers that omit billing info (local models, some proxy layers, etc.)

**Current behavior**: `parseUsageForProvider` returns `createEmptyUsage()` (all zeros) when no usage field is present in the response. Downstream pricing/logging then records 0 tokens.

**Proposed approach**:

1. **Detection**: After parsing, if `input_tokens === 0 && output_tokens === 0`, flag as "needs estimation"
2. **Tokenizer**: Use `js-tiktoken` (WASM-based, works in Bun) for token counting
   - GPT/OpenAI models: `encoding_for_model(model)` gives exact counts
   - Anthropic, others: `cl100k_base` encoding is a reasonable approximation
   - Chain: exact tokenizer → `cl100k_base` fallback → character heuristic (`text.length / 4`) as last resort
3. **Input estimation**: Serialize request messages to text, count tokens. For Chat Completions, account for per-message overhead (~4 tokens per message)
4. **Output estimation**: Buffer accumulated streaming response text; count after stream ends
5. **Provenance flag**: Add `estimated: boolean` to `UsageData` so UI can display "(estimated)" and pricing reports can separate actual vs inferred data

**Key implementation files**:
- `src/providers/types.ts` — add `estimated?: boolean` to `UsageData`
- New `src/token-estimator.ts` — tokenizer wrapper with tiered fallback
- `src/providers/openai.ts` / `anthropic.ts` — call estimator when usage is zero
- `src/response-observer.ts` — pass request body to the parser for input estimation
- `src/console-store.ts` / dashboard — surface the `estimated` flag in UI

**Notes**:
- `js-tiktoken` loads a WASM binary; init once and reuse the encoder (not per-request)
- Streaming: output text must be fully accumulated before counting — the existing `response-observer.ts` streaming accumulation logic already does this
- Estimation only runs when the provider returns zero; it never overwrites real usage data

---

## Ideas / Backlog

- Rate limiting per API key
- Per-route spend caps and budget alerts
- Fallback routing: automatic retry on a secondary provider on upstream error
- Request/response caching for identical prompts
