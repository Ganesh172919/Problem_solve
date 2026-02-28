/**
 * @module enterpriseOnboardingEngine
 * @description Intelligent enterprise customer onboarding engine with guided setup
 * workflows, milestone-based progress tracking, in-app checklist management, automated
 * provisioning step orchestration, role-based onboarding paths (admin/developer/end-user),
 * integration health checks, time-to-value measurement, onboarding analytics, CSM
 * assignment and handoff, stalled onboarding detection with intervention triggers, and
 * enterprise SSO/SCIM setup automation for accelerating enterprise customer activation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type OnboardingRole = 'admin' | 'developer' | 'end_user' | 'manager' | 'security_officer';
export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'blocked';
export type OnboardingStatus = 'not_started' | 'in_progress' | 'stalled' | 'completed' | 'abandoned';
export type IntegrationHealth = 'not_configured' | 'connected' | 'degraded' | 'failed';

export interface OnboardingTemplate {
  id: string;
  name: string;
  roles: OnboardingRole[];
  steps: OnboardingStep[];
  estimatedDurationDays: number;
  isEnterprise: boolean;
  ssoRequired: boolean;
  scimEnabled: boolean;
  createdAt: number;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  role: OnboardingRole;
  order: number;
  isRequired: boolean;
  isBlocking: boolean;          // subsequent steps can't proceed
  dependsOn: string[];          // step IDs
  estimatedMinutes: number;
  actionUrl?: string;
  completionCriteria: string;
}

export interface OnboardingSession {
  id: string;
  tenantId: string;
  templateId: string;
  userId: string;
  role: OnboardingRole;
  status: OnboardingStatus;
  currentStepId?: string;
  completedStepIds: string[];
  skippedStepIds: string[];
  progressPct: number;
  stalledAt?: number;
  lastActivityAt: number;
  csmId?: string;               // Customer Success Manager
  integrationHealth: Record<string, IntegrationHealth>;
  timeToFirstValueMs?: number;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

export interface ProvisioningResult {
  step: string;
  success: boolean;
  details: Record<string, unknown>;
  completedAt: number;
}

export interface OnboardingIntervention {
  id: string;
  sessionId: string;
  tenantId: string;
  triggerReason: 'stalled' | 'blocked' | 'help_requested' | 'integration_failed';
  stalledDays: number;
  suggestedAction: string;
  csmNotified: boolean;
  createdAt: number;
  resolvedAt?: number;
}

export interface OnboardingSummary {
  totalSessions: number;        // all time
  activeSessions: number;
  stalledSessions: number;
  completedSessions: number;
  avgProgressPct: number;
  avgTimeToValueDays: number;
  completionRatePct: number;
  pendingInterventions: number;
}

// ── Engine ────────────────────────────────────────────────────────────────────

class EnterpriseOnboardingEngine {
  private readonly templates = new Map<string, OnboardingTemplate>();
  private readonly sessions = new Map<string, OnboardingSession>();
  private readonly provisioningLog = new Map<string, ProvisioningResult[]>();
  private readonly interventions: OnboardingIntervention[] = [];

  registerTemplate(template: OnboardingTemplate): void {
    this.templates.set(template.id, { ...template });
    logger.info('Onboarding template registered', { templateId: template.id, name: template.name, steps: template.steps.length });
  }

  startOnboarding(params: { sessionId: string; tenantId: string; templateId: string; userId: string; role: OnboardingRole; csmId?: string }): OnboardingSession {
    const template = this.templates.get(params.templateId);
    if (!template) throw new Error(`Template ${params.templateId} not found`);
    const roleSteps = template.steps.filter(s => s.role === params.role).sort((a, b) => a.order - b.order);

    const session: OnboardingSession = {
      id: params.sessionId, tenantId: params.tenantId, templateId: params.templateId,
      userId: params.userId, role: params.role, status: 'in_progress',
      currentStepId: roleSteps[0]?.id, completedStepIds: [], skippedStepIds: [],
      progressPct: 0, lastActivityAt: Date.now(), csmId: params.csmId,
      integrationHealth: {}, startedAt: Date.now(), updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    this.provisioningLog.set(session.id, []);
    logger.info('Onboarding started', { sessionId: session.id, tenantId: params.tenantId, role: params.role });
    return session;
  }

  completeStep(sessionId: string, stepId: string, autoProvision = false): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    const template = this.templates.get(session.templateId);
    if (!template) return false;

    const step = template.steps.find(s => s.id === stepId);
    if (!step) return false;

    // Check dependencies
    if (step.dependsOn.some(depId => !session.completedStepIds.includes(depId))) {
      logger.warn('Step dependencies not met', { sessionId, stepId, dependsOn: step.dependsOn });
      return false;
    }

    if (!session.completedStepIds.includes(stepId)) {
      session.completedStepIds.push(stepId);
    }
    session.lastActivityAt = Date.now();

    // Auto-provision if applicable
    if (autoProvision) {
      const provResult: ProvisioningResult = {
        step: stepId, success: true,
        details: { automated: true, timestamp: Date.now() },
        completedAt: Date.now(),
      };
      this.provisioningLog.get(sessionId)?.push(provResult);
    }

    // Advance to next step
    const roleSteps = template.steps.filter(s => s.role === session.role).sort((a, b) => a.order - b.order);
    const nextStep = roleSteps.find(s => !session.completedStepIds.includes(s.id) && !session.skippedStepIds.includes(s.id));
    session.currentStepId = nextStep?.id;

    // Recompute progress
    const requiredSteps = roleSteps.filter(s => s.isRequired);
    const completedRequired = requiredSteps.filter(s => session.completedStepIds.includes(s.id));
    session.progressPct = requiredSteps.length > 0
      ? parseFloat((completedRequired.length / requiredSteps.length * 100).toFixed(1))
      : 100;

    // Check for time-to-value milestone (first required step of developer role)
    if (!session.timeToFirstValueMs && step.role === 'developer' && step.order === 1) {
      session.timeToFirstValueMs = Date.now() - session.startedAt;
    }

    // Check completion
    if (!nextStep) {
      session.status = 'completed';
      session.completedAt = Date.now();
      session.progressPct = 100;
      logger.info('Onboarding completed', { sessionId, durationMs: Date.now() - session.startedAt, progressPct: 100 });
    }
    session.updatedAt = Date.now();
    return true;
  }

  skipStep(sessionId: string, stepId: string, reason: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    const template = this.templates.get(session.templateId);
    const step = template?.steps.find(s => s.id === stepId);
    if (!step || step.isBlocking) return false;
    if (!session.skippedStepIds.includes(stepId)) session.skippedStepIds.push(stepId);
    session.updatedAt = Date.now();
    session.lastActivityAt = Date.now();
    logger.info('Onboarding step skipped', { sessionId, stepId, reason });
    return true;
  }

  updateIntegrationHealth(sessionId: string, integrationName: string, health: IntegrationHealth): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.integrationHealth[integrationName] = health;
    if (health === 'failed') {
      this._createIntervention(session, 'integration_failed');
    }
    session.updatedAt = Date.now();
  }

  detectStalledSessions(stalledThresholdDays = 3): OnboardingIntervention[] {
    const newInterventions: OnboardingIntervention[] = [];
    const threshold = stalledThresholdDays * 86400000;
    for (const session of this.sessions.values()) {
      if (session.status !== 'in_progress') continue;
      const inactiveDuration = Date.now() - session.lastActivityAt;
      if (inactiveDuration >= threshold) {
        session.status = 'stalled';
        session.stalledAt = Date.now();
        session.updatedAt = Date.now();
        const intervention = this._createIntervention(session, 'stalled');
        newInterventions.push(intervention);
        logger.warn('Onboarding session stalled', { sessionId: session.id, stalledDays: stalledThresholdDays });
      }
    }
    return newInterventions;
  }

  resolveIntervention(interventionId: string): boolean {
    const intervention = this.interventions.find(i => i.id === interventionId);
    if (!intervention) return false;
    intervention.resolvedAt = Date.now();
    const session = this.sessions.get(intervention.sessionId);
    if (session && session.status === 'stalled') {
      session.status = 'in_progress';
      session.updatedAt = Date.now();
    }
    return true;
  }

  getSession(sessionId: string): OnboardingSession | undefined {
    return this.sessions.get(sessionId);
  }

  getProvisioningLog(sessionId: string): ProvisioningResult[] {
    return this.provisioningLog.get(sessionId) ?? [];
  }

  listSessions(tenantId?: string, status?: OnboardingStatus): OnboardingSession[] {
    let all = Array.from(this.sessions.values());
    if (tenantId) all = all.filter(s => s.tenantId === tenantId);
    if (status) all = all.filter(s => s.status === status);
    return all;
  }

  listInterventions(resolved?: boolean): OnboardingIntervention[] {
    return resolved === undefined ? [...this.interventions]
      : this.interventions.filter(i => resolved ? i.resolvedAt !== undefined : i.resolvedAt === undefined);
  }

  listTemplates(): OnboardingTemplate[] {
    return Array.from(this.templates.values());
  }

  getSummary(): OnboardingSummary {
    const sessions = Array.from(this.sessions.values());
    const active = sessions.filter(s => s.status === 'in_progress');
    const stalled = sessions.filter(s => s.status === 'stalled');
    const completed = sessions.filter(s => s.status === 'completed');
    const avgProgress = active.length > 0 ? active.reduce((s, sess) => s + sess.progressPct, 0) / active.length : 0;
    const ttvValues = completed.filter(s => s.timeToFirstValueMs).map(s => s.timeToFirstValueMs! / 86400000);
    const avgTtv = ttvValues.length > 0 ? ttvValues.reduce((a, b) => a + b, 0) / ttvValues.length : 0;
    const completionRate = sessions.length > 0 ? (completed.length / sessions.length) * 100 : 0;
    return {
      totalSessions: sessions.length,
      activeSessions: active.length,
      stalledSessions: stalled.length,
      completedSessions: completed.length,
      avgProgressPct: parseFloat(avgProgress.toFixed(1)),
      avgTimeToValueDays: parseFloat(avgTtv.toFixed(1)),
      completionRatePct: parseFloat(completionRate.toFixed(1)),
      pendingInterventions: this.interventions.filter(i => !i.resolvedAt).length,
    };
  }

  private _createIntervention(session: OnboardingSession, reason: OnboardingIntervention['triggerReason']): OnboardingIntervention {
    const stalledDays = session.stalledAt ? (Date.now() - session.stalledAt) / 86400000 : 0;
    const intervention: OnboardingIntervention = {
      id: `int-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      sessionId: session.id, tenantId: session.tenantId, triggerReason: reason,
      stalledDays: parseFloat(stalledDays.toFixed(1)),
      suggestedAction: reason === 'stalled' ? 'schedule_csm_call' : reason === 'integration_failed' ? 'open_support_ticket' : 'send_help_email',
      csmNotified: !!session.csmId,
      createdAt: Date.now(),
    };
    this.interventions.push(intervention);
    if (this.interventions.length > 10000) this.interventions.shift();
    return intervention;
  }
}

const KEY = '__enterpriseOnboardingEngine__';
export function getOnboardingEngine(): EnterpriseOnboardingEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new EnterpriseOnboardingEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as EnterpriseOnboardingEngine;
}
