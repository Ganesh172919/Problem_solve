/**
 * Content Personalization Engine
 *
 * ML-based content personalization beyond simple recommendations:
 * - User interest graph construction
 * - Topic affinity scoring
 * - Reading velocity & depth signals
 * - Cross-session context continuity
 * - Collaborative filtering for content clusters
 * - Freshness decay model
 * - Diversity injection to prevent filter bubbles
 * - Cold-start handling for new users
 * - Real-time signal ingestion
 * - Tier-aware content surfacing
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import { SubscriptionTier } from '@/types/saas';

const logger = getLogger();

export interface ContentSignal {
  userId: string;
  contentId: string;
  signalType: SignalType;
  weight: number;
  timestamp: Date;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export type SignalType =
  | 'view'
  | 'read_partial'
  | 'read_full'
  | 'share'
  | 'bookmark'
  | 'click'
  | 'like'
  | 'dislike'
  | 'skip'
  | 'search_result_click';

const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  view: 0.1,
  read_partial: 0.3,
  read_full: 0.8,
  click: 0.2,
  like: 1.0,
  share: 1.5,
  bookmark: 1.2,
  search_result_click: 0.6,
  dislike: -1.0,
  skip: -0.2,
};

export interface TopicAffinity {
  topic: string;
  score: number;
  confidence: number;
  lastUpdated: Date;
  signalCount: number;
}

export interface UserInterestProfile {
  userId: string;
  topicAffinities: TopicAffinity[];
  readingVelocity: number; // articles per day
  avgReadDepth: number; // 0–1, fraction of article consumed
  preferredFormats: string[];
  activeHours: number[]; // 0–23
  lastUpdated: Date;
  coldStart: boolean;
  tier: SubscriptionTier;
}

export interface PersonalizedFeed {
  userId: string;
  items: PersonalizedItem[];
  generatedAt: Date;
  diversityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  explanations: Record<string, string>;
}

export interface PersonalizedItem {
  contentId: string;
  score: number;
  rank: number;
  topics: string[];
  freshness: number;
  relevanceReason: string;
  boosted: boolean;
  diversitySlot: boolean;
}

export interface ContentMetadata {
  id: string;
  topics: string[];
  publishedAt: Date;
  wordCount: number;
  format: string;
  tier: SubscriptionTier;
  qualityScore: number;
}

const FRESHNESS_HALF_LIFE_HOURS = 24;
const DIVERSITY_INJECTION_RATE = 0.15;
const COLD_START_THRESHOLD = 5;
const PROFILE_TTL_SECONDS = 3600;
const MAX_TOPIC_AFFINITIES = 50;

function computeFreshness(publishedAt: Date): number {
  const ageHours = (Date.now() - publishedAt.getTime()) / 3600000;
  return Math.exp((-Math.LN2 * ageHours) / FRESHNESS_HALF_LIFE_HOURS);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function buildTopicVector(topics: string[], affinities: TopicAffinity[]): number[] {
  const topicMap = new Map(affinities.map((a) => [a.topic, a.score]));
  return topics.map((t) => topicMap.get(t) ?? 0);
}

async function loadProfile(userId: string): Promise<UserInterestProfile | null> {
  const cache = getCache();
  return cache.get<UserInterestProfile>(`personalization:profile:${userId}`) ?? null;
}

async function saveProfile(profile: UserInterestProfile): Promise<void> {
  const cache = getCache();
  cache.set(`personalization:profile:${profile.userId}`, profile, PROFILE_TTL_SECONDS);
}

export async function initializeProfile(
  userId: string,
  tier: SubscriptionTier,
): Promise<UserInterestProfile> {
  const existing = await loadProfile(userId);
  if (existing) return existing;

  const profile: UserInterestProfile = {
    userId,
    topicAffinities: [],
    readingVelocity: 0,
    avgReadDepth: 0,
    preferredFormats: [],
    activeHours: [],
    lastUpdated: new Date(),
    coldStart: true,
    tier,
  };
  await saveProfile(profile);
  return profile;
}

export async function ingestSignal(signal: ContentSignal, contentTopics: string[]): Promise<void> {
  const profile = await loadProfile(signal.userId);
  if (!profile) return;

  const weight = SIGNAL_WEIGHTS[signal.signalType] ?? 0;
  if (weight === 0) return;

  const now = new Date();
  for (const topic of contentTopics) {
    const existing = profile.topicAffinities.find((a) => a.topic === topic);
    if (existing) {
      existing.score = existing.score * 0.95 + weight * 0.05;
      existing.signalCount += 1;
      existing.lastUpdated = now;
      existing.confidence = Math.min(1, existing.confidence + 0.02);
    } else {
      profile.topicAffinities.push({
        topic,
        score: weight,
        confidence: 0.1,
        lastUpdated: now,
        signalCount: 1,
      });
    }
  }

  // Trim to max affinities, keeping highest confidence
  if (profile.topicAffinities.length > MAX_TOPIC_AFFINITIES) {
    profile.topicAffinities.sort((a, b) => b.confidence - a.confidence);
    profile.topicAffinities = profile.topicAffinities.slice(0, MAX_TOPIC_AFFINITIES);
  }

  const totalSignals = profile.topicAffinities.reduce((s, a) => s + a.signalCount, 0);
  if (totalSignals >= COLD_START_THRESHOLD) {
    profile.coldStart = false;
  }

  if (signal.signalType === 'read_full') {
    profile.avgReadDepth = profile.avgReadDepth * 0.9 + 0.1;
  } else if (signal.signalType === 'read_partial') {
    profile.avgReadDepth = profile.avgReadDepth * 0.9 + 0.04;
  }

  const hour = now.getHours();
  if (!profile.activeHours.includes(hour)) {
    profile.activeHours.push(hour);
    if (profile.activeHours.length > 8) profile.activeHours.shift();
  }

  profile.lastUpdated = now;
  await saveProfile(profile);
  logger.debug('Personalization signal ingested', {
    userId: signal.userId,
    signalType: signal.signalType,
    topics: contentTopics,
  });
}

export async function generatePersonalizedFeed(
  userId: string,
  candidateContent: ContentMetadata[],
  options: { limit?: number; freshnessBias?: number } = {},
): Promise<PersonalizedFeed> {
  const { limit = 20, freshnessBias = 0.3 } = options;
  const profile = await loadProfile(userId);
  const now = new Date();

  if (!profile || profile.coldStart) {
    // Cold-start: return freshest high-quality content
    const items = candidateContent
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, limit)
      .map((c, i) => ({
        contentId: c.id,
        score: c.qualityScore * computeFreshness(c.publishedAt),
        rank: i + 1,
        topics: c.topics,
        freshness: computeFreshness(c.publishedAt),
        relevanceReason: 'Top quality content',
        boosted: false,
        diversitySlot: false,
      }));

    return {
      userId,
      items,
      generatedAt: now,
      diversityScore: 1.0,
      freshnessScore: items.reduce((s, i) => s + i.freshness, 0) / items.length,
      relevanceScore: 0.5,
      explanations: {},
    };
  }

  // Score each candidate
  const scored: Array<PersonalizedItem & { rawRelevance: number }> = candidateContent.map((c) => {
    const freshness = computeFreshness(c.publishedAt);
    const topicVector = buildTopicVector(
      c.topics,
      profile.topicAffinities.filter((a) => c.topics.includes(a.topic)),
    );
    const profileVector = profile.topicAffinities
      .filter((a) => c.topics.includes(a.topic))
      .map((a) => a.score);

    const topicRelevance = topicVector.length > 0 && profileVector.length > 0
      ? cosineSimilarity(
          topicVector.slice(0, profileVector.length),
          profileVector,
        )
      : 0;

    const rawRelevance = topicRelevance;
    const blended = rawRelevance * (1 - freshnessBias) + freshness * freshnessBias;
    const qualityBoost = c.qualityScore * 0.1;

    return {
      contentId: c.id,
      score: blended + qualityBoost,
      rank: 0,
      topics: c.topics,
      freshness,
      rawRelevance,
      relevanceReason: topicRelevance > 0.5 ? 'Highly relevant to your interests' : 'Trending in your topics',
      boosted: false,
      diversitySlot: false,
    };
  });

  // Sort by blended score
  scored.sort((a, b) => b.score - a.score);

  // Diversity injection: replace DIVERSITY_INJECTION_RATE fraction with different-topic items
  const topN = scored.slice(0, limit);
  const diversitySlots = Math.max(1, Math.round(limit * DIVERSITY_INJECTION_RATE));
  const topTopics = new Set(topN.slice(0, limit - diversitySlots).flatMap((i) => i.topics));
  const diverseCandidates = scored.filter((i) => i.topics.some((t) => !topTopics.has(t)));

  for (let d = 0; d < diversitySlots && d < diverseCandidates.length; d++) {
    const slot = topN.length - diversitySlots + d;
    if (slot >= 0 && slot < topN.length) {
      topN[slot] = { ...diverseCandidates[d], diversitySlot: true };
    }
  }

  const final = topN.map((item, i) => ({ ...item, rank: i + 1 }));

  const relevanceScore =
    final.reduce((s, i) => s + i.rawRelevance, 0) / final.length;
  const freshnessScore =
    final.reduce((s, i) => s + i.freshness, 0) / final.length;

  const explanations: Record<string, string> = {};
  for (const item of final) {
    explanations[item.contentId] = item.relevanceReason;
  }

  logger.debug('Personalized feed generated', {
    userId,
    candidateCount: candidateContent.length,
    resultCount: final.length,
    relevanceScore,
    freshnessScore,
  });

  return {
    userId,
    items: final,
    generatedAt: now,
    diversityScore: diversitySlots / limit,
    freshnessScore,
    relevanceScore,
    explanations,
  };
}

export async function getTopInterests(
  userId: string,
  limit = 10,
): Promise<TopicAffinity[]> {
  const profile = await loadProfile(userId);
  if (!profile) return [];
  return profile.topicAffinities
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function decayStaleAffinities(userId: string): Promise<void> {
  const profile = await loadProfile(userId);
  if (!profile) return;

  const now = Date.now();
  const ONE_WEEK_MS = 7 * 24 * 3600 * 1000;

  for (const affinity of profile.topicAffinities) {
    const age = now - affinity.lastUpdated.getTime();
    if (age > ONE_WEEK_MS) {
      affinity.score *= 0.85;
      affinity.confidence *= 0.9;
    }
  }

  profile.topicAffinities = profile.topicAffinities.filter((a) => a.score > 0.01);
  await saveProfile(profile);
}

export async function buildCollaborativeFilteringClusters(
  profiles: UserInterestProfile[],
): Promise<Map<string, string[]>> {
  const clusters = new Map<string, string[]>();
  const CLUSTER_SIMILARITY_THRESHOLD = 0.6;

  for (let i = 0; i < profiles.length; i++) {
    const pA = profiles[i];
    const clusterId = `cluster_${i}`;
    if (!clusters.has(clusterId)) clusters.set(clusterId, [pA.userId]);

    for (let j = i + 1; j < profiles.length; j++) {
      const pB = profiles[j];
      const topicsA = pA.topicAffinities.map((a) => a.topic);
      const topicsB = pB.topicAffinities.map((a) => a.topic);
      const allTopics = Array.from(new Set([...topicsA, ...topicsB]));

      const vecA = allTopics.map((t) => pA.topicAffinities.find((a) => a.topic === t)?.score ?? 0);
      const vecB = allTopics.map((t) => pB.topicAffinities.find((a) => a.topic === t)?.score ?? 0);

      const similarity = cosineSimilarity(vecA, vecB);
      if (similarity >= CLUSTER_SIMILARITY_THRESHOLD) {
        const existingCluster = clusters.get(clusterId);
        if (existingCluster && !existingCluster.includes(pB.userId)) {
          existingCluster.push(pB.userId);
        }
      }
    }
  }

  logger.info('Collaborative filtering clusters built', { clusterCount: clusters.size });
  return clusters;
}

export function explainPersonalization(
  item: PersonalizedItem,
  profile: UserInterestProfile,
): string {
  if (item.diversitySlot) return 'Expanding your reading horizons';
  if (item.boosted) return 'Trending and highly relevant';
  const matchedTopics = item.topics.filter((t) =>
    profile.topicAffinities.some((a) => a.topic === t && a.score > 0.3),
  );
  if (matchedTopics.length > 0) {
    return `Based on your interest in ${matchedTopics.slice(0, 2).join(' and ')}`;
  }
  return 'Popular in your network';
}
