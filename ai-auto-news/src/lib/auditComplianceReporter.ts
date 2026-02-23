import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type ComplianceStandard = 'soc2' | 'hipaa' | 'iso27001' | 'pci_dss' | 'gdpr';
type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type ControlStatus = 'implemented' | 'partial' | 'planned' | 'not_applicable' | 'missing';
type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

interface AuditPolicy {
  id: string;
  name: string;
  enabled: boolean;
  categories: string[];
  retentionDays: number;
  severity: AuditSeverity;
  standards: ComplianceStandard[];
  createdAt: Date;
}

interface AuditEvent {
  id: string;
  policyId: string;
  tenantId: string;
  category: string;
  action: string;
  actor: string;
  resource: string;
  resourceType: string;
  severity: AuditSeverity;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  expiresAt: Date;
}

interface ComplianceControl {
  id: string;
  standard: ComplianceStandard;
  controlRef: string;
  title: string;
  description: string;
  status: ControlStatus;
  evidence: EvidenceRecord[];
  lastTestedAt: Date | null;
  lastTestResult: boolean | null;
  owner: string;
}

interface EvidenceRecord {
  id: string;
  controlId: string;
  type: 'document' | 'screenshot' | 'log' | 'config' | 'test_result';
  title: string;
  description: string;
  reference: string;
  collectedAt: Date;
  collectedBy: string;
  validUntil: Date;
}

interface ComplianceReport {
  id: string;
  standard: ComplianceStandard;
  tenantId: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalControls: number;
  implementedControls: number;
  partialControls: number;
  missingControls: number;
  complianceScore: number;
  gaps: GapAnalysisItem[];
  summary: string;
}

interface GapAnalysisItem {
  controlId: string;
  controlRef: string;
  title: string;
  currentStatus: ControlStatus;
  targetStatus: ControlStatus;
  priority: AuditSeverity;
  remediation: string;
  estimatedEffort: string;
}

interface ScheduledCheck {
  id: string;
  name: string;
  standard: ComplianceStandard;
  tenantId: string;
  frequency: ScheduleFrequency;
  lastRunAt: Date | null;
  nextRunAt: Date;
  enabled: boolean;
  controlIds: string[];
}

// ─── Standard Control Templates ──────────────────────────────────────────────

