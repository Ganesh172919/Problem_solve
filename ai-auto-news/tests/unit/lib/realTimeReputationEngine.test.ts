import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  RealTimeReputationEngine,
  getRealTimeReputationEngine,
  ReputationSignal,
  ReputationProfile,
} from '@/lib/realTimeReputationEngine';

function makeSignal(overrides: Partial<ReputationSignal> = {}): ReputationSignal {
  return {
    entityId: 'user-1',
    entityType: 'user',
    tenantId: 'tenant-1',
    signalType: 'upvote',
    weight: 0,
    timestamp: Date.now(),
    actorId: 'actor-1',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ReputationProfile> = {}): ReputationProfile {
  const now = Date.now();
  return {
    entityId: 'user-1',
    entityType: 'user',
    tenantId: 'tenant-1',
    rawScore: 0,
    decayedScore: 0,
    tier: 'new',
    trustLevel: 1,
    isBanned: false,
    flagCount: 0,
    reportCount: 0,
    upvoteCount: 0,
    downvoteCount: 0,
    lastSignalAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('RealTimeReputationEngine', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__realTimeReputationEngine__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getRealTimeReputationEngine();
    const b = getRealTimeReputationEngine();
    expect(a).toBe(b);
  });

  it('new instance is a RealTimeReputationEngine', () => {
    const engine = getRealTimeReputationEngine();
    expect(engine).toBeInstanceOf(RealTimeReputationEngine);
  });

  it('ingestSignal creates profile and updates score', () => {
    const engine = getRealTimeReputationEngine();
    engine.ingestSignal(makeSignal({ signalType: 'upvote' }));
    const score = engine.computeScore('user-1');
    expect(score).toBeGreaterThan(0);
    const summary = engine.getSummary();
    expect(summary.totalProfiles).toBe(1);
  });

  it('computeScore returns 0 for unknown entity', () => {
    const engine = getRealTimeReputationEngine();
    expect(engine.computeScore('no-such-entity')).toBe(0);
  });

  it('computeScore returns number after multiple upvote signals', () => {
    const engine = getRealTimeReputationEngine();
    engine.ingestSignal(makeSignal({ signalType: 'upvote' }));
    engine.ingestSignal(makeSignal({ signalType: 'upvote' }));
    engine.ingestSignal(makeSignal({ signalType: 'quality_pass' }));
    const score = engine.computeScore('user-1');
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  it('assignTier returns new for score 0', () => {
    const engine = getRealTimeReputationEngine();
    expect(engine.assignTier(makeProfile({ decayedScore: 0 }))).toBe('new');
  });

  it('assignTier returns correct tier at each threshold', () => {
    const engine = getRealTimeReputationEngine();
    expect(engine.assignTier(makeProfile({ decayedScore: 20 }))).toBe('bronze');
    expect(engine.assignTier(makeProfile({ decayedScore: 80 }))).toBe('silver');
    expect(engine.assignTier(makeProfile({ decayedScore: 200 }))).toBe('gold');
    expect(engine.assignTier(makeProfile({ decayedScore: 500 }))).toBe('platinum');
  });

  it('assignTier returns banned for isBanned profile regardless of score', () => {
    const engine = getRealTimeReputationEngine();
    expect(engine.assignTier(makeProfile({ isBanned: true, decayedScore: 9999 }))).toBe('banned');
  });

  it('detectAbuse returns empty array for entity with no suspicious signals', () => {
    const engine = getRealTimeReputationEngine();
    engine.ingestSignal(makeSignal({ signalType: 'upvote' }));
    const patterns = engine.detectAbuse('user-1', 'tenant-1');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns).toHaveLength(0);
  });

  it('banEntity marks entity as banned with tier banned', () => {
    const engine = getRealTimeReputationEngine();
    engine.ingestSignal(makeSignal({ signalType: 'upvote' }));
    engine.banEntity('user-1', 'tenant-1', 'spam', 'admin-1');
    const summary = engine.getSummary();
    expect(summary.bannedCount).toBe(1);
    expect(summary.tierDistribution.banned).toBe(1);
  });

  it('getSummary has correct shape', () => {
    const engine = getRealTimeReputationEngine();
    const summary = engine.getSummary();
    expect(typeof summary.totalProfiles).toBe('number');
    expect(typeof summary.bannedCount).toBe('number');
    expect(typeof summary.avgDecayedScore).toBe('number');
    expect(typeof summary.abusePatternCount).toBe('number');
    expect(typeof summary.recentAuditEntries).toBe('number');
    expect(Array.isArray(summary.topEntitiesByScore)).toBe(true);
    expect(typeof summary.tierDistribution).toBe('object');
    const tiers = ['new', 'bronze', 'silver', 'gold', 'platinum', 'banned'];
    for (const tier of tiers) {
      expect(typeof summary.tierDistribution[tier as keyof typeof summary.tierDistribution]).toBe('number');
    }
  });
});
