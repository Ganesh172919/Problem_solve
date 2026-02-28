import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface UserPrediction {
  userId: string;
  churnProbability: number;       // 0–1
  ltv: number;                    // expected lifetime value in dollars
  conversionProbability: number;  // 0–1
  engagementScore: number;        // 0–100
  riskTier: 'low' | 'medium' | 'high' | 'critical';
  predictedAtDate: Date;
  features: Record<string, number>;
}

export interface ContentScore {
  contentId: string;
  viralityScore: number;   // 0–100
  qualityScore: number;    // 0–100
  relevanceScore: number;  // 0–100
  engagementPrediction: number; // predicted click-through rate 0–1
  audienceMatch: number;   // 0–1
  scoredAt: Date;
}

export interface FunnelAnalysis {
  funnelId: string;
  stages: FunnelStage[];
  overallConversionRate: number;
  bottleneckStage: string;
  analysedAt: Date;
}

export interface FunnelStage {
  name: string;
  users: number;
  conversionRate: number;   // rate from previous stage
  dropOffRate: number;
  avgTimeInStageSeconds: number;
}

export interface CohortRetention {
  cohortId: string;
  cohortDate: Date;
  initialSize: number;
  retentionByPeriod: number[]; // index 0 = period 1 retention (e.g. day 1, week 1)
  periodLabel: 'daily' | 'weekly' | 'monthly';
  churnCurve: number[];
}

export interface AnomalyAlert {
  id: string;
  metric: string;
  value: number;
  expectedValue: number;
  zScore: number;
  iqrScore: number;
  severity: 'info' | 'warning' | 'critical';
  detectedAt: Date;
  context: Record<string, unknown>;
}

export interface TimeSeriesForecast {
  metric: string;
  values: number[];
  timestamps: Date[];
  forecast: Array<{ date: Date; value: number; lower: number; upper: number }>;
  alpha: number; // smoothing factor
  beta:  number; // trend factor
  gamma: number; // seasonal factor
  mape: number;  // Mean Absolute Percentage Error
  method: string;
}

interface MetricSeries {
  timestamps: Date[];
  values: number[];
}

interface UserEvent {
  userId: string;
  eventType: string;
  timestamp: Date;
  properties?: Record<string, unknown>;
}

interface ContentFeatures {
  wordCount: number;
  hasImage: boolean;
  hasVideo: boolean;
  sentimentScore: number;  // -1 to 1
  readabilityScore: number;// 0–100
  topicRelevance: number;  // 0–1
  authorReputation: number;// 0–1
  publishHour: number;     // 0–23
}

// ─── Engine ──────────────────────────────────────────────────────────────────

class PredictiveAnalyticsEngine {
  private metricSeries   = new Map<string, MetricSeries>();
  private userEvents     = new Map<string, UserEvent[]>();
  private funnelDefs     = new Map<string, string[]>(); // funnelId -> ordered stage event names
  private cohorts        = new Map<string, { date: Date; userIds: string[] }>();

  // ── Ingest helpers ─────────────────────────────────────────────────────────

  recordMetricPoint(metric: string, value: number, timestamp = new Date()): void {
    const series = this.metricSeries.get(metric) ?? { timestamps: [], values: [] };
    series.timestamps.push(timestamp);
    series.values.push(value);
    // Cap at 2000 points
    if (series.values.length > 2000) {
      series.timestamps.splice(0, series.values.length - 2000);
      series.values.splice(0, series.values.length - 2000);
    }
    this.metricSeries.set(metric, series);
  }

  recordUserEvent(event: UserEvent): void {
    const events = this.userEvents.get(event.userId) ?? [];
    events.push(event);
    if (events.length > 500) events.splice(0, events.length - 500);
    this.userEvents.set(event.userId, events);
  }

  registerFunnel(funnelId: string, stages: string[]): void {
    this.funnelDefs.set(funnelId, stages);
  }

