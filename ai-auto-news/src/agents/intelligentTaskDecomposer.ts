/**
 * Intelligent Task Decomposition Engine
 *
 * Advanced system for breaking down complex requirements into
 * executable subtasks with dependency resolution and optimization.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface ComplexTask {
  id: string;
  description: string;
  requirements: Requirement[];
  constraints: TaskConstraints;
  context: TaskContext;
  priority: number;
}

export interface Requirement {
  id: string;
  type: 'functional' | 'non-functional' | 'technical' | 'business';
  description: string;
  acceptance: string[];
  dependencies: string[];
  estimatedComplexity: number;
}

export interface TaskConstraints {
  timeLimit?: number;
  budgetLimit?: number;
  resourceLimits?: Map<string, number>;
  qualityThresholds?: QualityMetrics;
  mustUse?: string[];
  mustAvoid?: string[];
}

export interface TaskContext {
  existingArchitecture: ArchitectureInfo;
  availableResources: ResourceInfo;
  teamCapabilities: string[];
  projectPhase: 'planning' | 'development' | 'testing' | 'production';
}

export interface ArchitectureInfo {
  patterns: string[];
  technologies: string[];
  layers: string[];
  integrations: string[];
}

export interface ResourceInfo {
  compute: number;
  storage: number;
  network: number;
  apis: string[];
}

export interface QualityMetrics {
  codeQuality: number;
  testCoverage: number;
  performance: number;
  security: number;
  maintainability: number;
}

export interface DecomposedTask {
  id: string;
  parentId: string;
  level: number;
  name: string;
  description: string;
  type: 'atomic' | 'composite';
  estimatedEffort: number;
  estimatedDuration: number;
  dependencies: string[];
  prerequisites: string[];
  outputs: string[];
  validationRules: ValidationRule[];
  assignedAgent?: string;
  status: 'pending' | 'ready' | 'in_progress' | 'blocked' | 'completed' | 'failed';
}

export interface ValidationRule {
  type: string;
  condition: string;
  errorMessage: string;
  severity: 'error' | 'warning' | 'info';
}

export interface DecompositionStrategy {
  name: string;
  approach: 'top-down' | 'bottom-up' | 'hybrid';
  granularity: 'coarse' | 'medium' | 'fine';
  parallelization: boolean;
  optimization: 'speed' | 'quality' | 'cost' | 'balanced';
}

export interface ExecutionPlan {
  tasks: DecomposedTask[];
  dependencies: Map<string, string[]>;
  criticalPath: string[];
  parallelGroups: string[][];
  estimatedTotalEffort: number;
  estimatedDuration: number;
  riskFactors: RiskFactor[];
}

export interface RiskFactor {
  taskId: string;
  risk: string;
  probability: number;
  impact: number;
  mitigation: string;
}

class IntelligentTaskDecomposer {
  private strategies: Map<string, DecompositionStrategy> = new Map();
  private decompositionHistory: Map<string, ExecutionPlan> = new Map();

  constructor() {
    this.initializeStrategies();
  }

  /**
   * Decompose complex task into executable subtasks
   */
  async decompose(
    task: ComplexTask,
    strategy?: DecompositionStrategy
  ): Promise<ExecutionPlan> {
    logger.info('Starting task decomposition', { taskId: task.id });

    const selectedStrategy = strategy || this.selectStrategy(task);

    // Phase 1: Analyze requirements
    const analyzed = await this.analyzeRequirements(task);

    // Phase 2: Create task hierarchy
    const hierarchy = await this.createTaskHierarchy(analyzed, selectedStrategy);

    // Phase 3: Identify dependencies
    const withDependencies = await this.identifyDependencies(hierarchy);

    // Phase 4: Optimize execution order
    const optimized = await this.optimizeExecutionOrder(withDependencies, selectedStrategy);

    // Phase 5: Calculate critical path
    const criticalPath = this.calculateCriticalPath(optimized);

    // Phase 6: Identify parallel execution groups
    const parallelGroups = this.identifyParallelGroups(optimized, criticalPath);

    // Phase 7: Assess risks
    const risks = await this.assessRisks(optimized, task);

    // Phase 8: Calculate estimates
    const estimates = this.calculateEstimates(optimized);

    const plan: ExecutionPlan = {
      tasks: optimized,
      dependencies: withDependencies.dependencies,
      criticalPath,
      parallelGroups,
      estimatedTotalEffort: estimates.totalEffort,
      estimatedDuration: estimates.duration,
      riskFactors: risks,
    };

    // Store for learning
    this.decompositionHistory.set(task.id, plan);

    logger.info('Task decomposition completed', {
      taskId: task.id,
      totalTasks: optimized.length,
      duration: estimates.duration,
    });

    return plan;
  }

  /**
   * Select optimal decomposition strategy
   */
  private selectStrategy(task: ComplexTask): DecompositionStrategy {
    const complexity = this.assessComplexity(task);

    if (complexity > 8) {
      return {
        name: 'detailed-hierarchical',
        approach: 'top-down',
        granularity: 'fine',
        parallelization: true,
        optimization: 'quality',
      };
    } else if (complexity > 5) {
      return {
        name: 'balanced',
        approach: 'hybrid',
        granularity: 'medium',
        parallelization: true,
        optimization: 'balanced',
      };
    } else {
      return {
        name: 'rapid',
        approach: 'bottom-up',
        granularity: 'coarse',
        parallelization: true,
        optimization: 'speed',
      };
    }
  }

  /**
   * Analyze and structure requirements
   */
  private async analyzeRequirements(
    task: ComplexTask
  ): Promise<{ clusters: RequirementCluster[]; relationships: Map<string, string[]> }> {
    const clusters: RequirementCluster[] = [];
    const relationships = new Map<string, string[]>();

    // Group requirements by type and domain
    const groups = this.groupRequirements(task.requirements);

    // Create clusters
    for (const [domain, reqs] of groups.entries()) {
      clusters.push({
        id: `cluster_${domain}`,
        domain,
        requirements: reqs,
        complexity: reqs.reduce((sum, r) => sum + r.estimatedComplexity, 0),
      });
    }

    // Identify relationships
    for (const req of task.requirements) {
      relationships.set(req.id, req.dependencies);
    }

    return { clusters, relationships };
  }

  /**
   * Create hierarchical task structure
   */
  private async createTaskHierarchy(
    analyzed: { clusters: RequirementCluster[]; relationships: Map<string, string[]> },
    strategy: DecompositionStrategy
  ): Promise<DecomposedTask[]> {
    const tasks: DecomposedTask[] = [];
    let taskIdCounter = 0;

    for (const cluster of analyzed.clusters) {
      // Create parent task for cluster
      const parentTask: DecomposedTask = {
        id: `task_${taskIdCounter++}`,
        parentId: 'root',
        level: 1,
        name: `Implement ${cluster.domain}`,
        description: `Handle all requirements for ${cluster.domain}`,
        type: 'composite',
        estimatedEffort: cluster.complexity,
        estimatedDuration: cluster.complexity * 2,
        dependencies: [],
        prerequisites: [],
        outputs: [cluster.domain],
        validationRules: [],
        status: 'pending',
      };
      tasks.push(parentTask);

      // Decompose into subtasks based on granularity
      const subtasks = this.decomposeCluster(
        cluster,
        parentTask.id,
        strategy.granularity,
        taskIdCounter
      );
      tasks.push(...subtasks);
      taskIdCounter += subtasks.length;
    }

    return tasks;
  }

  /**
   * Identify task dependencies
   */
  private async identifyDependencies(
    tasks: DecomposedTask[]
  ): Promise<{ tasks: DecomposedTask[]; dependencies: Map<string, string[]> }> {
    const dependencies = new Map<string, string[]>();

    for (const task of tasks) {
      const deps: string[] = [];

      // Find tasks that must complete before this one
      for (const otherTask of tasks) {
        if (otherTask.id === task.id) continue;

        // Check if otherTask's output is in our prerequisites
        const hasPrerequisite = task.prerequisites.some(pre =>
          otherTask.outputs.includes(pre)
        );

        if (hasPrerequisite) {
          deps.push(otherTask.id);
        }
      }

      task.dependencies = deps;
      dependencies.set(task.id, deps);
    }

    return { tasks, dependencies };
  }

  /**
   * Optimize task execution order
   */
  private async optimizeExecutionOrder(
    data: { tasks: DecomposedTask[]; dependencies: Map<string, string[]> },
    strategy: DecompositionStrategy
  ): Promise<DecomposedTask[]> {
    const { tasks } = data;

    // Topological sort
    const sorted = this.topologicalSort(tasks, data.dependencies);

    // Apply optimization based on strategy
    switch (strategy.optimization) {
      case 'speed':
        return this.optimizeForSpeed(sorted);
      case 'quality':
        return this.optimizeForQuality(sorted);
      case 'cost':
        return this.optimizeForCost(sorted);
      default:
        return sorted;
    }
  }

  /**
   * Calculate critical path
   */
  private calculateCriticalPath(tasks: DecomposedTask[]): string[] {
    const path: string[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Find longest path through dependency graph
    const visited = new Set<string>();
    const longestPaths = new Map<string, number>();

    const dfs = (taskId: string): number => {
      if (longestPaths.has(taskId)) {
        return longestPaths.get(taskId)!;
      }

      const task = taskMap.get(taskId);
      if (!task) return 0;

      let maxPath = task.estimatedDuration;

      for (const depId of task.dependencies) {
        maxPath = Math.max(maxPath, task.estimatedDuration + dfs(depId));
      }

      longestPaths.set(taskId, maxPath);
      return maxPath;
    };

    // Calculate for all tasks
    for (const task of tasks) {
      dfs(task.id);
    }

    // Extract critical path
    let current = Array.from(longestPaths.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    while (current) {
      path.unshift(current);
      const task = taskMap.get(current);
      if (!task || task.dependencies.length === 0) break;

      // Find dependency with longest path
      current = task.dependencies.reduce((longest, depId) => {
        const longestPath = longestPaths.get(longest) || 0;
        const depPath = longestPaths.get(depId) || 0;
        return depPath > longestPath ? depId : longest;
      }, task.dependencies[0]);
    }

    return path;
  }

  /**
   * Identify tasks that can run in parallel
   */
  private identifyParallelGroups(
    tasks: DecomposedTask[],
    criticalPath: string[]
  ): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Group tasks by level
    const levels = new Map<number, string[]>();

    for (const task of tasks) {
      const level = this.calculateTaskLevel(task, taskMap);
      if (!levels.has(level)) {
        levels.set(level, []);
      }
      levels.get(level)!.push(task.id);
    }

    // Each level can potentially run in parallel
    for (const [_, taskIds] of Array.from(levels.entries()).sort((a, b) => a[0] - b[0])) {
      const group = taskIds.filter(id => {
        const task = taskMap.get(id);
        if (!task) return false;

        // Can run in parallel if all dependencies are completed
        return task.dependencies.every(depId => processed.has(depId));
      });

      if (group.length > 0) {
        groups.push(group);
        group.forEach(id => processed.add(id));
      }
    }

    return groups;
  }

  /**
   * Assess execution risks
   */
  private async assessRisks(
    tasks: DecomposedTask[],
    originalTask: ComplexTask
  ): Promise<RiskFactor[]> {
    const risks: RiskFactor[] = [];

    for (const task of tasks) {
      // High complexity risk
      if (task.estimatedEffort > 8) {
        risks.push({
          taskId: task.id,
          risk: 'High complexity may lead to delays',
          probability: 0.6,
          impact: 0.8,
          mitigation: 'Break down further or allocate senior resources',
        });
      }

      // Dependency risk
      if (task.dependencies.length > 5) {
        risks.push({
          taskId: task.id,
          risk: 'Many dependencies increase blocking risk',
          probability: 0.5,
          impact: 0.7,
          mitigation: 'Consider parallel alternatives or reduce dependencies',
        });
      }

      // Novel technology risk
      if (originalTask.context.teamCapabilities.length < 3) {
        risks.push({
          taskId: task.id,
          risk: 'Limited team expertise',
          probability: 0.4,
          impact: 0.6,
          mitigation: 'Allocate training time or hire consultants',
        });
      }
    }

    return risks;
  }

  // Helper methods

  private initializeStrategies() {
    this.strategies.set('rapid', {
      name: 'rapid',
      approach: 'bottom-up',
      granularity: 'coarse',
      parallelization: true,
      optimization: 'speed',
    });

    this.strategies.set('balanced', {
      name: 'balanced',
      approach: 'hybrid',
      granularity: 'medium',
      parallelization: true,
      optimization: 'balanced',
    });

    this.strategies.set('thorough', {
      name: 'thorough',
      approach: 'top-down',
      granularity: 'fine',
      parallelization: true,
      optimization: 'quality',
    });
  }

  private assessComplexity(task: ComplexTask): number {
    let complexity = 0;

    complexity += task.requirements.length * 0.5;
    complexity += task.requirements.reduce((sum, r) => sum + r.estimatedComplexity, 0) / 10;
    complexity += Object.keys(task.context).length * 0.3;

    if (task.constraints.timeLimit) complexity += 1;
    if (task.constraints.budgetLimit) complexity += 1;
    if (task.constraints.mustUse && task.constraints.mustUse.length > 0) complexity += 2;

    return Math.min(complexity, 10);
  }

  private groupRequirements(requirements: Requirement[]): Map<string, Requirement[]> {
    const groups = new Map<string, Requirement[]>();

    for (const req of requirements) {
      const domain = this.extractDomain(req.description);
      if (!groups.has(domain)) {
        groups.set(domain, []);
      }
      groups.get(domain)!.push(req);
    }

    return groups;
  }

  private extractDomain(description: string): string {
    // Simple domain extraction based on keywords
    const keywords = ['authentication', 'database', 'api', 'ui', 'testing', 'deployment'];

    for (const keyword of keywords) {
      if (description.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }

    return 'general';
  }

  private decomposeCluster(
    cluster: RequirementCluster,
    parentId: string,
    granularity: string,
    startId: number
  ): DecomposedTask[] {
    const tasks: DecomposedTask[] = [];

    // Create tasks based on granularity
    const tasksPerReq = granularity === 'fine' ? 3 : granularity === 'medium' ? 2 : 1;

    for (const req of cluster.requirements) {
      for (let i = 0; i < tasksPerReq; i++) {
        tasks.push({
          id: `task_${startId + tasks.length}`,
          parentId,
          level: 2,
          name: `${req.type} - ${req.description.substring(0, 50)}`,
          description: req.description,
          type: 'atomic',
          estimatedEffort: req.estimatedComplexity / tasksPerReq,
          estimatedDuration: (req.estimatedComplexity / tasksPerReq) * 2,
          dependencies: req.dependencies,
          prerequisites: [],
          outputs: [req.id],
          validationRules: req.acceptance.map(a => ({
            type: 'acceptance',
            condition: a,
            errorMessage: `Acceptance criteria not met: ${a}`,
            severity: 'error' as const,
          })),
          status: 'pending',
        });
      }
    }

    return tasks;
  }

  private topologicalSort(
    tasks: DecomposedTask[],
    dependencies: Map<string, string[]>
  ): DecomposedTask[] {
    const sorted: DecomposedTask[] = [];
    const visited = new Set<string>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;

      visited.add(taskId);

      const deps = dependencies.get(taskId) || [];
      for (const depId of deps) {
        visit(depId);
      }

      const task = taskMap.get(taskId);
      if (task) {
        sorted.push(task);
      }
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return sorted;
  }

  private optimizeForSpeed(tasks: DecomposedTask[]): DecomposedTask[] {
    // Prioritize tasks with fewest dependencies
    return tasks.sort((a, b) => a.dependencies.length - b.dependencies.length);
  }

  private optimizeForQuality(tasks: DecomposedTask[]): DecomposedTask[] {
    // Prioritize tasks with more validation rules
    return tasks.sort((a, b) => b.validationRules.length - a.validationRules.length);
  }

  private optimizeForCost(tasks: DecomposedTask[]): DecomposedTask[] {
    // Prioritize tasks with lower effort
    return tasks.sort((a, b) => a.estimatedEffort - b.estimatedEffort);
  }

  private calculateTaskLevel(task: DecomposedTask, taskMap: Map<string, DecomposedTask>): number {
    if (task.dependencies.length === 0) return 0;

    let maxLevel = 0;
    for (const depId of task.dependencies) {
      const dep = taskMap.get(depId);
      if (dep) {
        maxLevel = Math.max(maxLevel, this.calculateTaskLevel(dep, taskMap) + 1);
      }
    }

    return maxLevel;
  }

  private calculateEstimates(tasks: DecomposedTask[]): { totalEffort: number; duration: number } {
    const totalEffort = tasks.reduce((sum, t) => sum + t.estimatedEffort, 0);

    // Duration is based on critical path, not sum
    const duration = Math.max(...tasks.map(t => t.estimatedDuration));

    return { totalEffort, duration };
  }
}

interface RequirementCluster {
  id: string;
  domain: string;
  requirements: Requirement[];
  complexity: number;
}

// Singleton
let decomposer: IntelligentTaskDecomposer;

export function getTaskDecomposer(): IntelligentTaskDecomposer {
  if (!decomposer) {
    decomposer = new IntelligentTaskDecomposer();
  }
  return decomposer;
}
