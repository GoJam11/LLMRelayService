# 历史变更记录（日期未标注）

### 修复

- **Models 页面同名模型跨格式展示**：修复 `getModels()` 以 `modelId:type` 作为去重 key，同一模型名若在 Anthropic 渠道和 OpenAI 渠道均有配置，两侧分区将各自独立显示，不再因全局模型 ID 去重而只保留其中一种。
- **Models 页面过滤禁用渠道**：`getModels()` 跳过 `enabled === false` 的渠道，已禁用渠道的模型不再出现在 Models 页面中。

- **Provider 编辑弹窗新增「Sync from Upstream」按钮**：编辑渠道时，Models 区域新增"Sync from Upstream"按钮，点击后调用后端新增的 `GET /__console/api/providers/:channelName/upstream-models` 接口从上游 `/v1/models` 拉取模型列表，通过弹窗展示（支持全选/清空），确认后将选中的模型合并到当前表单，已存在的模型自动跳过。

### 变更

- **日志表格刷新 loading 动画**：手动刷新或筛选条件变化时，表格内容渐隐并显示居中 spinner（`Loader2`），同时"刷新数据"按钮图标自旋、按钮禁用；自动刷新（5s 静默更新）不触发视觉 loading，避免干扰阅读。

- **彻底移除 CC Masquerade 字段**：从 DB schema、控制台 API、前端表单（ProviderFormState、ProviderInfo、ProviderMutationPayload）、UI 展示和 README 中完全移除 `enableCcMasquerade` / `enable_cc_masquerade`；新增 migration `0010` 删除该数据库列。

- **新增 `/openai` 和 `/anthropic` 类型强制端点**：在请求路径中以 `/openai/v1/...` 或 `/anthropic/v1/...` 为前缀，网关将仅在对应类型的渠道中按模型名查找，无需手动指定 channelName。支持 `/openai/v1/chat/completions`、`/anthropic/v1/messages`、`/anthropic/v1/messages/count_tokens` 等。Models 页面新增"显式类型端点"说明卡片。

- **供应商 Auth Method 新增"自动"选项**：编辑/新建供应商时 Auth Method 默认为"自动（按类型）"，Anthropic 自动使用 x-api-key，OpenAI 自动使用 Authorization: Bearer，不再需要用户手动选择。

- **模型上下文兜底**：当 Provider 配置中模型未设置 `context` 时，自动从 models.dev 拉取上下文长度作为兜底（24 小时缓存）；`/v1/models` 和 `/__console/api/models` 接口均已支持。
- **Models 页面新增定价列**：Controls 页新增"输入价格 / 1M"和"输出价格 / 1M"两列，价格数据来自 models.dev（24 小时缓存，USD per million tokens）。

- **新增 Models 页面**：控制台导航栏新增 Models 页面，分 Anthropic 和 OpenAI 两个分组展示当前网关支持的全部模型，包含模型 ID、上下文长度和所属渠道信息。后端新增 `/__console/api/models` 接口返回按类型分组的模型列表。

