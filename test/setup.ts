// Bun test preload (see bunfig.toml). Runs once before any test file is
// imported. For the default embedded SQLite test database it recreates a fresh
// file and applies migrations, so the suite needs no external database. When
// TEST_DATABASE_URL points at PostgreSQL, migrations are skipped (the external
// database is expected to be pre-migrated) and this is effectively a no-op.
import { existsSync, unlinkSync } from 'node:fs';
import { getDatabaseUrl, getDbDriver, getSqliteFilePath } from '../src/db/config';
import { runMigrations } from '../src/db/migrate';

if (getDbDriver() === 'sqlite') {
  const file = getSqliteFilePath(getDatabaseUrl());
  if (file !== ':memory:') {
    for (const path of [file, `${file}-shm`, `${file}-wal`]) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // best-effort cleanup of a stale test database
      }
    }
  }
}

const status = await runMigrations();
if (status.state === 'failed') {
  throw new Error(`[test/setup] Database migration failed: ${status.error}`);
}
