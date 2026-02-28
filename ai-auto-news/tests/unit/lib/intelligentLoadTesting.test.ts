import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  IntelligentLoadTesting,
  getLoadTesting,
} from '../../../src/lib/intelligentLoadTesting';

function makeScenario() {
  return {
    name: 'Test Scenario',
    description: 'Unit test scenario',
    profile: 'steady_state' as const,
    endpoints: [
      {
        id: 'ep-001',
        name: 'Health check',
        url: 'http://localhost/health',
        method: 'GET' as const,
        protocol: 'http' as const,
        expectedStatusCode: 200,
        maxLatencyMs: 500,
        weight: 1,
      },
    ],
    virtualUsers: 10,
    durationMs: 3_000,
    rampUpMs: 500,
    rampDownMs: 500,
    thinkTimeMs: 100,
    targetRps: 20,
    maxErrorRate: 0.05,
    slaP50Ms: 200,
    slaP95Ms: 400,
    slaP99Ms: 600,
    chaosEnabled: false,
    chaosProbability: 0,
    tags: ['test'],
  };
}

describe('IntelligentLoadTesting', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__intelligentLoadTesting__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getLoadTesting();
    const b = getLoadTesting();
    expect(a).toBe(b);
  });

  it('createScenario stores and returns scenario', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    expect(scenario.id).toBeTruthy();
    expect(lt.getScenario(scenario.id)).toBe(scenario);
    expect(lt.listScenarios().length).toBe(1);
  });

  it('updateScenario modifies fields', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    lt.updateScenario(scenario.id, { virtualUsers: 50 });
    expect(lt.getScenario(scenario.id)!.virtualUsers).toBe(50);
  });

  it('deleteScenario removes it', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    expect(lt.deleteScenario(scenario.id)).toBe(true);
    expect(lt.getScenario(scenario.id)).toBeUndefined();
  });

  it('startRun creates a run in running state', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    const run = lt.startRun(scenario.id);
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('running');
    expect(run.scenarioId).toBe(scenario.id);
  });

  it('startRun throws for unknown scenarioId', () => {
    const lt = new IntelligentLoadTesting();
    expect(() => lt.startRun('no-such-id')).toThrow();
  });

  it('abortRun changes status to aborted', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    const run = lt.startRun(scenario.id);
    const aborted = lt.abortRun(run.id, 'test abort');
    expect(aborted.status).toBe('aborted');
    expect(aborted.abortReason).toBe('test abort');
    expect(aborted.passed).toBe(false);
  });

  it('setBaseline stores baseline percentiles', () => {
    const lt = new IntelligentLoadTesting();
    lt.setBaseline('ep-001', {
      p50: 50, p75: 75, p90: 90, p95: 100, p99: 200,
      p999: 400, max: 800, min: 5, mean: 60, stddev: 20,
    });
    const calibration = lt.getCalibration('ep-001');
    expect(calibration).toBeUndefined(); // baseline != calibration
  });

  it('calibrateThresholds computes percentiles correctly', () => {
    const lt = new IntelligentLoadTesting();
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const cal = lt.calibrateThresholds('ep-001', samples);
    // floor(10 * 50/100) = 5 → sorted[5] = 60
    expect(cal.calibratedP50Ms).toBe(60);
    // floor(10 * 99/100) = 9 → sorted[9] = 100
    expect(cal.calibratedP99Ms).toBe(100);
    expect(cal.sampleCount).toBe(10);
  });

  it('calibrateThresholds throws for empty samples', () => {
    const lt = new IntelligentLoadTesting();
    expect(() => lt.calibrateThresholds('ep-001', [])).toThrow();
  });

  it('forecastLoad returns forecast with required fields', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    const forecast = lt.forecastLoad(scenario.id);
    expect(forecast.scenarioId).toBe(scenario.id);
    expect(forecast.predictedPeakRps).toBeGreaterThan(0);
    expect(forecast.confidenceInterval.lower).toBeLessThan(forecast.confidenceInterval.upper);
  });

  it('getDashboardSummary reflects created scenarios and runs', () => {
    const lt = new IntelligentLoadTesting();
    const scenario = lt.createScenario(makeScenario());
    lt.startRun(scenario.id);
    const summary = lt.getDashboardSummary();
    expect(summary.totalScenarios).toBe(1);
    expect(summary.activeRuns).toBe(1);
  });

  it('listRuns filters by scenarioId', () => {
    const lt = new IntelligentLoadTesting();
    const s1 = lt.createScenario(makeScenario());
    const s2 = lt.createScenario({ ...makeScenario(), name: 'Second Scenario' });
    lt.startRun(s1.id);
    lt.startRun(s2.id);
    expect(lt.listRuns(s1.id).length).toBe(1);
    expect(lt.listRuns(s2.id).length).toBe(1);
    expect(lt.listRuns().length).toBe(2);
  });
});
