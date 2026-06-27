# 路由规则详解

> 返回 [README](../README.md)

LRS 的路由模型以 **Provider / 渠道** 为基础，而不是把不同渠道上的同名模型合并成一个全局模型池。一个请求最终总是落到某个明确的渠道，再由该渠道转发给它自己的上游模型。

## 核心概念

- **渠道模型**：Provider 的 `models` 列表只表示「这个渠道声明支持哪些模型」。即使多个渠道都配置了 `gpt-4o`，它们在 LRS 内部仍然是不同的路由目标；自动路由只是在多个候选渠道之间按优先级选择。
- **模型别名 / alias**：alias 是对外暴露的虚拟模型名，而不仅是简单转发规则。客户端请求 alias 时，LRS 按 alias 名本身做 API key 模型白名单、模型级回退规则匹配和日志记录；只有真正转发上游时，才把请求体里的 `model` 改写成 alias 绑定的真实模型。
- **显式渠道目标**：需要精确指向某个渠道上的某个模型时，使用 `渠道名:模型名` 表达，例如 `backup:gpt-4o-mini`。这能避免把其他渠道上的同名模型误当作同一个 fallback 目标。

因此，`fast` 这个 alias 可以拥有独立于 `gpt-4o` 的完整模型级配置；即使 `fast` 当前转发到 `gpt-4o`，它也不会继承 `gpt-4o` 的回退规则。

## 显式前缀路由

```
{METHOD} /providers/{channelName}/{path...}
```

在路径前加 `/providers/` 前缀，直接匹配 `channelName` 对应的渠道，剩余路径原样转发给上游。例如：

```
POST /providers/my-channel/v1/messages
POST /providers/my-channel/v1/chat/completions
```

## 模型自动路由

```
{METHOD} /v1/{path...}
```

读取请求体中的 `model` 字段，在各渠道的 `models` 列表中匹配候选渠道，按 `priority` 由高到低选择。例如：

```
POST /v1/messages
POST /v1/chat/completions
```

如果 `model` 是 Routes 页面配置的 alias，则只解析到 alias 绑定的渠道和真实模型，不会继续把 alias 指向的真实模型扩展到其他同名渠道。这样 alias 可以作为稳定的对外虚拟模型，单独配置 API key 白名单和回退策略。

## 模型回退目标

Routes 页的自定义模型回退按「请求中的原始 `model` 值」匹配规则。alias 会作为独立虚拟模型匹配自己的规则，不会走它所转发真实模型的规则。

Fallback 目标支持两种写法：

| 写法 | 含义 |
|------|------|
| `mini` | 路由 alias，按 alias 绑定的渠道和真实模型转发 |
| `backup:gpt-4o-mini` | 指定 `backup` 渠道上的 `gpt-4o-mini` 模型 |

示例：

```text
请求 model: fast
Fallback 目标: mini, backup:gpt-4o-mini
```

这里 `fast`、`mini` 都是虚拟模型名；它们各自可以绑定到真实上游模型，也可以分别拥有独立的模型级回退配置。

## 认证

| 渠道类型 | 客户端传入方式 |
|---------|--------------|
| `anthropic` | `x-api-key: <GATEWAY_API_KEY>` |
| `openai` | `Authorization: Bearer <GATEWAY_API_KEY>` |

网关验证通过后，会用渠道配置的上游凭证替换客户端传入的认证头。