  registerCohort(cohortId: string, date: Date, userIds: string[]): void {
    this.cohorts.set(cohortId, { date, userIds });
  }

  // ── Churn prediction ───────────────────────────────────────────────────────

  predictChurn(userId: string): UserPrediction {
    const cacheKey = `churn_${userId}`;
    const cached = cache.get<UserPrediction>(cacheKey);
    if (cached) return cached;

    const events = this.userEvents.get(userId) ?? [];
    const now    = Date.now();
    const day    = 86400000;

    // Feature engineering
    const last7Events   = events.filter(e => now - e.timestamp.getTime() < 7  * day);
    const last30Events  = events.filter(e => now - e.timestamp.getTime() < 30 * day);
    const daysSinceLastEvent = events.length > 0
      ? (now - Math.max(...events.map(e => e.timestamp.getTime()))) / day
      : 999;

    const sessionCount7d  = last7Events.filter(e => e.eventType === 'session_start').length;
    const pageViews30d    = last30Events.filter(e => e.eventType === 'page_view').length;
    const purchaseEvents  = events.filter(e => e.eventType === 'purchase');
    const hasPurchased    = purchaseEvents.length > 0;

    const features: Record<string, number> = {
      daysSinceLastEvent,
      sessionCount7d,
      pageViews30d,
      totalEvents:      events.length,
      hasPurchased:     hasPurchased ? 1 : 0,
      purchaseCount:    purchaseEvents.length,
    };

    // Logistic regression approximation (weights tuned heuristically)
    const logit =
      -2.5
      + 0.08  * daysSinceLastEvent
      - 0.4   * sessionCount7d
      - 0.02  * pageViews30d
      - 0.01  * events.length
      - 1.2   * (hasPurchased ? 1 : 0)
      - 0.3   * purchaseEvents.length;

    const churnProbability = 1 / (1 + Math.exp(-logit));
    const engagementScore  = Math.max(0, Math.min(100,
      100 - daysSinceLastEvent * 3 + sessionCount7d * 5 + pageViews30d * 0.5
    ));

    // LTV model: average order value * predicted future purchases
    const avgOrderValue = purchaseEvents.length > 0
      ? purchaseEvents.reduce((sum, e) => sum + (Number((e.properties as any)?.amount) || 20), 0) / purchaseEvents.length
      : 20;
    const predictedMonths = Math.max(0, 12 * (1 - churnProbability));
    const monthlyPurchaseRate = purchaseEvents.length / Math.max(1, events.length / 30);
    const ltv = avgOrderValue * monthlyPurchaseRate * predictedMonths;

    const conversionProbability = hasPurchased
      ? Math.min(0.9, 0.5 + sessionCount7d * 0.05)
      : Math.min(0.5, sessionCount7d * 0.05);

    const riskTier: UserPrediction['riskTier'] =
      churnProbability >= 0.8 ? 'critical' :
      churnProbability >= 0.6 ? 'high' :
      churnProbability >= 0.4 ? 'medium' : 'low';

    const prediction: UserPrediction = {
      userId, churnProbability, ltv, conversionProbability,
      engagementScore, riskTier, features, predictedAtDate: new Date(),
    };

    cache.set(cacheKey, prediction, 1800);
    logger.info('Churn prediction computed', { userId, churnProbability: churnProbability.toFixed(3), riskTier });
    return prediction;
  }

  // ── LTV prediction ─────────────────────────────────────────────────────────

  predictLTV(userId: string, months = 12): number {
    const prediction = this.predictChurn(userId);
    // Survival-adjusted LTV using geometric series: sum over months of (1-churnProb)^t * monthly_value
    const monthlyRevenue = prediction.ltv / Math.max(1, months);
    const survivalRate   = 1 - prediction.churnProbability;
    let ltv = 0;
    for (let t = 1; t <= months; t++) {
      ltv += monthlyRevenue * Math.pow(survivalRate, t - 1);
    }
    return Math.round(ltv * 100) / 100;
  }

