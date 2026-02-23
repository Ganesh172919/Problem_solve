import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DSRType = 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
export type DSRStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'expired';
export type LawfulBasis = 'consent' | 'contract' | 'legal_obligation' | 'vital_interest' | 'public_task' | 'legitimate_interest';
export type ConsentStatus = 'granted' | 'withdrawn' | 'expired' | 'pending';
export type RetentionAction = 'archive' | 'anonymize' | 'delete';

export interface DataSubjectRequest {
  id: string;
  subjectId: string;
  type: DSRType;
  status: DSRStatus;
  description: string;
  requestedAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  deadline: string;
  handlerNotes: string[];
  verificationStatus: 'unverified' | 'verified' | 'failed';
  metadata: Record<string, unknown>;
}

export interface ConsentRecord {
  id: string;
  subjectId: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  status: ConsentStatus;
  grantedAt: string | null;
  withdrawnAt: string | null;
  expiresAt: string | null;
  version: number;
  source: string;
  proofReference: string;
}

export interface RetentionPolicy {
  id: string;
  dataCategory: string;
  retentionDays: number;
  action: RetentionAction;
  legalBasis: string;
  createdAt: string;
  active: boolean;
}

export interface DataProcessingActivity {
  id: string;
  name: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  dataCategories: string[];
  dataSubjectCategories: string[];
  recipients: string[];
  transferCountries: string[];
  retentionPeriod: string;
  technicalMeasures: string[];
  organizationalMeasures: string[];
  dpiaConducted: boolean;
  recordedAt: string;
}

export interface PrivacyImpactScore {
  overall: number;
  dataVolume: number;
  dataSensitivity: number;
  processingComplexity: number;
  crossBorderRisk: number;
  automatedDecisionMaking: number;
  recommendations: string[];
}

