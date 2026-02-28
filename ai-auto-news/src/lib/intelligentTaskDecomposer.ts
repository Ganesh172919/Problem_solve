/**
 * @module intelligentTaskDecomposer
 * @description Intelligent Task Decomposition Engine for AI agent systems. Accepts high-level
 *              tasks and decomposes them into dependency-aware sub-tasks using DAG-based analysis.
 *              Features include critical path calculation, parallel execution planning, resource
 *              estimation, priority scoring, progress tracking, and dynamic re-planning when
 *              tasks fail or conditions change.
 */

import { getLogger } from './logger';
const logger = getLogger();

export type SubTaskType = 'research' | 'design' | 'implement' | 'test' | 'validate' | 'integrate' | 'deploy' | 'review';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface TaskInput {
  id: string;
  description: string;
  context: Record<string, unknown>;
  constraints: string[];
  priority: number;
  deadline?: Date;
}

export interface SubTask {
  id: string;
  parentId: string;
  description: string;
  type: SubTaskType;
  dependencies: string[];
  estimatedDurationMs: number;
  estimatedComplexity: number;
  status: TaskStatus;
  result?: Record<string, unknown>;
  assignedAgent?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface DecompositionPlan {
  taskId: string;
  subtasks: SubTask[];
  criticalPath: string[];
  estimatedTotalMs: number;
  parallelGroups: string[][];
  createdAt: Date;
}

export interface ExecutionProgress {
  taskId: string;
  totalSubtasks: number;
  completed: number;
  failed: number;
  blocked: number;
  inProgress: number;
  percentComplete: number;
  estimatedRemainingMs: number;
  criticalPathProgress: number;
}

export interface DecomposerStats {
  totalTasks: number;
  totalSubtasks: number;
  avgSubtasksPerTask: number;
  avgCompletionTimeMs: number;
  successRate: number;
  decompositionAccuracy: number;
}

const COMPLEXITY_KEYWORDS: Record<string, number> = {
  integrate: 7, deploy: 8, migrate: 9, refactor: 7, optimize: 6,
  design: 5, test: 4, validate: 3, research: 3, review: 2,
  implement: 6, build: 5, create: 4, configure: 3, update: 2,
  monitor: 3, analyze: 5, transform: 6, orchestrate: 8, scale: 7,
  secure: 7, authenticate: 6, encrypt: 5, parallelize: 8, distribute: 8,
  machine_learning: 9, ai: 8, realtime: 7, streaming: 6, batch: 4,
};

const TYPE_DURATION_BASE: Record<SubTaskType, number> = {
  research: 30000, design: 45000, implement: 60000, test: 25000,
  validate: 15000, integrate: 40000, deploy: 35000, review: 20000,
};

const PHASE_ORDER: SubTaskType[] = [
  'research', 'design', 'implement', 'test', 'validate', 'integrate', 'review', 'deploy',
];

export class IntelligentTaskDecomposer {
  private plans: Map<string, DecompositionPlan> = new Map();
  private subtaskIndex: Map<string, SubTask> = new Map();
  private completionTimes: number[] = [];

  constructor() {
    logger.info('IntelligentTaskDecomposer initialized');
  }

  estimateComplexity(description: string): number {
    const tokens = description.toLowerCase().split(/[\s,._\-/]+/);
    let score = 0;
    let matches = 0;
    for (const token of tokens) {
      if (COMPLEXITY_KEYWORDS[token] !== undefined) {
        score += COMPLEXITY_KEYWORDS[token];
        matches++;
      }
    }
    if (matches === 0) return Math.min(10, Math.max(1, Math.ceil(tokens.length / 5)));
    return Math.min(10, Math.max(1, Math.round(score / matches)));
  }

  decompose(input: TaskInput): DecompositionPlan {
    logger.info(`Decomposing task ${input.id}: ${input.description}`);
    const subtasks = this.generateSubtasks(input);
    this.resolveDependencies(subtasks);
    for (const st of subtasks) this.subtaskIndex.set(st.id, st);

    const criticalPath = this.computeCriticalPath(subtasks);
    const parallelGroups = this.buildParallelGroups(subtasks);
    const estimatedTotalMs = this.computeTotalEstimate(subtasks, criticalPath);
    const plan: DecompositionPlan = {
      taskId: input.id, subtasks, criticalPath,
      estimatedTotalMs, parallelGroups, createdAt: new Date(),
    };
    this.plans.set(input.id, plan);
    logger.info(`Decomposed task ${input.id} into ${subtasks.length} subtasks`);
    return plan;
  }

