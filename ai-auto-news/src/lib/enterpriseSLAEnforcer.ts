import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type SLATier = 'platinum' | 'gold' | 'silver' | 'bronze';
type ViolationSeverity = 'critical' | 'major' | 'minor' | 'warning';
type EscalationLevel = 1 | 2 | 3;

interface SLADefinition {
  id: string;
  tenantId: string;
  tier: SLATier;
  availabilityTarget: number;
  maxResponseTimeMs: number;
  maxThroughputRps: number;
  supportResponseMinutes: number;
  maintenanceWindowHours: number;
  dataRetentionDays: number;
  customTerms: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
}

interface SLAMetricSnapshot {
  tenantId: string;
  timestamp: Date;
  availabilityPercent: number;
  avgResponseTimeMs: number;
  p99ResponseTimeMs: number;
  throughputRps: number;
  errorRate: number;
  uptimeSeconds: number;
  downtimeSeconds: number;
}

interface SLAViolation {
  id: string;
  tenantId: string;
  slaId: string;
  metric: string;
  threshold: number;
  actual: number;
  severity: ViolationSeverity;
  escalationLevel: EscalationLevel;
  detectedAt: Date;
  resolvedAt: Date | null;
  compensationApplied: boolean;
  compensationAmount: number;
}

interface ResourceReservation {
  id: string;
  tenantId: string;
  tier: SLATier;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
  networkBandwidthMbps: number;
  reservedAt: Date;
  active: boolean;
}

interface CompensationPolicy {
  tier: SLATier;
  availabilityBreach: number;
  responseTimeBreach: number;
  throughputBreach: number;
  maxMonthlyCompensation: number;
}

interface SLAReport {
  tenantId: string;
  slaId: string;
  tier: SLATier;
  periodStart: Date;
  periodEnd: Date;
  availabilityActual: number;
  availabilityTarget: number;
  avgResponseTimeMs: number;
  maxResponseTimeTarget: number;
  violationCount: number;
  totalCompensation: number;
  complianceStatus: 'compliant' | 'at_risk' | 'breached';
  metrics: SLAMetricSnapshot[];
}

interface CapacityPlan {
  tier: SLATier;
  currentTenants: number;
  projectedTenants: number;
  requiredCpuCores: number;
  requiredMemoryMb: number;
  requiredStorageMb: number;
  headroomPercent: number;
  recommendation: string;
}

// ─── Tier Configuration ──────────────────────────────────────────────────────

const TIER_PRIORITY: Record<SLATier, number> = {
  platinum: 100,
  gold: 75,
  silver: 50,
  bronze: 25,
};

const DEFAULT_RESOURCE_PROFILES: Record<SLATier, Omit<ResourceReservation, 'id' | 'tenantId' | 'tier' | 'reservedAt' | 'active'>> = {
  platinum: { cpuCores: 8, memoryMb: 16384, storageMb: 102400, networkBandwidthMbps: 1000 },
  gold: { cpuCores: 4, memoryMb: 8192, storageMb: 51200, networkBandwidthMbps: 500 },
  silver: { cpuCores: 2, memoryMb: 4096, storageMb: 25600, networkBandwidthMbps: 250 },
  bronze: { cpuCores: 1, memoryMb: 2048, storageMb: 10240, networkBandwidthMbps: 100 },
};

const DEFAULT_COMPENSATION: Record<SLATier, CompensationPolicy> = {
  platinum: { tier: 'platinum', availabilityBreach: 30, responseTimeBreach: 20, throughputBreach: 15, maxMonthlyCompensation: 50 },
  gold: { tier: 'gold', availabilityBreach: 20, responseTimeBreach: 15, throughputBreach: 10, maxMonthlyCompensation: 35 },
  silver: { tier: 'silver', availabilityBreach: 10, responseTimeBreach: 10, throughputBreach: 5, maxMonthlyCompensation: 20 },
  bronze: { tier: 'bronze', availabilityBreach: 5, responseTimeBreach: 5, throughputBreach: 0, maxMonthlyCompensation: 10 },
};

