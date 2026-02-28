/**
 * @module taskDecompositionAgent
 * @description Autonomous task decomposition agent that continuously processes
 * pending tasks, optimises execution plans, and reports decomposition statistics.
 */

import { getLogger } from '../lib/logger';
import { getTaskDecomposer } from '../lib/intelligentTaskDecomposer';

const logger = getLogger();

interface AgentConfig {
  monitoringIntervalMs?: number;
}

class TaskDecompositionAgent {
  private readonly decomposer = getTaskDecomposer();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;
  private tasksProcessed = 0;
  private plansOptimised = 0;

  constructor(config: AgentConfig = {}) {
    this.config = {
      monitoringIntervalMs: config.monitoringIntervalMs ?? 60_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.tick(), this.config.monitoringIntervalMs);
    logger.info('TaskDecompositionAgent started', { monitoringIntervalMs: this.config.monitoringIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.isRunning = false;
    logger.info('TaskDecompositionAgent stopped');
  }

  private async tick(): Promise<void> {
    try {
      this.processTaskQueue();
    } catch (err) {
      logger.error('TaskDecompositionAgent cycle error', err as Error);
    }
  }

  processTaskQueue(): void {
    const stats = this.decomposer.getStats();

    // Process ready subtasks for every active plan
    for (const taskId of this.getActiveTaskIds()) {
      const ready = this.decomposer.getReadyTasks(taskId);
      for (const subtask of ready) {
        this.decomposer.startSubtask(subtask.id);
        this.tasksProcessed++;
      }

      const blocked = this.decomposer.getBlockedTasks(taskId);
      if (blocked.length > 0) {
        logger.info('Blocked subtasks detected', { taskId, blockedCount: blocked.length });
      }
    }

    logger.info('Task queue processed', { tasksProcessed: this.tasksProcessed, activePlans: stats.activePlans });
  }

  optimizeExecutionPlan(taskId: string): void {
    const plan = this.decomposer.getPlan(taskId);
    if (!plan) {
      logger.warn('Plan not found for optimisation', { taskId });
      return;
    }

    const progress = this.decomposer.getProgress(taskId);
    if (progress.completionPercent < 100 && progress.blockedTasks > 0) {
      this.decomposer.replan(taskId);
      this.plansOptimised++;
      logger.info('Execution plan re-optimised', { taskId, blockedBefore: progress.blockedTasks });
    }
  }

  getAgentStats(): {
    isRunning: boolean;
    tasksProcessed: number;
    plansOptimised: number;
    decomposerStats: ReturnType<typeof this.decomposer.getStats>;
  } {
    return {
      isRunning: this.isRunning,
      tasksProcessed: this.tasksProcessed,
      plansOptimised: this.plansOptimised,
      decomposerStats: this.decomposer.getStats(),
    };
  }

  private getActiveTaskIds(): string[] {
    const stats = this.decomposer.getStats();
    // Return task ids from stats; the decomposer tracks them internally
    return stats.taskIds ?? [];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __taskDecompositionAgent__: TaskDecompositionAgent | undefined;
}

export function getTaskDecompositionAgent(config?: AgentConfig): TaskDecompositionAgent {
  if (!globalThis.__taskDecompositionAgent__) {
    globalThis.__taskDecompositionAgent__ = new TaskDecompositionAgent(config);
  }
  return globalThis.__taskDecompositionAgent__;
}

export { TaskDecompositionAgent };