  // ── Time-series forecasting (Holt-Winters) ─────────────────────────────────

  forecastTimeSeries(
    metric: string,
    horizonPoints = 14,
    seasonalPeriod = 7,
    options?: { alpha?: number; beta?: number; gamma?: number },
  ): TimeSeriesForecast {
    const series = this.metricSeries.get(metric);
    if (!series || series.values.length < 4) {
      logger.warn('Insufficient data for time-series forecast', { metric });
      return this.naiveForecast(metric, horizonPoints);
    }

    const { values, timestamps } = series;
    const alpha = options?.alpha ?? 0.3;
    const beta  = options?.beta  ?? 0.1;
    const gamma = options?.gamma ?? 0.2;
    const m = seasonalPeriod;

    // Initialise level, trend, seasonal indices
    let level = values.slice(0, m).reduce((a, b) => a + b, 0) / m;
    let trend = (
      values.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m -
      values.slice(0, m).reduce((a, b) => a + b, 0) / m
    ) / m;
    const seasonal = values.slice(0, m).map(v => v / Math.max(level, 1));
    const fitted: number[] = [];

    for (let i = 0; i < values.length; i++) {
      const si = seasonal[i % m];
      const prevLevel = level;
      level  = alpha * (values[i] / Math.max(si, 0.001)) + (1 - alpha) * (level + trend);
      trend  = beta  * (level - prevLevel)                 + (1 - beta)  * trend;
      seasonal[i % m] = gamma * (values[i] / Math.max(level, 0.001)) + (1 - gamma) * si;
      fitted.push((level + trend) * seasonal[i % m]);
    }

    // MAPE
    const mapeVals = values.map((v, i) => Math.abs((v - fitted[i]) / Math.max(Math.abs(v), 1)));
    const mape = mapeVals.reduce((a, b) => a + b, 0) / mapeVals.length;

    // Residual std
    const residuals = values.map((v, i) => v - fitted[i]);
    const stdRes = Math.sqrt(residuals.reduce((a, v) => a + v * v, 0) / residuals.length);

    // Forecast
    const lastTs = timestamps[timestamps.length - 1]?.getTime() ?? Date.now();
    const avgInterval = timestamps.length > 1
      ? (timestamps[timestamps.length - 1].getTime() - timestamps[0].getTime()) / (timestamps.length - 1)
      : 86400000;

    const forecast = Array.from({ length: horizonPoints }, (_, h) => {
      const si = seasonal[(values.length + h) % m] ?? 1;
      const value = (level + trend * (h + 1)) * si;
      const ci = 1.96 * stdRes * Math.sqrt(h + 1);
      return {
        date: new Date(lastTs + (h + 1) * avgInterval),
        value:  Math.max(0, Math.round(value * 100) / 100),
        lower:  Math.max(0, Math.round((value - ci) * 100) / 100),
        upper:  Math.round((value + ci) * 100) / 100,
      };
    });

    logger.info('Time-series forecast generated', { metric, horizonPoints, mape: mape.toFixed(4) });
    return { metric, values, timestamps, forecast, alpha, beta, gamma, mape, method: 'holt-winters' };
  }

  private naiveForecast(metric: string, horizonPoints: number): TimeSeriesForecast {
    const series = this.metricSeries.get(metric);
    const lastValue = series?.values.at(-1) ?? 0;
    const lastTs    = series?.timestamps.at(-1)?.getTime() ?? Date.now();
    const forecast  = Array.from({ length: horizonPoints }, (_, h) => ({
      date: new Date(lastTs + (h + 1) * 86400000),
      value: lastValue, lower: lastValue * 0.9, upper: lastValue * 1.1,
    }));
    return {
      metric,
      values: series?.values ?? [],
      timestamps: series?.timestamps ?? [],
      forecast, alpha: 0, beta: 0, gamma: 0, mape: 1,
      method: 'naive',
    };
  }

