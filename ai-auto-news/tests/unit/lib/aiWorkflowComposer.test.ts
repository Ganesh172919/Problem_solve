import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  AIWorkflowComposer,
  getWorkflowComposer,
  registerHandler,
  WorkflowDefinition,
} from '../../../src/lib/aiWorkflowComposer';

describe('AIWorkflowComposer', () => {
  beforeEach(() => {
    (globalThis as any).__aiWorkflowComposer__ = undefined;
  });

  it('singleton returns the same instance', () => {
    const a = getWorkflowComposer();
    const b = getWorkflowComposer();
    expect(a).toBe(b);
  });

  it('composeFromSteps creates a workflow with correct step count', () => {
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('Test Flow', [
      { name: 'Step A', type: 'validate', handler: 'h.validate' },
      { name: 'Step B', type: 'transform', handler: 'h.transform' },
    ]);
    expect(workflow.steps).toHaveLength(2);
    expect(workflow.name).toBe('Test Flow');
  });

  it('register stores workflow and listWorkflows returns it', () => {
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('My Workflow', [
      { name: 'S1', type: 'enrich', handler: 'h.enrich' },
    ]);
    composer.register(workflow);
    const list = composer.listWorkflows();
    expect(list.some(w => w.id === workflow.id)).toBe(true);
  });

  it('execute runs a workflow with unregistered handler (simulated)', async () => {
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('Simulated', [
      { name: 'Sim', type: 'transform', handler: 'sim.handler' },
    ]);
    const execution = await composer.execute(workflow.id, { input: 'test' });
    expect(execution.status).toBe('completed');
    expect(execution.workflowId).toBe(workflow.id);
  });

  it('execute with registered handler returns output', async () => {
    registerHandler('my.echo', async (input) => ({ ...input, echoed: true }));
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('Echo Flow', [
      { name: 'Echo', type: 'transform', handler: 'my.echo' },
    ]);
    const execution = await composer.execute(workflow.id, { msg: 'hello' });
    expect(execution.status).toBe('completed');
  });

  it('getMetrics returns metrics after execution', async () => {
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('Metrics Flow', [
      { name: 'M', type: 'filter', handler: 'noop' },
    ]);
    await composer.execute(workflow.id, {});
    const metrics = composer.getMetrics(workflow.id);
    expect(metrics).toBeDefined();
    expect(metrics!.totalExecutions).toBeGreaterThan(0);
  });

  it('getExecution returns execution by id', async () => {
    const composer = new AIWorkflowComposer();
    const workflow = composer.composeFromSteps('Lookup', [
      { name: 'S', type: 'aggregate', handler: 'noop' },
    ]);
    const execution = await composer.execute(workflow.id, {});
    const found = composer.getExecution(execution.executionId);
    expect(found).toBeDefined();
    expect(found!.executionId).toBe(execution.executionId);
  });

  it('handles unknown workflowId gracefully', async () => {
    const composer = new AIWorkflowComposer();
    await expect(composer.execute('nonexistent', {})).rejects.toThrow('Workflow not found');
  });
});
