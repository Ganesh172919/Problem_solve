/**
 * @module churnPreventionAgent
 * @description Autonomous agent that scans for high-risk churn users, triggers targeted
 * intervention campaigns, evaluates campaign conversion effectiveness, and surfaces
 * personalized retention offers using the PredictiveChurnPreventor engine.
 */

import { getPredictiveChurnPreventor, RetentionOffer, InterventionCampaign } from '../lib/predictiveChurnPreventor';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class ChurnPreventionAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly scanIntervalMs: number;
  /** tenantId -> tracked user IDs */
  private readonly tenantUsers = new Map<string, string[]>();
  /** campaignId -> tenantId */
  private readonly campaignTenantMap = new Map<string, string>();

  constructor(scanIntervalMs = 30 * 60 * 1000) {
    this.scanIntervalMs = scanIntervalMs;
  }

  start(): void {
    if (this.interval) return;
    logger.info('ChurnPreventionAgent starting');
    this.interval = setInterval(() => this._runScan(), this.scanIntervalMs);
    this._runScan();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('ChurnPreventionAgent stopped');
    }
  }

  private _runScan(): void {
    try {
      const preventor = getPredictiveChurnPreventor();
      const summary = preventor.getSummary();
      const report = {
        highRiskUserCount: summary.criticalRiskCount + summary.highRiskCount,
        criticalRiskCount: summary.criticalRiskCount,
        highRiskCount: summary.highRiskCount,
        activeCampaigns: summary.activeCampaigns,
        interventionTriggerRate: summary.avgConversionRate,
        totalProfiles: summary.totalProfiles,
        avgChurnRisk: summary.avgChurnRisk,
        totalInterventions: summary.totalInterventions,
      };
      logger.debug('ChurnPreventionAgent scan complete', report);
    } catch (err) {
      logger.error('ChurnPreventionAgent scan error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Register users under a tenant so the agent can evaluate their churn risk over time.
   */
  registerTenantUsers(tenantId: string, userIds: string[]): void {
    const existing = this.tenantUsers.get(tenantId) ?? [];
    this.tenantUsers.set(tenantId, [...new Set([...existing, ...userIds])]);
  }

  /**
   * Register an intervention campaign with the engine and track it for per-tenant evaluation.
   */
  registerCampaign(campaign: InterventionCampaign, tenantId: string): void {
    const preventor = getPredictiveChurnPreventor();
    preventor.registerCampaign(campaign);
    this.campaignTenantMap.set(campaign.id, tenantId);
    logger.info('ChurnPreventionAgent registered campaign', { campaignId: campaign.id, tenantId });
  }

  /**
   * Compute risk scores for all tenant users, collect those with riskScore > 0.7,
   * and trigger the first matching intervention campaign for each.
   */
  scanHighRiskUsers(tenantId: string): { highRiskUsers: string[]; interventionsTriggered: number } {
    const preventor = getPredictiveChurnPreventor();
    const userIds = this.tenantUsers.get(tenantId) ?? [];
    const tenantCampaigns = [...this.campaignTenantMap.entries()]
      .filter(([, tid]) => tid === tenantId)
      .map(([cid]) => cid);

    const highRiskUsers: string[] = [];
    let interventionsTriggered = 0;

    for (const userId of userIds) {
      const riskScore = preventor.computeRiskScore(userId, tenantId);
      if (riskScore.score > 0.7) {
        highRiskUsers.push(userId);
        for (const campaignId of tenantCampaigns) {
          if (preventor.triggerIntervention(userId, campaignId)) {
            interventionsTriggered++;
            break;
          }
        }
      }
    }

    logger.info('ChurnPreventionAgent high-risk scan', {
      tenantId,
      scanned: userIds.length,
      highRisk: highRiskUsers.length,
      interventionsTriggered,
    });
    return { highRiskUsers, interventionsTriggered };
  }

  /**
   * Evaluate the effectiveness of all active campaigns for a tenant using summary metrics.
   */
  evaluateCampaigns(tenantId: string): { campaignCount: number; avgConversionRate: number; totalInterventions: number; tenantChurnRate: number } {
    const preventor = getPredictiveChurnPreventor();
    const summary = preventor.getSummary();
    const tenantChurnRate = summary.churnRateByTenant[tenantId] ?? 0;
    const result = {
      campaignCount: summary.activeCampaigns,
      avgConversionRate: summary.avgConversionRate,
      totalInterventions: summary.totalInterventions,
      tenantChurnRate,
    };
    logger.info('ChurnPreventionAgent campaign evaluation', { tenantId, ...result });
    return result;
  }

  /**
   * Compute risk scores for at-risk tenant users (score > 0.5) and surface the best
   * retention offer for each via suggestRetentionOffer.
   */
  suggestOffers(tenantId: string): Array<{ userId: string; offer: RetentionOffer | null }> {
    const preventor = getPredictiveChurnPreventor();
    const userIds = this.tenantUsers.get(tenantId) ?? [];
    const recommendations: Array<{ userId: string; offer: RetentionOffer | null }> = [];

    for (const userId of userIds) {
      const riskScore = preventor.computeRiskScore(userId, tenantId);
      if (riskScore.score > 0.5) {
        const offer = preventor.suggestRetentionOffer(userId);
        recommendations.push({ userId, offer });
      }
    }

    logger.info('ChurnPreventionAgent offer suggestions', {
      tenantId,
      evaluated: userIds.length,
      atRisk: recommendations.length,
      withOffers: recommendations.filter(r => r.offer !== null).length,
    });
    return recommendations;
  }
}

const KEY = '__churnPreventionAgent__';
export function getChurnPreventionAgent(): ChurnPreventionAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new ChurnPreventionAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as ChurnPreventionAgent;
}
