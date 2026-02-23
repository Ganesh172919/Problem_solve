import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IPRecord {
  ip: string;
  score: number;
  firstSeen: string;
  lastSeen: string;
  requestCount: number;
  flagCount: number;
  tags: Set<string>;
  country: string | null;
  blocked: boolean;
  allowed: boolean;
}

export interface IPEvent {
  ip: string;
  type: IPEventType;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export type IPEventType =
  | 'request'
  | 'auth_failure'
  | 'auth_success'
  | 'rate_limit_hit'
  | 'suspicious_payload'
  | 'credential_stuffing'
  | 'scraping'
  | 'path_traversal';

export interface GeoRestriction {
  mode: 'allow' | 'deny';
  countries: Set<string>;
}

export interface ReputationReport {
  ip: string;
  score: number;
  classification: 'trusted' | 'neutral' | 'suspicious' | 'malicious';
  tags: string[];
  eventSummary: Record<string, number>;
  blocked: boolean;
  allowed: boolean;
  recommendation: 'allow' | 'monitor' | 'challenge' | 'block';
}

export interface ClusterResult {
  clusterId: string;
  ips: string[];
  commonTags: string[];
  averageScore: number;
  isBotCluster: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SCORE = 50;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const DECAY_INTERVAL_MS = 3_600_000; // 1 hour
const DECAY_AMOUNT = 1;
const SCORE_THRESHOLDS = { trusted: 80, neutral: 50, suspicious: 25 };

const EVENT_SCORE_IMPACT: Record<IPEventType, number> = {
  request: 0,
  auth_success: 2,
  auth_failure: -5,
  rate_limit_hit: -8,
  suspicious_payload: -15,
  credential_stuffing: -25,
  scraping: -10,
  path_traversal: -20,
};

const RAPID_REQUEST_THRESHOLD = 100;
const RAPID_REQUEST_WINDOW_MS = 60_000;
const CREDENTIAL_STUFFING_THRESHOLD = 10;
const CREDENTIAL_STUFFING_WINDOW_MS = 300_000;

// ─── Service ──────────────────────────────────────────────────────────────────

export class IPReputationService {
  private records: Map<string, IPRecord> = new Map();
  private events: Map<string, IPEvent[]> = new Map();
  private blocklist: Set<string> = new Set();
  private allowlist: Set<string> = new Set();
  private geoRestriction: GeoRestriction | null = null;
  private ipCountryMap: Map<string, string> = new Map();
  private log = logger.child({ service: 'IPReputationService' });

  // ─── Record Management ────────────────────────────────────────────────────

  recordEvent(ip: string, type: IPEventType, metadata: Record<string, unknown> = {}): IPRecord {
    const record = this.getOrCreateRecord(ip);
    const now = new Date().toISOString();

    const event: IPEvent = { ip, type, timestamp: now, metadata };
    const ipEvents = this.events.get(ip) ?? [];
    ipEvents.push(event);
    this.events.set(ip, ipEvents);

    record.lastSeen = now;
    record.requestCount++;
    record.score = this.clampScore(record.score + EVENT_SCORE_IMPACT[type]);

    if (EVENT_SCORE_IMPACT[type] < 0) {
      record.flagCount++;
      record.tags.add(type);
    }

    // Check for suspicious patterns
    this.detectPatterns(ip, ipEvents, record);

    return record;
  }

  getScore(ip: string): number {
    if (this.allowlist.has(ip)) return MAX_SCORE;
    if (this.blocklist.has(ip)) return MIN_SCORE;

    const record = this.records.get(ip);
    if (!record) return DEFAULT_SCORE;

    return this.applyDecay(record);
  }

  getRecord(ip: string): IPRecord | null {
    return this.records.get(ip) ?? null;
  }

  getReport(ip: string): ReputationReport {
    const record = this.records.get(ip);
    const score = this.getScore(ip);
    const events = this.events.get(ip) ?? [];

    const eventSummary: Record<string, number> = {};
    for (const e of events) {
      eventSummary[e.type] = (eventSummary[e.type] ?? 0) + 1;
    }

    const classification = this.classify(score);
    return {
      ip,
      score,
      classification,
      tags: record ? [...record.tags] : [],
      eventSummary,
      blocked: this.blocklist.has(ip) || (record?.blocked ?? false),
      allowed: this.allowlist.has(ip) || (record?.allowed ?? false),
      recommendation: this.recommend(score, classification),
    };
  }

