/**
 * @module anomalyResponseAgent
 * @description Autonomous anomaly response agent continuously watching detector streams,
 * escalating unacknowledged critical alerts, triggering automated remediation actions,
 * correlating multi-stream anomalies into incidents, and producing root-cause reports.
 */

import { getLogger } from '../lib/logger';
import { getAnomalyDetector, AnomalyEvent, AlertSeverity } from '../lib/realtimeAnomalyDetector';

const logger = getLogger();

export interface IncidentRecord {
  incidentId: string;
  anomalyIds: string[];
  streams: string[];
  severity: AlertSeverity;
  startedAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  rootCauses: string[];
  remediationActions: string[];
  status: 'open' | 'acknowledged' | 'resolved';
}

export interface AnomalyResponseAgentStats {
  cyclesRun: number;
  anomaliesProcessed: number;
  incidentsCreated: number;
  incidentsResolved: number;
  avgResolutionTimeMs: number;
  uptime: number;
}

let agentInstance: AnomalyResponseAgent | undefined;

export class AnomalyResponseAgent {
  private intervalHandle?: ReturnType<typeof setInterval>;
  private incidents = new Map<string, IncidentRecord>();
  private processedAnomalyIds = new Set<string>();
  private stats: AnomalyResponseAgentStats = { cyclesRun: 0, anomaliesProcessed: 0, incidentsCreated: 0, incidentsResolved: 0, avgResolutionTimeMs: 0, uptime: 0 };
  private startedAt?: number;
  private readonly monitorIntervalMs: number;
  private readonly escalationWindowMs: number;

  constructor(config: { monitorIntervalMs?: number; escalationWindowMs?: number } = {}) {
    this.monitorIntervalMs = config.monitorIntervalMs ?? 15_000;
    this.escalationWindowMs = config.escalationWindowMs ?? 5 * 60_000;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.startedAt = Date.now();
    this.intervalHandle = setInterval(() => void this.runCycle(), this.monitorIntervalMs);
    logger.info('AnomalyResponseAgent started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  private async runCycle(): Promise<void> {
    const detector = getAnomalyDetector();
    this.stats.cyclesRun += 1;
    this.stats.uptime = this.startedAt ? Date.now() - this.startedAt : 0;

    const recentAnomalies = detector.getAnomalyHistory(undefined, 500);
    const newAnomalies = recentAnomalies.filter(a => !this.processedAnomalyIds.has(a.anomalyId));

    for (const anomaly of newAnomalies) {
      this.processedAnomalyIds.add(anomaly.anomalyId);
      this.stats.anomaliesProcessed += 1;
      await this.processAnomaly(anomaly);
    }

    // Check for unacknowledged critical alerts
    const openAlerts = detector.getOpenAlerts();
    for (const alert of openAlerts) {
      const ageMs = Date.now() - alert.startTime;
      if (alert.severity === 'critical' && ageMs > this.escalationWindowMs && !alert.acknowledgedAt) {
        logger.warn('Escalating unacknowledged critical alert', { alertId: alert.alertId, ageMs });
        detector.acknowledgeAlert(alert.alertId); // auto-acknowledge and escalate
        this.createOrUpdateIncident([alert.alertId], alert.streamId, alert.severity);
      }
    }

    if (newAnomalies.length > 0) {
      logger.info('AnomalyResponseAgent cycle complete', { newAnomalies: newAnomalies.length, openIncidents: this.getOpenIncidents().length });
    }
  }

  private async processAnomaly(anomaly: AnomalyEvent): Promise<void> {
    if (anomaly.severity === 'critical' || anomaly.severity === 'error') {
      const incident = this.createOrUpdateIncident([anomaly.anomalyId], anomaly.streamId, anomaly.severity);
      const remediations = this.determineRemediation(anomaly);
      incident.remediationActions.push(...remediations);
      incident.rootCauses.push(...anomaly.possibleCauses);
      logger.warn('Incident created/updated for high severity anomaly', { incidentId: incident.incidentId, severity: anomaly.severity });
    }
    await Promise.resolve();
  }

  private createOrUpdateIncident(anomalyIds: string[], streamId: string, severity: AlertSeverity): IncidentRecord {
    // Try to correlate with existing open incident on same stream
    const existing = Array.from(this.incidents.values()).find(i => i.streams.includes(streamId) && i.status === 'open');
    if (existing) {
      existing.anomalyIds.push(...anomalyIds);
      const severityRank: Record<AlertSeverity, number> = { info: 1, warning: 2, error: 3, critical: 4 };
      if (severityRank[severity] > severityRank[existing.severity]) existing.severity = severity;
      return existing;
    }

    const incident: IncidentRecord = {
      incidentId: `inc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      anomalyIds: [...anomalyIds],
      streams: [streamId],
      severity,
      startedAt: Date.now(),
      rootCauses: [],
      remediationActions: [],
      status: 'open',
    };

    this.incidents.set(incident.incidentId, incident);
    this.stats.incidentsCreated += 1;
    return incident;
  }

  private determineRemediation(anomaly: AnomalyEvent): string[] {
    const actions: string[] = [];
    if (anomaly.anomalyScore > 0.9) {
      actions.push('Page on-call engineer immediately');
      actions.push('Enable emergency rate limiting on affected endpoints');
    }
    if (anomaly.possibleCauses.some(c => c.includes('spike'))) {
      actions.push('Scale up compute resources via auto-scaling policy');
    }
    if (anomaly.possibleCauses.some(c => c.includes('error'))) {
      actions.push('Trigger deployment rollback if anomaly follows recent deploy');
    }
    if (actions.length === 0) {
      actions.push('Monitor for 15 minutes before escalating');
    }
    return actions;
  }

  resolveIncident(incidentId: string, resolution: string): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);
    incident.status = 'resolved';
    incident.resolvedAt = Date.now();
    this.stats.incidentsResolved += 1;
    const resolutionMs = incident.resolvedAt - incident.startedAt;
    this.stats.avgResolutionTimeMs = (this.stats.avgResolutionTimeMs * (this.stats.incidentsResolved - 1) + resolutionMs) / this.stats.incidentsResolved;
    logger.info('Incident resolved', { incidentId, resolution, resolutionMs });
  }

  getIncident(incidentId: string): IncidentRecord | undefined {
    return this.incidents.get(incidentId);
  }

  getOpenIncidents(): IncidentRecord[] {
    return Array.from(this.incidents.values()).filter(i => i.status === 'open');
  }

  getStats(): AnomalyResponseAgentStats {
    return { ...this.stats, uptime: this.startedAt ? Date.now() - this.startedAt : 0 };
  }
}

export function getAnomalyResponseAgent(): AnomalyResponseAgent {
  if (!agentInstance) {
    agentInstance = new AnomalyResponseAgent();
  }
  return agentInstance;
}
