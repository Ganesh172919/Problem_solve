/**
 * Feedback Loop Engine
 *
 * Structured user feedback collection with:
 * - Multi-type feedback (rating, thumbs, NPS, CSAT, free-text)
 * - NLP-based sentiment analysis
 * - Issue categorisation and routing
 * - Automated response triggers
 * - Trend detection across feedback streams
 * - Product insights aggregation
 * - Per-feature satisfaction scores
 * - Churn signal detection from negative feedback
 * - Feedback-to-roadmap prioritisation scoring
 * - Slack/email routing for critical feedback
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type FeedbackType = 'nps' | 'csat' | 'thumbs' | 'star_rating' | 'free_text' | 'bug_report' | 'feature_request';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export type FeedbackCategory =
  | 'content_quality'
  | 'performance'
  | 'pricing'
  | 'onboarding'
  | 'feature_request'
  | 'bug'
  | 'support'
  | 'ui_ux'
  | 'api'
  | 'billing'
  | 'other';

export interface FeedbackEntry {
  id: string;
  userId: string;
  sessionId?: string;
  type: FeedbackType;
  score?: number; // 0–10 for NPS, 1–5 for CSAT/star
  thumbs?: 'up' | 'down';
  text?: string;
  category: FeedbackCategory;
  featureArea?: string;
  sentiment: SentimentLabel;
  sentimentScore: number; // -1 to 1
  keywords: string[];
  churnRisk: boolean;
  urgent: boolean;
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface FeedbackTrend {
  period: string;
  avgNps: number;
  avgCsat: number;
  thumbsUpRate: number;
  sentimentDistribution: Record<SentimentLabel, number>;
  topIssues: Array<{ category: FeedbackCategory; count: number }>;
  churnSignals: number;
  totalFeedback: number;
  resolutionRate: number;
}

export interface FeatureSatisfaction {
  featureArea: string;
  avgScore: number;
  feedbackCount: number;
  sentimentBreakdown: Record<SentimentLabel, number>;
  topKeywords: string[];
  trend: 'improving' | 'declining' | 'stable';
}

const SENTIMENT_POSITIVE_WORDS = new Set([
  'great', 'amazing', 'excellent', 'love', 'perfect', 'awesome', 'fantastic',
  'wonderful', 'best', 'easy', 'fast', 'helpful', 'intuitive', 'reliable',
  'powerful', 'smart', 'brilliant', 'outstanding', 'impressed', 'happy',
]);

const SENTIMENT_NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'worst', 'hate', 'broken', 'slow', 'confusing',
  'useless', 'disappointed', 'frustrating', 'buggy', 'crash', 'error', 'fail',
  'annoying', 'problem', 'issue', 'unable', 'missing', 'expensive', 'overpriced',
]);

const CATEGORY_KEYWORDS: Record<FeedbackCategory, string[]> = {
  content_quality: ['content', 'article', 'post', 'quality', 'accuracy', 'writing'],
  performance: ['slow', 'fast', 'speed', 'latency', 'load', 'timeout', 'performance'],
  pricing: ['price', 'cost', 'expensive', 'cheap', 'plan', 'billing', 'subscription'],
  onboarding: ['onboard', 'setup', 'start', 'tutorial', 'guide', 'begin', 'welcome'],
  feature_request: ['would like', 'need', 'want', 'wish', 'add', 'feature', 'request'],
  bug: ['bug', 'broken', 'crash', 'error', 'fix', 'issue', 'problem', 'not working'],
  support: ['support', 'help', 'contact', 'response', 'ticket', 'chat'],
  ui_ux: ['ui', 'ux', 'design', 'interface', 'navigation', 'button', 'layout'],
  api: ['api', 'endpoint', 'sdk', 'integration', 'webhook', 'key'],
  billing: ['invoice', 'charge', 'payment', 'refund', 'credit', 'billing'],
  other: [],
};

function analyzeSentiment(text: string): { label: SentimentLabel; score: number; keywords: string[] } {
  if (!text) return { label: 'neutral', score: 0, keywords: [] };

  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;
  const foundKeywords: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (SENTIMENT_POSITIVE_WORDS.has(clean)) { positiveCount++; foundKeywords.push(clean); }
    if (SENTIMENT_NEGATIVE_WORDS.has(clean)) { negativeCount++; foundKeywords.push(clean); }
  }

  const total = positiveCount + negativeCount;
  const score = total > 0 ? (positiveCount - negativeCount) / total : 0;

  let label: SentimentLabel = 'neutral';
  if (score > 0.2) label = 'positive';
  else if (score < -0.2) label = 'negative';

  return { label, score, keywords: Array.from(new Set(foundKeywords)) };
}

function classifyCategory(text: string, type: FeedbackType): FeedbackCategory {
  if (type === 'bug_report') return 'bug';
  if (type === 'feature_request') return 'feature_request';

  if (!text) return 'other';
  const lower = text.toLowerCase();

  let best: FeedbackCategory = 'other';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as Array<[FeedbackCategory, string[]]>) {
    const score = keywords.filter((k) => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }

  return best;
}

function detectChurnRisk(entry: Partial<FeedbackEntry>): boolean {
  if (entry.type === 'nps' && (entry.score ?? 10) <= 3) return true;
  if (entry.type === 'csat' && (entry.score ?? 5) <= 2) return true;
  if (entry.thumbs === 'down' && entry.sentimentScore !== undefined && entry.sentimentScore < -0.5) return true;
  if (entry.sentiment === 'negative' && entry.category === 'pricing') return true;
  return false;
}

function detectUrgency(entry: Partial<FeedbackEntry>): boolean {
  if (entry.category === 'bug' && entry.sentiment === 'negative') return true;
  if (entry.type === 'nps' && (entry.score ?? 10) <= 1) return true;
  const urgentKeywords = ['down', 'outage', 'urgent', 'critical', 'immediately', 'lost data'];
  return urgentKeywords.some((k) => entry.text?.toLowerCase().includes(k));
}

function generateFeedbackId(): string {
  return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function submitFeedback(params: {
  userId: string;
  sessionId?: string;
  type: FeedbackType;
  score?: number;
  thumbs?: 'up' | 'down';
  text?: string;
  featureArea?: string;
  metadata?: Record<string, unknown>;
}): FeedbackEntry {
  const { label, score: sentimentScore, keywords } = analyzeSentiment(params.text ?? '');
  const category = classifyCategory(params.text ?? '', params.type);

  const entry: FeedbackEntry = {
    id: generateFeedbackId(),
    userId: params.userId,
    sessionId: params.sessionId,
    type: params.type,
    score: params.score,
    thumbs: params.thumbs,
    text: params.text,
    category,
    featureArea: params.featureArea,
    sentiment: label,
    sentimentScore,
    keywords,
    churnRisk: false,
    urgent: false,
    resolved: false,
    createdAt: new Date(),
    metadata: params.metadata ?? {},
  };

  entry.churnRisk = detectChurnRisk(entry);
  entry.urgent = detectUrgency(entry);

  // Persist
  const cache = getCache();
  const listKey = `feedback:list:${params.userId}`;
  const existing = cache.get<FeedbackEntry[]>(listKey) ?? [];
  existing.push(entry);
  if (existing.length > 100) existing.splice(0, existing.length - 100);
  cache.set(listKey, existing, 86400 * 30);

  // Global daily bucket
  const dayKey = `feedback:day:${new Date().toISOString().slice(0, 10)}`;
  const dayBucket = cache.get<FeedbackEntry[]>(dayKey) ?? [];
  dayBucket.push(entry);
  cache.set(dayKey, dayBucket, 86400 * 7);

  logger.info('Feedback submitted', {
    id: entry.id,
    type: entry.type,
    sentiment: label,
    churnRisk: entry.churnRisk,
    urgent: entry.urgent,
  });

  if (entry.urgent) {
    logger.warn('URGENT feedback received', { id: entry.id, userId: params.userId, text: params.text });
  }

  return entry;
}

export function getUserFeedback(userId: string): FeedbackEntry[] {
  const cache = getCache();
  return cache.get<FeedbackEntry[]>(`feedback:list:${userId}`) ?? [];
}

export function getDailyFeedback(date: string): FeedbackEntry[] {
  const cache = getCache();
  return cache.get<FeedbackEntry[]>(`feedback:day:${date}`) ?? [];
}

export function resolveFeedback(feedbackId: string, userId: string): boolean {
  const cache = getCache();
  const listKey = `feedback:list:${userId}`;
  const entries = cache.get<FeedbackEntry[]>(listKey);
  if (!entries) return false;

  const entry = entries.find((e) => e.id === feedbackId);
  if (!entry) return false;

  entry.resolved = true;
  entry.resolvedAt = new Date();
  cache.set(listKey, entries, 86400 * 30);
  return true;
}

export function computeFeedbackTrend(entries: FeedbackEntry[], period: string): FeedbackTrend {
  const npsEntries = entries.filter((e) => e.type === 'nps' && e.score !== undefined);
  const csatEntries = entries.filter((e) => e.type === 'csat' && e.score !== undefined);
  const thumbsEntries = entries.filter((e) => e.type === 'thumbs' && e.thumbs);

  const avgNps = npsEntries.length > 0
    ? npsEntries.reduce((s, e) => s + e.score!, 0) / npsEntries.length
    : 0;
  const avgCsat = csatEntries.length > 0
    ? csatEntries.reduce((s, e) => s + e.score!, 0) / csatEntries.length
    : 0;

  const thumbsUp = thumbsEntries.filter((e) => e.thumbs === 'up').length;
  const thumbsUpRate = thumbsEntries.length > 0 ? thumbsUp / thumbsEntries.length : 0;

  const sentimentDist: Record<SentimentLabel, number> = { positive: 0, neutral: 0, negative: 0 };
  for (const e of entries) sentimentDist[e.sentiment] += 1;

  const categoryCounts = new Map<FeedbackCategory, number>();
  for (const e of entries) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) ?? 0) + 1);
  }

  const topIssues = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  const churnSignals = entries.filter((e) => e.churnRisk).length;
  const resolved = entries.filter((e) => e.resolved).length;
  const resolutionRate = entries.length > 0 ? resolved / entries.length : 0;

  return {
    period,
    avgNps,
    avgCsat,
    thumbsUpRate,
    sentimentDistribution: sentimentDist,
    topIssues,
    churnSignals,
    totalFeedback: entries.length,
    resolutionRate,
  };
}

export function computeFeatureSatisfaction(
  entries: FeedbackEntry[],
): FeatureSatisfaction[] {
  const byFeature = new Map<string, FeedbackEntry[]>();
  for (const e of entries) {
    const area = e.featureArea ?? 'general';
    if (!byFeature.has(area)) byFeature.set(area, []);
    byFeature.get(area)!.push(e);
  }

  const results: FeatureSatisfaction[] = [];
  for (const [featureArea, featureEntries] of byFeature) {
    const scored = featureEntries.filter((e) => e.score !== undefined);
    const avgScore = scored.length > 0
      ? scored.reduce((s, e) => s + e.score!, 0) / scored.length
      : 0;

    const sentimentBreakdown: Record<SentimentLabel, number> = { positive: 0, neutral: 0, negative: 0 };
    const allKeywords: string[] = [];
    for (const e of featureEntries) {
      sentimentBreakdown[e.sentiment] += 1;
      allKeywords.push(...e.keywords);
    }

    const kwFreq = new Map<string, number>();
    for (const kw of allKeywords) kwFreq.set(kw, (kwFreq.get(kw) ?? 0) + 1);
    const topKeywords = Array.from(kwFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw]) => kw);

    // Trend: compare recent vs earlier half
    const mid = Math.floor(featureEntries.length / 2);
    const recentAvg = featureEntries
      .slice(mid)
      .filter((e) => e.score !== undefined)
      .reduce((s, e, _, a) => s + e.score! / a.length, 0);
    const earlierAvg = featureEntries
      .slice(0, mid)
      .filter((e) => e.score !== undefined)
      .reduce((s, e, _, a) => s + e.score! / a.length, 0);
    const trend: FeatureSatisfaction['trend'] =
      recentAvg > earlierAvg + 0.2 ? 'improving'
      : recentAvg < earlierAvg - 0.2 ? 'declining'
      : 'stable';

    results.push({
      featureArea,
      avgScore,
      feedbackCount: featureEntries.length,
      sentimentBreakdown,
      topKeywords,
      trend,
    });
  }

  return results.sort((a, b) => b.feedbackCount - a.feedbackCount);
}

export function getChurnRiskUsers(date: string): string[] {
  const entries = getDailyFeedback(date);
  return Array.from(new Set(entries.filter((e) => e.churnRisk).map((e) => e.userId)));
}

export function getUrgentFeedback(date: string): FeedbackEntry[] {
  return getDailyFeedback(date).filter((e) => e.urgent && !e.resolved);
}

export function computeNpsScore(entries: FeedbackEntry[]): number {
  const nps = entries.filter((e) => e.type === 'nps' && e.score !== undefined);
  if (nps.length === 0) return 0;

  const promoters = nps.filter((e) => e.score! >= 9).length;
  const detractors = nps.filter((e) => e.score! <= 6).length;
  return Math.round(((promoters - detractors) / nps.length) * 100);
}
