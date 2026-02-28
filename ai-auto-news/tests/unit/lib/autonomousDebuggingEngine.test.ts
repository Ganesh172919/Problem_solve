import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  AutonomousDebuggingEngine,
  getDebuggingEngine,
} from '../../../src/lib/autonomousDebuggingEngine';

function makeErrorInput() {
  return {
    message: 'Cannot read properties of null (reading "id")',
    stack: `Error: Cannot read properties of null (reading "id")
    at UserService.getUser (src/services/userService.ts:42:15)
    at async RequestHandler (src/handlers/user.ts:18:12)`,
    category: 'null_pointer' as const,
    severity: 'high' as const,
    tenantId: 'tenant-001',
    serviceId: 'user-service',
    environment: 'production',
    timestamp: Date.now(),
    metadata: { requestId: 'req-123' },
    tags: ['production', 'user-service'],
  };
}

describe('AutonomousDebuggingEngine', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__autonomousDebuggingEngine__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getDebuggingEngine();
    const b = getDebuggingEngine();
    expect(a).toBe(b);
  });

  it('ingestError creates a new error event', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    expect(event.id).toBeTruthy();
    expect(event.occurrenceCount).toBe(1);
    expect(event.category).toBe('null_pointer');
    expect(event.fingerprint).toBeTruthy();
  });

  it('ingestError increments occurrence count for duplicate fingerprints', () => {
    const engine = new AutonomousDebuggingEngine();
    const first = engine.ingestError(makeErrorInput());
    const second = engine.ingestError(makeErrorInput());
    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
  });

  it('ingestError parses stack frames', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    expect(event.frames.length).toBeGreaterThan(0);
    expect(event.frames[0]).toHaveProperty('fileName');
    expect(event.frames[0]).toHaveProperty('lineNumber');
  });

  it('analyzeRootCause returns at least one cause', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const causes = engine.analyzeRootCause(event.id);
    expect(causes.length).toBeGreaterThan(0);
    expect(causes[0]).toHaveProperty('hypothesis');
    expect(causes[0]).toHaveProperty('confidence');
    expect(causes[0]!.confidence).toBeGreaterThan(0);
    expect(causes[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('analyzeRootCause throws for unknown errorId', () => {
    const engine = new AutonomousDebuggingEngine();
    expect(() => engine.analyzeRootCause('no-such-id')).toThrow();
  });

  it('generateFixes returns suggestions', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const fixes = engine.generateFixes(event.id);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0]).toHaveProperty('title');
    expect(fixes[0]).toHaveProperty('confidenceScore');
  });

  it('openSession creates a debugging session', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001', 'dev-user');
    expect(session.id).toBeTruthy();
    expect(session.status).toBe('active');
    expect(session.rootCauses.length).toBeGreaterThan(0);
    expect(session.fixSuggestions.length).toBeGreaterThan(0);
  });

  it('applyFix updates session and fix state', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001');
    const fixId = session.fixSuggestions[0]?.id;
    expect(fixId).toBeTruthy();
    engine.applyFix(session.id, fixId!, 'test-user');
    const updated = engine.getSession(session.id)!;
    expect(updated.appliedFixes).toContain(fixId);
    expect(updated.fixSuggestions[0]?.appliedAt).toBeTruthy();
  });

  it('resolveSession marks session as resolved', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001');
    engine.resolveSession(session.id, 'Fixed by deploying null guard', 'test-user');
    const resolved = engine.getSession(session.id)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionSummary).toBeTruthy();
    expect(resolved.timeToResolveMs).toBeGreaterThanOrEqual(0);
  });

  it('escalateSession marks session as escalated', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001');
    engine.escalateSession(session.id, 'Cannot auto-fix', 'oncall-team');
    const escalated = engine.getSession(session.id)!;
    expect(escalated.status).toBe('escalated');
    expect(escalated.escalationHistory.length).toBe(1);
  });

  it('generateReport produces structured report', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001');
    const report = engine.generateReport(session.id);
    expect(report.sessionId).toBe(session.id);
    expect(report.severity).toBe('high');
    expect(report.category).toBe('null_pointer');
    expect(report.rootCauseAnalysis.length).toBeGreaterThan(0);
    expect(typeof report.regressionRisk).toBe('number');
  });

  it('captureMemoryProfile returns valid profile', () => {
    const engine = new AutonomousDebuggingEngine();
    const profile = engine.captureMemoryProfile();
    expect(profile.heapUsed).toBeGreaterThan(0);
    expect(profile.heapTotal).toBeGreaterThan(0);
    expect(profile.gcPressure).toBeGreaterThanOrEqual(0);
    expect(profile.gcPressure).toBeLessThanOrEqual(1);
  });

  it('registerPattern adds pattern and returns it', () => {
    const engine = new AutonomousDebuggingEngine();
    const pattern = engine.registerPattern({
      name: 'Custom test pattern',
      regex: 'custom error pattern',
      category: 'logic_error',
      severity: 'medium',
      knownFixes: ['fix-a'],
      occurrenceThreshold: 1,
      timeWindowMs: 60_000,
      alertOnDetect: false,
    });
    expect(pattern.id).toBeTruthy();
    expect(engine.listPatterns().some(p => p.id === pattern.id)).toBe(true);
  });

  it('detectCorrelations returns correlation object', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const correlation = engine.detectCorrelations(event.id);
    expect(correlation.primaryErrorId).toBe(event.id);
    expect(typeof correlation.correlationScore).toBe('number');
  });

  it('getDashboardSummary returns expected shape', () => {
    const engine = new AutonomousDebuggingEngine();
    engine.ingestError(makeErrorInput());
    const summary = engine.getDashboardSummary();
    expect(summary).toHaveProperty('totalErrors');
    expect(summary).toHaveProperty('openSessions');
    expect(summary).toHaveProperty('criticalErrors');
    expect(summary).toHaveProperty('topCategories');
    expect(summary.totalErrors).toBe(1);
  });

  it('listErrors filters by tenantId', () => {
    const engine = new AutonomousDebuggingEngine();
    engine.ingestError(makeErrorInput());
    const errors = engine.listErrors('tenant-001');
    expect(errors.length).toBe(1);
    const none = engine.listErrors('other-tenant');
    expect(none.length).toBe(0);
  });

  it('addNote appends note to session', () => {
    const engine = new AutonomousDebuggingEngine();
    const event = engine.ingestError(makeErrorInput());
    const session = engine.openSession(event.id, 'tenant-001');
    engine.addNote(session.id, 'Investigating the null pointer in userService');
    const updated = engine.getSession(session.id)!;
    expect(updated.notes.length).toBe(1);
    expect(updated.notes[0]).toContain('Investigating');
  });
});
