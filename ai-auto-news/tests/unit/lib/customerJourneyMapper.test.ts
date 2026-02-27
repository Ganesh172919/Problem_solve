import { describe, it, expect, beforeEach } from '@jest/globals';
import { getCustomerJourneyMapper, CustomerJourneyMapper, TouchPoint } from '../../../src/lib/customerJourneyMapper';

function makeTouchpoint(
  userId: string,
  action: string,
  channel: TouchPoint['channel'] = 'organic_search',
  ts?: Date,
): TouchPoint {
  return {
    id: `tp_${Date.now()}_${Math.random()}`,
    userId,
    channel,
    action,
    timestamp: ts ?? new Date(),
    sessionId: 'sess1',
    deviceType: 'desktop',
    metadata: {},
  };
}

describe('getCustomerJourneyMapper', () => {
  beforeEach(() => {
    (globalThis as any).__customerJourneyMapper__ = undefined;
  });

  it('returns a singleton instance', () => {
    const a = getCustomerJourneyMapper();
    const b = getCustomerJourneyMapper();
    expect(a).toBe(b);
  });

  it('returns a new instance after reset', () => {
    const a = getCustomerJourneyMapper();
    (globalThis as any).__customerJourneyMapper__ = undefined;
    const b = getCustomerJourneyMapper();
    expect(a).not.toBe(b);
  });
});

describe('CustomerJourneyMapper', () => {
  let mapper: CustomerJourneyMapper;

  beforeEach(() => {
    (globalThis as any).__customerJourneyMapper__ = undefined;
    mapper = getCustomerJourneyMapper();
  });

  describe('trackTouchpoint', () => {
    it('adds a touchpoint so buildJourney can find it', () => {
      mapper.trackTouchpoint('u1', makeTouchpoint('u1', 'visit'));
      const journey = mapper.buildJourney('u1');
      expect(journey.touchPoints.length).toBeGreaterThan(0);
    });
  });

  describe('buildJourney', () => {
    it('returns a journey with correct userId and touchCount', () => {
      mapper.trackTouchpoint('u2', makeTouchpoint('u2', 'visit'));
      mapper.trackTouchpoint('u2', makeTouchpoint('u2', 'click'));
      const journey = mapper.buildJourney('u2');
      expect(journey.userId).toBe('u2');
      expect(journey.touchPoints.length).toBe(2);
      expect(journey.touchCount).toBe(2);
    });

    it('throws when no touchpoints exist for user', () => {
      expect(() => mapper.buildJourney('nonexistent_user')).toThrow();
    });
  });

  describe('computeAttribution', () => {
    let journeyId: string;

    beforeEach(() => {
      mapper.trackTouchpoint('u3', makeTouchpoint('u3', 'visit', 'organic_search'));
      mapper.trackTouchpoint('u3', makeTouchpoint('u3', 'subscribe', 'email'));
      journeyId = mapper.buildJourney('u3').id;
    });

    it('computes first-touch attribution', () => {
      const result = mapper.computeAttribution(journeyId, { type: 'first_touch' });
      expect(result.model).toBe('first_touch');
      expect(result.channelCredits).toBeDefined();
      expect(typeof result.totalValue).toBe('number');
    });

    it('computes last-touch attribution', () => {
      const result = mapper.computeAttribution(journeyId, { type: 'last_touch' });
      expect(result.model).toBe('last_touch');
      expect(result.channelCredits).toBeDefined();
    });

    it('computes linear attribution distributing full value', () => {
      const result = mapper.computeAttribution(journeyId, { type: 'linear' });
      expect(result.model).toBe('linear');
      const creditSum = Object.values(result.channelCredits).reduce((a, b) => a + b, 0);
      expect(Math.round(creditSum)).toBe(Math.round(result.totalValue));
    });

    it('throws for unknown journeyId', () => {
      expect(() => mapper.computeAttribution('bad_id', { type: 'first_touch' })).toThrow();
    });
  });

  describe('generateInsights', () => {
    it('returns an array', () => {
      mapper.trackTouchpoint('u4', makeTouchpoint('u4', 'visit', 'email'));
      mapper.trackTouchpoint('u4', makeTouchpoint('u4', 'subscribe', 'email'));
      const journey = mapper.buildJourney('u4');
      const insights = mapper.generateInsights([journey]);
      expect(Array.isArray(insights)).toBe(true);
    });
  });

  describe('exportJourneyReport', () => {
    it('returns a JourneyReport with userId, journey, and attribution', () => {
      mapper.trackTouchpoint('u5', makeTouchpoint('u5', 'visit'));
      const report = mapper.exportJourneyReport('u5');
      expect(report.userId).toBe('u5');
      expect(report.journey).toBeDefined();
      expect(report.attribution).toBeDefined();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('forecastConversions', () => {
    it('returns a 30-day forecast with non-negative values', () => {
      const forecast = mapper.forecastConversions('all');
      expect(typeof forecast).toBe('object');
      expect(forecast['day_1']).toBeGreaterThanOrEqual(0);
      expect(forecast['day_30']).toBeGreaterThanOrEqual(0);
    });
  });
});
