/**
 * @module serviceGraphAgent
 * @description Autonomous service graph analysis and optimization agent that
 * continuously discovers dependencies, detects architectural issues, generates
 * service mesh policies, computes blast radii, and recommends topology improvements
 * for microservices environments.
 */

import { getLogger } from '../lib/logger';
import { getServiceGraph } from '../lib/serviceGraphAnalyzer';

const logger = getLogger();

interface AgentConfig {
  checkIntervalMs?: number;
  autoGeneratePolicies?: boolean;
  targetTenantId?: string;
}

class ServiceGraphAgent {
  private readonly graph = getServiceGraph();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<AgentConfig>;
  private isRunning = false;

  constructor(config: AgentConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 120_000,
      autoGeneratePolicies: config.autoGeneratePolicies ?? true,
      targetTenantId: config.targetTenantId ?? '',
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.checkIntervalMs);
    logger.info('ServiceGraphAgent started', { checkIntervalMs: this.config.checkIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('ServiceGraphAgent stopped');
  }

  async run(): Promise<void> {
    try {
      await this.analyzeTopology();
      await this.refreshBlastRadii();
      await this.generateMeshPolicies();
      this.logHealthSummary();
    } catch (err) {
      logger.error('ServiceGraphAgent cycle error', err as Error);
    }
  }

  private async analyzeTopology(): Promise<void> {
    const tenantId = this.config.targetTenantId;
    if (!tenantId) return;

    const issues = this.graph.detectAllIssues(tenantId);
    const critical = issues.filter(i => i.severity === 'critical');
    const high = issues.filter(i => i.severity === 'high');

    if (critical.length > 0) {
      logger.error('ServiceGraphAgent: Critical topology issues detected', undefined, {
        tenantId,
        criticalCount: critical.length,
        issues: critical.map(i => ({ type: i.type, services: i.affectedServiceIds })),
      });
    }
    if (high.length > 0) {
      logger.warn('ServiceGraphAgent: High-severity topology issues detected', {
        tenantId,
        highCount: high.length,
      });
    }

    // Find and log critical path
    const criticalPath = this.graph.findCriticalPath();
    if (criticalPath && criticalPath.slaRisk > 0.6) {
      logger.warn('ServiceGraphAgent: High-risk critical path identified', {
        pathLength: criticalPath.nodes.length,
        totalLatencyMs: criticalPath.totalLatencyMs,
        weakestLink: criticalPath.weakestLink,
        slaRisk: criticalPath.slaRisk,
      });
    }
  }

  private async refreshBlastRadii(): Promise<void> {
    const services = this.graph.listServices(this.config.targetTenantId || undefined);
    for (const service of services.slice(0, 20)) {
      try {
        const radius = this.graph.computeBlastRadius(service.id);
        if (radius.slaRisk === 'critical') {
          logger.warn('ServiceGraphAgent: Critical blast radius', {
            serviceId: service.id,
            name: service.name,
            directDependents: radius.directDependents.length,
            transitiveDependents: radius.transitiveDependents.length,
            revenueImpact: radius.estimatedRevenueImpactUsdPerMin,
          });
        }
      } catch { /* non-fatal */ }
    }
  }

  private async generateMeshPolicies(): Promise<void> {
    if (!this.config.autoGeneratePolicies) return;
    const services = this.graph.listServices(this.config.targetTenantId || undefined);
    for (const service of services) {
      try {
        this.graph.generateMeshPolicy(service.id);
      } catch { /* non-fatal */ }
    }
    if (services.length > 0) {
      logger.info('ServiceGraphAgent: Mesh policies refreshed', { count: services.length });
    }
  }

  private logHealthSummary(): void {
    const summary = this.graph.getDashboardSummary();
    logger.info('ServiceGraphAgent health summary', {
      totalServices: summary.totalServices,
      healthyServices: summary.healthyServices,
      downServices: summary.downServices,
      openIssues: summary.openIssues,
      criticalIssues: summary.criticalIssues,
      missingFallbacks: summary.missingFallbacks,
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      graphSummary: this.graph.getDashboardSummary(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _agent: ServiceGraphAgent | null = null;

export function getServiceGraphAgent(config?: AgentConfig): ServiceGraphAgent {
  if (!_agent) _agent = new ServiceGraphAgent(config);
  return _agent;
}

export { ServiceGraphAgent };
