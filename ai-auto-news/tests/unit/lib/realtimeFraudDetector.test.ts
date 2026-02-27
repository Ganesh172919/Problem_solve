import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  RealtimeFraudDetector,
  getFraudDetector,
  FraudEvent,
  UserBehaviorProfile,
} from '../../../src/lib/realtimeFraudDetector';

const BASE_EVENT: FraudEvent = {
  userId: 'user_abc',
  tenantId: 'tenant1',
  action: 'login',
  ipAddress: '192.168.1.1',
  country: 'US',
  deviceFingerprint: 'device_xyz',
  timestamp: Date.now(),
  metadata: {},
};

describe('RealtimeFraudDetector', () => {
  beforeEach(() => {
    (globalThis as any).__realtimeFraudDetector__ = undefined;
  });

  it('singleton returns the same instance', () => {
    const a = getFraudDetector();
    const b = getFraudDetector();
    expect(a).toBe(b);
  });

  it('assess returns an allow action for clean known-user event', async () => {
    const detector = new RealtimeFraudDetector({ enableMLScoring: false });
    const assessment = await detector.assess(BASE_EVENT);
    expect(assessment.userId).toBe('user_abc');
    expect(assessment.action).toBe('allow');
  });

  it('blocklisted user returns critical risk', async () => {
    const detector = new RealtimeFraudDetector();
    detector.addToBlocklist('user_bad');
    const event: FraudEvent = { ...BASE_EVENT, userId: 'user_bad' };
    const assessment = await detector.assess(event);
    expect(assessment.riskLevel).toBe('critical');
    expect(assessment.action).toBe('block');
  });

  it('blocklisted IP returns critical risk', async () => {
    const detector = new RealtimeFraudDetector();
    detector.addToBlocklist('10.0.0.99');
    const event: FraudEvent = { ...BASE_EVENT, ipAddress: '10.0.0.99' };
    const assessment = await detector.assess(event);
    expect(assessment.riskLevel).toBe('critical');
  });

  it('updateProfile stores profile and affects ML scoring', async () => {
    const detector = new RealtimeFraudDetector();
    const profile: UserBehaviorProfile = {
      userId: 'user_abc',
      avgSessionDurationMs: 300000,
      typicalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
      knownIPs: ['192.168.1.1'],
      knownDevices: ['device_xyz'],
      knownCountries: ['US'],
      avgTransactionAmount: 50,
      transactionStdDev: 10,
      requestsPerMinute: 5,
      lastActivity: Date.now() - 3600_000,
      suspicionScore: 0,
    };
    detector.updateProfile(profile);
    const assessment = await detector.assess(BASE_EVENT);
    expect(assessment.riskScore).toBeLessThanOrEqual(100);
  });

  it('getStats returns structured stats', () => {
    const detector = new RealtimeFraudDetector();
    const stats = detector.getStats();
    expect(stats).toHaveProperty('totalAssessments');
    expect(stats).toHaveProperty('blockRate');
    expect(stats).toHaveProperty('profiledUsers');
  });

  it('getUserHistory returns assessments for user', async () => {
    const detector = new RealtimeFraudDetector();
    await detector.assess(BASE_EVENT);
    const history = detector.getUserHistory('user_abc');
    expect(history.length).toBeGreaterThan(0);
  });

  it('removeFromBlocklist allows previously blocked user', async () => {
    const detector = new RealtimeFraudDetector();
    detector.addToBlocklist('user_tmp');
    detector.removeFromBlocklist('user_tmp');
    const event: FraudEvent = { ...BASE_EVENT, userId: 'user_tmp' };
    const assessment = await detector.assess(event);
    expect(assessment.riskLevel).not.toBe('critical');
  });
});
