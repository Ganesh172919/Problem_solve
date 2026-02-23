/**
 * Autonomous Planning Agent
 *
 * Decomposes high-level goals into executable DAG-based plans with
 * dependency resolution, critical path analysis, parallelism detection,
 * risk assessment, and adaptive replanning on failures.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanGoal {
  id: string;
  description: string;
  successCriteria: string[];
  constraints: PlanConstraints;
  priority: 'critical' | 'high' | 'medium' | 'low';
  deadline?: number; // epoch ms
}

export interface PlanConstraints {
  maxBudget?: number;
  maxDuration?: number;
  maxParallelism?: number;
  requiredCapabilities?: string[];
  forbiddenActions?: string[];
}

export interface PlanTask {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  estimatedCost: number;
  estimatedDuration: number;
  priority: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
  retryCount: number;
  maxRetries: number;
  output?: unknown;
  startedAt?: number;
  completedAt?: number;
  failureReason?: string;
  capabilities: string[];
}

export interface ExecutionPlan {
  id: string;
  goalId: string;
  tasks: Map<string, PlanTask>;
  adjacencyList: Map<string, string[]>; // taskId -> downstream dependents
  criticalPath: string[];
  parallelGroups: string[][];
  totalEstimatedCost: number;
  totalEstimatedDuration: number;
  createdAt: number;
  status: 'draft' | 'validated' | 'executing' | 'completed' | 'failed' | 'replanned';
  riskScore: number;
  metadata: Record<string, unknown>;
}

export interface PlanProgress {
  planId: string;
  completedTasks: number;
  totalTasks: number;
  percentComplete: number;
  currentlyRunning: string[];
  blockedTasks: string[];
  failedTasks: string[];
  elapsedTime: number;
  estimatedRemaining: number;
}

interface PlanHistoryEntry {
  goalDescription: string;
  taskCount: number;
  duration: number;
  success: boolean;
  riskScore: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// PlanningAgent
// ---------------------------------------------------------------------------

export class PlanningAgent {
  private planHistory: PlanHistoryEntry[] = [];
  private activePlans: Map<string, ExecutionPlan> = new Map();
  private readonly maxHistory = 200;

  // ---- Plan creation -------------------------------------------------------

  createPlan(goal: PlanGoal): ExecutionPlan {
    logger.info('Creating execution plan', { goalId: goal.id, description: goal.description });

    const tasks = this.decompose(goal);
    const adjacencyList = this.buildAdjacencyList(tasks);
    this.validateDependencies(tasks, adjacencyList);

    const criticalPath = this.computeCriticalPath(tasks, adjacencyList);
    const parallelGroups = this.detectParallelism(tasks, adjacencyList);
    const riskScore = this.assessPlanRisk(tasks, goal);

    const plan: ExecutionPlan = {
      id: generateId('plan'),
      goalId: goal.id,
      tasks,
      adjacencyList,
      criticalPath,
      parallelGroups,
      totalEstimatedCost: this.sumField(tasks, 'estimatedCost'),
      totalEstimatedDuration: this.estimateDuration(tasks, criticalPath),
      createdAt: Date.now(),
      status: 'validated',
      riskScore,
      metadata: { priority: goal.priority, constraints: goal.constraints },
    };

    this.optimizePlan(plan, goal.constraints);
    this.activePlans.set(plan.id, plan);

    logger.info('Plan created', {
      planId: plan.id,
      tasks: tasks.size,
      criticalPathLength: criticalPath.length,
      riskScore,
    });

    return plan;
  }

  // ---- Decomposition -------------------------------------------------------

  private decompose(goal: PlanGoal): Map<string, PlanTask> {
    const tasks = new Map<string, PlanTask>();
    const criteria = goal.successCriteria;
    const priorityWeight = PRIORITY_WEIGHTS[goal.priority] ?? 2;

    // Phase 1 – Analysis task
    const analysisId = generateId('task');
    tasks.set(analysisId, this.buildTask(analysisId, 'Requirement Analysis',
      'Analyze goal requirements and identify components', [], priorityWeight * 10, 5, 1, ['analysis']));

    // Phase 2 – One design task per success criterion
    const designIds: string[] = [];
    for (let i = 0; i < criteria.length; i++) {
      const tid = generateId('task');
      designIds.push(tid);
      tasks.set(tid, this.buildTask(tid, `Design: ${criteria[i].slice(0, 60)}`,
        `Design solution for criterion: ${criteria[i]}`, [analysisId], priorityWeight * 8, 8, 2, ['design']));
    }

    // Phase 3 – Implementation tasks (one per design)
    const implIds: string[] = [];
    for (let i = 0; i < designIds.length; i++) {
      const tid = generateId('task');
      implIds.push(tid);
      tasks.set(tid, this.buildTask(tid, `Implement: ${criteria[i].slice(0, 50)}`,
        `Implement solution for criterion: ${criteria[i]}`, [designIds[i]], priorityWeight * 15, 20, 3, ['implementation']));
    }

    // Phase 4 – Integration
    const integrationId = generateId('task');
    tasks.set(integrationId, this.buildTask(integrationId, 'Integration',
      'Integrate all implemented components', implIds, priorityWeight * 12, 15, 2, ['integration']));

    // Phase 5 – Validation
    const validationId = generateId('task');
    tasks.set(validationId, this.buildTask(validationId, 'Validation',
      'Validate integrated solution against all criteria', [integrationId], priorityWeight * 6, 10, 1, ['validation']));

    // Apply constraint filters
    if (goal.constraints.forbiddenActions?.length) {
      for (const [, task] of tasks) {
        task.capabilities = task.capabilities.filter(c => !goal.constraints.forbiddenActions!.includes(c));
      }
    }

    return tasks;
  }

  private buildTask(
    id: string, name: string, description: string, dependencies: string[],
    cost: number, duration: number, priority: number, capabilities: string[],
  ): PlanTask {
    return {
      id, name, description, dependencies,
      estimatedCost: cost, estimatedDuration: duration,
      priority, riskLevel: 'low', riskFactors: [],
      status: dependencies.length === 0 ? 'ready' : 'pending',
      retryCount: 0, maxRetries: 3, capabilities,
    };
  }

  // ---- DAG construction ----------------------------------------------------

  private buildAdjacencyList(tasks: Map<string, PlanTask>): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const [id] of tasks) adj.set(id, []);
    for (const [id, task] of tasks) {
      for (const dep of task.dependencies) {
        const downstream = adj.get(dep);
        if (downstream) downstream.push(id);
      }
    }
    return adj;
  }

  // ---- Validation ----------------------------------------------------------

  private validateDependencies(tasks: Map<string, PlanTask>, adj: Map<string, string[]>): void {
    // Check references
    for (const [id, task] of tasks) {
      for (const dep of task.dependencies) {
        if (!tasks.has(dep)) {
          throw new Error(`Task ${id} depends on unknown task ${dep}`);
        }
      }
    }
    // Cycle detection (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const [id] of tasks) inDegree.set(id, 0);
    for (const [, children] of adj) {
      for (const c of children) inDegree.set(c, (inDegree.get(c) ?? 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, d] of inDegree) { if (d === 0) queue.push(id); }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const child of adj.get(node) ?? []) {
        const nd = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, nd);
        if (nd === 0) queue.push(child);
      }
    }
    if (visited !== tasks.size) {
      const cycleNodes = [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
      logger.error('Cycle detected in plan DAG', undefined, { cycleNodes });
      throw new Error(`Cycle detected in plan involving tasks: ${cycleNodes.join(', ')}`);
    }
  }

  // ---- Critical path -------------------------------------------------------

  private computeCriticalPath(tasks: Map<string, PlanTask>, adj: Map<string, string[]>): string[] {
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    for (const [id] of tasks) { dist.set(id, 0); prev.set(id, null); }

    // Topological order
    const order = this.topologicalSort(tasks, adj);

    for (const node of order) {
      const nodeDist = dist.get(node)! + (tasks.get(node)?.estimatedDuration ?? 0);
      for (const child of adj.get(node) ?? []) {
        if (nodeDist > dist.get(child)!) {
          dist.set(child, nodeDist);
          prev.set(child, node);
        }
      }
    }

    // Find the node with the longest distance
    let endNode = order[0];
    let maxDist = 0;
    for (const [id, d] of dist) {
      const total = d + (tasks.get(id)?.estimatedDuration ?? 0);
      if (total > maxDist) { maxDist = total; endNode = id; }
    }

    // Backtrack
    const path: string[] = [];
    let cur: string | null = endNode;
    while (cur) { path.unshift(cur); cur = prev.get(cur) ?? null; }
    return path;
  }

  private topologicalSort(tasks: Map<string, PlanTask>, adj: Map<string, string[]>): string[] {
    const inDeg = new Map<string, number>();
    for (const [id] of tasks) inDeg.set(id, 0);
    for (const [, children] of adj) {
      for (const c of children) inDeg.set(c, (inDeg.get(c) ?? 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, d] of inDeg) { if (d === 0) queue.push(id); }
    const order: string[] = [];
    while (queue.length) {
      const n = queue.shift()!;
      order.push(n);
      for (const c of adj.get(n) ?? []) {
        const nd = (inDeg.get(c) ?? 1) - 1;
        inDeg.set(c, nd);
        if (nd === 0) queue.push(c);
      }
    }
    return order;
  }

  // ---- Parallelism detection -----------------------------------------------

  private detectParallelism(tasks: Map<string, PlanTask>, adj: Map<string, string[]>): string[][] {
    const inDeg = new Map<string, number>();
    for (const [id] of tasks) inDeg.set(id, 0);
    for (const [, children] of adj) {
      for (const c of children) inDeg.set(c, (inDeg.get(c) ?? 0) + 1);
    }

    const groups: string[][] = [];
    const remaining = new Set(tasks.keys());

    while (remaining.size > 0) {
      const ready: string[] = [];
      for (const id of remaining) {
        if ((inDeg.get(id) ?? 0) === 0) ready.push(id);
      }
      if (ready.length === 0) break; // safety against infinite loop
      groups.push(ready);
      for (const id of ready) {
        remaining.delete(id);
        for (const c of adj.get(id) ?? []) {
          inDeg.set(c, (inDeg.get(c) ?? 1) - 1);
        }
      }
    }
    return groups;
  }

  // ---- Risk assessment -----------------------------------------------------

  private assessPlanRisk(tasks: Map<string, PlanTask>, goal: PlanGoal): number {
    let totalRisk = 0;
    const taskArr = [...tasks.values()];

    for (const task of taskArr) {
      let risk = 0;
      const factors: string[] = [];

      // Dependency fan-in risk
      if (task.dependencies.length > 3) {
        risk += 15;
        factors.push('High dependency fan-in');
      }

      // Duration risk
      if (task.estimatedDuration > 30) {
        risk += 20;
        factors.push('Long estimated duration');
      }

      // No-retry risk
      if (task.maxRetries === 0) {
        risk += 10;
        factors.push('No retry capability');
      }

      // High cost risk
      if (task.estimatedCost > 50) {
        risk += 10;
        factors.push('High estimated cost');
      }

      // Critical priority amplifies risk
      if (goal.priority === 'critical') risk = Math.round(risk * 1.5);

      task.riskFactors = factors;
      task.riskLevel = risk < 10 ? 'low' : risk < 25 ? 'medium' : risk < 45 ? 'high' : 'critical';
      totalRisk += risk;
    }

    const normalized = taskArr.length > 0 ? Math.min(100, totalRisk / taskArr.length) : 0;
    return Math.round(normalized);
  }

  // ---- Plan optimization ---------------------------------------------------

  private optimizePlan(plan: ExecutionPlan, constraints: PlanConstraints): void {
    // Budget trimming
    if (constraints.maxBudget && plan.totalEstimatedCost > constraints.maxBudget) {
      logger.warn('Plan exceeds budget, trimming low-priority tasks', {
        budget: constraints.maxBudget, estimated: plan.totalEstimatedCost,
      });
      const sorted = [...plan.tasks.values()].sort((a, b) => a.priority - b.priority);
      let saved = 0;
      for (const t of sorted) {
        if (plan.totalEstimatedCost - saved <= constraints.maxBudget) break;
        if (!plan.criticalPath.includes(t.id)) {
          t.status = 'skipped';
          saved += t.estimatedCost;
        }
      }
      plan.totalEstimatedCost -= saved;
    }

    // Parallelism cap
    if (constraints.maxParallelism) {
      const cap = constraints.maxParallelism;
      plan.parallelGroups = plan.parallelGroups.map(group =>
        group.length <= cap ? [group] : this.chunkArray(group, cap)
      ).flat();
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  // ---- Execution tracking --------------------------------------------------

  startExecution(planId: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    plan.status = 'executing';
    logger.info('Plan execution started', { planId });
  }

  completeTask(planId: string, taskId: string, output?: unknown): void {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const task = plan.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found in plan ${planId}`);

    task.status = 'completed';
    task.output = output;
    task.completedAt = Date.now();

    // Unblock dependents
    for (const depId of plan.adjacencyList.get(taskId) ?? []) {
      const dep = plan.tasks.get(depId);
      if (dep && dep.status === 'pending') {
        const allDepsCompleted = dep.dependencies.every(d => plan.tasks.get(d)?.status === 'completed');
        if (allDepsCompleted) dep.status = 'ready';
      }
    }

    logger.info('Task completed', { planId, taskId, taskName: task.name });
    this.checkPlanCompletion(plan);
  }

  failTask(planId: string, taskId: string, reason: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const task = plan.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found in plan ${planId}`);

    task.retryCount++;
    if (task.retryCount <= task.maxRetries) {
      logger.warn('Task failed, retrying', { planId, taskId, attempt: task.retryCount, reason });
      task.status = 'ready';
      return;
    }

    task.status = 'failed';
    task.failureReason = reason;
    task.completedAt = Date.now();
    logger.error('Task permanently failed', undefined, { planId, taskId, reason });

    // Mark downstream as skipped
    this.cascadeSkip(plan, taskId);

    // Attempt replanning
    this.replanOnFailure(plan, taskId);
  }

  private cascadeSkip(plan: ExecutionPlan, failedId: string): void {
    const queue = [...(plan.adjacencyList.get(failedId) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      const t = plan.tasks.get(id);
      if (t && t.status !== 'completed' && t.status !== 'failed') {
        t.status = 'skipped';
        t.failureReason = `Skipped due to upstream failure of ${failedId}`;
        queue.push(...(plan.adjacencyList.get(id) ?? []));
      }
    }
  }

  private replanOnFailure(plan: ExecutionPlan, failedTaskId: string): void {
    const failedTask = plan.tasks.get(failedTaskId);
    if (!failedTask) return;

    // Only replan if not on critical path
    if (plan.criticalPath.includes(failedTaskId)) {
      plan.status = 'failed';
      logger.error('Critical path task failed – plan cannot continue', undefined, { planId: plan.id, failedTaskId });
      return;
    }

    plan.status = 'replanned';
    logger.info('Replanning around failed non-critical task', { planId: plan.id, failedTaskId });
  }

  private checkPlanCompletion(plan: ExecutionPlan): void {
    const tasks = [...plan.tasks.values()];
    const allDone = tasks.every(t => t.status === 'completed' || t.status === 'skipped' || t.status === 'failed');
    if (!allDone) return;

    const anyFailed = tasks.some(t => t.status === 'failed');
    plan.status = anyFailed ? 'failed' : 'completed';

    this.recordHistory(plan);
    logger.info('Plan execution finished', { planId: plan.id, status: plan.status });
  }

  getProgress(planId: string): PlanProgress {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const tasks = [...plan.tasks.values()];
    const completed = tasks.filter(t => t.status === 'completed');
    const running = tasks.filter(t => t.status === 'running');
    const blocked = tasks.filter(t => t.status === 'pending');
    const failed = tasks.filter(t => t.status === 'failed');
    const total = tasks.length;

    const elapsed = Date.now() - plan.createdAt;
    const ratio = completed.length / Math.max(total, 1);
    const estRemaining = ratio > 0 ? elapsed * ((1 - ratio) / ratio) : plan.totalEstimatedDuration * 1000;

    return {
      planId,
      completedTasks: completed.length,
      totalTasks: total,
      percentComplete: Math.round(ratio * 100),
      currentlyRunning: running.map(t => t.id),
      blockedTasks: blocked.map(t => t.id),
      failedTasks: failed.map(t => t.id),
      elapsedTime: elapsed,
      estimatedRemaining: Math.round(estRemaining),
    };
  }

  // ---- History & learning --------------------------------------------------

  private recordHistory(plan: ExecutionPlan): void {
    this.planHistory.push({
      goalDescription: plan.goalId,
      taskCount: plan.tasks.size,
      duration: Date.now() - plan.createdAt,
      success: plan.status === 'completed',
      riskScore: plan.riskScore,
      timestamp: Date.now(),
    });
    if (this.planHistory.length > this.maxHistory) {
      this.planHistory = this.planHistory.slice(-this.maxHistory);
    }
  }

  getHistoricalSuccessRate(): number {
    if (this.planHistory.length === 0) return 0;
    const successes = this.planHistory.filter(h => h.success).length;
    return Math.round((successes / this.planHistory.length) * 100);
  }

  getAverageRisk(): number {
    if (this.planHistory.length === 0) return 0;
    const sum = this.planHistory.reduce((s, h) => s + h.riskScore, 0);
    return Math.round(sum / this.planHistory.length);
  }

  getPlan(planId: string): ExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }

  // ---- Utilities -----------------------------------------------------------

  private sumField(tasks: Map<string, PlanTask>, field: 'estimatedCost' | 'estimatedDuration'): number {
    let sum = 0;
    for (const [, t] of tasks) sum += t[field];
    return sum;
  }

  private estimateDuration(tasks: Map<string, PlanTask>, criticalPath: string[]): number {
    return criticalPath.reduce((s, id) => s + (tasks.get(id)?.estimatedDuration ?? 0), 0);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__autonomousPlanningAgent__';

export function getAutonomousPlanningAgent(): PlanningAgent {
  const g = globalThis as unknown as Record<string, PlanningAgent>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PlanningAgent();
    logger.info('Autonomous planning agent initialized');
  }
  return g[GLOBAL_KEY];
}
