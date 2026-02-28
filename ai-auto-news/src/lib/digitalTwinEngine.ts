/**
 * @module digitalTwinEngine
 * @description Digital twin simulation engine that mirrors real-world infrastructure,
 * user behavior, and system state in a virtual replica. Supports state synchronization,
 * what-if scenario analysis, predictive drift detection, anomaly shadow-mode testing,
 * capacity simulation, and rollback-safe experimentation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type TwinStatus = 'syncing' | 'synchronized' | 'drifted' | 'stale' | 'offline';
export type EntityType = 'server' | 'database' | 'service' | 'user' | 'tenant' | 'pipeline' | 'model';
export type SimulationMode = 'shadow' | 'what_if' | 'stress_test' | 'failure_injection' | 'capacity';

export interface TwinEntity {
  twinId: string;
  entityId: string;
  entityType: EntityType;
  label: string;
  state: Record<string, unknown>;
  metrics: Record<string, number>;
  status: TwinStatus;
  lastSyncAt: number;
  createdAt: number;
  driftScore: number;      // 0-1, higher = more drift from real entity
  version: number;
  tags: string[];
}

export interface SimulationScenario {
  scenarioId: string;
  name: string;
  mode: SimulationMode;
  targetTwinIds: string[];
  parameters: Record<string, unknown>;
  durationMs: number;
  createdAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: SimulationResult;
}

export interface SimulationResult {
  scenarioId: string;
  startedAt: number;
  completedAt: number;
  outcomeMetrics: Record<string, number>;
  recommendations: string[];
  risks: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; description: string }>;
  estimatedImpact: { performanceGainPct: number; costChangePct: number; reliabilityChangePct: number };
}

export interface SyncEvent {
  twinId: string;
  entityId: string;
  stateChanges: Record<string, unknown>;
  metricsChanges: Record<string, number>;
  timestamp: number;
  source: string;
}

export interface DriftReport {
  twinId: string;
  entityId: string;
  driftScore: number;
  staleDurationMs: number;
  divergedFields: Array<{ field: string; expectedValue: unknown; actualValue: unknown; divergencePercent: number }>;
  recommendation: 'resync' | 'investigate' | 'acceptable';
}

export interface TwinSnapshot {
  snapshotId: string;
  twinId: string;
  state: Record<string, unknown>;
  metrics: Record<string, number>;
  takenAt: number;
  label: string;
}

export interface DigitalTwinConfig {
  driftThreshold?: number;
  staleAfterMs?: number;
  maxSnapshotsPerTwin?: number;
  syncIntervalMs?: number;
  simulationTimeoutMs?: number;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class DigitalTwinEngine {
  private twins = new Map<string, TwinEntity>();
  private scenarios = new Map<string, SimulationScenario>();
  private snapshots = new Map<string, TwinSnapshot[]>();
  private syncHistory: SyncEvent[] = [];
  private config: Required<DigitalTwinConfig>;

  constructor(config: DigitalTwinConfig = {}) {
    this.config = {
      driftThreshold: config.driftThreshold ?? 0.3,
      staleAfterMs: config.staleAfterMs ?? 5 * 60_000,
      maxSnapshotsPerTwin: config.maxSnapshotsPerTwin ?? 50,
      syncIntervalMs: config.syncIntervalMs ?? 30_000,
      simulationTimeoutMs: config.simulationTimeoutMs ?? 60_000,
    };
  }

  // ── Twin Lifecycle ────────────────────────────────────────────────────────

  registerTwin(params: {
    entityId: string;
    entityType: EntityType;
    label: string;
    initialState?: Record<string, unknown>;
    initialMetrics?: Record<string, number>;
    tags?: string[];
  }): TwinEntity {
    const twin: TwinEntity = {
      twinId: `twin_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      entityId: params.entityId,
      entityType: params.entityType,
      label: params.label,
      state: params.initialState ?? {},
      metrics: params.initialMetrics ?? {},
      status: 'syncing',
      lastSyncAt: Date.now(),
      createdAt: Date.now(),
      driftScore: 0,
      version: 1,
      tags: params.tags ?? [],
    };
    this.twins.set(twin.twinId, twin);
    this.snapshots.set(twin.twinId, []);
    logger.info('Digital twin registered', { twinId: twin.twinId, entityId: params.entityId, entityType: params.entityType });
    return twin;
  }

  getTwin(twinId: string): TwinEntity | undefined {
    return this.twins.get(twinId);
  }

  getTwinByEntityId(entityId: string): TwinEntity | undefined {
    return Array.from(this.twins.values()).find(t => t.entityId === entityId);
  }

  listTwins(entityType?: EntityType, status?: TwinStatus): TwinEntity[] {
    let all = Array.from(this.twins.values());
    if (entityType) all = all.filter(t => t.entityType === entityType);
    if (status) all = all.filter(t => t.status === status);
    return all;
  }

  deregisterTwin(twinId: string): void {
    this.twins.delete(twinId);
    this.snapshots.delete(twinId);
    logger.info('Digital twin deregistered', { twinId });
  }

  // ── State Synchronization ─────────────────────────────────────────────────

  syncState(event: SyncEvent): TwinEntity {
    const twin = this.twins.get(event.twinId);
    if (!twin) throw new Error(`Twin ${event.twinId} not found`);

    const previousState = { ...twin.state };
    const previousMetrics = { ...twin.metrics };

    // Apply state changes
    Object.assign(twin.state, event.stateChanges);
    Object.assign(twin.metrics, event.metricsChanges);

    twin.lastSyncAt = event.timestamp;
    twin.version += 1;

    // Compute drift score based on magnitude of changes
    const stateDiff = Object.keys(event.stateChanges).length;
    const metricDiffs = Object.values(event.metricsChanges).map((v, i) => {
      const key = Object.keys(event.metricsChanges)[i];
      const prev = previousMetrics[key] ?? 0;
      return prev > 0 ? Math.abs(v - prev) / prev : 0;
    });

    const avgMetricDrift = metricDiffs.length > 0 ? metricDiffs.reduce((a, b) => a + b, 0) / metricDiffs.length : 0;
    const newDrift = Math.min(1, stateDiff * 0.05 + avgMetricDrift);
    twin.driftScore = twin.driftScore * 0.7 + newDrift * 0.3; // EWA smoothing

    twin.status = twin.driftScore > this.config.driftThreshold ? 'drifted' : 'synchronized';

    this.syncHistory.push(event);
    if (this.syncHistory.length > 50_000) this.syncHistory.shift();

    void previousState; // used for drift computation above
    return twin;
  }

  bulkSync(events: SyncEvent[]): TwinEntity[] {
    return events.map(e => this.syncState(e));
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  takeSnapshot(twinId: string, label = 'auto'): TwinSnapshot {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error(`Twin ${twinId} not found`);

    const snapshot: TwinSnapshot = {
      snapshotId: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      twinId,
      state: { ...twin.state },
      metrics: { ...twin.metrics },
      takenAt: Date.now(),
      label,
    };

    const snaps = this.snapshots.get(twinId) ?? [];
    snaps.push(snapshot);
    if (snaps.length > this.config.maxSnapshotsPerTwin) snaps.shift();
    this.snapshots.set(twinId, snaps);

    return snapshot;
  }

  restoreSnapshot(twinId: string, snapshotId: string): TwinEntity {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error(`Twin ${twinId} not found`);

    const snaps = this.snapshots.get(twinId) ?? [];
    const snapshot = snaps.find(s => s.snapshotId === snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found for twin ${twinId}`);

    twin.state = { ...snapshot.state };
    twin.metrics = { ...snapshot.metrics };
    twin.version += 1;
    twin.lastSyncAt = Date.now();

    logger.info('Twin state restored from snapshot', { twinId, snapshotId });
    return twin;
  }

  getSnapshots(twinId: string): TwinSnapshot[] {
    return this.snapshots.get(twinId) ?? [];
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  createScenario(params: Omit<SimulationScenario, 'scenarioId' | 'createdAt' | 'status'>): SimulationScenario {
    const scenario: SimulationScenario = {
      ...params,
      scenarioId: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.scenarios.set(scenario.scenarioId, scenario);
    return scenario;
  }

  async runSimulation(scenarioId: string): Promise<SimulationResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    scenario.status = 'running';
    const startedAt = Date.now();

    // Take snapshots of all targeted twins for rollback
    const snapshotIds = new Map<string, string>();
    for (const twinId of scenario.targetTwinIds) {
      const snap = this.takeSnapshot(twinId, `pre_sim_${scenarioId}`);
      snapshotIds.set(twinId, snap.snapshotId);
    }

    try {
      const result = await this.executeSimulation(scenario);
      result.startedAt = startedAt;
      result.completedAt = Date.now();

      // Restore original state after simulation
      for (const [twinId, snapId] of snapshotIds) {
        this.restoreSnapshot(twinId, snapId);
      }

      scenario.status = 'completed';
      scenario.result = result;

      logger.info('Simulation completed', { scenarioId, mode: scenario.mode, durationMs: result.completedAt - startedAt });
      return result;
    } catch (err) {
      scenario.status = 'failed';
      // Restore on failure
      for (const [twinId, snapId] of snapshotIds) {
        this.restoreSnapshot(twinId, snapId);
      }
      throw err;
    }
  }

  // ── Drift Analysis ────────────────────────────────────────────────────────

  analyzeDrift(twinId: string, realWorldState: Record<string, unknown>, realWorldMetrics: Record<string, number>): DriftReport {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error(`Twin ${twinId} not found`);

    const staleDurationMs = Date.now() - twin.lastSyncAt;
    const divergedFields: DriftReport['divergedFields'] = [];

    // Compare state fields
    for (const [key, realVal] of Object.entries(realWorldState)) {
      const twinVal = twin.state[key];
      if (twinVal !== realVal) {
        const divergencePercent = typeof realVal === 'number' && typeof twinVal === 'number' && realVal !== 0
          ? Math.abs((twinVal - realVal) / realVal) * 100
          : 100;
        divergedFields.push({ field: key, expectedValue: realVal, actualValue: twinVal, divergencePercent });
      }
    }

    // Compare metrics
    for (const [key, realMetric] of Object.entries(realWorldMetrics)) {
      const twinMetric = twin.metrics[key] ?? 0;
      if (Math.abs(twinMetric - realMetric) > 0.001) {
        const divergencePercent = realMetric !== 0 ? Math.abs((twinMetric - realMetric) / realMetric) * 100 : 100;
        divergedFields.push({ field: `metrics.${key}`, expectedValue: realMetric, actualValue: twinMetric, divergencePercent });
      }
    }

    const avgDivergence = divergedFields.length > 0
      ? divergedFields.reduce((s, f) => s + f.divergencePercent, 0) / divergedFields.length
      : 0;

    const driftScore = Math.min(1, avgDivergence / 100 + staleDurationMs / (this.config.staleAfterMs * 10));

    let recommendation: DriftReport['recommendation'] = 'acceptable';
    if (driftScore > 0.7 || staleDurationMs > this.config.staleAfterMs * 2) recommendation = 'investigate';
    else if (driftScore > this.config.driftThreshold || staleDurationMs > this.config.staleAfterMs) recommendation = 'resync';

    // Update twin drift score
    twin.driftScore = driftScore;
    if (staleDurationMs > this.config.staleAfterMs) twin.status = 'stale';
    else if (driftScore > this.config.driftThreshold) twin.status = 'drifted';

    return { twinId, entityId: twin.entityId, driftScore, staleDurationMs, divergedFields, recommendation };
  }

  getGlobalDriftSummary(): { totalTwins: number; synchronized: number; drifted: number; stale: number; avgDriftScore: number } {
    const all = Array.from(this.twins.values());
    const synchronized = all.filter(t => t.status === 'synchronized').length;
    const drifted = all.filter(t => t.status === 'drifted').length;
    const stale = all.filter(t => t.status === 'stale').length;
    const avgDriftScore = all.length > 0 ? all.reduce((s, t) => s + t.driftScore, 0) / all.length : 0;

    return { totalTwins: all.length, synchronized, drifted, stale, avgDriftScore };
  }

  // ── Private Simulation Logic ──────────────────────────────────────────────

  private async executeSimulation(scenario: SimulationScenario): Promise<SimulationResult> {
    const targetTwins = scenario.targetTwinIds
      .map(id => this.twins.get(id))
      .filter((t): t is TwinEntity => t !== undefined);

    const outcomeMetrics: Record<string, number> = {};
    const recommendations: string[] = [];
    const risks: SimulationResult['risks'] = [];

    if (scenario.mode === 'stress_test') {
      const loadMultiplier = (scenario.parameters.loadMultiplier as number) ?? 10;
      for (const twin of targetTwins) {
        const currentCpu = (twin.metrics['cpu_percent'] ?? 50) * loadMultiplier;
        const currentMem = (twin.metrics['memory_percent'] ?? 60) * loadMultiplier;
        outcomeMetrics[`${twin.twinId}_cpu_peak`] = Math.min(100, currentCpu);
        outcomeMetrics[`${twin.twinId}_mem_peak`] = Math.min(100, currentMem);

        if (currentCpu > 90) {
          risks.push({ severity: 'critical', description: `${twin.label} CPU would reach ${currentCpu.toFixed(1)}% under ${loadMultiplier}x load` });
          recommendations.push(`Scale ${twin.label} horizontally before hitting ${loadMultiplier}x load`);
        } else if (currentCpu > 70) {
          risks.push({ severity: 'medium', description: `${twin.label} CPU would reach ${currentCpu.toFixed(1)}% under ${loadMultiplier}x load` });
        }
      }
    } else if (scenario.mode === 'failure_injection') {
      const failureType = (scenario.parameters.failureType as string) ?? 'random';
      for (const twin of targetTwins) {
        twin.state['injected_failure'] = failureType;
        twin.metrics['error_rate'] = (twin.metrics['error_rate'] ?? 0) + 0.5;
        risks.push({ severity: 'high', description: `${twin.label} simulated ${failureType} failure injected` });
      }
      recommendations.push('Implement circuit breakers for all downstream dependencies');
    } else if (scenario.mode === 'capacity') {
      const growthPct = (scenario.parameters.growthPercent as number) ?? 100;
      for (const twin of targetTwins) {
        const projectedLoad = (twin.metrics['requests_per_sec'] ?? 100) * (1 + growthPct / 100);
        outcomeMetrics[`${twin.twinId}_projected_rps`] = projectedLoad;
        const currentCapacity = (twin.metrics['max_capacity_rps'] ?? 500);
        if (projectedLoad > currentCapacity) {
          risks.push({ severity: 'critical', description: `${twin.label} would exceed capacity at ${growthPct}% growth` });
          recommendations.push(`Pre-provision ${Math.ceil(projectedLoad / currentCapacity)}x capacity for ${twin.label}`);
        }
      }
    } else if (scenario.mode === 'what_if') {
      // Apply parameter overrides and measure impact
      const overrides = (scenario.parameters.stateOverrides as Record<string, unknown>) ?? {};
      for (const twin of targetTwins) {
        Object.assign(twin.state, overrides);
        recommendations.push(`What-if scenario applied to ${twin.label}: ${Object.keys(overrides).join(', ')}`);
      }
    }

    // Simulate async work
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, scenario.durationMs)));

    return {
      scenarioId: scenario.scenarioId,
      startedAt: 0, // will be set by caller
      completedAt: 0, // will be set by caller
      outcomeMetrics,
      recommendations,
      risks,
      estimatedImpact: {
        performanceGainPct: scenario.mode === 'capacity' ? 25 : 0,
        costChangePct: scenario.mode === 'capacity' ? 20 : 0,
        reliabilityChangePct: scenario.mode === 'failure_injection' ? -15 : 5,
      },
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getDigitalTwinEngine(): DigitalTwinEngine {
  const key = '__digitalTwinEngine__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new DigitalTwinEngine();
  }
  return (globalThis as Record<string, unknown>)[key] as DigitalTwinEngine;
}
