/**
 * Dynamic Content Engine
 *
 * Provides:
 * - Dynamic content personalization by user segment (rule-based matching)
 * - Rule-based content variation engine with priority ordering
 * - AI-driven content block assembly (slot-based layout)
 * - Multi-variant content testing (traffic splitting by hash)
 * - Real-time content assembly pipeline
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface UserSegment {
  id: string;
  name: string;
  description?: string;
  criteria: SegmentCriteria[];
  priority: number; // higher = evaluated first
  active: boolean;
}

export interface SegmentCriteria {
  field: string; // e.g. 'plan', 'country', 'daysSinceSignup', 'totalOrders'
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'contains' | 'startsWith';
  value: string | number | boolean | (string | number)[];
}

export interface ContentVariant {
  id: string;
  name: string;
  slotId: string;
  segmentId?: string; // if null → fallback/default
  weight: number; // for traffic splitting 0-100
  content: ContentBlock;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ContentBlock {
  id: string;
  type: 'hero' | 'banner' | 'cta' | 'testimonial' | 'feature-list' | 'pricing-table' | 'article' | 'widget' | 'custom';
  headline?: string;
  subheadline?: string;
  body?: string;
  imageUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  tags: string[];
  props: Record<string, unknown>;
}

export interface ContentSlot {
  id: string;
  name: string;
  description?: string;
  pageId: string;
  position: number; // render order
  required: boolean;
  defaultVariantId?: string;
  allowedTypes: ContentBlock['type'][];
}

export interface PersonalizationRule {
  id: string;
  name: string;
  description?: string;
  priority: number; // higher = evaluated first
  segmentId: string;
  slotId: string;
  variantId: string;
  conditions: SegmentCriteria[]; // additional conditions beyond segment
  active: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

export interface VariantTest {
  id: string;
  name: string;
  slotId: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: Array<{
    variantId: string;
    trafficAllocation: number; // 0-100, must sum to 100
    impressions: number;
    conversions: number;
    conversionRate: number;
  }>;
  winnerVariantId?: string;
  significanceLevel: number; // e.g. 0.95
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

export interface AssemblyContext {
  userId: string;
  sessionId: string;
  pageId: string;
  userAttributes: Record<string, string | number | boolean>;
  timestamp: Date;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  locale: string;
  referrer?: string;
}

export interface RenderResult {
  pageId: string;
  userId: string;
  slots: Array<{
    slotId: string;
    slotName: string;
    variantId: string;
    block: ContentBlock;
    matchedRuleId?: string;
    matchedSegmentId?: string;
    isTestVariant: boolean;
    testId?: string;
  }>;
  segmentsMatched: string[];
  assemblyDurationMs: number;
  assembledAt: Date;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class DynamicContentEngine {
  private segments: Map<string, UserSegment> = new Map();
  private variants: Map<string, ContentVariant> = new Map();
  private slots: Map<string, ContentSlot> = new Map();
  private rules: Map<string, PersonalizationRule> = new Map();
  private tests: Map<string, VariantTest> = new Map();
  private variantPerformance: Map<string, { impressions: number; conversions: number }> = new Map();

  // ─── Segment Management ───────────────────────────────────────────────────

  addSegment(segment: UserSegment): UserSegment {
    this.segments.set(segment.id, segment);
    logger.info('Segment added', { id: segment.id, name: segment.name });
    return segment;
  }

  addSlot(slot: ContentSlot): ContentSlot {
    this.slots.set(slot.id, slot);
    logger.info('Slot added', { id: slot.id, name: slot.name, pageId: slot.pageId });
    return slot;
  }

  addVariant(variant: ContentVariant): ContentVariant {
    this.variants.set(variant.id, variant);
    if (!this.variantPerformance.has(variant.id)) {
      this.variantPerformance.set(variant.id, { impressions: 0, conversions: 0 });
    }
    logger.info('Variant added', { id: variant.id, name: variant.name, slotId: variant.slotId });
    return variant;
  }

  addRule(rule: PersonalizationRule): PersonalizationRule {
    this.rules.set(rule.id, rule);
    logger.info('Personalization rule added', { id: rule.id, name: rule.name, priority: rule.priority });
    return rule;
  }

  // ─── Rule Evaluation ──────────────────────────────────────────────────────

  evaluateRules(context: AssemblyContext, slotId: string): PersonalizationRule | null {
    const now = new Date();
    const applicableRules = Array.from(this.rules.values())
      .filter((r) =>
        r.active &&
        r.slotId === slotId &&
        (!r.expiresAt || r.expiresAt > now),
      )
      .sort((a, b) => b.priority - a.priority);

    for (const rule of applicableRules) {
      const segmentMatches = this.userMatchesSegment(context, rule.segmentId);
      const conditionsMatch = rule.conditions.every((c) => this.evaluateCriteria(context.userAttributes, c));
      if (segmentMatches && conditionsMatch) {
        return rule;
      }
    }
    return null;
  }

  private userMatchesSegment(context: AssemblyContext, segmentId: string): boolean {
    const segment = this.segments.get(segmentId);
    if (!segment || !segment.active) return false;
    return segment.criteria.every((c) => this.evaluateCriteria(context.userAttributes, c));
  }

  private evaluateCriteria(attrs: Record<string, string | number | boolean>, criteria: SegmentCriteria): boolean {
    const attrValue = attrs[criteria.field];
    if (attrValue === undefined) return false;
    const { operator, value } = criteria;

    switch (operator) {
      case 'eq': return attrValue === value;
      case 'neq': return attrValue !== value;
      case 'gt': return typeof attrValue === 'number' && typeof value === 'number' && attrValue > value;
      case 'gte': return typeof attrValue === 'number' && typeof value === 'number' && attrValue >= value;
      case 'lt': return typeof attrValue === 'number' && typeof value === 'number' && attrValue < value;
      case 'lte': return typeof attrValue === 'number' && typeof value === 'number' && attrValue <= value;
      case 'in': return Array.isArray(value) && (value as (string | number)[]).includes(attrValue as string | number);
      case 'notIn': return Array.isArray(value) && !(value as (string | number)[]).includes(attrValue as string | number);
      case 'contains': return typeof attrValue === 'string' && typeof value === 'string' && attrValue.includes(value);
      case 'startsWith': return typeof attrValue === 'string' && typeof value === 'string' && attrValue.startsWith(value);
      default: return false;
    }
  }

  // ─── Traffic Splitting (Hash-based) ──────────────────────────────────────

  splitTraffic(userId: string, testId: string): string | null {
    const test = this.tests.get(testId);
    if (!test || test.status !== 'running') return null;

    // Deterministic hash: userId + testId → bucket 0-99
    const hash = this.deterministicHash(`${userId}:${testId}`);
    const bucket = hash % 100;

    let cumulative = 0;
    for (const variant of test.variants) {
      cumulative += variant.trafficAllocation;
      if (bucket < cumulative) return variant.variantId;
    }
    return test.variants[test.variants.length - 1]?.variantId ?? null;
  }

  private deterministicHash(input: string): number {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return hash;
  }

  // ─── Content Assembly Pipeline ────────────────────────────────────────────

  assembleContent(context: AssemblyContext): RenderResult {
    const start = Date.now();
    const cacheKey = `assembly:${context.userId}:${context.pageId}:${context.sessionId}`;
    const cached = cache.get<RenderResult>(cacheKey);
    if (cached) return cached;

    const pageSlots = Array.from(this.slots.values())
      .filter((s) => s.pageId === context.pageId)
      .sort((a, b) => a.position - b.position);

    const segmentsMatched = this.matchUserSegments(context);

    const assembledSlots: RenderResult['slots'] = [];

    for (const slot of pageSlots) {
      const slotResult = this.resolveSlot(slot, context, segmentsMatched);
      if (slotResult) assembledSlots.push(slotResult);
    }

    const result: RenderResult = {
      pageId: context.pageId,
      userId: context.userId,
      slots: assembledSlots,
      segmentsMatched,
      assemblyDurationMs: Date.now() - start,
      assembledAt: new Date(),
    };

    // Track impressions
    assembledSlots.forEach((s) => {
      const perf = this.variantPerformance.get(s.variantId);
      if (perf) perf.impressions++;
    });

    cache.set(cacheKey, result, 60); // short TTL for real-time personalization
    logger.info('Content assembled', { userId: context.userId, pageId: context.pageId, slotCount: assembledSlots.length, durationMs: result.assemblyDurationMs });
    return result;
  }

  private matchUserSegments(context: AssemblyContext): string[] {
    return Array.from(this.segments.values())
      .filter((s) => s.active && s.criteria.every((c) => this.evaluateCriteria(context.userAttributes, c)))
      .sort((a, b) => b.priority - a.priority)
      .map((s) => s.id);
  }

  private resolveSlot(slot: ContentSlot, context: AssemblyContext, segmentsMatched: string[]): RenderResult['slots'][0] | null {
    // 1. Check active A/B tests for this slot
    const activeTest = Array.from(this.tests.values()).find((t) => t.status === 'running' && t.slotId === slot.id);
    if (activeTest) {
      const testVariantId = this.splitTraffic(context.userId, activeTest.id);
      if (testVariantId) {
        const variant = this.variants.get(testVariantId);
        if (variant && variant.active && slot.allowedTypes.includes(variant.content.type)) {
          return {
            slotId: slot.id,
            slotName: slot.name,
            variantId: testVariantId,
            block: variant.content,
            isTestVariant: true,
            testId: activeTest.id,
          };
        }
      }
    }

    // 2. Check personalization rules (highest priority first)
    const matchedRule = this.evaluateRules(context, slot.id);
    if (matchedRule) {
      const variant = this.variants.get(matchedRule.variantId);
      if (variant && variant.active) {
        return {
          slotId: slot.id,
          slotName: slot.name,
          variantId: matchedRule.variantId,
          block: variant.content,
          matchedRuleId: matchedRule.id,
          matchedSegmentId: matchedRule.segmentId,
          isTestVariant: false,
        };
      }
    }

    // 3. Segment-based variant matching (highest priority segment first)
    for (const segmentId of segmentsMatched) {
      const segmentVariants = Array.from(this.variants.values()).filter(
        (v) => v.active && v.slotId === slot.id && v.segmentId === segmentId,
      );
      if (segmentVariants.length > 0) {
        // Weighted random selection within segment variants
        const selected = this.weightedSelect(segmentVariants, context.userId + slot.id);
        if (selected) {
          return {
            slotId: slot.id,
            slotName: slot.name,
            variantId: selected.id,
            block: selected.content,
            matchedSegmentId: segmentId,
            isTestVariant: false,
          };
        }
      }
    }

    // 4. Default variant fallback
    const defaultVariantId = slot.defaultVariantId;
    if (defaultVariantId) {
      const variant = this.variants.get(defaultVariantId);
      if (variant && variant.active) {
        return {
          slotId: slot.id,
          slotName: slot.name,
          variantId: defaultVariantId,
          block: variant.content,
          isTestVariant: false,
        };
      }
    }

    // 5. Any active variant for slot (fallback of last resort)
    const anyVariant = Array.from(this.variants.values()).find((v) => v.active && v.slotId === slot.id && !v.segmentId);
    if (anyVariant) {
      return {
        slotId: slot.id,
        slotName: slot.name,
        variantId: anyVariant.id,
        block: anyVariant.content,
        isTestVariant: false,
      };
    }

    if (slot.required) {
      logger.warn('Required slot has no resolvable variant', { slotId: slot.id, userId: context.userId });
    }
    return null;
  }

  private weightedSelect(variants: ContentVariant[], seedKey: string): ContentVariant | null {
    if (variants.length === 0) return null;
    if (variants.length === 1) return variants[0];
    const totalWeight = variants.reduce((a, v) => a + v.weight, 0);
    if (totalWeight === 0) return variants[0];
    const bucket = this.deterministicHash(seedKey) % totalWeight;
    let cumulative = 0;
    for (const v of variants) {
      cumulative += v.weight;
      if (bucket < cumulative) return v;
    }
    return variants[variants.length - 1];
  }

  // ─── Personalized Content ─────────────────────────────────────────────────

  getPersonalizedContent(context: AssemblyContext, slotId: string): ContentBlock | null {
    const slot = this.slots.get(slotId);
    if (!slot) return null;
    const segmentsMatched = this.matchUserSegments(context);
    const result = this.resolveSlot(slot, context, segmentsMatched);
    return result?.block ?? null;
  }

  // ─── Variant Testing ──────────────────────────────────────────────────────

  runVariantTest(testConfig: Omit<VariantTest, 'createdAt' | 'status' | 'startedAt'>): VariantTest {
    const totalAllocation = testConfig.variants.reduce((a, v) => a + v.trafficAllocation, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error(`Traffic allocations must sum to 100, got ${totalAllocation}`);
    }
    const test: VariantTest = {
      ...testConfig,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
      variants: testConfig.variants.map((v) => ({ ...v, impressions: 0, conversions: 0, conversionRate: 0 })),
    };
    this.tests.set(test.id, test);
    logger.info('Variant test started', { testId: test.id, name: test.name, slotId: test.slotId });
    return test;
  }

  pauseTest(testId: string): void {
    const test = this.tests.get(testId);
    if (test && test.status === 'running') {
      test.status = 'paused';
      logger.info('Variant test paused', { testId });
    }
  }

  concludeTest(testId: string, winnerVariantId?: string): VariantTest | null {
    const test = this.tests.get(testId);
    if (!test) return null;
    test.status = 'completed';
    test.endedAt = new Date();
    if (winnerVariantId) test.winnerVariantId = winnerVariantId;
    else {
      // Auto-select winner by conversion rate
      const best = test.variants.reduce((a, b) => (b.conversionRate > a.conversionRate ? b : a), test.variants[0]);
      test.winnerVariantId = best?.variantId;
    }
    logger.info('Variant test concluded', { testId, winner: test.winnerVariantId });
    return test;
  }

  // ─── Layout Builder ───────────────────────────────────────────────────────

  buildLayout(pageId: string, context: AssemblyContext): Array<{ position: number; slot: ContentSlot; block: ContentBlock | null }> {
    const segmentsMatched = this.matchUserSegments(context);
    return Array.from(this.slots.values())
      .filter((s) => s.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map((slot) => {
        const resolved = this.resolveSlot(slot, context, segmentsMatched);
        return { position: slot.position, slot, block: resolved?.block ?? null };
      });
  }

  // ─── Performance Tracking ─────────────────────────────────────────────────

  trackVariantPerformance(variantId: string, event: 'impression' | 'conversion'): void {
    const perf = this.variantPerformance.get(variantId);
    if (!perf) {
      this.variantPerformance.set(variantId, { impressions: 0, conversions: 0 });
    }
    const p = this.variantPerformance.get(variantId)!;
    if (event === 'impression') p.impressions++;
    if (event === 'conversion') p.conversions++;

    // Update test metrics if applicable
    for (const test of this.tests.values()) {
      const testVariant = test.variants.find((v) => v.variantId === variantId);
      if (testVariant) {
        if (event === 'impression') testVariant.impressions++;
        if (event === 'conversion') testVariant.conversions++;
        testVariant.conversionRate = testVariant.impressions > 0
          ? Math.round((testVariant.conversions / testVariant.impressions) * 10000) / 100
          : 0;
      }
    }
  }

  getVariantPerformanceSummary(): Array<{ variantId: string; name: string; impressions: number; conversions: number; conversionRate: number }> {
    return Array.from(this.variantPerformance.entries()).map(([variantId, perf]) => {
      const variant = this.variants.get(variantId);
      return {
        variantId,
        name: variant?.name ?? 'unknown',
        impressions: perf.impressions,
        conversions: perf.conversions,
        conversionRate: perf.impressions > 0 ? Math.round((perf.conversions / perf.impressions) * 10000) / 100 : 0,
      };
    });
  }

  getActiveTests(): VariantTest[] {
    return Array.from(this.tests.values()).filter((t) => t.status === 'running');
  }

  getTestById(testId: string): VariantTest | undefined {
    return this.tests.get(testId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getDynamicContentEngine(): DynamicContentEngine {
  if (!(globalThis as any).__dynamicContentEngine__) {
    (globalThis as any).__dynamicContentEngine__ = new DynamicContentEngine();
  }
  return (globalThis as any).__dynamicContentEngine__;
}
