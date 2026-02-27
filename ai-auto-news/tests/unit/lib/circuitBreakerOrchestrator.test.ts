import { describe, it, expect, beforeEach } from '@jest/globals';
import { getCircuitBreakerOrchestrator } from '../../../src/lib/circuitBreakerOrchestrator';

const BASE_CONFIG = {
  name: 'test-service',
  threshold: 0.5,
  resetTimeout: 1000,
  halfOpenMax: 3,
  monitoringWindow: 10000,
  errorTypes: [],
};

describe('CircuitBreakerOrchestrator', () => {
  beforeEach(() => {
    (globalThis as any).__circuitBreakerOrchestrator__ = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getCircuitBreakerOrchestrator();
    const b = getCircuitBreakerOrchestrator();
    expect(a).toBe(b);
  });

  it('register() returns a string id', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('getState() returns "closed" initially', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    expect(orchestrator.getState(id)).toBe('closed');
  });

  it('execute() succeeds with healthy function', async () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    const result = await orchestrator.execute(id, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('getMetrics() has numeric fields', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    const metrics = orchestrator.getMetrics(id);
    expect(typeof metrics.totalRequests).toBe('number');
    expect(typeof metrics.failures).toBe('number');
    expect(typeof metrics.successes).toBe('number');
    expect(typeof metrics.latencyP50).toBe('number');
    expect(typeof metrics.latencyP99).toBe('number');
  });

  it('getStats() has correct counts', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    orchestrator.register(BASE_CONFIG);
    orchestrator.register({ ...BASE_CONFIG, name: 'svc-2' });
    const stats = orchestrator.getStats();
    expect(stats.totalBreakers).toBe(2);
    expect(stats.closedBreakers).toBe(2);
    expect(stats.openBreakers).toBe(0);
    expect(typeof stats.totalRequests).toBe('number');
  });

  it('onStateChange fires on state transition', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    const events: string[] = [];
    orchestrator.onStateChange(e => events.push(e.newState));
    orchestrator.forceOpen(id, 'test');
    expect(events).toContain('open');
  });

  it('detectCascade returns array', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    const result = orchestrator.detectCascade(id);
    expect(Array.isArray(result)).toBe(true);
  });

  it('forceOpen changes state to "open"', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    orchestrator.forceOpen(id, 'manual');
    expect(orchestrator.getState(id)).toBe('open');
  });

  it('forceClose after forceOpen returns to "closed"', () => {
    const orchestrator = getCircuitBreakerOrchestrator();
    const id = orchestrator.register(BASE_CONFIG);
    orchestrator.forceOpen(id, 'manual');
    orchestrator.forceClose(id);
    expect(orchestrator.getState(id)).toBe('closed');
  });
});
