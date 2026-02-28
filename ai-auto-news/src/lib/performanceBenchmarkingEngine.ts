/**
 * Performance Benchmarking Engine
 *
 * Provides:
 * - Benchmark suite registration and execution
 * - Statistical analysis of results (mean, median, p95, p99, stddev)
 * - Comparison between runs with regression detection
 * - Throughput measurement and memory usage tracking
 * - Historical result storage and trend analysis
 * - Warmup iterations for accurate measurement
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TimingStats {
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
  variance: number;
}

export interface Benchmark {
  id: string;
  name: string;
  fn: () => void | Promise<void>;
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  iterations: number;
  warmupIterations: number;
}

export interface BenchmarkSuite {
  id: string;
  name: string;
  description: string;
  benchmarks: Benchmark[];
  createdAt: Date;
}

export interface BenchmarkResult {
  benchmarkId: string;
  suiteName: string;
  timings: number[];
  stats: TimingStats;
  memoryUsage: number;
  throughput: number;
  timestamp: Date;
}

export interface BenchmarkComparison {
  baseline: BenchmarkResult;
  current: BenchmarkResult;
  regressionDetected: boolean;
  changePercent: number;
  significant: boolean;
}

export interface BenchmarkTrend {
  benchmarkId: string;
  results: BenchmarkResult[];
  trend: 'improving' | 'stable' | 'degrading';
  avgChangePercent: number;
}

export interface EngineStats {
  totalSuites: number;
  totalBenchmarks: number;
  totalRuns: number;
  avgExecutionTimeMs: number;
  regressionsDetected: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function computeStats(timings: number[]): TimingStats {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0, variance: 0 };
  }

  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  const median =
    n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return { mean, median, p95, p99, min: sorted[0], max: sorted[n - 1], stdDev, variance };
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function getMemoryUsage(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class PerformanceBenchmarkingEngine {
  private suites: Map<string, BenchmarkSuite> = new Map();
  private results: Map<string, BenchmarkResult[]> = new Map();
  private resultIndex: Map<string, BenchmarkResult> = new Map();
  private regressionsDetected = 0;
  private totalRuns = 0;

  constructor() {
    logger.info('PerformanceBenchmarkingEngine initialized');
  }

  /** Register a new benchmark suite. */
  registerSuite(suite: Omit<BenchmarkSuite, 'id' | 'createdAt'>): BenchmarkSuite {
    const id = generateId();
    const fullSuite: BenchmarkSuite = { ...suite, id, createdAt: new Date() };
    this.suites.set(id, fullSuite);
    logger.info(`Registered suite "${suite.name}" with ${suite.benchmarks.length} benchmarks`, {
      suiteId: id,
    });
    return fullSuite;
  }

  /** Run all benchmarks in a suite and return their results. */
  async runSuite(suiteId: string): Promise<BenchmarkResult[]> {
    const suite = this.suites.get(suiteId);
    if (!suite) throw new Error(`Suite not found: ${suiteId}`);

    logger.info(`Running suite "${suite.name}"`, { suiteId });
    const suiteResults: BenchmarkResult[] = [];

    for (const benchmark of suite.benchmarks) {
      const result = await this.runBenchmark(benchmark, suite.name);
      suiteResults.push(result);
    }

    const existing = this.results.get(suiteId) ?? [];
    this.results.set(suiteId, [...existing, ...suiteResults]);
    this.totalRuns++;

    logger.info(`Suite "${suite.name}" completed: ${suiteResults.length} benchmarks`, {
      suiteId,
    });
    return suiteResults;
  }

  /** Execute a single benchmark with warmup and measurement phases. */
  async runBenchmark(benchmark: Benchmark, suiteName = 'standalone'): Promise<BenchmarkResult> {
    logger.debug(`Running benchmark "${benchmark.name}": ${benchmark.warmupIterations} warmup, ${benchmark.iterations} measured`);

    // Setup phase
    if (benchmark.setup) {
      await benchmark.setup();
    }

    // Warmup phase — results discarded
    for (let i = 0; i < benchmark.warmupIterations; i++) {
      await benchmark.fn();
    }

    // Measurement phase
    const memBefore = getMemoryUsage();
    const timings: number[] = [];

    for (let i = 0; i < benchmark.iterations; i++) {
      const start = performance.now();
      await benchmark.fn();
      const end = performance.now();
      timings.push(end - start);
    }

    const memAfter = getMemoryUsage();
    const memoryUsage = Math.max(0, memAfter - memBefore);

    // Teardown phase
    if (benchmark.teardown) {
      await benchmark.teardown();
    }

    const stats = computeStats(timings);
    const totalTimeMs = timings.reduce((a, b) => a + b, 0);
    const throughput = totalTimeMs > 0 ? (benchmark.iterations / totalTimeMs) * 1000 : 0;

    const result: BenchmarkResult = {
      benchmarkId: benchmark.id,
      suiteName,
      timings,
      stats,
      memoryUsage,
      throughput,
      timestamp: new Date(),
    };

    const resultId = `${benchmark.id}-${result.timestamp.getTime()}`;
    this.resultIndex.set(resultId, result);

    logger.debug(`Benchmark "${benchmark.name}" done — mean: ${stats.mean.toFixed(3)}ms, p95: ${stats.p95.toFixed(3)}ms`);
    return result;
  }

  /** Compare a baseline result to a current result and detect regressions. */
  compare(baselineId: string, currentId: string): BenchmarkComparison {
    const baseline = this.resultIndex.get(baselineId);
    if (!baseline) throw new Error(`Baseline result not found: ${baselineId}`);
    const current = this.resultIndex.get(currentId);
    if (!current) throw new Error(`Current result not found: ${currentId}`);

    const changePercent =
      baseline.stats.mean !== 0
        ? ((current.stats.mean - baseline.stats.mean) / baseline.stats.mean) * 100
        : 0;

    const comparison: BenchmarkComparison = {
      baseline,
      current,
      regressionDetected: false,
      changePercent,
      significant: this.isSignificant(baseline, current),
    };

    comparison.regressionDetected = this.detectRegression(comparison);

    if (comparison.regressionDetected) {
      this.regressionsDetected++;
      logger.warn(`Regression detected: ${changePercent.toFixed(2)}% slower`, {
        baselineId,
        currentId,
      });
    }

    return comparison;
  }

  /** Detect whether a comparison represents a regression beyond the threshold. */
  detectRegression(comparison: BenchmarkComparison, thresholdPercent = 5): boolean {
    return comparison.changePercent > thresholdPercent && comparison.significant;
  }

  /** Compute trend over the last N results for a benchmark. */
  getTrend(benchmarkId: string, lastN = 10): BenchmarkTrend {
    const allResults = this.getAllResultsForBenchmark(benchmarkId);
    const results = allResults.slice(-lastN);

    if (results.length < 2) {
      return { benchmarkId, results, trend: 'stable', avgChangePercent: 0 };
    }

    const changes: number[] = [];
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1].stats.mean;
      const curr = results[i].stats.mean;
      if (prev !== 0) {
        changes.push(((curr - prev) / prev) * 100);
      }
    }

    const avgChangePercent =
      changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

    let trend: 'improving' | 'stable' | 'degrading';
    if (avgChangePercent < -2) {
      trend = 'improving';
    } else if (avgChangePercent > 2) {
      trend = 'degrading';
    } else {
      trend = 'stable';
    }

    logger.debug(`Trend for ${benchmarkId}: ${trend} (${avgChangePercent.toFixed(2)}%)`);
    return { benchmarkId, results, trend, avgChangePercent };
  }

  /** Get all results stored for a given suite. */
  getResults(suiteId: string): BenchmarkResult[] {
    return this.results.get(suiteId) ?? [];
  }

  /** Retrieve a registered suite by id. */
  getSuite(suiteId: string): BenchmarkSuite | null {
    return this.suites.get(suiteId) ?? null;
  }

  /** Return aggregate engine statistics. */
  getStats(): EngineStats {
    let totalBenchmarks = 0;
    let totalExecutionTime = 0;
    let resultCount = 0;

    for (const suite of this.suites.values()) {
      totalBenchmarks += suite.benchmarks.length;
    }

    for (const results of this.results.values()) {
      for (const r of results) {
        totalExecutionTime += r.stats.mean * r.timings.length;
        resultCount++;
      }
    }

    return {
      totalSuites: this.suites.size,
      totalBenchmarks,
      totalRuns: this.totalRuns,
      avgExecutionTimeMs: resultCount > 0 ? totalExecutionTime / resultCount : 0,
      regressionsDetected: this.regressionsDetected,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Determine if the difference between two results is statistically significant
   * using a two-sample Welch's t-test approximation.
   */
  private isSignificant(baseline: BenchmarkResult, current: BenchmarkResult): boolean {
    const n1 = baseline.timings.length;
    const n2 = current.timings.length;
    if (n1 < 2 || n2 < 2) return false;

    const mean1 = baseline.stats.mean;
    const mean2 = current.stats.mean;
    const var1 = baseline.stats.variance;
    const var2 = current.stats.variance;

    const se = Math.sqrt(var1 / n1 + var2 / n2);
    if (se === 0) return false;

    const tStat = Math.abs(mean2 - mean1) / se;

    // Welch-Satterthwaite degrees of freedom
    const num = (var1 / n1 + var2 / n2) ** 2;
    const denom =
      (var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1);
    const df = denom > 0 ? num / denom : 1;

    // Approximate critical t-value for p < 0.05 (two-tailed)
    const criticalT = df >= 30 ? 1.96 : df >= 10 ? 2.228 : df >= 5 ? 2.571 : 2.776;

    return tStat > criticalT;
  }

  /** Collect all results across every suite for a specific benchmark id. */
  private getAllResultsForBenchmark(benchmarkId: string): BenchmarkResult[] {
    const collected: BenchmarkResult[] = [];
    for (const results of this.results.values()) {
      for (const r of results) {
        if (r.benchmarkId === benchmarkId) {
          collected.push(r);
        }
      }
    }
    collected.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return collected;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  var __performanceBenchmarkingEngine__: PerformanceBenchmarkingEngine | undefined;
}

export function getBenchmarkingEngine(): PerformanceBenchmarkingEngine {
  if (!globalThis.__performanceBenchmarkingEngine__) {
    globalThis.__performanceBenchmarkingEngine__ = new PerformanceBenchmarkingEngine();
  }
  return globalThis.__performanceBenchmarkingEngine__;
}