  // ── Funnel analysis ────────────────────────────────────────────────────────

  analyzeFunnel(funnelId: string, userIds?: string[]): FunnelAnalysis {
    const stageDefs = this.funnelDefs.get(funnelId);
    if (!stageDefs || stageDefs.length === 0) throw new Error(`Funnel not found: ${funnelId}`);

    const targetUsers = userIds ?? Array.from(this.userEvents.keys());
    let prevCount = targetUsers.length;
    const stages: FunnelStage[] = [];

    for (let s = 0; s < stageDefs.length; s++) {
      const stageName  = stageDefs[s];
      const nextStage  = stageDefs[s + 1];
      let stageUsers   = 0;
      let totalTime    = 0;
      let timeCount    = 0;

      for (const uid of targetUsers) {
        const events = this.userEvents.get(uid) ?? [];
        const stageEvent = events.find(e => e.eventType === stageName);
        if (!stageEvent) continue;
        stageUsers++;
        if (nextStage) {
          const nextEvent = events.find(
            e => e.eventType === nextStage && e.timestamp >= stageEvent.timestamp
          );
          if (nextEvent) {
            totalTime += nextEvent.timestamp.getTime() - stageEvent.timestamp.getTime();
            timeCount++;
          }
        }
      }

      const conversionRate = prevCount > 0 ? stageUsers / prevCount : 0;
      const dropOffRate    = 1 - conversionRate;
      stages.push({
        name: stageName,
        users: stageUsers,
        conversionRate,
        dropOffRate,
        avgTimeInStageSeconds: timeCount > 0 ? totalTime / timeCount / 1000 : 0,
      });
      prevCount = stageUsers;
    }

    const overallConversionRate =
      stages.length > 0 && targetUsers.length > 0
        ? (stages.at(-1)?.users ?? 0) / targetUsers.length
        : 0;

    const bottleneckStage = stages.reduce(
      (worst, s) => s.dropOffRate > worst.dropOffRate ? s : worst,
      stages[0] ?? { name: 'unknown', dropOffRate: 0 } as FunnelStage,
    ).name;

    return { funnelId, stages, overallConversionRate, bottleneckStage, analysedAt: new Date() };
  }

  // ── Cohort retention ───────────────────────────────────────────────────────

  buildCohortRetention(cohortId: string, periods = 8, periodLabel: CohortRetention['periodLabel'] = 'weekly'): CohortRetention {
    const cohort = this.cohorts.get(cohortId);
    if (!cohort) throw new Error(`Cohort not found: ${cohortId}`);

    const periodMs = periodLabel === 'daily' ? 86400000 : periodLabel === 'weekly' ? 604800000 : 2592000000;
    const retentionByPeriod: number[] = [];
    const churnCurve: number[] = [];
    let prev = cohort.userIds.length;

    for (let p = 1; p <= periods; p++) {
      const windowStart = cohort.date.getTime() + (p - 1) * periodMs;
      const windowEnd   = cohort.date.getTime() + p * periodMs;
      let retained = 0;
      for (const uid of cohort.userIds) {
        const events = this.userEvents.get(uid) ?? [];
        const hasActivity = events.some(
          e => e.timestamp.getTime() >= windowStart && e.timestamp.getTime() < windowEnd
        );
        if (hasActivity) retained++;
      }
      const retentionRate = cohort.userIds.length > 0 ? retained / cohort.userIds.length : 0;
      const churnRate     = prev > 0 ? (prev - retained) / prev : 0;
      retentionByPeriod.push(Math.round(retentionRate * 10000) / 10000);
      churnCurve.push(Math.round(churnRate * 10000) / 10000);
      prev = retained;
    }

    logger.info('Cohort retention built', { cohortId, periods, periodLabel });
    return {
      cohortId,
      cohortDate: cohort.date,
      initialSize: cohort.userIds.length,
      retentionByPeriod,
      periodLabel,
      churnCurve,
    };
  }

