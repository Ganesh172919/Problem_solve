/**
 * Automation Workflow Engine for orchestrating complex workflows.
 *
 * Provides workflow definition with steps and conditions, trigger-based execution
 * (event, schedule, manual, webhook), conditional branching, parallel execution,
 * step retry with exponential backoff, timeout enforcement, variable interpolation
 * between steps, and execution history with audit capabilities.
 */

import { getLogger } from './logger';

const logger = getLogger();

export type StepType = 'action' | 'condition' | 'parallel' | 'loop' | 'delay' | 'transform' | 'notify';
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface WorkflowTrigger { type: 'event' | 'schedule' | 'manual' | 'webhook'; config: Record<string, unknown>; }
export interface StepCondition { field: string; operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists'; value: unknown; }
export interface RetryPolicy { maxRetries: number; delayMs: number; backoffMultiplier: number; }

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
  condition?: StepCondition;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  onFailure: 'stop' | 'continue' | 'retry';
  dependsOn: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  variables: Record<string, unknown>;
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  stepResults: Map<string, StepResult>;
  variables: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  error?: string;
  triggeredBy: string;
}

export interface WorkflowStats {
  totalWorkflows: number;
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  activeExecutions: number;
  failuresByStep: Record<string, number>;
}

export class AutomationWorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();

  registerWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Workflow {
    const now = Date.now();
    const created: Workflow = { ...workflow, id: this.generateId('wf'), createdAt: now, updatedAt: now };
    this.workflows.set(created.id, created);
    logger.info(`Workflow registered: ${created.name} (${created.id})`);
    return { ...created };
  }

  updateWorkflow(workflowId: string, updates: Partial<Omit<Workflow, 'id' | 'createdAt'>>): Workflow {
    const existing = this.workflows.get(workflowId);
    if (!existing) throw new Error(`Workflow "${workflowId}" not found`);
    const updated: Workflow = { ...existing, ...updates, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
    this.workflows.set(workflowId, updated);
    logger.info(`Workflow updated: ${workflowId}`);
    return { ...updated };
  }

  deleteWorkflow(workflowId: string): void {
    if (!this.workflows.has(workflowId)) throw new Error(`Workflow "${workflowId}" not found`);
    this.workflows.delete(workflowId);
    logger.info(`Workflow deleted: ${workflowId}`);
  }

  async executeWorkflow(
    workflowId: string, input?: Record<string, unknown>, triggeredBy?: string,
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);
    if (!workflow.enabled) throw new Error(`Workflow "${workflowId}" is disabled`);

    const execution: WorkflowExecution = {
      id: this.generateId('exec'), workflowId, status: 'running',
      stepResults: new Map(), variables: { ...workflow.variables, ...input },
      startedAt: Date.now(), triggeredBy: triggeredBy ?? 'system',
    };
    for (const step of workflow.steps) {
      execution.stepResults.set(step.id, { stepId: step.id, status: 'pending', retryCount: 0 });
    }
    this.executions.set(execution.id, execution);
    logger.info(`Execution started: ${execution.id} for workflow ${workflowId}`);

    try {
      const ordered = this.topologicalSort(workflow.steps);
      await this.runWithTimeout(this.executeSteps(ordered, workflow, execution), workflow.timeoutMs, execution);
      if (execution.status === 'running') execution.status = 'completed';
    } catch (err) {
      if (execution.status === 'running') {
        execution.status = 'failed';
        execution.error = err instanceof Error ? err.message : String(err);
      }
    }
    execution.completedAt = Date.now();
    logger.info(`Execution ${execution.id} finished with status: ${execution.status}`);
    return execution;
  }

  cancelExecution(executionId: string): WorkflowExecution {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution "${executionId}" not found`);
    if (execution.status !== 'running') throw new Error(`Execution "${executionId}" is not running`);
    execution.status = 'cancelled';
    execution.completedAt = Date.now();
    logger.info(`Execution cancelled: ${executionId}`);
    return execution;
  }

  getWorkflow(workflowId: string): Workflow | null {
    const wf = this.workflows.get(workflowId);
    return wf ? { ...wf } : null;
  }

  getExecution(executionId: string): WorkflowExecution | null {
    return this.executions.get(executionId) ?? null;
  }

  getWorkflowExecutions(workflowId: string): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter((e) => e.workflowId === workflowId);
  }

  evaluateCondition(condition: StepCondition, variables: Record<string, unknown>): boolean {
    const actual = this.resolveField(condition.field, variables);
    switch (condition.operator) {
      case 'eq':
        return actual === condition.value;
      case 'neq':
        return actual !== condition.value;
      case 'gt':
        return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
      case 'lt':
        return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
      case 'contains':
        return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
      case 'exists':
        return actual !== undefined && actual !== null;
      default:
        return false;
    }
  }

  getStats(): WorkflowStats {
    const allExecs = Array.from(this.executions.values());
    const completed = allExecs.filter((e) => e.status === 'completed');
    const durations = allExecs.filter((e) => e.completedAt).map((e) => e.completedAt! - e.startedAt);
    const failuresByStep: Record<string, number> = {};
    for (const exec of allExecs) {
      for (const [stepId, result] of exec.stepResults) {
        if (result.status === 'failed') failuresByStep[stepId] = (failuresByStep[stepId] ?? 0) + 1;
      }
    }
    return {
      totalWorkflows: this.workflows.size, totalExecutions: allExecs.length,
      successRate: allExecs.length > 0 ? completed.length / allExecs.length : 0,
      avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      activeExecutions: allExecs.filter((e) => e.status === 'running').length, failuresByStep,
    };
  }

  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter((e) => e.status === 'running');
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async executeSteps(
    steps: WorkflowStep[], workflow: Workflow, execution: WorkflowExecution,
  ): Promise<void> {
    for (const step of steps) {
      if (execution.status !== 'running') break;
      const depsReady = step.dependsOn.every((depId) => {
        const r = execution.stepResults.get(depId);
        return r && (r.status === 'completed' || r.status === 'skipped');
      });
      if (!depsReady) { this.setStepResult(execution, step.id, 'skipped'); continue; }
      if (step.condition && !this.evaluateCondition(step.condition, execution.variables)) {
        this.setStepResult(execution, step.id, 'skipped');
        logger.info(`Step skipped (condition not met): ${step.name}`);
        continue;
      }
      await this.executeStepWithRetry(step, workflow, execution);
    }
  }

  private async executeStepWithRetry(
    step: WorkflowStep, workflow: Workflow, execution: WorkflowExecution,
  ): Promise<void> {
    const policy = step.retryPolicy ?? { maxRetries: 0, delayMs: 0, backoffMultiplier: 1 };
    const maxAttempts = step.onFailure === 'retry' ? Math.max(policy.maxRetries, workflow.maxRetries) : policy.maxRetries;
    let attempt = 0;

    while (attempt <= maxAttempts) {
      if (execution.status !== 'running') return;

      const result = execution.stepResults.get(step.id)!;
      result.status = 'running';
      result.startedAt = Date.now();
      result.retryCount = attempt;

      try {
        const output = await this.runStepWithTimeout(step, execution);
        result.status = 'completed';
        result.output = output;
        result.completedAt = Date.now();
        execution.variables[`steps.${step.id}.output`] = output;
        logger.info(`Step completed: ${step.name}`);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.error = message;
        if (attempt < maxAttempts) {
          const delay = policy.delayMs * Math.pow(policy.backoffMultiplier, attempt);
          logger.warn(`Step "${step.name}" failed (attempt ${attempt + 1}), retrying in ${delay}ms`);
          await this.sleep(delay);
          attempt++;
          continue;
        }
        result.status = 'failed';
        result.completedAt = Date.now();
        logger.error(`Step failed: ${step.name} — ${message}`);
        if (step.onFailure === 'stop') {
          execution.status = 'failed';
          execution.error = `Step "${step.name}" failed: ${message}`;
        }
        return;
      }
    }
  }

  private async runStepWithTimeout(step: WorkflowStep, execution: WorkflowExecution): Promise<unknown> {
    const timeout = step.timeoutMs;
    if (!timeout) return this.executeStepHandler(step, execution);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${timeout}ms`)), timeout);
      this.executeStepHandler(step, execution)
        .then((val) => { clearTimeout(timer); resolve(val); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  private async executeStepHandler(step: WorkflowStep, execution: WorkflowExecution): Promise<unknown> {
    const cfg = this.interpolateConfig(step.config, execution.variables);
    switch (step.type) {
      case 'action': {
        const handler = cfg.handler;
        return typeof handler === 'function' ? handler(execution.variables, cfg) : { executed: true, config: cfg };
      }
      case 'condition': {
        const cond = cfg.condition as StepCondition | undefined;
        return cond ? this.evaluateCondition(cond, execution.variables) : false;
      }
      case 'parallel': {
        const workflow = this.workflows.get(execution.workflowId);
        if (!workflow) return [];
        const subSteps = ((cfg.steps ?? []) as string[])
          .map((id) => workflow.steps.find((s) => s.id === id))
          .filter((s): s is WorkflowStep => s !== undefined);
        return Promise.all(subSteps.map(async (sub) => {
          try {
            const output = await this.executeStepHandler(sub, execution);
            this.setStepResult(execution, sub.id, 'completed', output);
            execution.variables[`steps.${sub.id}.output`] = output;
            return { stepId: sub.id, output };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.setStepResult(execution, sub.id, 'failed', undefined, msg);
            return { stepId: sub.id, error: msg };
          }
        }));
      }
      case 'loop': {
        const items = cfg.items as unknown[] | undefined;
        if (!Array.isArray(items)) return [];
        const handler = cfg.handler;
        const results: unknown[] = [];
        for (const item of items) {
          results.push(typeof handler === 'function' ? await handler(item, execution.variables) : item);
        }
        return results;
      }
      case 'delay': {
        const ms = typeof cfg.ms === 'number' ? cfg.ms : 0;
        await this.sleep(ms);
        return { delayed: ms };
      }
      case 'transform': {
        const fn = cfg.transformer;
        return typeof fn === 'function' ? fn(execution.variables) : execution.variables;
      }
      case 'notify': {
        const message = typeof cfg.message === 'string'
          ? this.interpolateString(cfg.message, execution.variables) : 'Notification';
        logger.info(`Workflow notification: ${message}`);
        return { notified: true, message };
      }
      default:
        return { executed: false, reason: `Unknown step type: ${step.type}` };
    }
  }

  private setStepResult(
    execution: WorkflowExecution, stepId: string, status: StepResult['status'],
    output?: unknown, error?: string,
  ): void {
    const existing = execution.stepResults.get(stepId);
    if (existing) {
      existing.status = status;
      if (output !== undefined) existing.output = output;
      if (error !== undefined) existing.error = error;
      if (status !== 'pending') existing.completedAt = Date.now();
    } else {
      execution.stepResults.set(stepId, {
        stepId, status, output, error, retryCount: 0,
        completedAt: status !== 'pending' ? Date.now() : undefined,
      });
    }
  }

  /** Kahn's algorithm for topological sort based on dependsOn edges. */
  private topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, step.dependsOn.length);
      for (const dep of step.dependsOn) {
        const list = adj.get(dep) ?? [];
        list.push(step.id);
        adj.set(dep, list);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
    const ordered: WorkflowStep[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(stepMap.get(current)!);
      for (const neighbor of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (ordered.length !== steps.length) throw new Error('Cyclic dependency detected in workflow steps');
    return ordered;
  }

  private async runWithTimeout(
    promise: Promise<void>, timeoutMs: number, execution: WorkflowExecution,
  ): Promise<void> {
    if (timeoutMs <= 0) return promise;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        execution.status = 'timeout';
        execution.error = `Workflow timed out after ${timeoutMs}ms`;
        reject(new Error(execution.error));
      }, timeoutMs);
      promise
        .then(() => { clearTimeout(timer); resolve(); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  private resolveField(field: string, variables: Record<string, unknown>): unknown {
    let current: unknown = variables;
    for (const part of field.split('.')) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private interpolateConfig(config: Record<string, unknown>, vars: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = typeof value === 'string' ? this.interpolateString(value, vars) : value;
    }
    return result;
  }

  private interpolateString(template: string, vars: Record<string, unknown>): string {
    return template.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_m, expr: string) => {
      const resolved = this.resolveField(expr.trim(), vars);
      return resolved !== undefined ? String(resolved) : '';
    });
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

declare global {
  var __automationWorkflowEngine__: AutomationWorkflowEngine | undefined;
}

export function getWorkflowEngine(): AutomationWorkflowEngine {
  if (!globalThis.__automationWorkflowEngine__) {
    globalThis.__automationWorkflowEngine__ = new AutomationWorkflowEngine();
    logger.info('AutomationWorkflowEngine singleton initialized');
  }
  return globalThis.__automationWorkflowEngine__;
}
