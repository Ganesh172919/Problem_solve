/**
 * @module autonomousComplianceReporter
 * @description Automated compliance reporting engine with regulatory framework registry
 * (GDPR, SOC2, HIPAA, PCI-DSS), control evidence collection, gap analysis, remediation
 * task tracking, audit trail export, periodic report generation, compliance score
 * computation, control mapping, risk register management, and automated attestation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type ControlStatus = 'implemented' | 'partial' | 'not_implemented' | 'not_applicable';
export type RemediationStatus = 'open' | 'in_progress' | 'resolved' | 'risk_accepted';

export interface RegulatoryFramework {
  id: string;
  name: string;
  version: string;
  controlCount: number;
  description: string;
  registeredAt: number;
}

export interface ComplianceControl {
  id: string;
  frameworkId: string;
  name: string;
  description: string;
  category: string;
  status: ControlStatus;
  ownerId: string;
  evidenceIds: string[];
  lastAssessedAt?: number;
  nextReviewAt?: number;
}

export interface EvidenceRecord {
  id: string;
  controlId: string;
  frameworkId: string;
  title: string;
  type: 'screenshot' | 'log' | 'policy_doc' | 'audit_report' | 'config_snapshot';
  collectedAt: number;
  expiresAt?: number;
  collectedBy: string;
  storageRef: string;
}

export interface ComplianceGap {
  id: string;
  frameworkId: string;
  controlId: string;
  gapDescription: string;
  riskLevel: RiskLevel;
  identifiedAt: number;
  remediationId?: string;
}

export interface RemediationTask {
  id: string;
  gapId: string;
  controlId: string;
  frameworkId: string;
  title: string;
  description: string;
  status: RemediationStatus;
  assignedTo: string;
  priority: RiskLevel;
  dueAt: number;
  createdAt: number;
  resolvedAt?: number;
}

export interface ComplianceReport {
  id: string;
  frameworkId: string;
  tenantId: string;
  score: number;
  totalControls: number;
  implementedControls: number;
  partialControls: number;
  openGaps: number;
  criticalGaps: number;
  openRemediations: number;
  generatedAt: number;
  attestedBy?: string;
  attestedAt?: number;
}

export interface RiskRegisterEntry {
  id: string;
  frameworkId: string;
  title: string;
  riskLevel: RiskLevel;
  likelihood: number; // 1-5
  impact: number; // 1-5
  riskScore: number; // likelihood * impact
  mitigationStatus: RemediationStatus;
  owner: string;
  identifiedAt: number;
  reviewedAt?: number;
}

export interface AuditTrailRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  tenantId: string;
  before?: unknown;
  after?: unknown;
  timestamp: number;
}

export interface ComplianceReporterSummary {
  totalFrameworks: number;
  totalControls: number;
  overallComplianceScore: number;
  openGaps: number;
  criticalGaps: number;
  openRemediations: number;
  riskRegisterEntries: number;
  auditTrailSize: number;
  frameworkScores: Record<string, number>;
}

// ── Risk scoring ──────────────────────────────────────────────────────────────

const RISK_LEVEL_WEIGHTS: Record<RiskLevel, number> = {
  critical: 5, high: 4, medium: 3, low: 2, informational: 1,
};

// ── Engine class ──────────────────────────────────────────────────────────────

export class AutonomousComplianceReporter {
  private frameworks: Map<string, RegulatoryFramework> = new Map();
  private controls: Map<string, ComplianceControl> = new Map(); // controlId -> control
  private evidence: Map<string, EvidenceRecord> = new Map();
  private gaps: Map<string, ComplianceGap> = new Map();
  private remediations: Map<string, RemediationTask> = new Map();
  private reports: ComplianceReport[] = [];
  private riskRegister: Map<string, RiskRegisterEntry> = new Map();
  private auditTrail: AuditTrailRecord[] = [];

  constructor() {
    logger.info('[AutonomousComplianceReporter] Initialized compliance reporting engine');
    this.seedBuiltinFrameworks();
  }

  /**
   * Register a regulatory framework (GDPR, SOC2, HIPAA, PCI-DSS, etc.)
   */
  registerFramework(framework: RegulatoryFramework): void {
    this.frameworks.set(framework.id, { ...framework, registeredAt: framework.registeredAt || Date.now() });
    this.appendAudit('register_framework', 'framework', framework.id, 'system', 'system', null, framework);
    logger.info(`[AutonomousComplianceReporter] Framework '${framework.name}' v${framework.version} registered`);
  }

  /**
   * Register a compliance control and link it to a framework.
   */
  registerControl(control: ComplianceControl): void {
    if (!this.frameworks.has(control.frameworkId)) {
      logger.warn(`[AutonomousComplianceReporter] Unknown framework ${control.frameworkId} for control ${control.id}`);
    }
    this.controls.set(control.id, control);
    this.appendAudit('register_control', 'control', control.id, 'system', 'system', null, control);
    logger.info(`[AutonomousComplianceReporter] Control '${control.name}' registered in ${control.frameworkId}`);
  }

  /**
   * Collect evidence for a compliance control.
   */
  collectEvidence(evidence: EvidenceRecord): void {
    this.evidence.set(evidence.id, { ...evidence, collectedAt: evidence.collectedAt || Date.now() });
    const control = this.controls.get(evidence.controlId);
    if (control && !control.evidenceIds.includes(evidence.id)) {
      control.evidenceIds.push(evidence.id);
      control.lastAssessedAt = Date.now();
    }
    this.appendAudit('collect_evidence', 'evidence', evidence.id, evidence.collectedBy, 'system', null, evidence);
    logger.info(`[AutonomousComplianceReporter] Evidence '${evidence.id}' collected for control ${evidence.controlId}`);
  }

  /**
   * Analyze gaps between desired and actual control implementation.
   */
  analyzeGaps(frameworkId: string): ComplianceGap[] {
    const frameworkControls = Array.from(this.controls.values()).filter(c => c.frameworkId === frameworkId);
    const newGaps: ComplianceGap[] = [];

    for (const control of frameworkControls) {
      if (control.status === 'not_applicable') continue;

      if (control.status === 'not_implemented' || control.status === 'partial') {
        const hasEvidence = control.evidenceIds.length > 0;
        const riskLevel: RiskLevel = control.status === 'not_implemented'
          ? (hasEvidence ? 'high' : 'critical')
          : 'medium';

        // Check if gap already exists
        const existingGap = Array.from(this.gaps.values()).find(
          g => g.controlId === control.id && g.frameworkId === frameworkId,
        );
        if (existingGap) continue;

        const gap: ComplianceGap = {
          id: `gap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          frameworkId,
          controlId: control.id,
          gapDescription: `Control '${control.name}' is ${control.status}`,
          riskLevel,
          identifiedAt: Date.now(),
        };
        this.gaps.set(gap.id, gap);
        newGaps.push(gap);
      }
    }

    logger.info(`[AutonomousComplianceReporter] Gap analysis for ${frameworkId}: ${newGaps.length} new gaps`);
    return newGaps;
  }

  /**
   * Create a remediation task for a compliance gap.
   */
  createRemediationTask(task: Omit<RemediationTask, 'createdAt' | 'status'>): RemediationTask {
    const full: RemediationTask = {
      ...task,
      status: 'open',
      createdAt: Date.now(),
    };
    this.remediations.set(full.id, full);

    // Link gap to remediation
    const gap = this.gaps.get(full.gapId);
    if (gap) gap.remediationId = full.id;

    this.appendAudit('create_remediation', 'remediation', full.id, full.assignedTo, 'system', null, full);
    logger.info(`[AutonomousComplianceReporter] Remediation task '${full.title}' created`);
    return full;
  }

  /**
   * Update the status of a remediation task.
   */
  updateRemediationStatus(taskId: string, status: RemediationStatus, actorId: string): void {
    const task = this.remediations.get(taskId);
    if (!task) { logger.warn(`[AutonomousComplianceReporter] Remediation task ${taskId} not found`); return; }
    const before = { ...task };
    task.status = status;
    if (status === 'resolved') task.resolvedAt = Date.now();

    // Update linked control
    if (status === 'resolved') {
      const ctrl = this.controls.get(task.controlId);
      if (ctrl) ctrl.status = 'implemented';
    }

    this.appendAudit('update_remediation', 'remediation', taskId, actorId, 'system', before, task);
    logger.info(`[AutonomousComplianceReporter] Remediation ${taskId} status -> ${status}`);
  }

  /**
   * Generate a compliance report for a framework and tenant.
   */
  generateReport(frameworkId: string, tenantId: string, attestedBy?: string): ComplianceReport {
    const frameworkControls = Array.from(this.controls.values()).filter(c => c.frameworkId === frameworkId);
    const applicable = frameworkControls.filter(c => c.status !== 'not_applicable');
    const implemented = applicable.filter(c => c.status === 'implemented').length;
    const partial = applicable.filter(c => c.status === 'partial').length;

    const openGaps = Array.from(this.gaps.values()).filter(
      g => g.frameworkId === frameworkId && !g.remediationId,
    );
    const criticalGaps = openGaps.filter(g => g.riskLevel === 'critical').length;
    const openRemediations = Array.from(this.remediations.values()).filter(
      r => r.frameworkId === frameworkId && r.status === 'open',
    ).length;

    const score = this.computeComplianceScore(frameworkId);

    const report: ComplianceReport = {
      id: `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      frameworkId,
      tenantId,
      score,
      totalControls: applicable.length,
      implementedControls: implemented,
      partialControls: partial,
      openGaps: openGaps.length,
      criticalGaps,
      openRemediations,
      generatedAt: Date.now(),
      attestedBy,
      attestedAt: attestedBy ? Date.now() : undefined,
    };

    this.reports.push(report);
    this.appendAudit('generate_report', 'report', report.id, attestedBy ?? 'system', tenantId, null, report);
    logger.info(`[AutonomousComplianceReporter] Report ${report.id} for ${frameworkId}: score=${score}`);
    return report;
  }

  /**
   * Compute a 0-100 compliance score for a framework based on control status and gaps.
   */
  computeComplianceScore(frameworkId: string): number {
    const applicable = Array.from(this.controls.values())
      .filter(c => c.frameworkId === frameworkId && c.status !== 'not_applicable');

    if (applicable.length === 0) return 100;

    const implemented = applicable.filter(c => c.status === 'implemented').length;
    const partial = applicable.filter(c => c.status === 'partial').length;
    const baseScore = (implemented + partial * 0.5) / applicable.length * 100;

    // Penalize for critical gaps
    const criticalGaps = Array.from(this.gaps.values()).filter(
      g => g.frameworkId === frameworkId && g.riskLevel === 'critical',
    ).length;
    const penalty = Math.min(40, criticalGaps * 8);

    return parseFloat(Math.max(0, baseScore - penalty).toFixed(1));
  }

  /**
   * Export the full audit trail as an array, optionally filtered by entity type.
   */
  exportAuditTrail(entityType?: string): AuditTrailRecord[] {
    const records = entityType
      ? this.auditTrail.filter(r => r.entityType === entityType)
      : [...this.auditTrail];
    logger.info(`[AutonomousComplianceReporter] Audit trail export: ${records.length} records`);
    return records;
  }

  /**
   * Add an entry to the risk register.
   */
  addRiskEntry(entry: Omit<RiskRegisterEntry, 'riskScore'>): RiskRegisterEntry {
    const full: RiskRegisterEntry = {
      ...entry,
      riskScore: entry.likelihood * entry.impact,
    };
    this.riskRegister.set(full.id, full);
    logger.info(`[AutonomousComplianceReporter] Risk '${full.title}' added (score=${full.riskScore})`);
    return full;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private appendAudit(
    action: string, entityType: string, entityId: string,
    actorId: string, tenantId: string, before: unknown, after: unknown,
  ): void {
    this.auditTrail.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action, entityType, entityId, actorId, tenantId, before, after,
      timestamp: Date.now(),
    });
  }

  private seedBuiltinFrameworks(): void {
    const builtin: RegulatoryFramework[] = [
      { id: 'gdpr', name: 'GDPR', version: '2018', controlCount: 99, description: 'EU General Data Protection Regulation', registeredAt: Date.now() },
      { id: 'soc2', name: 'SOC 2', version: 'Type II', controlCount: 64, description: 'AICPA Service Organization Controls', registeredAt: Date.now() },
      { id: 'hipaa', name: 'HIPAA', version: '2013', controlCount: 75, description: 'Health Insurance Portability Act', registeredAt: Date.now() },
      { id: 'pci_dss', name: 'PCI-DSS', version: 'v4.0', controlCount: 259, description: 'Payment Card Industry Data Security Standard', registeredAt: Date.now() },
    ];
    for (const f of builtin) this.frameworks.set(f.id, f);
    logger.debug('[AutonomousComplianceReporter] Built-in frameworks seeded');
  }

  /**
   * Return a high-level summary of the compliance reporting engine.
   */
  getSummary(): ComplianceReporterSummary {
    const frameworkScores: Record<string, number> = {};
    for (const fw of this.frameworks.keys()) {
      frameworkScores[fw] = this.computeComplianceScore(fw);
    }
    const allScores = Object.values(frameworkScores);
    const overall = allScores.length > 0
      ? allScores.reduce((s, v) => s + v, 0) / allScores.length : 100;
    const openGaps = Array.from(this.gaps.values()).filter(g => !g.remediationId).length;
    const criticalGaps = Array.from(this.gaps.values()).filter(g => g.riskLevel === 'critical').length;
    const openRemediations = Array.from(this.remediations.values()).filter(r => r.status === 'open').length;

    const summary: ComplianceReporterSummary = {
      totalFrameworks: this.frameworks.size,
      totalControls: this.controls.size,
      overallComplianceScore: parseFloat(overall.toFixed(1)),
      openGaps,
      criticalGaps,
      openRemediations,
      riskRegisterEntries: this.riskRegister.size,
      auditTrailSize: this.auditTrail.length,
      frameworkScores,
    };

    logger.info(`[AutonomousComplianceReporter] Summary: score=${summary.overallComplianceScore}, gaps=${openGaps}`);
    return summary;
  }

  /** Compute weighted risk weight for a gap */
  getGapRiskWeight(gap: ComplianceGap): number {
    return RISK_LEVEL_WEIGHTS[gap.riskLevel] ?? 1;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__autonomousComplianceReporter__';
export function getAutonomousComplianceReporter(): AutonomousComplianceReporter {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AutonomousComplianceReporter();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AutonomousComplianceReporter;
}
