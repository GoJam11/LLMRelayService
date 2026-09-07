# LRS — LLM Relay Service

> 专为个人开发者与独立团队打造的 **智能 LLM 流量中枢 + 故障自愈网关 + 全景可观测控制台**

**简体中文** | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org)
[![Docker Image](https://img.shields.io/badge/ghcr.io-gojam11%2Fllmrelayservice-blue?logo=docker)](https://github.com/GoJam11/LLMRelayService/pkgs/container/llmrelayservice)

---

LRS 是一个基于 **Bun + Hono** 构建的轻量高可用 LLM 中继网关。它把分散在各大 AI 服务商的凭据统一在单一入口之下，并提供**强大的多级路由调度、虚拟模型别名、自动容灾自愈、生态协议兼容**以及**显微镜级的全文日志与 Prompt Cache 计费精算**。

![LRS 监控仪表盘](docs/screenshots/lrs-monitor.png)

> 💡 **为什么是 LRS 而不是商业化中继？**  
> 像 One-API / NewAPI 这类中继系统承载了过多的商业化包袱：注册邀请、充值卡密、多租户配额、繁复的用户组与重型依赖。  
> **LRS 专为个人开发者打磨**：
> - **零运维负担**：原生支持 SQLite 单文件数据库，单容器 5 秒跑起，资源占用极低；
> - **安全防翻车**：分应用发 Key、按 Key 限制模型白名单，并支持设置**美元费用硬额度**，彻底杜绝 AI Agent 死循环刷爆钱包；
> - **超强调度力**：支持虚拟模型别名（Alias）、有序多目标 Fallback、超时/429 自动跨渠道自愈；
> - **真实无损透传**：默认不对请求做多余的转换，保留原始字段与流式协议；同时针对 Codex（Responses API 互转）和 Claude Code（伪装穿透）提供针对性兼容黑科技。

---

## 目录

- [核心痛点与解法](#核心痛点与解法)
- [核心能力一：超强路由调度与自愈体系](#核心能力一超强路由调度与自愈体系)
- [核心能力二：为个人量身打造的开发与安全体验](#核心能力二为个人量身打造的开发与安全体验)
- [典型工具链接入指南](#典型工具链接入指南)
- [快速开始](#快速开始)
- [部署指南](#部署指南)
- [Web 控制台](#web-控制台)
- [环境变量配置](#环境变量配置)
- [OpenAPI 管理面](#openapi-管理面)
- [License](#license)

---

## 核心痛点与解法

| 开发者日常痛点 | LRS 的优雅解法 |
| :--- | :--- |
| **多工具配置零散**：Cursor、Claude Code、Cline、Codex、Raycast 到处填真实 Key | 统一收拢至 LRS，上游真实 Key 安全代填，各端只配置网关地址与子 Key |
| **上游突然限流/故障**：写代码正顺畅，遇到 429 或 5xx 导致 Agent 直接崩溃中断 | **多级容灾自愈**：超时/429/网络异常自动重试并降级至备用渠道或备用模型 |
| **模型名太长或想动态切上游**：不同服务商的模型 ID 各异，切换成本高 | **虚拟模型别名（Alias）**：对外暴露 `fast` / `code`，内部自由绑定多目标与回退顺序 |
| **Codex CLI/App 想用非官方模型**：Codex 强依赖 Responses API，第三方上游不支持 | **双向兼容转换**：渠道开启 `responsesMode: chat_compat`，网关自动完成 Responses ↔ Chat Completions 互转 |
| **Claude Code 代理 Cloak 截断**：部分 OAuth 代理对普通客户端强行丢弃自定义 System Prompt | **伪装穿透模式**：开启 `claudeCodeCompat`，自动将 System 挪入 User 消息，绕过代理截断 |
| **AI Agent 死循环刷爆账单**：复杂的自动化脚本或自主 Agent 陷入死循环大量消耗 Token | **按 Key 设置费用硬额度**：超出设定金额（如 $5）即时拦截（429），守护钱包安全 |
| **Prompt Cache 算不清成本**：大部分网关把缓存 Token 算作 $0 或无法区分 TTL | **高精度计费引擎**：精准识别 Anthropic 5m/1h 缓存写入单价与缓存读取，日志公式完全透明 |
| **上游出了问题无从查起**：只知道报错 500，不知道具体发了什么请求体 | **全文请求审计**：完整保留原始请求、转发请求与上游响应体，排障一目了然 |

---

## 核心能力一：超强路由调度与自愈体系

LRS 的路由以 **Provider / 渠道** 为一等公民，构建了从寻址、调度、改写到多级自愈的完整链路。

```mermaid
flowchart TD
    A[客户端请求] --> B{寻址模式}
    B -->|显式指定 /providers/:channel/*| C[直连指定渠道]
    B -->|协议强行 /openai/* 或 /anthropic/*| D[锁定协议类型]
    B -->|标准入口 /v1/*| E{请求模型是 Alias?}
    D --> E
    
    E -->|是| F[解析 Alias 目标链: Provider + Model]
    E -->|否| G[匹配候选渠道，按 Priority 降序排队]
    
    F --> H[发起上游调用]
    G --> H
    C --> H
    
    H --> I{请求是否成功?}
    I -->|是 200| J[记录全文日志 / 计费并返回]
    I -->|触发重试/异常: 超时, 429, 5xx, 网络错误| K{是否满足 Failover 策略?}
    
    K -->|是| L{选择回退模式}
    L -->|Alias 下一目标| M[尝试 Alias 备用 Provider/Model]
    L -->|same_model| N[切换同模型下一个渠道]
    L -->|custom_fallbacks| O[降级到备用模型或渠道]
    
    M --> H
    N --> H
    O --> H
    K -->|否或重试耗尽| P[返回上游错误，保留完整 failover_chain]
```

### 1. 多维度寻址模式
*   **模型自动路由（`/v1/*`）**：自动提取请求体中的 `model` 字段，跨所有启用的渠道匹配候选，依据 `priority` 优先级由高到低选择主用渠道。
*   **显式渠道路由（`/providers/{channel}/...`）**：精准指定渠道分发，完全旁路模型自动匹配，用于特定服务商压测或专用任务。
*   **协议强行路由（`/openai/*` 与 `/anthropic/*`）**：强制请求按特定服务商协议解析，彻底杜绝端点冲突。
*   **路由可见性隔离（Routing Visibility）**：
    *   `direct`：参与全局模型自动寻址；
    *   `explicit_only`：从全局模型池中**隐身**，只能通过显式前缀或 Alias 目标精确调用，适合用于冷备渠道或私密测试通道。

### 2. 一等公民的虚拟模型与别名（Virtual Route / Alias）
Alias 在 LRS 中拥有独立生命周期，远不止简单的重命名：
*   **有序多目标绑定**：一个虚拟别名（如 `fast`）可绑定多个上游目标（如 `primary-channel:gpt-4o-mini` → `backup-channel:claude-3-5-haiku`），主目标故障自动顺延。
*   **真实模型遮蔽与改写**：可自由开关 `returnRealModel`。开启时上游返回真实模型；关闭时网关会将响应体内的模型名改回虚拟别名，对客户端完全透明。
*   **独立鉴权与策略**：API Key 的模型白名单直接对 Alias 生效；Alias 拥有独立的回退策略，不会误继承真实底层模型的全局策略。
*   **目录可见性开关**：可自主决定是否在 `/v1/models` 列表中对客户端公开展示。

### 3. 多级故障转移与容灾自愈（Failover Policy）
遇到网络波动、模型限流（429）或服务商故障时，LRS 能在后台静默自愈，无需客户端重试：
*   **精细化触发条件**：支持自由勾选是否在 **请求超时**、**网络断开**、**HTTP 429（Rate Limit）**、**HTTP 5xx** 时触发故障转移。
*   **多级降级梯度**：
    1.  **渠道内重试**（`retryAttempts`）：对偶发网络波动先在当前渠道轻量重试；
    2.  **同模型跨渠道切换**（`same_model`）：无缝切换至下一个拥有相同模型的服务商；
    3.  **自定义跨模型降级**（`customModelFallbacks`）：自由配置模型梯队，例如 `claude-3-7-sonnet` 失败自动降级到 `claude-3-5-sonnet` 或 `backup:gpt-4o`。
*   **全流程轨迹追踪**：日志系统会如实记录每一步的转移过程（`failover_from`、`failover_chain`、`failover_reason`），排查异常一清二楚。

### 4. 深度生态兼容层（黑科技）
*   **OpenAI Responses API ↔ Chat Completions 自动互转**：
    Codex CLI / Codex App 原生仅支持 OpenAI `/v1/responses` 协议。针对自托管模型或不支持该协议的第三方中转商，渠道只需开启 `responsesMode: chat_compat`，LRS 即可在网关层完成请求与双向流式 SSE 的全自动转换，让任意 OpenAI 兼容端点驱动 Codex。
*   **Claude Code 伪装穿透（`claudeCodeCompat`）**：
    部分 Claude Code OAuth 代理服务（如 cliproxyapi）检测到非官方客户端时会进行 cloak（强行丢弃请求中的自定义 `system` 提示词）。开启该模式后，LRS 会自动把 `system` 挪入第一条 `user` 消息中透传，确保个人定制的 Prompt 毫发无损地抵达模型。
*   **渠道级 Prompt 智能合并**：
    在渠道配置预置系统提示词，网关在转发前会自动与客户端请求携带的 `system` 进行合并，而非暴力覆盖。

---

## 核心能力二：为个人量身打造的开发与安全体验

### 1. 极简轻量，零维护成本
*   **原生 SQLite 驱动**：单文件存储，部署即持久化，无需繁重且消耗内存的外部 PostgreSQL，单核 512MB VPS 即可极速跑起（高并发场景亦可随时无缝接入 PostgreSQL）。
*   **纯粹单管理员体系**：使用单一 `GATEWAY_API_KEY`，既是网关访问密钥，又是 Web 控制台密码，免去繁琐的账号/密码/权限配置。
*   **预置常用渠道模板**：内置 OpenAI、Anthropic、DeepSeek、火山方舟 CodingPlan（OpenAI / Anthropic 双协议）等一键填报预设。
*   **上游模型一键探活与 24h 自动同步**：支持一键拉取上游可用模型；开启 `autoSyncModels` 后每日自动同步，告别手工录入。

### 2. 统一收拢个人工具链（Managed API Keys）
为不同的应用、终端或好友分发专属 Key（如 `cursor-dev`、`claude-code-cli`、`raycast`）：
*   **模型白名单（Allowed Models）**：给某个工具限制只允许访问 `fast` 别名或 `gpt-4o-mini`，防止某些扩展随意调用昂贵的旗舰模型。
*   **防翻车费用硬额度（Cost Quota）**：为 Key 设置美元上限（如 `$5.00`）。一旦达到预算立刻触发 429 熔断，**从物理层面杜绝自主 Agent 死循环刷爆信用卡的惨剧**。

### 3. 显微镜级的全文日志与调试观测
*   **全文字段级回放**：完整记录**原始客户端请求体**、**真实转发请求体**与**上游完整响应**，所有敏感凭据自动 Redact 脱敏。排查 Agent 异常时无需反复本地抓包，直接在 Web 控制台对比前后差异。
*   **实时 Live 模式**：控制台提供 3 秒轮询的流式监控面板，一边写代码，一边直观感受请求的实时流动。
*   **精细性能拆解**：首包响应时间（First Chunk）、首 Token 延迟（TTFT）、生成耗时与速度一目了然。

### 4. 真正精细的 Prompt Cache 与透明成本核算
*   **深度适配 Prompt Cache**：精准提取并核算 Anthropic 缓存创建（区分 5 分钟与 1 小时 TTL 档位）与缓存读取费用，以及 OpenAI 缓存命中减免，不再出现“缓存命中后整单按 $0 计算”的统计失真。
*   **公式级透明明细**：在日志面板新增「成本明细」Tab，直接将计算公式展开（输入 × 单价 + 输出 × 单价 + 缓存读/写单价），清晰自洽。
*   **价格数据库与手动覆盖**：内置 models.dev 全球价格自动打分收录机制，并支持在「模型」页对任意模型或渠道单独覆盖价格与上下文长度。

---

## 典型工具链接入指南

网关启动后，所有本地工具均可统一接入。网关地址假设为 `http://localhost:3300`。

### 1. Cursor / Windsurf
在 IDE 设置中切换为自定义 OpenAI 接口：
*   **OpenAI Base URL**: `http://localhost:3300/v1`
*   **API Key**: 填入你的管理员 `GATEWAY_API_KEY` 或专用子 Key
*   **Model**: 填写具体模型名（如 `claude-3-7-sonnet`）或你在 LRS 中配置的 Alias（如 `fast`）

### 2. Claude Code CLI
利用环境变量轻松重定向官方 Claude Code：
```bash
export ANTHROPIC_BASE_URL="http://localhost:3300"
export ANTHROPIC_API_KEY="your-gateway-key"
claude
```
> 💡 若上游使用了某些第三方 OAuth 代理，建议在对应 Anthropic 渠道开启 `claudeCodeCompat: true` 穿透伪装。

### 3. Codex CLI / Codex App (Responses API)
针对不支持 Responses API 的普通第三方渠道，在 LRS 渠道设置中将 `responsesMode` 设为 `chat_compat`：
*   **API Base URL**: `http://localhost:3300`
*   **API Key**: 填入网关 Key
*   Codex 发往 `/v1/responses` 的请求会被 LRS 自动转换为 `/v1/chat/completions` 发往上游，流式响应自动逆向封装。

### 4. Python / OpenAI SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3300/v1",
    api_key="your-gateway-key"
)

response = client.chat.completions.create(
    model="fast", # 可以直接填虚拟别名
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

---

## 快速开始

### 方式一：Docker Compose（推荐，内置 SQLite，5 秒启动）

新建 `docker-compose.yml`：

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

运行启动：
```bash
docker compose up -d
```
打开浏览器访问 `http://localhost:3300`，输入 `GATEWAY_API_KEY` 即可进入控制台。

### 方式二：源码本地开发 (Bun)

```bash
# 1. 克隆代码
git clone https://github.com/GoJam11/LLMRelayService.git
cd LLMRelayService

# 2. 安装依赖
bun install

# 3. 复制环境变量并配置（默认使用 SQLite）
cp .env.example .env
# 编辑 .env 确保填妥 GATEWAY_API_KEY 与 DATABASE_URL

# 4. 执行数据库初始化
bun run db:migrate

# 5. 启动开发服务器（前后端热重载）
bun run dev
```

---

## 发送第一个请求

在控制台「渠道（Providers）」页添加第一个上游后，使用 `curl` 即可验证网关连通性：

```bash
# OpenAI 协议调用
curl http://localhost:3300/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "ping" }]
  }'

# Anthropic 协议调用
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
调用完成后，刷新 Web 控制台的「日志」页，即可查看到该笔请求的详细信息。

---

## 部署指南

### 1. SQLite 挂载持久化（单容器，最省资源）
```bash
docker run -d \
  --name lrs \
  -p 3300:3300 \
  -e GATEWAY_API_KEY=your-secure-key \
  -e DATABASE_URL=sqlite:///data/llm-relay.db \
  -v lrs_data:/data \
  ghcr.io/gojam11/llmrelayservice:main
```

### 2. 搭配独立 PostgreSQL（多实例 / 高并发场景）
```bash
docker run -d \
  --name lrs \
  -p 3300:3300 \
  -e GATEWAY_API_KEY=your-secure-key \
  -e DATABASE_URL=postgresql://user:password@host:5432/lrs_db \
  ghcr.io/gojam11/llmrelayservice:main
```

---

## Web 控制台

访问根路径 `http://localhost:3300` 即可进入可视化仪表盘：

| 路由全景与自愈策略 | 模型目录与自定义计价 | 请求审计与全文明细 |
|:---:|:---:|:---:|
| ![路由配置](docs/screenshots/lrs-routing.png) | ![模型目录](docs/screenshots/lrs-models.png) | ![请求日志](docs/screenshots/lrs-logs.png) |

*   **仪表盘（Monitor）**：首字延迟（TTFT）、缓存命中率分布、Token 趋势与渠道调用占比；
*   **渠道管理（Providers）**：渠道启停、优先级设置、连通性探测、24h 模型自动同步与批量导入导出；
*   **路由中心（Routes）**：虚拟别名（Alias）映射、多目标绑定、故障转移策略（重试与 Fallback 链条）；
*   **模型管理（Models）**：上下文长度、输入/输出/缓存单价查阅与逐模型手动覆盖；
*   **请求日志（Logs）**：支持 Live 模式、原始/转发/响应全文查看、请求 Header 溯源与成本公式拆解；
*   **子密钥（Keys）**：按应用分发 API Key、设置模型白名单与美元硬预算限制。

---

## 环境变量配置

| 环境变量 | 必填 | 默认值 | 详细说明 |
| :--- | :---: | :---: | :--- |
| `GATEWAY_API_KEY` | ✅ | - | 全局管理员密钥，既是网关调用凭据也是控制台登录密码 |
| `DATABASE_URL` | ✅ | - | 数据库连接串。SQLite: `sqlite:./data/llm-relay.db`；PostgreSQL: `postgresql://...` |
| `PORT` | - | `3300` | 服务监听端口 |
| `UPSTREAM_DEFAULT_FIRST_BYTE_TIMEOUT_MS` | - | `300000` | 普通非流式请求等待首字节响应超时（毫秒） |
| `UPSTREAM_STREAM_FIRST_BYTE_TIMEOUT_MS` | - | `300000` | 流式请求等待首字节响应超时（毫秒） |
| `UPSTREAM_RESPONSE_IDLE_TIMEOUT_MS` | - | `300000` | 流式响应 body 空闲等待超时（毫秒），`0` 为关闭 |
| `DEBUG_DB_MAX_RECORDS` | - | `50000` | 本地日志最大保留行数，超额自动回滚清理 |

---

## OpenAPI 管理面

LRS 提供标准且全面的 Headless 管理接口（`/api/v1/*`），支持通过脚本、CLI、Raycast 或 AI Agent 进行远程自动化管控。  
所有管理接口均使用 `Authorization: Bearer $GATEWAY_API_KEY` 鉴权：

*   `GET/POST/PATCH/DELETE /api/v1/providers`：渠道配置管理与探活；
*   `GET/POST/PATCH/DELETE /api/v1/aliases`：虚拟模型别名与多目标绑定；
*   `GET/PATCH /api/v1/settings/failover`：动态调整故障转移与重试规则；
*   `GET/POST/PUT/DELETE /api/v1/keys`：管理子 API Key、模型白名单与费用额度；
*   `GET /api/v1/requests` & `GET /api/v1/requests/:id`：审计日志与请求详情拉取；
*   `GET /api/v1/stats/overview`：用量与性能数据聚合。

---

## License

本项目基于 [MIT](LICENSE) 协议开源。欢迎提交 Issue 与 Pull Request！  
社区交流与使用讨论：[linux.do 专帖](https://linux.do/t/topic/2056392)

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)"
    srcset="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
  <img alt="Star History Chart"
    src="https://api.star-history.com/svg?repos=GoJam11/LLMRelayService&type=Date" />
</picture>
