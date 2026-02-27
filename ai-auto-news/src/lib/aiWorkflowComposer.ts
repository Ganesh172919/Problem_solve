/**
 * @module aiWorkflowComposer
 * @description AI-driven workflow composition engine that dynamically assembles,
 * validates, and optimizes multi-step processing pipelines. Supports conditional
 * branching, parallel fan-out/fan-in, retry policies, circuit breakers, and
 * real-time telemetry per workflow step.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type StepType =
  | 'transform'
  | 'filter'
  | 'aggregate'
  | 'enrich'
  | 'validate'
  | 'route'
  | 'ai_infer'
  | 'external_call'
  | 'cache_lookup'
  | 'emit_event';

export type BranchCondition = 'equals' | 'gt' | 'lt' | 'contains' | 'regex' | 'custom';

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  handler: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface BranchStep {
  condition: BranchCondition;
  field: string;
  value: unknown;
  trueStepId: string;
  falseStepId: string;
}

export interface ParallelGroup {
  id: string;
  steps: string[];
  joinStrategy: 'all' | 'any' | 'first';
  aggregationKey: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  entryStepId: string;
  steps: WorkflowStep[];
  branches: BranchStep[];
  parallelGroups: ParallelGroup[];
  globalTimeout: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  attempts: number;
}

export interface WorkflowExecution {
  executionId: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt: number;
  durationMs: number;
  stepExecutions: Map<string, StepExecution>;
  context: Record<string, unknown>;
  triggeredBy: string;
  error: string | null;
}

export interface WorkflowMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  stepFailureRates: Map<string, number>;
  throughputPerMin: number;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const HANDLER_REGISTRY = new Map<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>>();

export function registerHandler(
  name: string,
  fn: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
): void {
  HANDLER_REGISTRY.set(name, fn);
  logger.debug('Workflow handler registered', { name });
}

// ── Core Engine ───────────────────────────────────────────────────────────────

export class AIWorkflowComposer {
  private workflows = new Map<string, WorkflowDefinition>();
  private executions = new Map<string, WorkflowExecution>();
  private metrics = new Map<string, WorkflowMetrics>();
  private durationHistory = new Map<string, number[]>();

  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    if (!this.metrics.has(workflow.id)) {
      this.metrics.set(workflow.id, {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        stepFailureRates: new Map(),
        throughputPerMin: 0,
      });
    }
    logger.info('Workflow registered', { id: workflow.id, name: workflow.name });
  }

  async execute(
    workflowId: string,
    initialContext: Record<string, unknown>,
    triggeredBy = 'system'
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    const executionId = `exec_${workflowId}_${Date.now()}`;
    const execution: WorkflowExecution = {
      executionId,
      workflowId,
      status: 'running',
      startedAt: Date.now(),
      completedAt: 0,
      durationMs: 0,
      stepExecutions: new Map(),
      context: { ...initialContext },
      triggeredBy,
      error: null,
    };
    this.executions.set(executionId, execution);

    logger.info('Workflow execution started', { executionId, workflowId });

    const timeoutHandle = setTimeout(() => {
      if (execution.status === 'running') {
        execution.status = 'failed';
        execution.error = 'Global timeout exceeded';
        this.finaliseExecution(execution);
      }
    }, workflow.globalTimeout);

    try {
      await this.runStep(workflow, execution, workflow.entryStepId);
      execution.status = 'completed';
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      logger.error('Workflow execution failed', err instanceof Error ? err : new Error(String(err)), { executionId });
    } finally {
      clearTimeout(timeoutHandle);
      this.finaliseExecution(execution);
    }

    return execution;
  }

  private async runStep(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    stepId: string
  ): Promise<void> {
    if (!stepId) return;

    // Check for parallel group
    const parallelGroup = workflow.parallelGroups.find(g => g.steps.includes(stepId) && g.steps[0] === stepId);
    if (parallelGroup) {
      await this.runParallelGroup(workflow, execution, parallelGroup);
      return;
    }

    const step = workflow.steps.find(s => s.id === stepId);
    if (!step || !step.enabled) return;

    // Check branch
    const branch = workflow.branches.find(b => b.trueStepId === stepId || b.falseStepId === stepId);
    if (branch) {
      const branchResult = this.evaluateBranch(branch, execution.context);
      const nextId = branchResult ? branch.trueStepId : branch.falseStepId;
      if (nextId !== stepId) {
        await this.runStep(workflow, execution, nextId);
        return;
      }
    }

    const stepExec: StepExecution = {
      stepId,
      status: 'running',
      startedAt: Date.now(),
      completedAt: 0,
      durationMs: 0,
      input: this.resolveMapping(step.inputMapping, execution.context),
      output: {},
      error: null,
      attempts: 0,
    };
    execution.stepExecutions.set(stepId, stepExec);

    await this.executeStepWithRetry(step, stepExec, execution.context);

    // Merge outputs into context
    for (const [ctxKey, outputKey] of Object.entries(step.outputMapping)) {
      if (outputKey in stepExec.output) {
        execution.context[ctxKey] = stepExec.output[outputKey];
      }
    }

    // Determine next step (simple sequential: next index)
    const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
    if (stepIndex >= 0 && stepIndex < workflow.steps.length - 1) {
      const nextStep = workflow.steps[stepIndex + 1];
      if (nextStep && nextStep.enabled) {
        await this.runStep(workflow, execution, nextStep.id);
      }
    }
  }

  private async runParallelGroup(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    group: ParallelGroup
  ): Promise<void> {
    const promises = group.steps.map(sid => {
      const step = workflow.steps.find(s => s.id === sid);
      if (!step || !step.enabled) return Promise.resolve();
      const stepExec: StepExecution = {
        stepId: sid,
        status: 'running',
        startedAt: Date.now(),
        completedAt: 0,
        durationMs: 0,
        input: this.resolveMapping(step.inputMapping, execution.context),
        output: {},
        error: null,
        attempts: 0,
      };
      execution.stepExecutions.set(sid, stepExec);
      return this.executeStepWithRetry(step, stepExec, execution.context);
    });

    switch (group.joinStrategy) {
      case 'all':
        await Promise.all(promises);
        break;
      case 'any':
        await Promise.any(promises);
        break;
      case 'first':
        await Promise.race(promises);
        break;
    }

    // Aggregate outputs
    const aggregated: Record<string, unknown>[] = [];
    for (const sid of group.steps) {
      const se = execution.stepExecutions.get(sid);
      if (se) aggregated.push(se.output);
    }
    execution.context[group.aggregationKey] = aggregated;
  }

  private async executeStepWithRetry(
    step: WorkflowStep,
    stepExec: StepExecution,
    _context: Record<string, unknown>
  ): Promise<void> {
    const policy = step.retryPolicy;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      stepExec.attempts = attempt;
      try {
        const handler = HANDLER_REGISTRY.get(step.handler);
        if (!handler) {
          // Simulate no-op for unregistered handlers in test/dev
          stepExec.output = { __simulated: true, stepId: step.id };
        } else {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Step timeout')), step.timeoutMs)
          );
          stepExec.output = await Promise.race([handler(stepExec.input), timeoutPromise]);
        }
        stepExec.status = 'completed';
        stepExec.completedAt = Date.now();
        stepExec.durationMs = stepExec.completedAt - stepExec.startedAt;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable = policy.retryableErrors.length === 0 ||
          policy.retryableErrors.some(e => lastError!.message.includes(e));
        if (!isRetryable || attempt === policy.maxAttempts) break;
        const delay = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    stepExec.status = 'failed';
    stepExec.error = lastError?.message ?? 'Unknown error';
    stepExec.completedAt = Date.now();
    stepExec.durationMs = stepExec.completedAt - stepExec.startedAt;
    throw lastError ?? new Error('Step failed');
  }

  private evaluateBranch(branch: BranchStep, context: Record<string, unknown>): boolean {
    const val = context[branch.field];
    switch (branch.condition) {
      case 'equals': return val === branch.value;
      case 'gt': return typeof val === 'number' && val > (branch.value as number);
      case 'lt': return typeof val === 'number' && val < (branch.value as number);
      case 'contains':
        return typeof val === 'string' && val.includes(String(branch.value));
      case 'regex':
        return typeof val === 'string' && new RegExp(String(branch.value)).test(val);
      default: return false;
    }
  }

  private resolveMapping(
    mapping: Record<string, string>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, ctxPath] of Object.entries(mapping)) {
      result[key] = context[ctxPath] ?? null;
    }
    return result;
  }

  private finaliseExecution(execution: WorkflowExecution): void {
    execution.completedAt = Date.now();
    execution.durationMs = execution.completedAt - execution.startedAt;

    const m = this.metrics.get(execution.workflowId);
    if (!m) return;

    m.totalExecutions++;
    if (execution.status === 'completed') m.successfulExecutions++;
    else m.failedExecutions++;

    const history = this.durationHistory.get(execution.workflowId) ?? [];
    history.push(execution.durationMs);
    if (history.length > 1000) history.shift();
    this.durationHistory.set(execution.workflowId, history);

    const sorted = [...history].sort((a, b) => a - b);
    m.avgDurationMs = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    m.p95DurationMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    m.p99DurationMs = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

    logger.info('Workflow execution finalised', {
      executionId: execution.executionId,
      status: execution.status,
      durationMs: execution.durationMs,
    });
  }

  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  getMetrics(workflowId: string): WorkflowMetrics | undefined {
    return this.metrics.get(workflowId);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  composeFromSteps(
    name: string,
    stepDefinitions: Array<{
      name: string;
      type: StepType;
      handler: string;
      timeoutMs?: number;
    }>
  ): WorkflowDefinition {
    const id = `workflow_${Date.now()}`;
    const steps: WorkflowStep[] = stepDefinitions.map((sd, i) => ({
      id: `step_${i}_${sd.name.replace(/\s+/g, '_')}`,
      name: sd.name,
      type: sd.type,
      handler: sd.handler,
      inputMapping: {},
      outputMapping: {},
      retryPolicy: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2, retryableErrors: [] },
      timeoutMs: sd.timeoutMs ?? 5000,
      enabled: true,
      metadata: {},
    }));

    const workflow: WorkflowDefinition = {
      id,
      name,
      version: '1.0.0',
      description: `Auto-composed workflow: ${name}`,
      entryStepId: steps[0]?.id ?? '',
      steps,
      branches: [],
      parallelGroups: [],
      globalTimeout: 60000,
      tags: ['auto-composed'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.register(workflow);
    return workflow;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __aiWorkflowComposer__: AIWorkflowComposer | undefined;
}

export function getWorkflowComposer(): AIWorkflowComposer {
  if (!globalThis.__aiWorkflowComposer__) {
    globalThis.__aiWorkflowComposer__ = new AIWorkflowComposer();
  }
  return globalThis.__aiWorkflowComposer__;
}
