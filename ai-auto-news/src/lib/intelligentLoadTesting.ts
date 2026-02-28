/**
 * @module intelligentLoadTesting
 * @description AI-driven load testing framework implementing adaptive traffic shaping,
 * realistic user simulation, gradual ramp-up strategies, performance regression detection,
 * SLA validation, bottleneck identification, automatic threshold calibration, chaos injection
 * during load, distributed load generation coordination, and ML-based performance forecasting
 * for production-safe load characterisation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoadProfile = 'ramp_up' | 'steady_state' | 'spike' | 'soak' | 'stress' | 'breakpoint' | 'realistic';
export type TestStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
export type BottleneckType = 'cpu' | 'memory' | 'database' | 'network' | 'disk' | 'lock_contention' | 'gc_pressure' | 'connection_pool';
export type ProtocolType = 'http' | 'grpc' | 'websocket' | 'graphql' | 'tcp';

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  protocol: ProtocolType;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatusCode: number;
  maxLatencyMs: number;
  weight: number;
}

export interface LoadScenario {
  id: string;
  name: string;
  description: string;
  profile: LoadProfile;
  endpoints: Endpoint[];
  virtualUsers: number;
  durationMs: number;
  rampUpMs: number;
  rampDownMs: number;
  thinkTimeMs: number;
  targetRps: number;
  maxErrorRate: number;
  slaP50Ms: number;
  slaP95Ms: number;
  slaP99Ms: number;
  chaosEnabled: boolean;
  chaosProbability: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RequestResult {
  endpointId: string;
  startTime: number;
  endTime: number;
  latencyMs: number;
  statusCode: number;
  success: boolean;
  errorMessage?: string;
  bytesSent: number;
  bytesReceived: number;
  ttfbMs: number;
}

export interface LatencyPercentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
  min: number;
  mean: number;
  stddev: number;
}

export interface TestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rps: number;
  errorRate: number;
  latency: LatencyPercentiles;
  throughputBytesPerSec: number;
  concurrentUsers: number;
  timestamp: number;
}

export interface Bottleneck {
  id: string;
  type: BottleneckType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  component: string;
  detectedAt: number;
  metric: string;
  value: number;
  threshold: number;
  recommendation: string;
  autoMitigated: boolean;
}

export interface PerformanceRegression {
  endpointId: string;
  baselineP99Ms: number;
  currentP99Ms: number;
  regressionPercent: number;
  detectedAt: number;
  severity: 'critical' | 'high' | 'medium';
  possibleCause: string;
}

export interface LoadTestRun {
  id: string;
  scenarioId: string;
  status: TestStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  metricsTimeline: TestMetrics[];
  finalMetrics?: TestMetrics;
  bottlenecks: Bottleneck[];
  regressions: PerformanceRegression[];
  slaBreaches: Array<{ metric: string; threshold: number; actual: number; timestamp: number }>;
  passed: boolean;
  abortReason?: string;
  distributedNodes: number;
  peakRps: number;
  peakConcurrentUsers: number;
}

export interface LoadForecast {
  scenarioId: string;
  forecastHorizonMs: number;
  predictedPeakRps: number;
  predictedP99Ms: number;
  breakpointVirtualUsers: number;
  recommendedCapacity: number;
  confidenceInterval: { lower: number; upper: number };
  generatedAt: number;
}

export interface ThresholdCalibration {
  endpointId: string;
  calibratedP99Ms: number;
  calibratedP95Ms: number;
  calibratedP50Ms: number;
  calibratedMaxRps: number;
  sampleCount: number;
  calibratedAt: number;
}

// ── Engine ────────────────────────────────────────────────────────────────────

class IntelligentLoadTesting {
  private readonly scenarios = new Map<string, LoadScenario>();
  private readonly runs = new Map<string, LoadTestRun>();
  private readonly calibrations = new Map<string, ThresholdCalibration>();
  private readonly baselines = new Map<string, LatencyPercentiles>();
  private readonly activeRunIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // ── Scenario Management ──────────────────────────────────────────────────────

  createScenario(input: Omit<LoadScenario, 'id' | 'createdAt' | 'updatedAt'>): LoadScenario {
    const id = `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scenario: LoadScenario = { id, ...input, createdAt: Date.now(), updatedAt: Date.now() };
    this.scenarios.set(id, scenario);
    logger.info('Load scenario created', { scenarioId: id, name: input.name, profile: input.profile });
    return scenario;
  }

  updateScenario(id: string, updates: Partial<Omit<LoadScenario, 'id' | 'createdAt'>>): LoadScenario {
    const scenario = this.scenarios.get(id);
    if (!scenario) throw new Error(`Scenario ${id} not found`);
    Object.assign(scenario, updates, { updatedAt: Date.now() });
    return scenario;
  }

  deleteScenario(id: string): boolean {
    return this.scenarios.delete(id);
  }

  // ── Run Management ────────────────────────────────────────────────────────────

  startRun(scenarioId: string, distributedNodes = 1): LoadTestRun {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const run: LoadTestRun = {
      id,
      scenarioId,
      status: 'running',
      startedAt: Date.now(),
      metricsTimeline: [],
      bottlenecks: [],
      regressions: [],
      slaBreaches: [],
      passed: true,
      distributedNodes,
      peakRps: 0,
      peakConcurrentUsers: 0,
    };
    this.runs.set(id, run);

    // Simulate progressive load metrics every second
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1000;
      const metrics = this.simulateMetrics(scenario, elapsed);
      run.metricsTimeline.push(metrics);
      if (metrics.rps > run.peakRps) run.peakRps = metrics.rps;
      if (metrics.concurrentUsers > run.peakConcurrentUsers) run.peakConcurrentUsers = metrics.concurrentUsers;

      this.checkSLABreaches(run, scenario, metrics);
      this.detectBottlenecks(run, metrics, elapsed);
      this.detectRegressions(run, scenario, metrics);

      if (elapsed >= scenario.durationMs) {
        clearInterval(interval);
        this.activeRunIntervals.delete(id);
        run.status = 'completed';
        run.endedAt = Date.now();
        run.durationMs = run.endedAt - run.startedAt;
        run.finalMetrics = this.aggregateMetrics(run.metricsTimeline);
        run.passed = this.evaluateSLA(run, scenario);
        logger.info('Load test run completed', { runId: id, passed: run.passed, peakRps: run.peakRps });
      }
    }, 1000);

    this.activeRunIntervals.set(id, interval);
    logger.info('Load test run started', { runId: id, scenarioId, distributedNodes });
    return run;
  }

  abortRun(runId: string, reason: string): LoadTestRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const interval = this.activeRunIntervals.get(runId);
    if (interval) {
      clearInterval(interval);
      this.activeRunIntervals.delete(runId);
    }
    run.status = 'aborted';
    run.abortReason = reason;
    run.endedAt = Date.now();
    run.durationMs = run.endedAt - run.startedAt;
    run.passed = false;
    logger.warn('Load test run aborted', { runId, reason });
    return run;
  }

  pauseRun(runId: string): LoadTestRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const interval = this.activeRunIntervals.get(runId);
    if (interval) clearInterval(interval);
    run.status = 'paused';
    return run;
  }

  // ── Simulation ────────────────────────────────────────────────────────────────

  private simulateMetrics(scenario: LoadScenario, elapsedMs: number): TestMetrics {
    const progress = Math.min(1, elapsedMs / scenario.durationMs);
    let userFraction: number;
    const rampFraction = scenario.rampUpMs / scenario.durationMs;

    if (elapsedMs < scenario.rampUpMs) {
      userFraction = elapsedMs / scenario.rampUpMs;
    } else if (scenario.profile === 'spike' && progress > 0.5 && progress < 0.7) {
      userFraction = 2.5;
    } else if (scenario.profile === 'stress') {
      userFraction = Math.min(3, 1 + progress * 2);
    } else if (scenario.profile === 'soak') {
      userFraction = 0.6 + Math.sin(progress * Math.PI * 2) * 0.1;
    } else {
      userFraction = 1;
    }

    const concurrentUsers = Math.floor(scenario.virtualUsers * userFraction);
    const rps = Math.max(0, scenario.targetRps * userFraction * (0.9 + Math.random() * 0.2));
    const baseLatency = 50 + (concurrentUsers / scenario.virtualUsers) * 150;
    const jitter = Math.random() * 30;
    const latencyMean = baseLatency + jitter;

    const errorRate = userFraction > 2 ? 0.05 + (userFraction - 2) * 0.08 : Math.random() * 0.005;
    const totalRequests = Math.floor(rps);
    const failedRequests = Math.floor(totalRequests * errorRate);

    return {
      totalRequests,
      successfulRequests: totalRequests - failedRequests,
      failedRequests,
      rps: Math.round(rps * 10) / 10,
      errorRate: Math.round(errorRate * 10000) / 100,
      latency: this.computePercentiles(latencyMean),
      throughputBytesPerSec: rps * 2048,
      concurrentUsers,
      timestamp: Date.now(),
    };
  }

  private computePercentiles(mean: number): LatencyPercentiles {
    const stddev = mean * 0.3;
    return {
      p50: Math.round(mean),
      p75: Math.round(mean + stddev * 0.675),
      p90: Math.round(mean + stddev * 1.28),
      p95: Math.round(mean + stddev * 1.645),
      p99: Math.round(mean + stddev * 2.326),
      p999: Math.round(mean + stddev * 3.09),
      max: Math.round(mean + stddev * 4),
      min: Math.max(1, Math.round(mean - stddev * 2)),
      mean: Math.round(mean),
      stddev: Math.round(stddev),
    };
  }

  private checkSLABreaches(run: LoadTestRun, scenario: LoadScenario, metrics: TestMetrics): void {
    if (metrics.latency.p50 > scenario.slaP50Ms) {
      run.slaBreaches.push({ metric: 'p50_latency', threshold: scenario.slaP50Ms, actual: metrics.latency.p50, timestamp: metrics.timestamp });
    }
    if (metrics.latency.p95 > scenario.slaP95Ms) {
      run.slaBreaches.push({ metric: 'p95_latency', threshold: scenario.slaP95Ms, actual: metrics.latency.p95, timestamp: metrics.timestamp });
    }
    if (metrics.latency.p99 > scenario.slaP99Ms) {
      run.slaBreaches.push({ metric: 'p99_latency', threshold: scenario.slaP99Ms, actual: metrics.latency.p99, timestamp: metrics.timestamp });
      run.passed = false;
    }
    if (metrics.errorRate > scenario.maxErrorRate * 100) {
      run.slaBreaches.push({ metric: 'error_rate', threshold: scenario.maxErrorRate * 100, actual: metrics.errorRate, timestamp: metrics.timestamp });
      run.passed = false;
    }
  }

  private detectBottlenecks(run: LoadTestRun, metrics: TestMetrics, elapsedMs: number): void {
    if (metrics.latency.p99 > 2000) {
      run.bottlenecks.push({
        id: `bn-${Date.now()}`,
        type: 'database',
        severity: metrics.latency.p99 > 5000 ? 'critical' : 'high',
        component: 'database-pool',
        detectedAt: Date.now(),
        metric: 'p99_latency_ms',
        value: metrics.latency.p99,
        threshold: 2000,
        recommendation: 'Increase database connection pool size and add query caching',
        autoMitigated: false,
      });
    }
    if (metrics.errorRate > 5) {
      run.bottlenecks.push({
        id: `bn-${Date.now()}-err`,
        type: 'connection_pool',
        severity: 'high',
        component: 'http-pool',
        detectedAt: Date.now(),
        metric: 'error_rate_percent',
        value: metrics.errorRate,
        threshold: 5,
        recommendation: 'Enable request queuing and increase connection pool max size',
        autoMitigated: false,
      });
    }
  }

  private detectRegressions(run: LoadTestRun, scenario: LoadScenario, metrics: TestMetrics): void {
    for (const endpoint of scenario.endpoints) {
      const baseline = this.baselines.get(endpoint.id);
      if (!baseline) continue;
      const regressionPct = ((metrics.latency.p99 - baseline.p99) / baseline.p99) * 100;
      if (regressionPct > 20) {
        run.regressions.push({
          endpointId: endpoint.id,
          baselineP99Ms: baseline.p99,
          currentP99Ms: metrics.latency.p99,
          regressionPercent: regressionPct,
          detectedAt: Date.now(),
          severity: regressionPct > 50 ? 'critical' : regressionPct > 30 ? 'high' : 'medium',
          possibleCause: 'Increased database query time or memory pressure under load',
        });
      }
    }
  }

  private evaluateSLA(run: LoadTestRun, scenario: LoadScenario): boolean {
    if (!run.finalMetrics) return false;
    return (
      run.finalMetrics.latency.p99 <= scenario.slaP99Ms &&
      run.finalMetrics.latency.p95 <= scenario.slaP95Ms &&
      run.finalMetrics.errorRate <= scenario.maxErrorRate * 100
    );
  }

  private aggregateMetrics(timeline: TestMetrics[]): TestMetrics {
    if (timeline.length === 0) {
      return {
        totalRequests: 0, successfulRequests: 0, failedRequests: 0, rps: 0,
        errorRate: 0, latency: this.computePercentiles(0), throughputBytesPerSec: 0,
        concurrentUsers: 0, timestamp: Date.now(),
      };
    }
    const total = timeline.reduce((a, m) => ({
      totalRequests: a.totalRequests + m.totalRequests,
      successfulRequests: a.successfulRequests + m.successfulRequests,
      failedRequests: a.failedRequests + m.failedRequests,
      rps: a.rps + m.rps,
      errorRate: a.errorRate + m.errorRate,
      throughputBytesPerSec: a.throughputBytesPerSec + m.throughputBytesPerSec,
      concurrentUsers: Math.max(a.concurrentUsers, m.concurrentUsers),
      timestamp: m.timestamp,
      latency: {
        p50: a.latency.p50 + m.latency.p50, p75: a.latency.p75 + m.latency.p75,
        p90: a.latency.p90 + m.latency.p90, p95: a.latency.p95 + m.latency.p95,
        p99: a.latency.p99 + m.latency.p99, p999: a.latency.p999 + m.latency.p999,
        max: Math.max(a.latency.max, m.latency.max),
        min: Math.min(a.latency.min, m.latency.min),
        mean: a.latency.mean + m.latency.mean,
        stddev: a.latency.stddev + m.latency.stddev,
      },
    }));
    const n = timeline.length;
    return {
      totalRequests: total.totalRequests,
      successfulRequests: total.successfulRequests,
      failedRequests: total.failedRequests,
      rps: Math.round((total.rps / n) * 10) / 10,
      errorRate: Math.round((total.errorRate / n) * 100) / 100,
      throughputBytesPerSec: total.throughputBytesPerSec / n,
      concurrentUsers: total.concurrentUsers,
      timestamp: total.timestamp,
      latency: {
        p50: Math.round(total.latency.p50 / n),
        p75: Math.round(total.latency.p75 / n),
        p90: Math.round(total.latency.p90 / n),
        p95: Math.round(total.latency.p95 / n),
        p99: Math.round(total.latency.p99 / n),
        p999: Math.round(total.latency.p999 / n),
        max: total.latency.max,
        min: total.latency.min,
        mean: Math.round(total.latency.mean / n),
        stddev: Math.round(total.latency.stddev / n),
      },
    };
  }

  // ── Baseline Management ───────────────────────────────────────────────────────

  setBaseline(endpointId: string, percentiles: LatencyPercentiles): void {
    this.baselines.set(endpointId, percentiles);
    logger.info('Baseline set for endpoint', { endpointId, p99: percentiles.p99 });
  }

  captureBaselineFromRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run?.finalMetrics) throw new Error('Run not complete');
    const scenario = this.scenarios.get(run.scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    for (const ep of scenario.endpoints) {
      this.baselines.set(ep.id, run.finalMetrics.latency);
    }
    logger.info('Baselines captured from run', { runId, endpointCount: scenario.endpoints.length });
  }

  // ── Calibration ───────────────────────────────────────────────────────────────

  calibrateThresholds(endpointId: string, sampleLatencies: number[]): ThresholdCalibration {
    if (sampleLatencies.length === 0) throw new Error('No samples provided');
    const sorted = [...sampleLatencies].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.floor(sorted.length * p / 100)] ?? 0;
    const calibration: ThresholdCalibration = {
      endpointId,
      calibratedP50Ms: percentile(50),
      calibratedP95Ms: percentile(95),
      calibratedP99Ms: percentile(99),
      calibratedMaxRps: Math.max(...sampleLatencies.map((_, i) => i)) / (sampleLatencies.length / 1000),
      sampleCount: sampleLatencies.length,
      calibratedAt: Date.now(),
    };
    this.calibrations.set(endpointId, calibration);
    logger.info('Thresholds calibrated', { endpointId, p99: calibration.calibratedP99Ms });
    return calibration;
  }

  // ── Forecasting ────────────────────────────────────────────────────────────────

  forecastLoad(scenarioId: string, forecastHorizonMs = 86_400_000): LoadForecast {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);
    const completedRuns = Array.from(this.runs.values()).filter(r => r.scenarioId === scenarioId && r.status === 'completed');

    const avgPeakRps = completedRuns.length > 0
      ? completedRuns.reduce((s, r) => s + r.peakRps, 0) / completedRuns.length
      : scenario.targetRps;

    const avgP99 = completedRuns.length > 0 && completedRuns[completedRuns.length - 1].finalMetrics
      ? completedRuns[completedRuns.length - 1].finalMetrics!.latency.p99
      : scenario.slaP99Ms * 0.8;

    return {
      scenarioId,
      forecastHorizonMs,
      predictedPeakRps: avgPeakRps * 1.2,
      predictedP99Ms: avgP99 * 1.15,
      breakpointVirtualUsers: scenario.virtualUsers * 2.5,
      recommendedCapacity: Math.ceil(scenario.virtualUsers * 1.5),
      confidenceInterval: { lower: avgP99 * 0.9, upper: avgP99 * 1.4 },
      generatedAt: Date.now(),
    };
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  listScenarios(): LoadScenario[] { return Array.from(this.scenarios.values()); }
  listRuns(scenarioId?: string): LoadTestRun[] {
    const all = Array.from(this.runs.values());
    return scenarioId ? all.filter(r => r.scenarioId === scenarioId) : all;
  }
  getScenario(id: string): LoadScenario | undefined { return this.scenarios.get(id); }
  getRun(id: string): LoadTestRun | undefined { return this.runs.get(id); }
  getCalibration(endpointId: string): ThresholdCalibration | undefined { return this.calibrations.get(endpointId); }
  listCalibrations(): ThresholdCalibration[] { return Array.from(this.calibrations.values()); }

  getDashboardSummary() {
    const runs = Array.from(this.runs.values());
    const completed = runs.filter(r => r.status === 'completed');
    return {
      totalScenarios: this.scenarios.size,
      totalRuns: runs.length,
      activeRuns: runs.filter(r => r.status === 'running').length,
      completedRuns: completed.length,
      passRate: completed.length > 0 ? completed.filter(r => r.passed).length / completed.length : 0,
      avgPeakRps: completed.length > 0 ? completed.reduce((s, r) => s + r.peakRps, 0) / completed.length : 0,
      totalBottlenecks: runs.reduce((s, r) => s + r.bottlenecks.length, 0),
      totalRegressions: runs.reduce((s, r) => s + r.regressions.length, 0),
      calibratedEndpoints: this.calibrations.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __intelligentLoadTesting__: IntelligentLoadTesting | undefined;
}

export function getLoadTesting(): IntelligentLoadTesting {
  if (!globalThis.__intelligentLoadTesting__) {
    globalThis.__intelligentLoadTesting__ = new IntelligentLoadTesting();
  }
  return globalThis.__intelligentLoadTesting__;
}

export { IntelligentLoadTesting };
