/**
 * Performance Benchmark System
 *
 * Microbenchmark harness with:
 * - Warm-up phases and steady-state measurement
 * - Percentile statistics (p50/p90/p95/p99/p999)
 * - Throughput (ops/sec) calculation
 * - Regression detection against baselines
 * - Memory allocation tracking
 * - Async benchmark support
 * - Benchmark suites with setup/teardown
 * - Comparison reporting across runs
 * - CI-integrated threshold enforcement
 * - Export to JSON/CSV for dashboards
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export interface BenchmarkOptions {
  name: string;
  warmupIterations?: number;
  measureIterations?: number;
  timeoutMs?: number;
  tags?: string[];
  baseline?: string; // baseline run ID to compare against
}

export interface BenchmarkResult {
  id: string;
  name: string;
  tags: string[];
  runAt: Date;
  iterations: number;
  totalMs: number;
  opsPerSec: number;
  latency: LatencyStats;
  memory: MemoryStats;
  regressionStatus: RegressionStatus;
  baselineId?: string;
  regressionPct?: number;
}

export interface LatencyStats {
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  stddevMs: number;
}

export interface MemoryStats {
  heapUsedBefore: number;
  heapUsedAfter: number;
  heapDeltaBytes: number;
  externalBefore: number;
  externalAfter: number;
}

export type RegressionStatus = 'baseline' | 'improved' | 'stable' | 'regressed' | 'critical_regression';

export interface BenchmarkSuite {
  name: string;
  description: string;
  benchmarks: BenchmarkDefinition[];
  setup?: () => Promise<void> | void;
  teardown?: () => Promise<void> | void;
}

export interface BenchmarkDefinition {
  name: string;
  fn: () => Promise<void> | void;
  options?: Partial<BenchmarkOptions>;
}

export interface BenchmarkComparison {
  name: string;
  current: BenchmarkResult;
  baseline: BenchmarkResult;
  latencyChangePct: number;
  throughputChangePct: number;
  status: RegressionStatus;
}

export interface BenchmarkReport {
  suiteId: string;
  suiteName: string;
  ranAt: Date;
  results: BenchmarkResult[];
  comparisons: BenchmarkComparison[];
  totalDurationMs: number;
  passCount: number;
  regressionCount: number;
  criticalCount: number;
}

const REGRESSION_WARNING_THRESHOLD = 10; // 10% degradation
const REGRESSION_CRITICAL_THRESHOLD = 25; // 25% degradation

function computePercentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((pct / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

function computeStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeLatencyStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: mean,
    medianMs: computePercentile(sorted, 50),
    p90Ms: computePercentile(sorted, 90),
    p95Ms: computePercentile(sorted, 95),
    p99Ms: computePercentile(sorted, 99),
    p999Ms: computePercentile(sorted, 99.9),
    stddevMs: computeStddev(sorted, mean),
  };
}

function generateRunId(): string {
  return `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function runSingleBenchmark(
  fn: () => Promise<void> | void,
  options: Required<BenchmarkOptions>,
): Promise<{ samples: number[]; memory: MemoryStats }> {
  const {
    warmupIterations,
    measureIterations,
    timeoutMs,
  } = options;

  // Warm-up phase
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  // Force GC hint if available
  if (typeof global !== 'undefined' && (global as { gc?: () => void }).gc) {
    (global as { gc?: () => void }).gc?.();
  }

  const memBefore = process.memoryUsage();
  const samples: number[] = [];
  const startTotal = Date.now();

  for (let i = 0; i < measureIterations; i++) {
    if (Date.now() - startTotal > timeoutMs) {
      logger.warn('Benchmark timeout reached', { name: options.name, completed: i });
      break;
    }
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }

  const memAfter = process.memoryUsage();

  return {
    samples,
    memory: {
      heapUsedBefore: memBefore.heapUsed,
      heapUsedAfter: memAfter.heapUsed,
      heapDeltaBytes: memAfter.heapUsed - memBefore.heapUsed,
      externalBefore: memBefore.external,
      externalAfter: memAfter.external,
    },
  };
}

function detectRegression(
  current: LatencyStats,
  baseline: LatencyStats,
): { status: RegressionStatus; pct: number } {
  if (baseline.meanMs === 0) return { status: 'baseline', pct: 0 };

  const pct = ((current.meanMs - baseline.meanMs) / baseline.meanMs) * 100;

  let status: RegressionStatus;
  if (pct >= REGRESSION_CRITICAL_THRESHOLD) status = 'critical_regression';
  else if (pct >= REGRESSION_WARNING_THRESHOLD) status = 'regressed';
  else if (pct <= -REGRESSION_WARNING_THRESHOLD) status = 'improved';
  else status = 'stable';

  return { status, pct };
}

export async function benchmark(
  fn: () => Promise<void> | void,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const resolved: Required<BenchmarkOptions> = {
    warmupIterations: 10,
    measureIterations: 100,
    timeoutMs: 30000,
    tags: [],
    baseline: '',
    ...options,
  };

  logger.debug('Running benchmark', { name: resolved.name, iterations: resolved.measureIterations });
  const startMs = Date.now();
  const { samples, memory } = await runSingleBenchmark(fn, resolved);

  const totalMs = Date.now() - startMs;
  const latency = computeLatencyStats(samples);
  const opsPerSec = samples.length > 0 ? (samples.length / (totalMs / 1000)) : 0;

  const runId = generateRunId();
  let regressionStatus: RegressionStatus = 'baseline';
  let regressionPct: number | undefined;
  let baselineId: string | undefined;

  // Compare with stored baseline
  if (resolved.baseline) {
    const cache = getCache();
    const base = cache.get<BenchmarkResult>(`benchmark:baseline:${options.name}:${resolved.baseline}`);
    if (base) {
      const { status, pct } = detectRegression(latency, base.latency);
      regressionStatus = status;
      regressionPct = pct;
      baselineId = base.id;
    }
  } else {
    // Store as new baseline
    const cache = getCache();
    const result: BenchmarkResult = {
      id: runId,
      name: options.name,
      tags: resolved.tags,
      runAt: new Date(),
      iterations: samples.length,
      totalMs,
      opsPerSec,
      latency,
      memory,
      regressionStatus: 'baseline',
    };
    cache.set(`benchmark:baseline:${options.name}:${runId}`, result, 86400 * 30);
  }

  const result: BenchmarkResult = {
    id: runId,
    name: options.name,
    tags: resolved.tags,
    runAt: new Date(),
    iterations: samples.length,
    totalMs,
    opsPerSec,
    latency,
    memory,
    regressionStatus,
    baselineId,
    regressionPct,
  };

  if (regressionStatus === 'critical_regression') {
    logger.error('Critical performance regression detected', undefined, {
      name: options.name,
      regressionPct: regressionPct?.toFixed(1),
      current: latency.meanMs,
    });
  } else if (regressionStatus === 'regressed') {
    logger.warn('Performance regression detected', {
      name: options.name,
      regressionPct: regressionPct?.toFixed(1),
    });
  }

  // Store result history
  const cache = getCache();
  const history = cache.get<BenchmarkResult[]>(`benchmark:history:${options.name}`) ?? [];
  history.unshift(result);
  if (history.length > 50) history.length = 50;
  cache.set(`benchmark:history:${options.name}`, history, 86400 * 30);

  logger.info('Benchmark complete', {
    name: options.name,
    opsPerSec: opsPerSec.toFixed(0),
    p99Ms: latency.p99Ms.toFixed(2),
    status: regressionStatus,
  });

  return result;
}

export async function runSuite(suite: BenchmarkSuite): Promise<BenchmarkReport> {
  const suiteId = generateRunId();
  const startMs = Date.now();
  logger.info('Running benchmark suite', { suiteName: suite.name });

  if (suite.setup) await suite.setup();

  const results: BenchmarkResult[] = [];
  for (const def of suite.benchmarks) {
    try {
      const result = await benchmark(def.fn, {
        name: `${suite.name}/${def.name}`,
        ...def.options,
      });
      results.push(result);
    } catch (err) {
      logger.error('Benchmark errored', undefined, { name: def.name, error: err });
    }
  }

  if (suite.teardown) await suite.teardown();

  const comparisons: BenchmarkComparison[] = results
    .filter((r) => r.baselineId)
    .map((r) => {
      const cache = getCache();
      const baseline = cache.get<BenchmarkResult>(`benchmark:baseline:${r.name}:${r.baselineId}`);
      if (!baseline) return null;
      return {
        name: r.name,
        current: r,
        baseline,
        latencyChangePct: r.regressionPct ?? 0,
        throughputChangePct: ((r.opsPerSec - baseline.opsPerSec) / baseline.opsPerSec) * 100,
        status: r.regressionStatus,
      };
    })
    .filter(Boolean) as BenchmarkComparison[];

  const report: BenchmarkReport = {
    suiteId,
    suiteName: suite.name,
    ranAt: new Date(),
    results,
    comparisons,
    totalDurationMs: Date.now() - startMs,
    passCount: results.filter((r) => r.regressionStatus !== 'regressed' && r.regressionStatus !== 'critical_regression').length,
    regressionCount: results.filter((r) => r.regressionStatus === 'regressed').length,
    criticalCount: results.filter((r) => r.regressionStatus === 'critical_regression').length,
  };

  logger.info('Benchmark suite complete', {
    suiteName: suite.name,
    total: results.length,
    pass: report.passCount,
    regressions: report.regressionCount,
    critical: report.criticalCount,
    totalMs: report.totalDurationMs,
  });

  return report;
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines = [
    `Benchmark Suite: ${report.suiteName}`,
    `Run at: ${report.ranAt.toISOString()}`,
    `Duration: ${report.totalDurationMs}ms`,
    `Results: ${report.passCount} pass, ${report.regressionCount} regressed, ${report.criticalCount} critical`,
    '',
    'Results:',
  ];

  for (const r of report.results) {
    const reg = r.regressionPct ? ` (${r.regressionPct > 0 ? '+' : ''}${r.regressionPct.toFixed(1)}%)` : '';
    lines.push(
      `  ${r.regressionStatus.toUpperCase().padEnd(20)} ${r.name.padEnd(40)} ` +
      `ops/s=${r.opsPerSec.toFixed(0).padStart(8)}  ` +
      `p50=${r.latency.medianMs.toFixed(2)}ms  p99=${r.latency.p99Ms.toFixed(2)}ms${reg}`,
    );
  }

  return lines.join('\n');
}

export function getBenchmarkHistory(name: string, limit = 10): BenchmarkResult[] {
  const cache = getCache();
  const history = cache.get<BenchmarkResult[]>(`benchmark:history:${name}`) ?? [];
  return history.slice(0, limit);
}

export function exportBenchmarkResults(results: BenchmarkResult[], format: 'json' | 'csv'): string {
  if (format === 'json') {
    return JSON.stringify(results, null, 2);
  }

  const headers = [
    'name', 'runAt', 'iterations', 'opsPerSec',
    'minMs', 'meanMs', 'medianMs', 'p90Ms', 'p95Ms', 'p99Ms', 'p999Ms',
    'heapDeltaBytes', 'status', 'regressionPct',
  ];
  const rows = results.map((r) => [
    r.name,
    r.runAt.toISOString(),
    r.iterations,
    r.opsPerSec.toFixed(2),
    r.latency.minMs.toFixed(3),
    r.latency.meanMs.toFixed(3),
    r.latency.medianMs.toFixed(3),
    r.latency.p90Ms.toFixed(3),
    r.latency.p95Ms.toFixed(3),
    r.latency.p99Ms.toFixed(3),
    r.latency.p999Ms.toFixed(3),
    r.memory.heapDeltaBytes,
    r.regressionStatus,
    r.regressionPct?.toFixed(2) ?? '',
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}