export interface CrossBorderTransfer {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  dataCategories: string[];
  safeguard: 'adequacy_decision' | 'standard_clauses' | 'binding_rules' | 'explicit_consent' | 'none';
  approved: boolean;
  recordedAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  subjectId: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface ErasureResult {
  subjectId: string;
  fieldsErased: number;
  systemsNotified: string[];
  completedAt: string;
  residualData: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DSR_DEADLINE_DAYS = 30;
const ADEQUATE_COUNTRIES = new Set([
  'EU', 'EEA', 'GB', 'CH', 'JP', 'KR', 'NZ', 'AR', 'CA', 'IL', 'UY',
]);

// ─── Engine ───────────────────────────────────────────────────────────────────

export class GDPRComplianceEngine {
  private requests: Map<string, DataSubjectRequest> = new Map();
  private consents: Map<string, ConsentRecord[]> = new Map();
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();
  private processingActivities: Map<string, DataProcessingActivity> = new Map();
  private transfers: Map<string, CrossBorderTransfer> = new Map();
  private auditLog: AuditEntry[] = [];
  private log = logger.child({ service: 'GDPRComplianceEngine' });

  // ─── Data Subject Requests ────────────────────────────────────────────────

  createDSR(
    subjectId: string,
    type: DSRType,
    description: string,
    metadata: Record<string, unknown> = {},
  ): DataSubjectRequest {
    const id = crypto.randomUUID();
    const now = new Date();
    const deadline = new Date(now.getTime() + DSR_DEADLINE_DAYS * 86_400_000);

    const request: DataSubjectRequest = {
      id,
      subjectId,
      type,
      status: 'pending',
      description,
      requestedAt: now.toISOString(),
      acknowledgedAt: null,
      completedAt: null,
      deadline: deadline.toISOString(),
      handlerNotes: [],
      verificationStatus: 'unverified',
      metadata,
    };

    this.requests.set(id, request);
    this.addAudit('dsr_created', 'system', subjectId, { dsrId: id, type });
    this.log.info('DSR created', { dsrId: id, type, subjectId });
    return request;
  }

  acknowledgeDSR(dsrId: string, handlerId: string): boolean {
    const dsr = this.requests.get(dsrId);
    if (!dsr || dsr.status !== 'pending') return false;

    dsr.status = 'in_progress';
    dsr.acknowledgedAt = new Date().toISOString();
    this.addAudit('dsr_acknowledged', handlerId, dsr.subjectId, { dsrId });
    return true;
  }

  verifySubjectIdentity(dsrId: string, verified: boolean): boolean {
    const dsr = this.requests.get(dsrId);
    if (!dsr) return false;

    dsr.verificationStatus = verified ? 'verified' : 'failed';
    if (!verified) dsr.status = 'rejected';
    this.addAudit('dsr_verification', 'system', dsr.subjectId, { dsrId, verified });
    return true;
  }

  completeDSR(dsrId: string, handlerId: string, notes?: string): boolean {
    const dsr = this.requests.get(dsrId);
    if (!dsr || dsr.status !== 'in_progress') return false;
    if (dsr.verificationStatus !== 'verified') return false;

    dsr.status = 'completed';
    dsr.completedAt = new Date().toISOString();
    if (notes) dsr.handlerNotes.push(notes);
    this.addAudit('dsr_completed', handlerId, dsr.subjectId, { dsrId });
    this.log.info('DSR completed', { dsrId, type: dsr.type });
    return true;
  }

  getDSR(dsrId: string): DataSubjectRequest | null {
    return this.requests.get(dsrId) ?? null;
  }

  listDSRsBySubject(subjectId: string): DataSubjectRequest[] {
    return [...this.requests.values()].filter(r => r.subjectId === subjectId);
  }

  getOverdueDSRs(): DataSubjectRequest[] {
    const now = Date.now();
    return [...this.requests.values()].filter(
      r => r.status !== 'completed' && r.status !== 'rejected' && new Date(r.deadline).getTime() < now,
    );
  }

  // ─── Right to Erasure ─────────────────────────────────────────────────────

  executeErasure(
    subjectId: string,
    dataLocations: string[],
    fieldsToErase: string[],
  ): ErasureResult {
    const residual: string[] = [];
    let fieldsErased = 0;

    for (const field of fieldsToErase) {
      const hasLegalHold = this.checkLegalHold(subjectId, field);
      if (hasLegalHold) {
        residual.push(field);
        continue;
      }
      fieldsErased++;
    }

    // Withdraw all consents
    const subjectConsents = this.consents.get(subjectId) ?? [];
    for (const consent of subjectConsents) {
      if (consent.status === 'granted') {
        consent.status = 'withdrawn';
        consent.withdrawnAt = new Date().toISOString();
      }
    }

    const result: ErasureResult = {
      subjectId,
      fieldsErased,
      systemsNotified: dataLocations,
      completedAt: new Date().toISOString(),
      residualData: residual,
    };

    this.addAudit('erasure_executed', 'system', subjectId, {
      fieldsErased,
      residualCount: residual.length,
    });
    this.log.info('Erasure executed', { subjectId, fieldsErased, residual: residual.length });
    return result;
  }

  private checkLegalHold(subjectId: string, field: string): boolean {
    for (const policy of this.retentionPolicies.values()) {
      if (!policy.active) continue;
      if (policy.dataCategory === field && policy.action !== 'delete') {
        return true;
      }
    }
    return false;
  }

  // ─── Consent Management ───────────────────────────────────────────────────

  recordConsent(
    subjectId: string,
    purpose: string,
    lawfulBasis: LawfulBasis,
    source: string,
    expiresInDays?: number,
  ): ConsentRecord {
    const id = crypto.randomUUID();
    const now = new Date();
    const existing = (this.consents.get(subjectId) ?? [])
      .filter(c => c.purpose === purpose && c.status === 'granted');

    const version = existing.length > 0 ? Math.max(...existing.map(c => c.version)) + 1 : 1;

    // Supersede previous consents for same purpose
    for (const prev of existing) {
      prev.status = 'withdrawn';
      prev.withdrawnAt = now.toISOString();
    }

    const consent: ConsentRecord = {
      id,
      subjectId,
      purpose,
      lawfulBasis,
      status: 'granted',
      grantedAt: now.toISOString(),
      withdrawnAt: null,
      expiresAt: expiresInDays
        ? new Date(now.getTime() + expiresInDays * 86_400_000).toISOString()
        : null,
      version,
      source,
      proofReference: crypto.randomUUID(),
    };

    const subjectConsents = this.consents.get(subjectId) ?? [];
    subjectConsents.push(consent);
    this.consents.set(subjectId, subjectConsents);
    this.addAudit('consent_recorded', 'system', subjectId, { consentId: id, purpose });
    return consent;
  }

  withdrawConsent(subjectId: string, purpose: string): boolean {
    const subjectConsents = this.consents.get(subjectId) ?? [];
    let withdrawn = false;

    for (const consent of subjectConsents) {
      if (consent.purpose === purpose && consent.status === 'granted') {
        consent.status = 'withdrawn';
        consent.withdrawnAt = new Date().toISOString();
        withdrawn = true;
      }
    }

    if (withdrawn) {
      this.addAudit('consent_withdrawn', 'system', subjectId, { purpose });
    }
    return withdrawn;
  }

  checkConsent(subjectId: string, purpose: string): boolean {
    const subjectConsents = this.consents.get(subjectId) ?? [];
    const now = Date.now();
    return subjectConsents.some(
      c =>
        c.purpose === purpose &&
        c.status === 'granted' &&
        (!c.expiresAt || new Date(c.expiresAt).getTime() > now),
    );
  }

  getConsentHistory(subjectId: string): ConsentRecord[] {
    return this.consents.get(subjectId) ?? [];
  }

  // ─── Retention Policies ───────────────────────────────────────────────────

  addRetentionPolicy(
    dataCategory: string,
    retentionDays: number,
    action: RetentionAction,
    legalBasis: string,
  ): RetentionPolicy {
    const id = crypto.randomUUID();
    const policy: RetentionPolicy = {
      id,
      dataCategory,
      retentionDays,
      action,
      legalBasis,
      createdAt: new Date().toISOString(),
      active: true,
    };
    this.retentionPolicies.set(id, policy);
    this.addAudit('retention_policy_added', 'system', null, { policyId: id, dataCategory });
    return policy;
  }

  evaluateRetention(dataCategory: string, createdAt: string): RetentionAction | null {
    for (const policy of this.retentionPolicies.values()) {
      if (!policy.active || policy.dataCategory !== dataCategory) continue;
      const age = Date.now() - new Date(createdAt).getTime();
      if (age > policy.retentionDays * 86_400_000) {
        return policy.action;
      }
    }
    return null;
  }

  getExpiredData(dataCategory: string, records: Array<{ id: string; createdAt: string }>): string[] {
    return records
      .filter(r => this.evaluateRetention(dataCategory, r.createdAt) !== null)
      .map(r => r.id);
  }

  // ─── Processing Activity Records ─────────────────────────────────────────

  registerProcessingActivity(activity: Omit<DataProcessingActivity, 'id' | 'recordedAt'>): DataProcessingActivity {
    const id = crypto.randomUUID();
    const record: DataProcessingActivity = {
      ...activity,
      id,
      recordedAt: new Date().toISOString(),
    };
    this.processingActivities.set(id, record);
    this.addAudit('processing_activity_registered', 'system', null, { activityId: id, name: activity.name });
    return record;
  }

  listProcessingActivities(): DataProcessingActivity[] {
    return [...this.processingActivities.values()];
  }

  getActivitiesByLawfulBasis(basis: LawfulBasis): DataProcessingActivity[] {
    return [...this.processingActivities.values()].filter(a => a.lawfulBasis === basis);
  }

  // ─── Privacy Impact Assessment ────────────────────────────────────────────

  assessPrivacyImpact(activityId: string): PrivacyImpactScore | null {
    const activity = this.processingActivities.get(activityId);
    if (!activity) return null;

    const dataVolume = Math.min(activity.dataCategories.length / 5, 1) * 10;
    const dataSensitivity = this.scoreSensitivity(activity.dataCategories);
    const processingComplexity = Math.min(activity.recipients.length / 3, 1) * 10;
    const crossBorderRisk = this.scoreCrossBorder(activity.transferCountries);
    const automatedDecisionMaking = activity.dpiaConducted ? 3 : 8;

    const overall = (dataVolume + dataSensitivity + processingComplexity + crossBorderRisk + automatedDecisionMaking) / 5;

    const recommendations: string[] = [];
    if (dataSensitivity > 7) recommendations.push('Conduct full DPIA for sensitive data categories');
    if (crossBorderRisk > 5) recommendations.push('Review cross-border transfer safeguards');
    if (!activity.dpiaConducted) recommendations.push('Consider conducting a DPIA');
    if (activity.technicalMeasures.length < 2) recommendations.push('Implement additional technical safeguards');
    if (overall > 7) recommendations.push('Engage DPO for high-risk processing review');

    return {
      overall: Math.round(overall * 10) / 10,
      dataVolume: Math.round(dataVolume * 10) / 10,
      dataSensitivity: Math.round(dataSensitivity * 10) / 10,
      processingComplexity: Math.round(processingComplexity * 10) / 10,
      crossBorderRisk: Math.round(crossBorderRisk * 10) / 10,
      automatedDecisionMaking,
      recommendations,
    };
  }

  private scoreSensitivity(categories: string[]): number {
    const sensitiveTerms = ['health', 'biometric', 'genetic', 'racial', 'political', 'religious', 'sexual', 'criminal'];
    const matches = categories.filter(c => sensitiveTerms.some(t => c.toLowerCase().includes(t)));
    return matches.length > 0 ? Math.min(5 + matches.length * 2, 10) : 2;
  }

  private scoreCrossBorder(countries: string[]): number {
    if (countries.length === 0) return 0;
    const nonAdequate = countries.filter(c => !ADEQUATE_COUNTRIES.has(c.toUpperCase()));
    return nonAdequate.length === 0 ? 2 : Math.min(4 + nonAdequate.length * 2, 10);
  }

  // ─── Cross-Border Transfer Tracking ───────────────────────────────────────

  recordTransfer(
    sourceCountry: string,
    destinationCountry: string,
    dataCategories: string[],
    safeguard: CrossBorderTransfer['safeguard'],
  ): CrossBorderTransfer {
    const id = crypto.randomUUID();
    const isAdequate = ADEQUATE_COUNTRIES.has(destinationCountry.toUpperCase());
    const approved = isAdequate || safeguard !== 'none';

    const transfer: CrossBorderTransfer = {
      id,
      sourceCountry,
      destinationCountry,
      dataCategories,
      safeguard,
      approved,
      recordedAt: new Date().toISOString(),
    };

    this.transfers.set(id, transfer);
    this.addAudit('cross_border_transfer', 'system', null, {
      transferId: id,
      destination: destinationCountry,
      approved,
    });

    if (!approved) {
      this.log.warn('Unapproved cross-border transfer recorded', {
        transferId: id,
        destination: destinationCountry,
      });
    }
    return transfer;
  }

  listTransfers(): CrossBorderTransfer[] {
    return [...this.transfers.values()];
  }

  getUnapprovedTransfers(): CrossBorderTransfer[] {
    return [...this.transfers.values()].filter(t => !t.approved);
  }

  // ─── Data Subject Export (Portability) ────────────────────────────────────

  exportSubjectData(
    subjectId: string,
    dataCollector: (subjectId: string) => Record<string, unknown>,
  ): { format: string; data: Record<string, unknown>; exportedAt: string } {
    const data = dataCollector(subjectId);
    const consents = this.getConsentHistory(subjectId);
    const dsrs = this.listDSRsBySubject(subjectId);

    this.addAudit('data_export', 'system', subjectId, {
      fieldsExported: Object.keys(data).length,
    });

    return {
      format: 'application/json',
      data: {
        personalData: data,
        consents: consents.map(c => ({
          purpose: c.purpose,
          status: c.status,
          grantedAt: c.grantedAt,
          withdrawnAt: c.withdrawnAt,
        })),
        requests: dsrs.map(r => ({
          type: r.type,
          status: r.status,
          requestedAt: r.requestedAt,
        })),
        exportedAt: new Date().toISOString(),
      },
      exportedAt: new Date().toISOString(),
    };
  }

  // ─── Audit Trail ──────────────────────────────────────────────────────────

  private addAudit(
    action: string,
    actor: string,
    subjectId: string | null,
    details: Record<string, unknown>,
  ): void {
    this.auditLog.push({
      id: crypto.randomUUID(),
      action,
      actor,
      subjectId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  getAuditLog(filters?: {
    subjectId?: string;
    action?: string;
    since?: string;
  }): AuditEntry[] {
    let entries = this.auditLog;

    if (filters?.subjectId) {
      entries = entries.filter(e => e.subjectId === filters.subjectId);
    }
    if (filters?.action) {
      entries = entries.filter(e => e.action === filters.action);
    }
    if (filters?.since) {
      const since = new Date(filters.since).getTime();
      entries = entries.filter(e => new Date(e.timestamp).getTime() >= since);
    }

    return entries;
  }

  // ─── Compliance Dashboard ─────────────────────────────────────────────────

  getComplianceStatus(): {
    openDSRs: number;
    overdueDSRs: number;
    activeConsents: number;
    retentionPolicies: number;
    processingActivities: number;
    unapprovedTransfers: number;
    auditEntries: number;
  } {
    return {
      openDSRs: [...this.requests.values()].filter(
        r => r.status === 'pending' || r.status === 'in_progress',
      ).length,
      overdueDSRs: this.getOverdueDSRs().length,
      activeConsents: [...this.consents.values()]
        .flat()
        .filter(c => c.status === 'granted').length,
      retentionPolicies: [...this.retentionPolicies.values()].filter(p => p.active).length,
      processingActivities: this.processingActivities.size,
      unapprovedTransfers: this.getUnapprovedTransfers().length,
      auditEntries: this.auditLog.length,
    };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getGDPRComplianceEngine(): GDPRComplianceEngine {
  if (!globalThis.__gdprComplianceEngine__) {
    globalThis.__gdprComplianceEngine__ = new GDPRComplianceEngine();
  }
  return globalThis.__gdprComplianceEngine__ as GDPRComplianceEngine;
}
