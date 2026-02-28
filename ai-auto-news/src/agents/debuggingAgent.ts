/**
 * @module debuggingAgent
 * @description Autonomous debugging agent that continuously monitors error streams,
 * opens debugging sessions for critical issues, applies auto-remediatable fixes,
 * escalates unresolvable issues, and produces periodic debugging health reports.
 */

import { getLogger } from '../lib/logger';
import { getDebuggingEngine, type ErrorSeverity } from '../lib/autonomousDebuggingEngine';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  autoFixEnabled?: boolean;
  autoEscalateAfterMs?: number;
  maxOpenSessions?: number;
  targetTenantId?: string;
}

class DebuggingAgent {
  private readonly engine = getDebuggingEngine();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<AgentConfig>;
  private isRunning = false;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 30_000,
      autoFixEnabled: config.autoFixEnabled ?? true,
      autoEscalateAfterMs: config.autoEscalateAfterMs ?? 300_000,
      maxOpenSessions: config.maxOpenSessions ?? 50,
      targetTenantId: config.targetTenantId ?? '',
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.pollIntervalMs);
    logger.info('DebuggingAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('DebuggingAgent stopped');
  }

  async run(): Promise<void> {
    try {
      await this.triageNewErrors();
      await this.processOpenSessions();
      await this.escalateStuckSessions();
      this.logHealthSummary();
    } catch (err) {
      logger.error('DebuggingAgent cycle error', err as Error);
    }
  }

  private async triageNewErrors(): Promise<void> {
    const severities: ErrorSeverity[] = ['critical', 'high'];
    const openSessions = this.engine.listSessions(this.config.targetTenantId || undefined, 'active');

    for (const severity of severities) {
      const errors = this.engine.listErrors(this.config.targetTenantId || undefined, severity);
      for (const error of errors.slice(0, 10)) {
        const alreadyOpen = openSessions.some(s => s.errorId === error.id);
        if (alreadyOpen) continue;
        if (openSessions.length >= this.config.maxOpenSessions) break;

        const session = this.engine.openSession(error.id, error.tenantId, 'debugging-agent');
        logger.info('Auto-opened debugging session', { sessionId: session.id, errorId: error.id, severity });
      }
    }
  }

  private async processOpenSessions(): Promise<void> {
    if (!this.config.autoFixEnabled) return;
    const sessions = this.engine.listSessions(this.config.targetTenantId || undefined, 'active');

    for (const session of sessions) {
      const autoFixes = session.fixSuggestions.filter(f =>
        !session.appliedFixes.includes(f.id) && f.confidenceScore >= 0.75
      );

      for (const fix of autoFixes.slice(0, 1)) {
        try {
          this.engine.applyFix(session.id, fix.id, 'debugging-agent');
          logger.info('Auto-applied fix', { sessionId: session.id, fixId: fix.id, confidence: fix.confidenceScore });

          // Auto-resolve if high-confidence fix applied
          if (fix.confidenceScore >= 0.9) {
            this.engine.resolveSession(session.id, `Auto-resolved by debugging agent: ${fix.title}`, 'debugging-agent');
          }
        } catch (err) {
          logger.warn('Failed to apply fix', { sessionId: session.id, fixId: fix.id, error: String(err) });
        }
      }
    }
  }

  private async escalateStuckSessions(): Promise<void> {
    const sessions = this.engine.listSessions(this.config.targetTenantId || undefined, 'active');
    const now = Date.now();

    for (const session of sessions) {
      const age = now - session.startedAt;
      if (age > this.config.autoEscalateAfterMs && session.appliedFixes.length === 0) {
        this.engine.escalateSession(session.id, `Session open ${Math.floor(age / 60_000)} minutes with no fix applied`, 'oncall-team');
        logger.warn('Session escalated', { sessionId: session.id, ageMinutes: Math.floor(age / 60_000) });
      }
    }
  }

  private logHealthSummary(): void {
    const summary = this.engine.getDashboardSummary();
    logger.info('DebuggingAgent health summary', {
      openSessions: summary.openSessions,
      resolvedSessions: summary.resolvedSessions,
      escalatedSessions: summary.escalatedSessions,
      criticalErrors: summary.criticalErrors,
      highErrors: summary.highErrors,
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      engineSummary: this.engine.getDashboardSummary(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _agent: DebuggingAgent | null = null;

export function getDebuggingAgent(config?: AgentConfig): DebuggingAgent {
  if (!_agent) _agent = new DebuggingAgent(config);
  return _agent;
}

export { DebuggingAgent };
