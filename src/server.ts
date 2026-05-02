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

function showMigrationGuide(status: Extract<MigrationStatus, { state: 'failed' }>): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>数据库迁移失败 - LLM Relay</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      width: 100%;
      background: #1a1a1a;
      border-radius: 12px;
      padding: 32px;
      border: 1px solid #333;
    }
    h1 { color: #ff6b6b; margin: 0 0 16px; font-size: 24px; }
    .error-box {
      background: #2a1a1a;
      border-left: 4px solid #ff6b6b;
      padding: 12px 16px;
      margin: 16px 0;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 14px;
      color: #ff9999;
      word-break: break-word;
    }
    h2 { color: #fff; font-size: 18px; margin: 24px 0 12px; }
    ol { padding-left: 20px; line-height: 1.8; }
    li { margin-bottom: 8px; }
    code {
      background: #2a2a2a;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #66d9ef;
    }
    pre {
      background: #2a2a2a;
      padding: 12px 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #a6e22e;
    }
    .note {
      margin-top: 20px;
      padding: 12px;
      background: #1a2a1a;
      border-left: 4px solid #4ecdc4;
      border-radius: 4px;
      font-size: 14px;
      color: #8ecae6;
    }
    .danger-zone {
      margin-top: 24px;
      padding: 20px;
      background: #2a1a1a;
      border: 1px solid #ff6b6b;
      border-radius: 8px;
    }
    .danger-zone h2 { color: #ff6b6b; margin-top: 0; }
    .danger-zone p { color: #ff9999; margin: 8px 0 16px; }
    .btn-danger {
      background: #ff6b6b;
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-danger:hover { background: #ff5252; }
    .btn-danger:disabled {
      background: #666;
      cursor: not-allowed;
    }
    .result {
      margin-top: 12px;
      padding: 12px;
      border-radius: 6px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      display: none;
    }
    .result.success {
      display: block;
      background: #1a2a1a;
      border-left: 4px solid #4ecdc4;
      color: #a6e22e;
    }
    .result.error {
      display: block;
      background: #2a1a1a;
      border-left: 4px solid #ff6b6b;
      color: #ff9999;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>数据库迁移失败</h1>
    <div class="error-box">${escapeHtml(status.error)}</div>

    <div class="note" style="margin-bottom: 20px;">
      <strong>建议：</strong>执行重置前，请先备份数据库。
    </div>

    <div class="danger-zone">
      <h2>快速修复</h2>
      <p>点击下方按钮将<strong>清除所有现有数据</strong>并重新创建数据库表。此操作<strong>不可撤销</strong>。</p>
      <button class="btn-danger" id="resetBtn" onclick="resetDatabase()">清除数据并重建数据库</button>
      <div class="result" id="result"></div>
    </div>

    <div class="note">
      <strong>提示：</strong>服务当前处于降级模式。API 请求可能不可用，但健康检查端点仍可访问。
    </div>
  </div>

  <script>
    async function resetDatabase() {
      const btn = document.getElementById('resetBtn');
      const result = document.getElementById('result');
      btn.disabled = true;
      btn.textContent = '处理中...';
      result.className = 'result';
      result.textContent = '';

      try {
        const res = await fetch('/api/db/reset', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          result.className = 'result success';
          result.textContent = '成功：' + data.message + '\\n正在刷新页面...';
          setTimeout(() => location.reload(), 2000);
        } else {
          result.className = 'result error';
          result.textContent = '失败：' + (data.error || '未知错误');
        }
      } catch (err) {
        result.className = 'result error';
        result.textContent = '失败：' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '清除数据并重建数据库';
      }
    }
  </script>
</body>
</html>`;
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

