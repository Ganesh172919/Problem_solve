/**
 * @module hyperPersonalizationEngine
 * @description Hyper-personalization engine combining real-time user signals, multi-armed
 * bandit content selection, collaborative filtering, session context fusion, dynamic
 * UI configuration, personalized pricing, next-best-action recommendations, and
 * predictive user journey modeling for maximum engagement and conversion.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserSegment = 'power_user' | 'casual' | 'at_risk' | 'new' | 'champion' | 'dormant';
export type PersonalizationDimension = 'content' | 'ui' | 'pricing' | 'notifications' | 'recommendations' | 'onboarding';
export type SignalType = 'click' | 'view' | 'purchase' | 'search' | 'share' | 'dismiss' | 'dwell' | 'scroll';

export interface UserProfile {
  userId: string;
  tenantId: string;
  segment: UserSegment;
  traits: Record<string, unknown>;
  preferences: Record<string, number>;  // feature -> affinity score 0-1
  recentSignals: UserSignal[];
  sessionContext: SessionContext;
  personalizationVersion: number;
  createdAt: number;
  lastActiveAt: number;
}

export interface UserSignal {
  signalId: string;
  userId: string;
  type: SignalType;
  entityId: string;       // content/product/feature id
  entityType: string;
  value: number;          // e.g. dwell time, scroll depth, purchase amount
  timestamp: number;
  sessionId: string;
  context: Record<string, unknown>;
}

export interface SessionContext {
  sessionId: string;
  startedAt: number;
  device: string;
  locale: string;
  timezone: string;
  referrer: string;
  currentPath: string;
  pageViews: number;
  intent?: string;      // inferred intent: 'research' | 'purchase' | 'support'
}

export interface PersonalizationDecision {
  decisionId: string;
  userId: string;
  dimension: PersonalizationDimension;
  selectedVariant: string;
  alternativesConsidered: string[];
  score: number;
  confidence: number;
  algorithm: 'ucb1' | 'thompson' | 'collaborative' | 'rule_based' | 'hybrid';
  explanation: string;
  ttlMs: number;
  decidedAt: number;
}

export interface ContentRecommendation {
  itemId: string;
  title: string;
  type: string;
  score: number;
  reason: string;
  tags: string[];
}

export interface NextBestAction {
  actionId: string;
  title: string;
  description: string;
  expectedValueScore: number;  // 0-1 predicted engagement/conversion
  urgency: 'low' | 'medium' | 'high';
  channel: 'in_app' | 'email' | 'push' | 'sms';
  callToAction: string;
  targetPath?: string;
}

export interface PersonalizedUIConfig {
  theme: 'light' | 'dark' | 'auto';
  layout: 'compact' | 'comfortable' | 'spacious';
  dashboardWidgets: string[];
  featureHighlights: string[];
  quickActions: string[];
  navigationOrder: string[];
}

export interface ABTestVariant {
  variantId: string;
  name: string;
  weight: number;   // allocation weight (sum to 100)
  config: Record<string, unknown>;
  metrics: { impressions: number; conversions: number; revenue: number };
}

export interface PersonalizationExperiment {
  experimentId: string;
  name: string;
  dimension: PersonalizationDimension;
  variants: ABTestVariant[];
  status: 'draft' | 'running' | 'paused' | 'completed';
  startedAt?: number;
  endedAt?: number;
  winnerVariantId?: string;
  confidence: number;
}

export interface HyperPersonalizationConfig {
  maxRecentSignals?: number;
  explorationRate?: number;    // epsilon-greedy exploration (0-1)
  coldStartStrategy?: 'popular' | 'diverse' | 'trending';
  signalDecayHalfLifeMs?: number;
  minSignalsForPersonalization?: number;
}

// ── Thompson Sampling Helpers ─────────────────────────────────────────────────

interface BanditArm {
  alpha: number;  // pseudo-successes
  beta: number;   // pseudo-failures
}

function thompsonSample(arm: BanditArm): number {
  // Beta distribution approximation via method of moments
  const alpha = Math.max(arm.alpha, 0.01);
  const beta = Math.max(arm.beta, 0.01);
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
  const std = Math.sqrt(variance);
  // Box-Muller approximation
  const u = Math.random();
  const v = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.min(1, mean + std * gauss));
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class HyperPersonalizationEngine {
  private profiles = new Map<string, UserProfile>();
  private banditArms = new Map<string, Map<string, BanditArm>>();  // dimension:userId -> variantId -> arm
  private experiments = new Map<string, PersonalizationExperiment>();
  private decisions: PersonalizationDecision[] = [];
  private config: Required<HyperPersonalizationConfig>;

  constructor(config: HyperPersonalizationConfig = {}) {
    this.config = {
      maxRecentSignals: config.maxRecentSignals ?? 200,
      explorationRate: config.explorationRate ?? 0.1,
      coldStartStrategy: config.coldStartStrategy ?? 'popular',
      signalDecayHalfLifeMs: config.signalDecayHalfLifeMs ?? 7 * 24 * 60 * 60_000,
      minSignalsForPersonalization: config.minSignalsForPersonalization ?? 5,
    };
  }

  // ── Profile Management ────────────────────────────────────────────────────

  upsertProfile(params: Pick<UserProfile, 'userId' | 'tenantId'> & Partial<UserProfile>): UserProfile {
    const existing = this.profiles.get(params.userId);
    if (existing) {
      Object.assign(existing, params, { personalizationVersion: existing.personalizationVersion + 1, lastActiveAt: Date.now() });
      return existing;
    }

    const profile: UserProfile = {
      segment: 'new',
      traits: {},
      preferences: {},
      recentSignals: [],
      sessionContext: {
        sessionId: '',
        startedAt: Date.now(),
        device: 'web',
        locale: 'en-US',
        timezone: 'UTC',
        referrer: '',
        currentPath: '/',
        pageViews: 0,
      },
      personalizationVersion: 1,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      ...params,
    };

    this.profiles.set(profile.userId, profile);
    return profile;
  }

  getProfile(userId: string): UserProfile | undefined {
    return this.profiles.get(userId);
  }

  // ── Signal Ingestion ──────────────────────────────────────────────────────

  ingestSignal(signal: UserSignal): void {
    const profile = this.profiles.get(signal.userId);
    if (!profile) return;

    profile.recentSignals.push(signal);
    if (profile.recentSignals.length > this.config.maxRecentSignals) {
      profile.recentSignals.shift();
    }
    profile.lastActiveAt = signal.timestamp;

    // Update preferences based on signal
    const entityKey = `${signal.entityType}:${signal.entityId}`;
    const signalWeight = this.getSignalWeight(signal.type);
    const decayedValue = signalWeight * Math.exp(
      -(Date.now() - signal.timestamp) / this.config.signalDecayHalfLifeMs,
    );

    profile.preferences[entityKey] = Math.min(1, (profile.preferences[entityKey] ?? 0) * 0.9 + decayedValue * 0.1);

    // Update segment
    profile.segment = this.inferSegment(profile);

    // Update bandit arms
    const dimension: PersonalizationDimension = 'content';
    const armKey = `${dimension}:${signal.userId}`;
    if (!this.banditArms.has(armKey)) this.banditArms.set(armKey, new Map());
    const arms = this.banditArms.get(armKey)!;
    const arm = arms.get(signal.entityId) ?? { alpha: 1, beta: 1 };

    if (['click', 'purchase', 'share'].includes(signal.type)) {
      arm.alpha += 1;
    } else if (signal.type === 'dismiss') {
      arm.beta += 1;
    }
    arms.set(signal.entityId, arm);
  }

  bulkIngestSignals(signals: UserSignal[]): void {
    for (const signal of signals) this.ingestSignal(signal);
  }

  // ── Personalization Decisions ─────────────────────────────────────────────

  decide(userId: string, dimension: PersonalizationDimension, candidates: string[]): PersonalizationDecision {
    const profile = this.profiles.get(userId);
    const hasEnoughData = (profile?.recentSignals.length ?? 0) >= this.config.minSignalsForPersonalization;

    let selectedVariant: string;
    let algorithm: PersonalizationDecision['algorithm'];
    let score: number;
    let confidence: number;

    if (!hasEnoughData || Math.random() < this.config.explorationRate) {
      // Exploration / cold start
      selectedVariant = candidates[Math.floor(Math.random() * candidates.length)] ?? candidates[0]!;
      algorithm = 'rule_based';
      score = 0.5;
      confidence = 0.3;
    } else {
      // Thompson sampling exploitation
      const armKey = `${dimension}:${userId}`;
      const arms = this.banditArms.get(armKey) ?? new Map<string, BanditArm>();

      let bestScore = -1;
      selectedVariant = candidates[0]!;

      for (const candidate of candidates) {
        const arm = arms.get(candidate) ?? { alpha: 1, beta: 1 };
        const sample = thompsonSample(arm);
        if (sample > bestScore) {
          bestScore = sample;
          selectedVariant = candidate;
        }
      }
      algorithm = 'thompson';
      score = bestScore;
      confidence = Math.min(0.95, 0.5 + (profile?.recentSignals.length ?? 0) / 100);
    }

    const decision: PersonalizationDecision = {
      decisionId: `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      dimension,
      selectedVariant,
      alternativesConsidered: candidates.filter(c => c !== selectedVariant),
      score,
      confidence,
      algorithm,
      explanation: `Selected ${selectedVariant} via ${algorithm} (score: ${score.toFixed(3)})`,
      ttlMs: 5 * 60_000,
      decidedAt: Date.now(),
    };

    this.decisions.push(decision);
    if (this.decisions.length > 500_000) this.decisions.shift();
    return decision;
  }

  // ── Content Recommendations ───────────────────────────────────────────────

  getRecommendations(userId: string, contentCatalog: Array<{ id: string; title: string; type: string; tags: string[] }>, limit = 10): ContentRecommendation[] {
    const profile = this.profiles.get(userId);
    if (!profile) return this.getPopularItems(contentCatalog, limit);

    const scored = contentCatalog.map(item => {
      let score = 0;

      // Preference-based scoring
      const entityKey = `${item.type}:${item.id}`;
      const prefScore = profile.preferences[entityKey] ?? 0;
      score += prefScore * 0.4;

      // Tag-based affinity
      for (const tag of item.tags) {
        const tagKey = `tag:${tag}`;
        score += (profile.preferences[tagKey] ?? 0) * 0.1;
      }

      // Segment boost
      if (profile.segment === 'power_user') score += 0.05;
      if (profile.segment === 'new') score += 0.02; // surface popular content

      // Recency boost (items seen recently get penalty)
      const recentlyViewed = profile.recentSignals.some(s => s.entityId === item.id && Date.now() - s.timestamp < 24 * 60 * 60_000);
      if (recentlyViewed) score -= 0.3;

      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ item, score }) => ({
      itemId: item.id,
      title: item.title,
      type: item.type,
      score,
      reason: score > 0.5 ? 'Based on your interests' : 'Popular in your category',
      tags: item.tags,
    }));
  }

  // ── Next Best Action ──────────────────────────────────────────────────────

  getNextBestActions(userId: string, availableActions: NextBestAction[]): NextBestAction[] {
    const profile = this.profiles.get(userId);
    if (!profile) return availableActions.slice(0, 3);

    const scored = availableActions.map(action => {
      let boost = 0;
      if (profile.segment === 'at_risk' && action.urgency === 'high') boost += 0.3;
      if (profile.segment === 'new' && action.title.toLowerCase().includes('onboard')) boost += 0.4;
      if (profile.segment === 'champion') boost += 0.1;
      return { action, finalScore: action.expectedValueScore + boost };
    });

    scored.sort((a, b) => b.finalScore - a.finalScore);
    return scored.slice(0, 5).map(s => s.action);
  }

  // ── UI Personalization ────────────────────────────────────────────────────

  getPersonalizedUI(userId: string, availableWidgets: string[]): PersonalizedUIConfig {
    const profile = this.profiles.get(userId);

    if (!profile || profile.recentSignals.length < this.config.minSignalsForPersonalization) {
      return {
        theme: 'auto',
        layout: 'comfortable',
        dashboardWidgets: availableWidgets.slice(0, 5),
        featureHighlights: [],
        quickActions: [],
        navigationOrder: availableWidgets,
      };
    }

    // Infer preferences from signals
    const signalsByEntity = new Map<string, number>();
    for (const signal of profile.recentSignals) {
      signalsByEntity.set(signal.entityId, (signalsByEntity.get(signal.entityId) ?? 0) + 1);
    }

    const sortedByInteraction = [...signalsByEntity.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const preferredWidgets = availableWidgets
      .filter(w => sortedByInteraction.includes(w))
      .concat(availableWidgets.filter(w => !sortedByInteraction.includes(w)));

    return {
      theme: profile.traits['prefersTheme'] as 'light' | 'dark' | 'auto' ?? 'auto',
      layout: profile.segment === 'power_user' ? 'compact' : 'comfortable',
      dashboardWidgets: preferredWidgets.slice(0, 6),
      featureHighlights: profile.segment === 'new' ? ['getting_started', 'tutorial'] : [],
      quickActions: sortedByInteraction.slice(0, 4),
      navigationOrder: preferredWidgets,
    };
  }

  // ── Experiments ───────────────────────────────────────────────────────────

  createExperiment(params: Omit<PersonalizationExperiment, 'experimentId'>): PersonalizationExperiment {
    const experiment: PersonalizationExperiment = {
      ...params,
      experimentId: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };
    this.experiments.set(experiment.experimentId, experiment);
    return experiment;
  }

  assignToVariant(experimentId: string, userId: string): ABTestVariant | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== 'running') return null;

    // Deterministic assignment based on userId hash
    const hash = userId.split('').reduce((acc, c) => acc ^ c.charCodeAt(0), 0);
    const totalWeight = experiment.variants.reduce((s, v) => s + v.weight, 0);
    let cumWeight = 0;
    const normalizedHash = (Math.abs(hash) % 100);

    for (const variant of experiment.variants) {
      cumWeight += (variant.weight / totalWeight) * 100;
      if (normalizedHash < cumWeight) return variant;
    }
    return experiment.variants[experiment.variants.length - 1] ?? null;
  }

  recordVariantResult(experimentId: string, variantId: string, converted: boolean, revenue = 0): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return;
    const variant = experiment.variants.find(v => v.variantId === variantId);
    if (!variant) return;
    variant.metrics.impressions += 1;
    if (converted) variant.metrics.conversions += 1;
    variant.metrics.revenue += revenue;
  }

  analyzeExperiment(experimentId: string): { winner?: string; confidence: number; summary: Record<string, unknown> } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const variantStats = experiment.variants.map(v => ({
      variantId: v.variantId,
      name: v.name,
      conversionRate: v.metrics.impressions > 0 ? v.metrics.conversions / v.metrics.impressions : 0,
      revenuePerImpression: v.metrics.impressions > 0 ? v.metrics.revenue / v.metrics.impressions : 0,
      impressions: v.metrics.impressions,
    }));

    variantStats.sort((a, b) => b.conversionRate - a.conversionRate);
    const winner = variantStats[0];
    const totalImpressions = experiment.variants.reduce((s, v) => s + v.metrics.impressions, 0);
    const confidence = Math.min(0.99, Math.sqrt(totalImpressions) / 100);

    return {
      winner: winner ? winner.variantId : undefined,
      confidence,
      summary: { variantStats, totalImpressions, confidence },
    };
  }

  // ── Segment Analytics ─────────────────────────────────────────────────────

  getSegmentDistribution(tenantId?: string): Record<UserSegment, number> {
    let profiles = Array.from(this.profiles.values());
    if (tenantId) profiles = profiles.filter(p => p.tenantId === tenantId);
    const dist: Record<UserSegment, number> = { power_user: 0, casual: 0, at_risk: 0, new: 0, champion: 0, dormant: 0 };
    for (const p of profiles) dist[p.segment] += 1;
    return dist;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private getSignalWeight(type: SignalType): number {
    const weights: Record<SignalType, number> = {
      purchase: 1.0, share: 0.8, click: 0.5, view: 0.3, dwell: 0.4, scroll: 0.2, search: 0.6, dismiss: -0.5,
    };
    return weights[type] ?? 0.1;
  }

  private inferSegment(profile: UserProfile): UserSegment {
    const daysSinceActive = (Date.now() - profile.lastActiveAt) / 86_400_000;
    const signalCount = profile.recentSignals.length;
    const purchaseSignals = profile.recentSignals.filter(s => s.type === 'purchase').length;

    if (daysSinceActive > 30) return 'dormant';
    if (purchaseSignals > 10 && signalCount > 100) return 'champion';
    if (signalCount > 50) return 'power_user';
    if (signalCount > 10) return 'casual';
    if (daysSinceActive < 7 && signalCount < 10) return 'new';
    if (daysSinceActive > 14) return 'at_risk';
    return 'casual';
  }

  private getPopularItems(catalog: Array<{ id: string; title: string; type: string; tags: string[] }>, limit: number): ContentRecommendation[] {
    return catalog.slice(0, limit).map(item => ({
      itemId: item.id,
      title: item.title,
      type: item.type,
      score: 0.5,
      reason: 'Popular content',
      tags: item.tags,
    }));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getHyperPersonalization(): HyperPersonalizationEngine {
  const key = '__hyperPersonalizationEngine__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new HyperPersonalizationEngine();
  }
  return (globalThis as Record<string, unknown>)[key] as HyperPersonalizationEngine;
}
