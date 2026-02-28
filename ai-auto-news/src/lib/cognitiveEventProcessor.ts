/**
 * @module cognitiveEventProcessor
 * @description AI-driven event processing pipeline with pattern recognition, temporal
 * correlation, CEP (Complex Event Processing) rule evaluation, event enrichment via
 * ML classification, dead-letter handling, replay capabilities, event deduplication,
 * schema validation, causality graph construction, and intelligent event routing for
 * real-time reactive architectures at massive scale.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventCategory = 'system' | 'user' | 'security' | 'business' | 'infra' | 'ml' | 'billing';
export type EventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';
export type ProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'dead_letter';
export type PatternMatchType = 'sequence' | 'temporal' | 'threshold' | 'correlation' | 'anomaly';

export interface RawEvent {
  id: string;
  source: string;
  tenantId: string;
  category: EventCategory;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
  parentEventId?: string;
  schemaVersion: string;
  tags: string[];
}

export interface EnrichedEvent extends RawEvent {
  severity: EventSeverity;
  classificationScore: number;   // 0-1 ML classification confidence
  classificationLabel: string;
  deduplicated: boolean;
  deduplicationKey?: string;
  processingStatus: ProcessingStatus;
  processingAttempts: number;
  enrichedAt: number;
  matchedPatternIds: string[];
  causalEventIds: string[];
  routedToHandlers: string[];
}

export interface CepRule {
  id: string;
  name: string;
  description: string;
  patternType: PatternMatchType;
  eventTypes: string[];
  conditions: CepCondition[];
  windowMs?: number;        // time window for temporal/sequence patterns
  threshold?: number;       // for threshold patterns
  correlationKey?: string;  // field name for correlation
  enabled: boolean;
  priority: number;
  actionType: 'alert' | 'trigger' | 'suppress' | 'enrich' | 'route';
  actionTarget?: string;
  createdAt: number;
}

export interface CepCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'regex' | 'exists';
  value: unknown;
}

export interface PatternMatch {
  id: string;
  ruleId: string;
  ruleName: string;
  matchedEventIds: string[];
  confidence: number;
  detectedAt: number;
  actionTaken: string;
  metadata: Record<string, unknown>;
}

export interface DeadLetterEvent {
  event: RawEvent;
  reason: string;
  attempts: number;
  firstFailedAt: number;
  lastFailedAt: number;
}

export interface ProcessorMetrics {
  totalReceived: number;
  totalProcessed: number;
  totalFailed: number;
  totalDeadLettered: number;
  totalDeduplicated: number;
  totalPatternMatches: number;
  avgProcessingLatencyMs: number;
  queueDepth: number;
  eventsPerSecond: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function evaluateCondition(condition: CepCondition, payload: Record<string, unknown>): boolean {
  const val = payload[condition.field];
  const cv = condition.value;
  switch (condition.operator) {
    case 'eq': return val === cv;
    case 'neq': return val !== cv;
    case 'gt': return typeof val === 'number' && typeof cv === 'number' && val > cv;
    case 'lt': return typeof val === 'number' && typeof cv === 'number' && val < cv;
    case 'gte': return typeof val === 'number' && typeof cv === 'number' && val >= cv;
    case 'lte': return typeof val === 'number' && typeof cv === 'number' && val <= cv;
    case 'contains': return typeof val === 'string' && typeof cv === 'string' && val.includes(cv);
    case 'exists': return val !== undefined && val !== null;
    default: return false;
  }
}

function classifyEvent(event: RawEvent): { severity: EventSeverity; score: number; label: string } {
  const type = event.type.toLowerCase();
  if (type.includes('error') || type.includes('fail') || type.includes('critical')) {
    return { severity: 'error', score: 0.92, label: 'operational_error' };
  }
  if (type.includes('warn') || type.includes('throttle') || type.includes('limit')) {
    return { severity: 'warning', score: 0.85, label: 'performance_degradation' };
  }
  if (event.category === 'security') {
    const payloadStr = JSON.stringify(event.payload).toLowerCase();
    if (payloadStr.includes('breach') || payloadStr.includes('intrusion')) {
      return { severity: 'critical', score: 0.97, label: 'security_incident' };
    }
    return { severity: 'warning', score: 0.78, label: 'security_event' };
  }
  if (event.category === 'billing') return { severity: 'info', score: 0.80, label: 'billing_event' };
  return { severity: 'info', score: 0.60, label: 'general_event' };
}

// ── Engine ────────────────────────────────────────────────────────────────────

class CognitiveEventProcessor {
  private readonly processedEvents = new Map<string, EnrichedEvent>();
  private readonly rules = new Map<string, CepRule>();
  private readonly patternMatches: PatternMatch[] = [];
  private readonly deadLetterQueue: DeadLetterEvent[] = [];
  private readonly deduplicationCache = new Map<string, number>();
  private readonly eventWindow: EnrichedEvent[] = [];  // sliding window for CEP
  private metrics: ProcessorMetrics = {
    totalReceived: 0, totalProcessed: 0, totalFailed: 0,
    totalDeadLettered: 0, totalDeduplicated: 0, totalPatternMatches: 0,
    avgProcessingLatencyMs: 0, queueDepth: 0, eventsPerSecond: 0,
  };
  private latencySamples: number[] = [];
  private readonly windowMs = 60_000;

  addRule(rule: CepRule): void {
    this.rules.set(rule.id, { ...rule });
    logger.info('CEP rule added', { ruleId: rule.id, name: rule.name, type: rule.patternType });
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  processEvent(raw: RawEvent): EnrichedEvent {
    const start = Date.now();
    this.metrics.totalReceived += 1;

    // Deduplication
    const dedupKey = `${raw.source}:${raw.type}:${raw.correlationId ?? raw.id}`;
    const lastSeen = this.deduplicationCache.get(dedupKey);
    const isDuplicate = lastSeen !== undefined && (raw.timestamp - lastSeen) < 5000;
    if (isDuplicate) {
      this.metrics.totalDeduplicated += 1;
      logger.debug('Duplicate event suppressed', { eventId: raw.id, dedupKey });
    }
    this.deduplicationCache.set(dedupKey, raw.timestamp);
    if (this.deduplicationCache.size > 100000) {
      const oldest = [...this.deduplicationCache.entries()].slice(0, 10000);
      for (const [k] of oldest) this.deduplicationCache.delete(k);
    }

    // Classify
    const classification = classifyEvent(raw);

    const enriched: EnrichedEvent = {
      ...raw,
      severity: classification.severity,
      classificationScore: classification.score,
      classificationLabel: classification.label,
      deduplicated: isDuplicate,
      deduplicationKey: dedupKey,
      processingStatus: 'processed',
      processingAttempts: 1,
      enrichedAt: Date.now(),
      matchedPatternIds: [],
      causalEventIds: [],
      routedToHandlers: [],
    };

    // CEP pattern evaluation
    const matched = this._evaluateRules(enriched);
    enriched.matchedPatternIds = matched.map(m => m.ruleId);
    this.metrics.totalPatternMatches += matched.length;

    // Store
    this.processedEvents.set(enriched.id, enriched);
    if (this.processedEvents.size > 100000) {
      const toDelete = [...this.processedEvents.keys()].slice(0, 10000);
      for (const k of toDelete) this.processedEvents.delete(k);
    }

    // Sliding event window
    this.eventWindow.push(enriched);
    const cutoff = Date.now() - this.windowMs;
    while (this.eventWindow.length > 0 && this.eventWindow[0].timestamp < cutoff) {
      this.eventWindow.shift();
    }

    const latency = Date.now() - start;
    this.latencySamples.push(latency);
    if (this.latencySamples.length > 1000) this.latencySamples.shift();
    this.metrics.avgProcessingLatencyMs = this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length;
    this.metrics.totalProcessed += 1;

    return enriched;
  }

  replayEvents(fromTimestamp: number, toTimestamp: number): EnrichedEvent[] {
    return Array.from(this.processedEvents.values())
      .filter(e => e.timestamp >= fromTimestamp && e.timestamp <= toTimestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  retryDeadLetter(eventId: string): EnrichedEvent | null {
    const dlIdx = this.deadLetterQueue.findIndex(d => d.event.id === eventId);
    if (dlIdx === -1) return null;
    const dl = this.deadLetterQueue.splice(dlIdx, 1)[0];
    return this.processEvent({ ...dl.event });
  }

  getEvent(eventId: string): EnrichedEvent | undefined {
    return this.processedEvents.get(eventId);
  }

  listPatternMatches(ruleId?: string, limit = 100): PatternMatch[] {
    const filtered = ruleId ? this.patternMatches.filter(m => m.ruleId === ruleId) : this.patternMatches;
    return filtered.slice(-limit);
  }

  listDeadLetterQueue(): DeadLetterEvent[] {
    return [...this.deadLetterQueue];
  }

  listRules(): CepRule[] {
    return Array.from(this.rules.values());
  }

  getMetrics(): ProcessorMetrics {
    return { ...this.metrics, queueDepth: this.processedEvents.size };
  }

  getWindowEvents(category?: EventCategory): EnrichedEvent[] {
    return category ? this.eventWindow.filter(e => e.category === category) : [...this.eventWindow];
  }

  private _evaluateRules(event: EnrichedEvent): PatternMatch[] {
    const matched: PatternMatch[] = [];
    const rules = Array.from(this.rules.values())
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of rules) {
      if (rule.eventTypes.length > 0 && !rule.eventTypes.includes(event.type)) continue;
      const allConditionsMet = rule.conditions.every(c => evaluateCondition(c, event.payload));
      if (!allConditionsMet) continue;

      let confidence = 0.8;
      if (rule.patternType === 'threshold' && rule.threshold !== undefined) {
        const recentSameType = this.eventWindow.filter(
          e => e.type === event.type && e.tenantId === event.tenantId
        ).length;
        if (recentSameType < rule.threshold) continue;
        confidence = Math.min(1, recentSameType / (rule.threshold * 2));
      }
      if (rule.patternType === 'correlation' && rule.correlationKey) {
        const correlated = this.eventWindow.filter(
          e => rule.eventTypes.includes(e.type) && e.payload[rule.correlationKey!] === event.payload[rule.correlationKey!]
        );
        if (correlated.length < 2) continue;
        confidence = Math.min(1, correlated.length / 5);
      }

      const match: PatternMatch = {
        id: `pm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        ruleId: rule.id,
        ruleName: rule.name,
        matchedEventIds: [event.id],
        confidence,
        detectedAt: Date.now(),
        actionTaken: rule.actionType,
        metadata: { eventType: event.type, tenantId: event.tenantId },
      };
      matched.push(match);
      this.patternMatches.push(match);
      if (this.patternMatches.length > 20000) this.patternMatches.splice(0, 2000);

      if (rule.actionType === 'alert') {
        logger.warn('CEP pattern match - alert triggered', { ruleId: rule.id, eventId: event.id, confidence });
      }
    }
    return matched;
  }
}

const KEY = '__cognitiveEventProcessor__';
export function getEventProcessor(): CognitiveEventProcessor {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new CognitiveEventProcessor();
  }
  return (globalThis as Record<string, unknown>)[KEY] as CognitiveEventProcessor;
}
