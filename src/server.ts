/**
 * LLM Gateway - Bun Server 入口
 */

import app from './index';
import { startPerfMonitor } from './perf-monitor';
import { warmModelCatalogFromDb } from './model-catalog';
import { fetchModelsDevData } from './model-catalog';
import { saveCatalogToDb } from './catalog-db';
import { initializeTokenEstimator } from './token-estimator';
import { runMigrations, type MigrationStatus } from './db/migrate';
import { getDatabaseUrl } from './db/config';
import postgres from 'postgres';

const stubEnv = {
  LLM_STATUS: {
    writeDataPoint: () => {},
  },
};

const PORT = parseInt(process.env.PORT || '3300');
const IDLE_TIMEOUT_SECONDS = Number.parseInt(process.env.BUN_SERVER_IDLE_TIMEOUT_SECONDS || '0', 10);

// 初始化 token 估算器（WASM tiktoken 一次性初始化）
initializeTokenEstimator();

// 1. 执行数据库迁移（不阻断服务启动，失败时记录状态）
let migrationStatus: MigrationStatus = { state: 'success' };
try {
  migrationStatus = await runMigrations();
} catch (error: any) {
  migrationStatus = { state: 'failed', error: error?.message ?? String(error) };
  console.error('[DB] Migration failed:', error);
}

// 2. 从 DB 预热 catalog 缓存（带保护，数据库不可用时优雅降级）
let dbCatalogFresh = false;
if (migrationStatus.state === 'success' || migrationStatus.state === 'skipped') {
  try {
    dbCatalogFresh = await warmModelCatalogFromDb();
  } catch (error) {
    console.warn('[catalog] Failed to warm from DB:', error);
    dbCatalogFresh = false;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const degradedHtmlTemplate = await Bun.file(`${import.meta.dir}/degraded.html`).text();

function showMigrationGuide(status: Extract<MigrationStatus, { state: 'failed' }>): Response {
  const html = degradedHtmlTemplate.replace('{{ERROR}}', escapeHtml(status.error));
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function resetDatabase(): Promise<{ success: boolean; message?: string; error?: string }> {
  const databaseUrl = getDatabaseUrl();
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    // 获取所有用户表（排除 drizzle 系统表）
    const tables = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'sql_%'
    `;

    // 删除所有表
    for (const row of tables) {
      const tableName = (row as any).tablename;
      await sql.unsafe(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
      console.log(`[DB] Dropped table: ${tableName}`);
    }

    // 删除 drizzle schema 和迁移记录
    await sql`DROP SCHEMA IF EXISTS "drizzle" CASCADE`;
    console.log('[DB] Dropped drizzle schema');

    await sql.end();

    // 重新执行迁移（强制重新执行，不走缓存）
    const result = await runMigrations(undefined, true);
    if (result.state === 'success') {
      return { success: true, message: '数据库已重置并重新迁移' };
    }
    return { success: false, error: result.state === 'failed' ? result.error : '迁移失败' };
  } catch (err: any) {
    await sql.end().catch(() => {});
    return { success: false, error: err?.message ?? String(err) };
  }
}

Bun.serve({
  port: PORT,
  idleTimeout: Number.isFinite(IDLE_TIMEOUT_SECONDS) && IDLE_TIMEOUT_SECONDS >= 0 ? IDLE_TIMEOUT_SECONDS : 0,
  fetch: async (req) => {
    const url = new URL(req.url);

    // 健康检查端点
    if (url.pathname === '/health') {
      const isHealthy = migrationStatus.state === 'success' || migrationStatus.state === 'skipped';
      return Response.json({
        status: isHealthy ? 'ok' : 'degraded',
        database: migrationStatus,
      }, { status: isHealthy ? 200 : 503 });
    }

    // 迁移失败时根路径显示指引页
    if (url.pathname === '/' && migrationStatus.state === 'failed') {
      return showMigrationGuide(migrationStatus as Extract<MigrationStatus, { state: 'failed' }>);
    }

    // 数据库重置 API（仅在降级模式下可用）
    if (url.pathname === '/api/db/reset' && req.method === 'POST') {
      if (migrationStatus.state !== 'failed') {
        return Response.json({ error: '数据库状态正常，无需重置' }, { status: 400 });
      }
      const result = await resetDatabase();
      if (result.success) {
        // 更新迁移状态
        migrationStatus = { state: 'success' };
        return Response.json({ message: result.message });
      }
      return Response.json({ error: result.error }, { status: 500 });
    }

    return app.fetch(req, stubEnv as any);
  },
});

console.log(`LLM Gateway running on :${PORT} (idleTimeout=${Number.isFinite(IDLE_TIMEOUT_SECONDS) && IDLE_TIMEOUT_SECONDS >= 0 ? IDLE_TIMEOUT_SECONDS : 0}s)`);

startPerfMonitor();

// 并行从 models.dev 刷新 catalog（不阻塞启动，DB 缓存过期时才需要）
if (!dbCatalogFresh) {
  fetchModelsDevData().then((result) => {
    if (result) {
      const now = Date.now();
      saveCatalogToDb(result.contextMap, result.pricingMap, now).catch(() => {});
      console.log(`[catalog] Background refresh: ${result.contextMap.size} context + ${result.pricingMap.size} pricing entries saved`);
    }
  }).catch(() => {});
}

