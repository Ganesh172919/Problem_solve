/**
 * @module pluginManagementAgent
 * @description Autonomous plugin management agent that continuously monitors
 * plugin health, checks for available updates, and produces ecosystem health
 * reports across all installed plugins.
 */

import { getLogger } from '../lib/logger';
import { getPluginMarketplaceEngine } from '../lib/pluginMarketplaceEngine';

const logger = getLogger();

interface AgentConfig {
  monitoringIntervalMs?: number;
}

class PluginManagementAgent {
  private readonly engine = getPluginMarketplaceEngine();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;
  private cycleCount = 0;

  constructor(config: AgentConfig = {}) {
    this.config = {
      monitoringIntervalMs: config.monitoringIntervalMs ?? 60_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.tick(), this.config.monitoringIntervalMs);
    logger.info('PluginManagementAgent started', { monitoringIntervalMs: this.config.monitoringIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.isRunning = false;
    logger.info('PluginManagementAgent stopped');
  }

  private async tick(): Promise<void> {
    try {
      this.monitorHealth();
      this.autoUpdatePlugins();
      this.cycleCount++;
    } catch (err) {
      logger.error('PluginManagementAgent cycle error', err as Error);
    }
  }

  monitorHealth(): void {
    const stats = this.engine.getMarketplaceStats();
    const allPlugins = this.engine.searchPlugins({ keyword: '' });

    let unhealthyCount = 0;
    for (const plugin of allPlugins.plugins) {
      const validation = this.engine.validatePlugin(plugin.id);
      if (!validation.valid) {
        unhealthyCount++;
        logger.warn('Unhealthy plugin detected', { pluginId: plugin.id, errors: validation.errors.length });
      }
    }

    logger.info('Plugin health check complete', {
      totalPlugins: stats.totalPlugins,
      unhealthy: unhealthyCount,
    });
  }

  autoUpdatePlugins(): void {
    const stats = this.engine.getMarketplaceStats();
    const allPlugins = this.engine.searchPlugins({ keyword: '' });

    let updatesAvailable = 0;
    for (const plugin of allPlugins.plugins) {
      if (plugin.status === 'published') {
        const validation = this.engine.validatePlugin(plugin.id);
        if (validation.valid && validation.warnings.length > 0) {
          updatesAvailable++;
        }
      }
    }

    if (updatesAvailable > 0) {
      logger.info('Plugin updates available', { count: updatesAvailable, total: stats.totalPlugins });
    }
  }

  getHealthReport(): { totalPlugins: number; activeInstallations: number; averageRating: number; cycleCount: number } {
    const stats = this.engine.getMarketplaceStats();
    return {
      totalPlugins: stats.totalPlugins,
      activeInstallations: stats.totalInstallations,
      averageRating: stats.averageRating,
      cycleCount: this.cycleCount,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __pluginManagementAgent__: PluginManagementAgent | undefined;
}

export function getPluginManagementAgent(config?: AgentConfig): PluginManagementAgent {
  if (!globalThis.__pluginManagementAgent__) {
    globalThis.__pluginManagementAgent__ = new PluginManagementAgent(config);
  }
  return globalThis.__pluginManagementAgent__;
}

export { PluginManagementAgent };
