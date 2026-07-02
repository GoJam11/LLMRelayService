import { dirname, resolve } from 'node:path';
import { TEST_DATABASE_URL } from './test-database';

// 数据库方言在首次部署时由 DATABASE_URL 一次性选定，选定后不可切换（两种方言的数据
// 互不迁移）。启动时由 dialect-guard 校验数据目录中的方言标记，防止误切换。
export type DbDialect = 'postgres' | 'sqlite';

const DEFAULT_SQLITE_PATH = './data/llm-relay.sqlite';

function isTestProcess(): boolean {
  if (process.env.USE_TEST_DATABASE === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return typeof Bun !== 'undefined' && Array.isArray(Bun.argv) && Bun.argv.includes('test');
}

function rawDatabaseUrl(): string | undefined {
  if (isTestProcess()) {
    if (!TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL is required for running tests. Set it in .env or your environment (see .env.example).');
    }
    return TEST_DATABASE_URL;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? databaseUrl : undefined;
}

export function getDbDialect(): DbDialect {
  const databaseUrl = rawDatabaseUrl();
  // 未配置 DATABASE_URL 时默认使用本地 SQLite，单容器零依赖即可启动
  if (!databaseUrl) return 'sqlite';
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) return 'postgres';
  if (databaseUrl.startsWith('sqlite:') || databaseUrl.startsWith('file:')) return 'sqlite';
  throw new Error(
    `Unrecognized DATABASE_URL dialect: "${databaseUrl}". Use postgresql://... for PostgreSQL, sqlite:<path> for SQLite, or leave it unset for the default SQLite file (${DEFAULT_SQLITE_PATH}).`,
  );
}

export function getSqliteFilePath(): string {
  const databaseUrl = rawDatabaseUrl();
  let filePath = DEFAULT_SQLITE_PATH;
  if (databaseUrl) {
    filePath = databaseUrl.replace(/^(sqlite|file):/, '');
    // sqlite:///abs/path → /abs/path
    if (filePath.startsWith('//')) filePath = filePath.slice(2);
  }
  return resolve(filePath);
}

// 数据目录：SQLite 数据文件与方言标记（.db-dialect）所在目录
export function getDataDir(): string {
  if (getDbDialect() === 'sqlite') return dirname(getSqliteFilePath());
  return resolve(process.env.DATA_DIR ?? './data');
}

// PostgreSQL 模式返回连接字符串；SQLite 模式返回数据文件绝对路径
export function getDatabaseUrl(): string {
  if (getDbDialect() === 'sqlite') return getSqliteFilePath();
  return rawDatabaseUrl()!;
}
