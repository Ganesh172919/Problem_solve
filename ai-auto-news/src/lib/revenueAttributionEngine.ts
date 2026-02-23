import { logger } from '@/lib/logger';
import { TIER_LIMITS } from '@/lib/config';
import { SubscriptionTier } from '@/types/saas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionSource = 'organic' | 'referral' | 'campaign' | 'api' | 'direct' | 'partner';

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear' | 'time_decay';

export interface TouchPoint {
  id: string;
  userId: string;
  source: AttributionSource;
  campaign: string | null;
  channel: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface RevenueEvent {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  amount: number;
  type: RevenueEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export type RevenueEventType = 'new' | 'expansion' | 'contraction' | 'churn' | 'reactivation';

export interface AttributionResult {
  revenueEventId: string;
  userId: string;
  totalRevenue: number;
  model: AttributionModel;
  attributions: SourceAttribution[];
  calculatedAt: string;
}

export interface SourceAttribution {
  source: AttributionSource;
  campaign: string | null;
  channel: string;
  weight: number;
  attributedRevenue: number;
  touchPointId: string;
}

export interface ChannelROI {
  channel: string;
  source: AttributionSource;
  totalSpend: number;
  totalRevenue: number;
  roi: number;
  customerCount: number;
}

export interface CohortMetrics {
  cohortId: string;
  period: string;
  userCount: number;
  totalRevenue: number;
  averageRevenue: number;
  retentionRate: number;
  expansionRevenue: number;
  contractionRevenue: number;
  churnRevenue: number;
}

export interface MRRSnapshot {
  date: string;
  mrr: number;
  arr: number;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netNewMrr: number;
  customerCount: number;
}

export interface RevenueAttributionConfig {
  defaultModel: AttributionModel;
  timeDecayHalfLifeDays: number;
  lookbackWindowDays: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RevenueAttributionConfig = {
  defaultModel: 'linear',
  timeDecayHalfLifeDays: 7,
  lookbackWindowDays: 90,
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class RevenueAttributionEngine {
  private touchPoints = new Map<string, TouchPoint[]>(); // userId -> touches
  private revenueEvents: RevenueEvent[] = [];
  private attributionResults: AttributionResult[] = [];
  private channelSpend = new Map<string, number>(); // channel -> spend
  private userTiers = new Map<string, SubscriptionTier>(); // userId -> current tier
  private config: RevenueAttributionConfig;

  constructor(config: Partial<RevenueAttributionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('RevenueAttributionEngine initialized', { config: this.config });
  }

  // ---- touch points -------------------------------------------------------

  recordTouchPoint(
    userId: string,
    source: AttributionSource,
    channel: string,
    campaign: string | null = null,
    metadata: Record<string, unknown> = {},
  ): TouchPoint {
    const tp: TouchPoint = {
      id: generateId('tp'),
      userId,
      source,
      campaign,
      channel,
      timestamp: new Date().toISOString(),
      metadata,
    };

    const existing = this.touchPoints.get(userId) ?? [];
    existing.push(tp);
    this.touchPoints.set(userId, existing);
    logger.info('Touch point recorded', { touchPointId: tp.id, userId, source, channel });
    return tp;
  }

  getTouchPoints(userId: string): TouchPoint[] {
    return this.touchPoints.get(userId) ?? [];
  }

  // ---- revenue events -----------------------------------------------------

  recordRevenueEvent(
    userId: string,
    tier: SubscriptionTier,
    amount: number,
    type: RevenueEventType,
    metadata: Record<string, unknown> = {},
  ): RevenueEvent {
    const event: RevenueEvent = {
      id: generateId('rev'),
      userId,
      tier,
      amount,
      type,
      occurredAt: new Date().toISOString(),
      metadata,
    };

    this.revenueEvents.push(event);
    this.userTiers.set(userId, tier);
    logger.info('Revenue event recorded', { eventId: event.id, userId, type, amount });
    return event;
  }

  // ---- channel spend tracking ---------------------------------------------

  setChannelSpend(channel: string, spend: number): void {
    this.channelSpend.set(channel, spend);
  }

  // ---- attribution models -------------------------------------------------

  attributeRevenue(
    revenueEventId: string,
    model?: AttributionModel,
  ): AttributionResult {
    const event = this.revenueEvents.find((e) => e.id === revenueEventId);
    if (!event) throw new Error(`Revenue event not found: ${revenueEventId}`);

    const effectiveModel = model ?? this.config.defaultModel;
    const touches = this.getRelevantTouchPoints(event.userId, event.occurredAt);

    if (touches.length === 0) {
      const result: AttributionResult = {
        revenueEventId,
        userId: event.userId,
        totalRevenue: event.amount,
        model: effectiveModel,
        attributions: [{
          source: 'direct',
          campaign: null,
          channel: 'unknown',
          weight: 1,
          attributedRevenue: event.amount,
          touchPointId: 'none',
        }],
        calculatedAt: new Date().toISOString(),
      };
      this.attributionResults.push(result);
      return result;
    }

    let weights: number[];
    switch (effectiveModel) {
      case 'first_touch':
        weights = this.firstTouchWeights(touches.length);
        break;
      case 'last_touch':
        weights = this.lastTouchWeights(touches.length);
        break;
      case 'linear':
        weights = this.linearWeights(touches.length);
        break;
      case 'time_decay':
        weights = this.timeDecayWeights(touches, event.occurredAt);
        break;
      default:
        weights = this.linearWeights(touches.length);
    }

    const attributions: SourceAttribution[] = touches.map((tp, i) => ({
      source: tp.source,
      campaign: tp.campaign,
      channel: tp.channel,
      weight: weights[i],
      attributedRevenue: parseFloat((event.amount * weights[i]).toFixed(2)),
      touchPointId: tp.id,
    }));

    // Adjust rounding to ensure attributedRevenue sums to event.amount
    const totalAttr = attributions.reduce((s, a) => s + a.attributedRevenue, 0);
    const diff = parseFloat((event.amount - totalAttr).toFixed(2));
    if (diff !== 0 && attributions.length > 0) {
      attributions[attributions.length - 1].attributedRevenue =
        parseFloat((attributions[attributions.length - 1].attributedRevenue + diff).toFixed(2));
    }

    const result: AttributionResult = {
      revenueEventId,
      userId: event.userId,
      totalRevenue: event.amount,
      model: effectiveModel,
      attributions,
      calculatedAt: new Date().toISOString(),
    };

    this.attributionResults.push(result);
    logger.info('Revenue attributed', { revenueEventId, model: effectiveModel, touchPoints: touches.length });
    return result;
  }

  private getRelevantTouchPoints(userId: string, beforeDate: string): TouchPoint[] {
    const cutoff = new Date(beforeDate);
    cutoff.setDate(cutoff.getDate() - this.config.lookbackWindowDays);

    return (this.touchPoints.get(userId) ?? []).filter(
      (tp) => new Date(tp.timestamp) >= cutoff && new Date(tp.timestamp) <= new Date(beforeDate),
    );
  }

  private firstTouchWeights(count: number): number[] {
    const weights = new Array(count).fill(0);
    weights[0] = 1;
    return weights;
  }

  private lastTouchWeights(count: number): number[] {
    const weights = new Array(count).fill(0);
    weights[count - 1] = 1;
    return weights;
  }

  private linearWeights(count: number): number[] {
    const weight = parseFloat((1 / count).toFixed(6));
    return new Array(count).fill(weight);
  }

  private timeDecayWeights(touches: TouchPoint[], eventDate: string): number[] {
    const eventTime = new Date(eventDate);
    const halfLife = this.config.timeDecayHalfLifeDays;

    const rawWeights = touches.map((tp) => {
      const daysAgo = daysBetween(new Date(tp.timestamp), eventTime);
      return Math.pow(0.5, daysAgo / halfLife);
    });

    const total = rawWeights.reduce((s, w) => s + w, 0);
    return rawWeights.map((w) => parseFloat((w / total).toFixed(6)));
  }

  // ---- channel ROI --------------------------------------------------------

  calculateChannelROI(): ChannelROI[] {
    const channelRevenue = new Map<string, { revenue: number; customers: Set<string> }>();

    for (const result of this.attributionResults) {
      for (const attr of result.attributions) {
        const key = `${attr.source}:${attr.channel}`;
        const existing = channelRevenue.get(key) ?? { revenue: 0, customers: new Set<string>() };
        existing.revenue += attr.attributedRevenue;
        existing.customers.add(result.userId);
        channelRevenue.set(key, existing);
      }
    }

    const roiResults: ChannelROI[] = [];
    for (const [key, data] of channelRevenue) {
      const [source, channel] = key.split(':');
      const spend = this.channelSpend.get(channel) ?? 0;
      roiResults.push({
        channel,
        source: source as AttributionSource,
        totalSpend: spend,
        totalRevenue: parseFloat(data.revenue.toFixed(2)),
        roi: spend > 0 ? parseFloat(((data.revenue - spend) / spend).toFixed(4)) : 0,
        customerCount: data.customers.size,
      });
    }

    logger.info('Channel ROI calculated', { channels: roiResults.length });
    return roiResults;
  }

  // ---- cohort tracking ----------------------------------------------------

  calculateCohortMetrics(periodFormat: 'monthly' | 'weekly' = 'monthly'): CohortMetrics[] {
    const cohorts = new Map<string, { users: Set<string>; events: RevenueEvent[] }>();

    for (const event of this.revenueEvents) {
      const date = new Date(event.occurredAt);
      const period = periodFormat === 'monthly'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : `${date.getFullYear()}-W${String(this.getWeekNumber(date)).padStart(2, '0')}`;

      const existing = cohorts.get(period) ?? { users: new Set(), events: [] };
      existing.users.add(event.userId);
      existing.events.push(event);
      cohorts.set(period, existing);
    }

    const results: CohortMetrics[] = [];
    for (const [period, data] of cohorts) {
      const totalRevenue = data.events.reduce((s, e) => s + e.amount, 0);
      const expansion = data.events.filter((e) => e.type === 'expansion').reduce((s, e) => s + e.amount, 0);
      const contraction = data.events.filter((e) => e.type === 'contraction').reduce((s, e) => s + Math.abs(e.amount), 0);
      const churn = data.events.filter((e) => e.type === 'churn').reduce((s, e) => s + Math.abs(e.amount), 0);
      const activeUsers = data.users.size;
      const churnedUsers = data.events.filter((e) => e.type === 'churn').length;

      results.push({
        cohortId: generateId('coh'),
        period,
        userCount: activeUsers,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        averageRevenue: activeUsers > 0 ? parseFloat((totalRevenue / activeUsers).toFixed(2)) : 0,
        retentionRate: activeUsers > 0 ? parseFloat(((activeUsers - churnedUsers) / activeUsers).toFixed(4)) : 0,
        expansionRevenue: parseFloat(expansion.toFixed(2)),
        contractionRevenue: parseFloat(contraction.toFixed(2)),
        churnRevenue: parseFloat(churn.toFixed(2)),
      });
    }

    logger.info('Cohort metrics calculated', { cohorts: results.length });
    return results;
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  // ---- MRR / ARR ----------------------------------------------------------

  calculateMRRSnapshot(): MRRSnapshot {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentEvents = this.revenueEvents.filter(
      (e) => new Date(e.occurredAt) >= thirtyDaysAgo,
    );

    let newMrr = 0;
    let expansionMrr = 0;
    let contractionMrr = 0;
    let churnMrr = 0;

    for (const event of recentEvents) {
      switch (event.type) {
        case 'new':
        case 'reactivation':
          newMrr += event.amount;
          break;
        case 'expansion':
          expansionMrr += event.amount;
          break;
        case 'contraction':
          contractionMrr += Math.abs(event.amount);
          break;
        case 'churn':
          churnMrr += Math.abs(event.amount);
          break;
      }
    }

    // Calculate total MRR from active user tiers
    let totalMrr = 0;
    for (const tier of this.userTiers.values()) {
      totalMrr += TIER_LIMITS[tier].monthlyPriceUsd;
    }

    const netNewMrr = newMrr + expansionMrr - contractionMrr - churnMrr;

    const snapshot: MRRSnapshot = {
      date: now.toISOString(),
      mrr: parseFloat(totalMrr.toFixed(2)),
      arr: parseFloat((totalMrr * 12).toFixed(2)),
      newMrr: parseFloat(newMrr.toFixed(2)),
      expansionMrr: parseFloat(expansionMrr.toFixed(2)),
      contractionMrr: parseFloat(contractionMrr.toFixed(2)),
      churnMrr: parseFloat(churnMrr.toFixed(2)),
      netNewMrr: parseFloat(netNewMrr.toFixed(2)),
      customerCount: this.userTiers.size,
    };

    logger.info('MRR snapshot calculated', { mrr: snapshot.mrr, arr: snapshot.arr });
    return snapshot;
  }

  // ---- revenue per user ---------------------------------------------------

  calculateRevenuePerUser(): Map<string, number> {
    const userRevenue = new Map<string, number>();
    for (const event of this.revenueEvents) {
      const current = userRevenue.get(event.userId) ?? 0;
      userRevenue.set(event.userId, parseFloat((current + event.amount).toFixed(2)));
    }
    return userRevenue;
  }

  getAverageRevenuePerUser(): number {
    const userRevenue = this.calculateRevenuePerUser();
    if (userRevenue.size === 0) return 0;
    const total = [...userRevenue.values()].reduce((s, v) => s + v, 0);
    return parseFloat((total / userRevenue.size).toFixed(2));
  }

  // ---- expansion / contraction tracking -----------------------------------

  getExpansionContractionSummary(): {
    expansionRevenue: number;
    contractionRevenue: number;
    churnRevenue: number;
    netExpansion: number;
    expansionRate: number;
  } {
    const expansion = this.revenueEvents
      .filter((e) => e.type === 'expansion')
      .reduce((s, e) => s + e.amount, 0);
    const contraction = this.revenueEvents
      .filter((e) => e.type === 'contraction')
      .reduce((s, e) => s + Math.abs(e.amount), 0);
    const churn = this.revenueEvents
      .filter((e) => e.type === 'churn')
      .reduce((s, e) => s + Math.abs(e.amount), 0);

    const totalExistingRevenue = this.revenueEvents
      .filter((e) => e.type === 'new' || e.type === 'reactivation')
      .reduce((s, e) => s + e.amount, 0);

    const netExpansion = expansion - contraction - churn;
    const expansionRate = totalExistingRevenue > 0
      ? parseFloat((netExpansion / totalExistingRevenue).toFixed(4))
      : 0;

    return {
      expansionRevenue: parseFloat(expansion.toFixed(2)),
      contractionRevenue: parseFloat(contraction.toFixed(2)),
      churnRevenue: parseFloat(churn.toFixed(2)),
      netExpansion: parseFloat(netExpansion.toFixed(2)),
      expansionRate,
    };
  }

  // ---- source breakdown ---------------------------------------------------

  getRevenueBySource(): Map<AttributionSource, number> {
    const result = new Map<AttributionSource, number>();
    for (const attr of this.attributionResults) {
      for (const a of attr.attributions) {
        const current = result.get(a.source) ?? 0;
        result.set(a.source, parseFloat((current + a.attributedRevenue).toFixed(2)));
      }
    }
    return result;
  }

  // ---- queries ------------------------------------------------------------

  getRevenueEvents(): RevenueEvent[] {
    return [...this.revenueEvents];
  }

  getAttributionResults(): AttributionResult[] {
    return [...this.attributionResults];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__revenueAttributionEngine__';

export function getRevenueAttributionEngine(
  config?: Partial<RevenueAttributionConfig>,
): RevenueAttributionEngine {
  const g = globalThis as unknown as Record<string, RevenueAttributionEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new RevenueAttributionEngine(config);
  }
  return g[GLOBAL_KEY];
}