- **Logs 页面筛选与分页重构**：重构 `useDashboardData` hook，`refreshDashboard` 改为稳定引用（空依赖数组 + useRef），彻底消除筛选变化时因函数重建导致的重复请求；筛选条件变化时自动重置分页到第 1 页；搜索框新增 300ms 防抖，避免每次按键触发 API 请求；手动刷新按钮现在正确携带当前筛选参数；后端 `parseConsoleFilters` 补充 `opencode` 客户端类型到白名单。
- **Logs 分页器样式统一**：翻页器按钮改为标准 shadcn/ui `size-9 text-sm`（原为 `size-8 text-xs`），每页显示选择器字号统一为 `text-sm`，总条数提示字号统一为 `text-sm`，与整体组件风格对齐。
- **Logs 表格新增渠道列**：从"请求"列拆分出独立的"渠道"列，展示路由前缀（含回退箭头）与 upstream 类型，路径列宽随之收窄。
- **Logs 筛选与分页后端化**：筛选选项（routes/models/clients）改为后端查询获取，确保包含所有数据而非仅当前页；排序逻辑（时间/状态/Tokens）迁移到后端，提升大数据量下的性能；新增 `create` 缓存状态筛选选项。
- **移除 CC 伪装能力**：彻底删除 `enableCcMasquerade` 配置项及所有相关运行时逻辑（`disable_cc`/`disableCC` 查询参数、`isCcDisabled`、请求伪装注入头、`applyClaudeCodeMasquerade` 字段等）。历史请求记录中的 `need_cc` 字段保留但始终为 `false`。
- 日志表格 Tokens 列改为分开展示输入和输出 tokens，替代原先的总 tokens 显示。
- 重构 Provider 测试功能：新增测试弹窗支持选择测试模型，并显示原始响应数据（JSON 格式）
- 重构 Providers 页面测试功能：添加"测试全部"按钮支持一键测试所有渠道，集中管理测试状态，测试结果增加延迟（latencyMs）显示
- 千帆端点新增模型支持：deepseek-v3.2、glm-5、kimi-k2.5、minimax-m2.5
- Providers 页面新增测试连通性按钮，可快速验证渠道配置是否正确
- 调整模型列表端点：`/v1/models` 现在以单层 OpenAI 格式返回全部模型；新增 `/openai/v1/models` 只返回 OpenAI 格式的 openai 模型，并保留 `/anthropic/v1/models` 只返回 Anthropic 格式的 anthropic 模型
- Providers 管理改为围绕 Channel 进行收敛配置：控制台与 JSON 配置统一使用 `channelName` 和 `systemPrompt`，移除 `systemFile`、`pathRewrite`、`supportedClientTypes`、`fallbacks` 和自定义 `auth prefix`；`auth header` 收敛为标准的 `x-api-key` / `authorization` 两种选项，并将 `models` 从 JSON 文本改为结构化对象数组。
- Providers 管理页现在支持直接编辑并更新 console 渠道的 `channelName`；保存后会同步重命名数据库记录与显式路由前缀，旧前缀立即失效。
- 移除基于 `-chat` 模型后缀的特殊逻辑：无前缀自动选路不再把 `-chat` 当作模型别名，Anthropic 请求准备阶段也不再自动去掉 `-chat` 后缀。
- Anthropic 渠道改为使用 `enableCcMasquerade` 作为唯一的 Claude Code 伪装开关；请求识别仅作为该开关的内部子逻辑，不再暴露为独立渠道配置能力。
- 路由解析、`/v1/models`、控制台 provider CRUD 和 Dashboard Providers 页面已同步切换到新的 Channel 模型，并统一改为数据库单源。
- 新增基于 `priority` 的模型自动选路能力。当多个渠道声明同一模型时，网关会优先选择 `priority` 更高的路由；若优先级相同，则保持配置文件中的声明顺序。
- 调整 Anthropic 无前缀自动路由行为，使 `claude-opus-4-6` 会基于当前配置优先命中 `anyrouter`，再回落到 `foxcode`。
- 为 `foxcode` 增加显式备用渠道配置，在上游失败时按声明顺序切换到 `anyrouter`。
- 为 `anyrouter` 补充显式备用渠道 `foxcode`，使双向主备链路在显式前缀访问时也能按声明顺序回退。
- 调整控制台 Keys 管理：普通 API key 创建后支持后续重复查看完整值，不再采用"只展示一次"的交互。
- 增强 Keys 管理与控制台来源识别：列表新增复制与重命名，后续请求默认按 API key 名称区分客户端；除 Claude Code (`cc`) 伪装判断外，移除面向用户的 OpenClaw / Copilot 等客户端识别展示。
- 调整控制台日志列表列语义：原 `HTTP` 列改为 `状态`，同列会同时展示结果码以及 `日志截断`、`已回退` 等运行态，避免只看 HTTP 数字无法快速识别异常类型。
- 替换日志表格表头及按钮中的 emoji 与 Unicode 箭头符号为 Lucide 图标，统一 UI 风格。

### 修复

