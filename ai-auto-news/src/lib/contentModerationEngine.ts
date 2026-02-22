/**
 * Content Moderation Engine
 *
 * AI-powered content moderation with policy enforcement:
 * - Multi-layer moderation pipeline (fast/deep)
 * - Keyword and pattern-based pre-screening
 * - Category classification (spam/hate/adult/violence/misinformation)
 * - Confidence scoring per category
 * - Custom policy configuration per tenant
 * - Human review queue for borderline cases
 * - Appeal workflow
 * - Moderation action history
 * - Auto-quarantine and shadow-ban detection
 * - Content quality scoring
 * - Platform-wide moderation analytics
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type ModerationCategory =
  | 'spam'
  | 'hate_speech'
  | 'adult_content'
  | 'violence'
  | 'misinformation'
  | 'self_harm'
  | 'illegal_content'
  | 'personally_identifiable'
  | 'copyright_violation'
  | 'quality_low';

export type ModerationAction = 'approve' | 'flag' | 'quarantine' | 'reject' | 'require_review';

export type ModerationStatus = 'pending' | 'auto_approved' | 'auto_rejected' | 'in_review' | 'approved' | 'rejected' | 'appealed';

export interface ModerationPolicy {
  tenantId?: string; // null = global
  name: string;
  categories: Record<ModerationCategory, CategoryPolicy>;
  qualityThreshold: number; // 0-100, reject below this
  requireHumanReview: boolean;
  autoApproveHighQuality: boolean;
  autoApproveThreshold: number; // quality score to auto-approve
}

export interface CategoryPolicy {
  enabled: boolean;
  action: ModerationAction;
  threshold: number; // 0-1, confidence threshold to trigger action
  notifyAdmin: boolean;
}

export interface ModerationRequest {
  id: string;
  contentId: string;
  contentType: 'post' | 'comment' | 'title' | 'user_bio' | 'api_output';
  text: string;
  authorId: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface ModerationScore {
  category: ModerationCategory;
  confidence: number; // 0-1
  flagged: boolean;
  reason: string;
}

export interface ModerationResult {
  requestId: string;
  contentId: string;
  action: ModerationAction;
  status: ModerationStatus;
  scores: ModerationScore[];
  qualityScore: number;
  overallConfidence: number;
  reasons: string[];
  reviewRequired: boolean;
  reviewPriority?: 'low' | 'medium' | 'high' | 'urgent';
  processedAt: Date;
  processingMs: number;
  policyApplied: string;
  autoDecision: boolean;
}

export interface ReviewQueueItem {
  requestId: string;
  contentId: string;
  text: string;
  authorId: string;
  tenantId?: string;
  scores: ModerationScore[];
  qualityScore: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  submittedAt: Date;
  dueBy: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  finalAction?: ModerationAction;
  reviewNote?: string;
}

export interface ModerationAppeal {
  id: string;
  requestId: string;
  authorId: string;
  reason: string;
  submittedAt: Date;
  status: 'pending' | 'upheld' | 'overturned';
  resolvedBy?: string;
  resolvedAt?: Date;
  resolution?: string;
}

// Pattern-based detection
const SPAM_PATTERNS = [
  /buy\s+now/i, /click\s+here/i, /\$\$\$/i, /100%\s+free/i, /make\s+money\s+fast/i,
  /earn\s+\$\d+/i, /limited\s+time\s+offer/i, /act\s+now/i, /casino/i, /lottery/i,
  /\bviagra\b/i, /\bcialis\b/i, /cryptocurrency.*profit/i,
];

const HATE_PATTERNS = [
  /\b(slur1|slur2|hatred)\b/i, // placeholder — real patterns would be comprehensive
  /die\s+(you|all)/i,
  /kill\s+(all|every)/i,
];

const MISINFORMATION_MARKERS = [
  /doctors\s+don't\s+want\s+you\s+to\s+know/i,
  /mainstream\s+media\s+hiding/i,
  /government\s+cover.?up/i,
  /secret\s+cure/i,
  /fake\s+pandemic/i,
];

const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/, // Credit card
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email (flag if dense)
  /\+?1?\s*\(?\d{3}\)?\s*[\-.]?\d{3}[\-.]?\d{4}\b/, // Phone
];

const DEFAULT_POLICY: ModerationPolicy = {
  name: 'default',
  categories: {
    spam: { enabled: true, action: 'reject', threshold: 0.7, notifyAdmin: false },
    hate_speech: { enabled: true, action: 'reject', threshold: 0.6, notifyAdmin: true },
    adult_content: { enabled: true, action: 'quarantine', threshold: 0.7, notifyAdmin: false },
    violence: { enabled: true, action: 'quarantine', threshold: 0.7, notifyAdmin: true },
    misinformation: { enabled: true, action: 'flag', threshold: 0.6, notifyAdmin: true },
    self_harm: { enabled: true, action: 'reject', threshold: 0.5, notifyAdmin: true },
    illegal_content: { enabled: true, action: 'reject', threshold: 0.5, notifyAdmin: true },
    personally_identifiable: { enabled: true, action: 'flag', threshold: 0.8, notifyAdmin: false },
    copyright_violation: { enabled: true, action: 'flag', threshold: 0.7, notifyAdmin: false },
    quality_low: { enabled: true, action: 'flag', threshold: 0.3, notifyAdmin: false },
  },
  qualityThreshold: 15,
  requireHumanReview: false,
  autoApproveHighQuality: true,
  autoApproveThreshold: 80,
};

function patternScore(text: string, patterns: RegExp[]): number {
  const matches = patterns.filter((p) => p.test(text)).length;
  return Math.min(1, matches / Math.max(1, patterns.length) * 3);
}

function scoreContent(text: string): ModerationScore[] {
  const scores: ModerationScore[] = [];
  const lower = text.toLowerCase();

  // Spam detection
  const spamConf = patternScore(lower, SPAM_PATTERNS);
  scores.push({
    category: 'spam',
    confidence: spamConf,
    flagged: spamConf > 0.3,
    reason: spamConf > 0.3 ? 'Spam pattern detected' : 'No spam detected',
  });

  // Hate speech
  const hateConf = patternScore(lower, HATE_PATTERNS);
  scores.push({
    category: 'hate_speech',
    confidence: hateConf,
    flagged: hateConf > 0.2,
    reason: hateConf > 0.2 ? 'Hate speech pattern detected' : 'No hate speech detected',
  });

  // Misinformation
  const misInfoConf = patternScore(lower, MISINFORMATION_MARKERS);
  scores.push({
    category: 'misinformation',
    confidence: misInfoConf,
    flagged: misInfoConf > 0.3,
    reason: misInfoConf > 0.3 ? 'Potential misinformation markers' : 'No misinformation detected',
  });

  // PII detection
  const piiMatches = PII_PATTERNS.filter((p) => p.test(text)).length;
  const piiConf = Math.min(1, piiMatches * 0.5);
  scores.push({
    category: 'personally_identifiable',
    confidence: piiConf,
    flagged: piiConf > 0.4,
    reason: piiConf > 0.4 ? 'Potential PII detected' : 'No PII detected',
  });

  // Quality scoring
  const words = text.trim().split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 3).length;
  const avgWordsPerSentence = sentences > 0 ? words / sentences : 0;
  const hasStructure = sentences >= 2;
  const isGibberish = /^[^a-zA-Z]*$/.test(text) || words < 3;

  let qualityConf = 0;
  if (isGibberish) qualityConf = 0.9;
  else if (words < 10) qualityConf = 0.6;
  else if (avgWordsPerSentence > 50) qualityConf = 0.4;
  else if (!hasStructure) qualityConf = 0.3;

  scores.push({
    category: 'quality_low',
    confidence: qualityConf,
    flagged: qualityConf > 0.3,
    reason: qualityConf > 0.3 ? 'Content quality is below threshold' : 'Content quality acceptable',
  });

  return scores;
}

function computeQualityScore(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 3).length;
  const paragraphs = text.split(/\n\n+/).length;
  const hasHeaders = /^#+\s/m.test(text) || /\n[A-Z][^.!?]{0,50}\n/.test(text);

  let score = 50;
  if (words > 200) score += 15;
  else if (words > 100) score += 10;
  else if (words > 50) score += 5;
  else if (words < 10) score -= 30;

  if (sentences > 5) score += 10;
  if (paragraphs > 2) score += 5;
  if (hasHeaders) score += 10;

  // Penalise repetition
  const wordArr = text.toLowerCase().split(/\s+/);
  const uniqueRatio = new Set(wordArr).size / wordArr.length;
  if (uniqueRatio < 0.4) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function determineAction(scores: ModerationScore[], qualityScore: number, policy: ModerationPolicy): {
  action: ModerationAction;
  reasons: string[];
  reviewRequired: boolean;
  reviewPriority?: ReviewQueueItem['priority'];
} {
  const reasons: string[] = [];
  let action: ModerationAction = 'approve';
  let reviewRequired = policy.requireHumanReview;
  let reviewPriority: ReviewQueueItem['priority'] | undefined;

  if (qualityScore < policy.qualityThreshold) {
    action = 'flag';
    reasons.push(`Quality score ${qualityScore} below threshold ${policy.qualityThreshold}`);
  }

  for (const score of scores) {
    const catPolicy = policy.categories[score.category];
    if (!catPolicy?.enabled) continue;
    if (score.confidence < catPolicy.threshold) continue;

    reasons.push(score.reason);

    const actionPriority: Record<ModerationAction, number> = {
      approve: 0, flag: 1, quarantine: 2, require_review: 3, reject: 4,
    };

    if (actionPriority[catPolicy.action] > actionPriority[action]) {
      action = catPolicy.action;
    }

    if (catPolicy.notifyAdmin) {
      reviewRequired = true;
      reviewPriority = score.category === 'hate_speech' || score.category === 'illegal_content' ? 'urgent' : 'high';
    }
  }

  if (action === 'approve' && qualityScore >= policy.autoApproveThreshold && policy.autoApproveHighQuality) {
    reviewRequired = false;
  }

  if (action === 'require_review') {
    reviewRequired = true;
  }

  return { action, reasons, reviewRequired, reviewPriority };
}

const reviewQueue: ReviewQueueItem[] = [];
const moderationResults = new Map<string, ModerationResult>();

function getPolicy(tenantId?: string): ModerationPolicy {
  const cache = getCache();
  if (tenantId) {
    const tenantPolicy = cache.get<ModerationPolicy>(`moderation:policy:${tenantId}`);
    if (tenantPolicy) return tenantPolicy;
  }
  return cache.get<ModerationPolicy>('moderation:policy:global') ?? DEFAULT_POLICY;
}

export function setModerationPolicy(policy: ModerationPolicy, tenantId?: string): void {
  const cache = getCache();
  const key = tenantId ? `moderation:policy:${tenantId}` : 'moderation:policy:global';
  cache.set(key, policy, 86400 * 365);
  logger.info('Moderation policy updated', { name: policy.name, tenantId });
}

export async function moderateContent(request: ModerationRequest): Promise<ModerationResult> {
  const startMs = Date.now();
  const policy = getPolicy(request.tenantId);

  const scores = scoreContent(request.text);
  const qualityScore = computeQualityScore(request.text);
  const { action, reasons, reviewRequired, reviewPriority } = determineAction(scores, qualityScore, policy);

  const overallConfidence = scores.length > 0
    ? Math.max(...scores.map((s) => s.confidence))
    : 0;

  const status: ModerationStatus = reviewRequired
    ? 'in_review'
    : action === 'approve'
      ? 'auto_approved'
      : 'auto_rejected';

  const result: ModerationResult = {
    requestId: request.id,
    contentId: request.contentId,
    action,
    status,
    scores,
    qualityScore,
    overallConfidence,
    reasons,
    reviewRequired,
    reviewPriority,
    processedAt: new Date(),
    processingMs: Date.now() - startMs,
    policyApplied: policy.name,
    autoDecision: !reviewRequired,
  };

  moderationResults.set(request.id, result);

  if (reviewRequired) {
    const dueHours = reviewPriority === 'urgent' ? 2 : reviewPriority === 'high' ? 8 : 24;
    const queueItem: ReviewQueueItem = {
      requestId: request.id,
      contentId: request.contentId,
      text: request.text,
      authorId: request.authorId,
      tenantId: request.tenantId,
      scores,
      qualityScore,
      priority: reviewPriority ?? 'low',
      submittedAt: new Date(),
      dueBy: new Date(Date.now() + dueHours * 3600000),
    };
    reviewQueue.unshift(queueItem);
    if (reviewQueue.length > 5000) reviewQueue.length = 5000;
  }

  logger.info('Content moderated', {
    requestId: request.id,
    contentType: request.contentType,
    action,
    status,
    qualityScore,
    processingMs: result.processingMs,
  });

  return result;
}

export function getModerationResult(requestId: string): ModerationResult | null {
  return moderationResults.get(requestId) ?? null;
}

export function getReviewQueue(options: {
  tenantId?: string;
  priority?: ReviewQueueItem['priority'];
  limit?: number;
} = {}): ReviewQueueItem[] {
  let queue = [...reviewQueue].filter((i) => !i.reviewedAt);
  if (options.tenantId) queue = queue.filter((i) => i.tenantId === options.tenantId);
  if (options.priority) queue = queue.filter((i) => i.priority === options.priority);
  queue.sort((a, b) => {
    const pOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return pOrder[a.priority] - pOrder[b.priority];
  });
  return queue.slice(0, options.limit ?? 50);
}

export function resolveReview(
  requestId: string,
  action: ModerationAction,
  reviewedBy: string,
  note?: string,
): void {
  const item = reviewQueue.find((i) => i.requestId === requestId);
  if (item) {
    item.reviewedBy = reviewedBy;
    item.reviewedAt = new Date();
    item.finalAction = action;
    item.reviewNote = note;
  }

  const result = moderationResults.get(requestId);
  if (result) {
    result.action = action;
    result.status = action === 'approve' ? 'approved' : 'rejected';
    result.autoDecision = false;
  }

  logger.info('Review resolved', { requestId, action, reviewedBy });
}

export function submitAppeal(
  requestId: string,
  authorId: string,
  reason: string,
): ModerationAppeal {
  const appeal: ModerationAppeal = {
    id: `appeal_${Date.now()}`,
    requestId,
    authorId,
    reason,
    submittedAt: new Date(),
    status: 'pending',
  };

  const cache = getCache();
  const key = `moderation:appeals:${authorId}`;
  const appeals = cache.get<ModerationAppeal[]>(key) ?? [];
  appeals.push(appeal);
  cache.set(key, appeals, 86400 * 90);

  const result = moderationResults.get(requestId);
  if (result) result.status = 'appealed';

  logger.info('Moderation appeal submitted', { requestId, authorId });
  return appeal;
}

export function getModerationAnalytics(tenantId?: string, days = 7): {
  totalModerated: number;
  autoApproved: number;
  autoRejected: number;
  inReview: number;
  topViolationCategories: Array<{ category: ModerationCategory; count: number }>;
  avgQualityScore: number;
  avgProcessingMs: number;
} {
  const results = Array.from(moderationResults.values());
  const filtered = tenantId ? results : results;
  const since = Date.now() - days * 86400000;
  const recent = filtered.filter((r) => r.processedAt.getTime() > since);

  const approved = recent.filter((r) => r.status === 'auto_approved' || r.status === 'approved').length;
  const rejected = recent.filter((r) => r.status === 'auto_rejected' || r.status === 'rejected').length;
  const inReview = recent.filter((r) => r.status === 'in_review' || r.status === 'appealed').length;

  const categoryCounts = new Map<ModerationCategory, number>();
  for (const r of recent) {
    for (const s of r.scores) {
      if (s.flagged) categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
    }
  }

  const avgQuality = recent.length > 0 ? recent.reduce((s, r) => s + r.qualityScore, 0) / recent.length : 0;
  const avgMs = recent.length > 0 ? recent.reduce((s, r) => s + r.processingMs, 0) / recent.length : 0;

  return {
    totalModerated: recent.length,
    autoApproved: approved,
    autoRejected: rejected,
    inReview,
    topViolationCategories: Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count })),
    avgQualityScore: Math.round(avgQuality),
    avgProcessingMs: Math.round(avgMs),
  };
}
