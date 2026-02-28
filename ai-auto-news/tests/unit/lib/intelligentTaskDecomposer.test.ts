import { describe, it, expect, beforeEach } from '@jest/globals';
import { getTaskDecomposer } from '@/lib/intelligentTaskDecomposer';
import type { TaskInput } from '@/lib/intelligentTaskDecomposer';

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'task1', description: 'implement and deploy a microservice',
    context: {}, constraints: ['deploy to production'], priority: 5,
    ...overrides,
  };
}

describe('IntelligentTaskDecomposer', () => {
  let decomposer: ReturnType<typeof getTaskDecomposer>;

  beforeEach(() => {
    delete (globalThis as any).__intelligentTaskDecomposer__;
    decomposer = getTaskDecomposer();
  });

  it('decompose creates a plan with subtasks', () => {
    const plan = decomposer.decompose(makeTask());
    expect(plan.taskId).toBe('task1');
    expect(plan.subtasks.length).toBeGreaterThan(0);
    expect(plan.criticalPath.length).toBeGreaterThan(0);
    expect(plan.parallelGroups.length).toBeGreaterThan(0);
  });

  it('getExecutionOrder returns parallel groups of subtasks', () => {
    const plan = decomposer.decompose(makeTask());
    const groups = decomposer.getExecutionOrder(plan);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].length).toBeGreaterThan(0);
    expect(groups[0][0]).toHaveProperty('id');
  });

  it('findCriticalPath returns correct critical path', () => {
    const plan = decomposer.decompose(makeTask());
    const path = decomposer.findCriticalPath(plan);
    expect(path.length).toBeGreaterThan(0);
    expect(plan.subtasks.map(s => s.id)).toEqual(expect.arrayContaining(path));
  });

  it('startSubtask and completeSubtask transition status', () => {
    const plan = decomposer.decompose(makeTask());
    const readyTasks = decomposer.getReadyTasks('task1');
    expect(readyTasks.length).toBeGreaterThan(0);

    const first = readyTasks[0];
    const started = decomposer.startSubtask(first.id);
    expect(started.status).toBe('in_progress');

    const completed = decomposer.completeSubtask(first.id, { output: 'done' });
    expect(completed.status).toBe('completed');
  });

  it('failSubtask marks subtask as failed', () => {
    const plan = decomposer.decompose(makeTask());
    const readyTasks = decomposer.getReadyTasks('task1');
    const first = readyTasks[0];
    decomposer.startSubtask(first.id);
    const failed = decomposer.failSubtask(first.id, 'timeout');
    expect(failed.status).toBe('failed');
    expect(failed.result).toEqual({ error: 'timeout' });
  });

  it('getProgress returns accurate progress', () => {
    const plan = decomposer.decompose(makeTask());
    const progress = decomposer.getProgress('task1');
    expect(progress.taskId).toBe('task1');
    expect(progress.totalSubtasks).toBe(plan.subtasks.length);
    expect(progress.completed).toBe(0);
    expect(progress.percentComplete).toBe(0);
  });

  it('getReadyTasks returns tasks with completed deps', () => {
    decomposer.decompose(makeTask());
    const ready = decomposer.getReadyTasks('task1');
    expect(ready.length).toBeGreaterThan(0);
    for (const task of ready) {
      expect(task.status).toBe('pending');
    }
  });

  it('estimateComplexity returns scores for different descriptions', () => {
    const simple = decomposer.estimateComplexity('update a config file');
    const complex = decomposer.estimateComplexity('deploy and orchestrate distributed machine_learning');
    expect(simple).toBeGreaterThanOrEqual(1);
    expect(simple).toBeLessThanOrEqual(10);
    expect(complex).toBeGreaterThan(simple);
  });

  it('getStats returns accurate stats', () => {
    decomposer.decompose(makeTask());
    const stats = decomposer.getStats();
    expect(stats.totalTasks).toBe(1);
    expect(stats.totalSubtasks).toBeGreaterThan(0);
    expect(stats.avgSubtasksPerTask).toBeGreaterThan(0);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
  });
});
