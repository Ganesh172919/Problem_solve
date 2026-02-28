/**
 * @module onboardingAgent
 * @description Autonomous agent that monitors enterprise onboarding sessions,
 * detects stalled users, creates intervention records, notifies CSMs, and
 * triggers automated provisioning steps to accelerate time-to-value.
 */

import { getOnboardingEngine } from '../lib/enterpriseOnboardingEngine';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class OnboardingAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;
  private readonly stalledThresholdDays: number;

  constructor(checkIntervalMs = 30 * 60 * 1000, stalledThresholdDays = 3) {
    this.checkIntervalMs = checkIntervalMs;
    this.stalledThresholdDays = stalledThresholdDays;
  }

  start(): void {
    if (this.interval) return;
    logger.info('OnboardingAgent starting', { checkIntervalMs: this.checkIntervalMs, stalledThresholdDays: this.stalledThresholdDays });
    this.interval = setInterval(() => this._runCheck(), this.checkIntervalMs);
    this._runCheck();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('OnboardingAgent stopped');
    }
  }

  private _runCheck(): void {
    try {
      const engine = getOnboardingEngine();
      const interventions = engine.detectStalledSessions(this.stalledThresholdDays);
      if (interventions.length > 0) {
        logger.warn('Stalled onboarding sessions detected', { count: interventions.length });
      }
      const summary = engine.getSummary();
      logger.debug('Onboarding health check', { activeSessions: summary.activeSessions, stalledSessions: summary.stalledSessions, completionRate: summary.completionRatePct });
    } catch (err) {
      logger.error('OnboardingAgent check error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  triggerAutoProvisioning(sessionId: string, stepId: string): boolean {
    const engine = getOnboardingEngine();
    const success = engine.completeStep(sessionId, stepId, true);
    logger.info('Auto-provisioning triggered', { sessionId, stepId, success });
    return success;
  }
}

const KEY = '__onboardingAgent__';
export function getOnboardingAgent(): OnboardingAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new OnboardingAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as OnboardingAgent;
}
