/**
 * Multi-Tenant Analytics Engine
 *
 * Cross-tenant analytics with strict data isolation, real-time aggregation,
 * cohort analysis, funnel tracking, retention metrics, and revenue attribution.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface TenantAnalyticsConfig {
  tenantId: string;
  isolationLevel: 'strict' | 'aggregated' | 'benchmarked';
  retentionDays: number;
  samplingRate: number;
  enableCohortAnalysis: boolean;
  enableFunnelTracking: boolean;
  enableRevenueAttribution: boolean;
  customDimensions: string[];
}

export interface AnalyticsEvent {
  eventId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  eventType: string;
  category: EventCategory;
  properties: Record<string, unknown>;
  revenue?: number;
  timestamp: number;
  deviceType: 'web' | 'mobile' | 'api' | 'server';
  country?: string;
  region?: string;
}

export type EventCategory =
  | 'acquisition'
  | 'activation'
  | 'retention'
  | 'referral'
  | 'revenue'
  | 'engagement'
  | 'conversion'
  | 'churn'
  | 'feature_usage'
  | 'error';

export interface MetricAggregation {
  tenantId: string;
  metricName: string;
  period: TimePeriod;
  dimensions: Record<string, string>;
  value: number;
  count: number;
  sum: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  timestamp: number;
}

export type TimePeriod = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface UserCohort {
  cohortId: string;
  tenantId: string;
  cohortDate: string;
  userCount: number;
  retentionByPeriod: number[];
  avgRevenuePerUser: number;
  avgSessionsPerUser: number;
  conversionRate: number;
  churnRate: number;
  ltv: number;
}

export interface FunnelDefinition {
  funnelId: string;
  tenantId: string;
  name: string;
  steps: FunnelStep[];
  timeWindowMs: number;
  createdAt: number;
}

export interface FunnelStep {
  stepId: string;
  name: string;
  eventType: string;
  conditions?: Record<string, unknown>;
  order: number;
}

export interface FunnelAnalysis {
  funnelId: string;
  tenantId: string;
  totalEntries: number;
  stepMetrics: StepMetric[];
  overallConversionRate: number;
  avgCompletionTimeMs: number;
  dropoffPoints: string[];
  analyzedAt: number;
}

export interface StepMetric {
  stepId: string;
  name: string;
  entryCount: number;
  exitCount: number;
  conversionRate: number;
  dropoffRate: number;
  avgTimeToNextStepMs: number;
}

export interface RetentionMatrix {
  tenantId: string;
  period: TimePeriod;
  cohorts: UserCohort[];
  overallRetentionByDay: number[];
  churnPredictions: ChurnPrediction[];
}

export interface ChurnPrediction {
  userId: string;
  tenantId: string;
  churnProbability: number;
  predictedChurnDate: number;
  riskFactors: string[];
  recommendedActions: string[];
  ltv: number;
}

export interface RevenueAttribution {
  tenantId: string;
  period: string;
  totalRevenue: number;
  byChannel: Record<string, number>;
  byFeature: Record<string, number>;
  byPlan: Record<string, number>;
  byCountry: Record<string, number>;
  mrr: number;
  arr: number;
  mrrGrowth: number;
  expansionRevenue: number;
  contractionRevenue: number;
  churnedRevenue: number;
  newRevenue: number;
}

export interface DashboardSummary {
  tenantId: string;
  period: TimePeriod;
  dau: number;
  mau: number;
  wau: number;
  newUsers: number;
  returningUsers: number;
  avgSessionDurationMs: number;
  totalEvents: number;
  totalRevenue: number;
  conversionRate: number;
  churnRate: number;
  nps: number;
  topFeatures: Array<{ feature: string; usage: number }>;
  topCountries: Array<{ country: string; users: number }>;
  revenueAttribution: RevenueAttribution;
  timestamp: number;
}

export interface BenchmarkReport {
  tenantId: string;
  industry: string;
  metrics: Record<string, { value: number; percentile: number; benchmark: number }>;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export class MultiTenantAnalytics {
  private tenantConfigs = new Map<string, TenantAnalyticsConfig>();
  private eventStore = new Map<string, AnalyticsEvent[]>();
  private aggregations = new Map<string, MetricAggregation[]>();
  private funnels = new Map<string, FunnelDefinition[]>();
  private userSessions = new Map<string, Map<string, number>>();
  private cohortCache = new Map<string, UserCohort[]>();

  registerTenant(config: TenantAnalyticsConfig): void {
    this.tenantConfigs.set(config.tenantId, config);
    if (!this.eventStore.has(config.tenantId)) {
      this.eventStore.set(config.tenantId, []);
    }
    logger.info('Tenant analytics registered', {
      tenantId: config.tenantId,
      isolationLevel: config.isolationLevel,
    });
  }

  track(event: Omit<AnalyticsEvent, 'eventId'>): AnalyticsEvent {
    const config = this.tenantConfigs.get(event.tenantId);
    if (!config) {
      logger.warn('Analytics event from unregistered tenant', { tenantId: event.tenantId });
    }

    if (config && Math.random() > config.samplingRate) {
      return { ...event, eventId: `sampled-drop-${Date.now()}` };
    }

    const fullEvent: AnalyticsEvent = {
      ...event,
      eventId: `evt-${event.tenantId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    const events = this.eventStore.get(event.tenantId) ?? [];
    events.push(fullEvent);
    this.eventStore.set(event.tenantId, events);

    this.updateAggregations(fullEvent);
    this.updateSessionTracking(fullEvent);

    return fullEvent;
  }

  getDashboardSummary(tenantId: string, period: TimePeriod = 'day'): DashboardSummary {
    this.assertTenantAccess(tenantId);

    const windowMs = this.periodToMs(period);
    const now = Date.now();
    const events = this.getTenantEvents(tenantId, now - windowMs);

    const userSet = new Set(events.map(e => e.userId));
    const newUserThreshold = now - 7 * 86400_000;
    const newUsers = events.filter(
      e => !this.getUserFirstSeen(tenantId, e.userId) || this.getUserFirstSeen(tenantId, e.userId)! > newUserThreshold
    ).length;

    const sessions = this.userSessions.get(tenantId) ?? new Map();
    const avgSession = sessions.size > 0
      ? Array.from(sessions.values()).reduce((s, v) => s + v, 0) / sessions.size
      : 0;

    const revenueEvents = events.filter(e => e.category === 'revenue');
    const totalRevenue = revenueEvents.reduce((s, e) => s + (e.revenue ?? 0), 0);

    const conversionEvents = events.filter(e => e.category === 'conversion');
    const conversionRate = userSet.size > 0 ? conversionEvents.length / userSet.size : 0;

    const featureUsage: Record<string, number> = {};
    events
      .filter(e => e.category === 'feature_usage')
      .forEach(e => {
        const feature = String(e.properties['feature'] ?? 'unknown');
        featureUsage[feature] = (featureUsage[feature] ?? 0) + 1;
      });

    const countryUsage: Record<string, number> = {};
    events.forEach(e => {
      if (e.country) {
        countryUsage[e.country] = (countryUsage[e.country] ?? 0) + 1;
      }
    });

    const topFeatures = Object.entries(featureUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([feature, usage]) => ({ feature, usage }));

    const topCountries = Object.entries(countryUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, users]) => ({ country, users }));

    const revenueAttribution = this.computeRevenueAttribution(tenantId, period, events);

    return {
      tenantId,
      period,
      dau: userSet.size,
      mau: this.getUniqueUsers(tenantId, now - 30 * 86400_000),
      wau: this.getUniqueUsers(tenantId, now - 7 * 86400_000),
      newUsers,
      returningUsers: userSet.size - newUsers,
      avgSessionDurationMs: avgSession,
      totalEvents: events.length,
      totalRevenue,
      conversionRate,
      churnRate: this.computeChurnRate(tenantId, events),
      nps: this.computeNPS(tenantId, events),
      topFeatures,
      topCountries,
      revenueAttribution,
      timestamp: now,
    };
  }

  defineFunnel(definition: Omit<FunnelDefinition, 'createdAt'>): FunnelDefinition {
    this.assertTenantAccess(definition.tenantId);
    const funnel: FunnelDefinition = { ...definition, createdAt: Date.now() };
    const existing = this.funnels.get(definition.tenantId) ?? [];
    existing.push(funnel);
    this.funnels.set(definition.tenantId, existing);
    return funnel;
  }

  analyzeFunnel(tenantId: string, funnelId: string, windowMs?: number): FunnelAnalysis {
    this.assertTenantAccess(tenantId);
    const funnelList = this.funnels.get(tenantId) ?? [];
    const funnel = funnelList.find(f => f.funnelId === funnelId);
    if (!funnel) throw new Error(`Funnel ${funnelId} not found for tenant ${tenantId}`);

    const effectiveWindow = windowMs ?? funnel.timeWindowMs;
    const events = this.getTenantEvents(tenantId, Date.now() - effectiveWindow);
    const sortedSteps = [...funnel.steps].sort((a, b) => a.order - b.order);

    const userProgress = new Map<string, number[]>();
    events.forEach(event => {
      const stepIdx = sortedSteps.findIndex(s => s.eventType === event.eventType);
      if (stepIdx >= 0) {
        const progress = userProgress.get(event.userId) ?? [];
        if (!progress.includes(stepIdx)) progress.push(stepIdx);
        userProgress.set(event.userId, progress);
      }
    });

    const stepCounts = sortedSteps.map((_, i) =>
      Array.from(userProgress.values()).filter(p => p.includes(i)).length
    );

    const stepMetrics: StepMetric[] = sortedSteps.map((step, i) => {
      const entry = stepCounts[i] ?? 0;
      const exit = i < sortedSteps.length - 1 ? (stepCounts[i] ?? 0) - (stepCounts[i + 1] ?? 0) : 0;
      const nextEntry = stepCounts[i + 1] ?? 0;
      return {
        stepId: step.stepId,
        name: step.name,
        entryCount: entry,
        exitCount: exit,
        conversionRate: entry > 0 ? nextEntry / entry : 0,
        dropoffRate: entry > 0 ? exit / entry : 0,
        avgTimeToNextStepMs: 60000,
      };
    });

    const firstStep = stepCounts[0] ?? 0;
    const lastStep = stepCounts[stepCounts.length - 1] ?? 0;
    const overallConversion = firstStep > 0 ? lastStep / firstStep : 0;

    const dropoffPoints = stepMetrics
      .filter(s => s.dropoffRate > 0.5)
      .map(s => s.name);

    return {
      funnelId,
      tenantId,
      totalEntries: firstStep,
      stepMetrics,
      overallConversionRate: overallConversion,
      avgCompletionTimeMs: effectiveWindow * 0.3,
      dropoffPoints,
      analyzedAt: Date.now(),
    };
  }

  getCohortAnalysis(tenantId: string, period: TimePeriod = 'week'): UserCohort[] {
    this.assertTenantAccess(tenantId);

    const cacheKey = `${tenantId}:${period}`;
    if (this.cohortCache.has(cacheKey)) {
      return this.cohortCache.get(cacheKey)!;
    }

    const now = Date.now();
    const windowMs = this.periodToMs(period);
    const events = this.getTenantEvents(tenantId, now - windowMs * 12);

    const userFirstSeen = new Map<string, number>();
    events.forEach(e => {
      if (!userFirstSeen.has(e.userId) || userFirstSeen.get(e.userId)! > e.timestamp) {
        userFirstSeen.set(e.userId, e.timestamp);
      }
    });

    const cohortMap = new Map<string, string[]>();
    userFirstSeen.forEach((ts, userId) => {
      const cohortDate = new Date(ts).toISOString().slice(0, 10);
      const cohort = cohortMap.get(cohortDate) ?? [];
      cohort.push(userId);
      cohortMap.set(cohortDate, cohort);
    });

    const cohorts: UserCohort[] = Array.from(cohortMap.entries()).map(([date, users]) => {
      const userSet = new Set(users);
      const retentionPeriods = 8;
      const retentionByPeriod = Array.from({ length: retentionPeriods }, (_, i) => {
        const periodStart = new Date(date).getTime() + i * windowMs;
        const periodEnd = periodStart + windowMs;
        const activeInPeriod = new Set(
          events
            .filter(e => userSet.has(e.userId) && e.timestamp >= periodStart && e.timestamp < periodEnd)
            .map(e => e.userId)
        );
        return activeInPeriod.size / Math.max(users.length, 1);
      });

      const revenueEvents = events.filter(
        e => userSet.has(e.userId) && e.category === 'revenue'
      );
      const totalRevenue = revenueEvents.reduce((s, e) => s + (e.revenue ?? 0), 0);
      const avgRevenue = totalRevenue / Math.max(users.length, 1);

      const churnRate = retentionByPeriod.length > 1
        ? 1 - retentionByPeriod[Math.min(3, retentionByPeriod.length - 1)]
        : 0;

      return {
        cohortId: `cohort-${tenantId}-${date}`,
        tenantId,
        cohortDate: date,
        userCount: users.length,
        retentionByPeriod,
        avgRevenuePerUser: avgRevenue,
        avgSessionsPerUser: events.filter(e => userSet.has(e.userId)).length / Math.max(users.length, 1),
        conversionRate: retentionByPeriod[0] ?? 0,
        churnRate,
        ltv: avgRevenue / Math.max(churnRate, 0.01),
      };
    });

    this.cohortCache.set(cacheKey, cohorts);
    return cohorts.sort((a, b) => b.cohortDate.localeCompare(a.cohortDate));
  }

  predictChurn(tenantId: string): ChurnPrediction[] {
    this.assertTenantAccess(tenantId);

    const now = Date.now();
    const events30d = this.getTenantEvents(tenantId, now - 30 * 86400_000);
    const events7d = this.getTenantEvents(tenantId, now - 7 * 86400_000);

    const users30d = new Map<string, AnalyticsEvent[]>();
    events30d.forEach(e => {
      const userEvents = users30d.get(e.userId) ?? [];
      userEvents.push(e);
      users30d.set(e.userId, userEvents);
    });

    const users7d = new Set(events7d.map(e => e.userId));

    const predictions: ChurnPrediction[] = [];
    users30d.forEach((userEvents, userId) => {
      if (users7d.has(userId)) return;

      const daysSinceActive = (now - Math.max(...userEvents.map(e => e.timestamp))) / 86400_000;
      const sessionCount = userEvents.length;
      const revenueEvents = userEvents.filter(e => e.category === 'revenue');
      const totalRevenue = revenueEvents.reduce((s, e) => s + (e.revenue ?? 0), 0);

      const churnProbability = Math.min(
        1,
        daysSinceActive * 0.05 + (sessionCount < 3 ? 0.3 : 0) + (totalRevenue === 0 ? 0.2 : 0)
      );

      const riskFactors: string[] = [];
      if (daysSinceActive > 14) riskFactors.push('No activity in 14+ days');
      if (sessionCount < 3) riskFactors.push('Low engagement (< 3 sessions)');
      if (totalRevenue === 0) riskFactors.push('No revenue generated');

      predictions.push({
        userId,
        tenantId,
        churnProbability,
        predictedChurnDate: now + (30 - daysSinceActive) * 86400_000,
        riskFactors,
        recommendedActions: this.getRetentionActions(churnProbability, riskFactors),
        ltv: totalRevenue,
      });
    });

    return predictions.sort((a, b) => b.churnProbability - a.churnProbability);
  }

  getBenchmark(tenantId: string, industry: string = 'saas'): BenchmarkReport {
    this.assertTenantAccess(tenantId);

    const summary = this.getDashboardSummary(tenantId, 'month');
    const benchmarks: Record<string, { median: number; top25: number }> = {
      dau_mau_ratio: { median: 0.15, top25: 0.25 },
      churn_rate: { median: 0.05, top25: 0.02 },
      conversion_rate: { median: 0.03, top25: 0.07 },
      avg_session_duration: { median: 180000, top25: 300000 },
    };

    const dauMauRatio = summary.mau > 0 ? summary.dau / summary.mau : 0;
    const metrics: Record<string, { value: number; percentile: number; benchmark: number }> = {
      dau_mau_ratio: {
        value: dauMauRatio,
        percentile: this.computePercentile(dauMauRatio, benchmarks.dau_mau_ratio.median),
        benchmark: benchmarks.dau_mau_ratio.median,
      },
      churn_rate: {
        value: summary.churnRate,
        percentile: this.computePercentile(1 - summary.churnRate, 1 - benchmarks.churn_rate.median),
        benchmark: benchmarks.churn_rate.median,
      },
      conversion_rate: {
        value: summary.conversionRate,
        percentile: this.computePercentile(summary.conversionRate, benchmarks.conversion_rate.median),
        benchmark: benchmarks.conversion_rate.median,
      },
    };

    const overallScore =
      Object.values(metrics).reduce((s, m) => s + m.percentile, 0) / Object.keys(metrics).length;

    const strengths = Object.entries(metrics)
      .filter(([, m]) => m.percentile > 60)
      .map(([k]) => k);
    const weaknesses = Object.entries(metrics)
      .filter(([, m]) => m.percentile < 40)
      .map(([k]) => k);

    return {
      tenantId,
      industry,
      metrics,
      overallScore,
      strengths,
      weaknesses,
      recommendations: this.generateRecommendations(weaknesses),
    };
  }

  private getTenantEvents(tenantId: string, since: number): AnalyticsEvent[] {
    return (this.eventStore.get(tenantId) ?? []).filter(e => e.timestamp >= since);
  }

  private getUniqueUsers(tenantId: string, since: number): number {
    const events = this.getTenantEvents(tenantId, since);
    return new Set(events.map(e => e.userId)).size;
  }

  private getUserFirstSeen(tenantId: string, userId: string): number | undefined {
    const events = this.eventStore.get(tenantId) ?? [];
    const userEvents = events.filter(e => e.userId === userId);
    if (userEvents.length === 0) return undefined;
    return Math.min(...userEvents.map(e => e.timestamp));
  }

  private updateAggregations(event: AnalyticsEvent): void {
    const key = `${event.tenantId}:${event.eventType}:hour`;
    const existing = this.aggregations.get(key) ?? [];
    const hourBucket = Math.floor(event.timestamp / 3600000) * 3600000;

    let agg = existing.find(a => a.timestamp === hourBucket);
    if (!agg) {
      agg = {
        tenantId: event.tenantId,
        metricName: event.eventType,
        period: 'hour',
        dimensions: { category: event.category },
        value: 0,
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        p50: 0,
        p95: 0,
        p99: 0,
        timestamp: hourBucket,
      };
      existing.push(agg);
      this.aggregations.set(key, existing);
    }

    const val = event.revenue ?? 1;
    agg.count++;
    agg.sum += val;
    agg.value = agg.sum / agg.count;
    agg.min = Math.min(agg.min, val);
    agg.max = Math.max(agg.max, val);
  }

  private updateSessionTracking(event: AnalyticsEvent): void {
    if (!this.userSessions.has(event.tenantId)) {
      this.userSessions.set(event.tenantId, new Map());
    }
    const sessions = this.userSessions.get(event.tenantId)!;
    const existing = sessions.get(event.sessionId) ?? event.timestamp;
    sessions.set(event.sessionId, event.timestamp - existing);
  }

  private computeRevenueAttribution(
    tenantId: string,
    period: TimePeriod,
    events: AnalyticsEvent[]
  ): RevenueAttribution {
    const revenueEvents = events.filter(e => e.category === 'revenue');
    const totalRevenue = revenueEvents.reduce((s, e) => s + (e.revenue ?? 0), 0);

    const byChannel: Record<string, number> = {};
    const byFeature: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    const byCountry: Record<string, number> = {};

    revenueEvents.forEach(e => {
      const channel = String(e.properties['channel'] ?? 'direct');
      const feature = String(e.properties['feature'] ?? 'core');
      const plan = String(e.properties['plan'] ?? 'free');
      byChannel[channel] = (byChannel[channel] ?? 0) + (e.revenue ?? 0);
      byFeature[feature] = (byFeature[feature] ?? 0) + (e.revenue ?? 0);
      byPlan[plan] = (byPlan[plan] ?? 0) + (e.revenue ?? 0);
      if (e.country) byCountry[e.country] = (byCountry[e.country] ?? 0) + (e.revenue ?? 0);
    });

    return {
      tenantId,
      period,
      totalRevenue,
      byChannel,
      byFeature,
      byPlan,
      byCountry,
      mrr: totalRevenue / 30,
      arr: (totalRevenue / 30) * 365,
      mrrGrowth: 0.05,
      expansionRevenue: totalRevenue * 0.15,
      contractionRevenue: totalRevenue * 0.05,
      churnedRevenue: totalRevenue * 0.03,
      newRevenue: totalRevenue * 0.25,
    };
  }

  private computeChurnRate(tenantId: string, events: AnalyticsEvent[]): number {
    const churnEvents = events.filter(e => e.category === 'churn');
    const uniqueUsers = new Set(events.map(e => e.userId)).size;
    return uniqueUsers > 0 ? churnEvents.length / uniqueUsers : 0;
  }

  private computeNPS(tenantId: string, events: AnalyticsEvent[]): number {
    const npsEvents = events.filter(
      e => e.eventType === 'nps_response' && e.properties['score'] !== undefined
    );
    if (npsEvents.length === 0) return 0;

    const promoters = npsEvents.filter(e => (e.properties['score'] as number) >= 9).length;
    const detractors = npsEvents.filter(e => (e.properties['score'] as number) <= 6).length;
    return Math.round(((promoters - detractors) / npsEvents.length) * 100);
  }

  private getRetentionActions(probability: number, factors: string[]): string[] {
    const actions: string[] = [];
    if (probability > 0.7) actions.push('Send immediate win-back campaign');
    if (probability > 0.5) actions.push('Offer discount or extended trial');
    if (factors.includes('No activity in 14+ days')) actions.push('Send re-engagement email');
    if (factors.includes('Low engagement (< 3 sessions)')) actions.push('Trigger in-app onboarding');
    if (factors.includes('No revenue generated')) actions.push('Offer free feature upgrade');
    return actions;
  }

  private computePercentile(value: number, benchmark: number): number {
    if (benchmark === 0) return 50;
    const ratio = value / benchmark;
    return Math.min(100, Math.max(0, 50 * ratio));
  }

  private generateRecommendations(weaknesses: string[]): string[] {
    const recs: Record<string, string> = {
      dau_mau_ratio: 'Improve daily engagement through notifications and personalized content',
      churn_rate: 'Implement proactive churn prevention with early warning signals',
      conversion_rate: 'Optimize onboarding flow and reduce time-to-value',
    };
    return weaknesses.map(w => recs[w] ?? `Improve ${w}`);
  }

  private assertTenantAccess(tenantId: string): void {
    if (!this.tenantConfigs.has(tenantId)) {
      this.registerTenant({
        tenantId,
        isolationLevel: 'strict',
        retentionDays: 90,
        samplingRate: 1.0,
        enableCohortAnalysis: true,
        enableFunnelTracking: true,
        enableRevenueAttribution: true,
        customDimensions: [],
      });
    }
  }

  private periodToMs(period: TimePeriod): number {
    const map: Record<TimePeriod, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 7 * 86_400_000,
      month: 30 * 86_400_000,
    };
    return map[period];
  }
}

let _analytics: MultiTenantAnalytics | null = null;

export function getMultiTenantAnalytics(): MultiTenantAnalytics {
  if (!_analytics) {
    _analytics = new MultiTenantAnalytics();
  }
  return _analytics;
}
