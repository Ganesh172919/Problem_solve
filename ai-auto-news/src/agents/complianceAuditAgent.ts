/**
 * Compliance Audit Agent
 *
 * Automates compliance auditing across SOC2, GDPR, HIPAA, and PCI-DSS
 * frameworks. Handles evidence collection, control testing, gap analysis,
 * remediation planning, and continuous compliance monitoring.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export type RegulatoryFramework = 'SOC2' | 'GDPR' | 'HIPAA' | 'PCI-DSS' | 'ISO27001' | 'NIST';

export interface ComplianceControl {
  controlId: string;
  framework: RegulatoryFramework;
  category: string;
  title: string;
  description: string;
  requirement: string;
  testProcedure: string;
  evidenceRequired: string[];
  automatedTest: boolean;
  criticality: 'high' | 'medium' | 'low';
  lastTested?: number;
  status: ControlStatus;
}

export type ControlStatus = 'not_tested' | 'passing' | 'failing' | 'compensating' | 'not_applicable';

export interface AuditEvidence {
  evidenceId: string;
  controlId: string;
  auditId: string;
  type: EvidenceType;
  description: string;
  source: string;
  collectedAt: number;
  collectedBy: 'agent' | 'human';
  data: Record<string, unknown>;
  valid: boolean;
  expiresAt?: number;
  attachmentUrl?: string;
}

export type EvidenceType =
  | 'log_export'
  | 'screenshot'
  | 'configuration_snapshot'
  | 'policy_document'
  | 'access_review'
  | 'penetration_test_report'
  | 'training_completion'
  | 'vendor_attestation'
  | 'system_generated';

export interface NonCompliance {
  findingId: string;
  auditId: string;
  controlId: string;
  framework: RegulatoryFramework;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string[];
  impact: string;
  likelihood: 'high' | 'medium' | 'low';
  riskScore: number;
  remediationDeadline: number;
  status: 'open' | 'in_progress' | 'remediated' | 'accepted_risk';
  detectedAt: number;
}

export interface RemediationPlan {
  planId: string;
  auditId: string;
  findings: string[];
  tasks: RemediationTask[];
  priority: 'immediate' | 'high' | 'medium' | 'low';
  estimatedEffortDays: number;
  dueDate: number;
  owner: string;
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  createdAt: number;
  completedAt?: number;
}

export interface RemediationTask {
  taskId: string;
  findingId: string;
  title: string;
  description: string;
  steps: string[];
  assignee?: string;
  dueDate: number;
  status: 'todo' | 'in_progress' | 'done' | 'verified';
  completedAt?: number;
  verifiedBy?: string;
}

export interface ComplianceScore {
  framework: RegulatoryFramework;
  overall: number;
  byCategory: Record<string, number>;
  passingControls: number;
  failingControls: number;
  notTestedControls: number;
  totalControls: number;
  trend: 'improving' | 'stable' | 'degrading';
  computedAt: number;
}

export interface AuditSchedule {
  scheduleId: string;
  framework: RegulatoryFramework;
  scope: string[];
  frequency: 'continuous' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  nextRunAt: number;
  lastRunAt?: number;
  owner: string;
  tenantId?: string;
  enabled: boolean;
  createdAt: number;
}

export interface AuditReport {
  reportId: string;
  auditId: string;
  framework: RegulatoryFramework;
  scope: string[];
  tenantId?: string;
  executiveSummary: string;
  complianceScore: ComplianceScore;
  findings: NonCompliance[];
  remediationPlan: RemediationPlan;
  evidenceCount: number;
  controlResults: { controlId: string; status: ControlStatus; evidenceIds: string[] }[];
  auditor: string;
  period: { from: number; to: number };
  generatedAt: number;
  nextAuditAt?: number;
}

export interface AuditRecord {
  auditId: string;
  framework: RegulatoryFramework;
  scope: string[];
  tenantId?: string;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  controls: ComplianceControl[];
  evidenceMap: Map<string, AuditEvidence[]>;
  findings: NonCompliance[];
  scheduleId?: string;
}

export class ComplianceAuditAgent {
  private controls = new Map<string, ComplianceControl>();
  private audits = new Map<string, AuditRecord>();
  private schedules = new Map<string, AuditSchedule>();
  private remediationPlans = new Map<string, RemediationPlan>();
  private scoreHistory = new Map<RegulatoryFramework, ComplianceScore[]>();
  private continuousIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor() {
    this.loadControlLibrary();
  }

  scheduleAudit(framework: RegulatoryFramework, scope: string[], options?: {
    frequency?: AuditSchedule['frequency'];
    tenantId?: string;
    owner?: string;
  }): AuditSchedule {
    const schedule: AuditSchedule = {
      scheduleId: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      framework,
      scope,
      frequency: options?.frequency ?? 'quarterly',
      nextRunAt: Date.now() + this.frequencyToMs(options?.frequency ?? 'quarterly'),
      owner: options?.owner ?? 'compliance-team',
      tenantId: options?.tenantId,
      enabled: true,
      createdAt: Date.now(),
    };

    this.schedules.set(schedule.scheduleId, schedule);

    logger.info('Audit scheduled', {
      scheduleId: schedule.scheduleId,
      framework,
      scope,
      frequency: schedule.frequency,
      nextRunAt: new Date(schedule.nextRunAt).toISOString(),
    });

    return schedule;
  }

  executeAudit(scheduleIdOrAuditId: string): AuditRecord {
    const schedule = this.schedules.get(scheduleIdOrAuditId);

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const framework = schedule?.framework ?? 'SOC2';
    const scope = schedule?.scope ?? ['all'];

    const applicableControls = Array.from(this.controls.values()).filter(
      c => c.framework === framework
    );

    const audit: AuditRecord = {
      auditId,
      framework,
      scope,
      tenantId: schedule?.tenantId,
      status: 'running',
      startedAt: Date.now(),
      controls: applicableControls.map(c => ({ ...c })),
      evidenceMap: new Map(),
      findings: [],
      scheduleId: schedule?.scheduleId,
    };

    this.audits.set(auditId, audit);

    logger.info('Audit execution started', {
      auditId,
      framework,
      scope,
      controlCount: applicableControls.length,
    });

    // Execute each control test
    for (const control of audit.controls) {
      const evidence = this.collectEvidence(control.controlId, auditId);
      audit.evidenceMap.set(control.controlId, evidence);

      const testResult = this.testControl(control, evidence);
      control.status = testResult.status;
      control.lastTested = Date.now();

      if (testResult.status === 'failing') {
        const finding = this.createFinding(audit, control, testResult.reason ?? 'Control test failed');
        audit.findings.push(finding);
      }
    }

    audit.status = 'completed';
    audit.completedAt = Date.now();

    if (schedule) {
      schedule.lastRunAt = Date.now();
      schedule.nextRunAt = Date.now() + this.frequencyToMs(schedule.frequency);
    }

    logger.info('Audit execution completed', {
      auditId,
      framework,
      findings: audit.findings.length,
      duration: audit.completedAt - audit.startedAt!,
    });

    return audit;
  }

  collectEvidence(controlId: string, auditId: string): AuditEvidence[] {
    const control = this.controls.get(controlId);
    if (!control) {
      logger.warn('Control not found during evidence collection', { controlId });
      return [];
    }

    const evidence: AuditEvidence[] = control.evidenceRequired.map((reqType, i) => {
      const evidenceType = this.mapRequirementToEvidenceType(reqType);
      return {
        evidenceId: `ev-${Date.now()}-${i}`,
        controlId,
        auditId,
        type: evidenceType,
        description: `Automated evidence for: ${reqType}`,
        source: 'compliance-audit-agent',
        collectedAt: Date.now(),
        collectedBy: 'agent',
        data: this.gatherEvidenceData(control, reqType),
        valid: true,
        expiresAt: Date.now() + 365 * 24 * 3600_000,
      };
    });

    logger.debug('Evidence collected', { controlId, auditId, count: evidence.length });
    return evidence;
  }

  assessCompliance(auditId: string): ComplianceScore {
    const audit = this.audits.get(auditId);
    if (!audit) throw new Error(`Audit ${auditId} not found`);

    const byCategory: Record<string, { pass: number; total: number }> = {};

    for (const control of audit.controls) {
      if (!byCategory[control.category]) {
        byCategory[control.category] = { pass: 0, total: 0 };
      }
      byCategory[control.category].total++;
      if (control.status === 'passing' || control.status === 'compensating') {
        byCategory[control.category].pass++;
      }
    }

    const categoryScores: Record<string, number> = {};
    for (const [cat, counts] of Object.entries(byCategory)) {
      categoryScores[cat] = counts.total > 0 ? (counts.pass / counts.total) * 100 : 0;
    }

    const passing = audit.controls.filter(c => c.status === 'passing' || c.status === 'compensating').length;
    const failing = audit.controls.filter(c => c.status === 'failing').length;
    const notTested = audit.controls.filter(c => c.status === 'not_tested').length;
    const total = audit.controls.length;
    const overall = total > 0 ? (passing / total) * 100 : 0;

    const history = this.scoreHistory.get(audit.framework) ?? [];
    const prevScore = history.slice(-1)[0]?.overall ?? overall;
    const trend: ComplianceScore['trend'] = overall > prevScore + 1 ? 'improving' : overall < prevScore - 1 ? 'degrading' : 'stable';

    const score: ComplianceScore = {
      framework: audit.framework,
      overall,
      byCategory: categoryScores,
      passingControls: passing,
      failingControls: failing,
      notTestedControls: notTested,
      totalControls: total,
      trend,
      computedAt: Date.now(),
    };

    history.push(score);
    if (history.length > 50) history.shift();
    this.scoreHistory.set(audit.framework, history);

    logger.info('Compliance assessed', {
      auditId,
      framework: audit.framework,
      overall: score.overall.toFixed(1),
      passing,
      failing,
      trend,
    });

    return score;
  }

  generateRemediationPlan(findings: NonCompliance[]): RemediationPlan {
    const criticalAndHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
    const priority: RemediationPlan['priority'] = criticalAndHigh.length > 0 ? 'immediate' : 'high';

    const tasks: RemediationTask[] = findings.map((finding, i) => ({
      taskId: `task-${Date.now()}-${i}`,
      findingId: finding.findingId,
      title: `Remediate: ${finding.title}`,
      description: finding.description,
      steps: this.buildRemediationSteps(finding),
      dueDate: finding.remediationDeadline,
      status: 'todo',
    }));

    const effortDays = tasks.length * 2 + criticalAndHigh.length * 3;
    const plan: RemediationPlan = {
      planId: `rplan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      auditId: findings[0]?.auditId ?? 'unknown',
      findings: findings.map(f => f.findingId),
      tasks,
      priority,
      estimatedEffortDays: effortDays,
      dueDate: findings.reduce((min, f) => Math.min(min, f.remediationDeadline), Infinity),
      owner: 'compliance-team',
      status: 'draft',
      createdAt: Date.now(),
    };

    this.remediationPlans.set(plan.planId, plan);

    logger.info('Remediation plan generated', {
      planId: plan.planId,
      findings: findings.length,
      tasks: tasks.length,
      priority,
      estimatedEffortDays: effortDays,
    });

    return plan;
  }

  trackRemediation(planId: string): RemediationPlan & { progress: number; overdueCount: number } {
    const plan = this.remediationPlans.get(planId);
    if (!plan) throw new Error(`Remediation plan ${planId} not found`);

    const now = Date.now();
    const done = plan.tasks.filter(t => t.status === 'done' || t.status === 'verified').length;
    const overdue = plan.tasks.filter(t => t.status !== 'done' && t.status !== 'verified' && t.dueDate < now).length;
    const progress = plan.tasks.length > 0 ? (done / plan.tasks.length) * 100 : 0;

    if (progress >= 100) {
      plan.status = 'completed';
      plan.completedAt = now;
    } else if (done > 0) {
      plan.status = 'in_progress';
    }

    logger.info('Remediation progress tracked', {
      planId,
      progress: progress.toFixed(1),
      overdue,
      status: plan.status,
    });

    return { ...plan, progress, overdueCount: overdue };
  }

  generateAuditReport(auditId: string): AuditReport {
    const audit = this.audits.get(auditId);
    if (!audit) throw new Error(`Audit ${auditId} not found`);

    const complianceScore = this.assessCompliance(auditId);
    const remediationPlan = audit.findings.length > 0
      ? this.generateRemediationPlan(audit.findings)
      : this.generateRemediationPlan([]);

    const controlResults = audit.controls.map(c => ({
      controlId: c.controlId,
      status: c.status,
      evidenceIds: (audit.evidenceMap.get(c.controlId) ?? []).map(e => e.evidenceId),
    }));

    const totalEvidence = Array.from(audit.evidenceMap.values()).flat().length;
    const criticalFindings = audit.findings.filter(f => f.severity === 'critical').length;

    const executiveSummary = [
      `${audit.framework} compliance audit completed for scope: ${audit.scope.join(', ')}.`,
      `Overall compliance score: ${complianceScore.overall.toFixed(1)}%.`,
      criticalFindings > 0
        ? `${criticalFindings} critical finding(s) require immediate attention.`
        : 'No critical findings identified.',
      `Remediation plan created with ${remediationPlan.tasks.length} tasks estimated at ${remediationPlan.estimatedEffortDays} days.`,
    ].join(' ');

    const report: AuditReport = {
      reportId: `report-${Date.now()}`,
      auditId,
      framework: audit.framework,
      scope: audit.scope,
      tenantId: audit.tenantId,
      executiveSummary,
      complianceScore,
      findings: audit.findings,
      remediationPlan,
      evidenceCount: totalEvidence,
      controlResults,
      auditor: 'compliance-audit-agent',
      period: { from: audit.startedAt ?? Date.now() - 86_400_000, to: audit.completedAt ?? Date.now() },
      generatedAt: Date.now(),
      nextAuditAt: audit.scheduleId
        ? this.schedules.get(audit.scheduleId)?.nextRunAt
        : undefined,
    };

    logger.info('Audit report generated', {
      reportId: report.reportId,
      auditId,
      framework: audit.framework,
      overallScore: complianceScore.overall.toFixed(1),
      findings: audit.findings.length,
    });

    return report;
  }

  monitorContinuous(frameworks: RegulatoryFramework[]): void {
    for (const framework of frameworks) {
      if (this.continuousIntervals.has(framework)) continue;

      const schedule = this.scheduleAudit(framework, ['all'], { frequency: 'continuous' });

      const interval = setInterval(() => {
        const auditRecord = this.executeAudit(schedule.scheduleId);
        const score = this.assessCompliance(auditRecord.auditId);

        if (score.failingControls > 0) {
          logger.warn('Continuous compliance check detected failures', {
            framework,
            failingControls: score.failingControls,
            overall: score.overall.toFixed(1),
          });
        }

        // Auto-generate remediation plan if critical findings exist
        const criticals = auditRecord.findings.filter(f => f.severity === 'critical');
        if (criticals.length > 0) {
          this.generateRemediationPlan(criticals);
          logger.error('Critical compliance failures detected in continuous monitoring', undefined, {
            framework,
            criticals: criticals.map(f => f.title),
          });
        }
      }, 3_600_000);

      this.continuousIntervals.set(framework, interval);

      logger.info('Continuous compliance monitoring started', { framework });
    }
  }

  stopContinuous(framework: RegulatoryFramework): void {
    const interval = this.continuousIntervals.get(framework);
    if (interval) {
      clearInterval(interval);
      this.continuousIntervals.delete(framework);
      logger.info('Continuous compliance monitoring stopped', { framework });
    }
  }

  getAudit(auditId: string): AuditRecord | undefined {
    return this.audits.get(auditId);
  }

  listAudits(filter?: { framework?: RegulatoryFramework; tenantId?: string }): AuditRecord[] {
    let records = Array.from(this.audits.values());
    if (filter?.framework) records = records.filter(a => a.framework === filter.framework);
    if (filter?.tenantId) records = records.filter(a => a.tenantId === filter.tenantId);
    return records.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  private testControl(control: ComplianceControl, evidence: AuditEvidence[]): { status: ControlStatus; reason?: string } {
    if (control.status === 'not_applicable') return { status: 'not_applicable' };
    if (evidence.length === 0) return { status: 'failing', reason: 'No evidence collected' };

    const invalidEvidence = evidence.filter(e => !e.valid);
    if (invalidEvidence.length > 0) {
      return { status: 'failing', reason: `${invalidEvidence.length} invalid evidence item(s)` };
    }

    const evidenceData = evidence[0]?.data ?? {};

    // Framework-specific test logic
    if (control.framework === 'SOC2') {
      if (control.category === 'Access Control' && evidenceData['mfaEnabled'] === false) {
        return { status: 'failing', reason: 'MFA not enabled for privileged access' };
      }
      if (control.category === 'Availability' && Number(evidenceData['uptimePct'] ?? 100) < 99.5) {
        return { status: 'failing', reason: `Uptime below SLA: ${evidenceData['uptimePct']}%` };
      }
    }

    if (control.framework === 'GDPR') {
      if (control.category === 'Data Retention' && evidenceData['retentionPolicyExists'] === false) {
        return { status: 'failing', reason: 'Data retention policy not implemented' };
      }
      if (control.category === 'Consent' && evidenceData['consentTrackingEnabled'] === false) {
        return { status: 'failing', reason: 'Consent tracking not enabled' };
      }
    }

    if (control.framework === 'HIPAA') {
      if (control.category === 'Encryption' && evidenceData['encryptionAtRest'] === false) {
        return { status: 'failing', reason: 'PHI not encrypted at rest' };
      }
    }

    if (control.framework === 'PCI-DSS') {
      if (control.category === 'Network Security' && evidenceData['firewallConfigured'] === false) {
        return { status: 'failing', reason: 'Firewall not properly configured' };
      }
    }

    return { status: 'passing' };
  }

  private gatherEvidenceData(control: ComplianceControl, requirementType: string): Record<string, unknown> {
    // Simulate pulling real data from the platform
    const baseData: Record<string, unknown> = {
      mfaEnabled: true,
      uptimePct: 99.95,
      retentionPolicyExists: true,
      consentTrackingEnabled: true,
      encryptionAtRest: true,
      firewallConfigured: true,
      logsRetained: true,
      patchLevel: 'current',
      accessReviewCompleted: true,
      incidentResponseTested: true,
    };

    return {
      ...baseData,
      collectedFor: requirementType,
      framework: control.framework,
      category: control.category,
      timestamp: Date.now(),
    };
  }

  private createFinding(audit: AuditRecord, control: ComplianceControl, reason: string): NonCompliance {
    const severityMap: Record<string, NonCompliance['severity']> = {
      high: 'high',
      medium: 'medium',
      low: 'low',
    };
    const severity: NonCompliance['severity'] = control.criticality === 'high' ? 'critical' : severityMap[control.criticality] ?? 'medium';
    const riskScore = severity === 'critical' ? 9 : severity === 'high' ? 7 : severity === 'medium' ? 5 : 2;

    return {
      findingId: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      auditId: audit.auditId,
      controlId: control.controlId,
      framework: control.framework,
      severity,
      title: `Control Failure: ${control.title}`,
      description: reason,
      evidence: (audit.evidenceMap.get(control.controlId) ?? []).map(e => e.evidenceId),
      impact: `Non-compliance with ${control.framework} ${control.category} requirements`,
      likelihood: severity === 'critical' ? 'high' : 'medium',
      riskScore,
      remediationDeadline: severity === 'critical'
        ? Date.now() + 7 * 24 * 3600_000
        : Date.now() + 30 * 24 * 3600_000,
      status: 'open',
      detectedAt: Date.now(),
    };
  }

  private buildRemediationSteps(finding: NonCompliance): string[] {
    const commonSteps = [
      `Review current state of control: ${finding.controlId}`,
      'Assign responsible owner for remediation',
      'Implement required technical or process change',
      'Collect updated evidence after change',
      'Re-test control to verify compliance',
      'Document resolution in audit trail',
    ];

    const frameworkSteps: Record<RegulatoryFramework, string[]> = {
      SOC2: ['Update Trust Service Criteria documentation', 'Notify auditor of control change'],
      GDPR: ['Update privacy notice if user-facing change', 'Log in GDPR Article 30 record'],
      HIPAA: ['Update HIPAA risk assessment', 'Retrain staff if process change'],
      'PCI-DSS': ['Update network topology diagram', 'Re-run PCI ASV scan'],
      ISO27001: ['Update ISMS documentation', 'Internal audit sign-off'],
      NIST: ['Update NIST CSF mapping', 'Document in POA&M'],
    };

    return [...commonSteps, ...(frameworkSteps[finding.framework] ?? [])];
  }

  private mapRequirementToEvidenceType(requirement: string): EvidenceType {
    const mapping: Record<string, EvidenceType> = {
      logs: 'log_export',
      configuration: 'configuration_snapshot',
      policy: 'policy_document',
      screenshot: 'screenshot',
      'access review': 'access_review',
      'pen test': 'penetration_test_report',
      training: 'training_completion',
      vendor: 'vendor_attestation',
    };

    for (const [key, type] of Object.entries(mapping)) {
      if (requirement.toLowerCase().includes(key)) return type;
    }
    return 'system_generated';
  }

  private frequencyToMs(frequency: AuditSchedule['frequency']): number {
    const map: Record<AuditSchedule['frequency'], number> = {
      continuous: 3_600_000,
      weekly: 7 * 24 * 3600_000,
      monthly: 30 * 24 * 3600_000,
      quarterly: 90 * 24 * 3600_000,
      annual: 365 * 24 * 3600_000,
    };
    return map[frequency];
  }

  private loadControlLibrary(): void {
    const soc2Controls: ComplianceControl[] = [
      { controlId: 'SOC2-CC1.1', framework: 'SOC2', category: 'Control Environment', title: 'COSO Principles', description: 'Demonstrates commitment to integrity and ethical values', requirement: 'Code of conduct policy exists and is communicated', testProcedure: 'Review code of conduct policy and distribution records', evidenceRequired: ['policy'], automatedTest: false, criticality: 'high', status: 'not_tested' },
      { controlId: 'SOC2-CC6.1', framework: 'SOC2', category: 'Access Control', title: 'Logical Access Security', description: 'Access to system components is restricted to authorized users', requirement: 'MFA enforced for all privileged access', testProcedure: 'Verify MFA configuration on all privileged accounts', evidenceRequired: ['configuration', 'screenshot'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'SOC2-A1.1', framework: 'SOC2', category: 'Availability', title: 'SLA Commitments', description: 'Current processing capacity is maintained to meet SLA commitments', requirement: 'System uptime >= 99.5%', testProcedure: 'Review uptime monitoring data for audit period', evidenceRequired: ['logs'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'SOC2-CC7.2', framework: 'SOC2', category: 'Monitoring', title: 'Anomaly Detection', description: 'Security events are monitored and evaluated', requirement: 'SIEM or equivalent anomaly detection is operational', testProcedure: 'Verify active security monitoring configuration', evidenceRequired: ['configuration', 'logs'], automatedTest: true, criticality: 'medium', status: 'not_tested' },
    ];

    const gdprControls: ComplianceControl[] = [
      { controlId: 'GDPR-ART5', framework: 'GDPR', category: 'Data Retention', title: 'Storage Limitation', description: 'Personal data kept no longer than necessary', requirement: 'Data retention policy exists and is enforced', testProcedure: 'Review retention policy and verify automated deletion', evidenceRequired: ['policy', 'configuration'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'GDPR-ART7', framework: 'GDPR', category: 'Consent', title: 'Conditions for Consent', description: 'Valid consent obtained for personal data processing', requirement: 'Consent tracking system operational', testProcedure: 'Verify consent mechanism and audit trail', evidenceRequired: ['screenshot', 'configuration'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'GDPR-ART32', framework: 'GDPR', category: 'Security', title: 'Security of Processing', description: 'Appropriate technical and organizational measures implemented', requirement: 'Encryption at rest and in transit for personal data', testProcedure: 'Verify encryption configuration for data stores and transport', evidenceRequired: ['configuration'], automatedTest: true, criticality: 'high', status: 'not_tested' },
    ];

    const hipaaControls: ComplianceControl[] = [
      { controlId: 'HIPAA-164.312a', framework: 'HIPAA', category: 'Access Control', title: 'PHI Access Control', description: 'Technical policies to allow access only to authorized persons', requirement: 'Unique user identification and automatic logoff', testProcedure: 'Verify user provisioning and session timeout configuration', evidenceRequired: ['configuration', 'access review'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'HIPAA-164.312e', framework: 'HIPAA', category: 'Encryption', title: 'Transmission Security', description: 'PHI transmitted securely', requirement: 'TLS 1.2+ enforced for all PHI in transit', testProcedure: 'Review network configuration and TLS settings', evidenceRequired: ['configuration'], automatedTest: true, criticality: 'high', status: 'not_tested' },
    ];

    const pciControls: ComplianceControl[] = [
      { controlId: 'PCI-REQ1', framework: 'PCI-DSS', category: 'Network Security', title: 'Firewall Configuration', description: 'Install and maintain network security controls', requirement: 'Firewall configured to restrict inbound/outbound traffic', testProcedure: 'Review firewall ruleset and network diagrams', evidenceRequired: ['configuration', 'screenshot'], automatedTest: true, criticality: 'high', status: 'not_tested' },
      { controlId: 'PCI-REQ3', framework: 'PCI-DSS', category: 'Data Protection', title: 'Cardholder Data Protection', description: 'Protect stored cardholder data', requirement: 'PAN data masked or tokenized; no prohibited data stored', testProcedure: 'Scan data stores for unmasked PAN data', evidenceRequired: ['logs', 'configuration'], automatedTest: true, criticality: 'high', status: 'not_tested' },
    ];

    [...soc2Controls, ...gdprControls, ...hipaaControls, ...pciControls].forEach(c => {
      this.controls.set(c.controlId, c);
    });

    logger.info('Compliance control library loaded', { totalControls: this.controls.size });
  }
}

declare global {
   
  var __complianceAuditAgent__: ComplianceAuditAgent | undefined;
}

export function getComplianceAuditAgent(): ComplianceAuditAgent {
  if (!globalThis.__complianceAuditAgent__) {
    globalThis.__complianceAuditAgent__ = new ComplianceAuditAgent();
  }
  return globalThis.__complianceAuditAgent__;
}
