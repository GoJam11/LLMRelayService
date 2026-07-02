import { defineConfig } from 'drizzle-kit';

// PostgreSQL 配置；SQLite 见 drizzle.sqlite.config.ts
// generate 不需要连库，push/studio/migrate 才需要真实的 DATABASE_URL
export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/lrs',
  },
});