  private generateSubtasks(input: TaskInput): SubTask[] {
    const subtasks: SubTask[] = [];
    const complexity = this.estimateComplexity(input.description);
    const phases = this.selectPhases(complexity, input.constraints);

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const phaseComplexity = Math.min(10, Math.max(1,
        complexity + (phase === 'implement' ? 2 : phase === 'deploy' ? 1 : -1)));
      subtasks.push({
        id: `${input.id}_sub_${i}`,
        parentId: input.id,
        description: `${phase.charAt(0).toUpperCase() + phase.slice(1)} phase for: ${input.description}`,
        type: phase,
        dependencies: [],
        estimatedDurationMs: Math.round(TYPE_DURATION_BASE[phase] * (phaseComplexity / 5)),
        estimatedComplexity: phaseComplexity,
        status: 'pending',
      });
    }

    // For high complexity, split implementation into parallel tracks
    if (complexity >= 7 && subtasks.some(s => s.type === 'implement')) {
      const implIdx = subtasks.findIndex(s => s.type === 'implement');
      const impl = subtasks[implIdx];
      const trackCount = Math.min(3, Math.ceil(complexity / 4));
      subtasks.splice(implIdx, 1);
      for (let t = 0; t < trackCount; t++) {
        subtasks.splice(implIdx + t, 0, {
          id: `${input.id}_sub_impl_${t}`, parentId: input.id,
          description: `Implementation track ${t + 1} for: ${input.description}`,
          type: 'implement', dependencies: [],
          estimatedDurationMs: Math.round(impl.estimatedDurationMs / trackCount * 1.2),
          estimatedComplexity: impl.estimatedComplexity, status: 'pending',
        });
      }
    }
    return subtasks;
  }

  private selectPhases(complexity: number, constraints: string[]): SubTaskType[] {
    if (complexity <= 2) return ['implement', 'test', 'review'];
    if (complexity <= 5) return ['research', 'design', 'implement', 'test', 'review'];
    const phases: SubTaskType[] = ['research', 'design', 'implement', 'test', 'validate', 'integrate', 'review', 'deploy'];
    const needsDeploy = constraints.some(c =>
      c.toLowerCase().includes('deploy') || c.toLowerCase().includes('production'));
    return needsDeploy ? phases : phases.filter(p => p !== 'deploy');
  }

  private resolveDependencies(subtasks: SubTask[]): void {
    const phaseIndex = new Map<SubTaskType, string[]>();
    for (const st of subtasks) {
      const existing = phaseIndex.get(st.type) ?? [];
      existing.push(st.id);
      phaseIndex.set(st.type, existing);
    }
    for (const st of subtasks) {
      const currentOrder = PHASE_ORDER.indexOf(st.type);
      if (currentOrder <= 0) continue;
      for (let p = currentOrder - 1; p >= 0; p--) {
        const prevIds = phaseIndex.get(PHASE_ORDER[p]);
        if (prevIds && prevIds.length > 0) {
          st.dependencies.push(...prevIds);
          break;
        }
      }
    }
  }

  private computeCriticalPath(subtasks: SubTask[]): string[] {
    const idMap = new Map<string, SubTask>();
    for (const st of subtasks) idMap.set(st.id, st);

    const longest = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    const computeLongest = (id: string): number => {
      if (longest.has(id)) return longest.get(id)!;
      const st = idMap.get(id)!;
      let maxPrev = 0;
      let bestPred: string | null = null;
      for (const depId of st.dependencies) {
        const depLen = computeLongest(depId) + (idMap.get(depId)?.estimatedDurationMs ?? 0);
        if (depLen > maxPrev) { maxPrev = depLen; bestPred = depId; }
      }
      longest.set(id, maxPrev);
      predecessor.set(id, bestPred);
      return maxPrev;
    };

    for (const st of subtasks) computeLongest(st.id);

    let endNode = '';
    let maxTotal = 0;
    for (const st of subtasks) {
      const total = (longest.get(st.id) ?? 0) + st.estimatedDurationMs;
      if (total > maxTotal) { maxTotal = total; endNode = st.id; }
    }

    const path: string[] = [];
    let current: string | null = endNode;
    while (current) { path.unshift(current); current = predecessor.get(current) ?? null; }
    return path;
  }

  private buildParallelGroups(subtasks: SubTask[]): string[][] {
    const sorted = this.topologicalSort(subtasks);
    const groups: string[][] = [];
    const scheduled = new Set<string>();
    while (scheduled.size < subtasks.length) {
      const group: string[] = [];
      for (const id of sorted) {
        if (scheduled.has(id)) continue;
        const st = subtasks.find(s => s.id === id)!;
        if (st.dependencies.every(d => scheduled.has(d))) group.push(id);
      }
      if (group.length === 0) break;
      for (const id of group) scheduled.add(id);
      groups.push(group);
    }
    return groups;
  }

