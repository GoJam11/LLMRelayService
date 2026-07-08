import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl, getDbDriver, getSqliteFilePath } from './src/db/config';

// The dialect is selected from DATABASE_URL. To generate/apply SQLite migrations:
//   DATABASE_URL=sqlite:./data/llm-relay.db bun run db:generate
// and for PostgreSQL (the default):
//   DATABASE_URL=postgresql://... bun run db:generate
export default getDbDriver() === 'sqlite'
  ? defineConfig({
      schema: './src/db/schema.sqlite.ts',
      out: './drizzle/sqlite',
      dialect: 'sqlite',
      dbCredentials: {
        url: getSqliteFilePath(),
      },
    })
  : defineConfig({
      schema: './src/db/schema.pg.ts',
      out: './drizzle',
      dialect: 'postgresql',
      dbCredentials: {
        url: getDatabaseUrl(),
      },
    });
