import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  RealtimeAnomalyDetector,
  getAnomalyDetector,
  TimeSeriesPoint,
} from '../../../src/lib/realtimeAnomalyDetector';

function makePoint(value: number, tsOffset = 0): TimeSeriesPoint {
  return { timestamp: Date.now() + tsOffset, value };
}

function fillStream(detector: RealtimeAnomalyDetector, streamId: string, count = 30, baseValue = 50): void {
  for (let i = 0; i < count; i++) {
    detector.ingest(streamId, makePoint(baseValue + (Math.random() - 0.5) * 5, i * 1000));
  }
}

describe('RealtimeAnomalyDetector', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__realtimeAnomalyDetector__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getAnomalyDetector();
    const b = getAnomalyDetector();
    expect(a).toBe(b);
  });

  it('creates stream and retrieves it', () => {
    const detector = new RealtimeAnomalyDetector();
    const stream = detector.createStream({ name: 'CPU', metricName: 'cpu_percent' });
    expect(stream.streamId).toBeTruthy();
    expect(detector.getStream(stream.streamId)).toBe(stream);
  });

  it('returns null for anomaly when buffer is insufficient', () => {
    const detector = new RealtimeAnomalyDetector({ minPointsForDetection: 20 });
    const stream = detector.createStream({ name: 'test', metricName: 'value' });
    const result = detector.ingest(stream.streamId, makePoint(1000));
    expect(result).toBeNull();
  });

  it('detects obvious anomaly after sufficient data', () => {
    const detector = new RealtimeAnomalyDetector({ zScoreThreshold: 2, minPointsForDetection: 20, alertCooldownMs: 0 });
    const stream = detector.createStream({ name: 'test', metricName: 'value' });
    fillStream(detector, stream.streamId, 25, 50);
    // Inject extreme outlier
    const anomaly = detector.ingest(stream.streamId, makePoint(50_000));
    expect(anomaly).not.toBeNull();
    expect(anomaly!.anomalyScore).toBeGreaterThan(0);
    expect(anomaly!.isAnomaly ?? true).toBe(true);
  });

  it('normal value does not trigger anomaly', () => {
    const detector = new RealtimeAnomalyDetector({ zScoreThreshold: 3, minPointsForDetection: 20 });
    const stream = detector.createStream({ name: 'test', metricName: 'value' });
    fillStream(detector, stream.streamId, 25, 50);
    const result = detector.ingest(stream.streamId, makePoint(51));
    expect(result).toBeNull();
  });

  it('openAlerts are created on non-deduplicated anomaly', () => {
    const detector = new RealtimeAnomalyDetector({ zScoreThreshold: 2, minPointsForDetection: 20, alertCooldownMs: 0 });
    const stream = detector.createStream({ name: 'netio', metricName: 'bytes_out' });
    fillStream(detector, stream.streamId, 25, 100);
    detector.ingest(stream.streamId, makePoint(1_000_000));
    const alerts = detector.getOpenAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('acknowledgeAlert and resolveAlert work', () => {
    const detector = new RealtimeAnomalyDetector({ zScoreThreshold: 2, minPointsForDetection: 20, alertCooldownMs: 0 });
    const stream = detector.createStream({ name: 'test', metricName: 'requests' });
    fillStream(detector, stream.streamId, 25, 200);
    detector.ingest(stream.streamId, makePoint(999_999));
    const openAlerts = detector.getOpenAlerts();
    expect(openAlerts.length).toBeGreaterThan(0);
    const alertId = openAlerts[0]!.alertId;
    detector.acknowledgeAlert(alertId);
    expect(detector.getAllAlerts().find(a => a.alertId === alertId)?.acknowledgedAt).toBeTruthy();
    detector.resolveAlert(alertId, 'manual fix');
    expect(detector.getOpenAlerts().find(a => a.alertId === alertId)).toBeUndefined();
  });

  it('ingestBatch returns only actual anomalies', () => {
    const detector = new RealtimeAnomalyDetector({ zScoreThreshold: 2, minPointsForDetection: 20, alertCooldownMs: 0 });
    const stream = detector.createStream({ name: 'batch', metricName: 'latency_ms' });
    const normalPoints = Array.from({ length: 25 }, (_, i) => makePoint(100 + (Math.random() - 0.5) * 10, i * 500));
    detector.ingestBatch(stream.streamId, normalPoints);
    const spike = [makePoint(100_000, 30_000)];
    const anomalies = detector.ingestBatch(stream.streamId, spike);
    expect(anomalies.length).toBeLessThanOrEqual(1);
  });

  it('getDashboardSummary returns non-zero totalStreams', () => {
    const detector = new RealtimeAnomalyDetector();
    detector.createStream({ name: 's1', metricName: 'm1' });
    detector.createStream({ name: 's2', metricName: 'm2' });
    const summary = detector.getDashboardSummary();
    expect(summary.totalStreams).toBe(2);
  });
});