  private topologicalSort(subtasks: SubTask[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const st of subtasks) {
      inDegree.set(st.id, st.dependencies.length);
      for (const dep of st.dependencies) {
        const edges = adj.get(dep) ?? [];
        edges.push(st.id);
        adj.set(dep, edges);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of (adj.get(node) ?? [])) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    return sorted;
  }

  private computeTotalEstimate(subtasks: SubTask[], criticalPath: string[]): number {
    return criticalPath.reduce((sum, id) => {
      const st = subtasks.find(s => s.id === id);
      return sum + (st?.estimatedDurationMs ?? 0);
    }, 0);
  }

  getExecutionOrder(plan: DecompositionPlan): SubTask[][] {
    const idMap = new Map<string, SubTask>();
    for (const st of plan.subtasks) idMap.set(st.id, st);
    return plan.parallelGroups.map(group =>
      group.map(id => idMap.get(id)!).filter(Boolean));
  }

  findCriticalPath(plan: DecompositionPlan): string[] {
    return this.computeCriticalPath(plan.subtasks);
  }

  startSubtask(subtaskId: string): SubTask {
    const st = this.subtaskIndex.get(subtaskId);
    if (!st) throw new Error(`Subtask not found: ${subtaskId}`);
    for (const depId of st.dependencies) {
      const dep = this.subtaskIndex.get(depId);
      if (dep && dep.status !== 'completed') {
        throw new Error(`Cannot start ${subtaskId}: dependency ${depId} is ${dep.status}`);
      }
    }
    st.status = 'in_progress';
    st.startedAt = new Date();
    logger.info(`Started subtask ${subtaskId}`);
    return { ...st };
  }

  completeSubtask(subtaskId: string, result: Record<string, unknown>): SubTask {
    const st = this.subtaskIndex.get(subtaskId);
    if (!st) throw new Error(`Subtask not found: ${subtaskId}`);
    st.status = 'completed';
    st.result = result;
    st.completedAt = new Date();
    if (st.startedAt) {
      this.completionTimes.push(st.completedAt.getTime() - st.startedAt.getTime());
    }
    this.unblockDependents(st.parentId, subtaskId);
    logger.info(`Completed subtask ${subtaskId}`);
    return { ...st };
  }

  failSubtask(subtaskId: string, error: string): SubTask {
    const st = this.subtaskIndex.get(subtaskId);
    if (!st) throw new Error(`Subtask not found: ${subtaskId}`);
    st.status = 'failed';
    st.result = { error };
    st.completedAt = new Date();
    this.blockDependents(st.parentId, subtaskId);
    logger.info(`Failed subtask ${subtaskId}: ${error}`);
    return { ...st };
  }

  private unblockDependents(taskId: string, completedId: string): void {
    const plan = this.plans.get(taskId);
    if (!plan) return;
    for (const st of plan.subtasks) {
      if (st.status !== 'blocked' || !st.dependencies.includes(completedId)) continue;
      const allDepsMet = st.dependencies.every(d =>
        this.subtaskIndex.get(d)?.status === 'completed');
      if (allDepsMet) st.status = 'pending';
    }
  }

  private blockDependents(taskId: string, failedId: string): void {
    const plan = this.plans.get(taskId);
    if (!plan) return;
    const toBlock = new Set<string>();
    const queue = [failedId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const st of plan.subtasks) {
        if (st.dependencies.includes(current) && !toBlock.has(st.id)) {
          toBlock.add(st.id);
          queue.push(st.id);
        }
      }
    }
    for (const id of toBlock) {
      const st = this.subtaskIndex.get(id);
      if (st && st.status !== 'completed' && st.status !== 'failed') st.status = 'blocked';
    }
  }

  getProgress(taskId: string): ExecutionProgress {
    const plan = this.plans.get(taskId);
    if (!plan) throw new Error(`No plan found for task: ${taskId}`);

    const counts = { completed: 0, failed: 0, blocked: 0, inProgress: 0 };
    for (const st of plan.subtasks) {
      if (st.status === 'completed') counts.completed++;
      else if (st.status === 'failed') counts.failed++;
      else if (st.status === 'blocked') counts.blocked++;
      else if (st.status === 'in_progress') counts.inProgress++;
    }
    const total = plan.subtasks.length;
    const remainingMs = plan.subtasks
      .filter(s => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'cancelled')
      .reduce((sum, s) => sum + s.estimatedDurationMs, 0);
    const criticalDone = plan.criticalPath
      .filter(id => this.subtaskIndex.get(id)?.status === 'completed').length;

    return {
      taskId, totalSubtasks: total,
      completed: counts.completed, failed: counts.failed,
      blocked: counts.blocked, inProgress: counts.inProgress,
      percentComplete: total > 0 ? Math.round((counts.completed / total) * 100) : 0,
      estimatedRemainingMs: remainingMs,
      criticalPathProgress: plan.criticalPath.length > 0
        ? Math.round((criticalDone / plan.criticalPath.length) * 100) : 100,
    };
  }

