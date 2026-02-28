/**
 * @module digitalTwinAgent
 * @description Autonomous digital twin synchronization agent that continuously
 * ingests telemetry from production assets, computes drift scores, triggers
 * resynchronization for stale twins, runs scheduled simulations, and generates
 * predictive failure reports by combining twin state with maintenance predictions.
 */

import { getLogger } from '../lib/logger';
import { getDigitalTwinEngine, SyncEvent } from '../lib/digitalTwinEngine';
import { getPredictiveMaintenanceEngine } from '../lib/predictiveMaintenanceEngine';

const logger = getLogger();

export interface TwinSyncReport {
  syncedTwins: number;
  staleTwins: number;
  driftedTwins: number;
  simulationsRun: number;
  predictiveAlerts: Array<{ twinId: string; entityId: string; failureProbability7d: number; urgency: string }>;
  generatedAt: number;
}

export interface DigitalTwinAgentStats {
  cyclesRun: number;
  totalSyncs: number;
  totalSimulations: number;
  predictiveAlertsRaised: number;
  uptime: number;
}

let agentInstance: DigitalTwinAgent | undefined;

export class DigitalTwinAgent {
  private intervalHandle?: ReturnType<typeof setInterval>;
  private stats: DigitalTwinAgentStats = { cyclesRun: 0, totalSyncs: 0, totalSimulations: 0, predictiveAlertsRaised: 0, uptime: 0 };
  private startedAt?: number;
  private lastReports: TwinSyncReport[] = [];
  private readonly syncIntervalMs: number;
  private readonly failureProbabilityAlertThreshold: number;

  constructor(config: { syncIntervalMs?: number; failureProbabilityAlertThreshold?: number } = {}) {
    this.syncIntervalMs = config.syncIntervalMs ?? 30_000;
    this.failureProbabilityAlertThreshold = config.failureProbabilityAlertThreshold ?? 0.4;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.startedAt = Date.now();
    this.intervalHandle = setInterval(() => void this.runCycle(), this.syncIntervalMs);
    void this.runCycle();
    logger.info('DigitalTwinAgent started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  ingestTelemetry(twinId: string, telemetry: Record<string, unknown>): void {
    const engine = getDigitalTwinEngine();
    const event: SyncEvent = {
      twinId,
      entityId: engine.getTwin(twinId)?.entityId ?? twinId,
      stateChanges: {},
      metricsChanges: {},
      timestamp: Date.now(),
      source: 'agent',
    };

    // Separate state and metrics
    for (const [key, val] of Object.entries(telemetry)) {
      if (typeof val === 'number') {
        event.metricsChanges[key] = val;
      } else {
        event.stateChanges[key] = val;
      }
    }

    engine.syncState(event);
    this.stats.totalSyncs += 1;
  }

  private async runCycle(): Promise<void> {
    const engine = getDigitalTwinEngine();
    const maintenance = getPredictiveMaintenanceEngine();
    this.stats.cyclesRun += 1;
    this.stats.uptime = this.startedAt ? Date.now() - this.startedAt : 0;

    const twins = engine.listTwins();
    const predictiveAlerts: TwinSyncReport['predictiveAlerts'] = [];
    let simulationsRun = 0;

    const driftSummary = engine.getGlobalDriftSummary();

    for (const twin of twins) {
      // Auto-resync stale twins using stored metrics as reference
      if (twin.status === 'stale') {
        const syncEvent: SyncEvent = {
          twinId: twin.twinId,
          entityId: twin.entityId,
          stateChanges: { _resync: true },
          metricsChanges: {},
          timestamp: Date.now(),
          source: 'agent_resync',
        };
        engine.syncState(syncEvent);
        this.stats.totalSyncs += 1;
      }

      // Check if maintenance engine has matching asset
      const asset = maintenance.getAsset(twin.entityId);
      if (asset) {
        try {
          const prediction = maintenance.predictFailure(twin.entityId);
          if (prediction.probability7d >= this.failureProbabilityAlertThreshold) {
            predictiveAlerts.push({
              twinId: twin.twinId,
              entityId: twin.entityId,
              failureProbability7d: prediction.probability7d,
              urgency: prediction.urgency,
            });
            this.stats.predictiveAlertsRaised += 1;
          }
        } catch {
          // Asset may not have enough telemetry yet
        }
      }
    }

    // Run scheduled capacity simulation on drifted twins
    if (driftSummary.drifted > 0) {
      const driftedTwins = engine.listTwins(undefined, 'drifted').slice(0, 3);
      for (const twin of driftedTwins) {
        const scenario = engine.createScenario({
          name: `auto_capacity_check_${twin.twinId}`,
          mode: 'capacity',
          targetTwinIds: [twin.twinId],
          parameters: { growthPercent: 50 },
          durationMs: 100,
        });
        try {
          await engine.runSimulation(scenario.scenarioId);
          simulationsRun += 1;
          this.stats.totalSimulations += 1;
        } catch (err) {
          logger.error('DigitalTwinAgent simulation error', err instanceof Error ? err : new Error(String(err)), { twinId: twin.twinId });
        }
      }
    }

    const report: TwinSyncReport = {
      syncedTwins: driftSummary.synchronized,
      staleTwins: driftSummary.stale,
      driftedTwins: driftSummary.drifted,
      simulationsRun,
      predictiveAlerts,
      generatedAt: Date.now(),
    };

    this.lastReports.push(report);
    if (this.lastReports.length > 100) this.lastReports.shift();

    if (predictiveAlerts.length > 0) {
      logger.warn('DigitalTwinAgent predictive alerts', { alertCount: predictiveAlerts.length, alerts: predictiveAlerts });
    }

    logger.info('DigitalTwinAgent cycle complete', { syncedTwins: report.syncedTwins, staleTwins: report.staleTwins });
  }

  getLatestReport(): TwinSyncReport | undefined {
    return this.lastReports[this.lastReports.length - 1];
  }

  getRecentReports(limit = 10): TwinSyncReport[] {
    return this.lastReports.slice(-limit);
  }

  getStats(): DigitalTwinAgentStats {
    return { ...this.stats, uptime: this.startedAt ? Date.now() - this.startedAt : 0 };
  }
}

export function getDigitalTwinAgent(): DigitalTwinAgent {
  if (!agentInstance) {
    agentInstance = new DigitalTwinAgent();
  }
  return agentInstance;
}
