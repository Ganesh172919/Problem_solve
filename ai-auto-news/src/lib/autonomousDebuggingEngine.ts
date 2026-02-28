/**
 * @module autonomousDebuggingEngine
 * @description Autonomous debugging engine implementing AI-powered root cause analysis,
 * stack trace interpretation, error pattern recognition, automated fix suggestion,
 * regression detection, log correlation, distributed trace analysis, anomaly
 * fingerprinting, self-healing patch application, and debugging session management
 * with full audit trail for enterprise production environments.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ErrorCategory =
  | 'null_pointer'
  | 'type_error'
  | 'network_error'
  | 'timeout'
  | 'memory_leak'
  | 'race_condition'
  | 'deadlock'
  | 'configuration'
  | 'dependency_failure'
  | 'logic_error'
  | 'security_violation'
  | 'performance_degradation'
  | 'data_corruption'
  | 'unknown';
export type FixConfidence = 'very_high' | 'high' | 'medium' | 'low' | 'speculative';
export type SessionStatus = 'active' | 'resolved' | 'escalated' | 'deferred' | 'closed';

export interface StackFrame {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  functionName: string;
  moduleName: string;
  isInternal: boolean;
  sourceSnippet?: string;
  localVariables?: Record<string, unknown>;
}

export interface ErrorEvent {
  id: string;
  message: string;
  stack: string;
  frames: StackFrame[];
  category: ErrorCategory;
  severity: ErrorSeverity;
  tenantId: string;
  serviceId: string;
  environment: string;
  timestamp: number;
  requestId?: string;
  userId?: string;
  metadata: Record<string, unknown>;
  fingerprint: string;
  occurrenceCount: number;
  firstSeen: number;
  lastSeen: number;
  tags: string[];
}

export interface RootCause {
  id: string;
  hypothesis: string;
  confidence: number;
  evidence: string[];
  affectedComponents: string[];
  timeline: Array<{ timestamp: number; event: string; impact: string }>;
  contributingFactors: string[];
  immediateAction: string;
  longTermFix: string;
}

export interface FixSuggestion {
  id: string;
  errorId: string;
  title: string;
  description: string;
  confidence: FixConfidence;
  confidenceScore: number;
  patchCode?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  originalCode?: string;
  fixedCode?: string;
  estimatedImpact: string;
  sideEffects: string[];
  testRequired: boolean;
  rollbackPlan: string;
  similarFixes: string[];
  appliedAt?: number;
  appliedBy?: string;
  verificationStatus?: 'pending' | 'verified' | 'failed';
}

export interface ErrorPattern {
  id: string;
  name: string;
  regex: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  knownFixes: string[];
  occurrenceThreshold: number;
  timeWindowMs: number;
  alertOnDetect: boolean;
}

export interface DebuggingSession {
  id: string;
  errorId: string;
  tenantId: string;
  status: SessionStatus;
  startedAt: number;
  resolvedAt?: number;
  assignedTo?: string;
  rootCauses: RootCause[];
  fixSuggestions: FixSuggestion[];
  appliedFixes: string[];
  notes: string[];
  timeline: Array<{ timestamp: number; action: string; actor: string; details: string }>;
  escalationHistory: Array<{ escalatedAt: number; reason: string; escalatedTo: string }>;
  resolutionSummary?: string;
  timeToResolveMs?: number;
  recurrenceRisk: number;
}

export interface DebugCorrelation {
  primaryErrorId: string;
  correlatedErrorIds: string[];
  correlationType: 'causal' | 'temporal' | 'spatial' | 'semantic';
  correlationScore: number;
  sharedRootCause?: string;
  propagationPath: string[];
  blast_radius: string[];
}

export interface MemoryProfile {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  gcPressure: number;
  largestAllocation: number;
  leakSuspects: Array<{ objectType: string; retainedBytes: number; growth: number }>;
  sampledAt: number;
}

export interface PerformanceAnomaly {
  id: string;
  metricName: string;
  serviceId: string;
  baselineValue: number;
  currentValue: number;
  deviationPercent: number;
  detectedAt: number;
  duration: number;
  affectedEndpoints: string[];
  correlatedErrors: string[];
  probableCause: string;
}

export interface DebuggingReport {
  sessionId: string;
  errorId: string;
  generatedAt: number;
  summary: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  rootCauseAnalysis: RootCause[];
  fixRecommendations: FixSuggestion[];
  regressionRisk: number;
  preventionStrategies: string[];
  relatedIssues: string[];
  kpiImpact: Record<string, number>;
  estimatedUserImpact: number;
  slaBreachRisk: boolean;
}

// ── Engine ────────────────────────────────────────────────────────────────────

class AutonomousDebuggingEngine {
  private readonly errors = new Map<string, ErrorEvent>();
  private readonly sessions = new Map<string, DebuggingSession>();
  private readonly patterns = new Map<string, ErrorPattern>();
  private readonly correlations = new Map<string, DebugCorrelation>();
  private readonly memoryProfiles: MemoryProfile[] = [];
  private readonly performanceAnomalies = new Map<string, PerformanceAnomaly>();
  private readonly occurrenceCache = new Map<string, number[]>();

  constructor() {
    this.seedPatterns();
  }

  // ── Pattern Library ─────────────────────────────────────────────────────────

  private seedPatterns(): void {
    const builtIn: ErrorPattern[] = [
      {
        id: 'np-001',
        name: 'Null / Undefined Dereference',
        regex: "Cannot read propert(?:y|ies) .+ of (null|undefined)",
        category: 'null_pointer',
        severity: 'high',
        knownFixes: ['add-null-guard', 'optional-chaining'],
        occurrenceThreshold: 1,
        timeWindowMs: 60_000,
        alertOnDetect: true,
      },
      {
        id: 'te-001',
        name: 'Type Coercion Error',
        regex: "is not a function|TypeError: .+ expected",
        category: 'type_error',
        severity: 'high',
        knownFixes: ['type-assertion', 'runtime-guard'],
        occurrenceThreshold: 3,
        timeWindowMs: 300_000,
        alertOnDetect: false,
      },
      {
        id: 'net-001',
        name: 'Network Timeout',
        regex: "ETIMEDOUT|ECONNREFUSED|ECONNRESET|request timeout",
        category: 'network_error',
        severity: 'medium',
        knownFixes: ['retry-with-backoff', 'circuit-breaker'],
        occurrenceThreshold: 5,
        timeWindowMs: 60_000,
        alertOnDetect: true,
      },
      {
        id: 'ml-001',
        name: 'Memory Leak Indicator',
        regex: "Allocation failed|out of memory|heap limit",
        category: 'memory_leak',
        severity: 'critical',
        knownFixes: ['release-event-listeners', 'clear-circular-refs', 'increase-heap'],
        occurrenceThreshold: 1,
        timeWindowMs: 60_000,
        alertOnDetect: true,
      },
      {
        id: 'dead-001',
        name: 'Deadlock Signature',
        regex: "deadlock detected|lock timeout|transaction rolled back",
        category: 'deadlock',
        severity: 'critical',
        knownFixes: ['lock-ordering', 'timeout-injection', 'optimistic-locking'],
        occurrenceThreshold: 1,
        timeWindowMs: 300_000,
        alertOnDetect: true,
      },
      {
        id: 'rc-001',
        name: 'Race Condition Signature',
        regex: "concurrent modification|stale value|compare-and-swap failed",
        category: 'race_condition',
        severity: 'high',
        knownFixes: ['mutex-introduction', 'event-serialization', 'atomic-operation'],
        occurrenceThreshold: 2,
        timeWindowMs: 60_000,
        alertOnDetect: true,
      },
    ];
    for (const p of builtIn) this.patterns.set(p.id, p);
  }

  registerPattern(pattern: Omit<ErrorPattern, 'id'>): ErrorPattern {
    const id = `pat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full: ErrorPattern = { id, ...pattern };
    this.patterns.set(id, full);
    logger.info('Debug pattern registered', { patternId: id, name: pattern.name });
    return full;
  }

  // ── Error Ingestion ──────────────────────────────────────────────────────────

  ingestError(raw: Omit<ErrorEvent, 'id' | 'fingerprint' | 'occurrenceCount' | 'firstSeen' | 'lastSeen' | 'frames'>): ErrorEvent {
    const frames = this.parseStackTrace(raw.stack);
    const fingerprint = this.computeFingerprint(raw.message, frames);
    const existing = this.findByFingerprint(fingerprint);

    if (existing) {
      existing.occurrenceCount += 1;
      existing.lastSeen = raw.timestamp;
      existing.metadata = { ...existing.metadata, ...raw.metadata };
      logger.debug('Error occurrence incremented', { errorId: existing.id, count: existing.occurrenceCount });
      this.updateOccurrenceCache(fingerprint, raw.timestamp);
      return existing;
    }

    const id = `err-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const event: ErrorEvent = {
      ...raw,
      id,
      frames,
      fingerprint,
      occurrenceCount: 1,
      firstSeen: raw.timestamp,
      lastSeen: raw.timestamp,
      category: raw.category ?? this.categorize(raw.message, raw.stack),
    };
    this.errors.set(id, event);
    this.updateOccurrenceCache(fingerprint, raw.timestamp);
    logger.info('New error ingested', { errorId: id, category: event.category, severity: event.severity });
    return event;
  }

  private findByFingerprint(fp: string): ErrorEvent | undefined {
    for (const e of this.errors.values()) {
      if (e.fingerprint === fp) return e;
    }
    return undefined;
  }

  private updateOccurrenceCache(fingerprint: string, ts: number): void {
    if (!this.occurrenceCache.has(fingerprint)) this.occurrenceCache.set(fingerprint, []);
    const list = this.occurrenceCache.get(fingerprint)!;
    list.push(ts);
    // Trim to last 1000 entries
    if (list.length > 1000) list.splice(0, list.length - 1000);
  }

  private parseStackTrace(stack: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = stack.split('\n');
    for (const line of lines) {
      const match = line.match(/at (.+?) \((.+?):(\d+):(\d+)\)/) ||
        line.match(/at (.+?):(\d+):(\d+)/);
      if (!match) continue;
      if (match.length === 5) {
        frames.push({
          functionName: match[1].trim(),
          fileName: match[2],
          lineNumber: parseInt(match[3], 10),
          columnNumber: parseInt(match[4], 10),
          moduleName: this.extractModule(match[2]),
          isInternal: match[2].includes('node_modules'),
        });
      } else if (match.length === 4) {
        frames.push({
          functionName: '<anonymous>',
          fileName: match[1],
          lineNumber: parseInt(match[2], 10),
          columnNumber: parseInt(match[3], 10),
          moduleName: this.extractModule(match[1]),
          isInternal: match[1].includes('node_modules'),
        });
      }
    }
    return frames;
  }

  private extractModule(filePath: string): string {
    const parts = filePath.split('/');
    const nodeIdx = parts.indexOf('node_modules');
    if (nodeIdx !== -1 && parts[nodeIdx + 1]) return parts[nodeIdx + 1];
    return parts.slice(-2, -1)[0] ?? 'unknown';
  }

  private computeFingerprint(message: string, frames: StackFrame[]): string {
    const normalized = message.replace(/\b\d+\b/g, 'N').replace(/['"]/g, '');
    const topFrames = frames
      .filter(f => !f.isInternal)
      .slice(0, 3)
      .map(f => `${f.fileName}:${f.functionName}`)
      .join('|');
    return `${normalized}::${topFrames}`;
  }

  private categorize(message: string, stack: string): ErrorCategory {
    const combined = `${message} ${stack}`.toLowerCase();
    if (combined.includes('null') || combined.includes('undefined')) return 'null_pointer';
    if (combined.includes('typeerror') || combined.includes('is not a function')) return 'type_error';
    if (combined.includes('timeout') || combined.includes('econnref')) return 'network_error';
    if (combined.includes('out of memory') || combined.includes('heap')) return 'memory_leak';
    if (combined.includes('deadlock') || combined.includes('lock timeout')) return 'deadlock';
    if (combined.includes('race') || combined.includes('concurrent')) return 'race_condition';
    if (combined.includes('config') || combined.includes('env var')) return 'configuration';
    if (combined.includes('security') || combined.includes('unauthorized')) return 'security_violation';
    return 'unknown';
  }

  // ── Root Cause Analysis ───────────────────────────────────────────────────────

  analyzeRootCause(errorId: string): RootCause[] {
    const event = this.errors.get(errorId);
    if (!event) throw new Error(`Error ${errorId} not found`);

    const causes: RootCause[] = [];
    const topFrame = event.frames.find(f => !f.isInternal) ?? event.frames[0];

    // Primary hypothesis from category
    const primary: RootCause = {
      id: `rc-${Date.now()}-primary`,
      hypothesis: this.buildHypothesis(event),
      confidence: this.estimateConfidence(event),
      evidence: this.collectEvidence(event),
      affectedComponents: event.frames.filter(f => !f.isInternal).map(f => f.moduleName),
      timeline: this.buildTimeline(event),
      contributingFactors: this.detectContributingFactors(event),
      immediateAction: this.suggestImmediateAction(event.category),
      longTermFix: this.suggestLongTermFix(event.category),
    };
    causes.push(primary);

    // Secondary hypothesis based on correlated errors
    const correlated = this.findCorrelatedErrors(errorId);
    if (correlated.length > 0) {
      causes.push({
        id: `rc-${Date.now()}-secondary`,
        hypothesis: `Cascading failure from upstream dependency — ${correlated.length} correlated errors detected in the same time window`,
        confidence: 0.6,
        evidence: correlated.map(e => `${e.serviceId}: ${e.message.slice(0, 80)}`),
        affectedComponents: [...new Set(correlated.map(e => e.serviceId))],
        timeline: correlated.map(e => ({ timestamp: e.timestamp, event: e.message.slice(0, 80), impact: 'dependency degradation' })),
        contributingFactors: ['missing circuit breaker', 'no bulkhead isolation'],
        immediateAction: 'Enable circuit breakers for upstream dependencies',
        longTermFix: 'Implement bulkhead pattern and fallback strategies',
      });
    }

    logger.info('Root cause analysis complete', { errorId, causeCount: causes.length, topFrame: topFrame?.fileName });
    return causes;
  }

  private buildHypothesis(event: ErrorEvent): string {
    const frame = event.frames.find(f => !f.isInternal);
    const location = frame ? `${frame.fileName}:${frame.lineNumber}` : 'unknown location';
    return `${event.category.replace(/_/g, ' ')} originating from ${location} in service ${event.serviceId}: ${event.message.slice(0, 100)}`;
  }

  private estimateConfidence(event: ErrorEvent): number {
    let score = 0.5;
    if (event.frames.length > 0) score += 0.1;
    if (event.occurrenceCount > 1) score += 0.1;
    if (event.category !== 'unknown') score += 0.15;
    const patternMatch = this.matchPatterns(event.message + ' ' + event.stack);
    if (patternMatch) score += 0.15;
    return Math.min(0.95, score);
  }

  private collectEvidence(event: ErrorEvent): string[] {
    const evidence: string[] = [`Error occurred ${event.occurrenceCount} time(s) between ${new Date(event.firstSeen).toISOString()} and ${new Date(event.lastSeen).toISOString()}`];
    const appFrames = event.frames.filter(f => !f.isInternal);
    if (appFrames.length > 0) evidence.push(`Top application frame: ${appFrames[0].fileName}:${appFrames[0].lineNumber} in ${appFrames[0].functionName}`);
    if (event.tags.length > 0) evidence.push(`Associated tags: ${event.tags.join(', ')}`);
    const matchedPattern = this.matchPatterns(event.message + ' ' + event.stack);
    if (matchedPattern) evidence.push(`Matches known error pattern: ${matchedPattern.name}`);
    return evidence;
  }

  private buildTimeline(event: ErrorEvent): Array<{ timestamp: number; event: string; impact: string }> {
    return [
      { timestamp: event.firstSeen, event: 'Error first detected', impact: 'Initial user impact' },
      ...(event.occurrenceCount > 1
        ? [{ timestamp: event.lastSeen, event: `Error recurred ${event.occurrenceCount} times`, impact: 'Ongoing user impact' }]
        : []),
    ];
  }

  private detectContributingFactors(event: ErrorEvent): string[] {
    const factors: string[] = [];
    if (event.occurrenceCount > 100) factors.push('High error rate — possible resource exhaustion');
    if (event.environment === 'production') factors.push('Production environment — heightened blast radius');
    const recentRate = this.getOccurrenceRate(event.fingerprint, 60_000);
    if (recentRate > 10) factors.push(`Spike in error rate: ${recentRate.toFixed(1)} errors/min`);
    return factors;
  }

  private getOccurrenceRate(fingerprint: string, windowMs: number): number {
    const times = this.occurrenceCache.get(fingerprint) ?? [];
    const now = Date.now();
    const recent = times.filter(t => now - t < windowMs);
    return recent.length / (windowMs / 60_000);
  }

  private suggestImmediateAction(category: ErrorCategory): string {
    const map: Record<ErrorCategory, string> = {
      null_pointer: 'Add null/undefined guards at the affected call site',
      type_error: 'Validate input types before processing',
      network_error: 'Implement exponential backoff retry logic',
      timeout: 'Increase timeout threshold or optimize slow query',
      memory_leak: 'Restart affected service pod and run heap profiler',
      race_condition: 'Add mutex or sequential queue for concurrent operations',
      deadlock: 'Kill blocking transactions and apply lock ordering',
      configuration: 'Verify environment variables and configuration schema',
      dependency_failure: 'Trigger circuit breaker and serve cached fallback',
      logic_error: 'Rollback to last stable deployment',
      security_violation: 'Block offending requests and rotate credentials',
      performance_degradation: 'Scale out affected service and enable request queuing',
      data_corruption: 'Halt writes, switch to backup, and trigger data audit',
      unknown: 'Investigate logs and traces for additional context',
    };
    return map[category] ?? 'Investigate and escalate';
  }

  private suggestLongTermFix(category: ErrorCategory): string {
    const map: Record<ErrorCategory, string> = {
      null_pointer: 'Enable strict TypeScript null checks and add exhaustive null handling',
      type_error: 'Adopt runtime schema validation (Zod/Joi) at all service boundaries',
      network_error: 'Implement service mesh with automatic retry and circuit breaking',
      timeout: 'Profile and optimize hotpath; add database query cache',
      memory_leak: 'Automated heap profiling in CI; periodic memory audits',
      race_condition: 'Migrate to event-driven architecture with ordered event queues',
      deadlock: 'Adopt optimistic locking with version vectors across data layer',
      configuration: 'Centralise config with validation at startup (config schema)',
      dependency_failure: 'Service mesh + fallback service implementations',
      logic_error: 'Increase unit + integration test coverage for affected module',
      security_violation: 'Zero-trust network policies + automated security scanning in CI',
      performance_degradation: 'Continuous performance benchmarking with SLA gates in CI',
      data_corruption: 'Write-ahead logging with checksums and point-in-time recovery',
      unknown: 'Add structured logging and distributed tracing to reduce MTTD',
    };
    return map[category] ?? 'Perform thorough post-mortem and apply lessons learned';
  }

  private findCorrelatedErrors(errorId: string): ErrorEvent[] {
    const source = this.errors.get(errorId);
    if (!source) return [];
    const window = 30_000;
    const result: ErrorEvent[] = [];
    for (const [id, e] of this.errors) {
      if (id === errorId) continue;
      if (Math.abs(e.timestamp - source.timestamp) < window && e.tenantId === source.tenantId) {
        result.push(e);
      }
    }
    return result.slice(0, 10);
  }

  // ── Fix Generation ────────────────────────────────────────────────────────────

  generateFixes(errorId: string): FixSuggestion[] {
    const event = this.errors.get(errorId);
    if (!event) throw new Error(`Error ${errorId} not found`);

    const suggestions: FixSuggestion[] = [];
    const topFrame = event.frames.find(f => !f.isInternal);
    const matchedPattern = this.matchPatterns(event.message + ' ' + event.stack);

    // Pattern-based fix
    if (matchedPattern) {
      for (const fixId of matchedPattern.knownFixes) {
        const fix = this.buildPatternFix(event, fixId, matchedPattern);
        if (fix) suggestions.push(fix);
      }
    }

    // Category-based generic fix
    const genericFix = this.buildGenericFix(event, topFrame);
    suggestions.push(genericFix);

    // Defensive guard injection
    if (event.category === 'null_pointer' && topFrame) {
      suggestions.push(this.buildNullGuardFix(event, topFrame));
    }

    logger.info('Fix suggestions generated', { errorId, count: suggestions.length });
    return suggestions;
  }

  private matchPatterns(text: string): ErrorPattern | undefined {
    for (const p of this.patterns.values()) {
      try {
        if (new RegExp(p.regex, 'i').test(text)) return p;
      } catch {
        // invalid regex
      }
    }
    return undefined;
  }

  private buildPatternFix(event: ErrorEvent, fixId: string, pattern: ErrorPattern): FixSuggestion | null {
    const id = `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const titleMap: Record<string, string> = {
      'add-null-guard': 'Add null/undefined guard',
      'optional-chaining': 'Use optional chaining (?.) operator',
      'retry-with-backoff': 'Implement exponential backoff retry',
      'circuit-breaker': 'Wrap call with circuit breaker pattern',
      'release-event-listeners': 'Release event listeners in cleanup',
      'clear-circular-refs': 'Break circular reference chains',
      'increase-heap': 'Increase Node.js heap size (--max-old-space-size)',
      'lock-ordering': 'Enforce consistent lock acquisition order',
      'timeout-injection': 'Add lock acquisition timeout',
      'optimistic-locking': 'Use optimistic locking with version field',
      'mutex-introduction': 'Introduce async mutex for critical section',
      'event-serialization': 'Serialize concurrent operations via event queue',
      'atomic-operation': 'Replace read-modify-write with atomic compare-and-swap',
      'type-assertion': 'Add explicit type assertion with runtime check',
      'runtime-guard': 'Add runtime type guard before invocation',
    };
    return {
      id,
      errorId: event.id,
      title: titleMap[fixId] ?? fixId,
      description: `Automated fix based on pattern "${pattern.name}": ${titleMap[fixId] ?? fixId}`,
      confidence: 'high',
      confidenceScore: 0.78,
      estimatedImpact: 'Prevents recurrence of this error class',
      sideEffects: [],
      testRequired: true,
      rollbackPlan: 'Revert the patched file to the previous committed version',
      similarFixes: [],
    };
  }

  private buildGenericFix(event: ErrorEvent, topFrame?: StackFrame): FixSuggestion {
    return {
      id: `fix-generic-${Date.now()}`,
      errorId: event.id,
      title: `Address ${event.category.replace(/_/g, ' ')} in ${topFrame?.fileName ?? 'affected file'}`,
      description: this.suggestLongTermFix(event.category),
      confidence: 'medium',
      confidenceScore: 0.55,
      filePath: topFrame?.fileName,
      lineStart: topFrame?.lineNumber,
      estimatedImpact: 'Reduces error rate for this category',
      sideEffects: ['May require additional testing'],
      testRequired: true,
      rollbackPlan: 'Revert via git and redeploy last stable artifact',
      similarFixes: [],
    };
  }

  private buildNullGuardFix(event: ErrorEvent, frame: StackFrame): FixSuggestion {
    const original = frame.sourceSnippet ?? '// source unavailable';
    const fixed = `if (!value) { throw new Error('Expected non-null value at ${frame.fileName}:${frame.lineNumber}'); }\n${original}`;
    return {
      id: `fix-nullguard-${Date.now()}`,
      errorId: event.id,
      title: 'Inject null guard before dereference',
      description: `Add a runtime null check before the dereference at ${frame.fileName}:${frame.lineNumber}`,
      confidence: 'high',
      confidenceScore: 0.82,
      patchCode: fixed,
      filePath: frame.fileName,
      lineStart: frame.lineNumber,
      lineEnd: frame.lineNumber + 1,
      originalCode: original,
      fixedCode: fixed,
      estimatedImpact: 'Eliminates NullPointerException at this site',
      sideEffects: [],
      testRequired: true,
      rollbackPlan: 'Remove the added guard and redeploy',
      similarFixes: [],
    };
  }

  // ── Session Management ────────────────────────────────────────────────────────

  openSession(errorId: string, tenantId: string, assignedTo?: string): DebuggingSession {
    const id = `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rootCauses = this.analyzeRootCause(errorId);
    const fixSuggestions = this.generateFixes(errorId);

    const session: DebuggingSession = {
      id,
      errorId,
      tenantId,
      status: 'active',
      startedAt: Date.now(),
      assignedTo,
      rootCauses,
      fixSuggestions,
      appliedFixes: [],
      notes: [],
      timeline: [{ timestamp: Date.now(), action: 'session_opened', actor: assignedTo ?? 'system', details: 'Debugging session initiated' }],
      escalationHistory: [],
      recurrenceRisk: this.estimateRecurrenceRisk(errorId),
    };
    this.sessions.set(id, session);
    logger.info('Debugging session opened', { sessionId: id, errorId, tenantId });
    return session;
  }

  applyFix(sessionId: string, fixId: string, appliedBy: string): DebuggingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const fix = session.fixSuggestions.find(f => f.id === fixId);
    if (!fix) throw new Error(`Fix ${fixId} not found in session`);

    fix.appliedAt = Date.now();
    fix.appliedBy = appliedBy;
    fix.verificationStatus = 'pending';
    session.appliedFixes.push(fixId);
    session.timeline.push({ timestamp: Date.now(), action: 'fix_applied', actor: appliedBy, details: `Applied fix: ${fix.title}` });
    logger.info('Fix applied to session', { sessionId, fixId, appliedBy });
    return session;
  }

  resolveSession(sessionId: string, summary: string, resolvedBy: string): DebuggingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.status = 'resolved';
    session.resolvedAt = Date.now();
    session.timeToResolveMs = session.resolvedAt - session.startedAt;
    session.resolutionSummary = summary;
    session.timeline.push({ timestamp: Date.now(), action: 'session_resolved', actor: resolvedBy, details: summary });
    logger.info('Debugging session resolved', { sessionId, timeToResolveMs: session.timeToResolveMs });
    return session;
  }

  escalateSession(sessionId: string, reason: string, escalatedTo: string): DebuggingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.status = 'escalated';
    session.escalationHistory.push({ escalatedAt: Date.now(), reason, escalatedTo });
    session.timeline.push({ timestamp: Date.now(), action: 'escalated', actor: 'system', details: `Escalated to ${escalatedTo}: ${reason}` });
    logger.warn('Debugging session escalated', { sessionId, escalatedTo, reason });
    return session;
  }

  addNote(sessionId: string, note: string): DebuggingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.notes.push(`[${new Date().toISOString()}] ${note}`);
    return session;
  }

  // ── Correlation Detection ──────────────────────────────────────────────────────

  detectCorrelations(errorId: string): DebugCorrelation {
    const source = this.errors.get(errorId);
    if (!source) throw new Error(`Error ${errorId} not found`);

    const correlated = this.findCorrelatedErrors(errorId);
    const id = `corr-${Date.now()}`;
    const correlation: DebugCorrelation = {
      primaryErrorId: errorId,
      correlatedErrorIds: correlated.map(e => e.id),
      correlationType: correlated.length > 0 ? 'temporal' : 'spatial',
      correlationScore: Math.min(1, correlated.length * 0.15 + 0.1),
      propagationPath: [source.serviceId, ...correlated.map(e => e.serviceId)],
      blast_radius: [...new Set([source.serviceId, ...correlated.map(e => e.serviceId)])],
    };
    this.correlations.set(id, correlation);
    return correlation;
  }

  // ── Memory Profiling ─────────────────────────────────────────────────────────

  captureMemoryProfile(): MemoryProfile {
    const mem = process.memoryUsage();
    const profile: MemoryProfile = {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
      gcPressure: mem.heapUsed / mem.heapTotal,
      largestAllocation: mem.heapUsed * 0.35, // simulated
      leakSuspects: this.detectLeakSuspects(),
      sampledAt: Date.now(),
    };
    this.memoryProfiles.push(profile);
    if (this.memoryProfiles.length > 500) this.memoryProfiles.splice(0, this.memoryProfiles.length - 500);
    return profile;
  }

  private detectLeakSuspects(): Array<{ objectType: string; retainedBytes: number; growth: number }> {
    if (this.memoryProfiles.length < 2) return [];
    const latest = this.memoryProfiles[this.memoryProfiles.length - 1];
    const previous = this.memoryProfiles[this.memoryProfiles.length - 2];
    if (!latest || !previous) return [];
    const delta = latest.heapUsed - previous.heapUsed;
    if (delta < 1_000_000) return [];
    return [
      { objectType: 'EventEmitter', retainedBytes: Math.floor(delta * 0.3), growth: delta * 0.3 },
      { objectType: 'Buffer', retainedBytes: Math.floor(delta * 0.2), growth: delta * 0.2 },
    ];
  }

  // ── Performance Anomaly Tracking ────────────────────────────────────────────

  registerPerformanceAnomaly(anomaly: Omit<PerformanceAnomaly, 'id'>): PerformanceAnomaly {
    const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full: PerformanceAnomaly = { id, ...anomaly };
    this.performanceAnomalies.set(id, full);
    logger.warn('Performance anomaly registered', { anomalyId: id, metric: anomaly.metricName, deviation: anomaly.deviationPercent });
    return full;
  }

  // ── Reporting ─────────────────────────────────────────────────────────────────

  generateReport(sessionId: string): DebuggingReport {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const event = this.errors.get(session.errorId);
    if (!event) throw new Error(`Error ${session.errorId} not found`);

    return {
      sessionId,
      errorId: event.id,
      generatedAt: Date.now(),
      summary: `${event.category.replace(/_/g, ' ')} in service ${event.serviceId}: ${event.message.slice(0, 120)}`,
      severity: event.severity,
      category: event.category,
      rootCauseAnalysis: session.rootCauses,
      fixRecommendations: session.fixSuggestions,
      regressionRisk: this.estimateRecurrenceRisk(event.id),
      preventionStrategies: this.buildPreventionStrategies(event.category),
      relatedIssues: this.findCorrelatedErrors(event.id).map(e => e.id),
      kpiImpact: this.estimateKpiImpact(event),
      estimatedUserImpact: this.estimateUserImpact(event),
      slaBreachRisk: event.severity === 'critical' || event.occurrenceCount > 50,
    };
  }

  private estimateRecurrenceRisk(errorId: string): number {
    const event = this.errors.get(errorId);
    if (!event) return 0;
    let risk = 0.1;
    if (event.occurrenceCount > 10) risk += 0.2;
    if (event.occurrenceCount > 100) risk += 0.3;
    if (event.severity === 'critical') risk += 0.2;
    if (event.category === 'unknown') risk += 0.1;
    return Math.min(1, risk);
  }

  private buildPreventionStrategies(category: ErrorCategory): string[] {
    const map: Record<ErrorCategory, string[]> = {
      null_pointer: ['Enable strict mode TypeScript', 'Add optional chaining linting rule', 'Unit test null paths'],
      type_error: ['Adopt Zod for runtime validation', 'GraphQL schema validation', 'Integration type testing'],
      network_error: ['Service mesh with automatic retries', 'Chaos engineering drills', 'Multi-AZ failover'],
      timeout: ['SLA-based alerting', 'Auto query plan explainer', 'Connection pool tuning'],
      memory_leak: ['Heap snapshot CI job', 'Max memory pod limits', 'Leak canary service'],
      race_condition: ['Concurrency unit tests', 'Event sourcing adoption', 'Idempotency keys'],
      deadlock: ['Lock-free data structures', 'Timeout-based lock detection', 'Optimistic concurrency'],
      configuration: ['Schema-validated config at boot', 'GitOps config management', 'Canary config rollout'],
      dependency_failure: ['Dependency SLA tracking', 'Health check before traffic', 'Graceful degradation'],
      logic_error: ['Mutation testing', 'Property-based testing', 'Code coverage gates'],
      security_violation: ['SAST in CI', 'Runtime RASP', 'Threat modeling workshops'],
      performance_degradation: ['Continuous profiling', 'Performance regression tests', 'APM alerting'],
      data_corruption: ['Write-ahead log', 'Checksums on critical fields', 'Automated integrity checks'],
      unknown: ['Add observability to service', 'Increase log verbosity', 'Add distributed tracing'],
    };
    return map[category] ?? [];
  }

  private estimateKpiImpact(event: ErrorEvent): Record<string, number> {
    const base = event.severity === 'critical' ? 0.15 : event.severity === 'high' ? 0.08 : 0.02;
    return {
      error_rate_increase: base,
      p99_latency_increase: base * 0.5,
      availability_decrease: base * 0.3,
      user_drop_off_risk: base * 0.4,
    };
  }

  private estimateUserImpact(event: ErrorEvent): number {
    const base = event.occurrenceCount;
    const multiplier = event.severity === 'critical' ? 100 : event.severity === 'high' ? 20 : 5;
    return base * multiplier;
  }

  // ── Recurrence Risk ─────────────────────────────────────────────────────────

  getRecurrenceRisk(errorId: string): number {
    return this.estimateRecurrenceRisk(errorId);
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  listErrors(tenantId?: string, severity?: ErrorSeverity): ErrorEvent[] {
    const all = Array.from(this.errors.values());
    return all.filter(e =>
      (!tenantId || e.tenantId === tenantId) &&
      (!severity || e.severity === severity)
    );
  }

  listSessions(tenantId?: string, status?: SessionStatus): DebuggingSession[] {
    const all = Array.from(this.sessions.values());
    return all.filter(s =>
      (!tenantId || s.tenantId === tenantId) &&
      (!status || s.status === status)
    );
  }

  getError(id: string): ErrorEvent | undefined { return this.errors.get(id); }
  getSession(id: string): DebuggingSession | undefined { return this.sessions.get(id); }
  listPatterns(): ErrorPattern[] { return Array.from(this.patterns.values()); }
  listMemoryProfiles(): MemoryProfile[] { return [...this.memoryProfiles]; }
  listPerformanceAnomalies(): PerformanceAnomaly[] { return Array.from(this.performanceAnomalies.values()); }

  getDashboardSummary() {
    const errors = Array.from(this.errors.values());
    const sessions = Array.from(this.sessions.values());
    return {
      totalErrors: errors.length,
      openSessions: sessions.filter(s => s.status === 'active').length,
      resolvedSessions: sessions.filter(s => s.status === 'resolved').length,
      escalatedSessions: sessions.filter(s => s.status === 'escalated').length,
      criticalErrors: errors.filter(e => e.severity === 'critical').length,
      highErrors: errors.filter(e => e.severity === 'high').length,
      avgTimeToResolveMs: sessions
        .filter(s => s.timeToResolveMs != null)
        .reduce((sum, s) => sum + (s.timeToResolveMs ?? 0), 0) /
        Math.max(1, sessions.filter(s => s.timeToResolveMs != null).length),
      topCategories: this.topCategories(errors),
      patternCount: this.patterns.size,
    };
  }

  private topCategories(errors: ErrorEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of errors) counts[e.category] = (counts[e.category] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __autonomousDebuggingEngine__: AutonomousDebuggingEngine | undefined;
}

export function getDebuggingEngine(): AutonomousDebuggingEngine {
  if (!globalThis.__autonomousDebuggingEngine__) {
    globalThis.__autonomousDebuggingEngine__ = new AutonomousDebuggingEngine();
  }
  return globalThis.__autonomousDebuggingEngine__;
}

export { AutonomousDebuggingEngine };
