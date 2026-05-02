/**
 * LLM Gateway - Bun Server 入口
 */

import app from './index';
import { startPerfMonitor } from './perf-monitor';
import { warmModelCatalogFromDb } from './model-catalog';
import { fetchModelsDevData } from './model-catalog';
import { saveCatalogToDb } from './catalog-db';
import { initializeTokenEstimator } from './token-estimator';

const stubEnv = {
  LLM_STATUS: {
    writeDataPoint: () => {},
  },
};

const PORT = parseInt(process.env.PORT || '3300');
const IDLE_TIMEOUT_SECONDS = Number.parseInt(process.env.BUN_SERVER_IDLE_TIMEOUT_SECONDS || '0', 10);

// 初始化 token 估算器（WASM tiktoken 一次性初始化）
initializeTokenEstimator();

// 从 DB 预热 catalog 缓存（快速，不阻塞服务启动）
const dbCatalogFresh = await warmModelCatalogFromDb();

Bun.serve({
  port: PORT,
  idleTimeout: Number.isFinite(IDLE_TIMEOUT_SECONDS) && IDLE_TIMEOUT_SECONDS >= 0 ? IDLE_TIMEOUT_SECONDS : 0,
  fetch: (req) => app.fetch(req, stubEnv as any),
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

