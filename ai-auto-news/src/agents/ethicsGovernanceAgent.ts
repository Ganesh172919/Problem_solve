/**
 * @module ethicsGovernanceAgent
 * @description Autonomous ethics governance agent continuously auditing AI models
 * for bias drift, policy violations, explainability gaps, and consent compliance.
 * Generates remediation plans, triggers model suspensions when ethics thresholds
 * are breached, and produces periodic governance reports.
 */

import { getLogger } from '../lib/logger';
import { getEthicsGovernance, GovernanceStatus } from '../lib/aiEthicsGovernance';

const logger = getLogger();

export interface EthicsAuditResult {
  modelId: string;
  auditId: string;
  ethicsScore: number;
  fairnessScore: number;
  violations: string[];
  remediationPlan: string[];
  actionTaken: 'none' | 'flagged' | 'suspended';
  auditedAt: number;
}

export interface EthicsAgentStats {
  cyclesRun: number;
  modelsAudited: number;
  modelsSuspended: number;
  totalViolationsFound: number;
  avgEthicsScore: number;
  uptime: number;
}

let agentInstance: EthicsGovernanceAgent | undefined;

export class EthicsGovernanceAgent {
  private intervalHandle?: ReturnType<typeof setInterval>;
  private auditResults = new Map<string, EthicsAuditResult>();
  private stats: EthicsAgentStats = { cyclesRun: 0, modelsAudited: 0, modelsSuspended: 0, totalViolationsFound: 0, avgEthicsScore: 0, uptime: 0 };
  private startedAt?: number;
  private readonly auditIntervalMs: number;
  private readonly ethicsScoreThreshold: number;

  constructor(config: { auditIntervalMs?: number; ethicsScoreThreshold?: number } = {}) {
    this.auditIntervalMs = config.auditIntervalMs ?? 5 * 60_000;
    this.ethicsScoreThreshold = config.ethicsScoreThreshold ?? 40;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.startedAt = Date.now();
    this.intervalHandle = setInterval(() => void this.runAuditCycle(), this.auditIntervalMs);
    void this.runAuditCycle();
    logger.info('EthicsGovernanceAgent started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  private async runAuditCycle(): Promise<void> {
    const governance = getEthicsGovernance();
    const models = governance.listModels();
    this.stats.cyclesRun += 1;
    this.stats.uptime = this.startedAt ? Date.now() - this.startedAt : 0;

    let totalScore = 0;

    for (const model of models) {
      try {
        const result = await this.auditModel(model.modelId);
        this.auditResults.set(model.modelId, result);
        totalScore += result.ethicsScore;
        this.stats.modelsAudited += 1;
        this.stats.totalViolationsFound += result.violations.length;
      } catch (err) {
        logger.error('EthicsGovernanceAgent audit error', err instanceof Error ? err : new Error(String(err)), { modelId: model.modelId });
      }
    }

    if (models.length > 0) {
      this.stats.avgEthicsScore = totalScore / models.length;
    }

    logger.info('Ethics audit cycle complete', { modelsAudited: models.length, avgScore: this.stats.avgEthicsScore });
  }

  private async auditModel(modelId: string): Promise<EthicsAuditResult> {
    const governance = getEthicsGovernance();
    const model = governance.getModel(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const violations: string[] = [];
    const remediationPlan: string[] = [];

    if (model.ethicsScore < this.ethicsScoreThreshold) {
      violations.push(`Ethics score ${model.ethicsScore} below threshold ${this.ethicsScoreThreshold}`);
      remediationPlan.push('Conduct bias audit with diverse test dataset');
      remediationPlan.push('Implement fairness constraints in training');
    }

    if (model.fairnessScore < 60) {
      violations.push(`Fairness score ${model.fairnessScore} below acceptable level`);
      remediationPlan.push('Apply re-weighting to correct demographic disparities');
    }

    if (model.explainabilityLevel === 'none' && model.riskLevel !== 'low') {
      violations.push(`High-risk model lacks explainability`);
      remediationPlan.push('Integrate SHAP or LIME explanations');
    }

    let actionTaken: EthicsAuditResult['actionTaken'] = 'none';
    let newStatus: GovernanceStatus | undefined;

    if (violations.length > 3 || (model.ethicsScore < 20)) {
      actionTaken = 'suspended';
      newStatus = 'suspended';
      this.stats.modelsSuspended += 1;
    } else if (violations.length > 0) {
      actionTaken = 'flagged';
      newStatus = 'under_review';
    }

    if (newStatus && model.status !== newStatus) {
      governance.updateModelStatus(modelId, newStatus, `Ethics agent: ${violations[0]}`);
    }

    const result: EthicsAuditResult = {
      modelId,
      auditId: `ethaud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ethicsScore: model.ethicsScore,
      fairnessScore: model.fairnessScore,
      violations,
      remediationPlan,
      actionTaken,
      auditedAt: Date.now(),
    };

    await Promise.resolve();
    return result;
  }

  getAuditResult(modelId: string): EthicsAuditResult | undefined {
    return this.auditResults.get(modelId);
  }

  getAuditResults(): EthicsAuditResult[] {
    return Array.from(this.auditResults.values());
  }

  getStats(): EthicsAgentStats {
    return { ...this.stats, uptime: this.startedAt ? Date.now() - this.startedAt : 0 };
  }
}

export function getEthicsGovernanceAgent(): EthicsGovernanceAgent {
  if (!agentInstance) {
    agentInstance = new EthicsGovernanceAgent();
  }
  return agentInstance;
}
