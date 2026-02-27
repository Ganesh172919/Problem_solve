import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  NeuralArchitectureSearch,
  type SearchSpace,
} from '../../../src/lib/neuralArchitectureSearch';

describe('NeuralArchitectureSearch', () => {
  let nas: NeuralArchitectureSearch;
  let space: SearchSpace;

  beforeEach(() => {
    nas = new NeuralArchitectureSearch({ surrogateModelEnabled: true, mutationRate: 0.2, crossoverRate: 0.5 });
    space = nas.defineSearchSpace({
      name: 'test-space',
      taskType: 'classification',
      maxDepth: 4,
      maxWidth: 4,
      allowedLayerTypes: ['linear', 'attention', 'norm'],
      allowedActivations: ['relu', 'gelu'],
      unitOptions: [64, 128, 256],
      headOptions: [4, 8],
      dropoutOptions: [0, 0.1, 0.2],
      inputDim: 128,
      outputDim: 10,
      hardwareConstraints: {},
    });
  });

  it('defines a search space with a generated ID', () => {
    expect(space.spaceId).toMatch(/^space_/);
    expect(space.inputDim).toBe(128);
    expect(space.outputDim).toBe(10);
    expect(space.allowedLayerTypes).toContain('linear');
  });

  it('generates a random architecture with cells and genome', () => {
    const arch = nas.generateRandomArchitecture(space.spaceId);
    expect(arch.archId).toMatch(/^arch_/);
    expect(arch.cells.length).toBeGreaterThanOrEqual(2);
    expect(arch.encodedGenome.length).toBeGreaterThan(0);
    expect(arch.status).toBe('candidate');
  });

  it('evaluates architecture and populates metrics', () => {
    const arch = nas.generateRandomArchitecture(space.spaceId);
    const evaluated = nas.evaluateArchitecture(arch.archId, 'gpu');
    expect(evaluated.status).toBe('evaluated');
    expect(evaluated.metrics.validationAccuracy).toBeGreaterThan(0);
    expect(evaluated.metrics.latencyMs).toBeGreaterThan(0);
    expect(evaluated.metrics.parameterCount).toBeGreaterThan(0);
  });

  it('mutates architecture preserving generation lineage', () => {
    const parent = nas.generateRandomArchitecture(space.spaceId, 0);
    nas.evaluateArchitecture(parent.archId, 'gpu');
    const child = nas.mutateArchitecture(parent.archId, space.spaceId);
    expect(child.generation).toBe(1);
    expect(child.parentIds).toContain(parent.archId);
    expect(child.status).toBe('candidate');
  });

  it('performs crossover between two parents', () => {
    const parentA = nas.generateRandomArchitecture(space.spaceId, 0);
    const parentB = nas.generateRandomArchitecture(space.spaceId, 0);
    nas.evaluateArchitecture(parentA.archId, 'gpu');
    nas.evaluateArchitecture(parentB.archId, 'gpu');
    const child = nas.crossoverArchitectures(parentA.archId, parentB.archId);
    expect(child.parentIds).toEqual(expect.arrayContaining([parentA.archId, parentB.archId]));
    expect(child.cells.length).toBeGreaterThan(0);
  });

  it('computes Pareto front from a population', () => {
    const archs = Array.from({ length: 6 }, () => {
      const a = nas.generateRandomArchitecture(space.spaceId);
      return nas.evaluateArchitecture(a.archId, 'gpu');
    });
    const front = nas.computeParetoFront(
      archs.map(a => a.archId),
      [
        { metric: 'validationAccuracy', direction: 'maximize', weight: 1 },
        { metric: 'latencyMs', direction: 'minimize', weight: 1 },
      ],
    );
    expect(front.length).toBeGreaterThanOrEqual(1);
    expect(front.length).toBeLessThanOrEqual(archs.length);
  });

  it('creates and retrieves search jobs', () => {
    const job = nas.createSearchJob({
      spaceId: space.spaceId,
      strategy: 'evolutionary',
      populationSize: 4,
      maxGenerations: 2,
      objectives: [{ metric: 'validationAccuracy', direction: 'maximize', weight: 1 }],
      hardwareTarget: 'gpu',
    });
    expect(job.jobId).toMatch(/^job_/);
    expect(job.status).toBe('pending');
    expect(nas.getJob(job.jobId)).toBeDefined();
  });

  it('lists architectures and filters by status', () => {
    const a = nas.generateRandomArchitecture(space.spaceId);
    nas.evaluateArchitecture(a.archId, 'gpu');
    const evaluated = nas.listArchitectures('evaluated');
    expect(evaluated.length).toBeGreaterThan(0);
    evaluated.forEach(arch => expect(arch.status).toBe('evaluated'));
  });

  it('exports architecture as structured object', () => {
    const arch = nas.generateRandomArchitecture(space.spaceId);
    nas.evaluateArchitecture(arch.archId, 'gpu');
    const exported = nas.exportArchitecture(arch.archId);
    expect(exported.architecture).toBeDefined();
    expect(exported.layerDetails).toBeDefined();
    expect(exported.exportedAt).toBeGreaterThan(0);
  });

  it('returns dashboard summary with aggregate stats', () => {
    nas.generateRandomArchitecture(space.spaceId);
    const summary = nas.getDashboardSummary();
    expect(summary.totalArchitectures).toBeGreaterThanOrEqual(1);
    expect(summary.searchSpaces).toBe(1);
  });
});
