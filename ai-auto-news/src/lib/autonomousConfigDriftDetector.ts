/**
 * @module autonomousConfigDriftDetector
 * @description Autonomous configuration drift detection engine implementing
 * baseline snapshotting, diff computation, semantic severity classification,
 * auto-remediation with rollback, drift history tracking, compliance policy
 * enforcement, environment comparison, change velocity monitoring, and
 * continuous compliance scoring for multi-tenant enterprise systems.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type DriftSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type DriftCategory = 'security' | 'performance' | 'reliability' | 'compliance' | 'operational';
export type RemediationStatus = 'pending' | 'in_progress' | 'applied' | 'rolled_back' | 'failed' | 'skipped';
export type ConfigFormat = 'json' | 'yaml' | 'env' | 'toml' | 'properties';

export interface ConfigBaseline {
  id: string;
  name: string;
  tenantId: string;
  serviceId: string;
  environment: string;
  format: ConfigFormat;
  config: Record<string, unknown>;
  checksum: string;
  capturedAt: number;
  capturedBy: string;
  isActive: boolean;
  tags: string[];
}

export interface ConfigSnapshot {
  id: string;
  baselineId: string;
  tenantId: string;
  serviceId: string;
  environment: string;
  config: Record<string, unknown>;
  checksum: string;
  capturedAt: number;
  driftDetected: boolean;
  driftCount: number;
}

export interface DriftItem {
  path: string;
  category: DriftCategory;
  severity: DriftSeverity;
  baselineValue: unknown;
  currentValue: unknown;
  changeType: 'added' | 'removed' | 'modified';
  description: string;
  remediable: boolean;
  remediationAction?: string;
}

export interface DriftReport {
  id: string;
  baselineId: string;
  snapshotId: string;
  tenantId: string;
  serviceId: string;
  environment: string;
  driftItems: DriftItem[];
  totalDrifts: number;
  criticalDrifts: number;
  highDrifts: number;
  complianceScore: number;   // 0-100
  remediable: boolean;
  detectedAt: number;
}

export interface RemediationAction {
  id: string;
  reportId: string;
  tenantId: string;
  serviceId: string;
  driftPaths: string[];
  status: RemediationStatus;
  appliedConfig?: Record<string, unknown>;
  rollbackConfig?: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  approvedBy?: string;
}

export interface CompliancePolicy {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  rules: CompliancePolicyRule[];
  framework: string;
  enabled: boolean;
  createdAt: number;
}

export interface CompliancePolicyRule {
  id: string;
  path: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'regex';
  expectedValue?: unknown;
  severity: DriftSeverity;
  description: string;
}

export interface ChangeVelocityMetrics {
  tenantId: string;
  serviceId: string;
  environment: string;
  changesLast24h: number;
  changesLast7d: number;
  avgDriftPerSnapshot: number;
  driftTrend: 'increasing' | 'stable' | 'decreasing';
  riskLevel: 'high' | 'medium' | 'low';
}

export interface DetectorSummary {
  totalBaselines: number;
  activeBaselines: number;
  totalSnapshots: number;
  totalReports: number;
  driftedServices: number;
  avgComplianceScore: number;
  criticalDriftsOpen: number;
  pendingRemediations: number;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class AutonomousConfigDriftDetector {
  private readonly baselines = new Map<string, ConfigBaseline>();
  private readonly snapshots = new Map<string, ConfigSnapshot>();
  private readonly reports = new Map<string, DriftReport>();
  private readonly remediations = new Map<string, RemediationAction>();
  private readonly policies = new Map<string, CompliancePolicy>();
  private globalCounter = 0;

  // Baseline management ────────────────────────────────────────────────────────

  captureBaseline(params: {
    name: string;
    tenantId: string;
    serviceId: string;
    environment: string;
    format: ConfigFormat;
    config: Record<string, unknown>;
    capturedBy: string;
    tags?: string[];
  }): ConfigBaseline {
    // Deactivate previous baseline for same service+env
    for (const b of this.baselines.values()) {
      if (b.tenantId === params.tenantId && b.serviceId === params.serviceId && b.environment === params.environment) {
        b.isActive = false;
      }
    }
    const id = `baseline_${Date.now()}_${++this.globalCounter}`;
    const baseline: ConfigBaseline = {
      ...params,
      id,
      checksum: this.checksum(params.config),
      capturedAt: Date.now(),
      isActive: true,
      tags: params.tags ?? [],
    };
    this.baselines.set(id, baseline);
    logger.info('Config baseline captured', { id, serviceId: params.serviceId, environment: params.environment });
    return baseline;
  }

  getBaseline(id: string): ConfigBaseline | undefined {
    return this.baselines.get(id);
  }

  getActiveBaseline(tenantId: string, serviceId: string, environment: string): ConfigBaseline | undefined {
    return Array.from(this.baselines.values()).find(
      b => b.tenantId === tenantId && b.serviceId === serviceId && b.environment === environment && b.isActive
    );
  }

  listBaselines(tenantId?: string): ConfigBaseline[] {
    const all = Array.from(this.baselines.values());
    return tenantId ? all.filter(b => b.tenantId === tenantId) : all;
  }

  // Snapshot & drift detection ─────────────────────────────────────────────────

  detectDrift(params: {
    tenantId: string;
    serviceId: string;
    environment: string;
    currentConfig: Record<string, unknown>;
  }): DriftReport {
    const baseline = this.getActiveBaseline(params.tenantId, params.serviceId, params.environment);
    if (!baseline) throw new Error(`No active baseline for ${params.serviceId}/${params.environment}`);

    const snapshotId = `snap_${Date.now()}_${++this.globalCounter}`;
    const currentChecksum = this.checksum(params.currentConfig);
    const driftItems = this.computeDiff(baseline.config, params.currentConfig);

    // Apply compliance policy rules
    const policyDrifts = this.runCompliancePolicies(params.tenantId, params.currentConfig);
    for (const pd of policyDrifts) {
      if (!driftItems.find(d => d.path === pd.path)) {
        driftItems.push(pd);
      }
    }

    const snapshot: ConfigSnapshot = {
      id: snapshotId,
      baselineId: baseline.id,
      tenantId: params.tenantId,
      serviceId: params.serviceId,
      environment: params.environment,
      config: params.currentConfig,
      checksum: currentChecksum,
      capturedAt: Date.now(),
      driftDetected: driftItems.length > 0,
      driftCount: driftItems.length,
    };
    this.snapshots.set(snapshotId, snapshot);

    const criticalDrifts = driftItems.filter(d => d.severity === 'critical').length;
    const highDrifts = driftItems.filter(d => d.severity === 'high').length;
    const complianceScore = this.computeComplianceScore(driftItems);

    const reportId = `rpt_${Date.now()}_${++this.globalCounter}`;
    const report: DriftReport = {
      id: reportId,
      baselineId: baseline.id,
      snapshotId,
      tenantId: params.tenantId,
      serviceId: params.serviceId,
      environment: params.environment,
      driftItems,
      totalDrifts: driftItems.length,
      criticalDrifts,
      highDrifts,
      complianceScore,
      remediable: driftItems.some(d => d.remediable),
      detectedAt: Date.now(),
    };
    this.reports.set(reportId, report);

    if (driftItems.length > 0) {
      logger.warn('Config drift detected', {
        serviceId: params.serviceId, environment: params.environment,
        totalDrifts: driftItems.length, criticalDrifts,
      });
    }
    return report;
  }

  private computeDiff(baseline: Record<string, unknown>, current: Record<string, unknown>): DriftItem[] {
    const items: DriftItem[] = [];
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);

    for (const key of allKeys) {
      const bVal = baseline[key];
      const cVal = current[key];
      if (!(key in baseline)) {
        items.push(this.buildDriftItem(key, undefined, cVal, 'added'));
      } else if (!(key in current)) {
        items.push(this.buildDriftItem(key, bVal, undefined, 'removed'));
      } else if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
        items.push(this.buildDriftItem(key, bVal, cVal, 'modified'));
      }
    }
    return items;
  }

  private buildDriftItem(
    path: string, baseline: unknown, current: unknown,
    changeType: DriftItem['changeType']
  ): DriftItem {
    const { category, severity, description, remediable, action } = this.classifyDrift(path, baseline, current, changeType);
    return { path, category, severity, baselineValue: baseline, currentValue: current, changeType, description, remediable, remediationAction: action };
  }

  private classifyDrift(
    path: string, _baseline: unknown, _current: unknown, changeType: DriftItem['changeType']
  ): { category: DriftCategory; severity: DriftSeverity; description: string; remediable: boolean; action?: string } {
    const p = path.toLowerCase();
    if (p.includes('password') || p.includes('secret') || p.includes('key') || p.includes('token')) {
      return { category: 'security', severity: 'critical', description: `Security credential ${changeType} at ${path}`, remediable: false };
    }
    if (p.includes('ssl') || p.includes('tls') || p.includes('cert')) {
      return { category: 'security', severity: 'high', description: `TLS/SSL config ${changeType} at ${path}`, remediable: true, action: `restore_from_baseline` };
    }
    if (p.includes('replica') || p.includes('timeout') || p.includes('pool')) {
      return { category: 'performance', severity: 'medium', description: `Performance config ${changeType} at ${path}`, remediable: true, action: `restore_from_baseline` };
    }
    if (p.includes('log') || p.includes('debug') || p.includes('trace')) {
      return { category: 'operational', severity: 'low', description: `Operational config ${changeType} at ${path}`, remediable: true, action: `restore_from_baseline` };
    }
    return { category: 'operational', severity: 'info', description: `Config ${changeType} at ${path}`, remediable: true, action: `restore_from_baseline` };
  }

  private runCompliancePolicies(tenantId: string, config: Record<string, unknown>): DriftItem[] {
    const items: DriftItem[] = [];
    for (const policy of this.policies.values()) {
      if (policy.tenantId !== tenantId || !policy.enabled) continue;
      for (const rule of policy.rules) {
        const violation = this.evaluateRule(rule, config);
        if (violation) {
          items.push({
            path: rule.path,
            category: 'compliance',
            severity: rule.severity,
            baselineValue: rule.expectedValue,
            currentValue: this.getNestedValue(config, rule.path),
            changeType: 'modified',
            description: `Policy violation: ${rule.description} (${policy.framework})`,
            remediable: true,
            remediationAction: `enforce_policy_${rule.id}`,
          });
        }
      }
    }
    return items;
  }

  private evaluateRule(rule: CompliancePolicyRule, config: Record<string, unknown>): boolean {
    const val = this.getNestedValue(config, rule.path);
    switch (rule.operator) {
      case 'exists': return val === undefined;
      case 'not_exists': return val !== undefined;
      case 'equals': return JSON.stringify(val) !== JSON.stringify(rule.expectedValue);
      case 'not_equals': return JSON.stringify(val) === JSON.stringify(rule.expectedValue);
      case 'contains': return typeof val === 'string' && !val.includes(String(rule.expectedValue));
      case 'not_contains': return typeof val === 'string' && val.includes(String(rule.expectedValue));
      default: return false;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((acc, k) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
      return undefined;
    }, obj as unknown);
  }

  private computeComplianceScore(items: DriftItem[]): number {
    if (items.length === 0) return 100;
    const weights: Record<DriftSeverity, number> = { critical: 30, high: 15, medium: 8, low: 3, info: 1 };
    const totalPenalty = items.reduce((s, d) => s + (weights[d.severity] ?? 0), 0);
    return Math.max(0, 100 - totalPenalty);
  }

  // Remediation ────────────────────────────────────────────────────────────────

  createRemediation(reportId: string, approvedBy?: string): RemediationAction {
    const report = this.reports.get(reportId);
    if (!report) throw new Error(`Report ${reportId} not found`);
    const baseline = this.baselines.get(report.baselineId);
    if (!baseline) throw new Error(`Baseline ${report.baselineId} not found`);

    const snapshot = this.snapshots.get(report.snapshotId);
    const action: RemediationAction = {
      id: `rem_${Date.now()}_${++this.globalCounter}`,
      reportId,
      tenantId: report.tenantId,
      serviceId: report.serviceId,
      driftPaths: report.driftItems.filter(d => d.remediable).map(d => d.path),
      status: 'pending',
      rollbackConfig: snapshot?.config,
      appliedConfig: baseline.config,
      approvedBy,
    };
    this.remediations.set(action.id, action);
    logger.info('Remediation action created', { id: action.id, reportId, paths: action.driftPaths.length });
    return action;
  }

  applyRemediation(id: string): RemediationAction {
    const action = this.remediations.get(id);
    if (!action) throw new Error(`Remediation ${id} not found`);
    action.status = 'in_progress';
    action.startedAt = Date.now();
    // Simulate application
    action.status = 'applied';
    action.completedAt = Date.now();
    logger.info('Remediation applied', { id, serviceId: action.serviceId });
    return action;
  }

  rollbackRemediation(id: string): RemediationAction {
    const action = this.remediations.get(id);
    if (!action) throw new Error(`Remediation ${id} not found`);
    if (action.status !== 'applied') throw new Error(`Can only rollback applied remediations`);
    action.status = 'rolled_back';
    action.completedAt = Date.now();
    logger.info('Remediation rolled back', { id });
    return action;
  }

  listRemediations(tenantId?: string, status?: RemediationStatus): RemediationAction[] {
    let all = Array.from(this.remediations.values());
    if (tenantId) all = all.filter(r => r.tenantId === tenantId);
    if (status) all = all.filter(r => r.status === status);
    return all;
  }

  // Compliance policies ────────────────────────────────────────────────────────

  createCompliancePolicy(params: Omit<CompliancePolicy, 'id' | 'createdAt'>): CompliancePolicy {
    const policy: CompliancePolicy = { ...params, id: `pol_${Date.now()}_${++this.globalCounter}`, createdAt: Date.now() };
    this.policies.set(policy.id, policy);
    return policy;
  }

  listPolicies(tenantId?: string): CompliancePolicy[] {
    const all = Array.from(this.policies.values());
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  // Change velocity ────────────────────────────────────────────────────────────

  getChangeVelocity(tenantId: string, serviceId: string, environment: string): ChangeVelocityMetrics {
    const now = Date.now();
    const oneDayAgo = now - 86_400_000;
    const sevenDaysAgo = now - 7 * 86_400_000;

    const snaps = Array.from(this.snapshots.values()).filter(
      s => s.tenantId === tenantId && s.serviceId === serviceId && s.environment === environment && s.driftDetected
    );
    const last24h = snaps.filter(s => s.capturedAt >= oneDayAgo).length;
    const last7d = snaps.filter(s => s.capturedAt >= sevenDaysAgo).length;

    const avgDrift = snaps.length > 0 ? snaps.reduce((s, sn) => s + sn.driftCount, 0) / snaps.length : 0;

    // Simple trend: compare last 3 days to prior 4 days
    const threeDaysAgo = now - 3 * 86_400_000;
    const recentSnaps = snaps.filter(s => s.capturedAt >= threeDaysAgo).length;
    const olderSnaps = snaps.filter(s => s.capturedAt >= sevenDaysAgo && s.capturedAt < threeDaysAgo).length;
    const trend: ChangeVelocityMetrics['driftTrend'] = recentSnaps > olderSnaps + 2 ? 'increasing' : recentSnaps < olderSnaps - 2 ? 'decreasing' : 'stable';
    const riskLevel: ChangeVelocityMetrics['riskLevel'] = last24h > 10 ? 'high' : last24h > 3 ? 'medium' : 'low';

    return { tenantId, serviceId, environment, changesLast24h: last24h, changesLast7d: last7d, avgDriftPerSnapshot: avgDrift, driftTrend: trend, riskLevel };
  }

  // Queries ────────────────────────────────────────────────────────────────────

  getReport(id: string): DriftReport | undefined {
    return this.reports.get(id);
  }

  listReports(tenantId?: string, serviceId?: string): DriftReport[] {
    let all = Array.from(this.reports.values());
    if (tenantId) all = all.filter(r => r.tenantId === tenantId);
    if (serviceId) all = all.filter(r => r.serviceId === serviceId);
    return all.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  listSnapshots(tenantId?: string, serviceId?: string): ConfigSnapshot[] {
    let all = Array.from(this.snapshots.values());
    if (tenantId) all = all.filter(s => s.tenantId === tenantId);
    if (serviceId) all = all.filter(s => s.serviceId === serviceId);
    return all.sort((a, b) => b.capturedAt - a.capturedAt);
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): DetectorSummary {
    const allReports = Array.from(this.reports.values());
    const driftedServices = new Set(allReports.filter(r => r.totalDrifts > 0).map(r => r.serviceId));
    const avgCompliance = allReports.length > 0
      ? allReports.reduce((s, r) => s + r.complianceScore, 0) / allReports.length
      : 100;
    const criticalOpen = allReports.reduce((s, r) => s + r.criticalDrifts, 0);
    return {
      totalBaselines: this.baselines.size,
      activeBaselines: Array.from(this.baselines.values()).filter(b => b.isActive).length,
      totalSnapshots: this.snapshots.size,
      totalReports: this.reports.size,
      driftedServices: driftedServices.size,
      avgComplianceScore: avgCompliance,
      criticalDriftsOpen: criticalOpen,
      pendingRemediations: Array.from(this.remediations.values()).filter(r => r.status === 'pending').length,
    };
  }

  // Utilities ──────────────────────────────────────────────────────────────────

  private checksum(obj: Record<string, unknown>): string {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__autonomousConfigDriftDetector__';
export function getConfigDriftDetector(): AutonomousConfigDriftDetector {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AutonomousConfigDriftDetector();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AutonomousConfigDriftDetector;
}
