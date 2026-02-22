/**
 * Revenue Forecasting Engine
 *
 * ML-based revenue forecasting with:
 * - Time-series forecasting (exponential smoothing + linear trend)
 * - MRR/ARR projection with confidence intervals
 * - Cohort-based churn impact modeling
 * - Expansion revenue tracking (upsells/upgrades)
 * - Scenario planning: bull / base / bear
 * - Seasonal adjustment via monthly multipliers
 * - 12-month rolling forecast
 * - New customer acquisition modeling
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import { SubscriptionTier } from '../types/saas';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RevenueDataPoint {
  date: Date;
  mrr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netNewMrr: number;
  activeSubscribers: number;
  newSubscribers: number;
  churnedSubscribers: number;
}

export interface CohortData {
  cohortMonth: string; // 'YYYY-MM'
  initialSubscribers: number;
  initialMrr: number;
  monthlyRetention: number[];  // retention rate by month offset
  monthlyMrr: number[];        // MRR by month offset
}

export interface ForecastPoint {
  date: Date;
  mrr: number;
  arr: number;
  lowerBound: number;
  upperBound: number;
  confidenceLevel: number;
  newMrr: number;
  churnMrr: number;
  expansionMrr: number;
  netNewMrr: number;
  activeSubscribers: number;
}

export interface ScenarioForecast {
  scenario: 'bull' | 'base' | 'bear';
  growthRate: number;
  churnRate: number;
  expansionRate: number;
  points: ForecastPoint[];
  endMrr: number;
  endArr: number;
  totalRevenue: number;
  cagr: number;
}

export interface ForecastResult {
  generatedAt: Date;
  periodMonths: number;
  historicalDataPoints: number;
  bull: ScenarioForecast;
  base: ScenarioForecast;
  bear: ScenarioForecast;
  currentMrr: number;
  currentArr: number;
  currentSubscribers: number;
  avgGrowthRate: number;
  avgChurnRate: number;
  seasonalFactors: number[];  // 12 monthly multipliers
}

export interface ChurnModel {
  overallChurnRate: number;             // monthly %
  churnByTier: Record<SubscriptionTier, number>;
  churnByAge: { ageMonths: number; rate: number }[];
  predictedChurnRevenue: number;        // next 3 months
  retentionCurve: number[];             // month 1-24 survival probability
}

export interface ExpansionModel {
  expansionRate: number;                // monthly expansion as % of MRR
  upgradeRate: number;
  seatExpansionRate: number;
  tierTransitions: Record<string, number>; // 'free→pro', 'pro→enterprise'
  avgExpansionRevenue: number;
}

export interface SeasonalPattern {
  monthlyMultipliers: number[];   // index 0 = January
  peakMonth: number;
  troughMonth: number;
  seasonalAmplitude: number;
}

export interface ForecastConfig {
  periodMonths: number;            // default 12
  confidenceLevel: number;         // 0.80, 0.90, 0.95
  smoothingAlpha: number;          // exponential smoothing 0–1
  includeSeasonality: boolean;
  bullGrowthPremium: number;       // % above base
  bearGrowthDiscount: number;      // % below base
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function computeLinearTrend(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: yMean - slope * xMean };
}

function exponentialSmooth(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function confidenceInterval(
  value: number,
  stdFraction: number,
  zScore: number,
): { lower: number; upper: number } {
  const margin = value * stdFraction * zScore;
  return { lower: Math.max(0, value - margin), upper: value + margin };
}

const Z_SCORES: Record<number, number> = { 0.8: 1.28, 0.9: 1.645, 0.95: 1.96, 0.99: 2.576 };

// ── RevenueForecastingEngine ───────────────────────────────────────────────────

class RevenueForecastingEngine {
  private history: RevenueDataPoint[] = [];
  private cohorts: Map<string, CohortData> = new Map();
  private churnModel: ChurnModel = {
    overallChurnRate: 0.03,
    churnByTier: { free: 0.08, pro: 0.025, enterprise: 0.01 },
    churnByAge: [
      { ageMonths: 1, rate: 0.08 },
      { ageMonths: 3, rate: 0.05 },
      { ageMonths: 6, rate: 0.03 },
      { ageMonths: 12, rate: 0.02 },
      { ageMonths: 24, rate: 0.015 },
    ],
    predictedChurnRevenue: 0,
    retentionCurve: Array.from({ length: 24 }, (_, i) => Math.pow(0.95, i)),
  };
  private expansionModel: ExpansionModel = {
    expansionRate: 0.015,
    upgradeRate: 0.02,
    seatExpansionRate: 0.01,
    tierTransitions: { 'free→pro': 0.04, 'pro→enterprise': 0.02 },
    avgExpansionRevenue: 50,
  };
  private seasonal: SeasonalPattern = {
    monthlyMultipliers: [0.92, 0.90, 0.98, 1.02, 1.05, 1.08, 1.06, 1.04, 1.07, 1.10, 1.05, 0.94],
    peakMonth: 9,   // October (0-indexed)
    troughMonth: 1, // February
    seasonalAmplitude: 0.18,
  };
  private config: ForecastConfig = {
    periodMonths: 12,
    confidenceLevel: 0.90,
    smoothingAlpha: 0.3,
    includeSeasonality: true,
    bullGrowthPremium: 0.5,
    bearGrowthDiscount: 0.5,
  };

  // ── Data Ingestion ──────────────────────────────────────────────────────────

  addDataPoint(point: RevenueDataPoint): void {
    this.history.push(point);
    this.history.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Keep 36 months max
    if (this.history.length > 36) this.history.shift();
    cache.set('rfx:history:dirty', true, 1);
    logger.debug('Revenue data point added', { date: point.date.toISOString(), mrr: point.mrr });
  }

  addCohort(data: CohortData): void {
    this.cohorts.set(data.cohortMonth, data);
  }

  updateChurnModel(model: Partial<ChurnModel>): void {
    this.churnModel = { ...this.churnModel, ...model };
  }

  updateExpansionModel(model: Partial<ExpansionModel>): void {
    this.expansionModel = { ...this.expansionModel, ...model };
  }

  updateSeasonalPattern(pattern: Partial<SeasonalPattern>): void {
    this.seasonal = { ...this.seasonal, ...pattern };
  }

  setConfig(cfg: Partial<ForecastConfig>): void {
    this.config = { ...this.config, ...cfg };
  }

  // ── Core Forecast ───────────────────────────────────────────────────────────

  generateForecast(): ForecastResult {
    const cacheKey = 'rfx:forecast:latest';
    const cached = cache.get<ForecastResult>(cacheKey);
    const isDirty = cache.get<boolean>('rfx:history:dirty');
    if (cached && !isDirty) return cached;

    const mrrHistory = this.history.map((p) => p.mrr);
    if (mrrHistory.length === 0) {
      throw new Error('No historical data available for forecasting');
    }

    const smoothed = exponentialSmooth(mrrHistory, this.config.smoothingAlpha);
    const trend = computeLinearTrend(smoothed);

    // Compute avg monthly growth rate
    const growthRates: number[] = [];
    for (let i = 1; i < smoothed.length; i++) {
      if (smoothed[i - 1] > 0) {
        growthRates.push((smoothed[i] - smoothed[i - 1]) / smoothed[i - 1]);
      }
    }
    const avgGrowthRate = growthRates.length > 0
      ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length
      : 0.05;

    const currentMrr = smoothed[smoothed.length - 1];
    const currentSubscribers = this.history[this.history.length - 1]?.activeSubscribers ?? 0;
    const lastDate = this.history[this.history.length - 1]?.date ?? new Date();

    // Seasonal factors
    const seasonalFactors = this.config.includeSeasonality
      ? this.seasonal.monthlyMultipliers
      : new Array(12).fill(1);

    const base = this.buildScenario('base', currentMrr, currentSubscribers, avgGrowthRate, lastDate, seasonalFactors, trend);
    const bullMult = 1 + this.config.bullGrowthPremium;
    const bearMult = 1 - this.config.bearGrowthDiscount;
    const bull = this.buildScenario('bull', currentMrr, currentSubscribers, avgGrowthRate * bullMult, lastDate, seasonalFactors, trend);
    const bear = this.buildScenario('bear', currentMrr, currentSubscribers, Math.max(avgGrowthRate * bearMult, -0.1), lastDate, seasonalFactors, trend);

    const result: ForecastResult = {
      generatedAt: new Date(),
      periodMonths: this.config.periodMonths,
      historicalDataPoints: this.history.length,
      bull,
      base,
      bear,
      currentMrr,
      currentArr: currentMrr * 12,
      currentSubscribers,
      avgGrowthRate,
      avgChurnRate: this.churnModel.overallChurnRate,
      seasonalFactors,
    };

    cache.set(cacheKey, result, 300);
    cache.set('rfx:history:dirty', false, 600);
    logger.info('Revenue forecast generated', {
      currentMrr,
      avgGrowthRate: (avgGrowthRate * 100).toFixed(2) + '%',
      baseEndMrr: base.endMrr,
    });
    return result;
  }

  private buildScenario(
    scenario: 'bull' | 'base' | 'bear',
    startMrr: number,
    startSubscribers: number,
    growthRate: number,
    lastDate: Date,
    seasonalFactors: number[],
    trend: { slope: number; intercept: number },
  ): ScenarioForecast {
    const points: ForecastPoint[] = [];
    let mrr = startMrr;
    let subscribers = startSubscribers;
    let totalRevenue = 0;
    const zScore = Z_SCORES[this.config.confidenceLevel] ?? 1.645;
    // Uncertainty grows with horizon
    const baseStdFraction = 0.05;

    for (let m = 1; m <= this.config.periodMonths; m++) {
      const forecastDate = addMonths(lastDate, m);
      const monthIndex = forecastDate.getMonth(); // 0–11
      const seasonalMult = seasonalFactors[monthIndex] ?? 1;

      // Raw trend-adjusted MRR
      const trendMrr = mrr * (1 + growthRate) * seasonalMult;

      // Churn
      const churnMrr = mrr * this.churnModel.overallChurnRate;

      // Expansion
      const expansionMrr = mrr * this.expansionModel.expansionRate;

      // New business (proportional to growth above churn)
      const netGrowth = trendMrr - mrr;
      const newMrr = Math.max(0, netGrowth + churnMrr);

      mrr = Math.max(0, trendMrr);
      const arr = mrr * 12;

      // Subscriber count
      const churnedSubs = Math.round(subscribers * this.churnModel.overallChurnRate);
      const newSubs = mrr > 0 ? Math.round(newMrr / (mrr / Math.max(1, subscribers))) : 0;
      subscribers = Math.max(0, subscribers - churnedSubs + newSubs);

      // Confidence intervals widen with time
      const stdFraction = baseStdFraction + m * 0.01;
      const ci = confidenceInterval(mrr, stdFraction, zScore);

      points.push({
        date: forecastDate,
        mrr,
        arr,
        lowerBound: ci.lower,
        upperBound: ci.upper,
        confidenceLevel: this.config.confidenceLevel,
        newMrr,
        churnMrr,
        expansionMrr,
        netNewMrr: newMrr + expansionMrr - churnMrr,
        activeSubscribers: subscribers,
      });
      totalRevenue += mrr;
    }

    const endMrr = points[points.length - 1]?.mrr ?? startMrr;
    const cagr = startMrr > 0 ? Math.pow(endMrr / startMrr, 12 / this.config.periodMonths) - 1 : 0;

    return {
      scenario,
      growthRate,
      churnRate: this.churnModel.overallChurnRate,
      expansionRate: this.expansionModel.expansionRate,
      points,
      endMrr,
      endArr: endMrr * 12,
      totalRevenue,
      cagr,
    };
  }

  // ── Cohort Analysis ─────────────────────────────────────────────────────────

  getCohortRetentionTable(): Record<string, number[]> {
    const table: Record<string, number[]> = {};
    for (const [month, cohort] of this.cohorts) {
      table[month] = cohort.monthlyRetention;
    }
    return table;
  }

  getChurnImpact(months: number): { totalChurnRevenue: number; subscribersLost: number } {
    const currentMrr = this.history[this.history.length - 1]?.mrr ?? 0;
    const currentSubs = this.history[this.history.length - 1]?.activeSubscribers ?? 0;
    const monthlyChurn = this.churnModel.overallChurnRate;
    let mrr = currentMrr;
    let subs = currentSubs;
    let totalChurn = 0;
    let totalSubsLost = 0;
    for (let i = 0; i < months; i++) {
      const churnMrr = mrr * monthlyChurn;
      const churnSubs = Math.round(subs * monthlyChurn);
      totalChurn += churnMrr;
      totalSubsLost += churnSubs;
      mrr -= churnMrr;
      subs -= churnSubs;
    }
    return { totalChurnRevenue: totalChurn, subscribersLost: totalSubsLost };
  }

  // ── Scenario Summary ────────────────────────────────────────────────────────

  getScenarioComparison(): {
    scenario: string;
    endMrr: number;
    endArr: number;
    growthRate: string;
    cagr: string;
  }[] {
    const forecast = this.generateForecast();
    return [forecast.bull, forecast.base, forecast.bear].map((s) => ({
      scenario: s.scenario,
      endMrr: Math.round(s.endMrr),
      endArr: Math.round(s.endArr),
      growthRate: (s.growthRate * 100).toFixed(2) + '%',
      cagr: (s.cagr * 100).toFixed(2) + '%',
    }));
  }

  getHistoricalData(): RevenueDataPoint[] {
    return [...this.history];
  }

  getChurnModel(): ChurnModel {
    return { ...this.churnModel };
  }

  getExpansionModel(): ExpansionModel {
    return { ...this.expansionModel };
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__revenueForecastingEngine__';

export function getRevenueForecastingEngine(): RevenueForecastingEngine {
  const g = globalThis as unknown as Record<string, RevenueForecastingEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new RevenueForecastingEngine();
  }
  return g[GLOBAL_KEY];
}

export { RevenueForecastingEngine };
export default getRevenueForecastingEngine;
