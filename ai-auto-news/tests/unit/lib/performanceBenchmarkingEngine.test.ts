import { describe, it, expect, beforeEach } from '@jest/globals';
import { getBenchmarkingEngine } from '@/lib/performanceBenchmarkingEngine';
import type { Benchmark } from '@/lib/performanceBenchmarkingEngine';

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: 'bench1', name: 'simple-op',
    fn: () => { let s = 0; for (let i = 0; i < 100; i++) s += i; },
    iterations: 10, warmupIterations: 2, ...overrides,
  };
}

describe('PerformanceBenchmarkingEngine', () => {
  let engine: ReturnType<typeof getBenchmarkingEngine>;

  beforeEach(() => {
    delete (globalThis as any).__performanceBenchmarkingEngine__;
    engine = getBenchmarkingEngine();
  });

  it('registerSuite registers a suite', () => {
    const suite = engine.registerSuite({
      name: 'TestSuite', description: 'Unit test suite',
      benchmarks: [makeBenchmark()],
    });
    expect(suite.id).toBeDefined();
    expect(suite.name).toBe('TestSuite');
    expect(suite.benchmarks).toHaveLength(1);
  });

  it('runBenchmark runs and returns timing stats', async () => {
    const result = await engine.runBenchmark(makeBenchmark());
    expect(result.timings).toHaveLength(10);
    expect(result.stats.mean).toBeGreaterThan(0);
    expect(result.stats.median).toBeGreaterThan(0);
    expect(result.stats.p95).toBeGreaterThanOrEqual(result.stats.median);
    expect(result.throughput).toBeGreaterThan(0);
  });

  it('runSuite runs all benchmarks in suite', async () => {
    const suite = engine.registerSuite({
      name: 'Suite', description: 'desc',
      benchmarks: [makeBenchmark(), makeBenchmark({ id: 'bench2', name: 'op2' })],
    });
    const results = await engine.runSuite(suite.id);
    expect(results).toHaveLength(2);
    expect(results[0].suiteName).toBe('Suite');
  });

  it('compare compares two results', async () => {
    const fast = makeBenchmark({ id: 'fast', fn: () => {} });
    const slow = makeBenchmark({
      id: 'slow',
      fn: () => { const arr = []; for (let i = 0; i < 10000; i++) arr.push(i); },
    });
    const r1 = await engine.runBenchmark(fast);
    const r2 = await engine.runBenchmark(slow);
    const key1 = `${r1.benchmarkId}-${r1.timestamp.getTime()}`;
    const key2 = `${r2.benchmarkId}-${r2.timestamp.getTime()}`;
    const comparison = engine.compare(key1, key2);
    expect(comparison).toHaveProperty('changePercent');
    expect(comparison.baseline.benchmarkId).toBe('fast');
    expect(comparison.current.benchmarkId).toBe('slow');
  });

  it('getTrend returns trend data', async () => {
    const suite = engine.registerSuite({
      name: 'TrendSuite', description: 'trend',
      benchmarks: [makeBenchmark()],
    });
    await engine.runSuite(suite.id);
    await engine.runSuite(suite.id);
    const trend = engine.getTrend('bench1');
    expect(trend.benchmarkId).toBe('bench1');
    expect(trend.results.length).toBeGreaterThanOrEqual(2);
    expect(['improving', 'stable', 'degrading']).toContain(trend.trend);
  });

  it('detectRegression detects performance regression', () => {
    const comparison = {
      baseline: { stats: { mean: 1 } } as any,
      current: { stats: { mean: 2 } } as any,
      regressionDetected: false, changePercent: 100, significant: true,
    };
    expect(engine.detectRegression(comparison)).toBe(true);
  });

  it('detectRegression returns false for small changes', () => {
    const comparison = {
      baseline: { stats: { mean: 1 } } as any,
      current: { stats: { mean: 1.01 } } as any,
      regressionDetected: false, changePercent: 1, significant: false,
    };
    expect(engine.detectRegression(comparison)).toBe(false);
  });

  it('getStats returns engine stats', async () => {
    const suite = engine.registerSuite({
      name: 'StatsSuite', description: 'stats',
      benchmarks: [makeBenchmark()],
    });
    await engine.runSuite(suite.id);
    const stats = engine.getStats();
    expect(stats.totalSuites).toBe(1);
    expect(stats.totalBenchmarks).toBe(1);
    expect(stats.totalRuns).toBe(1);
  });
});
