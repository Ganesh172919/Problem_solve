/**
 * Multi-Region Router
 *
 * Geographic routing with latency-based selection, failover,
 * data residency enforcement, and cross-region replication.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface Region {
  id: string;
  name: string;
  provider: 'aws' | 'gcp' | 'azure' | 'self-hosted';
  location: GeoLocation;
  status: 'active' | 'degraded' | 'down' | 'maintenance';
  capacity: RegionCapacity;
  endpoints: RegionEndpoint[];
  dataResidency: DataResidencyPolicy;
  priority: number;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  country: string;
  continent: string;
}

export interface RegionCapacity {
  maxRequests: number;
  currentLoad: number;
  healthScore: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  lastHealthCheck: number;
}

export interface RegionEndpoint {
  url: string;
  type: 'primary' | 'secondary' | 'read-replica';
  protocol: 'https' | 'grpc' | 'websocket';
  weight: number;
}

export interface DataResidencyPolicy {
  allowedCountries: string[];
  blockedCountries: string[];
  gdprCompliant: boolean;
  encryptionRequired: boolean;
  retentionDays: number;
}

export interface RoutingPolicy {
  strategy: 'latency' | 'geographic' | 'weighted' | 'failover' | 'round-robin';
  stickySession: boolean;
  sessionTTL: number;
  maxRetries: number;
  timeoutMs: number;
  healthCheckInterval: number;
  failoverThreshold: number;
}

export interface RoutingDecision {
  selectedRegion: string;
  fallbackRegions: string[];
  reason: string;
  latencyEstimate: number;
  confidence: number;
  sessionId: string | null;
}

export interface ReplicationConfig {
  mode: 'sync' | 'async' | 'semi-sync';
  replicaRegions: string[];
  conflictResolution: 'last-write-wins' | 'merge' | 'custom';
  maxLag: number;
  retryPolicy: { maxRetries: number; delayMs: number };
}

export interface ReplicationStatus {
  sourceRegion: string;
  targetRegion: string;
  lagMs: number;
  status: 'healthy' | 'lagging' | 'error';
  lastSyncTime: number;
  pendingOperations: number;
}

export interface CrossRegionMetrics {
  totalRequests: number;
  byRegion: Record<string, { requests: number; errors: number; avgLatency: number }>;
  failoverCount: number;
  avgRoutingDecisionMs: number;
  dataResidencyViolations: number;
}

export class MultiRegionRouter {
  private regions: Map<string, Region> = new Map();
  private policy: RoutingPolicy;
  private sessions: Map<string, { regionId: string; expiresAt: number }> = new Map();
  private replicationConfigs: Map<string, ReplicationConfig> = new Map();
  private replicationStatus: Map<string, ReplicationStatus> = new Map();
  private roundRobinIndex: number = 0;
  private metrics: CrossRegionMetrics;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(policy: Partial<RoutingPolicy> = {}) {
    this.policy = {
      strategy: 'latency',
      stickySession: true,
      sessionTTL: 3600000,
      maxRetries: 3,
      timeoutMs: 5000,
      healthCheckInterval: 30000,
      failoverThreshold: 0.5,
      ...policy,
    };

    this.metrics = {
      totalRequests: 0,
      byRegion: {},
      failoverCount: 0,
      avgRoutingDecisionMs: 0,
      dataResidencyViolations: 0,
    };
  }

  addRegion(region: Region): void {
    this.regions.set(region.id, region);
    this.metrics.byRegion[region.id] = { requests: 0, errors: 0, avgLatency: 0 };
    logger.info('Region added', { regionId: region.id, name: region.name });
  }

  removeRegion(regionId: string): boolean {
    const removed = this.regions.delete(regionId);
    if (removed) {
      delete this.metrics.byRegion[regionId];
    }
    return removed;
  }

  updateRegionStatus(regionId: string, status: Region['status'], capacity?: Partial<RegionCapacity>): boolean {
    const region = this.regions.get(regionId);
    if (!region) return false;

    region.status = status;
    if (capacity) {
      region.capacity = { ...region.capacity, ...capacity };
    }
    return true;
  }

  route(params: {
    clientLocation?: GeoLocation;
    sessionId?: string;
    dataResidencyRequirement?: string;
    preferredRegion?: string;
  }): RoutingDecision {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    if (params.sessionId && this.policy.stickySession) {
      const session = this.sessions.get(params.sessionId);
      if (session && session.expiresAt > Date.now()) {
        const region = this.regions.get(session.regionId);
        if (region && region.status === 'active') {
          this.recordRouteMetrics(session.regionId, Date.now() - startTime);
          return {
            selectedRegion: session.regionId,
            fallbackRegions: this.getFallbacks(session.regionId),
            reason: 'sticky_session',
            latencyEstimate: region.capacity.avgLatencyMs,
            confidence: 0.95,
            sessionId: params.sessionId,
          };
        }
      }
    }

    let candidates = this.getHealthyRegions();

    if (params.dataResidencyRequirement) {
      candidates = candidates.filter((r) =>
        r.dataResidency.allowedCountries.length === 0 ||
        r.dataResidency.allowedCountries.includes(params.dataResidencyRequirement!),
      );

      if (candidates.length === 0) {
        this.metrics.dataResidencyViolations++;
        logger.warn('No regions available for data residency requirement', {
          requirement: params.dataResidencyRequirement,
        });
      }
    }

    if (params.preferredRegion) {
      const preferred = candidates.find((r) => r.id === params.preferredRegion);
      if (preferred) {
        this.recordRouteMetrics(preferred.id, Date.now() - startTime);
        return this.buildDecision(preferred, 'preferred', params.sessionId || null);
      }
    }

    const selected = this.selectRegion(candidates, params.clientLocation);
    if (!selected) {
      return {
        selectedRegion: '',
        fallbackRegions: [],
        reason: 'no_available_regions',
        latencyEstimate: -1,
        confidence: 0,
        sessionId: null,
      };
    }

    if (params.sessionId && this.policy.stickySession) {
      this.sessions.set(params.sessionId, {
        regionId: selected.id,
        expiresAt: Date.now() + this.policy.sessionTTL,
      });
    }

    this.recordRouteMetrics(selected.id, Date.now() - startTime);
    return this.buildDecision(selected, this.policy.strategy, params.sessionId || null);
  }

  configureReplication(sourceRegion: string, config: ReplicationConfig): void {
    this.replicationConfigs.set(sourceRegion, config);

    for (const targetRegion of config.replicaRegions) {
      const key = `${sourceRegion}->${targetRegion}`;
      this.replicationStatus.set(key, {
        sourceRegion,
        targetRegion,
        lagMs: 0,
        status: 'healthy',
        lastSyncTime: Date.now(),
        pendingOperations: 0,
      });
    }
  }

  getReplicationStatus(sourceRegion?: string): ReplicationStatus[] {
    const statuses = Array.from(this.replicationStatus.values());
    if (sourceRegion) {
      return statuses.filter((s) => s.sourceRegion === sourceRegion);
    }
    return statuses;
  }

  updateReplicationLag(sourceRegion: string, targetRegion: string, lagMs: number): void {
    const key = `${sourceRegion}->${targetRegion}`;
    const status = this.replicationStatus.get(key);
    if (status) {
      status.lagMs = lagMs;
      status.lastSyncTime = Date.now();
      status.status = lagMs < 1000 ? 'healthy' : lagMs < 5000 ? 'lagging' : 'error';
    }
  }

  startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.policy.healthCheckInterval);
    logger.info('Health checks started', { interval: this.policy.healthCheckInterval });
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  getMetrics(): CrossRegionMetrics {
    return { ...this.metrics };
  }

  getRegions(): Region[] {
    return Array.from(this.regions.values());
  }

  getRegion(regionId: string): Region | undefined {
    return this.regions.get(regionId);
  }

  cleanExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  private getHealthyRegions(): Region[] {
    return Array.from(this.regions.values()).filter(
      (r) => r.status === 'active' && r.capacity.healthScore >= this.policy.failoverThreshold,
    );
  }

  private selectRegion(candidates: Region[], clientLocation?: GeoLocation): Region | null {
    if (candidates.length === 0) return null;

    switch (this.policy.strategy) {
      case 'latency':
        return this.selectByLatency(candidates, clientLocation);
      case 'geographic':
        return this.selectByGeography(candidates, clientLocation);
      case 'weighted':
        return this.selectByWeight(candidates);
      case 'round-robin':
        return this.selectByRoundRobin(candidates);
      case 'failover':
        return this.selectByPriority(candidates);
      default:
        return candidates[0];
    }
  }

  private selectByLatency(candidates: Region[], clientLocation?: GeoLocation): Region {
    if (clientLocation) {
      return candidates.sort((a, b) => {
        const distA = this.calculateDistance(clientLocation, a.location);
        const distB = this.calculateDistance(clientLocation, b.location);
        const latA = a.capacity.avgLatencyMs + distA * 0.01;
        const latB = b.capacity.avgLatencyMs + distB * 0.01;
        return latA - latB;
      })[0];
    }
    return candidates.sort((a, b) => a.capacity.avgLatencyMs - b.capacity.avgLatencyMs)[0];
  }

  private selectByGeography(candidates: Region[], clientLocation?: GeoLocation): Region {
    if (!clientLocation) return candidates[0];
    return candidates.sort(
      (a, b) =>
        this.calculateDistance(clientLocation, a.location) -
        this.calculateDistance(clientLocation, b.location),
    )[0];
  }

  private selectByWeight(candidates: Region[]): Region {
    const totalWeight = candidates.reduce(
      (sum, r) => sum + r.endpoints.reduce((es, e) => es + e.weight, 0),
      0,
    );
    let random = Math.random() * totalWeight;

    for (const region of candidates) {
      const weight = region.endpoints.reduce((sum, e) => sum + e.weight, 0);
      random -= weight;
      if (random <= 0) return region;
    }

    return candidates[0];
  }

  private selectByRoundRobin(candidates: Region[]): Region {
    const index = this.roundRobinIndex % candidates.length;
    this.roundRobinIndex++;
    return candidates[index];
  }

  private selectByPriority(candidates: Region[]): Region {
    return candidates.sort((a, b) => a.priority - b.priority)[0];
  }

  private getFallbacks(primaryRegionId: string): string[] {
    return Array.from(this.regions.values())
      .filter((r) => r.id !== primaryRegionId && r.status === 'active')
      .sort((a, b) => a.priority - b.priority)
      .slice(0, this.policy.maxRetries)
      .map((r) => r.id);
  }

  private buildDecision(region: Region, reason: string, sessionId: string | null): RoutingDecision {
    return {
      selectedRegion: region.id,
      fallbackRegions: this.getFallbacks(region.id),
      reason,
      latencyEstimate: region.capacity.avgLatencyMs,
      confidence: region.capacity.healthScore,
      sessionId,
    };
  }

  private calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number {
    const R = 6371;
    const dLat = this.toRad(loc2.latitude - loc1.latitude);
    const dLon = this.toRad(loc2.longitude - loc1.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.latitude)) *
        Math.cos(this.toRad(loc2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  private recordRouteMetrics(regionId: string, decisionTimeMs: number): void {
    const regionMetrics = this.metrics.byRegion[regionId];
    if (regionMetrics) {
      regionMetrics.requests++;
    }
    this.metrics.avgRoutingDecisionMs =
      (this.metrics.avgRoutingDecisionMs * (this.metrics.totalRequests - 1) + decisionTimeMs) /
      this.metrics.totalRequests;
  }

  private performHealthChecks(): void {
    for (const [regionId, region] of this.regions) {
      const score = 1.0 - region.capacity.errorRate;
      region.capacity.healthScore = score;
      region.capacity.lastHealthCheck = Date.now();

      if (score < this.policy.failoverThreshold && region.status === 'active') {
        region.status = 'degraded';
        this.metrics.failoverCount++;
        logger.warn('Region degraded', { regionId, healthScore: score });
      } else if (score >= this.policy.failoverThreshold && region.status === 'degraded') {
        region.status = 'active';
        logger.info('Region recovered', { regionId, healthScore: score });
      }
    }
  }
}

export function createMultiRegionRouter(policy?: Partial<RoutingPolicy>): MultiRegionRouter {
  return new MultiRegionRouter(policy);
}
