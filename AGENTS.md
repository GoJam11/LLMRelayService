# AGENTS.md

## UI / Console Frontend Conventions

### shadcn/ui 风格要求
- Console 前端（`console/ai-proxy-dashboard`）的 UI 改动，默认必须遵循 **shadcn/ui** 风格与组件约定。
- 如果是图表相关需求，优先使用 **shadcn/ui chart primitives**（如 `ChartContainer`、`ChartTooltip`、`ChartLegend` 等）和其推荐结构；不要优先手搓一套视觉风格明显不一致的图表壳子。
- 页面中的 block / section 标题层级要统一：
  - 同级区块优先使用一致的 `CardHeader` / `CardTitle` / `CardDescription`
  - 不要在某些区块内部临时塞一套与其他 block 不一致的标题样式
- 图表**内部**可以根据数据表达需要做差异化设计，但图表**外部容器**（标题、描述、边距、分区方式）要与页面其他 card/block 对齐。
- 表格、图表、筛选区、概览卡片之间的文字层级、间距、容器边框风格要尽量统一，避免局部区域“单独一套设计语言”。

### Working Style
- 对这个仓库做代码修改时，若需求已经明确，默认直接改、验证、然后 push；不要停在口头方案阶段。
- 理解用户需求时，不要只按字面意思机械执行；要结合代码结构、已有实现模式、命名、仓库约定和上下文，优先推断用户在当前代码库中的真实意图。只有当关键语义存在多个合理解释且无法从代码库中消解时，再向用户确认。
- 做完前端改动后，至少运行：
  - `cd console/ai-proxy-dashboard && bun run typecheck`
  - `cd console/ai-proxy-dashboard && bun run build`
- **push 前必须先启动本地后端服务验证无报错**：`bun run dev:server`，确认服务正常启动（无崩溃、无 ReferenceError 等启动时错误）后再 push。服务启动后可用 Ctrl-C 停止。
- **数据库迁移：只用 drizzle-kit，禁用 inline migrations。**
  - 改 schema 后必须运行 `drizzle-kit generate` 生成迁移文件
  - **schema 改动和迁移文件必须在同一个 commit 中提交**，禁止只 push schema 不 push 迁移
  - 部署时自动执行 `drizzle-kit migrate`（Dockerfile CMD 已配置）
  - **禁止**在 `src/db/migrate.ts` 或 store 文件中写内联迁移
  - 如果 snapshot 损坏，从 git 历史恢复，不要删除后重新生成
- 对项目的功能/行为改动，默认**同步更新 changelog**；不要只改代码不记变更。
- 如果根目录 lockfile 因依赖变化被修改（例如 `bun.lock`），不要漏提、漏 push。

### Changelog 规范
- 变更日志统一存放在项目根目录 `changelog/` 文件夹下，**按日期一天一个文件**，文件名格式 `YYYY-MM-DD.md`（如 `changelog/2026-04-18.md`）。
- 完成任何需求后，必须在当天对应的 `changelog/YYYY-MM-DD.md` 中追加记录；若该文件不存在则新建。
- 文件格式：顶部 `# YYYY-MM-DD`，按 `### 新增` / `### 变更` / `### 修复` 分组用列表项描述变更，描述要简明且包含实现方式。
- **不再使用根目录 `CHANGELOG.md`**，历史内容已迁移至 `changelog/` 目录。
