import { logger } from '@/lib/logger';

// --- Types ---

type CohortGranularity = 'day' | 'week' | 'month';

interface CohortDefinition {
  id: string;
  name: string;
  criteria: CohortCriteria;
  createdAt: number;
}

interface CohortCriteria {
  signUpAfter?: number;
  signUpBefore?: number;
  acquisitionSource?: string;
  planTier?: string;
  custom?: (member: CohortMember) => boolean;
}

interface CohortMember {
  userId: string;
  signUpDate: number;
  acquisitionSource?: string;
  planTier?: string;
  metadata?: Record<string, unknown>;
}

interface CohortActivity {
  userId: string;
  timestamp: number;
  event: string;
  revenue?: number;
  metadata?: Record<string, unknown>;
}

interface RetentionRow {
  periodIndex: number;
  periodLabel: string;
  totalMembers: number;
  activeMembers: number;
  retentionRate: number;
}

interface RetentionReport {
  cohortId: string;
  cohortName: string;
  granularity: CohortGranularity;
  memberCount: number;
  rows: RetentionRow[];
  generatedAt: string;
}

interface RevenueRow {
  periodIndex: number;
  periodLabel: string;
  totalRevenue: number;
  avgRevenuePerMember: number;
  cumulativeRevenue: number;
}

interface RevenueReport {
  cohortId: string;
  cohortName: string;
  memberCount: number;
  rows: RevenueRow[];
  totalLifetimeRevenue: number;
  avgLTV: number;
  generatedAt: string;
}

interface FeatureAdoptionRow {
  feature: string;
  adopters: number;
  adoptionRate: number;
  avgTimeToAdoptMs: number;
}

