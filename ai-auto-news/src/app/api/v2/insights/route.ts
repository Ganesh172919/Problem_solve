/**
 * Customer Insights API — v2
 *
 * GET  /api/v2/insights  — Returns aggregated customer insights and personas
 * POST /api/v2/insights  — Trigger insight analysis for a specific user or segment
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getCustomerInsightAgent, {
  type BehaviorEvent,
  type BehaviorPattern,
  type SegmentLabel,
  type InsightConfig,
} from '../../../../agents/customerInsightAgent';

const logger = getLogger();
const cache = getCache();

const ALL_SEGMENTS: SegmentLabel[] = ['power-user', 'casual-user', 'at-risk', 'new-user', 'expansion-candidate', 'champion', 'dormant'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface InsightsQueryParams {
  segment?: string;
  userId?: string;
  lookbackDays?: string;
  includePersonas?: string;
  includeJourneys?: string;
  includeChurn?: string;
  page?: string;
  perPage?: string;
}

interface TriggerInsightBody {
  userId?: string;
  segment?: SegmentLabel;
  events?: BehaviorEvent[];
  lookbackDays?: number;
  includeChurnSignals?: boolean;
  includePersonalization?: boolean;
  forceFresh?: boolean;
}

interface AggregatedInsightsResponse {
  success: boolean;
  generatedAt: string;
  summary: {
    totalUsersAnalyzed: number;
    powerUsers: number;
    atRiskUsers: number;
    expansionCandidates: number;
    avgEngagementScore: number;
    churnRiskCount: number;
  };
  personas: PersonaSummary[];
  topInsights: string[];
  actionableRecommendations: string[];
  metadata: {
    lookbackDays: number;
    cachedAt?: string;
    responseTimeMs?: number;
  };
}

interface PersonaSummary {
  id: string;
  name: string;
  segment: SegmentLabel;
  userCount: number;
  avgLtvUsd: number;
  avgMrrUsd: number;
  churnRisk: string;
  keyMotivations: string[];
  painPoints: string[];
  representativeQuote: string;
}

interface TriggerInsightResponse {
  success: boolean;
  analysisId: string;
  scope: 'user' | 'segment' | 'platform';
  userId?: string;
  segment?: string;
  result: {
    behaviorPattern?: BehaviorPatternSummary;
    persona?: PersonaSummary;
    journeyStage?: string;
    churnProbability?: number;
    churnRiskLevel?: string;
    personalizationRecs?: PersonalizationRecSummary[];
    insightReport?: {
      id: string;
      totalUsersAnalyzed: number;
      topInsights: string[];
      recommendations: string[];
    };
  };
  processingTimeMs: number;
  triggeredAt: string;
}

interface BehaviorPatternSummary {
  adoptionScore: number;
  sessionFrequencyPerWeek: number;
  avgSessionDurationMin: number;
  preferredFeatures: string[];
  streakDays: number;
  activationComplete: boolean;
  lastActiveAt: string;
  segment: SegmentLabel;
}

interface PersonalizationRecSummary {
  type: string;
  title: string;
  priority: string;
  channel: string;
  expectedImpact: string;
}

// ── GET /api/v2/insights ──────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const params: InsightsQueryParams = {
      segment: searchParams.get('segment') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      lookbackDays: searchParams.get('lookbackDays') ?? '30',
      includePersonas: searchParams.get('includePersonas') ?? 'true',
      includeJourneys: searchParams.get('includeJourneys') ?? 'false',
      includeChurn: searchParams.get('includeChurn') ?? 'true',
      page: searchParams.get('page') ?? '1',
      perPage: searchParams.get('perPage') ?? '10',
    };

    const lookbackDays = Math.min(90, Math.max(1, parseInt(params.lookbackDays ?? '30', 10) || 30));
    const cacheKey = `api:v2:insights:get:${params.segment ?? 'all'}:${params.userId ?? 'none'}:${lookbackDays}`;

    const cached = await cache.get<AggregatedInsightsResponse>(cacheKey);
    if (cached) {
      logger.debug({ segment: params.segment, userId: params.userId }, 'Returning cached insights');
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT', 'X-Response-Time': `${Date.now() - startMs}ms` },
      });
    }

    const agent = getCustomerInsightAgent();

    // Synthesize representative behavior patterns for aggregated view
    const segments: SegmentLabel[] = params.segment
      ? [params.segment as SegmentLabel]
      : ALL_SEGMENTS;

    const syntheticPatterns: BehaviorPattern[] = generateSyntheticPatterns(segments, lookbackDays);

    const insightReport = await agent.generateInsightReport(syntheticPatterns, {
      lookbackDays,
      includeChurnSignals: params.includeChurn !== 'false',
    });

    const personaSummaries: PersonaSummary[] = insightReport.personas.map(p => ({
      id: p.id,
      name: p.name,
      segment: p.segment,
      userCount: p.userCount,
      avgLtvUsd: p.avgLtvUsd,
      avgMrrUsd: p.avgMrrUsd,
      churnRisk: p.churnRisk,
      keyMotivations: p.keyMotivations,
      painPoints: p.painPoints,
      representativeQuote: p.representativeQuote,
    }));

    const powerUserCount = syntheticPatterns.filter(p => p.adoptionScore >= 80).length;
    const atRiskCount = insightReport.churnSignals.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical').length;
    const expansionCount = syntheticPatterns.filter(p => p.primaryActions.includes('team_member_invited')).length;
    const avgEngagement = Math.round(syntheticPatterns.reduce((s, p) => s + p.adoptionScore, 0) / Math.max(syntheticPatterns.length, 1));

    const response: AggregatedInsightsResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsersAnalyzed: insightReport.totalUsersAnalyzed,
        powerUsers: powerUserCount,
        atRiskUsers: atRiskCount,
        expansionCandidates: expansionCount,
        avgEngagementScore: avgEngagement,
        churnRiskCount: insightReport.churnSignals.length,
      },
      personas: params.includePersonas !== 'false' ? personaSummaries : [],
      topInsights: insightReport.topInsights,
      actionableRecommendations: insightReport.actionableRecommendations,
      metadata: {
        lookbackDays,
        responseTimeMs: Date.now() - startMs,
      },
    };

    await cache.set(cacheKey, response, 3600);
    logger.info({ totalUsers: insightReport.totalUsersAnalyzed, personas: personaSummaries.length, durationMs: Date.now() - startMs }, 'Insights GET complete');

    return NextResponse.json(response, {
      headers: { 'X-Cache': 'MISS', 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error({ error, durationMs: Date.now() - startMs }, 'Insights GET error');
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve customer insights', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── POST /api/v2/insights ─────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    let body: TriggerInsightBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const validationError = validateTriggerBody(body);
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError },
        { status: 400 },
      );
    }

    const agent = getCustomerInsightAgent();
    const analysisId = `insight_${Date.now()}`;
    const config: InsightConfig = {
      userId: body.userId,
      segment: body.segment,
      lookbackDays: body.lookbackDays ?? 30,
      includeChurnSignals: body.includeChurnSignals !== false,
      includePersonalization: body.includePersonalization !== false,
      refreshCacheHours: body.forceFresh ? 0 : undefined,
    };

    let result: TriggerInsightResponse['result'] = {};
    let scope: TriggerInsightResponse['scope'] = 'platform';

    if (body.userId) {
      scope = 'user';
      const events: BehaviorEvent[] = body.events ?? generateSyntheticEvents(body.userId, config.lookbackDays ?? 30);
      const pattern = await agent.analyzeUserBehavior(body.userId, events, config);
      const segLabel = classifySegmentFromPattern(pattern);
      const persona = await agent.generatePersona([pattern], segLabel);
      const journey = await agent.mapJourney(segLabel, [pattern]);

      const churnSignalData = config.includeChurnSignals
        ? await analyzeChurnFromPattern(agent, pattern)
        : undefined;

      const personalizationRecs = config.includePersonalization
        ? await agent.getPersonalizationRecs(body.userId, pattern, persona)
        : undefined;

      const patternSummary: BehaviorPatternSummary = {
        adoptionScore: pattern.adoptionScore,
        sessionFrequencyPerWeek: pattern.sessionFrequencyPerWeek,
        avgSessionDurationMin: pattern.avgSessionDurationMin,
        preferredFeatures: pattern.preferredFeatures,
        streakDays: pattern.streakDays,
        activationComplete: pattern.activationComplete,
        lastActiveAt: pattern.lastActiveAt.toISOString(),
        segment: segLabel,
      };

      result = {
        behaviorPattern: patternSummary,
        persona: {
          id: persona.id,
          name: persona.name,
          segment: persona.segment,
          userCount: persona.userCount,
          avgLtvUsd: persona.avgLtvUsd,
          avgMrrUsd: persona.avgMrrUsd,
          churnRisk: persona.churnRisk,
          keyMotivations: persona.keyMotivations,
          painPoints: persona.painPoints,
          representativeQuote: persona.representativeQuote,
        },
        journeyStage: journey.stages.find(s => s.completionRate > 0.5 && s.dropOffRate < 0.3)?.stage ?? journey.criticalDropOffStage,
        churnProbability: churnSignalData?.churnProbability,
        churnRiskLevel: churnSignalData?.riskLevel,
        personalizationRecs: personalizationRecs?.recommendations.slice(0, 5).map(r => ({
          type: r.type,
          title: r.title,
          priority: r.priority,
          channel: r.channel,
          expectedImpact: r.expectedImpact,
        })),
      };
    } else if (body.segment) {
      scope = 'segment';
      const syntheticPatterns = generateSyntheticPatterns([body.segment], config.lookbackDays ?? 30);
      const persona = await agent.generatePersona(syntheticPatterns, body.segment);
      const journey = await agent.mapJourney(body.segment, syntheticPatterns);

      result = {
        persona: {
          id: persona.id,
          name: persona.name,
          segment: persona.segment,
          userCount: persona.userCount,
          avgLtvUsd: persona.avgLtvUsd,
          avgMrrUsd: persona.avgMrrUsd,
          churnRisk: persona.churnRisk,
          keyMotivations: persona.keyMotivations,
          painPoints: persona.painPoints,
          representativeQuote: persona.representativeQuote,
        },
        journeyStage: journey.criticalDropOffStage,
      };
    } else {
      scope = 'platform';
      const patterns = generateSyntheticPatterns(ALL_SEGMENTS, config.lookbackDays ?? 30);
      const report = await agent.generateInsightReport(patterns, config);

      result = {
        insightReport: {
          id: report.id,
          totalUsersAnalyzed: report.totalUsersAnalyzed,
          topInsights: report.topInsights,
          recommendations: report.actionableRecommendations,
        },
      };
    }

    const response: TriggerInsightResponse = {
      success: true,
      analysisId,
      scope,
      userId: body.userId,
      segment: body.segment,
      result,
      processingTimeMs: Date.now() - startMs,
      triggeredAt: new Date().toISOString(),
    };

    logger.info({ analysisId, scope, userId: body.userId, segment: body.segment, durationMs: Date.now() - startMs }, 'Insight analysis triggered');

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error({ error, durationMs: Date.now() - startMs }, 'Insights POST error');
    return NextResponse.json(
      { success: false, error: 'Failed to trigger insight analysis', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateSyntheticPatterns(segments: SegmentLabel[], lookbackDays: number): BehaviorPattern[] {
  const patterns: BehaviorPattern[] = [];
  const configs: Record<SegmentLabel, { count: number; adoptionScore: number; freq: number; streak: number }> = {
    'power-user': { count: 20, adoptionScore: 88, freq: 7, streak: 21 },
    'casual-user': { count: 35, adoptionScore: 52, freq: 2, streak: 3 },
    'at-risk': { count: 15, adoptionScore: 22, freq: 0.5, streak: 0 },
    'new-user': { count: 25, adoptionScore: 18, freq: 3, streak: 2 },
    'expansion-candidate': { count: 10, adoptionScore: 75, freq: 5, streak: 14 },
    'champion': { count: 8, adoptionScore: 92, freq: 6, streak: 28 },
    'detractor': { count: 5, adoptionScore: 30, freq: 1, streak: 0 },
    'dormant': { count: 12, adoptionScore: 15, freq: 0, streak: 0 },
    'churned': { count: 7, adoptionScore: 10, freq: 0, streak: 0 },
  };

  for (const segment of segments) {
    const cfg = configs[segment];
    if (!cfg) continue;
    for (let i = 0; i < cfg.count; i++) {
      const daysAgo = segment === 'dormant' || segment === 'churned' ? 45 + i : Math.floor(Math.random() * 5);
      patterns.push({
        userId: `synthetic_${segment}_${i}`,
        primaryActions: getPrimaryActionsForSegment(segment),
        sessionFrequencyPerWeek: cfg.freq,
        avgSessionDurationMin: 8 + Math.random() * 20,
        preferredFeatures: ['content-generation', 'analytics', 'publishing'],
        peakUsageHour: 10,
        peakUsageDay: 2,
        lastActiveAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
        streakDays: cfg.streak,
        totalSessions: Math.floor(cfg.freq * (lookbackDays / 7)),
        totalEvents: Math.floor(cfg.freq * (lookbackDays / 7) * 15),
        activationComplete: cfg.adoptionScore > 40,
        adoptionScore: cfg.adoptionScore,
        analyzedAt: new Date(),
      });
    }
  }

  return patterns;
}

function getPrimaryActionsForSegment(segment: SegmentLabel): BehaviorPattern['primaryActions'] {
  const actions: Record<SegmentLabel, BehaviorPattern['primaryActions']> = {
    'power-user': ['content_generated', 'api_call', 'feature_used'],
    'casual-user': ['page_view', 'content_generated', 'search_performed'],
    'at-risk': ['page_view', 'session_started', 'session_ended'],
    'new-user': ['session_started', 'page_view', 'content_generated'],
    'expansion-candidate': ['team_member_invited', 'feature_used', 'content_generated'],
    'champion': ['content_generated', 'feature_used', 'team_member_invited'],
    'detractor': ['support_ticket_created', 'page_view', 'session_ended'],
    'dormant': ['session_started', 'page_view', 'session_ended'],
    'churned': ['page_view', 'session_ended', 'session_started'],
  };
  return actions[segment] ?? ['page_view', 'session_started'];
}

function generateSyntheticEvents(userId: string, lookbackDays: number): BehaviorEvent[] {
  const events: BehaviorEvent[] = [];
  const eventTypes: BehaviorEvent['type'][] = ['page_view', 'content_generated', 'feature_used', 'search_performed', 'session_started', 'session_ended'];
  const sessionCount = Math.floor(Math.random() * 10) + 3;

  for (let s = 0; s < sessionCount; s++) {
    const sessionId = `sess_${s}`;
    const daysAgo = Math.floor(Math.random() * lookbackDays);
    const sessionStart = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);

    events.push({
      id: `evt_${s}_start`,
      userId,
      type: 'session_started',
      sessionId,
      timestamp: sessionStart,
      deviceType: 'desktop',
    });

    const eventsPerSession = Math.floor(Math.random() * 8) + 2;
    for (let e = 1; e <= eventsPerSession; e++) {
      events.push({
        id: `evt_${s}_${e}`,
        userId,
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        featureName: Math.random() > 0.5 ? 'content-generation' : 'analytics',
        sessionId,
        timestamp: new Date(sessionStart.getTime() + e * 2 * 60 * 1000),
        deviceType: 'desktop',
      });
    }
  }

  return events;
}

function classifySegmentFromPattern(pattern: BehaviorPattern): SegmentLabel {
  const daysSinceActive = (Date.now() - pattern.lastActiveAt.getTime()) / (24 * 3600 * 1000);
  if (daysSinceActive > 30) return 'dormant';
  if (pattern.adoptionScore >= 80 && pattern.sessionFrequencyPerWeek >= 5) return 'power-user';
  if (pattern.adoptionScore < 25 && daysSinceActive > 14) return 'at-risk';
  if (pattern.totalSessions < 3) return 'new-user';
  if (pattern.primaryActions.includes('team_member_invited') && pattern.adoptionScore > 60) return 'expansion-candidate';
  if (pattern.streakDays >= 14) return 'champion';
  return 'casual-user';
}

async function analyzeChurnFromPattern(
  agent: ReturnType<typeof getCustomerInsightAgent>,
  pattern: BehaviorPattern,
): Promise<{ churnProbability: number; riskLevel: string }> {
  const daysSinceActive = (Date.now() - pattern.lastActiveAt.getTime()) / (24 * 3600 * 1000);
  let prob = 0.05;
  if (daysSinceActive > 14) prob += 0.25;
  if (pattern.sessionFrequencyPerWeek < 1) prob += 0.15;
  if (pattern.adoptionScore < 30) prob += 0.20;
  prob = Math.min(0.95, prob);
  const riskLevel = prob >= 0.7 ? 'critical' : prob >= 0.45 ? 'high' : prob >= 0.2 ? 'medium' : 'low';
  return { churnProbability: Math.round(prob * 100) / 100, riskLevel };
}

const VALID_SEGMENTS: SegmentLabel[] = [
  'power-user', 'casual-user', 'at-risk', 'new-user', 'churned',
  'expansion-candidate', 'champion', 'detractor', 'dormant',
];

function validateTriggerBody(body: TriggerInsightBody): string | null {
  if (body.segment && !VALID_SEGMENTS.includes(body.segment)) {
    return `segment must be one of: ${VALID_SEGMENTS.join(', ')}`;
  }
  if (body.lookbackDays !== undefined && (body.lookbackDays < 1 || body.lookbackDays > 365)) {
    return 'lookbackDays must be between 1 and 365';
  }
  if (body.userId && typeof body.userId !== 'string') {
    return 'userId must be a string';
  }
  return null;
}
