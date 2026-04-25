# 数据库迁移指南

## 使用 Drizzle ORM 管理 PostgreSQL Schema

### 命令

- `bun run db:generate` - 根据 schema 定义生成迁移 SQL 文件
- `bun run db:migrate` - 执行迁移（将 SQL 应用到数据库）
- `bun run db:push` - 直接推送 schema 到数据库（开发环境快速同步）
- `bun run db:studio` - 启动 Drizzle Studio 可视化管理界面

### 工作流程

1. **修改 schema**: 编辑 `src/db/schema.ts`
2. **生成迁移**: `bun run db:generate`
3. **应用迁移**: `bun run db:migrate` 或在代码中调用 `runMigrations()`

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
