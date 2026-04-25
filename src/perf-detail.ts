const DEFAULT_REQUEST_PERF_LOG_THRESHOLD_MS = 50;
const DEFAULT_BACKGROUND_PERF_LOG_THRESHOLD_MS = 20;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readTruthyEnv(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function nowPerfMs(): number {
  return performance.now();
}

export function roundPerfMs(value: number): number {
  return Math.round(value * 10) / 10;
}

export function elapsedPerfMs(startMs: number): number {
  return roundPerfMs(performance.now() - startMs);
}

export function toObservedEpochMs(
  anchorEpochMs: number,
  anchorPerfMs: number,
  observedPerfMs: number,
  fallbackEpochMs: number = Date.now(),
): number {
  if (!Number.isFinite(anchorEpochMs)) return fallbackEpochMs;
  if (!Number.isFinite(anchorPerfMs) || !Number.isFinite(observedPerfMs)) {
    return Math.max(anchorEpochMs, fallbackEpochMs);
  }

  const elapsedMs = observedPerfMs - anchorPerfMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return Math.max(anchorEpochMs, fallbackEpochMs);
  }

  return anchorEpochMs + Math.ceil(elapsedMs);
}

export function shouldLogRequestPerf(totalMs: number): boolean {
  return readTruthyEnv('PERF_REQUEST_LOG_ALL')
    || totalMs >= readPositiveIntEnv('PERF_REQUEST_LOG_THRESHOLD_MS', DEFAULT_REQUEST_PERF_LOG_THRESHOLD_MS);
}

export function shouldLogBackgroundPerf(totalMs: number): boolean {
  return readTruthyEnv('PERF_BG_LOG_ALL')
    || totalMs >= readPositiveIntEnv('PERF_BG_LOG_THRESHOLD_MS', DEFAULT_BACKGROUND_PERF_LOG_THRESHOLD_MS);
}

export function getMaxPerfPhase(phases: Record<string, number>): { name: string | null; ms: number } {
  let maxName: string | null = null;
  let maxMs = 0;

  for (const [name, value] of Object.entries(phases)) {
    if (!Number.isFinite(value) || value < maxMs) continue;
    maxName = name;
    maxMs = value;
  }

  return {
    name: maxName,
    ms: roundPerfMs(maxMs),
  };
}