// ─── Implementation ──────────────────────────────────────────────────────────

class EnterpriseSLAEnforcer {
  private slaDefinitions = new Map<string, SLADefinition>();
  private tenantSlaIndex = new Map<string, string>();
  private metrics: SLAMetricSnapshot[] = [];
  private violations = new Map<string, SLAViolation>();
  private reservations = new Map<string, ResourceReservation>();
  private tenantReservationIndex = new Map<string, string>();
  private compensationPolicies = new Map<SLATier, CompensationPolicy>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    for (const [tier, policy] of Object.entries(DEFAULT_COMPENSATION)) {
      this.compensationPolicies.set(tier as SLATier, policy);
    }
    if (typeof setInterval !== 'undefined') {
      this.checkInterval = setInterval(() => this.pruneOldMetrics(), 3_600_000);
    }
    logger.info('EnterpriseSLAEnforcer initialized');
  }

  // ── SLA Definitions ─────────────────────────────────────────────────────

  defineSLA(params: Omit<SLADefinition, 'createdAt'>): SLADefinition {
    if (!params.id || !params.tenantId) {
      throw new Error('SLA definition requires id and tenantId');
    }
    if (params.availabilityTarget < 0 || params.availabilityTarget > 100) {
      throw new Error('Availability target must be between 0 and 100');
    }
    if (params.maxResponseTimeMs <= 0) {
      throw new Error('Max response time must be positive');
    }

    const sla: SLADefinition = { ...params, createdAt: new Date() };
    this.slaDefinitions.set(params.id, sla);
    this.tenantSlaIndex.set(params.tenantId, params.id);
    logger.info('SLA defined', { slaId: params.id, tenantId: params.tenantId, tier: params.tier });
    return sla;
  }

  getSLA(slaId: string): SLADefinition | null {
    return this.slaDefinitions.get(slaId) ?? null;
  }

  getTenantSLA(tenantId: string): SLADefinition | null {
    const slaId = this.tenantSlaIndex.get(tenantId);
    return slaId ? (this.slaDefinitions.get(slaId) ?? null) : null;
  }

  // ── Priority Routing ────────────────────────────────────────────────────

  getRoutingPriority(tenantId: string): { priority: number; tier: SLATier; maxResponseTimeMs: number } {
    const sla = this.getTenantSLA(tenantId);
    if (!sla) {
      return { priority: 0, tier: 'bronze', maxResponseTimeMs: 5000 };
    }
    return {
      priority: TIER_PRIORITY[sla.tier],
      tier: sla.tier,
      maxResponseTimeMs: sla.maxResponseTimeMs,
    };
  }

  rankTenantsByPriority(tenantIds: string[]): string[] {
    return [...tenantIds].sort((a, b) => {
      const pa = this.getRoutingPriority(a).priority;
      const pb = this.getRoutingPriority(b).priority;
      return pb - pa;
    });
  }

  // ── Resource Reservation ────────────────────────────────────────────────

  reserveResources(tenantId: string, overrides?: Partial<Omit<ResourceReservation, 'id' | 'tenantId' | 'tier' | 'reservedAt' | 'active'>>): ResourceReservation {
    const sla = this.getTenantSLA(tenantId);
    if (!sla) throw new Error(`No SLA defined for tenant ${tenantId}`);

    const existingId = this.tenantReservationIndex.get(tenantId);
    if (existingId) {
      const existing = this.reservations.get(existingId);
      if (existing?.active) {
        throw new Error(`Active reservation already exists for tenant ${tenantId}`);
      }
    }

    const profile = DEFAULT_RESOURCE_PROFILES[sla.tier];
    const id = `res_${tenantId}_${Date.now()}`;
    const reservation: ResourceReservation = {
      id,
      tenantId,
      tier: sla.tier,
      cpuCores: overrides?.cpuCores ?? profile.cpuCores,
      memoryMb: overrides?.memoryMb ?? profile.memoryMb,
      storageMb: overrides?.storageMb ?? profile.storageMb,
      networkBandwidthMbps: overrides?.networkBandwidthMbps ?? profile.networkBandwidthMbps,
      reservedAt: new Date(),
      active: true,
    };

    this.reservations.set(id, reservation);
    this.tenantReservationIndex.set(tenantId, id);
    logger.info('Resources reserved', { tenantId, tier: sla.tier, reservationId: id });
    return reservation;
  }

  releaseResources(tenantId: string): void {
    const resId = this.tenantReservationIndex.get(tenantId);
    if (!resId) return;
    const reservation = this.reservations.get(resId);
    if (reservation) {
      reservation.active = false;
      logger.info('Resources released', { tenantId, reservationId: resId });
    }
  }

  getReservation(tenantId: string): ResourceReservation | null {
    const resId = this.tenantReservationIndex.get(tenantId);
    if (!resId) return null;
    const res = this.reservations.get(resId);
    return res?.active ? res : null;
  }

  // ── Metric Ingestion & Violation Detection ──────────────────────────────

  recordMetrics(snapshot: SLAMetricSnapshot): SLAViolation[] {
    this.metrics.push(snapshot);
    return this.detectViolations(snapshot);
  }

  private detectViolations(snapshot: SLAMetricSnapshot): SLAViolation[] {
    const sla = this.getTenantSLA(snapshot.tenantId);
    if (!sla) return [];

    const violations: SLAViolation[] = [];

    if (snapshot.availabilityPercent < sla.availabilityTarget) {
      violations.push(
        this.createViolation(snapshot.tenantId, sla.id, 'availability', sla.availabilityTarget, snapshot.availabilityPercent),
      );
    }

    if (snapshot.p99ResponseTimeMs > sla.maxResponseTimeMs) {
      violations.push(
        this.createViolation(snapshot.tenantId, sla.id, 'response_time', sla.maxResponseTimeMs, snapshot.p99ResponseTimeMs),
      );
    }

    if (snapshot.throughputRps < sla.maxThroughputRps * 0.8) {
      violations.push(
        this.createViolation(snapshot.tenantId, sla.id, 'throughput', sla.maxThroughputRps, snapshot.throughputRps),
      );
    }

    if (snapshot.errorRate > 1) {
      violations.push(
        this.createViolation(snapshot.tenantId, sla.id, 'error_rate', 1, snapshot.errorRate),
      );
    }

    return violations;
  }

  private createViolation(
    tenantId: string,
    slaId: string,
    metric: string,
    threshold: number,
    actual: number,
  ): SLAViolation {
    const severity = this.classifyViolationSeverity(metric, threshold, actual);
    const escalation = this.determineEscalation(tenantId, metric);

    const id = `viol_${tenantId}_${metric}_${Date.now()}`;
    const violation: SLAViolation = {
      id,
      tenantId,
      slaId,
      metric,
      threshold,
      actual,
      severity,
      escalationLevel: escalation,
      detectedAt: new Date(),
      resolvedAt: null,
      compensationApplied: false,
      compensationAmount: 0,
    };

    this.violations.set(id, violation);
    logger.warn('SLA violation detected', { violationId: id, tenantId, metric, severity, threshold, actual });
    return violation;
  }

  private classifyViolationSeverity(metric: string, threshold: number, actual: number): ViolationSeverity {
    let deviation: number;
    if (metric === 'availability') {
      deviation = threshold - actual;
      if (deviation > 5) return 'critical';
      if (deviation > 2) return 'major';
      if (deviation > 0.5) return 'minor';
      return 'warning';
    }

    if (metric === 'response_time' || metric === 'error_rate') {
      deviation = actual / threshold;
      if (deviation > 3) return 'critical';
      if (deviation > 2) return 'major';
      if (deviation > 1.5) return 'minor';
      return 'warning';
    }

    // throughput (lower is worse)
    deviation = threshold > 0 ? actual / threshold : 0;
    if (deviation < 0.5) return 'critical';
    if (deviation < 0.7) return 'major';
    if (deviation < 0.9) return 'minor';
    return 'warning';
  }

  private determineEscalation(tenantId: string, metric: string): EscalationLevel {
    const recentViolations = Array.from(this.violations.values()).filter(
      (v) =>
        v.tenantId === tenantId &&
        v.metric === metric &&
        !v.resolvedAt &&
        Date.now() - v.detectedAt.getTime() < 3_600_000,
    );

    if (recentViolations.length >= 5) return 3;
    if (recentViolations.length >= 2) return 2;
    return 1;
  }

  resolveViolation(violationId: string): SLAViolation {
    const violation = this.violations.get(violationId);
    if (!violation) throw new Error(`Violation ${violationId} not found`);
    violation.resolvedAt = new Date();
    logger.info('SLA violation resolved', { violationId });
    return violation;
  }

  // ── Compensation ────────────────────────────────────────────────────────

  calculateCompensation(tenantId: string, periodStart: Date, periodEnd: Date): { totalPercent: number; violations: Array<{ violationId: string; compensationPercent: number }> } {
    const sla = this.getTenantSLA(tenantId);
    if (!sla) return { totalPercent: 0, violations: [] };

    const policy = this.compensationPolicies.get(sla.tier);
    if (!policy) return { totalPercent: 0, violations: [] };

    const periodViolations = Array.from(this.violations.values()).filter(
      (v) => v.tenantId === tenantId && v.detectedAt >= periodStart && v.detectedAt <= periodEnd,
    );

    let totalPercent = 0;
    const details: Array<{ violationId: string; compensationPercent: number }> = [];

    for (const v of periodViolations) {
      if (v.compensationApplied) continue;

      let pct = 0;
      switch (v.metric) {
        case 'availability':
          pct = policy.availabilityBreach;
          break;
        case 'response_time':
          pct = policy.responseTimeBreach;
          break;
        case 'throughput':
          pct = policy.throughputBreach;
          break;
        default:
          pct = 1;
      }

      if (v.severity === 'critical') pct *= 2;
      else if (v.severity === 'major') pct *= 1.5;

      totalPercent += pct;
      details.push({ violationId: v.id, compensationPercent: pct });
      v.compensationApplied = true;
      v.compensationAmount = pct;
    }

    totalPercent = Math.min(totalPercent, policy.maxMonthlyCompensation);
    logger.info('Compensation calculated', { tenantId, totalPercent, violationCount: details.length });
    return { totalPercent, violations: details };
  }

  // ── Reporting ───────────────────────────────────────────────────────────

  generateReport(tenantId: string, periodStart: Date, periodEnd: Date): SLAReport {
    const sla = this.getTenantSLA(tenantId);
    if (!sla) throw new Error(`No SLA defined for tenant ${tenantId}`);

    const periodMetrics = this.metrics.filter(
      (m) => m.tenantId === tenantId && m.timestamp >= periodStart && m.timestamp <= periodEnd,
    );

    const periodViolations = Array.from(this.violations.values()).filter(
      (v) => v.tenantId === tenantId && v.detectedAt >= periodStart && v.detectedAt <= periodEnd,
    );

    let avgAvailability = sla.availabilityTarget;
    let avgResponseTime = 0;

    if (periodMetrics.length > 0) {
      avgAvailability = periodMetrics.reduce((s, m) => s + m.availabilityPercent, 0) / periodMetrics.length;
      avgResponseTime = periodMetrics.reduce((s, m) => s + m.avgResponseTimeMs, 0) / periodMetrics.length;
    }

    const compensation = this.calculateCompensation(tenantId, periodStart, periodEnd);

    let complianceStatus: SLAReport['complianceStatus'];
    if (periodViolations.some((v) => v.severity === 'critical')) {
      complianceStatus = 'breached';
    } else if (periodViolations.length > 0) {
      complianceStatus = 'at_risk';
    } else {
      complianceStatus = 'compliant';
    }

    const report: SLAReport = {
      tenantId,
      slaId: sla.id,
      tier: sla.tier,
      periodStart,
      periodEnd,
      availabilityActual: Math.round(avgAvailability * 100) / 100,
      availabilityTarget: sla.availabilityTarget,
      avgResponseTimeMs: Math.round(avgResponseTime),
      maxResponseTimeTarget: sla.maxResponseTimeMs,
      violationCount: periodViolations.length,
      totalCompensation: compensation.totalPercent,
      complianceStatus,
      metrics: periodMetrics,
    };

    logger.info('SLA report generated', { tenantId, complianceStatus, violationCount: periodViolations.length });
    return report;
  }

  // ── Capacity Planning ───────────────────────────────────────────────────

  planCapacity(projectedGrowthPercent = 20): CapacityPlan[] {
    const tierCounts: Record<SLATier, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 };

    for (const sla of this.slaDefinitions.values()) {
      tierCounts[sla.tier]++;
    }

    const plans: CapacityPlan[] = [];

    for (const tier of ['platinum', 'gold', 'silver', 'bronze'] as SLATier[]) {
      const count = tierCounts[tier];
      if (count === 0) continue;

      const profile = DEFAULT_RESOURCE_PROFILES[tier];
      const projected = Math.ceil(count * (1 + projectedGrowthPercent / 100));
      const headroom = 1.15; // 15% headroom

      const plan: CapacityPlan = {
        tier,
        currentTenants: count,
        projectedTenants: projected,
        requiredCpuCores: Math.ceil(projected * profile.cpuCores * headroom),
        requiredMemoryMb: Math.ceil(projected * profile.memoryMb * headroom),
        requiredStorageMb: Math.ceil(projected * profile.storageMb * headroom),
        headroomPercent: 15,
        recommendation: this.buildCapacityRecommendation(tier, count, projected),
      };

      plans.push(plan);
    }

    return plans;
  }

  private buildCapacityRecommendation(tier: SLATier, current: number, projected: number): string {
    const growth = projected - current;
    if (growth === 0) return `${tier} tier: stable, no additional capacity needed`;

    const activeReservations = Array.from(this.reservations.values()).filter(
      (r) => r.tier === tier && r.active,
    ).length;

    const utilizationPercent = current > 0 ? Math.round((activeReservations / current) * 100) : 0;

    if (utilizationPercent > 85) {
      return `${tier} tier: high utilization (${utilizationPercent}%), provision additional resources for ${growth} projected tenants immediately`;
    }
    if (utilizationPercent > 60) {
      return `${tier} tier: moderate utilization (${utilizationPercent}%), plan capacity expansion for ${growth} new tenants within next quarter`;
    }
    return `${tier} tier: low utilization (${utilizationPercent}%), current capacity sufficient for projected growth of ${growth} tenants`;
  }

  private pruneOldMetrics(): void {
    const cutoff = Date.now() - 30 * 86_400_000;
    const before = this.metrics.length;
    this.metrics = this.metrics.filter((m) => m.timestamp.getTime() > cutoff);
    const pruned = before - this.metrics.length;
    if (pruned > 0) {
      logger.info('Old SLA metrics pruned', { pruned, remaining: this.metrics.length });
    }
  }

  getStats(): {
    totalSLAs: number;
    activeViolations: number;
    activeReservations: number;
    slasByTier: Record<SLATier, number>;
  } {
    const slasByTier: Record<SLATier, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const sla of this.slaDefinitions.values()) {
      slasByTier[sla.tier]++;
    }
    return {
      totalSLAs: this.slaDefinitions.size,
      activeViolations: Array.from(this.violations.values()).filter((v) => !v.resolvedAt).length,
      activeReservations: Array.from(this.reservations.values()).filter((r) => r.active).length,
      slasByTier,
    };
  }

  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__enterpriseSLAEnforcer__';

export function getEnterpriseSLAEnforcer(): EnterpriseSLAEnforcer {
  const g = globalThis as unknown as Record<string, EnterpriseSLAEnforcer>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new EnterpriseSLAEnforcer();
  }
  return g[GLOBAL_KEY];
}

export type {
  SLADefinition,
  SLATier,
  SLAMetricSnapshot,
  SLAViolation,
  ViolationSeverity,
  EscalationLevel,
  ResourceReservation,
  CompensationPolicy,
  SLAReport,
  CapacityPlan,
};
