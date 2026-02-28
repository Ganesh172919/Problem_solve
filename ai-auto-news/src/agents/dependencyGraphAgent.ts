/**
 * @module dependencyGraphAgent
 * @description Autonomous dependency graph management agent that continuously detects
 * circular dependencies, identifies critical path degradation, analyzes impact of
 * unhealthy services, flags deprecated edges approaching sunset, and generates
 * topology health reports for site reliability engineering teams.
 */

import { getLogger } from '../lib/logger';
import { getDependencyGraph } from '../lib/intelligentDependencyGraph';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  criticalPathRefreshIntervalMs?: number;
  sloRiskThreshold?: number;
}

class DependencyGraphAgent {
  private readonly graph = getDependencyGraph();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private criticalPathHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      criticalPathRefreshIntervalMs: config.criticalPathRefreshIntervalMs ?? 300_000,
      sloRiskThreshold: config.sloRiskThreshold ?? 0.3,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runHealthCheck(), this.config.pollIntervalMs);
    this.criticalPathHandle = setInterval(() => this.runCriticalPathAnalysis(), this.config.criticalPathRefreshIntervalMs);
    logger.info('DependencyGraphAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    if (this.criticalPathHandle) clearInterval(this.criticalPathHandle);
    this.isRunning = false;
    logger.info('DependencyGraphAgent stopped');
  }

  private runHealthCheck(): void {
    const summary = this.graph.getSummary();
    logger.info('Dependency graph health report', {
      totalNodes: summary.totalNodes,
      totalEdges: summary.totalEdges,
      criticalEdges: summary.criticalPathEdges,
      deprecatedEdges: summary.deprecatedEdges,
      avgHealth: `${summary.avgHealthScore}`,
      downServices: summary.downServices.length,
      circularDeps: summary.circularDependencies,
    });

    // Detect circular dependencies
    const circles = this.graph.detectCircularDependencies();
    for (const cycle of circles) {
      logger.error('Circular dependency detected', undefined, { cycle: cycle.cycle, severity: cycle.severity });
    }

    // Alert on down services
    if (summary.downServices.length > 0) {
      logger.warn('Services are DOWN — analyzing blast radius', { services: summary.downServices });
      for (const serviceId of summary.downServices.slice(0, 3)) {
        const impact = this.graph.analyzeImpact(serviceId);
        const critical = impact.filter(i => i.impactLevel === 'critical' || i.impactLevel === 'high');
        if (critical.length > 0) {
          logger.warn('High-impact blast radius', {
            downService: serviceId,
            affectedServices: critical.length,
            topAffected: critical.slice(0, 3).map(i => i.affectedServiceId),
          });
        }
      }
    }

    // Deprecated edge warnings
    const edges = this.graph.listEdges();
    const approaching = edges.filter(e => e.deprecated && e.deprecationDate && e.deprecationDate < Date.now() + 7 * 86400000);
    for (const edge of approaching) {
      logger.warn('Deprecated dependency edge approaching sunset', {
        edgeId: edge.id, src: edge.sourceId, dst: edge.targetId,
        deprecationDate: edge.deprecationDate ? new Date(edge.deprecationDate).toISOString() : 'unknown',
      });
    }
  }

  private runCriticalPathAnalysis(): void {
    const paths = this.graph.findCriticalPaths();
    const atRisk = paths.filter(p => p.sloRisk > this.config.sloRiskThreshold);
    if (atRisk.length > 0) {
      logger.warn('Critical paths at SLO risk', {
        count: atRisk.length,
        paths: atRisk.map(p => ({ id: p.id, nodes: p.nodes.length, weakestLink: p.weakestLink, sloRisk: p.sloRisk })),
      });
    } else {
      logger.debug('Critical path analysis completed', { paths: paths.length, atRisk: 0 });
    }
  }

  async run(): Promise<void> {
    this.runHealthCheck();
    this.runCriticalPathAnalysis();
  }
}

const KEY = '__dependencyGraphAgent__';
export function getDependencyGraphAgent(config?: AgentConfig): DependencyGraphAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new DependencyGraphAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as DependencyGraphAgent;
}
