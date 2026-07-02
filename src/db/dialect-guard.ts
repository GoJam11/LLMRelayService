import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, getDbDialect, type DbDialect } from './config';

// 数据库方言首次部署选定后不可切换：首次成功启动时把方言写入数据目录的标记文件，
// 之后每次启动校验。标记不一致说明用户在同一数据目录上切换了 DATABASE_URL 方言，
// 两种方言的数据互不迁移，直接放行只会得到一个空库，因此在迁移前失败并给出指引。
const DIALECT_MARKER_FILE = '.db-dialect';

function markerPath(): string {
  return join(getDataDir(), DIALECT_MARKER_FILE);
}

function readMarker(): DbDialect | null {
  try {
    if (!existsSync(markerPath())) return null;
    const recorded = readFileSync(markerPath(), 'utf8').trim();
    return recorded === 'postgres' || recorded === 'sqlite' ? recorded : null;
  } catch {
    return null;
  }
}

export function writeDialectMarker(dialect: DbDialect = getDbDialect()): void {
  try {
    mkdirSync(getDataDir(), { recursive: true });
    writeFileSync(markerPath(), `${dialect}\n`, 'utf8');
  } catch (err) {
    // 数据目录不可写时跳过守卫（例如只读文件系统的 PG 部署），不阻塞启动
    console.warn('[DB] Failed to write dialect marker, skipping guard:', (err as any)?.message ?? err);
  }
}

export function ensureDialectMarker(): void {
  const dialect = getDbDialect();
  const recorded = readMarker();
  if (recorded && recorded !== dialect) {
    throw new Error(
      `数据库方言选定后不可切换：数据目录 ${getDataDir()} 已使用 ${recorded} 初始化，` +
      `当前 DATABASE_URL 指向 ${dialect}。两种方言的数据互不迁移。` +
      `请将 DATABASE_URL 恢复为 ${recorded} 配置；如确认放弃原数据重新开始，请清空数据目录后再启动。`,
    );
  }
  if (!recorded) writeDialectMarker(dialect);
}
