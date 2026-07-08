import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The database used by `bun test`.
 *
 * - If `TEST_DATABASE_URL` is set, it is used verbatim (e.g. point it at a
 *   PostgreSQL instance to exercise the Postgres-specific code paths).
 * - Otherwise tests default to an embedded SQLite file under the OS temp dir,
 *   so the suite runs with zero external dependencies. The path is per-process
 *   to avoid clashes between concurrent runs; `test/setup.ts` recreates and
 *   migrates it before the suite starts.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  return `sqlite:${join(tmpdir(), `llm-relay-test-${process.pid}.db`)}`;
}

export const TEST_DATABASE_URL = resolveTestDatabaseUrl();

export function isTrustedTestDatabaseUrl(databaseUrl: string): boolean {
  return Boolean(TEST_DATABASE_URL) && databaseUrl === TEST_DATABASE_URL;
}
