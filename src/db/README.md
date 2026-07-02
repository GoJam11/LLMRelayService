# 数据库迁移指南

## 使用 Drizzle ORM 管理 Schema（PostgreSQL / SQLite 双方言）

数据库方言由 `DATABASE_URL` 在首次部署时一次性选定，**选定后不可切换**（两种方言数据互不迁移，启动时通过数据目录的 `.db-dialect` 标记校验）：

- 不设置 `DATABASE_URL`（默认）→ SQLite，数据文件 `./data/llm-relay.sqlite`
- `DATABASE_URL=sqlite:<路径>` → SQLite 自定义路径
- `DATABASE_URL=postgresql://...` → PostgreSQL

### 文件结构

- `schema.pg.ts` — PostgreSQL schema（drizzle-kit 生成 `drizzle/` 迁移）
- `schema.sqlite.ts` — SQLite schema（drizzle-kit 生成 `drizzle-sqlite/` 迁移）
- `schema.ts` — 运行时按方言导出对应表对象，上层查询代码统一从这里 import
- `client.ts` — 按方言创建 drizzle 客户端（postgres-js / bun:sqlite）
- `dialect-guard.ts` — 方言标记校验，防止部署后误切换

### 命令

- `bun run db:generate` / `bun run db:generate:sqlite` - 根据 schema 定义生成迁移 SQL 文件
- `bun run db:migrate` / `bun run db:migrate:sqlite` - 执行迁移（将 SQL 应用到数据库）
- `bun run db:push` / `bun run db:push:sqlite` - 直接推送 schema 到数据库（开发环境快速同步）
- `bun run db:studio` / `bun run db:studio:sqlite` - 启动 Drizzle Studio 可视化管理界面

### 工作流程

1. **修改 schema**: 同时编辑 `src/db/schema.pg.ts` 和 `src/db/schema.sqlite.ts`（表名/列名/默认值必须保持一致）
2. **生成迁移**: `bun run db:generate` **和** `bun run db:generate:sqlite`（两套迁移都要生成）
3. **应用迁移**: 应用启动时自动执行 `runMigrations()`（按方言选择 `drizzle/` 或 `drizzle-sqlite/`）

注意：

- 上层查询代码只从 `./schema` import 表对象，drizzle 查询构建器在两个方言下行为一致
- 方言不可移植的原生 SQL（如 PG 的 CTE + `FOR UPDATE`）必须按 `getDbDialect()` 显式分支，SQLite 分支用 `getSqliteDatabase()` 原生执行（参考 `console-store.ts` 的 `syncApiKeyQuotaCharge`）

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