const STANDARD_CONTROLS: Record<ComplianceStandard, Array<{ ref: string; title: string; description: string }>> = {
  soc2: [
    { ref: 'CC1.1', title: 'Control Environment', description: 'Demonstrates commitment to integrity and ethical values' },
    { ref: 'CC2.1', title: 'Information Communication', description: 'Obtains or generates relevant quality information' },
    { ref: 'CC3.1', title: 'Risk Assessment', description: 'Specifies suitable objectives for risk identification' },
    { ref: 'CC4.1', title: 'Monitoring Activities', description: 'Selects and develops monitoring activities' },
    { ref: 'CC5.1', title: 'Control Activities', description: 'Selects and develops control activities to mitigate risks' },
    { ref: 'CC6.1', title: 'Logical Access', description: 'Implements logical access security controls' },
    { ref: 'CC7.1', title: 'System Operations', description: 'Detects and monitors security events' },
    { ref: 'CC8.1', title: 'Change Management', description: 'Manages changes to infrastructure and software' },
    { ref: 'CC9.1', title: 'Risk Mitigation', description: 'Identifies and assesses risk mitigation strategies' },
  ],
  hipaa: [
    { ref: '164.308(a)(1)', title: 'Security Management', description: 'Implement security management process' },
    { ref: '164.308(a)(3)', title: 'Workforce Security', description: 'Implement workforce security policies' },
    { ref: '164.308(a)(4)', title: 'Access Management', description: 'Implement access management procedures' },
    { ref: '164.308(a)(5)', title: 'Security Awareness', description: 'Implement security awareness training' },
    { ref: '164.310(a)(1)', title: 'Facility Access', description: 'Limit physical access to facilities' },
    { ref: '164.310(d)(1)', title: 'Device Controls', description: 'Implement device and media controls' },
    { ref: '164.312(a)(1)', title: 'Access Control', description: 'Implement technical access controls' },
    { ref: '164.312(e)(1)', title: 'Transmission Security', description: 'Implement transmission security' },
  ],
  iso27001: [
    { ref: 'A.5', title: 'Information Security Policies', description: 'Management direction for information security' },
    { ref: 'A.6', title: 'Organization of Info Security', description: 'Internal organization and mobile devices' },
    { ref: 'A.7', title: 'Human Resource Security', description: 'Prior to, during, and termination of employment' },
    { ref: 'A.8', title: 'Asset Management', description: 'Responsibility for assets and information classification' },
    { ref: 'A.9', title: 'Access Control', description: 'Business requirements and user access management' },
    { ref: 'A.10', title: 'Cryptography', description: 'Cryptographic controls' },
    { ref: 'A.12', title: 'Operations Security', description: 'Operational procedures and responsibilities' },
    { ref: 'A.13', title: 'Communications Security', description: 'Network security management' },
  ],
  pci_dss: [
    { ref: 'Req1', title: 'Firewall Configuration', description: 'Install and maintain firewall configuration' },
    { ref: 'Req3', title: 'Stored Data Protection', description: 'Protect stored cardholder data' },
    { ref: 'Req4', title: 'Encryption in Transit', description: 'Encrypt transmission of cardholder data' },
    { ref: 'Req6', title: 'Secure Systems', description: 'Develop and maintain secure systems' },
    { ref: 'Req7', title: 'Access Restriction', description: 'Restrict access to cardholder data' },
    { ref: 'Req10', title: 'Monitoring & Tracking', description: 'Track and monitor all access to network resources' },
  ],
  gdpr: [
    { ref: 'Art5', title: 'Data Processing Principles', description: 'Principles relating to processing of personal data' },
    { ref: 'Art6', title: 'Lawfulness of Processing', description: 'Lawfulness of personal data processing' },
    { ref: 'Art15', title: 'Right of Access', description: 'Data subject right of access' },
    { ref: 'Art17', title: 'Right to Erasure', description: 'Right to erasure (right to be forgotten)' },
    { ref: 'Art25', title: 'Data Protection by Design', description: 'Data protection by design and by default' },
    { ref: 'Art32', title: 'Security of Processing', description: 'Implement appropriate security measures' },
    { ref: 'Art33', title: 'Breach Notification', description: 'Notification of personal data breach' },
  ],
};

// ─── Implementation ──────────────────────────────────────────────────────────

