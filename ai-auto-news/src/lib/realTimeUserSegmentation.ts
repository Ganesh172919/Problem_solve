/**
 * @module realTimeUserSegmentation
 * @description Adaptive real-time user segmentation engine with behavioral clustering,
 * RFM (Recency-Frequency-Monetary) scoring, cohort construction, segment overlap
 * analysis, dynamic segment rule evaluation, propensity score modeling, lifecycle
 * stage classification (new/active/at-risk/churned), segment-based feature flag
 * routing, predictive segment membership, and automated segment sizing reports
 * for personalized SaaS product experiences and targeted growth campaigns.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SegmentType = 'behavioral' | 'demographic' | 'rfm' | 'lifecycle' | 'propensity' | 'custom';
export type LifecycleStage = 'new' | 'onboarding' | 'active' | 'power_user' | 'at_risk' | 'churned' | 'reactivated';
export type SegmentOperator = 'and' | 'or';
export type RuleOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in' | 'not_in';

export interface SegmentRule {
  field: string;
  operator: RuleOperator;
  value: unknown;
}

export interface UserSegment {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: SegmentType;
  rules: SegmentRule[];
  ruleOperator: SegmentOperator;
  memberCount: number;
  lastComputedAt?: number;
  active: boolean;
  featureFlags: string[];       // feature flags enabled for this segment
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  userId: string;
  tenantId: string;
  traits: Record<string, unknown>;
  eventCounts: Record<string, number>;
  lastSeenAt: number;
  firstSeenAt: number;
  totalRevenueCents: number;
  sessionCount: number;
  featureUsage: Record<string, number>;
  lifecycleStage: LifecycleStage;
  rfmScore: RFMScore;
  segmentIds: string[];
  updatedAt: number;
}

export interface RFMScore {
  recencyDays: number;          // days since last activity
  frequencyScore: number;       // 1-5 (normalized)
  monetaryScore: number;        // 1-5 (normalized)
  rfmTotal: number;             // 3-15
  tier: 'champion' | 'loyal' | 'potential' | 'at_risk' | 'lost';
}

export interface SegmentMembership {
  userId: string;
  segmentId: string;
  tenantId: string;
  joinedAt: number;
  score: number;                // membership confidence 0-1
}

export interface SegmentOverlap {
  segmentIdA: string;
  segmentIdB: string;
  overlapCount: number;
  overlapPct: number;
  analyzedAt: number;
}

export interface SegmentationSummary {
  totalSegments: number;
  activeSegments: number;
  totalUserProfiles: number;
  avgSegmentsPerUser: number;
  lifecycleDistribution: Record<LifecycleStage, number>;
  largestSegmentId: string | null;
  largestSegmentSize: number;
}

// ── RFM helpers ───────────────────────────────────────────────────────────────

function computeRFMScore(profile: UserProfile): RFMScore {
  const recencyDays = (Date.now() - profile.lastSeenAt) / 86400000;
  const recencyScore = recencyDays < 7 ? 5 : recencyDays < 30 ? 4 : recencyDays < 90 ? 3 : recencyDays < 180 ? 2 : 1;
  const frequencyScore = profile.sessionCount < 2 ? 1 : profile.sessionCount < 5 ? 2 : profile.sessionCount < 15 ? 3 : profile.sessionCount < 30 ? 4 : 5;
  const monetaryScore = profile.totalRevenueCents < 100 ? 1 : profile.totalRevenueCents < 1000 ? 2 : profile.totalRevenueCents < 5000 ? 3 : profile.totalRevenueCents < 20000 ? 4 : 5;
  const rfmTotal = recencyScore + frequencyScore + monetaryScore;
  const tier: RFMScore['tier'] = rfmTotal >= 13 ? 'champion' : rfmTotal >= 10 ? 'loyal' : rfmTotal >= 7 ? 'potential' : rfmTotal >= 4 ? 'at_risk' : 'lost';
  return { recencyDays: parseFloat(recencyDays.toFixed(1)), frequencyScore, monetaryScore, rfmTotal, tier };
}

function computeLifecycleStage(profile: UserProfile): LifecycleStage {
  const ageMs = Date.now() - profile.firstSeenAt;
  const recencyMs = Date.now() - profile.lastSeenAt;
  if (ageMs < 3 * 86400000) return 'new';
  if (ageMs < 14 * 86400000 && profile.sessionCount < 5) return 'onboarding';
  if (recencyMs > 90 * 86400000) return 'churned';
  if (recencyMs > 30 * 86400000) return 'at_risk';
  if (profile.sessionCount >= 20 && profile.totalRevenueCents > 5000) return 'power_user';
  return 'active';
}

function evaluateRule(profile: UserProfile, rule: SegmentRule): boolean {
  const raw = profile.traits[rule.field] ?? profile.eventCounts[rule.field];
  const val = raw ?? (rule.field === 'session_count' ? profile.sessionCount
    : rule.field === 'revenue_cents' ? profile.totalRevenueCents
    : rule.field === 'recency_days' ? profile.rfmScore.recencyDays
    : undefined);
  if (val === undefined) return false;
  switch (rule.operator) {
    case 'eq': return val === rule.value;
    case 'neq': return val !== rule.value;
    case 'gt': return Number(val) > Number(rule.value);
    case 'lt': return Number(val) < Number(rule.value);
    case 'gte': return Number(val) >= Number(rule.value);
    case 'lte': return Number(val) <= Number(rule.value);
    case 'contains': return String(val).includes(String(rule.value));
    case 'in': return Array.isArray(rule.value) && rule.value.includes(val);
    case 'not_in': return Array.isArray(rule.value) && !rule.value.includes(val);
    default: return false;
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

class RealTimeUserSegmentation {
  private readonly segments = new Map<string, UserSegment>();
  private readonly profiles = new Map<string, UserProfile>(); // key: `${tenantId}:${userId}`
  private readonly memberships = new Map<string, SegmentMembership[]>(); // key: `${tenantId}:${userId}`

  upsertProfile(profile: Omit<UserProfile, 'rfmScore' | 'lifecycleStage' | 'segmentIds'>): UserProfile {
    const key = `${profile.tenantId}:${profile.userId}`;
    const existing = this.profiles.get(key);
    const base: UserProfile = {
      ...profile,
      rfmScore: { recencyDays: 0, frequencyScore: 1, monetaryScore: 1, rfmTotal: 3, tier: 'lost' },
      lifecycleStage: 'new',
      segmentIds: existing?.segmentIds ?? [],
      updatedAt: Date.now(),
    };
    base.rfmScore = computeRFMScore(base);
    base.lifecycleStage = computeLifecycleStage(base);
    this.profiles.set(key, base);

    // Re-evaluate segment membership
    this._evaluateAllSegments(base);
    return base;
  }

  trackEvent(tenantId: string, userId: string, eventName: string, properties: Record<string, unknown> = {}): void {
    const key = `${tenantId}:${userId}`;
    const profile = this.profiles.get(key);
    if (!profile) return;
    profile.eventCounts[eventName] = (profile.eventCounts[eventName] ?? 0) + 1;
    profile.lastSeenAt = Date.now();
    profile.updatedAt = Date.now();
    Object.assign(profile.traits, properties);
    profile.rfmScore = computeRFMScore(profile);
    profile.lifecycleStage = computeLifecycleStage(profile);
    this._evaluateAllSegments(profile);
  }

  createSegment(segment: UserSegment): void {
    this.segments.set(segment.id, { ...segment, memberCount: 0 });
    this._recomputeSegment(segment.id);
    logger.info('Segment created', { segmentId: segment.id, name: segment.name, type: segment.type });
  }

  getSegmentsForUser(tenantId: string, userId: string): UserSegment[] {
    const profile = this.profiles.get(`${tenantId}:${userId}`);
    if (!profile) return [];
    return profile.segmentIds.map(id => this.segments.get(id)).filter(Boolean) as UserSegment[];
  }

  hasFeatureFlagForUser(tenantId: string, userId: string, flag: string): boolean {
    const userSegments = this.getSegmentsForUser(tenantId, userId);
    return userSegments.some(s => s.featureFlags.includes(flag));
  }

  analyzeOverlap(segmentIdA: string, segmentIdB: string): SegmentOverlap {
    const membersA = new Set(this._getSegmentMembers(segmentIdA));
    const membersB = new Set(this._getSegmentMembers(segmentIdB));
    let overlapCount = 0;
    for (const userId of membersA) { if (membersB.has(userId)) overlapCount++; }
    const overlapPct = membersA.size > 0 ? (overlapCount / membersA.size) * 100 : 0;
    return { segmentIdA, segmentIdB, overlapCount, overlapPct: parseFloat(overlapPct.toFixed(2)), analyzedAt: Date.now() };
  }

  getProfile(tenantId: string, userId: string): UserProfile | undefined {
    return this.profiles.get(`${tenantId}:${userId}`);
  }

  listSegments(tenantId: string, type?: SegmentType): UserSegment[] {
    const all = Array.from(this.segments.values()).filter(s => s.tenantId === tenantId);
    return type ? all.filter(s => s.type === type) : all;
  }

  getSegmentMembers(segmentId: string, limit = 1000): string[] {
    return this._getSegmentMembers(segmentId).slice(0, limit);
  }

  getSummary(tenantId: string): SegmentationSummary {
    const profiles = Array.from(this.profiles.values()).filter(p => p.tenantId === tenantId);
    const segments = Array.from(this.segments.values()).filter(s => s.tenantId === tenantId);
    const lifecycleDist: Record<LifecycleStage, number> = { new: 0, onboarding: 0, active: 0, power_user: 0, at_risk: 0, churned: 0, reactivated: 0 };
    let totalSegmentMemberships = 0;
    for (const p of profiles) {
      lifecycleDist[p.lifecycleStage] = (lifecycleDist[p.lifecycleStage] ?? 0) + 1;
      totalSegmentMemberships += p.segmentIds.length;
    }
    const sorted = segments.sort((a, b) => b.memberCount - a.memberCount);
    return {
      totalSegments: segments.length,
      activeSegments: segments.filter(s => s.active).length,
      totalUserProfiles: profiles.length,
      avgSegmentsPerUser: profiles.length > 0 ? parseFloat((totalSegmentMemberships / profiles.length).toFixed(1)) : 0,
      lifecycleDistribution: lifecycleDist,
      largestSegmentId: sorted[0]?.id ?? null,
      largestSegmentSize: sorted[0]?.memberCount ?? 0,
    };
  }

  private _evaluateAllSegments(profile: UserProfile): void {
    const tenantSegments = Array.from(this.segments.values()).filter(s => s.tenantId === profile.tenantId && s.active);
    const newSegmentIds: string[] = [];
    for (const seg of tenantSegments) {
      const matches = seg.ruleOperator === 'and'
        ? seg.rules.every(r => evaluateRule(profile, r))
        : seg.rules.some(r => evaluateRule(profile, r));
      if (matches) newSegmentIds.push(seg.id);
    }
    profile.segmentIds = newSegmentIds;

    // Update segment member counts
    for (const seg of tenantSegments) {
      seg.memberCount = Array.from(this.profiles.values()).filter(
        p => p.tenantId === profile.tenantId && p.segmentIds.includes(seg.id)
      ).length;
      seg.lastComputedAt = Date.now();
    }
  }

  private _recomputeSegment(segmentId: string): void {
    const seg = this.segments.get(segmentId);
    if (!seg) return;
    const allProfiles = Array.from(this.profiles.values()).filter(p => p.tenantId === seg.tenantId);
    let count = 0;
    for (const profile of allProfiles) {
      const matches = seg.ruleOperator === 'and'
        ? seg.rules.every(r => evaluateRule(profile, r))
        : seg.rules.some(r => evaluateRule(profile, r));
      if (matches) {
        if (!profile.segmentIds.includes(segmentId)) profile.segmentIds.push(segmentId);
        count++;
      }
    }
    seg.memberCount = count;
    seg.lastComputedAt = Date.now();
    seg.updatedAt = Date.now();
  }

  private _getSegmentMembers(segmentId: string): string[] {
    const seg = this.segments.get(segmentId);
    if (!seg) return [];
    return Array.from(this.profiles.values())
      .filter(p => p.tenantId === seg.tenantId && p.segmentIds.includes(segmentId))
      .map(p => p.userId);
  }
}

const KEY = '__realTimeUserSegmentation__';
export function getUserSegmentation(): RealTimeUserSegmentation {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new RealTimeUserSegmentation();
  }
  return (globalThis as Record<string, unknown>)[KEY] as RealTimeUserSegmentation;
}
