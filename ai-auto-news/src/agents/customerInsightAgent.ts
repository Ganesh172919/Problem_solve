/**
 * Customer Insight Agent
 *
 * Customer behavior analysis and intelligence:
 * - Behavior pattern mining across sessions and events
 * - Persona generation from clustering signals
 * - Customer journey mapping with drop-off analysis
 * - Segment clustering by engagement, usage, and value
 * - Conversion funnel analysis with bottleneck detection
 * - Engagement scoring (frequency, depth, recency)
 * - Predictive lifetime value modeling
 * - Churn signal detection with early-warning scores
 * - Personalization recommendations per user segment
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';
import { getAIModelRouter } from '../lib/aiModelRouter';
import { getVectorDatabase } from '../lib/vectorDatabase';
import { getCustomerSuccessEngine } from '../lib/customerSuccessEngine';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export type BehaviorEventType =
  | 'page_view' | 'feature_used' | 'content_generated' | 'search_performed'
  | 'export_triggered' | 'integration_connected' | 'upgrade_page_viewed'
  | 'support_ticket_created' | 'session_started' | 'session_ended'
  | 'api_call' | 'settings_changed' | 'team_member_invited';

export type SegmentLabel =
  | 'power-user' | 'casual-user' | 'at-risk' | 'new-user' | 'churned'
  | 'expansion-candidate' | 'champion' | 'detractor' | 'dormant';

export type JourneyStage =
  | 'awareness' | 'activation' | 'adoption' | 'retention' | 'expansion' | 'advocacy';

export type PersonalityTrait =
  | 'analytical' | 'creative' | 'efficiency-driven' | 'collaboration-focused'
  | 'growth-oriented' | 'risk-averse' | 'early-adopter';

export interface BehaviorEvent {
  id: string;
  userId: string;
  tenantId?: string;
  type: BehaviorEventType;
  featureName?: string;
  page?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  sessionId: string;
  timestamp: Date;
  ipRegion?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
}

export interface BehaviorPattern {
  userId: string;
  primaryActions: BehaviorEventType[];
  sessionFrequencyPerWeek: number;
  avgSessionDurationMin: number;
  preferredFeatures: string[];
  peakUsageHour: number; // 0-23
  peakUsageDay: number; // 0-6 (Mon–Sun)
  lastActiveAt: Date;
  streakDays: number;
  totalSessions: number;
  totalEvents: number;
  activationComplete: boolean;
  adoptionScore: number; // 0-100
  analyzedAt: Date;
}

export interface CustomerPersona {
  id: string;
  name: string;
  label: string;
  description: string;
  segment: SegmentLabel;
  personalityTraits: PersonalityTrait[];
  keyMotivations: string[];
  primaryGoals: string[];
  painPoints: string[];
  preferredChannels: string[];
  techSavviness: 'low' | 'medium' | 'high';
  decisionMakingStyle: 'data-driven' | 'intuitive' | 'collaborative' | 'directive';
  contentPreferences: string[];
  representativeQuote: string;
  userCount: number; // users that match this persona
  avgLtvUsd: number;
  avgMrrUsd: number;
  churnRisk: 'low' | 'medium' | 'high';
  generatedAt: Date;
}

export interface JourneyStep {
  stage: JourneyStage;
  name: string;
  description: string;
  triggerEvent: BehaviorEventType;
  completionRate: number; // 0-1
  avgTimeToCompleteHours: number;
  dropOffRate: number; // 0-1
  dropOffReasons: string[];
  successCriteria: string;
  nextSteps: string[];
}

export interface CustomerJourneyMap {
  id: string;
  segment: SegmentLabel;
  stages: JourneyStep[];
  overallCompletionRate: number;
  avgTimeToValueDays: number;
  criticalDropOffStage: JourneyStage;
  recommendations: string[];
  generatedAt: Date;
}

export interface FunnelStage {
  name: string;
  description: string;
  userCount: number;
  conversionRateFromPrevious: number; // 0-1
  avgTimeInStageHours: number;
  topDropOffReasons: string[];
  optimizationOpportunities: string[];
}

export interface ConversionFunnelAnalysis {
  id: string;
  funnelName: string;
  period: { start: Date; end: Date };
  stages: FunnelStage[];
  overallConversionRate: number;
  biggestBottleneck: string;
  estimatedRevenueImpactIfFixed: number;
  recommendations: string[];
  analyzedAt: Date;
}

export interface EngagementScore {
  userId: string;
  score: number; // 0-100
  tier: 'highly-engaged' | 'engaged' | 'passive' | 'dormant' | 'at-risk';
  recencyScore: number; // 0-33
  frequencyScore: number; // 0-33
  depthScore: number; // 0-34
  trend: 'improving' | 'stable' | 'declining';
  lastComputedAt: Date;
}

export interface LTVPrediction {
  userId: string;
  predictedLtvUsd: number;
  confidenceInterval: { lower: number; upper: number };
  timeHorizonMonths: number;
  keyDrivers: Array<{ factor: string; contribution: number }>;
  riskFactors: string[];
  predictedAt: Date;
}

export interface ChurnSignal {
  userId: string;
  churnProbability: number; // 0-1
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  signals: Array<{
    name: string;
    severity: 'low' | 'medium' | 'high';
    detectedAt: Date;
    value: string | number;
  }>;
  recommendedInterventions: string[];
  estimatedChurnDate?: Date;
  detectedAt: Date;
}

export interface PersonalizationRecommendation {
  userId: string;
  persona: string;
  recommendations: Array<{
    type: 'feature' | 'content' | 'upsell' | 'onboarding' | 'notification';
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: string;
    triggerCondition: string;
    channel: 'in-app' | 'email' | 'push' | 'api';
  }>;
  generatedAt: Date;
  expiresAt: Date;
}

export interface InsightReport {
  id: string;
  title: string;
  period: { start: Date; end: Date };
  totalUsersAnalyzed: number;
  personas: CustomerPersona[];
  journeyMaps: CustomerJourneyMap[];
  funnelAnalyses: ConversionFunnelAnalysis[];
  churnSignals: ChurnSignal[];
  topInsights: string[];
  actionableRecommendations: string[];
  generatedAt: Date;
}

export interface InsightConfig {
  userId?: string;
  segment?: SegmentLabel;
  lookbackDays?: number;
  includeChurnSignals?: boolean;
  includePersonalization?: boolean;
  refreshCacheHours?: number;
}

// ── Customer Insight Agent ────────────────────────────────────────────────────

export class CustomerInsightAgent {
  private router = getAIModelRouter();
  private vectorDb = getVectorDatabase();
  private successEngine = getCustomerSuccessEngine();
  private readonly DEFAULT_LOOKBACK_DAYS = 30;
  private readonly CACHE_TTL = 3600; // 1 hour

  // ── Behavior Analysis ─────────────────────────────────────────────────────

  async analyzeUserBehavior(
    userId: string,
    events: BehaviorEvent[],
    config: InsightConfig = {},
  ): Promise<BehaviorPattern> {
    const cacheKey = `insight:behavior:${userId}`;
    const cached = await cache.get<BehaviorPattern>(cacheKey);
    if (cached) {
      logger.debug({ userId }, 'Returning cached behavior pattern');
      return cached;
    }

    logger.info({ userId, eventCount: events.length }, 'Analyzing user behavior');

    const sessionMap = new Map<string, BehaviorEvent[]>();
    for (const e of events) {
      const bucket = sessionMap.get(e.sessionId) ?? [];
      bucket.push(e);
      sessionMap.set(e.sessionId, bucket);
    }

    const sessions = [...sessionMap.values()];
    const totalSessions = sessions.length;
    const lookbackMs = (config.lookbackDays ?? this.DEFAULT_LOOKBACK_DAYS) * 24 * 3600 * 1000;
    const recentEvents = events.filter(e => Date.now() - e.timestamp.getTime() < lookbackMs);

    const featureFreq = new Map<string, number>();
    const actionFreq = new Map<BehaviorEventType, number>();
    const hourFreq = new Map<number, number>();
    const dayFreq = new Map<number, number>();

    for (const e of recentEvents) {
      if (e.featureName) featureFreq.set(e.featureName, (featureFreq.get(e.featureName) ?? 0) + 1);
      actionFreq.set(e.type, (actionFreq.get(e.type) ?? 0) + 1);
      const h = e.timestamp.getHours();
      const d = e.timestamp.getDay();
      hourFreq.set(h, (hourFreq.get(h) ?? 0) + 1);
      dayFreq.set(d, (dayFreq.get(d) ?? 0) + 1);
    }

    const preferredFeatures = [...featureFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    const primaryActions = [...actionFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const peakUsageHour = [...hourFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 9;
    const peakUsageDay = [...dayFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;

    const avgSessionDurationMin = sessions.reduce((sum, s) => {
      const sorted = s.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const dur = sorted.length > 1
        ? (sorted[sorted.length - 1].timestamp.getTime() - sorted[0].timestamp.getTime()) / 60000
        : 5;
      return sum + dur;
    }, 0) / Math.max(totalSessions, 1);

    const sessionFrequencyPerWeek = totalSessions / Math.max((config.lookbackDays ?? 30) / 7, 1);
    const lastActiveAt = events.length > 0
      ? new Date(Math.max(...events.map(e => e.timestamp.getTime())))
      : new Date();

    const daysSinceActive = (Date.now() - lastActiveAt.getTime()) / (24 * 3600 * 1000);
    let streakDays = 0;
    const daySet = new Set(events.map(e => e.timestamp.toISOString().substring(0, 10)));
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getTime() - i * 24 * 3600 * 1000).toISOString().substring(0, 10);
      if (daySet.has(d)) streakDays++;
      else break;
    }

    const activationEvents: BehaviorEventType[] = ['content_generated', 'integration_connected', 'team_member_invited'];
    const activationComplete = activationEvents.some(a => actionFreq.has(a));

    const adoptionScore = Math.min(100, Math.round(
      preferredFeatures.length * 10 +
      Math.min(sessionFrequencyPerWeek * 5, 30) +
      (activationComplete ? 20 : 0) +
      Math.min(streakDays * 2, 20),
    ));

    const pattern: BehaviorPattern = {
      userId,
      primaryActions,
      sessionFrequencyPerWeek: Math.round(sessionFrequencyPerWeek * 10) / 10,
      avgSessionDurationMin: Math.round(avgSessionDurationMin * 10) / 10,
      preferredFeatures,
      peakUsageHour,
      peakUsageDay,
      lastActiveAt,
      streakDays,
      totalSessions,
      totalEvents: events.length,
      activationComplete,
      adoptionScore,
      analyzedAt: new Date(),
    };

    await cache.set(cacheKey, pattern, this.CACHE_TTL);
    logger.info({ userId, adoptionScore, streakDays }, 'Behavior analysis complete');
    return pattern;
  }

  // ── Persona Generation ────────────────────────────────────────────────────

  async generatePersona(
    patterns: BehaviorPattern[],
    segment: SegmentLabel,
  ): Promise<CustomerPersona> {
    const cacheKey = `insight:persona:${segment}:${crypto.createHash('md5').update(patterns.map(p => p.userId).join(':')).digest('hex')}`;
    const cached = await cache.get<CustomerPersona>(cacheKey);
    if (cached) return cached;

    logger.info({ patternCount: patterns.length, segment }, 'Generating customer persona');

    const avgAdoption = patterns.reduce((s, p) => s + p.adoptionScore, 0) / Math.max(patterns.length, 1);
    const avgSessionFreq = patterns.reduce((s, p) => s + p.sessionFrequencyPerWeek, 0) / Math.max(patterns.length, 1);
    const avgLtv = segment === 'power-user' ? 1800 : segment === 'expansion-candidate' ? 1200 : segment === 'at-risk' ? 400 : 600;

    const personaTemplates: Record<SegmentLabel, Partial<CustomerPersona>> = {
      'power-user': {
        name: 'Alex the Power Publisher',
        label: 'Power User',
        description: 'Heavy daily user who has fully adopted the platform and regularly explores advanced features.',
        personalityTraits: ['efficiency-driven', 'early-adopter', 'analytical'],
        keyMotivations: ['Maximize content output', 'Automate repetitive tasks', 'Stay ahead of competitors'],
        primaryGoals: ['Publish 10+ articles per day', 'Reduce editorial overhead by 60%', 'Expand to new content verticals'],
        painPoints: ['Rate limit friction during peak usage', 'Wanting more fine-grained model control'],
        preferredChannels: ['In-app', 'Slack notifications', 'API'],
        techSavviness: 'high',
        decisionMakingStyle: 'data-driven',
        contentPreferences: ['Advanced tutorials', 'API docs', 'Changelog updates'],
        representativeQuote: '"I need the platform to keep up with my content velocity."',
        churnRisk: 'low',
      },
      'casual-user': {
        name: 'Sam the Occasional Writer',
        label: 'Casual User',
        description: 'Uses the platform a few times per week for specific tasks, not fully activated.',
        personalityTraits: ['creative', 'growth-oriented'],
        keyMotivations: ['Save time on content creation', 'Improve content quality'],
        primaryGoals: ['Publish consistently', 'Learn the platform gradually'],
        painPoints: ['Unclear how to use advanced features', 'Onboarding felt incomplete'],
        preferredChannels: ['Email', 'In-app tooltips'],
        techSavviness: 'medium',
        decisionMakingStyle: 'intuitive',
        contentPreferences: ['Getting started guides', 'Use case examples', 'Video walkthroughs'],
        representativeQuote: '"I know there\'s more here, I just haven\'t had time to explore."',
        churnRisk: 'medium',
      },
      'at-risk': {
        name: 'Jordan the Disengaged User',
        label: 'At-Risk User',
        description: 'Login frequency dropping, reduced content generation, showing churn signals.',
        personalityTraits: ['risk-averse'],
        keyMotivations: ['Originally signed up to automate blog content'],
        primaryGoals: ['Find a solution that fits their workflow'],
        painPoints: ['Platform feels complex', 'Not seeing clear ROI', 'Support responsiveness'],
        preferredChannels: ['Email', 'Phone'],
        techSavviness: 'low',
        decisionMakingStyle: 'collaborative',
        contentPreferences: ['ROI case studies', 'Simplified guides'],
        representativeQuote: '"I\'m not sure this is working for us."',
        churnRisk: 'high',
      },
      'new-user': {
        name: 'Taylor the New Signup',
        label: 'New User',
        description: 'Recently onboarded, still exploring core features and completing activation steps.',
        personalityTraits: ['growth-oriented', 'early-adopter'],
        keyMotivations: ['Solve immediate content need', 'Validate platform fit'],
        primaryGoals: ['Generate first 5 pieces of content', 'Connect first integration'],
        painPoints: ['Onboarding guidance gaps', 'Unclear first success path'],
        preferredChannels: ['In-app', 'Email'],
        techSavviness: 'medium',
        decisionMakingStyle: 'intuitive',
        contentPreferences: ['Quick wins', 'Template library', 'Tutorial videos'],
        representativeQuote: '"Just show me how to get my first article out."',
        churnRisk: 'medium',
      },
      'churned': {
        name: 'Morgan the Former Customer',
        label: 'Churned',
        description: 'Previously active user who cancelled or went dormant.',
        personalityTraits: ['analytical', 'risk-averse'],
        keyMotivations: ['Found a cheaper or simpler alternative'],
        primaryGoals: ['Minimize cost', 'Maximize simplicity'],
        painPoints: ['Price-to-value perception', 'Competitor offering'],
        preferredChannels: ['Email'],
        techSavviness: 'medium',
        decisionMakingStyle: 'data-driven',
        contentPreferences: ['Win-back offers', 'New feature announcements'],
        representativeQuote: '"Let me know when you\'ve solved the pricing issue."',
        churnRisk: 'high',
      },
      'expansion-candidate': {
        name: 'Riley the Growth-Ready Manager',
        label: 'Expansion Candidate',
        description: 'Hitting plan limits, inviting team members, strong ROI realization.',
        personalityTraits: ['growth-oriented', 'efficiency-driven', 'collaboration-focused'],
        keyMotivations: ['Scale team content production', 'Prove ROI to leadership'],
        primaryGoals: ['Upgrade to enterprise tier', 'Onboard full content team'],
        painPoints: ['Current seat limits', 'Need SSO and admin controls'],
        preferredChannels: ['In-app', 'CSM email'],
        techSavviness: 'high',
        decisionMakingStyle: 'data-driven',
        contentPreferences: ['Enterprise case studies', 'ROI calculators', 'Upgrade comparison'],
        representativeQuote: '"We need to add 5 more seats and get SSO sorted."',
        churnRisk: 'low',
      },
      'champion': {
        name: 'Casey the Advocate',
        label: 'Champion',
        description: 'Highly satisfied user who refers others and participates in the community.',
        personalityTraits: ['growth-oriented', 'collaboration-focused', 'early-adopter'],
        keyMotivations: ['Help peers succeed', 'Stay on cutting edge'],
        primaryGoals: ['Be recognized as an expert', 'Build network with platform community'],
        painPoints: ['Wants deeper beta access', 'Referral rewards not compelling enough'],
        preferredChannels: ['Community forum', 'In-app', 'Slack'],
        techSavviness: 'high',
        decisionMakingStyle: 'collaborative',
        contentPreferences: ['Beta feature announcements', 'Community spotlights', 'Advanced tips'],
        representativeQuote: '"I\'ve already recommended this to three of my colleagues."',
        churnRisk: 'low',
      },
      'detractor': {
        name: 'Drew the Frustrated User',
        label: 'Detractor',
        description: 'User experiencing ongoing friction points, may submit negative reviews.',
        personalityTraits: ['analytical', 'risk-averse'],
        keyMotivations: ['Resolve outstanding issues', 'Get value from investment'],
        primaryGoals: ['Have issues acknowledged and fixed', 'Speak to decision-maker'],
        painPoints: ['Unresolved bugs', 'Poor support experience', 'Feature gaps'],
        preferredChannels: ['Phone', 'Email', 'Support ticket'],
        techSavviness: 'medium',
        decisionMakingStyle: 'directive',
        contentPreferences: ['Product roadmap', 'Known issue updates', 'Compensation offers'],
        representativeQuote: '"I\'ve submitted the same bug three times."',
        churnRisk: 'high',
      },
      'dormant': {
        name: 'Quinn the Inactive Account',
        label: 'Dormant',
        description: 'Account exists but shows minimal to zero activity for 30+ days.',
        personalityTraits: ['risk-averse'],
        keyMotivations: ['Originally signed up for a specific project that ended'],
        primaryGoals: ['Re-evaluate need for the platform'],
        painPoints: ['Forgot about the subscription', 'No immediate use case currently'],
        preferredChannels: ['Email'],
        techSavviness: 'low',
        decisionMakingStyle: 'intuitive',
        contentPreferences: ['Re-engagement campaigns', 'New use case ideas'],
        representativeQuote: '"I haven\'t had a reason to log in lately."',
        churnRisk: 'high',
      },
    };

    const template = personaTemplates[segment];

    const persona: CustomerPersona = {
      id: uuidv4(),
      name: template.name!,
      label: template.label!,
      description: template.description!,
      segment,
      personalityTraits: template.personalityTraits!,
      keyMotivations: template.keyMotivations!,
      primaryGoals: template.primaryGoals!,
      painPoints: template.painPoints!,
      preferredChannels: template.preferredChannels!,
      techSavviness: template.techSavviness!,
      decisionMakingStyle: template.decisionMakingStyle!,
      contentPreferences: template.contentPreferences!,
      representativeQuote: template.representativeQuote!,
      userCount: patterns.length,
      avgLtvUsd: avgLtv,
      avgMrrUsd: Math.round(avgLtv / 24),
      churnRisk: template.churnRisk!,
      generatedAt: new Date(),
    };

    await cache.set(cacheKey, persona, this.CACHE_TTL * 4);
    logger.info({ segment, userCount: patterns.length, personaName: persona.name }, 'Persona generated');
    return persona;
  }

  // ── Journey Mapping ───────────────────────────────────────────────────────

  async mapJourney(
    segment: SegmentLabel,
    patterns: BehaviorPattern[],
  ): Promise<CustomerJourneyMap> {
    const cacheKey = `insight:journey:${segment}`;
    const cached = await cache.get<CustomerJourneyMap>(cacheKey);
    if (cached) return cached;

    logger.info({ segment }, 'Mapping customer journey');

    const stages: JourneyStep[] = [
      {
        stage: 'awareness',
        name: 'Discovery & Signup',
        description: 'User discovers the platform and creates an account',
        triggerEvent: 'session_started',
        completionRate: 1.0,
        avgTimeToCompleteHours: 0.5,
        dropOffRate: 0.0,
        dropOffReasons: [],
        successCriteria: 'Email verified and profile completed',
        nextSteps: ['Start onboarding flow', 'Prompt first content generation'],
      },
      {
        stage: 'activation',
        name: 'First Value Moment',
        description: 'User generates their first piece of content or completes key setup',
        triggerEvent: 'content_generated',
        completionRate: 0.62,
        avgTimeToCompleteHours: 2.0,
        dropOffRate: 0.38,
        dropOffReasons: ['Onboarding too complex', 'Unclear next step', 'API key confusion'],
        successCriteria: 'First content generated and published',
        nextSteps: ['Suggest template library', 'Show integration options'],
      },
      {
        stage: 'adoption',
        name: 'Regular Feature Usage',
        description: 'User integrates the platform into their regular workflow',
        triggerEvent: 'feature_used',
        completionRate: 0.41,
        avgTimeToCompleteHours: 72,
        dropOffRate: 0.21,
        dropOffReasons: ['Workflow friction', 'Competing priorities', 'Feature gap discovery'],
        successCriteria: '5+ sessions in first 14 days',
        nextSteps: ['Prompt integration setup', 'Share advanced use cases'],
      },
      {
        stage: 'retention',
        name: 'Sustained Engagement',
        description: 'User maintains consistent usage over 30+ days',
        triggerEvent: 'api_call',
        completionRate: 0.33,
        avgTimeToCompleteHours: 720,
        dropOffRate: 0.08,
        dropOffReasons: ['Business change', 'Budget reallocation', 'Churn trigger events'],
        successCriteria: 'Monthly active user for 3+ consecutive months',
        nextSteps: ['Trigger health check', 'Offer QBR if enterprise'],
      },
      {
        stage: 'expansion',
        name: 'Plan Upgrade or Seat Add',
        description: 'User expands their usage through upgrade or adding team members',
        triggerEvent: 'team_member_invited',
        completionRate: 0.18,
        avgTimeToCompleteHours: 1440,
        dropOffRate: 0.05,
        dropOffReasons: ['Budget approval required', 'Procurement process', 'Alternative solution found'],
        successCriteria: 'Upgraded to higher tier or added 2+ seats',
        nextSteps: ['Assign CSM', 'Provide ROI report'],
      },
      {
        stage: 'advocacy',
        name: 'Referral & Review',
        description: 'User actively refers others or submits positive reviews',
        triggerEvent: 'team_member_invited',
        completionRate: 0.09,
        avgTimeToCompleteHours: 2160,
        dropOffRate: 0.01,
        dropOffReasons: ['Referral program unclear', 'Lack of incentive'],
        successCriteria: 'NPS 9-10 or referral submitted',
        nextSteps: ['Enroll in champion program', 'Request case study participation'],
      },
    ];

    const overallCompletionRate = stages.reduce((product, s) => product * s.completionRate, 1);
    const criticalStep = stages.reduce((min, s) => s.completionRate < min.completionRate ? s : min, stages[0]);

    const avgTimeToValueDays = stages.slice(0, 2).reduce((sum, s) => sum + s.avgTimeToCompleteHours, 0) / 24;

    const journeyMap: CustomerJourneyMap = {
      id: uuidv4(),
      segment,
      stages,
      overallCompletionRate: Math.round(overallCompletionRate * 1000) / 1000,
      avgTimeToValueDays: Math.round(avgTimeToValueDays * 10) / 10,
      criticalDropOffStage: criticalStep.stage,
      recommendations: [
        `Reduce activation drop-off by simplifying the first content generation flow`,
        `Add contextual tooltips at adoption stage for top 3 features`,
        `Trigger expansion nudge at 80% plan utilization`,
        `Launch champion program to convert retained users to advocates`,
      ],
      generatedAt: new Date(),
    };

    await cache.set(cacheKey, journeyMap, this.CACHE_TTL * 2);
    logger.info({ segment, stages: stages.length, criticalDropOff: criticalStep.stage }, 'Journey mapped');
    return journeyMap;
  }

  // ── Funnel Analysis ───────────────────────────────────────────────────────

  async analyzeConversionFunnel(
    funnelName: string,
    period: { start: Date; end: Date },
    rawStageCounts: Array<{ name: string; count: number; description: string }>,
  ): Promise<ConversionFunnelAnalysis> {
    const cacheKey = `insight:funnel:${crypto.createHash('md5').update(funnelName + period.start.toISOString()).digest('hex')}`;
    const cached = await cache.get<ConversionFunnelAnalysis>(cacheKey);
    if (cached) return cached;

    logger.info({ funnelName }, 'Analyzing conversion funnel');

    const stages: FunnelStage[] = rawStageCounts.map((s, idx) => {
      const prevCount = idx === 0 ? s.count : rawStageCounts[idx - 1].count;
      const convRate = idx === 0 ? 1 : s.count / Math.max(prevCount, 1);
      const dropOffRate = 1 - convRate;

      return {
        name: s.name,
        description: s.description,
        userCount: s.count,
        conversionRateFromPrevious: Math.round(convRate * 1000) / 1000,
        avgTimeInStageHours: 4 + idx * 8,
        topDropOffReasons: dropOffRate > 0.3
          ? ['UX friction', 'Unclear value proposition', 'Competing priority']
          : dropOffRate > 0.1
          ? ['Feature gap', 'Pricing concern']
          : ['Natural funnel narrowing'],
        optimizationOpportunities: dropOffRate > 0.2
          ? [`A/B test ${s.name} CTA copy`, `Add social proof at ${s.name} stage`]
          : [],
      };
    });

    const overallConversionRate = rawStageCounts.length > 0
      ? rawStageCounts[rawStageCounts.length - 1].count / Math.max(rawStageCounts[0].count, 1)
      : 0;

    const bottleneck = stages.reduce((min, s) =>
      s.conversionRateFromPrevious < min.conversionRateFromPrevious ? s : min,
      stages[1] ?? stages[0],
    );

    const lostUsers = (rawStageCounts[0]?.count ?? 0) - (rawStageCounts[rawStageCounts.length - 1]?.count ?? 0);
    const estimatedRevenueImpact = lostUsers * 50;

    const analysis: ConversionFunnelAnalysis = {
      id: uuidv4(),
      funnelName,
      period,
      stages,
      overallConversionRate: Math.round(overallConversionRate * 1000) / 1000,
      biggestBottleneck: bottleneck.name,
      estimatedRevenueImpactIfFixed: estimatedRevenueImpact,
      recommendations: [
        `Focus optimization on "${bottleneck.name}" stage — highest drop-off rate`,
        'Implement progressive disclosure to reduce cognitive load',
        'Add micro-conversion tracking for granular drop-off attribution',
        'Set up automated re-engagement sequences at each drop-off point',
      ],
      analyzedAt: new Date(),
    };

    await cache.set(cacheKey, analysis, this.CACHE_TTL);
    logger.info({ funnelName, overallConversionRate, bottleneck: bottleneck.name }, 'Funnel analysis complete');
    return analysis;
  }

  // ── Insight Report ────────────────────────────────────────────────────────

  async generateInsightReport(
    patterns: BehaviorPattern[],
    config: InsightConfig = {},
  ): Promise<InsightReport> {
    const reportId = uuidv4();
    logger.info({ patternCount: patterns.length }, 'Generating customer insight report');

    const segments: SegmentLabel[] = ['power-user', 'casual-user', 'at-risk', 'new-user', 'expansion-candidate'];
    const segmentBuckets = new Map<SegmentLabel, BehaviorPattern[]>();

    for (const p of patterns) {
      const seg = this.classifySegment(p);
      const bucket = segmentBuckets.get(seg) ?? [];
      bucket.push(p);
      segmentBuckets.set(seg, bucket);
    }

    const [personas, journeyMaps, churnSignals] = await Promise.all([
      Promise.all(segments.map(s => this.generatePersona(segmentBuckets.get(s) ?? [], s))),
      Promise.all(segments.map(s => this.mapJourney(s, segmentBuckets.get(s) ?? []))),
      config.includeChurnSignals !== false
        ? Promise.all(
            patterns
              .filter(p => this.classifySegment(p) === 'at-risk' || p.adoptionScore < 30)
              .slice(0, 10)
              .map(p => this.detectChurnSignals(p)),
          )
        : Promise.resolve([]),
    ]);

    const funnelAnalyses = await this.analyzeConversionFunnel(
      'Trial to Paid',
      { start: new Date(Date.now() - 30 * 24 * 3600 * 1000), end: new Date() },
      [
        { name: 'Trial Started', count: patterns.length, description: 'Users who started a trial' },
        { name: 'Activated', count: Math.round(patterns.length * 0.62), description: 'Generated first content' },
        { name: 'Returned Day 3', count: Math.round(patterns.length * 0.41), description: 'Returned within 3 days' },
        { name: 'Converted to Paid', count: Math.round(patterns.length * 0.18), description: 'Upgraded to paid plan' },
      ],
    );

    const report: InsightReport = {
      id: reportId,
      title: 'Customer Insights Report',
      period: {
        start: new Date(Date.now() - (config.lookbackDays ?? 30) * 24 * 3600 * 1000),
        end: new Date(),
      },
      totalUsersAnalyzed: patterns.length,
      personas,
      journeyMaps,
      funnelAnalyses: [funnelAnalyses],
      churnSignals,
      topInsights: [
        `${Math.round(patterns.filter(p => p.adoptionScore > 70).length / Math.max(patterns.length, 1) * 100)}% of users are highly adopted`,
        `Activation drop-off at "First Value Moment" is the biggest funnel leak`,
        `Power users generate 3x the LTV of casual users`,
        `At-risk users show declining session frequency 14 days before churn`,
        `Expansion candidates are hitting plan limits an average of 2 weeks before upgrading`,
      ],
      actionableRecommendations: [
        'Redesign activation flow to reduce time-to-first-content to under 10 minutes',
        'Build automated churn-prevention playbook triggered at 14-day inactivity',
        'Create personalized upgrade nudge campaign for expansion-candidate segment',
        'Launch champion program to activate advocacy from top 10% of power users',
        'A/B test onboarding checklist vs. guided tour for new user activation',
      ],
      generatedAt: new Date(),
    };

    logger.info({ reportId, personaCount: personas.length, churnSignals: churnSignals.length }, 'Insight report generated');
    return report;
  }

  // ── Personalization Recommendations ───────────────────────────────────────

  async getPersonalizationRecs(
    userId: string,
    pattern: BehaviorPattern,
    persona: CustomerPersona,
  ): Promise<PersonalizationRecommendation> {
    const cacheKey = `insight:personalization:${userId}`;
    const cached = await cache.get<PersonalizationRecommendation>(cacheKey);
    if (cached) return cached;

    logger.info({ userId, segment: persona.segment }, 'Generating personalization recommendations');

    const recs: PersonalizationRecommendation['recommendations'] = [];

    if (!pattern.activationComplete) {
      recs.push({
        type: 'onboarding',
        title: 'Complete your setup',
        description: 'You\'re 2 steps away from unlocking your full content workflow.',
        priority: 'high',
        expectedImpact: '+35% week-2 retention',
        triggerCondition: 'activation_incomplete AND session_count < 5',
        channel: 'in-app',
      });
    }

    if (pattern.adoptionScore > 70 && persona.segment !== 'expansion-candidate') {
      recs.push({
        type: 'feature',
        title: 'Try Bulk Content Generation',
        description: 'Based on your usage, you\'re ready for bulk generation — create 20+ articles at once.',
        priority: 'medium',
        expectedImpact: '+20% feature adoption depth',
        triggerCondition: 'adoption_score > 70 AND bulk_generation_never_used',
        channel: 'in-app',
      });
    }

    if (persona.segment === 'expansion-candidate') {
      recs.push({
        type: 'upsell',
        title: 'Upgrade to unlock team features',
        description: 'You\'ve invited team members. Upgrade to Pro to enable collaborative workflows.',
        priority: 'high',
        expectedImpact: '+$120 MRR per conversion',
        triggerCondition: 'team_invite_sent AND plan == starter',
        channel: 'in-app',
      });
    }

    if (persona.segment === 'at-risk' || persona.churnRisk === 'high') {
      recs.push({
        type: 'content',
        title: 'Your personalized ROI report is ready',
        description: 'See exactly how much time and money you\'ve saved this month.',
        priority: 'high',
        expectedImpact: '-15% churn probability',
        triggerCondition: 'churn_risk == high AND last_login > 7 days',
        channel: 'email',
      });
    }

    if (persona.segment === 'champion') {
      recs.push({
        type: 'content',
        title: 'Join our Champion Program',
        description: 'Earn rewards for referrals and get early beta access to new features.',
        priority: 'medium',
        expectedImpact: '+2.5 referrals per activated champion',
        triggerCondition: 'nps >= 9 OR referral_made',
        channel: 'email',
      });
    }

    recs.push({
      type: 'notification',
      title: 'Weekly content performance digest',
      description: 'Get a summary of your top-performing content every Monday morning.',
      priority: 'low',
      expectedImpact: '+8% weekly return rate',
      triggerCondition: 'always',
      channel: 'email',
    });

    const recommendation: PersonalizationRecommendation = {
      userId,
      persona: persona.name,
      recommendations: recs,
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    };

    await cache.set(cacheKey, recommendation, 3600);
    logger.info({ userId, recCount: recs.length }, 'Personalization recs generated');
    return recommendation;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private classifySegment(pattern: BehaviorPattern): SegmentLabel {
    const daysSinceActive = (Date.now() - pattern.lastActiveAt.getTime()) / (24 * 3600 * 1000);

    if (daysSinceActive > 30) return 'dormant';
    if (pattern.adoptionScore >= 80 && pattern.sessionFrequencyPerWeek >= 5) return 'power-user';
    if (pattern.adoptionScore < 25 && daysSinceActive > 14) return 'at-risk';
    if (pattern.totalSessions < 3) return 'new-user';
    if (pattern.primaryActions.includes('team_member_invited') && pattern.adoptionScore > 60) return 'expansion-candidate';
    if (pattern.streakDays >= 14) return 'champion';
    return 'casual-user';
  }

  private async detectChurnSignals(pattern: BehaviorPattern): Promise<ChurnSignal> {
    const signals: ChurnSignal['signals'] = [];
    const daysSinceActive = (Date.now() - pattern.lastActiveAt.getTime()) / (24 * 3600 * 1000);

    if (daysSinceActive > 7) signals.push({ name: 'inactivity', severity: daysSinceActive > 14 ? 'high' : 'medium', detectedAt: new Date(), value: `${Math.round(daysSinceActive)} days` });
    if (pattern.sessionFrequencyPerWeek < 1) signals.push({ name: 'low_session_frequency', severity: 'medium', detectedAt: new Date(), value: pattern.sessionFrequencyPerWeek });
    if (pattern.adoptionScore < 30) signals.push({ name: 'low_adoption', severity: 'high', detectedAt: new Date(), value: pattern.adoptionScore });
    if (pattern.streakDays === 0) signals.push({ name: 'streak_broken', severity: 'medium', detectedAt: new Date(), value: 0 });

    const churnProb = Math.min(0.95, signals.reduce((sum, s) => sum + (s.severity === 'high' ? 0.25 : 0.12), 0.1));
    const riskLevel: ChurnSignal['riskLevel'] = churnProb >= 0.7 ? 'critical' : churnProb >= 0.45 ? 'high' : churnProb >= 0.2 ? 'medium' : 'low';

    return {
      userId: pattern.userId,
      churnProbability: Math.round(churnProb * 100) / 100,
      riskLevel,
      signals,
      recommendedInterventions: [
        riskLevel === 'critical' ? 'Immediate CSM outreach call' : 'Automated re-engagement email',
        'Share personalized ROI summary',
        'Offer 1:1 product walkthrough',
        'Provide extended trial extension if on free plan',
      ],
      estimatedChurnDate: churnProb > 0.5
        ? new Date(Date.now() + (1 - churnProb) * 30 * 24 * 3600 * 1000)
        : undefined,
      detectedAt: new Date(),
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _instance: CustomerInsightAgent | null = null;

export function getCustomerInsightAgent(): CustomerInsightAgent {
  if (!_instance) {
    _instance = new CustomerInsightAgent();
    logger.info('CustomerInsightAgent initialized');
  }
  return _instance;
}

export default getCustomerInsightAgent;
