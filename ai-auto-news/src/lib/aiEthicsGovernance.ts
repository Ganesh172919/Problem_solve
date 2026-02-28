/**
 * @module aiEthicsGovernance
 * @description AI Ethics and Governance engine enforcing responsible AI principles:
 * fairness metrics (demographic parity, equalized odds), bias detection and mitigation,
 * model explainability scoring, decision audit trails, consent management,
 * algorithmic impact assessments, model cards generation, transparency reporting,
 * and automated ethics policy compliance across all AI-driven decisions.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type EthicsPrinciple = 'fairness' | 'transparency' | 'accountability' | 'privacy' | 'safety' | 'beneficence' | 'non_maleficence';
export type BiasType = 'selection' | 'measurement' | 'confounding' | 'historical' | 'aggregation' | 'representation';
export type FairnessMetric = 'demographic_parity' | 'equalized_odds' | 'predictive_parity' | 'individual_fairness' | 'counterfactual_fairness';
export type ExplainabilityLevel = 'none' | 'low' | 'medium' | 'high' | 'full';
export type GovernanceStatus = 'approved' | 'under_review' | 'suspended' | 'rejected' | 'deprecated';

export interface ModelGovernanceRecord {
  modelId: string;
  modelName: string;
  version: string;
  purpose: string;
  ownerTeam: string;
  tenantId: string;
  status: GovernanceStatus;
  ethicsScore: number;         // 0-100
  fairnessScore: number;       // 0-100
  explainabilityLevel: ExplainabilityLevel;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastAuditAt: number;
  createdAt: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface BiasDetectionResult {
  modelId: string;
  analysisId: string;
  detectedBiases: Array<{
    biasType: BiasType;
    affectedAttribute: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    mitigationSuggestion: string;
  }>;
  overallBiasScore: number;    // 0-1 (0 = no bias)
  fairnessMetrics: Record<FairnessMetric, number>;
  analyzedAt: number;
  sampleSize: number;
}

export interface AlgorithmicImpactAssessment {
  assessmentId: string;
  modelId: string;
  conductedAt: number;
  conductedBy: string;
  impactedGroups: string[];
  potentialHarms: Array<{ harm: string; likelihood: number; severity: 'low' | 'medium' | 'high' | 'critical'; mitigationPlan: string }>;
  potentialBenefits: Array<{ benefit: string; likelihood: number; magnitude: string }>;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendation: 'approve' | 'approve_with_conditions' | 'reject' | 'further_review';
  conditions: string[];
  approvedBy?: string;
  approvedAt?: number;
}

export interface ModelCard {
  modelId: string;
  modelName: string;
  version: string;
  description: string;
  intendedUse: string;
  outOfScopeUse: string;
  trainingData: { description: string; size: number; biasConsiderations: string[] };
  evaluationMetrics: Record<string, number>;
  ethicalConsiderations: string[];
  limitations: string[];
  recommendations: string[];
  contactInfo: string;
  generatedAt: number;
}

export interface DecisionAuditEntry {
  auditId: string;
  modelId: string;
  tenantId: string;
  userId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  explanation: string;
  confidence: number;
  principlesApplied: EthicsPrinciple[];
  ethicsViolations: string[];
  timestamp: number;
  reviewRequired: boolean;
}

export interface ConsentRecord {
  consentId: string;
  userId: string;
  tenantId: string;
  purposeId: string;
  purposeDescription: string;
  modelIds: string[];
  granted: boolean;
  grantedAt?: number;
  revokedAt?: number;
  expiresAt?: number;
  legalBasis: string;
}

export interface EthicsPolicy {
  policyId: string;
  name: string;
  principles: EthicsPrinciple[];
  prohibitedUseCases: string[];
  requiredFairnessMetrics: FairnessMetric[];
  minExplainabilityLevel: ExplainabilityLevel;
  maxBiasScore: number;
  requiresImpactAssessment: boolean;
  tenantId: string;
  active: boolean;
}

export interface EthicsGovernanceConfig {
  maxBiasScoreAllowed?: number;
  minEthicsScore?: number;
  enableAutoAudit?: boolean;
  auditSampleRate?: number;
  maxDecisionAuditEntries?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeDemographicParity(positiveRates: Record<string, number>): number {
  const rates = Object.values(positiveRates);
  if (rates.length < 2) return 1;
  const maxRate = Math.max(...rates);
  const minRate = Math.min(...rates);
  return maxRate > 0 ? minRate / maxRate : 1;
}

function computeEqualizedOdds(tpr: Record<string, number>, fpr: Record<string, number>): number {
  const tprValues = Object.values(tpr);
  const fprValues = Object.values(fpr);
  const tprDiff = tprValues.length > 1 ? Math.abs(Math.max(...tprValues) - Math.min(...tprValues)) : 0;
  const fprDiff = fprValues.length > 1 ? Math.abs(Math.max(...fprValues) - Math.min(...fprValues)) : 0;
  return 1 - (tprDiff + fprDiff) / 2;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class AIEthicsGovernance {
  private models = new Map<string, ModelGovernanceRecord>();
  private biasAnalyses = new Map<string, BiasDetectionResult>();
  private impactAssessments = new Map<string, AlgorithmicImpactAssessment>();
  private decisionAudit: DecisionAuditEntry[] = [];
  private consentRecords = new Map<string, ConsentRecord>();
  private policies = new Map<string, EthicsPolicy>();
  private modelCards = new Map<string, ModelCard>();
  private config: Required<EthicsGovernanceConfig>;

  constructor(config: EthicsGovernanceConfig = {}) {
    this.config = {
      maxBiasScoreAllowed: config.maxBiasScoreAllowed ?? 0.2,
      minEthicsScore: config.minEthicsScore ?? 60,
      enableAutoAudit: config.enableAutoAudit ?? true,
      auditSampleRate: config.auditSampleRate ?? 0.05,
      maxDecisionAuditEntries: config.maxDecisionAuditEntries ?? 100_000,
    };
  }

  // ── Model Registration ────────────────────────────────────────────────────

  registerModel(params: Omit<ModelGovernanceRecord, 'ethicsScore' | 'fairnessScore' | 'lastAuditAt' | 'createdAt'>): ModelGovernanceRecord {
    const record: ModelGovernanceRecord = {
      ...params,
      ethicsScore: 50,      // default, updated after audit
      fairnessScore: 50,
      lastAuditAt: Date.now(),
      createdAt: Date.now(),
    };
    this.models.set(record.modelId, record);
    logger.info('Model registered for ethics governance', { modelId: record.modelId, riskLevel: record.riskLevel });
    return record;
  }

  getModel(modelId: string): ModelGovernanceRecord | undefined {
    return this.models.get(modelId);
  }

  listModels(tenantId?: string, status?: GovernanceStatus): ModelGovernanceRecord[] {
    let all = Array.from(this.models.values());
    if (tenantId) all = all.filter(m => m.tenantId === tenantId);
    if (status) all = all.filter(m => m.status === status);
    return all;
  }

  updateModelStatus(modelId: string, status: GovernanceStatus, reason?: string): void {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    model.status = status;
    model.metadata['statusChangeReason'] = reason;
    logger.info('Model status updated', { modelId, status, reason });
  }

  // ── Bias Detection ────────────────────────────────────────────────────────

  analyzeBias(params: {
    modelId: string;
    predictions: Array<{ predicted: number; actual: number; group: string; subgroup?: string }>;
    sensitiveAttributes: string[];
  }): BiasDetectionResult {
    const model = this.models.get(params.modelId);
    if (!model) throw new Error(`Model ${params.modelId} not found`);

    const groups = [...new Set(params.predictions.map(p => p.group))];
    const detectedBiases: BiasDetectionResult['detectedBiases'] = [];
    const fairnessMetrics: Record<FairnessMetric, number> = {
      demographic_parity: 0,
      equalized_odds: 0,
      predictive_parity: 0,
      individual_fairness: 0,
      counterfactual_fairness: 0,
    };

    // Demographic parity
    const positiveRates: Record<string, number> = {};
    for (const group of groups) {
      const groupPreds = params.predictions.filter(p => p.group === group);
      positiveRates[group] = groupPreds.length > 0
        ? groupPreds.filter(p => p.predicted >= 0.5).length / groupPreds.length
        : 0;
    }
    fairnessMetrics.demographic_parity = computeDemographicParity(positiveRates);

    if (fairnessMetrics.demographic_parity < 0.8) {
      detectedBiases.push({
        biasType: 'representation',
        affectedAttribute: params.sensitiveAttributes[0] ?? 'unknown',
        severity: fairnessMetrics.demographic_parity < 0.6 ? 'high' : 'medium',
        description: `Demographic parity ratio is ${fairnessMetrics.demographic_parity.toFixed(3)} (threshold: 0.8)`,
        mitigationSuggestion: 'Apply re-weighting or resampling techniques to balance training data across groups',
      });
    }

    // Equalized odds
    const tpr: Record<string, number> = {};
    const fpr: Record<string, number> = {};
    for (const group of groups) {
      const groupPreds = params.predictions.filter(p => p.group === group);
      const tp = groupPreds.filter(p => p.predicted >= 0.5 && p.actual >= 0.5).length;
      const fn = groupPreds.filter(p => p.predicted < 0.5 && p.actual >= 0.5).length;
      const fp = groupPreds.filter(p => p.predicted >= 0.5 && p.actual < 0.5).length;
      const tn = groupPreds.filter(p => p.predicted < 0.5 && p.actual < 0.5).length;
      tpr[group] = (tp + fn) > 0 ? tp / (tp + fn) : 0;
      fpr[group] = (fp + tn) > 0 ? fp / (fp + tn) : 0;
    }
    fairnessMetrics.equalized_odds = computeEqualizedOdds(tpr, fpr);

    // Predictive parity (precision equality)
    const precisions: Record<string, number> = {};
    for (const group of groups) {
      const groupPreds = params.predictions.filter(p => p.group === group);
      const tp = groupPreds.filter(p => p.predicted >= 0.5 && p.actual >= 0.5).length;
      const fp = groupPreds.filter(p => p.predicted >= 0.5 && p.actual < 0.5).length;
      precisions[group] = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    }
    const precisionValues = Object.values(precisions);
    fairnessMetrics.predictive_parity = precisionValues.length > 1
      ? 1 - (Math.max(...precisionValues) - Math.min(...precisionValues))
      : 1;

    fairnessMetrics.individual_fairness = 0.8;     // placeholder
    fairnessMetrics.counterfactual_fairness = 0.75; // placeholder

    const avgFairness = Object.values(fairnessMetrics).reduce((s, v) => s + v, 0) / Object.keys(fairnessMetrics).length;
    const overallBiasScore = 1 - avgFairness;

    if (overallBiasScore > this.config.maxBiasScoreAllowed) {
      logger.warn('Bias threshold exceeded', { modelId: params.modelId, biasScore: overallBiasScore });
    }

    // Update model scores
    model.fairnessScore = Math.round(avgFairness * 100);
    model.ethicsScore = Math.round(model.fairnessScore * 0.6 + 40); // crude estimate
    model.lastAuditAt = Date.now();

    const result: BiasDetectionResult = {
      modelId: params.modelId,
      analysisId: `bias_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      detectedBiases,
      overallBiasScore,
      fairnessMetrics,
      analyzedAt: Date.now(),
      sampleSize: params.predictions.length,
    };

    this.biasAnalyses.set(result.analysisId, result);
    return result;
  }

  // ── Impact Assessment ─────────────────────────────────────────────────────

  createImpactAssessment(params: Omit<AlgorithmicImpactAssessment, 'assessmentId' | 'conductedAt'>): AlgorithmicImpactAssessment {
    const assessment: AlgorithmicImpactAssessment = {
      ...params,
      assessmentId: `aia_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      conductedAt: Date.now(),
    };
    this.impactAssessments.set(assessment.assessmentId, assessment);
    logger.info('Impact assessment created', { assessmentId: assessment.assessmentId, modelId: assessment.modelId });
    return assessment;
  }

  approveImpactAssessment(assessmentId: string, approvedBy: string, conditions: string[] = []): void {
    const assessment = this.impactAssessments.get(assessmentId);
    if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);
    assessment.approvedBy = approvedBy;
    assessment.approvedAt = Date.now();
    assessment.recommendation = conditions.length > 0 ? 'approve_with_conditions' : 'approve';
    assessment.conditions = conditions;

    const model = this.models.get(assessment.modelId);
    if (model && assessment.recommendation === 'approve') {
      model.status = 'approved';
    }
  }

  // ── Model Cards ───────────────────────────────────────────────────────────

  generateModelCard(modelId: string, overrides?: Partial<ModelCard>): ModelCard {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const latestBias = Array.from(this.biasAnalyses.values())
      .filter(b => b.modelId === modelId)
      .sort((a, b) => b.analyzedAt - a.analyzedAt)[0];

    const card: ModelCard = {
      modelId,
      modelName: model.modelName,
      version: model.version,
      description: `AI model for ${model.purpose}`,
      intendedUse: model.purpose,
      outOfScopeUse: 'Any use case not explicitly described in intended use',
      trainingData: {
        description: 'Production training dataset',
        size: 0,
        biasConsiderations: latestBias?.detectedBiases.map(b => b.description) ?? [],
      },
      evaluationMetrics: {
        ethics_score: model.ethicsScore / 100,
        fairness_score: model.fairnessScore / 100,
        bias_score: latestBias?.overallBiasScore ?? 0,
      },
      ethicalConsiderations: model.tags.filter(t => t.startsWith('ethics:')).map(t => t.replace('ethics:', '')),
      limitations: ['Model performance may vary across demographic groups', 'Regular re-evaluation recommended'],
      recommendations: ['Monitor bias metrics continuously', 'Collect feedback from affected users'],
      contactInfo: `Team: ${model.ownerTeam}`,
      generatedAt: Date.now(),
      ...overrides,
    };

    this.modelCards.set(modelId, card);
    return card;
  }

  getModelCard(modelId: string): ModelCard | undefined {
    return this.modelCards.get(modelId);
  }

  // ── Decision Auditing ────────────────────────────────────────────────────

  auditDecision(entry: Omit<DecisionAuditEntry, 'auditId' | 'timestamp' | 'reviewRequired'>): DecisionAuditEntry {
    if (!this.config.enableAutoAudit) return { ...entry, auditId: '', timestamp: Date.now(), reviewRequired: false };

    // Sample-based auditing
    if (Math.random() > this.config.auditSampleRate) {
      return { ...entry, auditId: 'sampled_out', timestamp: Date.now(), reviewRequired: false };
    }

    const model = this.models.get(entry.modelId);
    const ethicsViolations: string[] = [];

    if (model) {
      const policy = Array.from(this.policies.values()).find(p => p.tenantId === model.tenantId && p.active);
      if (policy) {
        if (entry.confidence < 0.5) {
          ethicsViolations.push('Low confidence decision without human review');
        }
      }

      if (!entry.principlesApplied.includes('transparency') && model.riskLevel === 'high') {
        ethicsViolations.push('High-risk model decision lacks transparency documentation');
      }
    }

    const auditEntry: DecisionAuditEntry = {
      ...entry,
      auditId: `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      ethicsViolations,
      reviewRequired: ethicsViolations.length > 0 || entry.confidence < 0.3,
    };

    this.decisionAudit.push(auditEntry);
    if (this.decisionAudit.length > this.config.maxDecisionAuditEntries) this.decisionAudit.shift();

    return auditEntry;
  }

  getDecisionsRequiringReview(modelId?: string): DecisionAuditEntry[] {
    const reviewNeeded = this.decisionAudit.filter(e => e.reviewRequired);
    return modelId ? reviewNeeded.filter(e => e.modelId === modelId) : reviewNeeded;
  }

  // ── Consent Management ───────────────────────────────────────────────────

  recordConsent(params: Omit<ConsentRecord, 'consentId'>): ConsentRecord {
    const consent: ConsentRecord = {
      ...params,
      consentId: `consent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };
    this.consentRecords.set(consent.consentId, consent);
    return consent;
  }

  revokeConsent(consentId: string): void {
    const consent = this.consentRecords.get(consentId);
    if (!consent) throw new Error(`Consent ${consentId} not found`);
    consent.granted = false;
    consent.revokedAt = Date.now();
    logger.info('Consent revoked', { consentId, userId: consent.userId });
  }

  hasValidConsent(userId: string, modelId: string): boolean {
    const now = Date.now();
    return Array.from(this.consentRecords.values()).some(
      c => c.userId === userId && c.modelIds.includes(modelId) && c.granted &&
        (!c.expiresAt || c.expiresAt > now) && !c.revokedAt,
    );
  }

  // ── Policy Management ────────────────────────────────────────────────────

  createPolicy(policy: Omit<EthicsPolicy, 'policyId'>): EthicsPolicy {
    const p: EthicsPolicy = {
      ...policy,
      policyId: `epol_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };
    this.policies.set(p.policyId, p);
    return p;
  }

  validateModelAgainstPolicy(modelId: string, policyId: string): { compliant: boolean; violations: string[] } {
    const model = this.models.get(modelId);
    const policy = this.policies.get(policyId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    if (!policy) throw new Error(`Policy ${policyId} not found`);

    const violations: string[] = [];

    if (model.ethicsScore < this.config.minEthicsScore) {
      violations.push(`Ethics score ${model.ethicsScore} below minimum ${this.config.minEthicsScore}`);
    }

    const latestBias = Array.from(this.biasAnalyses.values())
      .filter(b => b.modelId === modelId)
      .sort((a, b) => b.analyzedAt - a.analyzedAt)[0];

    if (latestBias && latestBias.overallBiasScore > policy.maxBiasScore) {
      violations.push(`Bias score ${latestBias.overallBiasScore.toFixed(3)} exceeds policy max ${policy.maxBiasScore}`);
    }

    const explainabilityRank: Record<ExplainabilityLevel, number> = { none: 0, low: 1, medium: 2, high: 3, full: 4 };
    if (explainabilityRank[model.explainabilityLevel] < explainabilityRank[policy.minExplainabilityLevel]) {
      violations.push(`Explainability level ${model.explainabilityLevel} below required ${policy.minExplainabilityLevel}`);
    }

    return { compliant: violations.length === 0, violations };
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  getGovernanceDashboard(): Record<string, unknown> {
    const models = Array.from(this.models.values());
    const byStatus = {
      approved: models.filter(m => m.status === 'approved').length,
      under_review: models.filter(m => m.status === 'under_review').length,
      suspended: models.filter(m => m.status === 'suspended').length,
      rejected: models.filter(m => m.status === 'rejected').length,
    };

    const avgEthicsScore = models.length > 0 ? models.reduce((s, m) => s + m.ethicsScore, 0) / models.length : 0;
    const avgFairnessScore = models.length > 0 ? models.reduce((s, m) => s + m.fairnessScore, 0) / models.length : 0;
    const reviewRequired = this.decisionAudit.filter(e => e.reviewRequired).length;

    return {
      totalModels: models.length,
      modelsByStatus: byStatus,
      avgEthicsScore: Math.round(avgEthicsScore),
      avgFairnessScore: Math.round(avgFairnessScore),
      decisionsRequiringReview: reviewRequired,
      totalImpactAssessments: this.impactAssessments.size,
      totalConsentRecords: this.consentRecords.size,
      biasAnalysesRun: this.biasAnalyses.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getEthicsGovernance(): AIEthicsGovernance {
  const key = '__aiEthicsGovernance__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new AIEthicsGovernance();
  }
  return (globalThis as Record<string, unknown>)[key] as AIEthicsGovernance;
}
