/**
 * @module autonomousRevenueOptimizer
 * @description ML-based revenue optimization engine with pricing signals, uplift modeling,
 * A/B test revenue tracking, elasticity scoring, cohort revenue attribution,
 * subscription revenue prediction, expansion/contraction detection, and LTV optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RevenueStream {
  id: string;
  name: string;
  type: 'subscription' | 'one_time' | 'usage' | 'expansion';
  tenantId: string;
  monthlyRecurring: number;
  annualRecurring: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface RevenueEvent {
  streamId: string;
  tenantId: string;
  userId: string;
  amount: number;
  currency: string;
  timestamp: number;
  eventType: 'charge' | 'refund' | 'upgrade' | 'downgrade' | 'churn' | 'reactivation';
  metadata: Record<string, unknown>;
}

export interface UpliftModel {
  id: string;
  name: string;
  controlRevenue: number;
  treatmentRevenue: number;
  upliftPercent: number;
  sampleSize: number;
  confidence: number;
  pValue: number;
  createdAt: number;
}

export interface ElasticityScore {
  streamId: string;
  priceElasticity: number;
  demandElasticity: number;
  optimalPriceMultiplier: number;
  revenueAtOptimal: number;
  computedAt: number;
}

export interface CohortRevenue {
  cohortId: string;
  cohortMonth: string;
  tenantId: string;
  initialRevenue: number;
  currentRevenue: number;
  retentionRate: number;
  expansionRevenue: number;
  churnedRevenue: number;
  netRevenueRetention: number;
}

export interface LTVPrediction {
  tenantId: string;
  predictedLTV: number;
  confidenceInterval: [number, number];
  monthsToPayback: number;
  expansionProbability: number;
  churnProbability: number;
  computedAt: number;
}

export interface ExpansionOpportunity {
  tenantId: string;
  currentMRR: number;
  potentialMRR: number;
  upliftAmount: number;
  triggerSignals: string[];
  recommendedAction: string;
  score: number;
}

export interface ContractionAlert {
  tenantId: string;
  streamId: string;
  previousMRR: number;
  currentMRR: number;
  contractionPercent: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: number;
}

export interface RevenueOptimizationSummary {
  totalStreams: number;
  totalMRR: number;
  totalARR: number;
  averageElasticity: number;
  expansionOpportunities: number;
  contractionAlerts: number;
  topLTVTenants: string[];
  upliftModels: number;
  avgNetRevenueRetention: number;
  revenueGrowthRate: number;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class AutonomousRevenueOptimizer {
  private streams: Map<string, RevenueStream> = new Map();
  private events: RevenueEvent[] = [];
  private upliftModels: Map<string, UpliftModel> = new Map();
  private elasticityScores: Map<string, ElasticityScore> = new Map();
  private cohortRevenue: Map<string, CohortRevenue> = new Map();
  private ltvCache: Map<string, LTVPrediction> = new Map();
  private contractionAlerts: ContractionAlert[] = [];
  private readonly CONTRACTION_THRESHOLD = 0.05;
  private readonly HIGH_RISK_THRESHOLD = 0.20;
  private readonly CRITICAL_RISK_THRESHOLD = 0.40;
  private readonly LTV_WINDOW_MONTHS = 24;

  constructor() {
    logger.info('[AutonomousRevenueOptimizer] Initialized revenue optimization engine');
  }

  /**
   * Register a new revenue stream for tracking and optimization.
   */
  addRevenueStream(stream: RevenueStream): void {
    if (this.streams.has(stream.id)) {
      logger.warn(`[AutonomousRevenueOptimizer] Stream ${stream.id} already exists; updating`);
    }
    stream.updatedAt = Date.now();
    this.streams.set(stream.id, stream);
    logger.info(`[AutonomousRevenueOptimizer] Added stream ${stream.id} (${stream.type}) MRR=$${stream.monthlyRecurring}`);
  }

  /**
   * Record a revenue event and trigger contraction detection if needed.
   */
  recordRevenueEvent(event: RevenueEvent): void {
    this.events.push({ ...event, timestamp: event.timestamp || Date.now() });

    const stream = this.streams.get(event.streamId);
    if (!stream) {
      logger.warn(`[AutonomousRevenueOptimizer] Event for unknown stream ${event.streamId}`);
      return;
    }

    if (event.eventType === 'downgrade') {
      const previousMRR = stream.monthlyRecurring;
      const newMRR = Math.max(0, previousMRR - event.amount);
      const contractionPct = previousMRR > 0 ? (previousMRR - newMRR) / previousMRR : 0;
      if (contractionPct > this.CONTRACTION_THRESHOLD) {
        this.analyzeContraction(stream, previousMRR, newMRR, contractionPct);
      }
      stream.monthlyRecurring = newMRR;
      stream.annualRecurring = newMRR * 12;
      stream.updatedAt = Date.now();
    } else if (event.eventType === 'upgrade') {
      stream.monthlyRecurring += event.amount;
      stream.annualRecurring = stream.monthlyRecurring * 12;
      stream.updatedAt = Date.now();
    } else if (event.eventType === 'churn') {
      stream.monthlyRecurring = 0;
      stream.annualRecurring = 0;
      stream.updatedAt = Date.now();
    }

    logger.debug(`[AutonomousRevenueOptimizer] Recorded ${event.eventType} event for stream ${event.streamId}`);
  }

  /**
   * Compute price elasticity for a given revenue stream using historical events.
   */
  computeElasticity(streamId: string): ElasticityScore {
    const stream = this.streams.get(streamId);
    if (!stream) {
      logger.error(`[AutonomousRevenueOptimizer] Cannot compute elasticity: unknown stream ${streamId}`);
      throw new Error(`Unknown stream: ${streamId}`);
    }

    const streamEvents = this.events.filter(e => e.streamId === streamId);
    const upgrades = streamEvents.filter(e => e.eventType === 'upgrade');
    const downgrades = streamEvents.filter(e => e.eventType === 'downgrade');
    const totalEvents = streamEvents.length;

    // Price elasticity = % change in quantity / % change in price (simplified)
    const upgradePressure = totalEvents > 0 ? upgrades.length / totalEvents : 0;
    const downgradePressure = totalEvents > 0 ? downgrades.length / totalEvents : 0;

    const netElasticity = upgradePressure - downgradePressure;
    // Demand elasticity: negative means elastic (price sensitive)
    const demandElasticity = -(1 + downgradePressure * 2 - upgradePressure);

    // Optimal price multiplier via simple revenue maximization heuristic
    // R(p) = p * D(p), maximize by finding where MR = 0
    const optimalMultiplier = demandElasticity < -1
      ? 1 / (1 + 1 / demandElasticity) // monopoly pricing formula
      : 1.0;

    const score: ElasticityScore = {
      streamId,
      priceElasticity: parseFloat(netElasticity.toFixed(4)),
      demandElasticity: parseFloat(demandElasticity.toFixed(4)),
      optimalPriceMultiplier: parseFloat(Math.max(0.5, Math.min(3.0, optimalMultiplier)).toFixed(4)),
      revenueAtOptimal: parseFloat((stream.monthlyRecurring * Math.max(0.5, Math.min(3.0, optimalMultiplier))).toFixed(2)),
      computedAt: Date.now(),
    };

    this.elasticityScores.set(streamId, score);
    logger.info(`[AutonomousRevenueOptimizer] Elasticity for ${streamId}: ${score.priceElasticity}`);
    return score;
  }

  /**
   * Predict customer lifetime value using historical revenue signals and decay model.
   */
  predictLTV(tenantId: string): LTVPrediction {
    const tenantStreams = Array.from(this.streams.values()).filter(s => s.tenantId === tenantId);
    const tenantEvents = this.events.filter(e => e.tenantId === tenantId);

    const totalMRR = tenantStreams.reduce((sum, s) => sum + s.monthlyRecurring, 0);
    const churns = tenantEvents.filter(e => e.eventType === 'churn').length;
    const upgrades = tenantEvents.filter(e => e.eventType === 'upgrade').length;
    const months = Math.max(1, tenantStreams.length > 0
      ? (Date.now() - Math.min(...tenantStreams.map(s => s.createdAt))) / (1000 * 60 * 60 * 24 * 30)
      : 1);

    const churnRate = Math.min(0.99, churns / (months * Math.max(1, tenantStreams.length)));
    const expansionRate = upgrades / Math.max(1, months);

    // LTV = MRR / churn_rate (if churn > 0), adjusted for expansion
    const baseChurnRate = Math.max(0.01, churnRate);
    const baseLTV = totalMRR / baseChurnRate;
    const expansionAdjustedLTV = baseLTV * (1 + expansionRate * 0.5);

    const confidenceFactor = Math.min(1, months / 6);
    const margin = expansionAdjustedLTV * (1 - confidenceFactor) * 0.3;

    const prediction: LTVPrediction = {
      tenantId,
      predictedLTV: parseFloat(expansionAdjustedLTV.toFixed(2)),
      confidenceInterval: [
        parseFloat((expansionAdjustedLTV - margin).toFixed(2)),
        parseFloat((expansionAdjustedLTV + margin).toFixed(2)),
      ],
      monthsToPayback: totalMRR > 0 ? parseFloat((expansionAdjustedLTV / totalMRR).toFixed(1)) : 999,
      expansionProbability: parseFloat(Math.min(1, expansionRate).toFixed(4)),
      churnProbability: parseFloat(Math.min(1, baseChurnRate).toFixed(4)),
      computedAt: Date.now(),
    };

    this.ltvCache.set(tenantId, prediction);
    logger.info(`[AutonomousRevenueOptimizer] LTV for tenant ${tenantId}: $${prediction.predictedLTV}`);
    return prediction;
  }

  /**
   * Detect expansion revenue opportunities based on usage patterns and LTV signals.
   */
  detectExpansionOpportunities(): ExpansionOpportunity[] {
    const opportunities: ExpansionOpportunity[] = [];
    const tenantIds = new Set(Array.from(this.streams.values()).map(s => s.tenantId));

    for (const tenantId of tenantIds) {
      const tenantStreams = Array.from(this.streams.values()).filter(s => s.tenantId === tenantId);
      const currentMRR = tenantStreams.reduce((sum, s) => sum + s.monthlyRecurring, 0);
      const tenantEvents = this.events.filter(e => e.tenantId === tenantId);
      const recentUpgrades = tenantEvents.filter(
        e => e.eventType === 'upgrade' && e.timestamp > Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).length;
      const usageSignals = tenantEvents.filter(e => e.eventType === 'charge').length;

      const signals: string[] = [];
      let score = 0;

      if (recentUpgrades > 0) { signals.push('recent_upgrades'); score += 30; }
      if (usageSignals > 10) { signals.push('high_usage'); score += 25; }
      if (currentMRR > 500) { signals.push('high_mrr_base'); score += 20; }

      const ltv = this.ltvCache.get(tenantId);
      if (ltv && ltv.expansionProbability > 0.3) {
        signals.push('high_expansion_probability');
        score += 25;
      }

      if (score > 40) {
        const potentialMRR = currentMRR * (1 + score / 200);
        opportunities.push({
          tenantId,
          currentMRR: parseFloat(currentMRR.toFixed(2)),
          potentialMRR: parseFloat(potentialMRR.toFixed(2)),
          upliftAmount: parseFloat((potentialMRR - currentMRR).toFixed(2)),
          triggerSignals: signals,
          recommendedAction: score > 70 ? 'schedule_expansion_call' : 'send_upgrade_prompt',
          score,
        });
      }
    }

    opportunities.sort((a, b) => b.score - a.score);
    logger.info(`[AutonomousRevenueOptimizer] Found ${opportunities.length} expansion opportunities`);
    return opportunities;
  }

  /**
   * Generate uplift recommendations from A/B test revenue data.
   */
  generateUpliftRecommendations(
    modelId: string,
    name: string,
    controlRevenue: number,
    treatmentRevenue: number,
    sampleSize: number,
  ): UpliftModel {
    const upliftPercent = controlRevenue > 0
      ? ((treatmentRevenue - controlRevenue) / controlRevenue) * 100
      : 0;

    // Simple z-test for proportion significance
    const pooledP = (controlRevenue + treatmentRevenue) / (2 * sampleSize * Math.max(1, controlRevenue + treatmentRevenue));
    const se = Math.sqrt(2 * pooledP * (1 - pooledP) / sampleSize);
    const zScore = se > 0 ? Math.abs((treatmentRevenue - controlRevenue) / (se * sampleSize)) : 0;
    // Approximate p-value from z-score
    const pValue = parseFloat(Math.max(0.001, 2 * (1 - this.normalCDF(zScore))).toFixed(4));
    const confidence = parseFloat(Math.min(99.9, (1 - pValue) * 100).toFixed(2));

    const model: UpliftModel = {
      id: modelId,
      name,
      controlRevenue,
      treatmentRevenue,
      upliftPercent: parseFloat(upliftPercent.toFixed(4)),
      sampleSize,
      confidence,
      pValue,
      createdAt: Date.now(),
    };

    this.upliftModels.set(modelId, model);
    logger.info(`[AutonomousRevenueOptimizer] Uplift model ${modelId}: ${upliftPercent.toFixed(2)}% (p=${pValue})`);
    return model;
  }

  /**
   * Analyze cohort revenue retention and net revenue retention metrics.
   */
  analyzeCohortRevenue(cohortId: string, tenantId: string, cohortMonth: string): CohortRevenue {
    const cohortKey = `${cohortId}:${tenantId}`;
    const existing = this.cohortRevenue.get(cohortKey);

    const tenantEvents = this.events.filter(e => e.tenantId === tenantId);
    const charges = tenantEvents.filter(e => e.eventType === 'charge');
    const upgrades = tenantEvents.filter(e => e.eventType === 'upgrade');
    const churns = tenantEvents.filter(e => e.eventType === 'churn');
    const downgrades = tenantEvents.filter(e => e.eventType === 'downgrade');

    const initialRevenue = existing?.initialRevenue
      ?? charges.slice(0, 3).reduce((sum, e) => sum + e.amount, 0);
    const expansionRevenue = upgrades.reduce((sum, e) => sum + e.amount, 0);
    const churnedRevenue = churns.reduce((sum, e) => sum + e.amount, 0);
    const contractionRevenue = downgrades.reduce((sum, e) => sum + e.amount, 0);
    const currentRevenue = Math.max(0, initialRevenue + expansionRevenue - churnedRevenue - contractionRevenue);
    const retentionRate = initialRevenue > 0 ? currentRevenue / initialRevenue : 1;
    const netRevenueRetention = initialRevenue > 0
      ? (currentRevenue + expansionRevenue) / initialRevenue
      : 1;

    const cohort: CohortRevenue = {
      cohortId,
      cohortMonth,
      tenantId,
      initialRevenue: parseFloat(initialRevenue.toFixed(2)),
      currentRevenue: parseFloat(currentRevenue.toFixed(2)),
      retentionRate: parseFloat(retentionRate.toFixed(4)),
      expansionRevenue: parseFloat(expansionRevenue.toFixed(2)),
      churnedRevenue: parseFloat(churnedRevenue.toFixed(2)),
      netRevenueRetention: parseFloat(netRevenueRetention.toFixed(4)),
    };

    this.cohortRevenue.set(cohortKey, cohort);
    logger.debug(`[AutonomousRevenueOptimizer] Cohort ${cohortId} NRR=${netRevenueRetention.toFixed(2)}`);
    return cohort;
  }

  /**
   * Detect and record a contraction alert for a revenue stream.
   */
  private analyzeContraction(
    stream: RevenueStream,
    previousMRR: number,
    currentMRR: number,
    contractionPct: number,
  ): void {
    let riskLevel: ContractionAlert['riskLevel'] = 'low';
    if (contractionPct >= this.CRITICAL_RISK_THRESHOLD) riskLevel = 'critical';
    else if (contractionPct >= this.HIGH_RISK_THRESHOLD) riskLevel = 'high';
    else if (contractionPct >= 0.10) riskLevel = 'medium';

    const alert: ContractionAlert = {
      tenantId: stream.tenantId,
      streamId: stream.id,
      previousMRR: parseFloat(previousMRR.toFixed(2)),
      currentMRR: parseFloat(currentMRR.toFixed(2)),
      contractionPercent: parseFloat((contractionPct * 100).toFixed(2)),
      riskLevel,
      detectedAt: Date.now(),
    };

    this.contractionAlerts.push(alert);
    if (riskLevel === 'critical' || riskLevel === 'high') {
      logger.warn(`[AutonomousRevenueOptimizer] ${riskLevel.toUpperCase()} contraction on ${stream.id}: -${alert.contractionPercent}%`);
    } else {
      logger.debug(`[AutonomousRevenueOptimizer] Contraction alert on ${stream.id}: -${alert.contractionPercent}%`);
    }
  }

  /**
   * Get recent contraction alerts, optionally filtered by risk level.
   */
  getContractionAlerts(riskLevel?: ContractionAlert['riskLevel']): ContractionAlert[] {
    if (riskLevel) {
      return this.contractionAlerts.filter(a => a.riskLevel === riskLevel);
    }
    return [...this.contractionAlerts];
  }

  /**
   * Compute total MRR across all active revenue streams.
   */
  private computeTotalMRR(): number {
    let total = 0;
    for (const stream of this.streams.values()) {
      total += stream.monthlyRecurring;
    }
    return total;
  }

  /**
   * Approximate normal cumulative distribution function for p-value calculation.
   */
  private normalCDF(z: number): number {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Compute MRR growth rate comparing current to 30-day-ago snapshot.
   */
  private computeGrowthRate(): number {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentEvents = this.events.filter(e => e.timestamp > thirtyDaysAgo);
    const oldMRR = this.computeTotalMRR();
    const netChange = recentEvents.reduce((sum, e) => {
      if (e.eventType === 'upgrade') return sum + e.amount;
      if (e.eventType === 'downgrade' || e.eventType === 'churn') return sum - e.amount;
      return sum;
    }, 0);
    const previousMRR = Math.max(1, oldMRR - netChange);
    return parseFloat(((netChange / previousMRR) * 100).toFixed(2));
  }

  /**
   * Return a high-level summary of revenue optimization state.
   */
  getSummary(): RevenueOptimizationSummary {
    const totalMRR = this.computeTotalMRR();
    const elasticities = Array.from(this.elasticityScores.values());
    const avgElasticity = elasticities.length > 0
      ? elasticities.reduce((s, e) => s + e.priceElasticity, 0) / elasticities.length
      : 0;
    const cohorts = Array.from(this.cohortRevenue.values());
    const avgNRR = cohorts.length > 0
      ? cohorts.reduce((s, c) => s + c.netRevenueRetention, 0) / cohorts.length
      : 1;

    const ltvEntries = Array.from(this.ltvCache.entries())
      .sort((a, b) => b[1].predictedLTV - a[1].predictedLTV)
      .slice(0, 5)
      .map(([tid]) => tid);

    const summary: RevenueOptimizationSummary = {
      totalStreams: this.streams.size,
      totalMRR: parseFloat(totalMRR.toFixed(2)),
      totalARR: parseFloat((totalMRR * 12).toFixed(2)),
      averageElasticity: parseFloat(avgElasticity.toFixed(4)),
      expansionOpportunities: this.detectExpansionOpportunities().length,
      contractionAlerts: this.contractionAlerts.length,
      topLTVTenants: ltvEntries,
      upliftModels: this.upliftModels.size,
      avgNetRevenueRetention: parseFloat(avgNRR.toFixed(4)),
      revenueGrowthRate: this.computeGrowthRate(),
    };

    logger.info(`[AutonomousRevenueOptimizer] Summary: MRR=$${summary.totalMRR}, ARR=$${summary.totalARR}`);
    return summary;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__autonomousRevenueOptimizer__';
export function getAutonomousRevenueOptimizer(): AutonomousRevenueOptimizer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AutonomousRevenueOptimizer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AutonomousRevenueOptimizer;
}
