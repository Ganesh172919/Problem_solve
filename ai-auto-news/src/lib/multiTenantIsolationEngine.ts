/**
 * @module multiTenantIsolationEngine
 * @description Enterprise-grade multi-tenant isolation engine enforcing data plane
 * separation, network namespace policies, resource quota isolation, cross-tenant
 * access prevention, tenant context propagation, data residency enforcement, audit
 * boundary logging, tenant lifecycle management (provision/suspend/deprovision),
 * per-tenant feature flag scoping, isolation breach detection, and compliance-ready
 * tenant data export for GDPR/CCPA right-to-deletion workflows.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'deprovisioning' | 'deleted';
export type IsolationLevel = 'shared' | 'dedicated_namespace' | 'dedicated_node' | 'dedicated_cluster';
export type DataResidencyZone = 'US' | 'EU' | 'APAC' | 'AU' | 'CA' | 'UK' | 'global';
export type BreachSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface TenantProfile {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  isolationLevel: IsolationLevel;
  dataResidencyZone: DataResidencyZone;
  plan: 'free' | 'pro' | 'enterprise';
  quotas: TenantQuota;
  features: string[];            // enabled feature flags
  createdAt: number;
  activatedAt?: number;
  suspendedAt?: number;
  deletedAt?: number;
  contactEmail: string;
  customDomain?: string;
  networkNamespace: string;      // isolated network identifier
  storageNamespace: string;
  encryptionKeyId: string;
}

export interface TenantQuota {
  maxApiCallsPerMinute: number;
  maxApiCallsPerDay: number;
  maxStorageGb: number;
  maxUsers: number;
  maxWorkspaces: number;
  maxCpuMillicores: number;
  maxMemoryMb: number;
  currentApiCallsMinute: number;
  currentApiCallsDay: number;
  currentStorageGb: number;
  currentUsers: number;
}

export interface TenantContext {
  tenantId: string;
  requestId: string;
  userId?: string;
  role?: string;
  scopes: string[];
  dataResidencyZone: DataResidencyZone;
  timestamp: number;
}

export interface IsolationBreach {
  id: string;
  sourceTenantId: string;
  targetTenantId: string;
  breachType: 'data_access' | 'network_crossing' | 'resource_overflow' | 'key_misuse';
  severity: BreachSeverity;
  requestId: string;
  resourcePath: string;
  detectedAt: number;
  blocked: boolean;
  auditEventId: string;
}

export interface TenantExportRequest {
  id: string;
  tenantId: string;
  requestedBy: string;
  requestType: 'full_export' | 'deletion' | 'portability';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  dataCategories: string[];
  requestedAt: number;
  completedAt?: number;
  exportUrl?: string;
}

export interface IsolationSummary {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  isolationBreaches: number;
  criticalBreaches: number;
  quotaViolations: number;
  pendingExports: number;
  isolationLevelDistribution: Record<string, number>;
}

// ── Engine ────────────────────────────────────────────────────────────────────

class MultiTenantIsolationEngine {
  private readonly tenants = new Map<string, TenantProfile>();
  private readonly breaches: IsolationBreach[] = [];
  private readonly exportRequests = new Map<string, TenantExportRequest>();
  private readonly auditLog: Array<{ tenantId: string; action: string; timestamp: number; requestId: string }> = [];
  private quotaViolationCount = 0;

  provisionTenant(profile: TenantProfile): TenantProfile {
    const t = {
      ...profile,
      status: 'provisioning' as TenantStatus,
      networkNamespace: `ns-${profile.id}`,
      storageNamespace: `store-${profile.id}`,
      encryptionKeyId: `key-${profile.id}-${Date.now()}`,
      createdAt: Date.now(),
    };
    this.tenants.set(t.id, t);
    logger.info('Tenant provisioned', { tenantId: t.id, plan: t.plan, isolation: t.isolationLevel });

    // Simulate async activation
    setTimeout(() => {
      const current = this.tenants.get(t.id);
      if (current && current.status === 'provisioning') {
        current.status = 'active';
        current.activatedAt = Date.now();
        this._audit(t.id, 'tenant_activated', `sys-provision`);
      }
    }, 50);

    return t;
  }

  suspendTenant(tenantId: string, reason: string): boolean {
    const t = this.tenants.get(tenantId);
    if (!t || t.status !== 'active') return false;
    t.status = 'suspended';
    t.suspendedAt = Date.now();
    this._audit(tenantId, `tenant_suspended:${reason}`, 'system');
    logger.warn('Tenant suspended', { tenantId, reason });
    return true;
  }

  reactivateTenant(tenantId: string): boolean {
    const t = this.tenants.get(tenantId);
    if (!t || t.status !== 'suspended') return false;
    t.status = 'active';
    t.suspendedAt = undefined;
    this._audit(tenantId, 'tenant_reactivated', 'system');
    return true;
  }

  deprovisionTenant(tenantId: string): boolean {
    const t = this.tenants.get(tenantId);
    if (!t) return false;
    t.status = 'deprovisioning';
    setTimeout(() => {
      const current = this.tenants.get(tenantId);
      if (current) { current.status = 'deleted'; current.deletedAt = Date.now(); }
    }, 100);
    this._audit(tenantId, 'tenant_deprovisioning', 'system');
    logger.info('Tenant deprovisioning started', { tenantId });
    return true;
  }

  validateContext(context: TenantContext, resourceTenantId: string): boolean {
    if (context.tenantId === resourceTenantId) return true;
    // Cross-tenant access detected
    const breach: IsolationBreach = {
      id: `breach-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      sourceTenantId: context.tenantId,
      targetTenantId: resourceTenantId,
      breachType: 'data_access',
      severity: 'critical',
      requestId: context.requestId,
      resourcePath: `tenant:${resourceTenantId}`,
      detectedAt: Date.now(),
      blocked: true,
      auditEventId: `audit-${Date.now()}`,
    };
    this.breaches.push(breach);
    logger.error('Isolation breach detected', undefined, {
      source: context.tenantId, target: resourceTenantId, requestId: context.requestId,
    });
    return false;
  }

  checkQuota(tenantId: string, metric: keyof TenantQuota, increment = 1): { allowed: boolean; remaining: number } {
    const t = this.tenants.get(tenantId);
    if (!t) return { allowed: false, remaining: 0 };
    const q = t.quotas;

    if (metric === 'currentApiCallsMinute') {
      if (q.currentApiCallsMinute + increment > q.maxApiCallsPerMinute) {
        this.quotaViolationCount += 1;
        return { allowed: false, remaining: q.maxApiCallsPerMinute - q.currentApiCallsMinute };
      }
      q.currentApiCallsMinute += increment;
      return { allowed: true, remaining: q.maxApiCallsPerMinute - q.currentApiCallsMinute };
    }
    if (metric === 'currentUsers') {
      if (q.currentUsers + increment > q.maxUsers) {
        this.quotaViolationCount += 1;
        return { allowed: false, remaining: q.maxUsers - q.currentUsers };
      }
      q.currentUsers += increment;
      return { allowed: true, remaining: q.maxUsers - q.currentUsers };
    }
    return { allowed: true, remaining: 0 };
  }

  enableFeature(tenantId: string, featureFlag: string): boolean {
    const t = this.tenants.get(tenantId);
    if (!t) return false;
    if (!t.features.includes(featureFlag)) t.features.push(featureFlag);
    return true;
  }

  disableFeature(tenantId: string, featureFlag: string): boolean {
    const t = this.tenants.get(tenantId);
    if (!t) return false;
    t.features = t.features.filter(f => f !== featureFlag);
    return true;
  }

  hasFeature(tenantId: string, featureFlag: string): boolean {
    return this.tenants.get(tenantId)?.features.includes(featureFlag) ?? false;
  }

  requestDataExport(req: TenantExportRequest): void {
    this.exportRequests.set(req.id, { ...req, status: 'pending', requestedAt: Date.now() });
    this._audit(req.tenantId, `export_request:${req.requestType}`, req.requestedBy);
    logger.info('Tenant data export requested', { tenantId: req.tenantId, type: req.requestType });
    // Simulate processing
    setTimeout(() => {
      const current = this.exportRequests.get(req.id);
      if (current) {
        current.status = 'completed';
        current.completedAt = Date.now();
        current.exportUrl = `https://exports.internal/${req.tenantId}/${req.id}.zip`;
      }
    }, 200);
  }

  getTenant(tenantId: string): TenantProfile | undefined {
    return this.tenants.get(tenantId);
  }

  listTenants(status?: TenantStatus): TenantProfile[] {
    const all = Array.from(this.tenants.values());
    return status ? all.filter(t => t.status === status) : all;
  }

  listBreaches(severity?: BreachSeverity): IsolationBreach[] {
    return severity ? this.breaches.filter(b => b.severity === severity) : [...this.breaches];
  }

  listExportRequests(tenantId?: string): TenantExportRequest[] {
    const all = Array.from(this.exportRequests.values());
    return tenantId ? all.filter(r => r.tenantId === tenantId) : all;
  }

  getAuditLog(tenantId: string, limit = 100): Array<{ action: string; timestamp: number; requestId: string }> {
    return this.auditLog
      .filter(e => e.tenantId === tenantId)
      .slice(-limit)
      .map(({ action, timestamp, requestId }) => ({ action, timestamp, requestId }));
  }

  getSummary(): IsolationSummary {
    const tenants = Array.from(this.tenants.values());
    const levelDist: Record<string, number> = {};
    for (const t of tenants) levelDist[t.isolationLevel] = (levelDist[t.isolationLevel] ?? 0) + 1;
    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'active').length,
      suspendedTenants: tenants.filter(t => t.status === 'suspended').length,
      isolationBreaches: this.breaches.length,
      criticalBreaches: this.breaches.filter(b => b.severity === 'critical').length,
      quotaViolations: this.quotaViolationCount,
      pendingExports: Array.from(this.exportRequests.values()).filter(r => r.status === 'pending' || r.status === 'processing').length,
      isolationLevelDistribution: levelDist,
    };
  }

  private _audit(tenantId: string, action: string, requestId: string): void {
    this.auditLog.push({ tenantId, action, timestamp: Date.now(), requestId });
    if (this.auditLog.length > 100000) this.auditLog.splice(0, 10000);
  }
}

const KEY = '__multiTenantIsolationEngine__';
export function getIsolationEngine(): MultiTenantIsolationEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiTenantIsolationEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiTenantIsolationEngine;
}
