# 数据库迁移指南

## 使用 Drizzle ORM 管理 Schema（支持 PostgreSQL 与 SQLite）

本项目同时支持 **PostgreSQL** 与 **SQLite** 两种部署方式，通过 `DATABASE_URL` 的协议自动选择驱动：

- `postgresql://...` / `postgres://...` → PostgreSQL
- `sqlite:./data/app.db` / `file:./app.db` / `sqlite::memory:` → SQLite（内嵌，无需额外数据库）

> 目标数据库在部署时固定，运行时不支持切换，避免数据割裂问题。

### 双方言结构

- `schema.pg.ts` — PostgreSQL 表定义（`pg-core`）
- `schema.sqlite.ts` — SQLite 表定义（`sqlite-core`），列名/默认值/索引与 PG 保持一致
- `schema.ts` — 按当前驱动运行时导出对应的一套表对象，store 层统一 import 这里
- 迁移文件：PostgreSQL 在 `drizzle/`，SQLite 在 `drizzle/sqlite/`

### 命令

- `bun run db:generate` - 根据 schema 定义生成迁移 SQL 文件（按 `DATABASE_URL` 选择方言）
- `bun run db:migrate` - 执行迁移（将 SQL 应用到数据库）
- `bun run db:push` - 直接推送 schema 到数据库（开发环境快速同步）
- `bun run db:studio` - 启动 Drizzle Studio 可视化管理界面

### 工作流程

1. **修改 schema**: 同步编辑 `src/db/schema.pg.ts` 与 `src/db/schema.sqlite.ts`（保持列名/约束一致）
2. **生成迁移**（两套都要生成并一起提交）:
   - PostgreSQL: `DATABASE_URL=postgresql://... bun run db:generate`
   - SQLite: `DATABASE_URL=sqlite:./local.db bun run db:generate`
3. **应用迁移**: `bun run db:migrate` 或在代码中调用 `runMigrations()`（启动时自动执行，按驱动选择迁移目录）

前提：

- 在 `.env` 或运行环境里提供 `DATABASE_URL`

### 自动迁移

在应用启动时自动运行迁移：

```typescript
import { runMigrations } from './db/migrate';

await runMigrations();
```

### 使用示例

```typescript
import { createDbClient } from './db/client';
import { consoleRequests } from './db/schema';
import { eq } from 'drizzle-orm';

const db = createDbClient();

// 插入
await db.insert(consoleRequests).values({
  requestId: 'req_123',
  createdAt: Date.now(),
  upstreamType: 'anthropic',
  routePrefix: 'claude',
  method: 'POST',
  path: '/claude/v1/messages',
  requestModel: 'claude-opus-4-6',
  targetUrl: 'https://api.anthropic.com',
});

// 查询
const results = await db.select().from(consoleRequests).where(
  eq(consoleRequests.upstreamType, 'anthropic')
);
```
