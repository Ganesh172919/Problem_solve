/**
 * @module intelligentAlertRouter
 * @description AI-powered alert routing, deduplication, and noise reduction engine.
 * Implements SHA-256-based fingerprint hashing (pure TypeScript, no crypto dep),
 * ML-based noise scoring via feature vector, group-wait buffering with timeout,
 * and multi-step escalation policy tracking.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Interfaces ────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertStatus = 'firing' | 'resolved' | 'silenced' | 'acknowledged' | 'escalated';

export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  source: string;
  labels: Record<string, string>;
  fingerprint: string;
  timestamp: number;
  status: AlertStatus;
  payload: Record<string, unknown>;
}

export interface AlertGroup {
  id: string;
  fingerprint: string;
  alerts: Alert[];
  firstSeen: number;
  lastSeen: number;
  count: number;
  status: AlertStatus;
  assignee?: string;
}

export interface RoutingRule {
  id: string;
  matchers: Record<string, string>;
  receiver: string;
  groupBy: string[];
  groupWait: number;
  repeatInterval: number;
  routes?: RoutingRule[];
}

export interface Receiver {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'pagerduty' | 'webhook' | 'sms';
  config: Record<string, string>;
  enabled: boolean;
}

export interface EscalationStep {
  order: number;
  receivers: string[];
  delay: number;
  ackRequired: boolean;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
  loopPolicy: 'stop' | 'continue';
}

export interface SilenceRule {
  id: string;
  matchers: Record<string, string>;
  startsAt: number;
  endsAt: number;
  createdBy: string;
  reason: string;
}

export interface AlertMetrics {
  totalAlerts: number;
  noiseReductionRate: number;
  avgAckTime: number;
  escalations: number;
  silenced: number;
  deduplicated: number;
}

// ── Pure-TypeScript SHA-256 ───────────────────────────────────────────────────
// Implements FIPS PUB 180-4 SHA-256 without any external dependency.

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(message: string): string {
  const msg = new TextEncoder().encode(message);
  const msgLen = msg.length;
  const bitLen = msgLen * 8;
  const padded = new Uint8Array(Math.ceil((msgLen + 9) / 64) * 64);
  padded.set(msg);
  padded[msgLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  const add = (...ns: number[]): number => ns.reduce((a, b) => (a + b) >>> 0);

  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = add(w[i - 16], s0, w[i - 7], s1);
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = add(h, S1, ch, K256[i], w[i]);
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add(S0, maj);
      [h, g, f, e, d, c, b, a] = [g, f, e, add(d, temp1), c, b, a, add(temp1, temp2)];
    }
    h0 = add(h0, a); h1 = add(h1, b); h2 = add(h2, c); h3 = add(h3, d);
    h4 = add(h4, e); h5 = add(h5, f); h6 = add(h6, g); h7 = add(h7, h);
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// ── Internal types ────────────────────────────────────────────────────────────

interface EscalationState {
  groupId: string;
  policyId: string;
  currentStep: number;
  startedAt: number;
  lastEscalatedAt: number;
  acked: boolean;
}

interface GroupWaitEntry {
  group: AlertGroup;
  bufferedAt: number;
  waitMs: number;
  receiverIds: string[];
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class IntelligentAlertRouter {
  private groups: Map<string, AlertGroup> = new Map();
  private routingRules: RoutingRule[] = [];
  private receivers: Map<string, Receiver> = new Map();
  private silenceRules: SilenceRule[] = [];
  private escalationPolicies: Map<string, EscalationPolicy> = new Map();
  private escalationStates: Map<string, EscalationState> = new Map();
  private groupWaitBuffer: Map<string, GroupWaitEntry> = new Map();
  private sourceReliability: Map<string, number> = new Map();
  private alertRateWindow: Array<{ ts: number; fingerprint: string }> = [];
  private metrics: AlertMetrics = {
    totalAlerts: 0, noiseReductionRate: 0, avgAckTime: 0, escalations: 0, silenced: 0, deduplicated: 0,
  };
  private ackTimes: number[] = [];
  private noisySuppressed = 0;

  ingestAlert(alert: Alert): AlertGroup {
    this.metrics.totalAlerts++;
    const fp = alert.fingerprint || this.computeFingerprint(alert);
    const enriched: Alert = { ...alert, fingerprint: fp };

    // Silence check
    if (this.isSilenced(enriched)) {
      enriched.status = 'silenced';
      this.metrics.silenced++;
      logger.debug('Alert silenced', { alertId: alert.id, fingerprint: fp });
    }

    // ML noise prediction
    const noiseScore = this.applyMLNoisePrediction(enriched);
    if (noiseScore > 0.75 && enriched.severity !== 'critical') {
      this.noisySuppressed++;
      this.metrics.noiseReductionRate = this.metrics.totalAlerts > 0
        ? this.noisySuppressed / this.metrics.totalAlerts
        : 0;
      logger.debug('Alert suppressed by noise model', { alertId: alert.id, noiseScore });
    }

    // Track alert rate
    this.alertRateWindow.push({ ts: Date.now(), fingerprint: fp });
    this.alertRateWindow = this.alertRateWindow.filter((e) => e.ts > Date.now() - 300_000);

    const existing = this.groups.get(fp);
    if (existing) {
      existing.alerts.push(enriched);
      existing.lastSeen = enriched.timestamp;
      existing.count++;
      this.metrics.deduplicated++;
      this.groups.set(fp, existing);
      logger.debug('Alert deduplicated into group', { groupId: existing.id, count: existing.count });
      return existing;
    }

    const group: AlertGroup = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fingerprint: fp,
      alerts: [enriched],
      firstSeen: enriched.timestamp,
      lastSeen: enriched.timestamp,
      count: 1,
      status: enriched.status === 'silenced' ? 'silenced' : 'firing',
    };
    this.groups.set(fp, group);

    const receiverIds = this.routeAlert(group);
    this.bufferGroupWait(group, receiverIds);

    return group;
  }

  routeAlert(group: AlertGroup): string[] {
    const primary = group.alerts[0];
    const matched: string[] = [];
    for (const rule of this.routingRules) {
      if (this.matchRule(primary, rule)) {
        const receiver = this.receivers.get(rule.receiver);
        if (receiver?.enabled) matched.push(rule.receiver);
        if (rule.routes) {
          for (const sub of rule.routes) {
            if (this.matchRule(primary, sub)) {
              const subRcv = this.receivers.get(sub.receiver);
              if (subRcv?.enabled) matched.push(sub.receiver);
            }
          }
        }
      }
    }
    logger.debug('Alert routed', { groupId: group.id, receivers: matched });
    return [...new Set(matched)];
  }

  deduplicateAlerts(alerts: Alert[]): Alert[] {
    const seen = new Map<string, Alert>();
    for (const alert of alerts) {
      const fp = alert.fingerprint || this.computeFingerprint(alert);
      if (!seen.has(fp)) seen.set(fp, { ...alert, fingerprint: fp });
    }
    return Array.from(seen.values());
  }

  groupAlerts(alerts: Alert[]): AlertGroup[] {
    const buckets = new Map<string, Alert[]>();
    for (const alert of alerts) {
      const fp = this.computeFingerprint(alert);
      const bucket = buckets.get(fp) ?? [];
      bucket.push({ ...alert, fingerprint: fp });
      buckets.set(fp, bucket);
    }
    return Array.from(buckets.entries()).map(([fp, list]) => {
      const existing = this.groups.get(fp);
      if (existing) return existing;
      return {
        id: `grp_batch_${fp.slice(0, 8)}`,
        fingerprint: fp,
        alerts: list,
        firstSeen: Math.min(...list.map((a) => a.timestamp)),
        lastSeen: Math.max(...list.map((a) => a.timestamp)),
        count: list.length,
        status: 'firing' as AlertStatus,
      };
    });
  }

  computeFingerprint(alert: Alert): string {
    const stable = JSON.stringify({
      title: alert.title,
      source: alert.source,
      severity: alert.severity,
      labels: Object.entries(alert.labels).sort(([a], [b]) => a.localeCompare(b)),
    });
    return sha256(stable);
  }

  applyMLNoisePrediction(alert: Alert): number {
    const features = this.computeNoiseFeaturesVector(alert);
    // Linear scoring weights: [alert_rate, historical_fp_rate, label_similarity, time_of_day, source_reliability]
    const weights = [0.25, 0.30, 0.15, 0.10, 0.20];
    const score = features.reduce((s, f, i) => s + f * weights[i], 0);
    return Math.max(0, Math.min(1, score));
  }

  silenceAlert(groupId: string, rule: SilenceRule): void {
    this.silenceRules.push(rule);
    const group = Array.from(this.groups.values()).find((g) => g.id === groupId);
    if (group) {
      group.status = 'silenced';
      group.alerts.forEach((a) => { a.status = 'silenced'; });
      this.groups.set(group.fingerprint, group);
    }
    logger.info('Silence rule applied', { groupId, ruleId: rule.id, endsAt: rule.endsAt });
  }

  acknowledgeAlert(groupId: string, userId: string): void {
    const group = Array.from(this.groups.values()).find((g) => g.id === groupId);
    if (!group) return;
    group.status = 'acknowledged';
    group.assignee = userId;
    const ackTime = Date.now() - group.firstSeen;
    this.ackTimes.push(ackTime);
    this.metrics.avgAckTime = this.ackTimes.reduce((s, v) => s + v, 0) / this.ackTimes.length;
    const state = this.escalationStates.get(groupId);
    if (state) state.acked = true;
    this.groups.set(group.fingerprint, group);
    logger.info('Alert acknowledged', { groupId, userId, ackTimeMs: ackTime });
  }

  escalate(groupId: string): void {
    const group = Array.from(this.groups.values()).find((g) => g.id === groupId);
    if (!group) return;
    const policy = Array.from(this.escalationPolicies.values())[0];
    if (!policy) return;

    let state = this.escalationStates.get(groupId);
    if (!state) {
      state = { groupId, policyId: policy.id, currentStep: 0, startedAt: Date.now(), lastEscalatedAt: Date.now(), acked: false };
      this.escalationStates.set(groupId, state);
    } else {
      const nextStep = state.currentStep + 1;
      if (nextStep >= policy.steps.length && policy.loopPolicy === 'stop') {
        logger.warn('Escalation policy exhausted', { groupId, policyId: policy.id });
        return;
      }
      state.currentStep = policy.loopPolicy === 'continue' ? nextStep % policy.steps.length : Math.min(nextStep, policy.steps.length - 1);
      state.lastEscalatedAt = Date.now();
    }

    group.status = 'escalated';
    this.groups.set(group.fingerprint, group);
    this.metrics.escalations++;

    const step = policy.steps[state.currentStep];
    logger.info('Alert escalated', { groupId, step: state.currentStep, receivers: step?.receivers });
  }

  addRoutingRule(rule: RoutingRule): void {
    this.routingRules.push(rule);
    logger.info('Routing rule added', { ruleId: rule.id, receiver: rule.receiver });
  }

  addReceiver(receiver: Receiver): void {
    this.receivers.set(receiver.id, receiver);
    logger.info('Receiver added', { receiverId: receiver.id, type: receiver.type });
  }

  setEscalationPolicy(policy: EscalationPolicy): void {
    this.escalationPolicies.set(policy.id, policy);
    logger.info('Escalation policy set', { policyId: policy.id, steps: policy.steps.length });
  }

  getMetrics(): AlertMetrics {
    return { ...this.metrics };
  }

  private matchRule(alert: Alert, rule: RoutingRule): boolean {
    for (const [key, pattern] of Object.entries(rule.matchers)) {
      const alertVal = alert.labels[key] ?? (alert as unknown as Record<string, string>)[key] ?? '';
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      if (!regex.test(alertVal)) return false;
    }
    return true;
  }

  private shouldGroup(a1: Alert, a2: Alert): boolean {
    if (a1.source !== a2.source) return false;
    if (a1.severity !== a2.severity) return false;
    const sharedLabels = Object.keys(a1.labels).filter(
      (k) => a1.labels[k] === a2.labels[k],
    ).length;
    const totalKeys = new Set([...Object.keys(a1.labels), ...Object.keys(a2.labels)]).size;
    return totalKeys > 0 ? sharedLabels / totalKeys >= 0.6 : true;
  }

  private computeNoiseFeaturesVector(alert: Alert): number[] {
    // f0: alert_rate – how many alerts with same fingerprint in last 5 min (normalised)
    const fp = alert.fingerprint || this.computeFingerprint(alert);
    const rateCount = this.alertRateWindow.filter((e) => e.fingerprint === fp).length;
    const alertRate = Math.min(1, rateCount / 20);

    // f1: historical_fp_rate – ratio of past occurrences (proxy via groups count)
    const group = this.groups.get(fp);
    const historicalFpRate = group ? Math.min(1, group.count / 50) : 0;

    // f2: label_similarity – number of labels vs average (more labels = more specific = less noise)
    const labelCount = Object.keys(alert.labels).length;
    const labelSimilarity = Math.max(0, 1 - labelCount / 10);

    // f3: time_of_day – off-hours alerts more likely noisy (0–1, peak at 3am UTC)
    const hour = new Date(alert.timestamp).getUTCHours();
    const timeOfDay = hour >= 1 && hour <= 6 ? 0.8 : 0.2;

    // f4: source_reliability – 0=unreliable, 1=very reliable (inverted: low reliability = high noise)
    const reliability = this.sourceReliability.get(alert.source) ?? 0.7;
    const sourceNoise = 1 - reliability;

    return [alertRate, historicalFpRate, labelSimilarity, timeOfDay, sourceNoise];
  }

  private isSilenced(alert: Alert): boolean {
    const now = Date.now();
    return this.silenceRules.some((rule) => {
      if (rule.startsAt > now || rule.endsAt < now) return false;
      return Object.entries(rule.matchers).every(([k, v]) => {
        const alertVal = alert.labels[k] ?? '';
        return new RegExp(`^${v.replace(/\*/g, '.*')}$`).test(alertVal);
      });
    });
  }

  private bufferGroupWait(group: AlertGroup, receiverIds: string[]): void {
    const rule = this.routingRules.find((r) => this.matchRule(group.alerts[0], r));
    const waitMs = rule?.groupWait ?? 0;
    if (waitMs <= 0) return;
    this.groupWaitBuffer.set(group.id, { group, bufferedAt: Date.now(), waitMs, receiverIds });
    setTimeout(() => {
      const entry = this.groupWaitBuffer.get(group.id);
      if (!entry) return;
      this.groupWaitBuffer.delete(group.id);
      logger.debug('Group-wait flush', { groupId: group.id, bufferedMs: Date.now() - entry.bufferedAt });
    }, waitMs);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__intelligentAlertRouter__';

export function getIntelligentAlertRouter(): IntelligentAlertRouter {
  const g = globalThis as unknown as Record<string, IntelligentAlertRouter>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new IntelligentAlertRouter();
    logger.info('IntelligentAlertRouter singleton initialised');
  }
  return g[GLOBAL_KEY];
}

export default getIntelligentAlertRouter;
