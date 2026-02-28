import { describe, it, expect, beforeEach } from '@jest/globals';
import { getWorkflowEngine } from '@/lib/automationWorkflowEngine';

describe('AutomationWorkflowEngine', () => {
  let engine: ReturnType<typeof getWorkflowEngine>;

  const makeWorkflow = (overrides: Record<string, unknown> = {}) => ({
    name: 'test-workflow',
    description: 'A test workflow',
    trigger: { type: 'manual' as const, config: {} },
    steps: [
      {
        id: 'step1', name: 'Step 1', type: 'action' as const,
        config: { handler: () => ({ result: 'done' }) },
        onFailure: 'stop' as const, dependsOn: [],
      },
    ],
    variables: { env: 'test' },
    enabled: true,
    maxRetries: 0,
    timeoutMs: 5000,
    ...overrides,
  });

  beforeEach(() => {
    delete (globalThis as any).__automationWorkflowEngine__;
    engine = getWorkflowEngine();
  });

  it('should register a workflow and return an id', () => {
    const wf = engine.registerWorkflow(makeWorkflow());
    expect(wf.id).toBeDefined();
    expect(wf.name).toBe('test-workflow');
    expect(wf.createdAt).toBeGreaterThan(0);
  });

  it('should execute a workflow and return completed status', async () => {
    const wf = engine.registerWorkflow(makeWorkflow());
    const exec = await engine.executeWorkflow(wf.id);

    expect(exec.status).toBe('completed');
    expect(exec.completedAt).toBeDefined();
    expect(exec.stepResults.get('step1')?.status).toBe('completed');
  });

  it('should evaluate condition operators correctly', () => {
    const vars = { count: 10, name: 'hello world' };

    expect(engine.evaluateCondition({ field: 'count', operator: 'eq', value: 10 }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'count', operator: 'neq', value: 5 }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'count', operator: 'gt', value: 5 }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'count', operator: 'lt', value: 20 }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'name', operator: 'contains', value: 'world' }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'name', operator: 'exists', value: null }, vars)).toBe(true);
    expect(engine.evaluateCondition({ field: 'missing', operator: 'exists', value: null }, vars)).toBe(false);
  });

  it('should cancel a running execution', async () => {
    const wf = engine.registerWorkflow(makeWorkflow({
      steps: [{
        id: 'slow', name: 'Slow Step', type: 'action' as const,
        config: { handler: () => new Promise((r) => setTimeout(r, 500)) },
        onFailure: 'stop' as const, dependsOn: [],
      }],
      timeoutMs: 0,
    }));

    const execPromise = engine.executeWorkflow(wf.id);
    await new Promise((r) => setTimeout(r, 50));

    const active = engine.getActiveExecutions();
    expect(active.length).toBeGreaterThanOrEqual(1);
    const cancelled = engine.cancelExecution(active[0].id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.completedAt).toBeDefined();

    await execPromise;
  });

  it('should retrieve a workflow by id', () => {
    const wf = engine.registerWorkflow(makeWorkflow());
    const fetched = engine.getWorkflow(wf.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('test-workflow');
  });

  it('should return null for nonexistent workflow', () => {
    expect(engine.getWorkflow('nonexistent')).toBeNull();
  });

  it('should retrieve an execution by id', async () => {
    const wf = engine.registerWorkflow(makeWorkflow());
    const exec = await engine.executeWorkflow(wf.id);
    const fetched = engine.getExecution(exec.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.workflowId).toBe(wf.id);
  });

  it('should return workflow stats', async () => {
    const wf = engine.registerWorkflow(makeWorkflow());
    await engine.executeWorkflow(wf.id);

    const stats = engine.getStats();
    expect(stats.totalWorkflows).toBe(1);
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successRate).toBe(1);
    expect(stats.activeExecutions).toBe(0);
  });

  it('should return active executions', () => {
    const active = engine.getActiveExecutions();
    expect(Array.isArray(active)).toBe(true);
    expect(active).toHaveLength(0);
  });

  it('should throw when executing a disabled workflow', async () => {
    const wf = engine.registerWorkflow(makeWorkflow({ enabled: false }));
    await expect(engine.executeWorkflow(wf.id)).rejects.toThrow('disabled');
  });
});
