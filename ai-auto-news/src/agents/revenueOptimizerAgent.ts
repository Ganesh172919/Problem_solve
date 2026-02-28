/**
 * @module revenueOptimizerAgent
 * @description Autonomous agent that periodically scans revenue streams, computes price
 * elasticity, detects per-tenant expansion opportunities, and forecasts customer lifetime
 * value using the AutonomousRevenueOptimizer engine.
 */

import { getAutonomousRevenueOptimizer, ElasticityScore, LTVPrediction, ExpansionOpportunity } from '../lib/autonomousRevenueOptimizer';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class RevenueOptimizerAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly scanIntervalMs: number;

  constructor(scanIntervalMs = 10 * 60 * 1000) {
    this.scanIntervalMs = scanIntervalMs;
  }

  start(): void {
    if (this.interval) return;
    logger.info('RevenueOptimizerAgent starting');
    this.interval = setInterval(() => this._runScan(), this.scanIntervalMs);
    this._runScan();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('RevenueOptimizerAgent stopped');
    }
  }

  private _runScan(): void {
    try {
      const optimizer = getAutonomousRevenueOptimizer();
      const summary = optimizer.getSummary();
      const report = {
        totalRevenueStreams: summary.totalStreams,
        totalMRR: summary.totalMRR,
        totalARR: summary.totalARR,
        expansionOpportunities: summary.expansionOpportunities,
        averageElasticity: summary.averageElasticity,
        avgNetRevenueRetention: summary.avgNetRevenueRetention,
        revenueGrowthRate: summary.revenueGrowthRate,
        contractionAlerts: summary.contractionAlerts,
        topLTVTenants: summary.topLTVTenants.length,
      };
      logger.debug('RevenueOptimizerAgent scan complete', report);
    } catch (err) {
      logger.error('RevenueOptimizerAgent scan error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Compute price elasticity for a specific revenue stream and log the optimal pricing signal.
   */
  analyzeElasticity(streamId: string): ElasticityScore {
    const optimizer = getAutonomousRevenueOptimizer();
    const score = optimizer.computeElasticity(streamId);
    logger.info('RevenueOptimizerAgent elasticity analysis', {
      streamId,
      priceElasticity: score.priceElasticity,
      demandElasticity: score.demandElasticity,
      optimalPriceMultiplier: score.optimalPriceMultiplier,
      revenueAtOptimal: score.revenueAtOptimal,
    });
    return score;
  }

  /**
   * Detect expansion revenue opportunities for a tenant and log count and total uplift.
   */
  detectExpansion(tenantId: string): { count: number; opportunities: ExpansionOpportunity[] } {
    const optimizer = getAutonomousRevenueOptimizer();
    const all = optimizer.detectExpansionOpportunities();
    const tenantOpportunities = all.filter(o => o.tenantId === tenantId);
    const totalUplift = tenantOpportunities.reduce((s, o) => s + o.upliftAmount, 0);
    logger.info('RevenueOptimizerAgent expansion detection', {
      tenantId,
      count: tenantOpportunities.length,
      totalPotentialUplift: totalUplift,
      topAction: tenantOpportunities[0]?.recommendedAction ?? 'none',
    });
    return { count: tenantOpportunities.length, opportunities: tenantOpportunities };
  }

  /**
   * Predict LTV for a tenant over the given horizon in days and log the forecast metrics.
   */
  forecastRevenue(tenantId: string, days: number): LTVPrediction {
    const optimizer = getAutonomousRevenueOptimizer();
    const prediction = optimizer.predictLTV(tenantId);
    const horizonMonths = Math.max(1, Math.ceil(days / 30));
    const forecastedValue = parseFloat((prediction.predictedLTV * (horizonMonths / 12)).toFixed(2));
    logger.info('RevenueOptimizerAgent revenue forecast', {
      tenantId,
      days,
      horizonMonths,
      predictedLTV: prediction.predictedLTV,
      forecastedValue,
      confidenceInterval: prediction.confidenceInterval,
      churnProbability: prediction.churnProbability,
      expansionProbability: prediction.expansionProbability,
      monthsToPayback: prediction.monthsToPayback,
    });
    return prediction;
  }

  /**
   * Surface contraction alerts at a given risk level and log a summary.
   */
  reviewContractionAlerts(riskLevel: 'low' | 'medium' | 'high' | 'critical'): number {
    const optimizer = getAutonomousRevenueOptimizer();
    const alerts = optimizer.getContractionAlerts(riskLevel);
    logger.warn('RevenueOptimizerAgent contraction review', {
      riskLevel,
      alertCount: alerts.length,
      affectedStreams: alerts.map(a => a.streamId),
    });
    return alerts.length;
  }
}

const KEY = '__revenueOptimizerAgent__';
export function getRevenueOptimizerAgent(): RevenueOptimizerAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new RevenueOptimizerAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as RevenueOptimizerAgent;
}
