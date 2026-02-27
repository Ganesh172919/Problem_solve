/**
 * @module fraudDetectionAgent
 * @description Autonomous fraud detection agent that continuously monitors platform
 * activity, trains behavioral models, coordinates with the fraud detector,
 * generates risk reports, and automatically enforces protective actions.
 */

import { getLogger } from '../lib/logger';
import { getFraudDetector, FraudEvent, FraudAssessment } from '../lib/realtimeFraudDetector';

const logger = getLogger();

export interface FraudDetectionConfig {
  monitoringIntervalMs: number;
  alertThreshold: number;        // Risk score above which to alert
  autoBlockThreshold: number;    // Risk score above which to auto-block
  profileUpdateIntervalMs: number;
  maxEventsPerCycle: number;
}

export interface FraudAlert {
  alertId: string;
  assessment: FraudAssessment;
  action: 'logged' | 'challenged' | 'blocked' | 'escalated';
  escalatedTo?: string;
  timestamp: number;
}

export interface FraudReport {
  reportId: string;
  period: { from: number; to: number };
  totalEvents: number;
  blockedEvents: number;
  challengedEvents: number;
  topRiskyUsers: Array<{ userId: string; avgScore: number; eventCount: number }>;
  topSignalTypes: Array<{ type: string; count: number }>;
  blockRate: number;
  estimatedLossPrevented: number;
  generatedAt: number;
}

export class FraudDetectionAgent {
  private config: FraudDetectionConfig;
  private detector = getFraudDetector();
  private eventQueue: FraudEvent[] = [];
  private alerts: FraudAlert[] = [];
  private processedCount = 0;
  private monitoringHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config?: Partial<FraudDetectionConfig>) {
    this.config = {
      monitoringIntervalMs: 5000,
      alertThreshold: 50,
      autoBlockThreshold: 80,
      profileUpdateIntervalMs: 60_000,
      maxEventsPerCycle: 100,
      ...config,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.monitoringHandle = setInterval(() => this.processCycle(), this.config.monitoringIntervalMs);
    logger.info('FraudDetectionAgent started', { config: this.config });
  }

  stop(): void {
    this.running = false;
    if (this.monitoringHandle) {
      clearInterval(this.monitoringHandle);
      this.monitoringHandle = null;
    }
    logger.info('FraudDetectionAgent stopped');
  }

  submitEvent(event: FraudEvent): void {
    this.eventQueue.push(event);
    if (this.eventQueue.length > 10000) {
      this.eventQueue.splice(0, this.eventQueue.length - 10000);
    }
  }

  async assessImmediate(event: FraudEvent): Promise<FraudAlert> {
    const assessment = await this.detector.assess(event);
    return this.handleAssessment(assessment);
  }

  private async processCycle(): Promise<void> {
    const batch = this.eventQueue.splice(0, this.config.maxEventsPerCycle);
    if (batch.length === 0) return;

    for (const event of batch) {
      try {
        const assessment = await this.detector.assess(event);
        this.handleAssessment(assessment);
        this.processedCount++;
      } catch (err) {
        logger.error('Error assessing fraud event', err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (batch.length > 0) {
      logger.debug('Fraud cycle completed', { processed: batch.length, totalProcessed: this.processedCount });
    }
  }

  private handleAssessment(assessment: FraudAssessment): FraudAlert {
    let action: FraudAlert['action'] = 'logged';
    let escalatedTo: string | undefined;

    if (assessment.riskScore >= this.config.autoBlockThreshold) {
      action = 'blocked';
      this.detector.addToBlocklist(assessment.userId);
    } else if (assessment.riskScore >= this.config.alertThreshold) {
      action = 'challenged';
      if (assessment.riskLevel === 'critical') {
        action = 'escalated';
        escalatedTo = 'security_team';
      }
    }

    const alert: FraudAlert = {
      alertId: `falert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      assessment,
      action,
      escalatedTo,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);
    if (this.alerts.length > 5000) this.alerts.splice(0, this.alerts.length - 5000);

    if (action !== 'logged') {
      logger.warn('Fraud action taken', {
        userId: assessment.userId,
        action,
        riskScore: assessment.riskScore,
        riskLevel: assessment.riskLevel,
      });
    }

    return alert;
  }

  generateReport(fromMs: number, toMs: number): FraudReport {
    const relevantAlerts = this.alerts.filter(a => a.timestamp >= fromMs && a.timestamp <= toMs);

    const blockedEvents = relevantAlerts.filter(a => a.action === 'blocked').length;
    const challengedEvents = relevantAlerts.filter(a => a.action === 'challenged').length;

    // Top risky users
    const userScores = new Map<string, { total: number; count: number }>();
    for (const alert of relevantAlerts) {
      const existing = userScores.get(alert.assessment.userId) ?? { total: 0, count: 0 };
      existing.total += alert.assessment.riskScore;
      existing.count++;
      userScores.set(alert.assessment.userId, existing);
    }
    const topRiskyUsers = Array.from(userScores.entries())
      .map(([userId, s]) => ({ userId, avgScore: s.total / s.count, eventCount: s.count }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 10);

    // Top signal types
    const signalCounts = new Map<string, number>();
    for (const alert of relevantAlerts) {
      for (const signal of alert.assessment.signals) {
        signalCounts.set(signal.type, (signalCounts.get(signal.type) ?? 0) + 1);
      }
    }
    const topSignalTypes = Array.from(signalCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Estimated loss prevented (rough heuristic: $50 avg fraud value per blocked event)
    const estimatedLossPrevented = blockedEvents * 50;

    return {
      reportId: `freport_${Date.now()}`,
      period: { from: fromMs, to: toMs },
      totalEvents: relevantAlerts.length,
      blockedEvents,
      challengedEvents,
      topRiskyUsers,
      topSignalTypes,
      blockRate: relevantAlerts.length > 0 ? blockedEvents / relevantAlerts.length : 0,
      estimatedLossPrevented,
      generatedAt: Date.now(),
    };
  }

  getAlerts(limit = 100): FraudAlert[] {
    return this.alerts.slice(-limit);
  }

  getStats(): { processedCount: number; alertCount: number; queueDepth: number } & ReturnType<typeof getFraudDetector['prototype']['getStats']> {
    return {
      processedCount: this.processedCount,
      alertCount: this.alerts.length,
      queueDepth: this.eventQueue.length,
      ...this.detector.getStats(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __fraudDetectionAgent__: FraudDetectionAgent | undefined;
}

export function getFraudDetectionAgent(): FraudDetectionAgent {
  if (!globalThis.__fraudDetectionAgent__) {
    globalThis.__fraudDetectionAgent__ = new FraudDetectionAgent();
  }
  return globalThis.__fraudDetectionAgent__;
}
