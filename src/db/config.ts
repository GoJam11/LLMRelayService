import { TEST_DATABASE_URL } from './test-database';

export type DbDriver = 'postgres' | 'sqlite';

function isTestProcess(): boolean {
  if (process.env.USE_TEST_DATABASE === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return typeof Bun !== 'undefined' && Array.isArray(Bun.argv) && Bun.argv.includes('test');
}

export function getDatabaseUrl(): string {
  if (isTestProcess()) {
    if (!TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL is required for running tests. Set it in .env or your environment (see .env.example).');
    }
    return TEST_DATABASE_URL;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }

  return databaseUrl;
}

/**
 * A DATABASE_URL is treated as SQLite when it uses the `sqlite:` / `file:` scheme.
 * Examples:
 *   sqlite:./data/llm-relay.db   → relative file
 *   sqlite:///data/llm-relay.db  → absolute file (/data/llm-relay.db)
 *   sqlite::memory:              → in-memory database
 *   file:./llm-relay.db          → relative file
 * Anything else (postgres://, postgresql://, …) is treated as PostgreSQL.
 */
export function isSqliteUrl(databaseUrl: string): boolean {
  const trimmed = databaseUrl.trim().toLowerCase();
  return trimmed.startsWith('sqlite:') || trimmed.startsWith('file:');
}

/**
 * Resolve the target database driver from DATABASE_URL. Defaults to `postgres`
 * (including when DATABASE_URL is unset, e.g. during tooling that only needs the
 * default). The target database is fixed at deploy time — the driver is derived
 * purely from the connection string and cannot be switched at runtime.
 */
export function getDbDriver(): DbDriver {
  let url: string;
  try {
    url = getDatabaseUrl();
  } catch {
    return 'postgres';
  }
  return isSqliteUrl(url) ? 'sqlite' : 'postgres';
}

/**
 * Extract the on-disk file path (or `:memory:`) from a SQLite DATABASE_URL.
 * Throws when called with a non-SQLite URL.
 */
export function getSqliteFilePath(databaseUrl = getDatabaseUrl()): string {
  if (!isSqliteUrl(databaseUrl)) {
    throw new Error(`Not a SQLite DATABASE_URL: ${databaseUrl}`);
  }
  const trimmed = databaseUrl.trim();
  // Strip scheme (sqlite: / file:)
  let rest = trimmed.replace(/^sqlite:/i, '').replace(/^file:/i, '');
  // In-memory database
  if (rest === '' || rest === ':memory:' || rest === '//:memory:') {
    return ':memory:';
  }
  // `sqlite:///abs/path` → `/abs/path`; `sqlite://./rel` → `./rel`; `sqlite:./rel` → `./rel`
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
  }
  return rest;
}
