# Routing Rules

> Back to [README](../README.en.md)

LRS routes on a **per-provider / per-channel** basis instead of merging same-named models across channels into a single global model pool. A request always lands on one concrete channel, which then forwards it to its own upstream model.

## Core concepts

- **Channel models**: A provider's `models` list only declares "which models this channel claims to support". Even if several channels configure `gpt-4o`, they remain distinct routing targets inside LRS; auto-routing simply picks among the candidate channels by priority.
- **Model alias**: An alias is an externally exposed virtual model name, not just a forwarding shortcut. When a client requests an alias, LRS applies the API-key model allowlist, model-level fallback rules, and logging against the alias name itself; only when actually forwarding upstream does it rewrite the request body's `model` to the real model bound to the alias.
- **Explicit channel target**: To point at a specific model on a specific channel, use `channel:model`, e.g. `backup:gpt-4o-mini`. This avoids mistaking a same-named model on another channel for the same fallback target.

So the alias `fast` can carry a full model-level configuration independent of `gpt-4o`; even if `fast` currently forwards to `gpt-4o`, it does not inherit `gpt-4o`'s fallback rules.

## Explicit prefix routing

```
{METHOD} /providers/{channelName}/{path...}
```

Prefixing the path with `/providers/` matches the channel named `channelName` directly and forwards the remaining path verbatim to the upstream. For example:

```
POST /providers/my-channel/v1/messages
POST /providers/my-channel/v1/chat/completions
```

## Model auto-routing

```
{METHOD} /v1/{path...}
```

LRS reads the `model` field from the request body, matches candidate channels against each channel's `models` list, and picks the highest `priority`. For example:

```
POST /v1/messages
POST /v1/chat/completions
```

If `model` is an alias configured on the Routes page, it resolves only to the channel and real model bound to that alias — it will not expand the alias's real model to other same-named channels. This lets an alias serve as a stable external virtual model with its own API-key allowlist and fallback policy.

## Model fallback targets

Custom model fallbacks on the Routes page match rules by the **original `model` value in the request**. An alias matches its own rules as an independent virtual model and does not follow the rules of the real model it forwards to.

A fallback target supports two forms:

| Form | Meaning |
|------|---------|
| `mini` | A routing alias; forwarded by the channel and real model the alias is bound to |
| `backup:gpt-4o-mini` | The `gpt-4o-mini` model specifically on the `backup` channel |

Example:

```text
request model: fast
fallback targets: mini, backup:gpt-4o-mini
```

Here `fast` and `mini` are both virtual model names; each can be bound to a real upstream model and can have its own independent model-level fallback configuration.

## Authentication

| Channel type | How the client passes the key |
|--------------|-------------------------------|
| `anthropic` | `x-api-key: <GATEWAY_API_KEY>` |
| `openai` | `Authorization: Bearer <GATEWAY_API_KEY>` |

After the gateway validates the key, it replaces the client-supplied auth header with the upstream credential configured on the channel.
