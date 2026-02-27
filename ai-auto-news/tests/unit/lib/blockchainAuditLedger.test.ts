import { describe, it, expect, beforeEach } from '@jest/globals';
import { BlockchainAuditLedger, AuditEvent } from '@/lib/blockchainAuditLedger';

describe('BlockchainAuditLedger', () => {
  let ledger: BlockchainAuditLedger;

  const createEvent = (overrides?: Partial<Omit<AuditEvent, 'hash'>>): Omit<AuditEvent, 'hash'> => ({
    id: `evt-${Date.now()}-${Math.random()}`,
    tenantId: 'tenant-1',
    userId: 'user-1',
    action: 'create_post',
    resourceType: 'post',
    resourceId: 'post-123',
    outcome: 'success',
    severity: 'info',
    metadata: { ip: '1.2.3.4' },
    ipAddress: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    sessionId: 'sess-1',
    correlationId: 'corr-1',
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    ledger = new BlockchainAuditLedger({ blockSize: 3, difficulty: 1 });
  });

  describe('addEvent', () => {
    it('should add an event and return it with a hash', () => {
      const event = ledger.addEvent(createEvent());
      expect(event.hash).toBeDefined();
      expect(event.hash.length).toBeGreaterThan(0);
    });

    it('should store events in pending pool', () => {
      ledger.addEvent(createEvent());
      const stats = ledger.getStats();
      expect(stats.pendingEvents).toBeGreaterThan(0);
    });

    it('should auto-mine when block size is reached', () => {
      for (let i = 0; i < 3; i++) {
        ledger.addEvent(createEvent({ id: `evt-${i}` }));
      }
      const stats = ledger.getStats();
      expect(stats.blockCount).toBeGreaterThan(1);
      expect(stats.pendingEvents).toBe(0);
    });
  });

  describe('mine', () => {
    it('should mine pending events into a block', () => {
      ledger.addEvent(createEvent({ id: 'e1' }));
      ledger.addEvent(createEvent({ id: 'e2' }));
      const block = ledger.flushPending();
      expect(block).not.toBeNull();
      expect(block!.events.length).toBe(2);
      expect(block!.hash).toBeDefined();
    });

    it('should throw if no pending events', () => {
      expect(() => ledger.mine()).toThrow('No pending events to mine');
    });

    it('should include previous hash', () => {
      ledger.addEvent(createEvent({ id: 'e1' }));
      const block1 = ledger.flushPending();
      ledger.addEvent(createEvent({ id: 'e2' }));
      const block2 = ledger.flushPending();
      expect(block2!.previousHash).toBe(block1!.hash);
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify a valid chain', () => {
      for (let i = 0; i < 3; i++) {
        ledger.addEvent(createEvent({ id: `evt-${i}` }));
      }
      const report = ledger.verifyIntegrity();
      expect(report.isValid).toBe(true);
      expect(report.tamperDetected).toBe(false);
    });

    it('should report correct block count', () => {
      for (let i = 0; i < 3; i++) {
        ledger.addEvent(createEvent({ id: `evt-${i}` }));
      }
      const report = ledger.verifyIntegrity();
      expect(report.totalBlocks).toBeGreaterThan(1);
    });
  });

  describe('query', () => {
    it('should return events matching tenant filter', () => {
      for (let i = 0; i < 3; i++) {
        ledger.addEvent(createEvent({ id: `t1-${i}`, tenantId: 'tenant-1' }));
      }
      ledger.addEvent(createEvent({ id: 't2-0', tenantId: 'tenant-2' }));
      ledger.flushPending();

      const result = ledger.query({ tenantId: 'tenant-1' });
      expect(result.events.every(e => e.tenantId === 'tenant-1')).toBe(true);
    });

    it('should filter by severity', () => {
      for (let i = 0; i < 3; i++) {
        ledger.addEvent(createEvent({ id: `c-${i}`, severity: 'critical' }));
      }
      ledger.flushPending();

      const result = ledger.query({ severity: 'critical' });
      expect(result.events.every(e => e.severity === 'critical')).toBe(true);
    });

    it('should apply limit and offset', () => {
      for (let i = 0; i < 6; i++) {
        ledger.addEvent(createEvent({ id: `e-${i}` }));
      }
      ledger.flushPending();

      const result = ledger.query({ limit: 2, offset: 0 });
      expect(result.events.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getStats', () => {
    it('should return ledger statistics', () => {
      const stats = ledger.getStats();
      expect(stats.blockCount).toBeGreaterThanOrEqual(1);
      expect(stats.totalEvents).toBeGreaterThanOrEqual(0);
      expect(stats.chainHash).toBeDefined();
    });
  });

  describe('getBlock', () => {
    it('should return genesis block at index 0', () => {
      const genesis = ledger.getBlock(0);
      expect(genesis).toBeDefined();
      expect(genesis!.index).toBe(0);
    });
  });
});
