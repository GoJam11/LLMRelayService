/**
 * System performance monitor.
 * Periodically reports CPU, memory, event loop lag, and request metrics to stdout.
 */

import { getPendingConsoleLogTaskCount, getPendingConsoleRequestWriteCount } from './console-log-tasks';
import { roundPerfMs } from './perf-detail';

const DEFAULT_REPORT_INTERVAL_MS = 10_000;
const EVENT_LOOP_PROBE_INTERVAL_MS = 50;

// ── Request tracking ───────────────────────────────────────────────────

let activeRequests = 0;
let totalRequestsServed = 0;
let requestsInInterval = 0;

interface RequestPerfSample {
  request_id: string;
  path: string;
  total_ms: number;
  status: number;
  slowest_phase?: string | null;
  slowest_phase_ms?: number;
}

interface BackgroundPerfSample {
  kind: string;
  request_id?: string;
  total_ms: number;
}

let requestPerfCount = 0;
let requestPerfTotalMs = 0;
let requestPerfMaxMs = 0;
let requestPerfSlowCount = 0;
let slowestRequestSample: RequestPerfSample | null = null;

let backgroundPerfCount = 0;
let backgroundPerfTotalMs = 0;
let backgroundPerfMaxMs = 0;
let backgroundPerfSlowCount = 0;
let slowestBackgroundSample: BackgroundPerfSample | null = null;

export function trackRequestStart(): void {
  activeRequests++;
  totalRequestsServed++;
  requestsInInterval++;
}

export function trackRequestEnd(): void {
  activeRequests = Math.max(0, activeRequests - 1);
}

export function recordRequestPerfSample(sample: RequestPerfSample): void {
  requestPerfCount++;
  requestPerfTotalMs += sample.total_ms;
  requestPerfMaxMs = Math.max(requestPerfMaxMs, sample.total_ms);
  if (sample.total_ms >= 50) requestPerfSlowCount++;

  if (!slowestRequestSample || sample.total_ms >= slowestRequestSample.total_ms) {
    slowestRequestSample = sample;
  }
}

export function recordBackgroundPerfSample(sample: BackgroundPerfSample): void {
  backgroundPerfCount++;
  backgroundPerfTotalMs += sample.total_ms;
  backgroundPerfMaxMs = Math.max(backgroundPerfMaxMs, sample.total_ms);
  if (sample.total_ms >= 20) backgroundPerfSlowCount++;

  if (!slowestBackgroundSample || sample.total_ms >= slowestBackgroundSample.total_ms) {
    slowestBackgroundSample = sample;
  }
}

// ── Event loop lag measurement ─────────────────────────────────────────

let lagProbeTimer: ReturnType<typeof setTimeout> | null = null;
let lastLagProbeTime = 0;
let lagMaxMs = 0;
let lagSampleTotal = 0;
let lagSampleCount = 0;

function probeEventLoopLag(): void {
  const now = Date.now();
  if (lastLagProbeTime > 0) {
    const lag = Math.max(0, now - lastLagProbeTime - EVENT_LOOP_PROBE_INTERVAL_MS);
    if (lag > lagMaxMs) lagMaxMs = lag;
    lagSampleTotal += lag;
    lagSampleCount++;
  }
  lastLagProbeTime = now;
  lagProbeTimer = setTimeout(probeEventLoopLag, EVENT_LOOP_PROBE_INTERVAL_MS);
  if (lagProbeTimer && typeof lagProbeTimer === 'object' && 'unref' in lagProbeTimer) {
    (lagProbeTimer as NodeJS.Timeout).unref();
  }
}

// ── Periodic report ────────────────────────────────────────────────────

let previousCpuUsage = process.cpuUsage();
let previousReportTime = Date.now();
let reportTimer: ReturnType<typeof setInterval> | null = null;

function report(): void {
  const now = Date.now();
  const elapsedMs = now - previousReportTime;

  // CPU
  const cpuDelta = process.cpuUsage(previousCpuUsage);
  const cpuUserMs = Math.round(cpuDelta.user / 1000);
  const cpuSystemMs = Math.round(cpuDelta.system / 1000);
  const cpuTotalMs = cpuUserMs + cpuSystemMs;
  const cpuPercent = elapsedMs > 0 ? Math.round((cpuTotalMs / elapsedMs) * 1000) / 10 : 0;

  // Memory
  const mem = process.memoryUsage();
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  // Event loop lag
  const lagAvgMs = lagSampleCount > 0 ? Math.round((lagSampleTotal / lagSampleCount) * 10) / 10 : 0;
  const lagMax = lagMaxMs;

  // Pending background tasks
  const pendingLogTasks = getPendingConsoleLogTaskCount();
  const pendingRequestWrites = getPendingConsoleRequestWriteCount();
  const reqAvgMs = requestPerfCount > 0 ? roundPerfMs(requestPerfTotalMs / requestPerfCount) : 0;
  const bgAvgMs = backgroundPerfCount > 0 ? roundPerfMs(backgroundPerfTotalMs / backgroundPerfCount) : 0;

  console.log(`[PERF] CPU=${cpuPercent}% | MEM=${mb(mem.rss)}MB | ActiveReqs=${activeRequests} | TotalReqs=${totalRequestsServed} | ReqAvg=${reqAvgMs}ms | ReqMax=${roundPerfMs(requestPerfMaxMs)}ms`);

  // Reset interval counters
  previousCpuUsage = process.cpuUsage();
  previousReportTime = now;
  lagMaxMs = 0;
  lagSampleTotal = 0;
  lagSampleCount = 0;
  requestsInInterval = 0;
  requestPerfCount = 0;
  requestPerfTotalMs = 0;
  requestPerfMaxMs = 0;
  requestPerfSlowCount = 0;
  slowestRequestSample = null;
  backgroundPerfCount = 0;
  backgroundPerfTotalMs = 0;
  backgroundPerfMaxMs = 0;
  backgroundPerfSlowCount = 0;
  slowestBackgroundSample = null;
}

// ── Public API ─────────────────────────────────────────────────────────

export function startPerfMonitor(intervalMs?: number): void {
  const interval = intervalMs ?? (Number.parseInt(process.env.PERF_REPORT_INTERVAL_MS || '', 10) || DEFAULT_REPORT_INTERVAL_MS);

  // Start event loop lag probing
  probeEventLoopLag();

  // Start periodic reports
  previousCpuUsage = process.cpuUsage();
  previousReportTime = Date.now();
  reportTimer = setInterval(report, interval);
  if (reportTimer && typeof reportTimer === 'object' && 'unref' in reportTimer) {
    (reportTimer as NodeJS.Timeout).unref();
  }

  console.log(`[PERF] Monitor started (interval=${interval}ms)`);
}

export function stopPerfMonitor(): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
  if (lagProbeTimer) {
    clearTimeout(lagProbeTimer);
    lagProbeTimer = null;
  }
}
