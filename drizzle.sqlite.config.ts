import { defineConfig } from 'drizzle-kit';

// SQLite 配置；PostgreSQL 见 drizzle.config.ts
// generate 不需要连库，push/studio/migrate 才需要真实的数据文件路径
const sqlitePath = process.env.DATABASE_URL?.replace(/^(sqlite|file):/, '') || './data/llm-relay.sqlite';

export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './drizzle-sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: sqlitePath,
  },
});