  // ─── Blocklist / Allowlist ────────────────────────────────────────────────

  addToBlocklist(ip: string, reason?: string): void {
    this.blocklist.add(ip);
    const record = this.getOrCreateRecord(ip);
    record.blocked = true;
    record.score = MIN_SCORE;
    this.log.info('IP added to blocklist', { ip, reason });
  }

  removeFromBlocklist(ip: string): boolean {
    const removed = this.blocklist.delete(ip);
    const record = this.records.get(ip);
    if (record) {
      record.blocked = false;
      record.score = DEFAULT_SCORE;
    }
    return removed;
  }

  addToAllowlist(ip: string, reason?: string): void {
    this.allowlist.add(ip);
    const record = this.getOrCreateRecord(ip);
    record.allowed = true;
    this.log.info('IP added to allowlist', { ip, reason });
  }

  removeFromAllowlist(ip: string): boolean {
    const removed = this.allowlist.delete(ip);
    const record = this.records.get(ip);
    if (record) record.allowed = false;
    return removed;
  }

  isBlocked(ip: string): boolean {
    if (this.allowlist.has(ip)) return false;
    if (this.blocklist.has(ip)) return true;
    const record = this.records.get(ip);
    return record?.blocked ?? false;
  }

  // ─── Geographic Restrictions ──────────────────────────────────────────────

  setGeoRestriction(mode: 'allow' | 'deny', countries: string[]): void {
    this.geoRestriction = {
      mode,
      countries: new Set(countries.map(c => c.toUpperCase())),
    };
    this.log.info('Geo restriction set', { mode, countries });
  }

  clearGeoRestriction(): void {
    this.geoRestriction = null;
  }

  setIPCountry(ip: string, countryCode: string): void {
    this.ipCountryMap.set(ip, countryCode.toUpperCase());
    const record = this.records.get(ip);
    if (record) record.country = countryCode.toUpperCase();
  }

  isGeoAllowed(ip: string): boolean {
    if (!this.geoRestriction) return true;
    const country = this.ipCountryMap.get(ip);
    if (!country) return this.geoRestriction.mode === 'deny';

    if (this.geoRestriction.mode === 'allow') {
      return this.geoRestriction.countries.has(country);
    }
    return !this.geoRestriction.countries.has(country);
  }

  // ─── Pattern Detection ────────────────────────────────────────────────────

  private detectPatterns(ip: string, events: IPEvent[], record: IPRecord): void {
    const now = Date.now();

    // Rapid request detection
    const recentRequests = events.filter(
      e => now - new Date(e.timestamp).getTime() < RAPID_REQUEST_WINDOW_MS,
    );
    if (recentRequests.length > RAPID_REQUEST_THRESHOLD) {
      record.tags.add('rapid_requests');
      record.score = this.clampScore(record.score - 10);
      this.log.warn('Rapid request pattern detected', { ip, count: recentRequests.length });
    }

    // Credential stuffing detection
    const recentAuthFailures = events.filter(
      e => e.type === 'auth_failure' && now - new Date(e.timestamp).getTime() < CREDENTIAL_STUFFING_WINDOW_MS,
    );
    if (recentAuthFailures.length >= CREDENTIAL_STUFFING_THRESHOLD) {
      record.tags.add('credential_stuffing');
      record.score = this.clampScore(record.score - 20);
      this.log.warn('Credential stuffing pattern detected', { ip, failures: recentAuthFailures.length });
    }

    // Auto-block on very low score
    if (record.score <= 10 && !record.allowed) {
      record.blocked = true;
      this.blocklist.add(ip);
      this.log.warn('IP auto-blocked due to low score', { ip, score: record.score });
    }
  }

  // ─── Rate Pattern Analysis ────────────────────────────────────────────────

  analyzeRatePattern(ip: string, windowMs: number = 300_000): {
    requestsPerMinute: number;
    burstDetected: boolean;
    consistentRate: boolean;
  } {
    const events = this.events.get(ip) ?? [];
    const now = Date.now();
    const windowEvents = events.filter(e => now - new Date(e.timestamp).getTime() < windowMs);

    if (windowEvents.length < 2) {
      return { requestsPerMinute: 0, burstDetected: false, consistentRate: false };
    }

    const windowMinutes = windowMs / 60_000;
    const rpm = windowEvents.length / windowMinutes;

    // Check for bursts by looking at inter-arrival times
    const timestamps = windowEvents.map(e => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + (g - avgGap) ** 2, 0) / gaps.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgGap > 0 ? stdDev / avgGap : 0;

    return {
      requestsPerMinute: Math.round(rpm * 100) / 100,
      burstDetected: cv > 1.5,
      consistentRate: cv < 0.3,
    };
  }