interface CohortHealthScore {
  cohortId: string;
  retentionScore: number;
  revenueScore: number;
  engagementScore: number;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

interface CohortComparisonMetric {
  metric: string;
  cohortA: number;
  cohortB: number;
  delta: number;
  deltaPercent: number;
}

// --- Helpers ---

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

function granularityMs(g: CohortGranularity): number {
  switch (g) {
    case 'day':
      return MS_PER_DAY;
    case 'week':
      return MS_PER_WEEK;
    case 'month':
      return MS_PER_DAY * 30;
  }
}

function periodLabel(g: CohortGranularity, index: number): string {
  switch (g) {
    case 'day':
      return `Day ${index}`;
    case 'week':
      return `Week ${index}`;
    case 'month':
      return `Month ${index}`;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// --- Engine ---

class CohortAnalysisEngine {
  private cohorts = new Map<string, CohortDefinition>();
  private members: CohortMember[] = [];
  private activities: CohortActivity[] = [];
  private readonly maxActivities: number;

  constructor(maxActivities = 1_000_000) {
    this.maxActivities = maxActivities;
    logger.info('CohortAnalysisEngine initialized', { maxActivities });
  }

  defineCohort(id: string, name: string, criteria: CohortCriteria): CohortDefinition {
    const def: CohortDefinition = { id, name, criteria, createdAt: Date.now() };
    this.cohorts.set(id, def);
    logger.info('Cohort defined', { cohortId: id });
    return def;
  }

  removeCohort(id: string): boolean {
    return this.cohorts.delete(id);
  }

  getCohort(id: string): CohortDefinition | undefined {
    return this.cohorts.get(id);
  }

  listCohorts(): CohortDefinition[] {
    return Array.from(this.cohorts.values());
  }

  addMember(member: CohortMember): void {
    const existing = this.members.find((m) => m.userId === member.userId);
    if (existing) {
      Object.assign(existing, member);
    } else {
      this.members.push(member);
    }
  }

  addMembers(members: CohortMember[]): void {
    for (const m of members) this.addMember(m);
  }

  recordActivity(activity: CohortActivity): void {
    this.activities.push(activity);
    if (this.activities.length > this.maxActivities) {
      this.activities = this.activities.slice(this.activities.length - this.maxActivities);
    }
  }

  private resolveCohortMembers(cohortId: string): CohortMember[] {
    const def = this.cohorts.get(cohortId);
    if (!def) throw new Error(`Cohort not found: ${cohortId}`);
    const c = def.criteria;

    return this.members.filter((m) => {
      if (c.signUpAfter !== undefined && m.signUpDate < c.signUpAfter) return false;
      if (c.signUpBefore !== undefined && m.signUpDate >= c.signUpBefore) return false;
      if (c.acquisitionSource !== undefined && m.acquisitionSource !== c.acquisitionSource) return false;
      if (c.planTier !== undefined && m.planTier !== c.planTier) return false;
      if (c.custom && !c.custom(m)) return false;
      return true;
    });
  }

  retentionAnalysis(
    cohortId: string,
    granularity: CohortGranularity,
    periods = 12,
  ): RetentionReport {
    const def = this.cohorts.get(cohortId);
    if (!def) throw new Error(`Cohort not found: ${cohortId}`);

    const members = this.resolveCohortMembers(cohortId);
    if (members.length === 0) {
      return {
        cohortId,
        cohortName: def.name,
        granularity,
        memberCount: 0,
        rows: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const userIds = new Set(members.map((m) => m.userId));
    const cohortStart = Math.min(...members.map((m) => m.signUpDate));
    const gMs = granularityMs(granularity);

    const activityByUser = new Map<string, number[]>();
    for (const a of this.activities) {
      if (!userIds.has(a.userId)) continue;
      if (!activityByUser.has(a.userId)) activityByUser.set(a.userId, []);
      activityByUser.get(a.userId)!.push(a.timestamp);
    }

    const rows: RetentionRow[] = [];
    for (let p = 0; p < periods; p++) {
      const windowStart = cohortStart + p * gMs;
      const windowEnd = windowStart + gMs;

      let active = 0;
      for (const [, timestamps] of activityByUser) {
        if (timestamps.some((t) => t >= windowStart && t < windowEnd)) {
          active++;
        }
      }

      rows.push({
        periodIndex: p,
        periodLabel: periodLabel(granularity, p),
        totalMembers: members.length,
        activeMembers: active,
        retentionRate: parseFloat(((active / members.length) * 100).toFixed(2)),
      });
    }

    return {
      cohortId,
      cohortName: def.name,
      granularity,
      memberCount: members.length,
      rows,
      generatedAt: new Date().toISOString(),
    };
  }

  revenueAnalysis(cohortId: string, granularity: CohortGranularity, periods = 12): RevenueReport {
    const def = this.cohorts.get(cohortId);
    if (!def) throw new Error(`Cohort not found: ${cohortId}`);

    const members = this.resolveCohortMembers(cohortId);
    const userIds = new Set(members.map((m) => m.userId));
    const cohortStart = members.length > 0 ? Math.min(...members.map((m) => m.signUpDate)) : Date.now();
    const gMs = granularityMs(granularity);

    const revenueActivities = this.activities.filter(
      (a) => userIds.has(a.userId) && a.revenue !== undefined && a.revenue > 0,
    );

    let cumulative = 0;
    const rows: RevenueRow[] = [];
    for (let p = 0; p < periods; p++) {
      const windowStart = cohortStart + p * gMs;
      const windowEnd = windowStart + gMs;

      const periodRevenue = revenueActivities
        .filter((a) => a.timestamp >= windowStart && a.timestamp < windowEnd)
        .reduce((sum, a) => sum + (a.revenue ?? 0), 0);

      cumulative += periodRevenue;
      rows.push({
        periodIndex: p,
        periodLabel: periodLabel(granularity, p),
        totalRevenue: parseFloat(periodRevenue.toFixed(2)),
        avgRevenuePerMember: members.length > 0 ? parseFloat((periodRevenue / members.length).toFixed(2)) : 0,
        cumulativeRevenue: parseFloat(cumulative.toFixed(2)),
      });
    }

    const totalLifetimeRevenue = parseFloat(cumulative.toFixed(2));
    return {
      cohortId,
      cohortName: def.name,
      memberCount: members.length,
      rows,
      totalLifetimeRevenue,
      avgLTV: members.length > 0 ? parseFloat((totalLifetimeRevenue / members.length).toFixed(2)) : 0,
      generatedAt: new Date().toISOString(),
    };
  }

  featureAdoption(cohortId: string, features: string[]): FeatureAdoptionRow[] {
    const members = this.resolveCohortMembers(cohortId);
    const userIds = new Set(members.map((m) => m.userId));
    const signUpMap = new Map(members.map((m) => [m.userId, m.signUpDate]));

    return features.map((feature) => {
      const adopters = new Map<string, number>();
      for (const a of this.activities) {
        if (a.event === feature && userIds.has(a.userId) && !adopters.has(a.userId)) {
          adopters.set(a.userId, a.timestamp);
        }
      }

      const timesToAdopt: number[] = [];
      for (const [uid, ts] of adopters) {
        const signUp = signUpMap.get(uid);
        if (signUp !== undefined) {
          timesToAdopt.push(ts - signUp);
        }
      }

      const avgTime = timesToAdopt.length > 0
        ? timesToAdopt.reduce((s, v) => s + v, 0) / timesToAdopt.length
        : 0;

      return {
        feature,
        adopters: adopters.size,
        adoptionRate: members.length > 0 ? parseFloat(((adopters.size / members.length) * 100).toFixed(2)) : 0,
        avgTimeToAdoptMs: Math.round(avgTime),
      };
    });
  }

  churnRate(cohortId: string, granularity: CohortGranularity, periods = 12): { periodIndex: number; churnRate: number }[] {
    const retention = this.retentionAnalysis(cohortId, granularity, periods);
    const result: { periodIndex: number; churnRate: number }[] = [];

    for (let i = 0; i < retention.rows.length; i++) {
      if (i === 0) {
        result.push({ periodIndex: 0, churnRate: parseFloat((100 - retention.rows[0].retentionRate).toFixed(2)) });
      } else {
        const prev = retention.rows[i - 1].activeMembers;
        const curr = retention.rows[i].activeMembers;
        const churned = prev > 0 ? ((prev - curr) / prev) * 100 : 0;
        result.push({ periodIndex: i, churnRate: parseFloat(Math.max(0, churned).toFixed(2)) });
      }
    }

    return result;
  }

  estimateLTV(cohortId: string, granularity: CohortGranularity, periods = 12): number {
    const revenue = this.revenueAnalysis(cohortId, granularity, periods);
    return revenue.avgLTV;
  }

  cohortHealthScore(cohortId: string): CohortHealthScore {
    const retention = this.retentionAnalysis(cohortId, 'month', 3);
    const revenue = this.revenueAnalysis(cohortId, 'month', 3);

    // Retention score: average retention across periods
    const avgRetention = retention.rows.length > 0
      ? retention.rows.reduce((s, r) => s + r.retentionRate, 0) / retention.rows.length
      : 0;
    const retentionScore = clamp01(avgRetention / 100);

    // Revenue score: normalized by member count, capped at $100/member as 1.0
    const avgRev = revenue.memberCount > 0 ? revenue.totalLifetimeRevenue / revenue.memberCount : 0;
    const revenueScore = clamp01(avgRev / 100);

    // Engagement score: activity count per member
    const members = this.resolveCohortMembers(cohortId);
    const userIds = new Set(members.map((m) => m.userId));
    const activityCount = this.activities.filter((a) => userIds.has(a.userId)).length;
    const actPerMember = members.length > 0 ? activityCount / members.length : 0;
    const engagementScore = clamp01(actPerMember / 50);

    const overallScore = parseFloat(
      (retentionScore * 0.4 + revenueScore * 0.3 + engagementScore * 0.3).toFixed(3),
    );

    let grade: CohortHealthScore['grade'];
    if (overallScore >= 0.8) grade = 'A';
    else if (overallScore >= 0.6) grade = 'B';
    else if (overallScore >= 0.4) grade = 'C';
    else if (overallScore >= 0.2) grade = 'D';
    else grade = 'F';

    return {
      cohortId,
      retentionScore: parseFloat(retentionScore.toFixed(3)),
      revenueScore: parseFloat(revenueScore.toFixed(3)),
      engagementScore: parseFloat(engagementScore.toFixed(3)),
      overallScore,
      grade,
    };
  }

  compareCohorts(cohortIdA: string, cohortIdB: string): CohortComparisonMetric[] {
    const retA = this.retentionAnalysis(cohortIdA, 'month', 6);
    const retB = this.retentionAnalysis(cohortIdB, 'month', 6);
    const revA = this.revenueAnalysis(cohortIdA, 'month', 6);
    const revB = this.revenueAnalysis(cohortIdB, 'month', 6);
    const healthA = this.cohortHealthScore(cohortIdA);
    const healthB = this.cohortHealthScore(cohortIdB);

    const metrics: CohortComparisonMetric[] = [];

    const addMetric = (metric: string, a: number, b: number) => {
      metrics.push({
        metric,
        cohortA: a,
        cohortB: b,
        delta: parseFloat((b - a).toFixed(2)),
        deltaPercent: a !== 0 ? parseFloat((((b - a) / Math.abs(a)) * 100).toFixed(2)) : 0,
      });
    };

    const avgRetA = retA.rows.length > 0 ? retA.rows.reduce((s, r) => s + r.retentionRate, 0) / retA.rows.length : 0;
    const avgRetB = retB.rows.length > 0 ? retB.rows.reduce((s, r) => s + r.retentionRate, 0) / retB.rows.length : 0;
    addMetric('avgRetentionRate', avgRetA, avgRetB);
    addMetric('memberCount', retA.memberCount, retB.memberCount);
    addMetric('totalRevenue', revA.totalLifetimeRevenue, revB.totalLifetimeRevenue);
    addMetric('avgLTV', revA.avgLTV, revB.avgLTV);
    addMetric('healthScore', healthA.overallScore, healthB.overallScore);

    return metrics;
  }

  getMemberCount(cohortId: string): number {
    return this.resolveCohortMembers(cohortId).length;
  }

  clearActivities(): void {
    this.activities = [];
    logger.info('Cohort activities cleared');
  }
}

// --- Singleton ---

const GLOBAL_KEY = '__cohortAnalysisEngine__';

export function getCohortAnalysisEngine(): CohortAnalysisEngine {
  const g = globalThis as unknown as Record<string, CohortAnalysisEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CohortAnalysisEngine();
  }
  return g[GLOBAL_KEY];
}

export type {
  CohortDefinition,
  CohortCriteria,
  CohortMember,
  CohortActivity,
  CohortGranularity,
  RetentionReport,
  RetentionRow,
  RevenueReport,
  RevenueRow,
  FeatureAdoptionRow,
  CohortHealthScore,
  CohortComparisonMetric,
};
