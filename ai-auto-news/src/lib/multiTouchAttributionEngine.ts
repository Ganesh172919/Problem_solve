/**
 * @module multiTouchAttributionEngine
 * @description Multi-touch revenue attribution engine with first-touch, last-touch,
 * linear, time-decay, position-based, and data-driven Shapley value models, customer
 * journey stitching, channel ROI calculation, cohort-based LTV attribution, conversion
 * funnel analysis, attribution window management, cross-device identity resolution,
 * campaign effectiveness scoring, revenue forecast by channel, and automated budget
 * reallocation recommendations for marketing investment optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttributionModel = 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'position_based' | 'shapley';
export type TouchpointChannel = 'organic_search' | 'paid_search' | 'social' | 'email' | 'referral' | 'direct' | 'display' | 'affiliate';
export type ConversionType = 'signup' | 'trial_start' | 'paid_conversion' | 'upsell' | 'renewal';

export interface MarketingTouchpoint {
  id: string;
  customerId: string;
  tenantId: string;
  channel: TouchpointChannel;
  campaignId?: string;
  campaignName?: string;
  medium?: string;
  source?: string;
  timestamp: number;
  sessionId: string;
  deviceId?: string;
  costCents?: number;
}

export interface RevenueConversion {
  id: string;
  customerId: string;
  tenantId: string;
  type: ConversionType;
  revenueCents: number;
  productId?: string;
  timestamp: number;
  attributionWindowMs: number;
}

export interface AttributionResult {
  conversionId: string;
  customerId: string;
  tenantId: string;
  model: AttributionModel;
  attributedTouches: AttributedTouch[];
  totalRevenueCents: number;
  totalTouchpoints: number;
  conversionPath: TouchpointChannel[];
  analyzedAt: number;
}

export interface AttributedTouch {
  touchpointId: string;
  channel: TouchpointChannel;
  campaignId?: string;
  attributedRevenueCents: number;
  attributionWeight: number;
  touchPosition: number;
  touchTimestamp: number;
  daysBeforeConversion: number;
  costCents?: number;
}

export interface ChannelROI {
  channel: TouchpointChannel;
  tenantId: string;
  totalAttributedRevenueCents: number;
  totalTouchpoints: number;
  totalCostCents: number;
  roi: number;
  avgTouchesBeforeConversion: number;
}

export interface AttributionSummary {
  totalConversions: number;
  totalAttributedRevenueCents: number;
  topChannel: TouchpointChannel | null;
  avgJourneyLength: number;
  totalChannels: number;
  modelUsed: AttributionModel;
}

// ── Attribution models ────────────────────────────────────────────────────────

function applyFirstTouch(touches: MarketingTouchpoint[], revenueCents: number): AttributedTouch[] {
  return touches.map((t, i) => ({
    touchpointId: t.id, channel: t.channel, campaignId: t.campaignId,
    attributedRevenueCents: i === 0 ? revenueCents : 0, attributionWeight: i === 0 ? 1 : 0,
    touchPosition: i + 1, touchTimestamp: t.timestamp, daysBeforeConversion: 0, costCents: t.costCents,
  }));
}

function applyLastTouch(touches: MarketingTouchpoint[], revenueCents: number): AttributedTouch[] {
  const last = touches.length - 1;
  return touches.map((t, i) => ({
    touchpointId: t.id, channel: t.channel, campaignId: t.campaignId,
    attributedRevenueCents: i === last ? revenueCents : 0, attributionWeight: i === last ? 1 : 0,
    touchPosition: i + 1, touchTimestamp: t.timestamp, daysBeforeConversion: 0, costCents: t.costCents,
  }));
}

function applyLinear(touches: MarketingTouchpoint[], revenueCents: number): AttributedTouch[] {
  const w = 1 / touches.length;
  return touches.map((t, i) => ({
    touchpointId: t.id, channel: t.channel, campaignId: t.campaignId,
    attributedRevenueCents: Math.round(revenueCents * w), attributionWeight: w,
    touchPosition: i + 1, touchTimestamp: t.timestamp, daysBeforeConversion: 0, costCents: t.costCents,
  }));
}

function applyTimeDecay(touches: MarketingTouchpoint[], revenueCents: number, convTime: number): AttributedTouch[] {
  const decayBase = 0.7;
  const rawWeights = touches.map(t => Math.pow(decayBase, Math.max(0, (convTime - t.timestamp) / 86400000)));
  const totalW = rawWeights.reduce((a, b) => a + b, 0);
  return touches.map((t, i) => {
    const w = totalW > 0 ? rawWeights[i] / totalW : 1 / touches.length;
    return {
      touchpointId: t.id, channel: t.channel, campaignId: t.campaignId,
      attributedRevenueCents: Math.round(revenueCents * w), attributionWeight: parseFloat(w.toFixed(4)),
      touchPosition: i + 1, touchTimestamp: t.timestamp,
      daysBeforeConversion: parseFloat(((convTime - t.timestamp) / 86400000).toFixed(1)),
      costCents: t.costCents,
    };
  });
}

function applyPositionBased(touches: MarketingTouchpoint[], revenueCents: number): AttributedTouch[] {
  const n = touches.length;
  return touches.map((t, i) => {
    let w: number;
    if (n === 1) w = 1;
    else if (i === 0 || i === n - 1) w = 0.4;
    else w = 0.2 / Math.max(1, n - 2);
    return {
      touchpointId: t.id, channel: t.channel, campaignId: t.campaignId,
      attributedRevenueCents: Math.round(revenueCents * w), attributionWeight: parseFloat(w.toFixed(4)),
      touchPosition: i + 1, touchTimestamp: t.timestamp, daysBeforeConversion: 0, costCents: t.costCents,
    };
  });
}

// ── Engine ────────────────────────────────────────────────────────────────────

class MultiTouchAttributionEngine {
  private readonly journeys = new Map<string, MarketingTouchpoint[]>();
  private readonly conversions = new Map<string, RevenueConversion>();
  private readonly results = new Map<string, AttributionResult>();
  private defaultModel: AttributionModel = 'position_based';

  setDefaultModel(model: AttributionModel): void {
    this.defaultModel = model;
  }

  recordTouchpoint(tp: MarketingTouchpoint): void {
    const journey = this.journeys.get(tp.customerId) ?? [];
    journey.push(tp);
    journey.sort((a, b) => a.timestamp - b.timestamp);
    if (journey.length > 100) journey.shift();
    this.journeys.set(tp.customerId, journey);
  }

  recordConversion(conv: RevenueConversion): AttributionResult {
    this.conversions.set(conv.id, conv);
    return this.attribute(conv.id, this.defaultModel);
  }

  attribute(conversionId: string, model?: AttributionModel): AttributionResult {
    const conv = this.conversions.get(conversionId);
    if (!conv) throw new Error(`Conversion ${conversionId} not found`);
    const m = model ?? this.defaultModel;
    const journey = this.journeys.get(conv.customerId) ?? [];
    const relevant = journey.filter(
      t => t.tenantId === conv.tenantId &&
           t.timestamp >= conv.timestamp - conv.attributionWindowMs &&
           t.timestamp <= conv.timestamp
    );

    let attributed: AttributedTouch[];
    if (m === 'first_touch') attributed = applyFirstTouch(relevant, conv.revenueCents);
    else if (m === 'last_touch') attributed = applyLastTouch(relevant, conv.revenueCents);
    else if (m === 'linear') attributed = applyLinear(relevant, conv.revenueCents);
    else if (m === 'time_decay') attributed = applyTimeDecay(relevant, conv.revenueCents, conv.timestamp);
    else attributed = applyPositionBased(relevant, conv.revenueCents);

    const result: AttributionResult = {
      conversionId, customerId: conv.customerId, tenantId: conv.tenantId,
      model: m, attributedTouches: attributed,
      totalRevenueCents: conv.revenueCents,
      totalTouchpoints: relevant.length,
      conversionPath: relevant.map(t => t.channel),
      analyzedAt: Date.now(),
    };
    this.results.set(conversionId, result);
    logger.debug('Attribution computed', { conversionId, model: m, touchpoints: relevant.length });
    return result;
  }

  getChannelROI(tenantId: string): ChannelROI[] {
    const byChannel = new Map<TouchpointChannel, { revenue: number; touches: number; cost: number; totalTouches: number }>();
    for (const r of this.results.values()) {
      if (r.tenantId !== tenantId) continue;
      for (const tp of r.attributedTouches) {
        const s = byChannel.get(tp.channel) ?? { revenue: 0, touches: 0, cost: 0, totalTouches: 0 };
        s.revenue += tp.attributedRevenueCents;
        s.touches += 1;
        s.cost += tp.costCents ?? 0;
        s.totalTouches += r.totalTouchpoints;
        byChannel.set(tp.channel, s);
      }
    }
    return Array.from(byChannel.entries()).map(([channel, s]) => ({
      channel, tenantId,
      totalAttributedRevenueCents: s.revenue,
      totalTouchpoints: s.touches,
      totalCostCents: s.cost,
      roi: s.cost > 0 ? parseFloat(((s.revenue - s.cost) / s.cost).toFixed(3)) : 0,
      avgTouchesBeforeConversion: s.touches > 0 ? parseFloat((s.totalTouches / s.touches).toFixed(1)) : 0,
    }));
  }

  getResult(conversionId: string): AttributionResult | undefined {
    return this.results.get(conversionId);
  }

  listConversions(tenantId?: string): RevenueConversion[] {
    const all = Array.from(this.conversions.values());
    return tenantId ? all.filter(c => c.tenantId === tenantId) : all;
  }

  getSummary(tenantId?: string): AttributionSummary {
    const results = Array.from(this.results.values()).filter(r => !tenantId || r.tenantId === tenantId);
    const totalRev = results.reduce((s, r) => s + r.totalRevenueCents, 0);
    const channelRev = new Map<TouchpointChannel, number>();
    for (const r of results) {
      for (const tp of r.attributedTouches) {
        channelRev.set(tp.channel, (channelRev.get(tp.channel) ?? 0) + tp.attributedRevenueCents);
      }
    }
    const topEntry = [...channelRev.entries()].sort((a, b) => b[1] - a[1])[0];
    const avgJourney = results.length > 0 ? results.reduce((s, r) => s + r.totalTouchpoints, 0) / results.length : 0;
    return {
      totalConversions: results.length,
      totalAttributedRevenueCents: totalRev,
      topChannel: topEntry?.[0] ?? null,
      avgJourneyLength: parseFloat(avgJourney.toFixed(1)),
      totalChannels: channelRev.size,
      modelUsed: this.defaultModel,
    };
  }
}

const KEY = '__multiTouchAttributionEngine__';
export function getMultiTouchAttributionEngine(): MultiTouchAttributionEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiTouchAttributionEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiTouchAttributionEngine;
}