class AuditComplianceReporter {
  private policies = new Map<string, AuditPolicy>();
  private events: AuditEvent[] = [];
  private controls = new Map<string, ComplianceControl>();
  private reports = new Map<string, ComplianceReport>();
  private scheduledChecks = new Map<string, ScheduledCheck>();
  private evictionInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof setInterval !== 'undefined') {
      this.evictionInterval = setInterval(() => this.evictExpiredEvents(), 3_600_000);
    }
    logger.info('AuditComplianceReporter initialized');
  }

  // ── Audit Policies ──────────────────────────────────────────────────────

  createPolicy(policy: Omit<AuditPolicy, 'createdAt'>): AuditPolicy {
    if (!policy.id || !policy.name) {
      throw new Error('Audit policy requires id and name');
    }
    if (policy.retentionDays < 1) {
      throw new Error('Retention must be at least 1 day');
    }
    const full: AuditPolicy = { ...policy, createdAt: new Date() };
    this.policies.set(policy.id, full);
    logger.info('Audit policy created', { policyId: policy.id, name: policy.name });
    return full;
  }

  updatePolicy(policyId: string, updates: Partial<Omit<AuditPolicy, 'id' | 'createdAt'>>): AuditPolicy {
    const existing = this.policies.get(policyId);
    if (!existing) throw new Error(`Policy ${policyId} not found`);
    Object.assign(existing, updates);
    return existing;
  }

  getPolicy(policyId: string): AuditPolicy | null {
    return this.policies.get(policyId) ?? null;
  }

  listPolicies(enabledOnly = false): AuditPolicy[] {
    const all = Array.from(this.policies.values());
    return enabledOnly ? all.filter((p) => p.enabled) : all;
  }

  // ── Audit Events ────────────────────────────────────────────────────────

  recordEvent(params: {
    policyId: string;
    tenantId: string;
    category: string;
    action: string;
    actor: string;
    resource: string;
    resourceType: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): AuditEvent | null {
    const policy = this.policies.get(params.policyId);
    if (!policy || !policy.enabled) return null;

    if (policy.categories.length > 0 && !policy.categories.includes(params.category)) {
      return null;
    }

    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    const event: AuditEvent = {
      id,
      policyId: params.policyId,
      tenantId: params.tenantId,
      category: params.category,
      action: params.action,
      actor: params.actor,
      resource: params.resource,
      resourceType: params.resourceType,
      severity: policy.severity,
      details: params.details ?? {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      timestamp: now,
      expiresAt: new Date(now.getTime() + policy.retentionDays * 86_400_000),
    };

    this.events.push(event);
    logger.debug('Audit event recorded', { eventId: id, category: params.category, action: params.action });
    return event;
  }

  queryEvents(filters: {
    tenantId?: string;
    category?: string;
    actor?: string;
    resource?: string;
    severity?: AuditSeverity;
    since?: Date;
    until?: Date;
    limit?: number;
  }): AuditEvent[] {
    let results = [...this.events];
    const now = new Date();

    // Filter expired
    results = results.filter((e) => e.expiresAt > now);

    if (filters.tenantId) results = results.filter((e) => e.tenantId === filters.tenantId);
    if (filters.category) results = results.filter((e) => e.category === filters.category);
    if (filters.actor) results = results.filter((e) => e.actor === filters.actor);
    if (filters.resource) results = results.filter((e) => e.resource === filters.resource);
    if (filters.severity) results = results.filter((e) => e.severity === filters.severity);
    if (filters.since) results = results.filter((e) => e.timestamp >= filters.since!);
    if (filters.until) results = results.filter((e) => e.timestamp <= filters.until!);

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters.limit && filters.limit > 0) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  private evictExpiredEvents(): void {
    const now = new Date();
    const before = this.events.length;
    this.events = this.events.filter((e) => e.expiresAt > now);
    const evicted = before - this.events.length;
    if (evicted > 0) {
      logger.info('Expired audit events evicted', { evicted, remaining: this.events.length });
    }
  }

  // ── Compliance Controls ─────────────────────────────────────────────────

  initializeControls(standard: ComplianceStandard, owner: string): ComplianceControl[] {
    const templates = STANDARD_CONTROLS[standard];
    if (!templates) throw new Error(`Unknown standard: ${standard}`);

    const created: ComplianceControl[] = [];
    for (const tpl of templates) {
      const id = `ctrl_${standard}_${tpl.ref.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (this.controls.has(id)) {
        created.push(this.controls.get(id)!);
        continue;
      }
      const control: ComplianceControl = {
        id,
        standard,
        controlRef: tpl.ref,
        title: tpl.title,
        description: tpl.description,
        status: 'missing',
        evidence: [],
        lastTestedAt: null,
        lastTestResult: null,
        owner,
      };
      this.controls.set(id, control);
      created.push(control);
    }

    logger.info('Compliance controls initialized', { standard, count: created.length });
    return created;
  }

  updateControlStatus(controlId: string, status: ControlStatus): ComplianceControl {
    const control = this.controls.get(controlId);
    if (!control) throw new Error(`Control ${controlId} not found`);
    control.status = status;
    return control;
  }

  getControl(controlId: string): ComplianceControl | null {
    return this.controls.get(controlId) ?? null;
  }

  getControlsByStandard(standard: ComplianceStandard): ComplianceControl[] {
    return Array.from(this.controls.values()).filter((c) => c.standard === standard);
  }

  // ── Evidence Collection ─────────────────────────────────────────────────

  addEvidence(params: {
    controlId: string;
    type: EvidenceRecord['type'];
    title: string;
    description: string;
    reference: string;
    collectedBy: string;
    validDays?: number;
  }): EvidenceRecord {
    const control = this.controls.get(params.controlId);
    if (!control) throw new Error(`Control ${params.controlId} not found`);

    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    const evidence: EvidenceRecord = {
      id,
      controlId: params.controlId,
      type: params.type,
      title: params.title,
      description: params.description,
      reference: params.reference,
      collectedAt: now,
      collectedBy: params.collectedBy,
      validUntil: new Date(now.getTime() + (params.validDays ?? 365) * 86_400_000),
    };

    control.evidence.push(evidence);
    logger.info('Evidence added', { evidenceId: id, controlId: params.controlId });
    return evidence;
  }

  getValidEvidence(controlId: string): EvidenceRecord[] {
    const control = this.controls.get(controlId);
    if (!control) return [];
    const now = new Date();
    return control.evidence.filter((e) => e.validUntil > now);
  }

  // ── Control Testing ─────────────────────────────────────────────────────

  testControl(controlId: string, passed: boolean): ComplianceControl {
    const control = this.controls.get(controlId);
    if (!control) throw new Error(`Control ${controlId} not found`);

    control.lastTestedAt = new Date();
    control.lastTestResult = passed;

    if (passed && control.status === 'missing') {
      control.status = 'partial';
    } else if (!passed && control.status === 'implemented') {
      control.status = 'partial';
      logger.warn('Control test regression detected', { controlId, controlRef: control.controlRef });
    }

    logger.info('Control tested', { controlId, passed });
    return control;
  }

  // ── Report Generation ───────────────────────────────────────────────────

  generateReport(
    standard: ComplianceStandard,
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): ComplianceReport {
    const controls = this.getControlsByStandard(standard);
    if (controls.length === 0) {
      throw new Error(`No controls found for standard ${standard}. Initialize controls first.`);
    }

    const implemented = controls.filter((c) => c.status === 'implemented').length;
    const partial = controls.filter((c) => c.status === 'partial').length;
    const missing = controls.filter((c) => c.status === 'missing').length;
    const total = controls.length;
    const score = total > 0 ? Math.round(((implemented + partial * 0.5) / total) * 100) : 0;

    const gaps = this.analyzeGaps(controls);

    const id = `rpt_${standard}_${tenantId}_${Date.now()}`;
    const report: ComplianceReport = {
      id,
      standard,
      tenantId,
      generatedAt: new Date(),
      periodStart,
      periodEnd,
      totalControls: total,
      implementedControls: implemented,
      partialControls: partial,
      missingControls: missing,
      complianceScore: score,
      gaps,
      summary: this.buildReportSummary(standard, score, total, implemented, missing, gaps.length),
    };

    this.reports.set(id, report);
    logger.info('Compliance report generated', { reportId: id, standard, tenantId, score });
    return report;
  }

  private analyzeGaps(controls: ComplianceControl[]): GapAnalysisItem[] {
    const gaps: GapAnalysisItem[] = [];

    for (const control of controls) {
      if (control.status === 'implemented' || control.status === 'not_applicable') continue;

      let priority: AuditSeverity;
      let effort: string;

      if (control.status === 'missing') {
        priority = 'critical';
        effort = 'high';
      } else if (control.status === 'partial') {
        priority = 'medium';
        effort = 'medium';
      } else {
        priority = 'low';
        effort = 'low';
      }

      const hasValidEvidence = this.getValidEvidence(control.id).length > 0;
      const hasRecentTest = control.lastTestedAt
        ? Date.now() - control.lastTestedAt.getTime() < 90 * 86_400_000
        : false;

      let remediation = '';
      if (control.status === 'missing') {
        remediation = `Implement control ${control.controlRef}: ${control.description}`;
      } else if (control.status === 'partial') {
        remediation = hasValidEvidence
          ? `Complete implementation and re-test control ${control.controlRef}`
          : `Collect evidence for control ${control.controlRef}`;
      } else {
        remediation = hasRecentTest
          ? `Address test failures for control ${control.controlRef}`
          : `Schedule testing for control ${control.controlRef}`;
      }

      gaps.push({
        controlId: control.id,
        controlRef: control.controlRef,
        title: control.title,
        currentStatus: control.status,
        targetStatus: 'implemented',
        priority,
        remediation,
        estimatedEffort: effort,
      });
    }

    const severityOrder: Record<AuditSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    gaps.sort((a, b) => severityOrder[a.priority] - severityOrder[b.priority]);
    return gaps;
  }

  private buildReportSummary(
    standard: ComplianceStandard,
    score: number,
    total: number,
    implemented: number,
    missing: number,
    gapCount: number,
  ): string {
    const standardNames: Record<ComplianceStandard, string> = {
      soc2: 'SOC 2',
      hipaa: 'HIPAA',
      iso27001: 'ISO 27001',
      pci_dss: 'PCI DSS',
      gdpr: 'GDPR',
    };
    const name = standardNames[standard];
    const lines = [
      `${name} Compliance Report`,
      `Overall Score: ${score}%`,
      `Controls: ${implemented}/${total} fully implemented, ${missing} missing`,
    ];
    if (gapCount > 0) {
      lines.push(`Action Required: ${gapCount} gap(s) identified requiring remediation`);
    } else {
      lines.push('Status: All controls implemented or not applicable');
    }
    return lines.join('. ');
  }

  getReport(reportId: string): ComplianceReport | null {
    return this.reports.get(reportId) ?? null;
  }

  // ── Scheduled Checks ────────────────────────────────────────────────────

  scheduleCheck(params: {
    name: string;
    standard: ComplianceStandard;
    tenantId: string;
    frequency: ScheduleFrequency;
    controlIds?: string[];
  }): ScheduledCheck {
    const id = `schk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const nextRunAt = this.calculateNextRun(params.frequency, new Date());

    const controlIds = params.controlIds ?? this.getControlsByStandard(params.standard).map((c) => c.id);

    const check: ScheduledCheck = {
      id,
      name: params.name,
      standard: params.standard,
      tenantId: params.tenantId,
      frequency: params.frequency,
      lastRunAt: null,
      nextRunAt,
      enabled: true,
      controlIds,
    };

    this.scheduledChecks.set(id, check);
    logger.info('Compliance check scheduled', { checkId: id, frequency: params.frequency });
    return check;
  }

  runScheduledChecks(): { checkId: string; controlsTested: number; passed: number; failed: number }[] {
    const now = new Date();
    const results: { checkId: string; controlsTested: number; passed: number; failed: number }[] = [];

    for (const [id, check] of this.scheduledChecks) {
      if (!check.enabled || check.nextRunAt > now) continue;

      let passed = 0;
      let failed = 0;

      for (const controlId of check.controlIds) {
        const control = this.controls.get(controlId);
        if (!control) continue;

        const hasEvidence = this.getValidEvidence(controlId).length > 0;
        const testPassed = control.status === 'implemented' && hasEvidence;
        this.testControl(controlId, testPassed);
        if (testPassed) passed++;
        else failed++;
      }

      check.lastRunAt = now;
      check.nextRunAt = this.calculateNextRun(check.frequency, now);

      results.push({ checkId: id, controlsTested: check.controlIds.length, passed, failed });
      logger.info('Scheduled check completed', { checkId: id, passed, failed });
    }

    return results;
  }

  private calculateNextRun(frequency: ScheduleFrequency, from: Date): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
    }
    return next;
  }

  getStats(): {
    totalPolicies: number;
    totalEvents: number;
    totalControls: number;
    totalReports: number;
    controlsByStatus: Record<ControlStatus, number>;
  } {
    const controlsByStatus: Record<ControlStatus, number> = {
      implemented: 0,
      partial: 0,
      planned: 0,
      not_applicable: 0,
      missing: 0,
    };
    for (const control of this.controls.values()) {
      controlsByStatus[control.status]++;
    }
    return {
      totalPolicies: this.policies.size,
      totalEvents: this.events.length,
      totalControls: this.controls.size,
      totalReports: this.reports.size,
      controlsByStatus,
    };
  }

  destroy(): void {
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__auditComplianceReporter__';

export function getAuditComplianceReporter(): AuditComplianceReporter {
  const g = globalThis as unknown as Record<string, AuditComplianceReporter>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AuditComplianceReporter();
  }
  return g[GLOBAL_KEY];
}

export type {
  AuditPolicy,
  AuditEvent,
  AuditSeverity,
  ComplianceStandard,
  ComplianceControl,
  ControlStatus,
  EvidenceRecord,
  ComplianceReport,
  GapAnalysisItem,
  ScheduledCheck,
  ScheduleFrequency,
};
