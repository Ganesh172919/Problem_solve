/**
 * @module adaptiveInfrastructureProvisioner
 * @description Infrastructure provisioning engine with workload-aware auto-scaling,
 * resource quota enforcement, multi-region deployment planning, cost-aware instance
 * selection, provisioning lifecycle management, capacity reservation, scale-in/out
 * decision engine, health monitoring, drift detection, and audit trail.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProvisioningStatus = 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type ResourceType = 'compute' | 'memory' | 'storage' | 'network' | 'gpu';
export type ScalingDirection = 'scale_out' | 'scale_in' | 'no_change';

export interface ProvisioningRequest {
  id: string;
  tenantId: string;
  resourceType: ResourceType;
  region: string;
  requestedUnits: number;
  instanceType: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: ProvisioningStatus;
  requestedAt: number;
  approvedAt?: number;
  completedAt?: number;
  estimatedCostPerHour: number;
  tags: Record<string, string>;
}

export interface InfraResource {
  id: string;
  requestId: string;
  tenantId: string;
  resourceType: ResourceType;
  region: string;
  instanceType: string;
  units: number;
  allocatedAt: number;
  reservedUntil?: number;
  currentCpuUtil: number;
  currentMemUtil: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  costPerHour: number;
  desiredState: Record<string, unknown>;
  actualState: Record<string, unknown>;
}

export interface ScalingDecision {
  resourceId: string;
  tenantId: string;
  direction: ScalingDirection;
  currentUnits: number;
  targetUnits: number;
  reason: string;
  triggerMetric: string;
  triggerValue: number;
  threshold: number;
  decidedAt: number;
}

export interface CapacityReservation {
  id: string;
  tenantId: string;
  resourceType: ResourceType;
  region: string;
  reservedUnits: number;
  costPerHour: number;
  startAt: number;
  endAt: number;
  active: boolean;
}

export interface DriftReport {
  resourceId: string;
  hasDrift: boolean;
  driftedFields: string[];
  desiredState: Record<string, unknown>;
  actualState: Record<string, unknown>;
  detectedAt: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceId: string;
  tenantId: string;
  actorId: string;
  before: unknown;
  after: unknown;
  timestamp: number;
  success: boolean;
  errorMessage?: string;
}

export interface InfraHealthReport {
  totalResources: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  avgCpuUtilization: number;
  avgMemUtilization: number;
  driftedResources: number;
  totalCostPerHour: number;
  generatedAt: number;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class AdaptiveInfrastructureProvisioner {
  private requests: Map<string, ProvisioningRequest> = new Map();
  private resources: Map<string, InfraResource> = new Map();
  private reservations: Map<string, CapacityReservation> = new Map();
  private scalingDecisions: ScalingDecision[] = [];
  private auditTrail: AuditEntry[] = [];
  private quotas: Map<string, Map<ResourceType, number>> = new Map(); // tenantId -> type -> max
  private readonly SCALE_OUT_CPU_THRESHOLD = 0.75;
  private readonly SCALE_IN_CPU_THRESHOLD = 0.25;
  private readonly SCALE_OUT_MEM_THRESHOLD = 0.80;

  // Cost table ($/hr) per instance type
  private readonly INSTANCE_COSTS: Record<string, number> = {
    't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416,
    'm5.large': 0.096, 'm5.xlarge': 0.192, 'm5.2xlarge': 0.384,
    'c5.large': 0.085, 'c5.xlarge': 0.17, 'c5.2xlarge': 0.34,
    'p3.2xlarge': 3.06, 'p3.8xlarge': 12.24,
  };

  constructor() {
    logger.info('[AdaptiveInfrastructureProvisioner] Initialized infrastructure provisioner');
  }

  /**
   * Submit a new provisioning request for review.
   */
  submitRequest(request: Omit<ProvisioningRequest, 'status' | 'requestedAt'>): ProvisioningRequest {
    const quota = this.quotas.get(request.tenantId)?.get(request.resourceType);
    const currentUsage = this.getTenantResourceUsage(request.tenantId, request.resourceType);
    if (quota !== undefined && currentUsage + request.requestedUnits > quota) {
      logger.warn(`[AdaptiveInfrastructureProvisioner] Quota exceeded for tenant ${request.tenantId}`);
      throw new Error(`Quota exceeded for ${request.resourceType}: ${currentUsage}/${quota}`);
    }

    const cost = this.INSTANCE_COSTS[request.instanceType] ?? 0.05;
    const full: ProvisioningRequest = {
      ...request,
      status: 'pending',
      requestedAt: Date.now(),
      estimatedCostPerHour: parseFloat((cost * request.requestedUnits).toFixed(4)),
    };

    this.requests.set(full.id, full);
    this.appendAudit('submit_request', full.id, full.tenantId, 'system', null, full, true);
    logger.info(`[AdaptiveInfrastructureProvisioner] Request ${full.id} submitted (${full.priority})`);
    return full;
  }

  /**
   * Approve a pending provisioning request.
   */
  approveRequest(requestId: string, actorId: string): ProvisioningRequest {
    const req = this.requests.get(requestId);
    if (!req) throw new Error(`Request not found: ${requestId}`);
    if (req.status !== 'pending') throw new Error(`Request ${requestId} is not pending`);

    const before = { ...req };
    req.status = 'approved';
    req.approvedAt = Date.now();
    this.appendAudit('approve_request', requestId, req.tenantId, actorId, before, req, true);
    logger.info(`[AdaptiveInfrastructureProvisioner] Request ${requestId} approved by ${actorId}`);
    return req;
  }

  /**
   * Execute an approved provisioning request and create the resource.
   */
  executeProvisioning(requestId: string): InfraResource {
    const req = this.requests.get(requestId);
    if (!req) throw new Error(`Request not found: ${requestId}`);
    if (req.status !== 'approved') throw new Error(`Request ${requestId} is not approved`);

    req.status = 'executing';
    const resourceId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const desiredState = {
      instanceType: req.instanceType,
      units: req.requestedUnits,
      region: req.region,
      tags: req.tags,
    };

    const resource: InfraResource = {
      id: resourceId,
      requestId,
      tenantId: req.tenantId,
      resourceType: req.resourceType,
      region: req.region,
      instanceType: req.instanceType,
      units: req.requestedUnits,
      allocatedAt: Date.now(),
      currentCpuUtil: 0.05 + Math.random() * 0.1, // simulated initial utilization
      currentMemUtil: 0.1 + Math.random() * 0.1,
      healthStatus: 'healthy',
      costPerHour: this.INSTANCE_COSTS[req.instanceType] ?? 0.05,
      desiredState,
      actualState: { ...desiredState },
    };

    this.resources.set(resourceId, resource);
    req.status = 'completed';
    req.completedAt = Date.now();

    this.appendAudit('execute_provisioning', resourceId, req.tenantId, 'system', null, resource, true);
    logger.info(`[AdaptiveInfrastructureProvisioner] Resource ${resourceId} provisioned for tenant ${req.tenantId}`);
    return resource;
  }

  /**
   * Detect configuration drift between desired and actual state of a resource.
   */
  detectDrift(resourceId: string): DriftReport {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error(`Resource not found: ${resourceId}`);

    const driftedFields: string[] = [];
    const desired = resource.desiredState;
    const actual = resource.actualState;

    for (const key of Object.keys(desired)) {
      if (JSON.stringify(desired[key]) !== JSON.stringify((actual as Record<string, unknown>)[key])) {
        driftedFields.push(key);
      }
    }

    const report: DriftReport = {
      resourceId,
      hasDrift: driftedFields.length > 0,
      driftedFields,
      desiredState: desired,
      actualState: actual,
      detectedAt: Date.now(),
    };

    if (report.hasDrift) {
      logger.warn(`[AdaptiveInfrastructureProvisioner] Drift detected on ${resourceId}: ${driftedFields.join(', ')}`);
    }
    return report;
  }

  /**
   * Make a scaling decision based on current resource utilization metrics.
   */
  makeScalingDecision(resourceId: string): ScalingDecision {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error(`Resource not found: ${resourceId}`);

    let direction: ScalingDirection = 'no_change';
    let targetUnits = resource.units;
    let reason = 'Utilization within normal range';
    let triggerMetric = 'cpu';
    let triggerValue = resource.currentCpuUtil;
    let threshold = this.SCALE_OUT_CPU_THRESHOLD;

    if (resource.currentCpuUtil >= this.SCALE_OUT_CPU_THRESHOLD ||
        resource.currentMemUtil >= this.SCALE_OUT_MEM_THRESHOLD) {
      direction = 'scale_out';
      targetUnits = Math.ceil(resource.units * 1.5);
      reason = resource.currentCpuUtil >= this.SCALE_OUT_CPU_THRESHOLD
        ? 'CPU utilization exceeds scale-out threshold'
        : 'Memory utilization exceeds scale-out threshold';
      triggerMetric = resource.currentCpuUtil >= this.SCALE_OUT_CPU_THRESHOLD ? 'cpu' : 'memory';
      triggerValue = triggerMetric === 'cpu' ? resource.currentCpuUtil : resource.currentMemUtil;
      threshold = triggerMetric === 'cpu' ? this.SCALE_OUT_CPU_THRESHOLD : this.SCALE_OUT_MEM_THRESHOLD;
    } else if (resource.currentCpuUtil <= this.SCALE_IN_CPU_THRESHOLD && resource.units > 1) {
      direction = 'scale_in';
      targetUnits = Math.max(1, Math.floor(resource.units * 0.7));
      reason = 'CPU utilization below scale-in threshold';
      triggerValue = resource.currentCpuUtil;
      threshold = this.SCALE_IN_CPU_THRESHOLD;
    }

    const decision: ScalingDecision = {
      resourceId,
      tenantId: resource.tenantId,
      direction,
      currentUnits: resource.units,
      targetUnits,
      reason,
      triggerMetric,
      triggerValue: parseFloat(triggerValue.toFixed(4)),
      threshold,
      decidedAt: Date.now(),
    };

    this.scalingDecisions.push(decision);
    if (direction !== 'no_change') {
      logger.info(`[AdaptiveInfrastructureProvisioner] Scaling decision: ${direction} ${resourceId} ${resource.units}->${targetUnits}`);
    }
    return decision;
  }

  /**
   * Reserve capacity for a tenant in a specific region.
   */
  reserveCapacity(
    tenantId: string,
    resourceType: ResourceType,
    region: string,
    units: number,
    durationHours: number,
  ): CapacityReservation {
    const costPerHour = 0.05 * units; // simplified flat rate
    const id = `rsv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const reservation: CapacityReservation = {
      id,
      tenantId,
      resourceType,
      region,
      reservedUnits: units,
      costPerHour,
      startAt: Date.now(),
      endAt: Date.now() + durationHours * 60 * 60 * 1000,
      active: true,
    };
    this.reservations.set(id, reservation);
    this.appendAudit('reserve_capacity', id, tenantId, 'system', null, reservation, true);
    logger.info(`[AdaptiveInfrastructureProvisioner] Reserved ${units} ${resourceType} units in ${region} for ${durationHours}h`);
    return reservation;
  }

  /**
   * Release an active resource and mark it as deallocated.
   */
  releaseResource(resourceId: string, actorId: string): void {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error(`Resource not found: ${resourceId}`);

    const before = { ...resource };
    this.resources.delete(resourceId);
    this.appendAudit('release_resource', resourceId, resource.tenantId, actorId, before, null, true);
    logger.info(`[AdaptiveInfrastructureProvisioner] Resource ${resourceId} released by ${actorId}`);
  }

  /**
   * Set resource quota for a tenant.
   */
  setQuota(tenantId: string, resourceType: ResourceType, maxUnits: number): void {
    if (!this.quotas.has(tenantId)) this.quotas.set(tenantId, new Map());
    this.quotas.get(tenantId)!.set(resourceType, maxUnits);
    logger.info(`[AdaptiveInfrastructureProvisioner] Quota set: ${tenantId} ${resourceType}=${maxUnits}`);
  }

  /**
   * Update utilization metrics for a resource (called periodically by monitoring).
   */
  updateUtilization(resourceId: string, cpuUtil: number, memUtil: number): void {
    const resource = this.resources.get(resourceId);
    if (!resource) return;
    resource.currentCpuUtil = Math.max(0, Math.min(1, cpuUtil));
    resource.currentMemUtil = Math.max(0, Math.min(1, memUtil));
    resource.healthStatus = cpuUtil > 0.95 || memUtil > 0.95
      ? 'degraded'
      : cpuUtil > 0.99 ? 'unhealthy' : 'healthy';
    logger.debug(`[AdaptiveInfrastructureProvisioner] Utilization updated for ${resourceId}: cpu=${cpuUtil}, mem=${memUtil}`);
  }

  private getTenantResourceUsage(tenantId: string, resourceType: ResourceType): number {
    let total = 0;
    for (const r of this.resources.values()) {
      if (r.tenantId === tenantId && r.resourceType === resourceType) total += r.units;
    }
    return total;
  }

  private appendAudit(
    action: string, resourceId: string, tenantId: string, actorId: string,
    before: unknown, after: unknown, success: boolean, errorMessage?: string,
  ): void {
    this.auditTrail.push({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action, resourceId, tenantId, actorId, before, after,
      timestamp: Date.now(), success, errorMessage,
    });
  }

  /**
   * Return a comprehensive health report for all provisioned resources.
   */
  getSummary(): InfraHealthReport {
    const all = Array.from(this.resources.values());
    const healthy = all.filter(r => r.healthStatus === 'healthy').length;
    const degraded = all.filter(r => r.healthStatus === 'degraded').length;
    const unhealthy = all.filter(r => r.healthStatus === 'unhealthy').length;
    const avgCpu = all.length > 0
      ? all.reduce((s, r) => s + r.currentCpuUtil, 0) / all.length : 0;
    const avgMem = all.length > 0
      ? all.reduce((s, r) => s + r.currentMemUtil, 0) / all.length : 0;
    const totalCost = all.reduce((s, r) => s + r.costPerHour * r.units, 0);
    const drifted = all.filter(r => this.detectDrift(r.id).hasDrift).length;

    const report: InfraHealthReport = {
      totalResources: all.length,
      healthyCount: healthy,
      degradedCount: degraded,
      unhealthyCount: unhealthy,
      avgCpuUtilization: parseFloat(avgCpu.toFixed(4)),
      avgMemUtilization: parseFloat(avgMem.toFixed(4)),
      driftedResources: drifted,
      totalCostPerHour: parseFloat(totalCost.toFixed(4)),
      generatedAt: Date.now(),
    };

    logger.info(`[AdaptiveInfrastructureProvisioner] Health: ${healthy}/${all.length} healthy, cost=$${report.totalCostPerHour}/hr`);
    return report;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__adaptiveInfrastructureProvisioner__';
export function getAdaptiveInfrastructureProvisioner(): AdaptiveInfrastructureProvisioner {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AdaptiveInfrastructureProvisioner();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AdaptiveInfrastructureProvisioner;
}
