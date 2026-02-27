/**
 * @module customerJourneyMapper
 * @description Customer journey mapping and multi-touch attribution engine. Tracks
 * user touchpoints across channels, reconstructs journeys, analyzes funnel dropoffs,
 * and computes revenue attribution using first-touch, last-touch, linear, time-decay,
 * and data-driven models. Provides journey optimization recommendations.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface TouchPoint {
  id: string;
  userId: string;
  channel: 'organic_search' | 'paid_search' | 'email' | 'social' | 'direct' | 'referral' | 'display' | 'affiliate';
  action: string;
  page?: string;
  campaign?: string;
  timestamp: Date;
  sessionId: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  metadata: Record<string, unknown>;
}

export interface JourneyStage {
  name: string;
  order: number;
  actions: string[];
  avgTimeInStageMs: number;
  conversionRate: number;
  dropoffRate: number;
}

export interface CustomerJourney {
  id: string;
  userId: string;
  touchPoints: TouchPoint[];
  stages: JourneyStage[];
  startedAt: Date;
  convertedAt?: Date;
  converted: boolean;
  totalValue: number;
  channelSequence: string[];
  duration: number;
  touchCount: number;
}

export interface AttributionModel {
  type: 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'data_driven';
  decayHalfLifeHours?: number;
  customWeights?: Record<string, number>;
}

export interface AttributionResult {
  journeyId: string;
  model: AttributionModel['type'];
  channelCredits: Record<string, number>;
  totalValue: number;
  computedAt: Date;
}

export interface ConversionFunnel {
  id: string;
  name: string;
  stages: JourneyStage[];
  totalEntries: number;
  totalConversions: number;
  overallConversionRate: number;
  avgJourneyDurationMs: number;
  revenue: number;
}

export interface DropoffAnalysis {
  funnelId: string;
  stageDropoffs: Array<{
    stageName: string;
    stageOrder: number;
    dropoffCount: number;
    dropoffRate: number;
    topExitChannels: string[];
    avgTimeBeforeDropoff: number;
  }>;
  criticalStage: string;
  recoveryOpportunities: string[];
}

export interface JourneyInsight {
  type: 'channel_efficiency' | 'path_optimization' | 'timing_pattern' | 'device_shift' | 'campaign_impact';
  description: string;
  affectedSegment: string;
  confidenceScore: number;
  estimatedImpact: number;
  recommendedAction: string;
}

export interface JourneyOptimization {
  funnelId: string;
  currentConversionRate: number;
  projectedConversionRate: number;
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    stage: string;
    expectedLift: number;
    effort: 'low' | 'medium' | 'high';
  }>;
}

export interface JourneyReport {
  userId: string;
  journey: CustomerJourney;
  attribution: AttributionResult;
  insights: JourneyInsight[];
  generatedAt: Date;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────
interface JourneyStore {
  touchpoints: Map<string, TouchPoint[]>;
  journeys:    Map<string, CustomerJourney>;
  funnels:     Map<string, ConversionFunnel>;
  attributions: Map<string, AttributionResult[]>;
}

export class CustomerJourneyMapper {
  private store: JourneyStore = {
    touchpoints:  new Map(),
    journeys:     new Map(),
    funnels:      new Map(),
    attributions: new Map(),
  };

  private readonly stageConfig: JourneyStage[] = [
    { name: 'awareness',     order: 0, actions: ['view', 'impression', 'visit'],       avgTimeInStageMs: 0,       conversionRate: 0.40, dropoffRate: 0.60 },
    { name: 'consideration', order: 1, actions: ['click', 'read', 'compare', 'search'], avgTimeInStageMs: 3_600_000, conversionRate: 0.35, dropoffRate: 0.65 },
    { name: 'intent',        order: 2, actions: ['signup', 'trial', 'demo_request'],   avgTimeInStageMs: 86_400_000, conversionRate: 0.50, dropoffRate: 0.50 },
    { name: 'purchase',      order: 3, actions: ['checkout', 'subscribe', 'buy'],      avgTimeInStageMs: 1_800_000, conversionRate: 0.70, dropoffRate: 0.30 },
    { name: 'retention',     order: 4, actions: ['login', 'use', 'upgrade', 'renew'],  avgTimeInStageMs: 0,       conversionRate: 0.85, dropoffRate: 0.15 },
  ];

  trackTouchpoint(userId: string, touchpoint: TouchPoint): void {
    const list = this.store.touchpoints.get(userId) ?? [];
    list.push(touchpoint);
    list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    this.store.touchpoints.set(userId, list);
    logger.debug('Touchpoint recorded', { userId, channel: touchpoint.channel, action: touchpoint.action });
  }

  buildJourney(userId: string): CustomerJourney {
    const tps = this.store.touchpoints.get(userId) ?? [];
    if (tps.length === 0) {
      throw new Error(`No touchpoints found for user ${userId}`);
    }

    const stages    = this.classifyStages(tps);
    const converted = tps.some(tp => ['checkout', 'subscribe', 'buy'].includes(tp.action));
    const convTP    = tps.find(tp => ['checkout', 'subscribe', 'buy'].includes(tp.action));
    const totalValue = converted ? this.estimateValue(tps) : 0;
    const start     = tps[0].timestamp;
    const end       = tps[tps.length - 1].timestamp;

    const journey: CustomerJourney = {
      id:            `j_${userId}_${Date.now()}`,
      userId,
      touchPoints:   tps,
      stages,
      startedAt:     start,
      convertedAt:   convTP?.timestamp,
      converted,
      totalValue,
      channelSequence: [...new Set(tps.map(tp => tp.channel))],
      duration:        end.getTime() - start.getTime(),
      touchCount:      tps.length,
    };

    this.store.journeys.set(journey.id, journey);
    logger.info('Journey built', { userId, journeyId: journey.id, converted, touchCount: tps.length });
    return journey;
  }

  private classifyStages(tps: TouchPoint[]): JourneyStage[] {
    const active = new Map<string, JourneyStage>();
    for (const tp of tps) {
      for (const stage of this.stageConfig) {
        if (stage.actions.includes(tp.action)) {
          active.set(stage.name, stage);
        }
      }
    }
    return Array.from(active.values()).sort((a, b) => a.order - b.order);
  }

  private estimateValue(tps: TouchPoint[]): number {
    const channels = tps.map(tp => tp.channel);
    let value = 100;
    if (channels.includes('paid_search'))  value += 20;
    if (channels.includes('email'))        value += 15;
    if (channels.includes('referral'))     value += 10;
    if (tps.length > 5)                    value += tps.length * 2;
    return Math.round(value);
  }

  analyzeDropoffs(funnelId: string): DropoffAnalysis {
    const funnel = this.store.funnels.get(funnelId);
    const journeys = Array.from(this.store.journeys.values());

    const stageDropoffs = this.stageConfig.map(stage => {
      const entered   = journeys.filter(j => j.stages.some(s => s.name === stage.name));
      const nextStage = this.stageConfig.find(s => s.order === stage.order + 1);
      const advanced  = nextStage
        ? journeys.filter(j => j.stages.some(s => s.name === nextStage.name))
        : entered;
      const dropped   = entered.length - advanced.length;
      const allTps: TouchPoint[] = [];
      for (const j of journeys) allTps.push(...j.touchPoints);
      const tpsAtStage = allTps.filter((tp: TouchPoint) => stage.actions.includes(tp.action));
      const exitChannels: Record<string, number> = {};
      for (const tp of tpsAtStage) exitChannels[tp.channel] = (exitChannels[tp.channel] ?? 0) + 1;
      const topChannels = Object.entries(exitChannels)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

      return {
        stageName:           stage.name,
        stageOrder:          stage.order,
        dropoffCount:        Math.max(0, dropped),
        dropoffRate:         entered.length > 0 ? dropped / entered.length : 0,
        topExitChannels:     topChannels,
        avgTimeBeforeDropoff: stage.avgTimeInStageMs,
      };
    });

    const criticalStage = stageDropoffs
      .sort((a, b) => b.dropoffRate - a.dropoffRate)[0]?.stageName ?? 'unknown';

    const funnelName = funnel?.name ?? funnelId;
    logger.info('Dropoff analysis complete', { funnelId: funnelName, criticalStage });

    return {
      funnelId,
      stageDropoffs,
      criticalStage,
      recoveryOpportunities: [
        `Add retargeting ads at ${criticalStage} stage`,
        'Send re-engagement email 24h after dropoff',
        'Offer time-limited discount for abandoned carts',
      ],
    };
  }

  computeAttribution(journeyId: string, model: AttributionModel): AttributionResult {
    const journey = this.store.journeys.get(journeyId);
    if (!journey) throw new Error(`Journey ${journeyId} not found`);

    const tps = journey.touchPoints;
    const credits: Record<string, number> = {};

    if (tps.length === 0) {
      return { journeyId, model: model.type, channelCredits: {}, totalValue: 0, computedAt: new Date() };
    }

    switch (model.type) {
      case 'first_touch':
        credits[tps[0].channel] = journey.totalValue;
        break;
      case 'last_touch':
        credits[tps[tps.length - 1].channel] = journey.totalValue;
        break;
      case 'linear': {
        const share = journey.totalValue / tps.length;
        for (const tp of tps) credits[tp.channel] = (credits[tp.channel] ?? 0) + share;
        break;
      }
      case 'time_decay': {
        const halfLife = (model.decayHalfLifeHours ?? 12) * 3_600_000;
        const lastTs   = tps[tps.length - 1].timestamp.getTime();
        const weights  = tps.map(tp => Math.pow(2, -(lastTs - tp.timestamp.getTime()) / halfLife));
        const sumW     = weights.reduce((a, b) => a + b, 0);
        tps.forEach((tp, i) => {
          credits[tp.channel] = (credits[tp.channel] ?? 0) + (weights[i] / sumW) * journey.totalValue;
        });
        break;
      }
      case 'data_driven': {
        const channelCounts: Record<string, number> = {};
        for (const tp of tps) channelCounts[tp.channel] = (channelCounts[tp.channel] ?? 0) + 1;
        const convRate: Record<string, number> = {
          email: 0.18, paid_search: 0.15, organic_search: 0.12,
          referral: 0.14, social: 0.08, direct: 0.20, display: 0.06, affiliate: 0.10,
        };
        const totalScore = Object.keys(channelCounts).reduce(
          (s, ch) => s + channelCounts[ch] * (convRate[ch] ?? 0.1), 0
        );
        for (const ch of Object.keys(channelCounts)) {
          credits[ch] = ((channelCounts[ch] * (convRate[ch] ?? 0.1)) / totalScore) * journey.totalValue;
        }
        break;
      }
    }

    const result: AttributionResult = {
      journeyId, model: model.type, channelCredits: credits,
      totalValue: journey.totalValue, computedAt: new Date(),
    };
    const existing = this.store.attributions.get(journeyId) ?? [];
    existing.push(result);
    this.store.attributions.set(journeyId, existing);
    return result;
  }

  generateInsights(journeys: CustomerJourney[]): JourneyInsight[] {
    const insights: JourneyInsight[] = [];

    // Channel efficiency
    const channelConv: Record<string, { conv: number; total: number }> = {};
    for (const j of journeys) {
      for (const ch of j.channelSequence) {
        if (!channelConv[ch]) channelConv[ch] = { conv: 0, total: 0 };
        channelConv[ch].total++;
        if (j.converted) channelConv[ch].conv++;
      }
    }
    for (const [ch, data] of Object.entries(channelConv)) {
      const rate = data.total > 0 ? data.conv / data.total : 0;
      if (rate > 0.3) {
        insights.push({
          type: 'channel_efficiency', description: `${ch} shows high conversion rate of ${(rate * 100).toFixed(1)}%`,
          affectedSegment: ch, confidenceScore: Math.min(0.95, data.total / 100),
          estimatedImpact: rate * 1000, recommendedAction: `Increase budget allocation to ${ch}`,
        });
      }
    }

    // Timing patterns
    const hourCounts: Record<number, number> = {};
    for (const j of journeys.filter(j => j.converted)) {
      const hr = j.convertedAt?.getHours() ?? 0;
      hourCounts[hr] = (hourCounts[hr] ?? 0) + 1;
    }
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
      insights.push({
        type: 'timing_pattern', description: `Conversions peak at hour ${peakHour[0]}`,
        affectedSegment: 'all_users', confidenceScore: 0.78, estimatedImpact: 500,
        recommendedAction: `Schedule campaigns to target users around hour ${peakHour[0]}`,
      });
    }

    // Multi-touch paths
    const pathCounts: Record<string, number> = {};
    for (const j of journeys.filter(j => j.converted)) {
      const path = j.channelSequence.join(' -> ');
      pathCounts[path] = (pathCounts[path] ?? 0) + 1;
    }
    const topPath = Object.entries(pathCounts).sort((a, b) => b[1] - a[1])[0];
    if (topPath) {
      insights.push({
        type: 'path_optimization', description: `Top converting path: ${topPath[0]} (${topPath[1]} conversions)`,
        affectedSegment: 'converters', confidenceScore: 0.85, estimatedImpact: topPath[1] * 100,
        recommendedAction: 'Replicate this channel sequence in campaign orchestration',
      });
    }

    logger.info('Journey insights generated', { count: insights.length, journeyCount: journeys.length });
    return insights;
  }

  optimizeJourney(funnelId: string): JourneyOptimization {
    const dropoffs = this.analyzeDropoffs(funnelId);
    const funnel   = this.store.funnels.get(funnelId);
    const currentRate = funnel?.overallConversionRate ?? 0.05;

    const recs: JourneyOptimization['recommendations'] = dropoffs.stageDropoffs
      .filter(d => d.dropoffRate > 0.4)
      .map(d => ({
        priority: d.dropoffRate > 0.6 ? 'high' : 'medium' as 'high' | 'medium',
        action:   `Reduce friction at ${d.stageName} with simplified UX and targeted messaging`,
        stage:    d.stageName,
        expectedLift: Math.round(d.dropoffRate * 15),
        effort:   d.stageName === 'purchase' ? 'medium' : 'low' as 'medium' | 'low',
      }));

    const projectedRate = Math.min(1, currentRate + recs.reduce((s, r) => s + r.expectedLift / 1000, 0));
    return { funnelId, currentConversionRate: currentRate, projectedConversionRate: projectedRate, recommendations: recs };
  }

  forecastConversions(segment: string): Record<string, number> {
    const journeys = Array.from(this.store.journeys.values());
    const converted = journeys.filter(j => j.converted).length;
    const rate      = journeys.length > 0 ? converted / journeys.length : 0.05;
    const forecast: Record<string, number> = {};
    for (let d = 1; d <= 30; d++) {
      const growth = 1 + (d / 30) * 0.1;
      forecast[`day_${d}`] = Math.round(rate * 1000 * growth);
    }
    logger.debug('Conversion forecast generated', { segment, baseRate: rate });
    return forecast;
  }

  exportJourneyReport(userId: string): JourneyReport {
    const journey = this.buildJourney(userId);
    const attribution = this.computeAttribution(journey.id, { type: 'data_driven' });
    const allJourneys = Array.from(this.store.journeys.values());
    const insights = this.generateInsights(allJourneys);
    return { userId, journey, attribution, insights: insights.slice(0, 5), generatedAt: new Date() };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getCustomerJourneyMapper(): CustomerJourneyMapper {
  if (!(globalThis as Record<string, unknown>).__customerJourneyMapper__) {
    (globalThis as Record<string, unknown>).__customerJourneyMapper__ = new CustomerJourneyMapper();
  }
  return (globalThis as Record<string, unknown>).__customerJourneyMapper__ as CustomerJourneyMapper;
}