- 放宽网关与 provider 认证限制：所有端点类型现在都同时兼容 `x-api-key` 和 `Authorization: Bearer` 两种入口认证；provider 静态配置、控制台存储和连通性测试也支持显式选择认证头，因此 Anthropic 渠道现在也可以使用 Bearer 认证。
- 修复 Providers 页面编辑 console 渠道时 API Key 无法回显、更新后测试请求会为 OpenAI 渠道重复拼接 `Bearer`，以及修改后的 API Key 未按编辑值稳定落库的问题。
- 统一控制台 payload 截断策略为 1MB：请求与响应写入数据库现在使用同一字节上限，并移除 stdout 中原始 body 内容输出，避免在终端打印大请求/响应体；该截断仅影响日志与控制台落库，不影响实际转发给上游的请求体。
- 移除流式响应首 token 探测的毫秒预算限制。大 body 场景下，网关继续只用现有的响应观测字节上限和时长上限来约束日志采样，避免因为单次解析超时而提前放弃后续首 token 统计；实际转发仍按客户端消费节奏透传，不会被日志采样主动阻塞。
- 移除控制台缓存分析能力。网关不再在请求写库时提取缓存点、做历史前缀匹配、计算本地 hash 或展示缓存详情对比，Anthropic 请求准备阶段也不再自动添加或裁剪 `cache_control`；列表与统计页仅保留基于响应 usage 字段的轻量缓存命中/创建状态，减轻大 payload 场景下的同步 CPU 与数据库写入开销。
- 修复测试环境数据库接入依赖外部环境变量的问题。测试进程现在固定使用仓库内的专用 PostgreSQL 常量地址，并将该远程库识别为受信任的测试库，避免控制台清库保护误拦截。
- 修复 provider 配置中的错误 fallback 会导致启动失败的问题。无效的 fallback 现在会输出警告并在加载时自动跳过，而不是直接抛错中断服务。
- 修复启动时 PostgreSQL 尚未就绪即尝试迁移导致进程崩溃的问题（`57P03: the database system is starting up`）。迁移前新增 `waitForDbReady()` 探针，最多重试 30 次（指数退避 500ms→5s），支持 Docker / K8s 环境中数据库晚于应用就绪的场景。
- 修复流式响应日志对 SSE 长连接的无界读取：控制台响应观测现在会在达到字节数或观测时长上限后主动停止日志分支、保留已捕获的部分 payload 并标记为截断，避免后台读取任务长期堆积并拖挂服务。
- **用 pass-through TransformStream 替换 `tee()` 分流**，消除 SSE 长连接场景下 `tee()` 内部缓冲导致的 CPU/内存飙升。新方案在同一管线中完成客户端转发与日志采样，不再产生额外的流分支。
- **节流控制台数据库清理**：`cleanupOldRows()` 原本每次写入请求后都会执行全表 `NOT IN` 子查询删除旧行（含排序和 cache points 孤行清理），并发场景下成为 CPU 热点。现在清理操作最多每 60 秒执行一次。
- **增强运行时性能诊断日志**：新增 `[REQ_PERF]`、`[PERF_BG]` 和扩展后的 `[PERF]` 指标，按请求阶段和后台任务输出慢点位、最慢阶段、挂起请求写入数、慢请求/慢后台任务统计，便于直接定位是请求预处理、stdout 日志、响应观测还是控制台写库导致 CPU 飙升。
- **恢复并保留详细请求/响应日志**：`[REQ_PAYLOAD_ORIG]`、`[REQ_PAYLOAD_FWD]`、`[REQ_HEADERS_FWD]`、`[RES_PAYLOAD]`、`[RES_USAGE]` 等日志重新输出到 stdout，同时为这些日志本身增加单独计时，便于衡量大 payload 序列化与打印的 CPU 开销。
- **大幅优化控制台列表查询性能**：发现之前控制台的使用量统计与请求列表操作会导致整个应用加载上百 MB 的 `original_payload` 来进行客户端类型的识别。现为 `console_requests` 表新增 `source_request_type` 字段，并在请求进入时立即完成识别并落库。查询与聚合时完全剔除 payload 与 headers 提取（消除超大 OOM CPU 颠簸）。
- **修复缓存点提取的前缀哈希热点**：控制台对大 OpenAI/Anthropic chat payload 提取 cache points 时，不再反复 `join()` 全量前缀并重新哈希，而是改为增量 FNV 哈希，避免消息数变多时前缀计算出现明显的 O(n²) 式 CPU 放大。
- **修复流式日志观测的两个边界条件**：长 SSE 日志截断改为定时器触发，不再傻等下一块 chunk 才结束后台任务；同时未读响应体场景改为允许日志采样提前放弃，避免日志链路反过来干扰实际转发。
- **调整流式响应观测策略，优先保证完整转发**：响应日志不再主动驱动上游流读取，而是按客户端的实际消费节奏被动观察；当日志超时或达到上限时，只截断日志采样，不再影响后续 chunk 向客户端继续透传。
- **进一步隔离响应日志与实际转发**：流式响应观测的收尾与异常处理改为异步 fail-open；即使日志采样本身抛错，或在达到日志字节上限后提前截断，也只会放弃/截断日志，不再把转发中的响应流直接 `error()` 掉。
- **修复非 SSE 响应在"客户端未读 body"场景下的日志阻塞问题**：普通 JSON/文本响应改为从 `Response.clone()` 的独立流做后台观测，日志采样不再占用实际转发流，也不会因为控制台只看状态码/headers 就卡到 15 秒超时或把响应误判为截断。
- **修复长流被全局 60 秒上游超时误杀的问题**：`UPSTREAM_REQUEST_TIMEOUT_MS` 现在只约束"等到上游响应头"的时间，不再在 SSE/流式 body 已经开始透传后继续挂着 `AbortSignal.timeout()`；避免像 `scripts/truncated_codex_response.txt` 这类在 `data:` 事件中间被硬断开、最终只留下半个 JSON chunk。
- **修复极快响应下首包/首 token 延迟被记录为 0ms 的问题**：响应观测现在同时使用墙钟时间和单调时钟锚点换算首包、首 token 与完成时间，避免 `Date.now()` 同毫秒取样把真实延迟压成 0，同时不改变实际请求转发与 SSE 透传链路。
- **同步修正回归测试到当前 provider 配置**：测试不再假定 `foxcode`、显式 fallback 和 route system prompt 仍然存在，改为按现有 `anyrouter` / `qianfan` / `cliproxy` 配置校验只读 JSON provider、fallback 过滤和 OpenClaw 直通行为。
- 保持显式渠道路径解析语义不变：`resolveRoute()` 只匹配带 provider 前缀的路径，`priority` 仅用于按模型自动选路。
- 补充回归测试，确保根路径继续返回 HTML 页面，并验证模型自动路由仍然遵循 `priority`。
