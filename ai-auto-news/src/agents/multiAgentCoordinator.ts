/**
 * Multi-Agent Coordination Engine
 *
 * Orchestrates multiple AI agents with:
 * - Dynamic task routing based on agent capabilities
 * - Load balancing across agents
 * - Parallel execution with dependency management
 * - Real-time performance tracking
 * - Automatic failover and retry logic
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface AgentCapability {
  agentId: string;
  agentType: string;
  capabilities: string[];
  maxConcurrency: number;
  currentLoad: number;
  averageLatency: number;
  successRate: number;
  costPerTask: number;
  priority: number;
}

export interface TaskRequest {
  id: string;
  type: string;
  requiredCapabilities: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  deadline?: Date;
  dependencies: string[];
  payload: any;
  maxRetries: number;
  timeout: number;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  result: any;
  startTime: Date;
  endTime: Date;
  duration: number;
  retries: number;
  cost: number;
  metadata: Record<string, any>;
}

export interface CoordinationStrategy {
  routingAlgorithm: 'round-robin' | 'least-loaded' | 'fastest' | 'cheapest' | 'best-success-rate';
  parallelization: boolean;
  maxParallelTasks: number;
  retryStrategy: 'immediate' | 'exponential-backoff' | 'linear-backoff';
  failoverEnabled: boolean;
  circuitBreakerThreshold: number;
}

class MultiAgentCoordinator {
  private agents: Map<string, AgentCapability> = new Map();
  private taskQueue: TaskRequest[] = [];
  private activeTasks: Map<string, TaskExecution> = new Map();
  private completedTasks: Map<string, TaskResult> = new Map();
  private strategy: CoordinationStrategy;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(strategy?: Partial<CoordinationStrategy>) {
    this.strategy = {
      routingAlgorithm: 'least-loaded',
      parallelization: true,
      maxParallelTasks: 10,
      retryStrategy: 'exponential-backoff',
      failoverEnabled: true,
      circuitBreakerThreshold: 0.5,
      ...strategy,
    };
  }

  /**
   * Register an agent with its capabilities
   */
  registerAgent(capability: AgentCapability): void {
    this.agents.set(capability.agentId, capability);
    this.circuitBreakers.set(capability.agentId, new CircuitBreaker(
      capability.agentId,
      this.strategy.circuitBreakerThreshold
    ));
    logger.info('Agent registered', {
      agentId: capability.agentId,
      type: capability.agentType,
      capabilities: capability.capabilities,
    });
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.circuitBreakers.delete(agentId);
    logger.info('Agent unregistered', { agentId });
  }

  /**
   * Submit a task for execution
   */
  async submitTask(task: TaskRequest): Promise<string> {
    logger.info('Task submitted', { taskId: task.id, type: task.type, priority: task.priority });

    // Validate task
    this.validateTask(task);

    // Add to queue
    this.taskQueue.push(task);

    // Sort queue by priority
    this.sortTaskQueue();

    // Trigger execution
    this.processQueue();

    return task.id;
  }

  /**
   * Submit multiple tasks with dependency management
   */
  async submitBatch(tasks: TaskRequest[]): Promise<string[]> {
    logger.info('Batch submission', { count: tasks.length });

    // Build dependency graph
    const graph = this.buildDependencyGraph(tasks);

    // Validate for circular dependencies
    if (this.hasCircularDependencies(graph)) {
      throw new Error('Circular dependencies detected in task batch');
    }

    // Submit tasks in topological order
    const sortedTasks = this.topologicalSort(tasks, graph);
    const taskIds: string[] = [];

    for (const task of sortedTasks) {
      const taskId = await this.submitTask(task);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): TaskStatus {
    if (this.completedTasks.has(taskId)) {
      const result = this.completedTasks.get(taskId)!;
      return {
        status: result.status,
        result: result.result,
        progress: 100,
        agentId: result.agentId,
      };
    }

    if (this.activeTasks.has(taskId)) {
      const execution = this.activeTasks.get(taskId)!;
      return {
        status: 'running',
        progress: execution.progress,
        agentId: execution.agentId,
      };
    }

    const queued = this.taskQueue.find(t => t.id === taskId);
    if (queued) {
      return {
        status: 'queued',
        progress: 0,
        queuePosition: this.taskQueue.indexOf(queued),
      };
    }

    return {
      status: 'unknown',
      progress: 0,
    };
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    // Remove from queue
    const queueIndex = this.taskQueue.findIndex(t => t.id === taskId);
    if (queueIndex >= 0) {
      this.taskQueue.splice(queueIndex, 1);
      logger.info('Task cancelled from queue', { taskId });
      return true;
    }

    // Cancel active task
    const execution = this.activeTasks.get(taskId);
    if (execution) {
      execution.cancelled = true;
      logger.info('Task cancellation requested', { taskId, agentId: execution.agentId });
      return true;
    }

    return false;
  }

  /**
   * Get coordination statistics
   */
  getStatistics(): CoordinationStats {
    const totalTasks = this.completedTasks.size;
    const successfulTasks = Array.from(this.completedTasks.values())
      .filter(t => t.status === 'success').length;
    const failedTasks = Array.from(this.completedTasks.values())
      .filter(t => t.status === 'failed').length;

    const agentStats = Array.from(this.agents.values()).map(agent => ({
      agentId: agent.agentId,
      type: agent.agentType,
      currentLoad: agent.currentLoad,
      maxConcurrency: agent.maxConcurrency,
      utilizationPercent: (agent.currentLoad / agent.maxConcurrency) * 100,
      successRate: agent.successRate,
      averageLatency: agent.averageLatency,
    }));

    return {
      totalAgents: this.agents.size,
      activeAgents: Array.from(this.agents.values()).filter(a => a.currentLoad > 0).length,
      queuedTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      completedTasks: totalTasks,
      successfulTasks,
      failedTasks,
      overallSuccessRate: totalTasks > 0 ? successfulTasks / totalTasks : 0,
      agentStats,
    };
  }

  /**
   * Process task queue
   */
  private async processQueue(): Promise<void> {
    while (this.taskQueue.length > 0 && this.activeTasks.size < this.strategy.maxParallelTasks) {
      const task = this.taskQueue.shift();
      if (!task) break;

      // Check dependencies
      if (!this.areDependenciesMet(task)) {
        // Re-queue if dependencies not met
        this.taskQueue.push(task);
        continue;
      }

      // Select agent
      const agent = this.selectAgent(task);
      if (!agent) {
        // No available agent, re-queue
        this.taskQueue.unshift(task);
        break;
      }

      // Check circuit breaker
      const breaker = this.circuitBreakers.get(agent.agentId);
      if (breaker && breaker.isOpen()) {
        logger.warn('Agent circuit breaker open, skipping', { agentId: agent.agentId });
        // Try to find alternative agent
        const altAgent = this.findAlternativeAgent(task, agent.agentId);
        if (!altAgent) {
          this.taskQueue.unshift(task);
          break;
        }
        this.executeTask(task, altAgent);
      } else {
        this.executeTask(task, agent);
      }
    }
  }

  /**
   * Execute task on selected agent
   */
  private async executeTask(task: TaskRequest, agent: AgentCapability): Promise<void> {
    const execution: TaskExecution = {
      taskId: task.id,
      agentId: agent.agentId,
      startTime: new Date(),
      retries: 0,
      progress: 0,
      cancelled: false,
    };

    this.activeTasks.set(task.id, execution);
    agent.currentLoad++;

    logger.info('Executing task', {
      taskId: task.id,
      agentId: agent.agentId,
      priority: task.priority,
    });

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => this.callAgent(agent, task, execution),
        task.timeout
      );

      const taskResult: TaskResult = {
        taskId: task.id,
        agentId: agent.agentId,
        status: 'success',
        result,
        startTime: execution.startTime,
        endTime: new Date(),
        duration: Date.now() - execution.startTime.getTime(),
        retries: execution.retries,
        cost: agent.costPerTask,
        metadata: {},
      };

      this.completedTasks.set(task.id, taskResult);
      this.activeTasks.delete(task.id);
      agent.currentLoad--;

      // Update agent stats
      this.updateAgentStats(agent, true, taskResult.duration);

      // Update circuit breaker
      const breaker = this.circuitBreakers.get(agent.agentId);
      if (breaker) breaker.recordSuccess();

      logger.info('Task completed successfully', {
        taskId: task.id,
        agentId: agent.agentId,
        duration: taskResult.duration,
      });
    } catch (error: any) {
      logger.error('Task execution failed', error instanceof Error ? error : undefined, { taskId: task.id, agentId: agent.agentId });

      agent.currentLoad--;

      // Update circuit breaker
      const breaker = this.circuitBreakers.get(agent.agentId);
      if (breaker) breaker.recordFailure();

      // Retry logic
      if (execution.retries < task.maxRetries) {
        execution.retries++;
        logger.info('Retrying task', { taskId: task.id, attempt: execution.retries });

        // Apply backoff
        const delay = this.calculateBackoff(execution.retries, this.strategy.retryStrategy);
        await this.sleep(delay);

        // Re-queue for retry
        this.taskQueue.unshift(task);
        this.activeTasks.delete(task.id);
      } else {
        const taskResult: TaskResult = {
          taskId: task.id,
          agentId: agent.agentId,
          status: 'failed',
          result: { error: error.message },
          startTime: execution.startTime,
          endTime: new Date(),
          duration: Date.now() - execution.startTime.getTime(),
          retries: execution.retries,
          cost: agent.costPerTask * (execution.retries + 1),
          metadata: { error: error.message },
        };

        this.completedTasks.set(task.id, taskResult);
        this.activeTasks.delete(task.id);

        // Update agent stats
        this.updateAgentStats(agent, false, taskResult.duration);
      }
    }

    // Continue processing queue
    this.processQueue();
  }

  /**
   * Select best agent for task
   */
  private selectAgent(task: TaskRequest): AgentCapability | null {
    const candidates = Array.from(this.agents.values()).filter(agent => {
      // Check capabilities
      const hasCapabilities = task.requiredCapabilities.every(cap =>
        agent.capabilities.includes(cap)
      );

      // Check availability
      const hasCapacity = agent.currentLoad < agent.maxConcurrency;

      // Check circuit breaker
      const breaker = this.circuitBreakers.get(agent.agentId);
      const breakerOk = !breaker || !breaker.isOpen();

      return hasCapabilities && hasCapacity && breakerOk;
    });

    if (candidates.length === 0) return null;

    // Apply routing algorithm
    switch (this.strategy.routingAlgorithm) {
      case 'round-robin':
        return candidates[0];

      case 'least-loaded':
        return candidates.reduce((best, curr) =>
          curr.currentLoad < best.currentLoad ? curr : best
        );

      case 'fastest':
        return candidates.reduce((best, curr) =>
          curr.averageLatency < best.averageLatency ? curr : best
        );

      case 'cheapest':
        return candidates.reduce((best, curr) =>
          curr.costPerTask < best.costPerTask ? curr : best
        );

      case 'best-success-rate':
        return candidates.reduce((best, curr) =>
          curr.successRate > best.successRate ? curr : best
        );

      default:
        return candidates[0];
    }
  }

  /**
   * Find alternative agent (for failover)
   */
  private findAlternativeAgent(task: TaskRequest, excludeAgentId: string): AgentCapability | null {
    const candidates = Array.from(this.agents.values()).filter(agent => {
      if (agent.agentId === excludeAgentId) return false;

      const hasCapabilities = task.requiredCapabilities.every(cap =>
        agent.capabilities.includes(cap)
      );
      const hasCapacity = agent.currentLoad < agent.maxConcurrency;

      return hasCapabilities && hasCapacity;
    });

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Call agent to execute task (mock implementation)
   */
  private async callAgent(
    agent: AgentCapability,
    task: TaskRequest,
    execution: TaskExecution
  ): Promise<any> {
    // This is a mock - real implementation would call actual agent
    // Simulate progress updates
    for (let i = 0; i <= 100; i += 20) {
      if (execution.cancelled) {
        throw new Error('Task cancelled');
      }
      execution.progress = i;
      await this.sleep(100);
    }

    return { success: true, data: 'Task completed' };
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Task timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Validate task request
   */
  private validateTask(task: TaskRequest): void {
    if (!task.id) throw new Error('Task ID is required');
    if (!task.type) throw new Error('Task type is required');
    if (!task.requiredCapabilities || task.requiredCapabilities.length === 0) {
      throw new Error('Required capabilities must be specified');
    }
  }

  /**
   * Sort task queue by priority
   */
  private sortTaskQueue(): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    this.taskQueue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Secondary sort by deadline
      if (a.deadline && b.deadline) {
        return a.deadline.getTime() - b.deadline.getTime();
      }

      return 0;
    });
  }

  /**
   * Check if task dependencies are met
   */
  private areDependenciesMet(task: TaskRequest): boolean {
    return task.dependencies.every(depId => {
      const result = this.completedTasks.get(depId);
      return result && result.status === 'success';
    });
  }

  /**
   * Build dependency graph
   */
  private buildDependencyGraph(tasks: TaskRequest[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of tasks) {
      graph.set(task.id, task.dependencies);
    }

    return graph;
  }

  /**
   * Check for circular dependencies
   */
  private hasCircularDependencies(graph: Map<string, string[]>): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const dependencies = graph.get(nodeId) || [];
      for (const depId of dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * Topological sort of tasks
   */
  private topologicalSort(tasks: TaskRequest[], graph: Map<string, string[]>): TaskRequest[] {
    const sorted: TaskRequest[] = [];
    const visited = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const deps = graph.get(taskId) || [];
      for (const depId of deps) {
        visit(depId);
      }

      const task = tasks.find(t => t.id === taskId);
      if (task) sorted.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return sorted;
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(attempt: number, strategy: string): number {
    switch (strategy) {
      case 'immediate':
        return 0;
      case 'linear-backoff':
        return attempt * 1000;
      case 'exponential-backoff':
        return Math.pow(2, attempt) * 1000;
      default:
        return 1000;
    }
  }

  /**
   * Update agent statistics
   */
  private updateAgentStats(agent: AgentCapability, success: boolean, duration: number): void {
    // Update success rate (exponential moving average)
    const alpha = 0.1;
    const currentSuccess = success ? 1 : 0;
    agent.successRate = alpha * currentSuccess + (1 - alpha) * agent.successRate;

    // Update average latency (exponential moving average)
    agent.averageLatency = alpha * duration + (1 - alpha) * agent.averageLatency;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Circuit Breaker for agent health monitoring
 */
class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private lastFailureTime?: Date;
  private readonly threshold: number;
  private readonly resetTimeoutMs = 60000; // 1 minute

  constructor(private agentId: string, threshold: number) {
    this.threshold = threshold;
  }

  recordSuccess(): void {
    this.successes++;

    if (this.state === 'half-open') {
      // Successful call in half-open state, close circuit
      this.state = 'closed';
      this.failures = 0;
      logger.info('Circuit breaker closed', { agentId: this.agentId });
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    const total = this.failures + this.successes;
    if (total > 10 && this.failures / total > this.threshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened', {
        agentId: this.agentId,
        failureRate: this.failures / total,
      });
    }
  }

  isOpen(): boolean {
    if (this.state === 'closed') return false;

    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      if (this.lastFailureTime) {
        const elapsed = Date.now() - this.lastFailureTime.getTime();
        if (elapsed > this.resetTimeoutMs) {
          this.state = 'half-open';
          logger.info('Circuit breaker half-open', { agentId: this.agentId });
          return false;
        }
      }
      return true;
    }

    return false;
  }
}

interface TaskExecution {
  taskId: string;
  agentId: string;
  startTime: Date;
  retries: number;
  progress: number;
  cancelled: boolean;
}

interface TaskStatus {
  status: string;
  progress: number;
  result?: any;
  agentId?: string;
  queuePosition?: number;
}

interface CoordinationStats {
  totalAgents: number;
  activeAgents: number;
  queuedTasks: number;
  activeTasks: number;
  completedTasks: number;
  successfulTasks: number;
  failedTasks: number;
  overallSuccessRate: number;
  agentStats: Array<{
    agentId: string;
    type: string;
    currentLoad: number;
    maxConcurrency: number;
    utilizationPercent: number;
    successRate: number;
    averageLatency: number;
  }>;
}

// Singleton instance
let coordinator: MultiAgentCoordinator;

export function getMultiAgentCoordinator(strategy?: Partial<CoordinationStrategy>): MultiAgentCoordinator {
  if (!coordinator) {
    coordinator = new MultiAgentCoordinator(strategy);
  }
  return coordinator;
}

export { MultiAgentCoordinator };