  // ── Anomaly detection (z-score + IQR) ─────────────────────────────────────

  detectAnomalies(metric: string, threshold = 2.5): AnomalyAlert[] {
    const series = this.metricSeries.get(metric);
    if (!series || series.values.length < 10) return [];

    const values = series.values;
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const std  = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);

    // IQR
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const iqrLower = q1 - 1.5 * iqr;
    const iqrUpper = q3 + 1.5 * iqr;

    const alerts: AnomalyAlert[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const zScore   = std > 0 ? Math.abs((v - mean) / std) : 0;
      const iqrScore = iqr > 0 ? Math.max(0, Math.max(iqrLower - v, v - iqrUpper) / iqr) : 0;
      if (zScore < threshold && iqrScore < 1.5) continue;

      const severity: AnomalyAlert['severity'] =
        zScore >= 4 || iqrScore >= 3 ? 'critical' :
        zScore >= 3 || iqrScore >= 2 ? 'warning' : 'info';

      alerts.push({
        id: `anomaly_${metric}_${i}_${Date.now()}`,
        metric,
        value: v,
        expectedValue: mean,
        zScore: Math.round(zScore * 100) / 100,
        iqrScore: Math.round(iqrScore * 100) / 100,
        severity,
        detectedAt: series.timestamps[i] ?? new Date(),
        context: { index: i, mean: Math.round(mean * 100) / 100, std: Math.round(std * 100) / 100, q1, q3 },
      });
    }

    logger.info('Anomaly detection completed', { metric, anomalies: alerts.length });
    return alerts;
  }

  // ── Content scoring ────────────────────────────────────────────────────────

  scoreContent(contentId: string, features: ContentFeatures): ContentScore {
    const cacheKey = `content_score_${contentId}`;
    const cached = cache.get<ContentScore>(cacheKey);
    if (cached) return cached;

    // Quality score
    const qualityScore = Math.min(100, Math.round(
      features.readabilityScore * 0.3 +
      features.wordCount / 20 * 0.2 +
      (features.hasImage ? 15 : 0) +
      (features.hasVideo ? 20 : 0) +
      features.authorReputation * 100 * 0.15
    ));

    // Virality score – combines sentiment extremes, multimedia, and engagement cues
    const sentimentExtreme = Math.abs(features.sentimentScore); // very positive or negative = viral
    const viralityScore = Math.min(100, Math.round(
      sentimentExtreme * 40 +
      (features.hasVideo ? 25 : 0) +
      (features.hasImage ? 10 : 0) +
      features.authorReputation * 100 * 0.25
    ));

    // Relevance score (topic fit × timeliness proxy via publish hour)
    const timelinessBonus = features.publishHour >= 7 && features.publishHour <= 10 ? 10 : 0;
    const relevanceScore  = Math.min(100, Math.round(features.topicRelevance * 80 + timelinessBonus));

    // CTR prediction via sigmoid of composite score
    const composite = (qualityScore + viralityScore + relevanceScore) / 300;
    const engagementPrediction = Math.round((1 / (1 + Math.exp(-10 * (composite - 0.5)))) * 1000) / 1000;

    const score: ContentScore = {
      contentId,
      viralityScore,
      qualityScore,
      relevanceScore,
      engagementPrediction,
      audienceMatch: features.topicRelevance,
      scoredAt: new Date(),
    };

    cache.set(cacheKey, score, 3600);
    return score;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  getMetricSeries(metric: string): MetricSeries | undefined {
    return this.metricSeries.get(metric);
  }

  listMetrics(): string[] {
    return Array.from(this.metricSeries.keys());
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getPredictiveAnalyticsEngine(): PredictiveAnalyticsEngine {
  if (!(globalThis as any).__predictiveAnalyticsEngine__) {
    (globalThis as any).__predictiveAnalyticsEngine__ = new PredictiveAnalyticsEngine();
  }
  return (globalThis as any).__predictiveAnalyticsEngine__;
}
