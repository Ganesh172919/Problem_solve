import { describe, it, expect, beforeEach } from '@jest/globals';
import { getStructuredLogging } from '@/lib/structuredLoggingFramework';

describe('StructuredLoggingFramework', () => {
  let logging: ReturnType<typeof getStructuredLogging>;

  const makeEntry = (overrides: Record<string, unknown> = {}) => ({
    level: 'info' as const,
    message: 'test message',
    service: 'test-svc',
    traceId: 'trace-1',
    spanId: 'span-1',
    correlationId: 'corr-1',
    context: {},
    tags: ['test'],
    ...overrides,
  });

  beforeEach(() => {
    delete (globalThis as any).__structuredLoggingFramework__;
    logging = getStructuredLogging();
  });

  it('should create structured log entries with id and timestamp', () => {
    const entry = logging.log(makeEntry());
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.message).toBe('test message');
    expect(entry.service).toBe('test-svc');
  });

  it('should query entries by level', () => {
    logging.log(makeEntry({ level: 'info' }));
    logging.log(makeEntry({ level: 'error' }));
    logging.log(makeEntry({ level: 'info' }));

    const result = logging.query({ level: 'error' });
    expect(result.total).toBe(1);
    expect(result.entries[0].level).toBe('error');
  });

  it('should query entries by service and traceId', () => {
    logging.log(makeEntry({ service: 'svc-a', traceId: 't1' }));
    logging.log(makeEntry({ service: 'svc-b', traceId: 't2' }));
    logging.log(makeEntry({ service: 'svc-a', traceId: 't2' }));

    expect(logging.query({ service: 'svc-a' }).total).toBe(2);
    expect(logging.query({ traceId: 't2' }).total).toBe(2);
    expect(logging.query({ service: 'svc-a', traceId: 't2' }).total).toBe(1);
  });

  it('should return trace entries in order', () => {
    logging.log(makeEntry({ traceId: 'tr-x', message: 'first' }));
    logging.log(makeEntry({ traceId: 'tr-y', message: 'other' }));
    logging.log(makeEntry({ traceId: 'tr-x', message: 'second' }));

    const entries = logging.getTraceEntries('tr-x');
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('first');
    expect(entries[1].message).toBe('second');
  });

  it('should detect repeated patterns', () => {
    for (let i = 0; i < 5; i++) {
      logging.log(makeEntry({ message: 'Connection timeout to db-host' }));
    }
    logging.log(makeEntry({ message: 'Something unique happened' }));

    const patterns = logging.detectPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].frequency).toBe(5);
  });

  it('should extract metrics from recent entries', () => {
    logging.log(makeEntry({ level: 'info', duration: 100 }));
    logging.log(makeEntry({ level: 'error', duration: 200 }));

    const metrics = logging.extractMetrics(60_000);
    expect(metrics.length).toBeGreaterThan(0);
    const errorRate = metrics.find((m) => m.name === 'error_rate');
    expect(errorRate).toBeDefined();
    expect(errorRate!.value).toBe(0.5);
  });

  it('should apply retention policy and remove old entries', () => {
    logging.log(makeEntry());
    logging.log(makeEntry());
    logging.log(makeEntry());

    const deleted = logging.applyRetention({ maxEntries: 1, maxAgeDays: 365, compressAfterDays: 30 });
    expect(deleted).toBe(2);
    // After retention, only query can reliably count surviving entries
    const result = logging.query({});
    expect(result.total).toBe(1);
  });

  it('should return accurate stats', () => {
    logging.log(makeEntry({ level: 'info', service: 'a' }));
    logging.log(makeEntry({ level: 'error', service: 'b' }));

    const stats = logging.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.entriesByLevel['info']).toBe(1);
    expect(stats.entriesByLevel['error']).toBe(1);
    expect(stats.entriesByService['a']).toBe(1);
    expect(stats.errorRate).toBe(0.5);
    expect(stats.storageUsedBytes).toBeGreaterThan(0);
  });

  it('should calculate error rate within window', () => {
    logging.log(makeEntry({ level: 'info' }));
    logging.log(makeEntry({ level: 'error' }));
    logging.log(makeEntry({ level: 'fatal' }));

    const rate = logging.getErrorRate(60_000);
    expect(rate).toBeCloseTo(2 / 3);
  });

  it('should generate unique correlation IDs', () => {
    const id1 = logging.createCorrelationId();
    const id2 = logging.createCorrelationId();
    expect(id1).toBeDefined();
    expect(typeof id1).toBe('string');
    expect(id1).not.toBe(id2);
  });
});