  replan(taskId: string): DecompositionPlan {
    const plan = this.plans.get(taskId);
    if (!plan) throw new Error(`No plan found for task: ${taskId}`);
    logger.info(`Re-planning task ${taskId}`);

    const activeSubtasks = plan.subtasks.filter(
      s => s.status !== 'completed' && s.status !== 'cancelled');

    // Reset blocked tasks whose failed deps can be retried
    for (const st of activeSubtasks) {
      if (st.status !== 'blocked') continue;
      const hasFailedDep = st.dependencies.some(d =>
        this.subtaskIndex.get(d)?.status === 'failed');
      if (!hasFailedDep) continue;
      // Mutate stored subtask refs directly to reset failed deps for retry
      for (const depId of st.dependencies) {
        const dep = this.subtaskIndex.get(depId);
        if (dep?.status === 'failed') {
          dep.status = 'pending';
          dep.result = undefined;
          dep.completedAt = undefined;
          dep.startedAt = undefined;
        }
      }
      st.status = 'pending';
    }

    plan.criticalPath = this.computeCriticalPath(plan.subtasks);
    plan.parallelGroups = this.buildParallelGroups(
      plan.subtasks.filter(s => s.status !== 'completed' && s.status !== 'cancelled'));
    plan.estimatedTotalMs = this.computeTotalEstimate(plan.subtasks, plan.criticalPath);
    logger.info(`Re-planned task ${taskId}: ${activeSubtasks.length} remaining subtasks`);
    return { ...plan };
  }

  getBlockedTasks(taskId: string): SubTask[] {
    const plan = this.plans.get(taskId);
    if (!plan) return [];
    return plan.subtasks.filter(s => s.status === 'blocked').map(s => ({ ...s }));
  }

  getReadyTasks(taskId: string): SubTask[] {
    const plan = this.plans.get(taskId);
    if (!plan) return [];
    return plan.subtasks.filter(st => {
      if (st.status !== 'pending') return false;
      return st.dependencies.every(d =>
        this.subtaskIndex.get(d)?.status === 'completed');
    }).map(s => ({ ...s }));
  }

  getStats(): DecomposerStats {
    const totalTasks = this.plans.size;
    let totalSubtasks = 0;
    let completedTasks = 0;
    let totalTasksWithCompletion = 0;

    for (const plan of this.plans.values()) {
      totalSubtasks += plan.subtasks.length;
      const allDone = plan.subtasks.every(
        s => s.status === 'completed' || s.status === 'cancelled');
      if (allDone && plan.subtasks.length > 0) {
        completedTasks++;
        totalTasksWithCompletion++;
      } else if (plan.subtasks.some(s => s.status === 'failed')) {
        totalTasksWithCompletion++;
      }
    }
    const avgSub = totalTasks > 0 ? totalSubtasks / totalTasks : 0;
    const avgTime = this.completionTimes.length > 0
      ? this.completionTimes.reduce((a, b) => a + b, 0) / this.completionTimes.length : 0;
    const success = totalTasksWithCompletion > 0
      ? completedTasks / totalTasksWithCompletion : 1;
    const plans = Array.from(this.plans.values());
    const noFail = plans.filter(p => !p.subtasks.some(s => s.status === 'failed')).length;
    const accuracy = plans.length > 0 ? noFail / plans.length : 1;

    return {
      totalTasks, totalSubtasks,
      avgSubtasksPerTask: Math.round(avgSub * 100) / 100,
      avgCompletionTimeMs: Math.round(avgTime),
      successRate: Math.round(success * 100) / 100,
      decompositionAccuracy: Math.round(accuracy * 100) / 100,
    };
  }

  getPlan(taskId: string): DecompositionPlan | null {
    return this.plans.get(taskId) ?? null;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __intelligentTaskDecomposer__: IntelligentTaskDecomposer | undefined;
}

export function getTaskDecomposer(): IntelligentTaskDecomposer {
  if (!globalThis.__intelligentTaskDecomposer__) {
    globalThis.__intelligentTaskDecomposer__ = new IntelligentTaskDecomposer();
  }
  return globalThis.__intelligentTaskDecomposer__;
}