  // ─── IP Clustering ────────────────────────────────────────────────────────

  detectClusters(): ClusterResult[] {
    const subnetMap: Map<string, string[]> = new Map();

    for (const ip of this.records.keys()) {
      const subnet = this.extractSubnet(ip);
      const group = subnetMap.get(subnet) ?? [];
      group.push(ip);
      subnetMap.set(subnet, group);
    }

    const clusters: ClusterResult[] = [];
    for (const [subnet, ips] of subnetMap.entries()) {
      if (ips.length < 2) continue;

      const records = ips.map(ip => this.records.get(ip)!).filter(Boolean);
      const allTags = records.flatMap(r => [...r.tags]);
      const tagCounts: Record<string, number> = {};
      for (const tag of allTags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }

      const commonTags = Object.entries(tagCounts)
        .filter(([, count]) => count >= ips.length * 0.5)
        .map(([tag]) => tag);

      const avgScore = records.reduce((sum, r) => sum + r.score, 0) / records.length;
      const isBotCluster =
        commonTags.length > 0 &&
        avgScore < SCORE_THRESHOLDS.suspicious &&
        records.every(r => {
          const pattern = this.analyzeRatePattern(r.ip);
          return pattern.consistentRate;
        });

      clusters.push({
        clusterId: crypto.createHash('sha256').update(subnet).digest('hex').slice(0, 12),
        ips,
        commonTags,
        averageScore: Math.round(avgScore * 10) / 10,
        isBotCluster,
      });
    }

    return clusters;
  }

  private extractSubnet(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) return parts.slice(0, 3).join('.');
    // IPv6: use first 4 groups
    const v6Parts = ip.split(':');
    return v6Parts.slice(0, 4).join(':');
  }

  // ─── Reputation Decay ────────────────────────────────────────────────────

  private applyDecay(record: IPRecord): number {
    const elapsed = Date.now() - new Date(record.lastSeen).getTime();
    const decayPeriods = Math.floor(elapsed / DECAY_INTERVAL_MS);

    if (decayPeriods <= 0) return record.score;

    // Scores decay toward the default over time
    const direction = record.score < DEFAULT_SCORE ? 1 : -1;
    const totalDecay = decayPeriods * DECAY_AMOUNT * direction;
    const decayed = record.score + totalDecay;

    if (direction > 0) return Math.min(decayed, DEFAULT_SCORE);
    return Math.max(decayed, DEFAULT_SCORE);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getOrCreateRecord(ip: string): IPRecord {
    let record = this.records.get(ip);
    if (!record) {
      const now = new Date().toISOString();
      record = {
        ip,
        score: DEFAULT_SCORE,
        firstSeen: now,
        lastSeen: now,
        requestCount: 0,
        flagCount: 0,
        tags: new Set(),
        country: this.ipCountryMap.get(ip) ?? null,
        blocked: this.blocklist.has(ip),
        allowed: this.allowlist.has(ip),
      };
      this.records.set(ip, record);
    }
    return record;
  }

  private clampScore(score: number): number {
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  }

  private classify(score: number): ReputationReport['classification'] {
    if (score >= SCORE_THRESHOLDS.trusted) return 'trusted';
    if (score >= SCORE_THRESHOLDS.neutral) return 'neutral';
    if (score >= SCORE_THRESHOLDS.suspicious) return 'suspicious';
    return 'malicious';
  }

  private recommend(
    score: number,
    classification: ReputationReport['classification'],
  ): ReputationReport['recommendation'] {
    if (classification === 'trusted') return 'allow';
    if (classification === 'neutral') return 'monitor';
    if (classification === 'suspicious') return 'challenge';
    return 'block';
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getIPReputationService(): IPReputationService {
  if (!globalThis.__ipReputationService__) {
    globalThis.__ipReputationService__ = new IPReputationService();
  }
  return globalThis.__ipReputationService__ as IPReputationService;
}
