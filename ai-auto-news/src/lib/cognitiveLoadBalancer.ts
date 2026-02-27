/**
 * @module cognitiveLoadBalancer
 * @description Cognitive load-aware request routing engine using AI-driven capacity
 * estimation, worker cognitive state modeling, complexity-based task assignment,
 * burnout prevention scheduling, intelligent queue prioritization, skill-based
 * routing for human-in-the-loop workflows, and real-time throughput optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkerType = 'ai_agent' | 'human' | 'hybrid' | 'service';
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';
export type WorkerState = 'available' | 'busy' | 'overloaded' | 'resting' | 'offline';
export type RoutingStrategy = 'least_load' | 'skill_match' | 'round_robin' | 'cognitive_aware' | 'priority_weighted';
export type QueuePriority = 1 | 2 | 3 | 4 | 5;  // 5 = highest

export interface Worker {
  workerId: string;
  name: string;
  type: WorkerType;
  skills: Record<string, number>;       // skill -> proficiency 0-1
  maxConcurrentTasks: number;
  currentLoad: number;                  // 0-1 (1 = fully loaded)
  cognitiveCapacity: number;            // 0-1 (burnout prevention)
  state: WorkerState;
  processingRatePerMs: number;          // tasks per ms
  errorRate: number;                    // 0-1
  totalTasksCompleted: number;
  lastRestAt?: number;
  metadata: Record<string, unknown>;
}

export interface Task {
  taskId: string;
  type: string;
  complexity: TaskComplexity;
  priority: QueuePriority;
  requiredSkills: string[];
  payload: Record<string, unknown>;
  estimatedDurationMs: number;
  deadline?: number;
  tenantId?: string;
  submittedAt: number;
  assignedWorker?: string;
  startedAt?: number;
  completedAt?: number;
  status: 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
}

export interface RoutingDecision {
  taskId: string;
  selectedWorker: string;
  alternativesConsidered: string[];
  strategy: RoutingStrategy;
  score: number;
  rationale: string;
  estimatedStartMs: number;
  estimatedCompletionMs: number;
}

export interface LoadBalancerMetrics {
  totalTasksQueued: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  avgQueueDepth: number;
  avgTaskDurationMs: number;
  avgWorkerLoad: number;
  throughputPerMinute: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  workerUtilization: Record<string, number>;
}

export interface WorkerHealthReport {
  workerId: string;
  state: WorkerState;
  currentLoad: number;
  cognitiveCapacity: number;
  queuedTasks: number;
  errorRate: number;
  recommendation: 'scale_up' | 'maintain' | 'rest' | 'scale_down';
}

export interface CognitiveLoadBalancerConfig {
  cognitiveOverloadThreshold?: number;
  restTriggerThreshold?: number;
  restDurationMs?: number;
  defaultStrategy?: RoutingStrategy;
  maxQueueSize?: number;
  queueTimeoutMs?: number;
  rebalanceIntervalMs?: number;
}

// ── Complexity Weights ────────────────────────────────────────────────────────

const COMPLEXITY_LOAD: Record<TaskComplexity, number> = {
  trivial: 0.05,
  simple: 0.1,
  moderate: 0.25,
  complex: 0.5,
  expert: 0.9,
};

// ── Core Class ────────────────────────────────────────────────────────────────

export class CognitiveLoadBalancer {
  private workers = new Map<string, Worker>();
  private queue: Task[] = [];
  private completedTasks: Task[] = [];
  private routingDecisions: RoutingDecision[] = [];
  private rebalanceTimer?: ReturnType<typeof setInterval>;
  private config: Required<CognitiveLoadBalancerConfig>;

  constructor(config: CognitiveLoadBalancerConfig = {}) {
    this.config = {
      cognitiveOverloadThreshold: config.cognitiveOverloadThreshold ?? 0.85,
      restTriggerThreshold: config.restTriggerThreshold ?? 0.9,
      restDurationMs: config.restDurationMs ?? 5 * 60_000,
      defaultStrategy: config.defaultStrategy ?? 'cognitive_aware',
      maxQueueSize: config.maxQueueSize ?? 10_000,
      queueTimeoutMs: config.queueTimeoutMs ?? 30 * 60_000,
      rebalanceIntervalMs: config.rebalanceIntervalMs ?? 5_000,
    };
  }

  start(): void {
    if (this.rebalanceTimer) return;
    this.rebalanceTimer = setInterval(() => this.rebalance(), this.config.rebalanceIntervalMs);
    logger.info('CognitiveLoadBalancer started');
  }

  stop(): void {
    if (this.rebalanceTimer) {
      clearInterval(this.rebalanceTimer);
      this.rebalanceTimer = undefined;
    }
  }

  // ── Worker Management ─────────────────────────────────────────────────────

  registerWorker(params: Omit<Worker, 'workerId' | 'currentLoad' | 'cognitiveCapacity' | 'state' | 'errorRate' | 'totalTasksCompleted'>): Worker {
    const worker: Worker = {
      ...params,
      workerId: `worker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      currentLoad: 0,
      cognitiveCapacity: 1,
      state: 'available',
      errorRate: 0,
      totalTasksCompleted: 0,
    };
    this.workers.set(worker.workerId, worker);
    logger.info('Worker registered', { workerId: worker.workerId, type: worker.type, name: worker.name });
    return worker;
  }

  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  listWorkers(state?: WorkerState, type?: WorkerType): Worker[] {
    let all = Array.from(this.workers.values());
    if (state) all = all.filter(w => w.state === state);
    if (type) all = all.filter(w => w.type === type);
    return all;
  }

  updateWorkerState(workerId: string, state: WorkerState): void {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);
    worker.state = state;
    if (state === 'resting') worker.lastRestAt = Date.now();
  }

  // ── Task Submission ───────────────────────────────────────────────────────

  submitTask(params: Omit<Task, 'taskId' | 'submittedAt' | 'status'>): Task {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue is full (${this.config.maxQueueSize} tasks)`);
    }

    const task: Task = {
      ...params,
      taskId: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      submittedAt: Date.now(),
      status: 'queued',
    };

    this.queue.push(task);

    // Sort queue by priority (higher = first) then by deadline
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.deadline && b.deadline) return a.deadline - b.deadline;
      return a.submittedAt - b.submittedAt;
    });

    // Try immediate dispatch
    const decision = this.route(task);
    if (decision) {
      this.assignTask(task, decision);
    }

    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.queue.find(t => t.taskId === taskId) ??
      this.completedTasks.find(t => t.taskId === taskId);
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  route(task: Task, strategy?: RoutingStrategy): RoutingDecision | null {
    const effectiveStrategy = strategy ?? this.config.defaultStrategy;
    const eligibleWorkers = this.getEligibleWorkers(task);

    if (eligibleWorkers.length === 0) return null;

    let selected: Worker;
    let rationale: string;

    if (effectiveStrategy === 'least_load') {
      selected = eligibleWorkers.reduce((min, w) => w.currentLoad < min.currentLoad ? w : min);
      rationale = `Selected worker with lowest load: ${selected.currentLoad.toFixed(2)}`;
    } else if (effectiveStrategy === 'skill_match') {
      selected = this.selectBySkillMatch(task, eligibleWorkers);
      rationale = `Selected best skill-match for required skills: ${task.requiredSkills.join(', ')}`;
    } else if (effectiveStrategy === 'round_robin') {
      const sortedByCompleted = [...eligibleWorkers].sort((a, b) => a.totalTasksCompleted - b.totalTasksCompleted);
      selected = sortedByCompleted[0]!;
      rationale = `Round-robin selected worker with fewest completed tasks`;
    } else if (effectiveStrategy === 'priority_weighted') {
      selected = this.selectByPriorityWeight(task, eligibleWorkers);
      rationale = `Priority-weighted selection for task priority ${task.priority}`;
    } else {
      // cognitive_aware (default)
      selected = this.selectCognitiveAware(task, eligibleWorkers);
      rationale = `Cognitive-aware selection: load=${selected.currentLoad.toFixed(2)}, capacity=${selected.cognitiveCapacity.toFixed(2)}`;
    }

    const loadIncrease = COMPLEXITY_LOAD[task.complexity];
    const estimatedStartMs = selected.currentLoad > 0.8 ? task.estimatedDurationMs * 0.5 : 0;
    const estimatedCompletionMs = estimatedStartMs + task.estimatedDurationMs;

    const decision: RoutingDecision = {
      taskId: task.taskId,
      selectedWorker: selected.workerId,
      alternativesConsidered: eligibleWorkers.filter(w => w.workerId !== selected.workerId).map(w => w.workerId),
      strategy: effectiveStrategy,
      score: 1 - loadIncrease,
      rationale,
      estimatedStartMs,
      estimatedCompletionMs,
    };

    this.routingDecisions.push(decision);
    if (this.routingDecisions.length > 10_000) this.routingDecisions.shift();

    return decision;
  }

  // ── Task Assignment & Completion ──────────────────────────────────────────

  private assignTask(task: Task, decision: RoutingDecision): void {
    const worker = this.workers.get(decision.selectedWorker);
    if (!worker) return;

    task.status = 'assigned';
    task.assignedWorker = decision.selectedWorker;
    task.startedAt = Date.now();

    const loadIncrease = COMPLEXITY_LOAD[task.complexity];
    worker.currentLoad = Math.min(1, worker.currentLoad + loadIncrease);
    worker.cognitiveCapacity = Math.max(0, worker.cognitiveCapacity - loadIncrease * 0.1);

    if (worker.currentLoad >= this.config.cognitiveOverloadThreshold) {
      worker.state = 'overloaded';
    } else {
      worker.state = 'busy';
    }

    logger.info('Task assigned', { taskId: task.taskId, workerId: decision.selectedWorker, strategy: decision.strategy });
  }

  completeTask(taskId: string, result?: unknown, error?: string): Task {
    const idx = this.queue.findIndex(t => t.taskId === taskId);
    if (idx === -1) throw new Error(`Task ${taskId} not found in queue`);

    const task = this.queue[idx]!;
    task.completedAt = Date.now();
    task.status = error ? 'failed' : 'completed';
    task.result = result;
    task.error = error;

    this.queue.splice(idx, 1);
    this.completedTasks.push(task);
    if (this.completedTasks.length > 50_000) this.completedTasks.shift();

    // Release worker load
    if (task.assignedWorker) {
      const worker = this.workers.get(task.assignedWorker);
      if (worker) {
        const loadRelease = COMPLEXITY_LOAD[task.complexity];
        worker.currentLoad = Math.max(0, worker.currentLoad - loadRelease);
        worker.totalTasksCompleted += 1;

        if (error) {
          worker.errorRate = (worker.errorRate * 0.9 + 0.1);
        } else {
          worker.errorRate = worker.errorRate * 0.95;
          // Gradually restore cognitive capacity on success
          worker.cognitiveCapacity = Math.min(1, worker.cognitiveCapacity + 0.02);
        }

        // Update state
        if (worker.currentLoad < 0.01) {
          worker.state = 'available';
        } else if (worker.currentLoad < this.config.cognitiveOverloadThreshold) {
          worker.state = 'busy';
        }

        // Check if rest needed
        if (worker.cognitiveCapacity < 1 - this.config.restTriggerThreshold) {
          worker.state = 'resting';
          worker.lastRestAt = Date.now();
        }
      }
    }

    return task;
  }

  cancelTask(taskId: string): void {
    const idx = this.queue.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      this.queue[idx]!.status = 'cancelled';
      this.queue.splice(idx, 1);
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): LoadBalancerMetrics {
    const allTasks = [...this.completedTasks, ...this.queue];
    const completed = this.completedTasks.filter(t => t.completedAt);
    const failed = this.completedTasks.filter(t => t.status === 'failed').length;

    const durations = completed
      .filter(t => t.startedAt && t.completedAt)
      .map(t => t.completedAt! - t.startedAt!);

    durations.sort((a, b) => a - b);

    const workers = Array.from(this.workers.values());
    const workerUtilization: Record<string, number> = {};
    for (const w of workers) workerUtilization[w.workerId] = w.currentLoad;

    const oneMinAgo = Date.now() - 60_000;
    const throughput = this.completedTasks.filter(t => t.completedAt && t.completedAt > oneMinAgo).length;

    return {
      totalTasksQueued: this.queue.length,
      totalTasksCompleted: this.completedTasks.length,
      totalTasksFailed: failed,
      avgQueueDepth: this.queue.length,
      avgTaskDurationMs: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
      avgWorkerLoad: workers.length > 0 ? workers.reduce((s, w) => s + w.currentLoad, 0) / workers.length : 0,
      throughputPerMinute: throughput,
      p50LatencyMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] ?? 0 : 0,
      p99LatencyMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] ?? 0 : 0,
      workerUtilization,
    };
  }

  getWorkerHealthReports(): WorkerHealthReport[] {
    return Array.from(this.workers.values()).map(w => {
      const queuedTasks = this.queue.filter(t => t.assignedWorker === w.workerId).length;
      let recommendation: WorkerHealthReport['recommendation'] = 'maintain';
      if (w.currentLoad > 0.9) recommendation = 'scale_up';
      else if (w.currentLoad < 0.1 && this.queue.length === 0) recommendation = 'scale_down';
      else if (w.cognitiveCapacity < 0.2) recommendation = 'rest';

      return { workerId: w.workerId, state: w.state, currentLoad: w.currentLoad, cognitiveCapacity: w.cognitiveCapacity, queuedTasks, errorRate: w.errorRate, recommendation };
    });
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private getEligibleWorkers(task: Task): Worker[] {
    return Array.from(this.workers.values()).filter(w => {
      if (w.state === 'offline' || w.state === 'resting') return false;
      if (w.currentLoad >= 1) return false;
      if (task.requiredSkills.length > 0) {
        return task.requiredSkills.every(skill => (w.skills[skill] ?? 0) > 0.3);
      }
      return true;
    });
  }

  private selectBySkillMatch(task: Task, workers: Worker[]): Worker {
    if (task.requiredSkills.length === 0) return workers[0]!;
    return workers.reduce((best, w) => {
      const score = task.requiredSkills.reduce((s, skill) => s + (w.skills[skill] ?? 0), 0) / task.requiredSkills.length;
      const bestScore = task.requiredSkills.reduce((s, skill) => s + (best.skills[skill] ?? 0), 0) / task.requiredSkills.length;
      return score > bestScore ? w : best;
    });
  }

  private selectByPriorityWeight(task: Task, workers: Worker[]): Worker {
    const complexityLoad = COMPLEXITY_LOAD[task.complexity];
    return workers.reduce((best, w) => {
      const capacity = w.maxConcurrentTasks > 0 ? (1 - w.currentLoad) * w.maxConcurrentTasks : 1 - w.currentLoad;
      const bestCapacity = best.maxConcurrentTasks > 0 ? (1 - best.currentLoad) * best.maxConcurrentTasks : 1 - best.currentLoad;
      const score = capacity - complexityLoad;
      const bestScore = bestCapacity - complexityLoad;
      return score > bestScore ? w : best;
    });
  }

  private selectCognitiveAware(task: Task, workers: Worker[]): Worker {
    const complexityLoad = COMPLEXITY_LOAD[task.complexity];
    return workers.reduce((best, w) => {
      const cogScore = w.cognitiveCapacity * (1 - w.currentLoad) * (1 - w.errorRate);
      const complexityFit = Math.abs(complexityLoad - w.currentLoad) < 0.3 ? 1.1 : 1.0;
      const score = cogScore * complexityFit;

      const bestCogScore = best.cognitiveCapacity * (1 - best.currentLoad) * (1 - best.errorRate);
      const bestComplexityFit = Math.abs(complexityLoad - best.currentLoad) < 0.3 ? 1.1 : 1.0;
      const bestScore = bestCogScore * bestComplexityFit;

      return score > bestScore ? w : best;
    });
  }

  private rebalance(): void {
    // Check timed-out tasks
    const now = Date.now();
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i]!;
      if (now - task.submittedAt > this.config.queueTimeoutMs) {
        task.status = 'failed';
        task.error = 'Task timed out in queue';
        this.queue.splice(i, 1);
        this.completedTasks.push(task);
      }
    }

    // Restore resting workers
    for (const worker of this.workers.values()) {
      if (worker.state === 'resting' && worker.lastRestAt && now - worker.lastRestAt > this.config.restDurationMs) {
        worker.state = 'available';
        worker.cognitiveCapacity = Math.min(1, worker.cognitiveCapacity + 0.3);
        logger.info('Worker recovered from rest', { workerId: worker.workerId });
      }
    }

    // Try dispatching queued tasks
    for (const task of this.queue.filter(t => t.status === 'queued')) {
      const decision = this.route(task);
      if (decision) this.assignTask(task, decision);
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getCognitiveLoadBalancer(): CognitiveLoadBalancer {
  const key = '__cognitiveLoadBalancer__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new CognitiveLoadBalancer();
  }
  return (globalThis as Record<string, unknown>)[key] as CognitiveLoadBalancer;
}
