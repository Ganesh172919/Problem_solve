/**
 * @module adaptiveSecurityPosture
 * @description Adaptive security posture management system implementing continuous
 * threat modeling, risk scoring, automated security controls adjustment, attack
 * surface mapping, vulnerability prioritization, zero-day response playbooks,
 * security baseline drift detection, and compliance posture scoring across tenants.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ControlStatus = 'active' | 'inactive' | 'degraded' | 'override';
export type VulnerabilitySeverity = 'informational' | 'low' | 'medium' | 'high' | 'critical';
export type SecurityPostureState = 'hardened' | 'standard' | 'degraded' | 'emergency';
export type AttackVector = 'network' | 'adjacent' | 'local' | 'physical';

export interface SecurityControl {
  controlId: string;
  name: string;
  category: 'authentication' | 'authorization' | 'encryption' | 'monitoring' | 'network' | 'data_protection' | 'incident_response';
  status: ControlStatus;
  effectivenessScore: number;   // 0-1
  lastTestedAt: number;
  tenantId?: string;
  config: Record<string, unknown>;
  automaticAdjustment: boolean;
}

export interface ThreatSignal {
  signalId: string;
  source: string;
  signalType: 'intrusion_attempt' | 'anomalous_behavior' | 'vulnerability_scan' | 'brute_force' | 'data_exfiltration' | 'privilege_escalation' | 'lateral_movement';
  severity: ThreatLevel;
  confidence: number;
  sourceIP?: string;
  targetResource?: string;
  tenantId?: string;
  timestamp: number;
  rawData: Record<string, unknown>;
}

export interface Vulnerability {
  vulnId: string;
  cveId?: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  attackVector: AttackVector;
  affectedComponents: string[];
  cvssScore: number;         // 0-10
  exploitabilityScore: number;
  patchAvailable: boolean;
  patchApplied: boolean;
  discoveredAt: number;
  patchDeadline?: number;
  tenantId?: string;
  status: 'open' | 'in_remediation' | 'patched' | 'accepted_risk' | 'false_positive';
}

export interface SecurityPosture {
  tenantId: string;
  overallRiskScore: number;       // 0-100 (higher = more risk)
  postureState: SecurityPostureState;
  threatLevel: ThreatLevel;
  activeControls: number;
  degradedControls: number;
  openVulnerabilities: number;
  criticalVulnerabilities: number;
  complianceScore: number;        // 0-100
  lastAssessedAt: number;
  trendDirection: 'improving' | 'stable' | 'deteriorating';
}

export interface ThreatModel {
  modelId: string;
  name: string;
  assetId: string;
  attackSurfaces: AttackSurface[];
  threatActors: ThreatActor[];
  likelyAttackVectors: AttackVector[];
  estimatedRisk: ThreatLevel;
  mitigations: string[];
  createdAt: number;
  lastUpdatedAt: number;
}

export interface AttackSurface {
  surfaceId: string;
  name: string;
  exposedEndpoints: number;
  publiclyAccessible: boolean;
  authRequired: boolean;
  encryptionEnabled: boolean;
  riskScore: number;  // 0-1
}

export interface ThreatActor {
  actorId: string;
  type: 'nation_state' | 'criminal' | 'insider' | 'hacktivist' | 'opportunistic';
  capability: 'low' | 'medium' | 'high' | 'advanced';
  motivation: string;
  targetedIndustries: string[];
}

export interface SecurityPlaybook {
  playbookId: string;
  name: string;
  triggerConditions: Array<{ field: string; operator: string; value: unknown }>;
  steps: Array<{ stepId: string; action: string; automated: boolean; timeoutMs: number; rollbackAction?: string }>;
  priority: number;
  enabled: boolean;
}

export interface PlaybookExecution {
  executionId: string;
  playbookId: string;
  triggeredBy: string;
  tenantId?: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  stepsCompleted: number;
  outcome?: string;
}

export interface AdaptiveSecurityConfig {
  autoAdjustControls?: boolean;
  threatLevelEscalationThreshold?: number;
  maxThreatHistorySize?: number;
  complianceFrameworks?: string[];
  emergencyLockdownEnabled?: boolean;
}

// ── Risk Scoring ──────────────────────────────────────────────────────────────

function computeRiskScore(
  openVulns: number,
  criticalVulns: number,
  degradedControls: number,
  recentThreats: number,
): number {
  const vulnScore = Math.min(40, openVulns * 2 + criticalVulns * 10);
  const controlScore = Math.min(30, degradedControls * 6);
  const threatScore = Math.min(30, recentThreats * 5);
  return Math.min(100, vulnScore + controlScore + threatScore);
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class AdaptiveSecurityPosture {
  private controls = new Map<string, SecurityControl>();
  private threats: ThreatSignal[] = [];
  private vulnerabilities = new Map<string, Vulnerability>();
  private postureMap = new Map<string, SecurityPosture>();
  private threatModels = new Map<string, ThreatModel>();
  private playbooks = new Map<string, SecurityPlaybook>();
  private playbookExecutions: PlaybookExecution[] = [];
  private config: Required<AdaptiveSecurityConfig>;

  constructor(config: AdaptiveSecurityConfig = {}) {
    this.config = {
      autoAdjustControls: config.autoAdjustControls ?? true,
      threatLevelEscalationThreshold: config.threatLevelEscalationThreshold ?? 3,
      maxThreatHistorySize: config.maxThreatHistorySize ?? 100_000,
      complianceFrameworks: config.complianceFrameworks ?? ['SOC2', 'ISO27001'],
      emergencyLockdownEnabled: config.emergencyLockdownEnabled ?? false,
    };
    this.initializeDefaultControls();
  }

  // ── Control Management ────────────────────────────────────────────────────

  registerControl(params: Omit<SecurityControl, 'controlId' | 'lastTestedAt'>): SecurityControl {
    const control: SecurityControl = {
      ...params,
      controlId: `ctrl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      lastTestedAt: Date.now(),
    };
    this.controls.set(control.controlId, control);
    return control;
  }

  getControl(controlId: string): SecurityControl | undefined {
    return this.controls.get(controlId);
  }

  listControls(tenantId?: string): SecurityControl[] {
    const all = Array.from(this.controls.values());
    return tenantId ? all.filter(c => !c.tenantId || c.tenantId === tenantId) : all;
  }

  adjustControl(controlId: string, status: ControlStatus, config?: Record<string, unknown>): void {
    const control = this.controls.get(controlId);
    if (!control) throw new Error(`Control ${controlId} not found`);
    const prevStatus = control.status;
    control.status = status;
    if (config) Object.assign(control.config, config);
    logger.info('Security control adjusted', { controlId, prevStatus, newStatus: status });
  }

  // ── Threat Management ────────────────────────────────────────────────────

  reportThreat(signal: ThreatSignal): void {
    this.threats.push(signal);
    if (this.threats.length > this.config.maxThreatHistorySize) this.threats.shift();

    if (this.config.autoAdjustControls) {
      this.autoAdjustForThreat(signal);
    }

    // Trigger relevant playbooks
    this.triggerMatchingPlaybooks(signal);

    // Update posture
    if (signal.tenantId) {
      this.updatePosture(signal.tenantId);
    }
  }

  getRecentThreats(tenantId?: string, limit = 100): ThreatSignal[] {
    const filtered = tenantId ? this.threats.filter(t => !t.tenantId || t.tenantId === tenantId) : this.threats;
    return filtered.slice(-limit);
  }

  getThreatLevel(tenantId?: string, windowMs = 60 * 60_000): ThreatLevel {
    const recent = this.threats.filter(t =>
      t.timestamp > Date.now() - windowMs &&
      (!tenantId || !t.tenantId || t.tenantId === tenantId),
    );

    const criticals = recent.filter(t => t.severity === 'critical').length;
    const highs = recent.filter(t => t.severity === 'high').length;

    if (criticals >= this.config.threatLevelEscalationThreshold) return 'critical';
    if (criticals > 0 || highs >= this.config.threatLevelEscalationThreshold) return 'high';
    if (highs > 0) return 'medium';
    if (recent.length > 0) return 'low';
    return 'none';
  }

  // ── Vulnerability Management ──────────────────────────────────────────────

  registerVulnerability(params: Omit<Vulnerability, 'vulnId' | 'discoveredAt' | 'status'>): Vulnerability {
    const vuln: Vulnerability = {
      ...params,
      vulnId: `vuln_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      discoveredAt: Date.now(),
      status: 'open',
    };
    this.vulnerabilities.set(vuln.vulnId, vuln);
    logger.warn('Vulnerability registered', { vulnId: vuln.vulnId, severity: vuln.severity, cvssScore: vuln.cvssScore });
    return vuln;
  }

  updateVulnerabilityStatus(vulnId: string, status: Vulnerability['status']): void {
    const vuln = this.vulnerabilities.get(vulnId);
    if (!vuln) throw new Error(`Vulnerability ${vulnId} not found`);
    const prev = vuln.status;
    vuln.status = status;
    if (status === 'patched') vuln.patchApplied = true;
    logger.info('Vulnerability status updated', { vulnId, prev, status });
  }

  prioritizeVulnerabilities(tenantId?: string): Vulnerability[] {
    let vulns = Array.from(this.vulnerabilities.values()).filter(v => v.status === 'open');
    if (tenantId) vulns = vulns.filter(v => !v.tenantId || v.tenantId === tenantId);

    return vulns.sort((a, b) => {
      // Priority: CVSS * exploitability * (patch available penalty)
      const scoreA = a.cvssScore * a.exploitabilityScore * (a.patchAvailable ? 1.5 : 1);
      const scoreB = b.cvssScore * b.exploitabilityScore * (b.patchAvailable ? 1.5 : 1);
      return scoreB - scoreA;
    });
  }

  // ── Posture Assessment ────────────────────────────────────────────────────

  assessPosture(tenantId: string): SecurityPosture {
    const controls = this.listControls(tenantId);
    const activeControls = controls.filter(c => c.status === 'active').length;
    const degradedControls = controls.filter(c => c.status === 'degraded' || c.status === 'inactive').length;

    const vulns = Array.from(this.vulnerabilities.values()).filter(v => !v.tenantId || v.tenantId === tenantId);
    const openVulns = vulns.filter(v => v.status === 'open').length;
    const criticalVulns = vulns.filter(v => v.status === 'open' && v.severity === 'critical').length;

    const recentThreats = this.getRecentThreats(tenantId, 100).length;
    const threatLevel = this.getThreatLevel(tenantId);

    const riskScore = computeRiskScore(openVulns, criticalVulns, degradedControls, recentThreats);
    const complianceScore = Math.max(0, 100 - riskScore * 0.7 - degradedControls * 3);

    let postureState: SecurityPostureState = 'standard';
    if (riskScore > 80) postureState = 'emergency';
    else if (riskScore > 60) postureState = 'degraded';
    else if (riskScore < 20) postureState = 'hardened';

    const existing = this.postureMap.get(tenantId);
    let trendDirection: SecurityPosture['trendDirection'] = 'stable';
    if (existing) {
      if (riskScore < existing.overallRiskScore - 5) trendDirection = 'improving';
      else if (riskScore > existing.overallRiskScore + 5) trendDirection = 'deteriorating';
    }

    const posture: SecurityPosture = {
      tenantId,
      overallRiskScore: riskScore,
      postureState,
      threatLevel,
      activeControls,
      degradedControls,
      openVulnerabilities: openVulns,
      criticalVulnerabilities: criticalVulns,
      complianceScore: Math.round(complianceScore),
      lastAssessedAt: Date.now(),
      trendDirection,
    };

    this.postureMap.set(tenantId, posture);
    return posture;
  }

  getPosture(tenantId: string): SecurityPosture | undefined {
    return this.postureMap.get(tenantId);
  }

  // ── Threat Modeling ───────────────────────────────────────────────────────

  createThreatModel(params: Omit<ThreatModel, 'modelId' | 'createdAt' | 'lastUpdatedAt'>): ThreatModel {
    const model: ThreatModel = {
      ...params,
      modelId: `tm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    this.threatModels.set(model.modelId, model);
    return model;
  }

  getThreatModel(modelId: string): ThreatModel | undefined {
    return this.threatModels.get(modelId);
  }

  // ── Playbooks ─────────────────────────────────────────────────────────────

  registerPlaybook(playbook: Omit<SecurityPlaybook, 'playbookId'>): SecurityPlaybook {
    const p: SecurityPlaybook = {
      ...playbook,
      playbookId: `pb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };
    this.playbooks.set(p.playbookId, p);
    return p;
  }

  async executePlaybook(playbookId: string, tenantId?: string, context: Record<string, unknown> = {}): Promise<PlaybookExecution> {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) throw new Error(`Playbook ${playbookId} not found`);
    if (!playbook.enabled) throw new Error(`Playbook ${playbookId} is disabled`);

    const execution: PlaybookExecution = {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      playbookId,
      triggeredBy: (context['triggeredBy'] as string) ?? 'manual',
      tenantId,
      startedAt: Date.now(),
      status: 'running',
      stepsCompleted: 0,
    };

    this.playbookExecutions.push(execution);

    // Execute automated steps
    for (const step of playbook.steps) {
      if (step.automated) {
        execution.stepsCompleted += 1;
        logger.info('Playbook step executed', { playbookId, stepId: step.stepId, action: step.action });
        // Simulate async step
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
    }

    execution.completedAt = Date.now();
    execution.status = 'completed';
    execution.outcome = `Completed ${execution.stepsCompleted}/${playbook.steps.length} steps`;

    return execution;
  }

  getPlaybookExecutions(playbookId?: string): PlaybookExecution[] {
    return playbookId ? this.playbookExecutions.filter(e => e.playbookId === playbookId) : this.playbookExecutions;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getSecurityDashboard(tenantId?: string): Record<string, unknown> {
    const posture = tenantId ? this.assessPosture(tenantId) : undefined;
    const openVulns = Array.from(this.vulnerabilities.values()).filter(v => v.status === 'open');
    const criticalVulns = openVulns.filter(v => v.severity === 'critical');
    const recentThreats = this.getRecentThreats(tenantId, 50);

    return {
      posture,
      totalControls: this.controls.size,
      activeControls: Array.from(this.controls.values()).filter(c => c.status === 'active').length,
      openVulnerabilities: openVulns.length,
      criticalVulnerabilities: criticalVulns.length,
      recentThreatCount: recentThreats.length,
      threatLevel: this.getThreatLevel(tenantId),
      playbooksAvailable: this.playbooks.size,
      recentExecutions: this.playbookExecutions.slice(-10),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private autoAdjustForThreat(signal: ThreatSignal): void {
    if (signal.severity === 'critical' || signal.severity === 'high') {
      // Enable additional monitoring controls
      for (const control of this.controls.values()) {
        if (control.category === 'monitoring' && control.status === 'inactive' && control.automaticAdjustment) {
          control.status = 'active';
          logger.info('Auto-enabled monitoring control due to threat', { controlId: control.controlId, threatSignalId: signal.signalId });
        }
      }
    }
  }

  private triggerMatchingPlaybooks(signal: ThreatSignal): void {
    for (const playbook of this.playbooks.values()) {
      if (!playbook.enabled) continue;
      const matches = playbook.triggerConditions.every(cond => {
        const val = (signal as Record<string, unknown>)[cond.field];
        if (cond.operator === 'equals') return val === cond.value;
        if (cond.operator === 'gte') return typeof val === 'number' && val >= (cond.value as number);
        if (cond.operator === 'includes') return typeof val === 'string' && val.includes(String(cond.value));
        return false;
      });

      if (matches) {
        void this.executePlaybook(playbook.playbookId, signal.tenantId, { triggeredBy: 'auto', signalId: signal.signalId });
      }
    }
  }

  private updatePosture(tenantId: string): void {
    this.assessPosture(tenantId);
  }

  private initializeDefaultControls(): void {
    const defaults: Omit<SecurityControl, 'controlId' | 'lastTestedAt'>[] = [
      { name: 'MFA Enforcement', category: 'authentication', status: 'active', effectivenessScore: 0.95, config: { required: true }, automaticAdjustment: false },
      { name: 'TLS 1.3 Encryption', category: 'encryption', status: 'active', effectivenessScore: 0.98, config: { minVersion: '1.3' }, automaticAdjustment: false },
      { name: 'Rate Limiting', category: 'network', status: 'active', effectivenessScore: 0.75, config: { requestsPerMinute: 100 }, automaticAdjustment: true },
      { name: 'Intrusion Detection', category: 'monitoring', status: 'active', effectivenessScore: 0.80, config: { sensitivity: 'high' }, automaticAdjustment: true },
      { name: 'Data Loss Prevention', category: 'data_protection', status: 'active', effectivenessScore: 0.85, config: { enabled: true }, automaticAdjustment: false },
    ];

    for (const def of defaults) {
      this.registerControl(def);
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getSecurityPosture(): AdaptiveSecurityPosture {
  const key = '__adaptiveSecurityPosture__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new AdaptiveSecurityPosture();
  }
  return (globalThis as Record<string, unknown>)[key] as AdaptiveSecurityPosture;
}
