import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  DigitalTwinEngine,
  getDigitalTwinEngine,
  EntityType,
  SimulationMode,
} from '../../../src/lib/digitalTwinEngine';

function makeTwinParams(overrides: { entityType?: EntityType } = {}) {
  return {
    entityId: `entity_${Math.random().toString(36).substring(2, 7)}`,
    entityType: (overrides.entityType ?? 'server') as EntityType,
    label: 'Test Server',
    initialState: { region: 'us-east-1', version: '2.1.0' },
    initialMetrics: { cpu_percent: 30, memory_percent: 50 },
  };
}

describe('DigitalTwinEngine', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__digitalTwinEngine__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getDigitalTwinEngine();
    const b = getDigitalTwinEngine();
    expect(a).toBe(b);
  });

  it('registers twin and retrieves it', () => {
    const engine = new DigitalTwinEngine();
    const params = makeTwinParams();
    const twin = engine.registerTwin(params);
    expect(twin.twinId).toBeTruthy();
    expect(engine.getTwin(twin.twinId)).toBe(twin);
  });

  it('getTwinByEntityId finds twin', () => {
    const engine = new DigitalTwinEngine();
    const params = makeTwinParams();
    const twin = engine.registerTwin(params);
    expect(engine.getTwinByEntityId(params.entityId)?.twinId).toBe(twin.twinId);
  });

  it('syncState applies state changes and increments version', () => {
    const engine = new DigitalTwinEngine();
    const twin = engine.registerTwin(makeTwinParams());
    const prevVersion = twin.version;
    engine.syncState({
      twinId: twin.twinId,
      entityId: twin.entityId,
      stateChanges: { region: 'eu-west-1' },
      metricsChanges: { cpu_percent: 60 },
      timestamp: Date.now(),
      source: 'test',
    });
    expect(twin.version).toBe(prevVersion + 1);
    expect(twin.state['region']).toBe('eu-west-1');
    expect(twin.metrics['cpu_percent']).toBe(60);
  });

  it('takeSnapshot captures state and restoreSnapshot applies it', () => {
    const engine = new DigitalTwinEngine();
    const twin = engine.registerTwin(makeTwinParams());
    twin.state['key'] = 'original';
    const snapshot = engine.takeSnapshot(twin.twinId, 'test_snap');
    twin.state['key'] = 'modified';
    engine.restoreSnapshot(twin.twinId, snapshot.snapshotId);
    expect(twin.state['key']).toBe('original');
  });

  it('analyzeDrift detects diverged fields', () => {
    const engine = new DigitalTwinEngine();
    const twin = engine.registerTwin(makeTwinParams());
    // Make twin metrics diverge
    twin.metrics['cpu_percent'] = 30;
    const report = engine.analyzeDrift(twin.twinId, { region: 'ap-southeast-1' }, { cpu_percent: 90 });
    expect(report.divergedFields.length).toBeGreaterThan(0);
    expect(report.driftScore).toBeGreaterThan(0);
  });

  it('runSimulation stress_test returns risks for overloaded workers', async () => {
    const engine = new DigitalTwinEngine();
    const twin = engine.registerTwin(makeTwinParams());
    twin.metrics['cpu_percent'] = 10;
    const scenario = engine.createScenario({
      name: 'stress test',
      mode: 'stress_test' as SimulationMode,
      targetTwinIds: [twin.twinId],
      parameters: { loadMultiplier: 12 },
      durationMs: 50,
    });
    const result = await engine.runSimulation(scenario.scenarioId);
    expect(result.scenarioId).toBe(scenario.scenarioId);
    expect(result.completedAt).toBeGreaterThan(0);
    expect(result.risks.length).toBeGreaterThan(0);
  });

  it('getGlobalDriftSummary reflects registered twins', () => {
    const engine = new DigitalTwinEngine();
    engine.registerTwin(makeTwinParams());
    engine.registerTwin(makeTwinParams());
    const summary = engine.getGlobalDriftSummary();
    expect(summary.totalTwins).toBe(2);
  });

  it('deregistering twin removes it from listing', () => {
    const engine = new DigitalTwinEngine();
    const twin = engine.registerTwin(makeTwinParams());
    expect(engine.listTwins()).toHaveLength(1);
    engine.deregisterTwin(twin.twinId);
    expect(engine.listTwins()).toHaveLength(0);
  });
});
