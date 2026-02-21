import { v4 as uuidv4 } from 'uuid';

interface AgentCapability {
  name: string;
  description: string;
  execute: (context: AgentContext) => Promise<any>;
}

interface AgentContext {
  sessionId: string;
  userId?: string;
  goal: string;
  parameters: Record<string, any>;
  memory: Map<string, any>;
  history: AgentStep[];
}

interface AgentStep {
  id: string;
  agentName: string;
  action: string;
  input: any;
  output: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

interface AgentPlan {
  steps: PlannedStep[];
  estimatedDuration: number;
  confidence: number;
  fallbackPlan?: AgentPlan;
}

interface PlannedStep {
  agentName: string;
  action: string;
  description: string;
  parameters: Record<string, any>;
  dependencies: string[];
  priority: number;
}

interface AgentResult {
  success: boolean;
  data?: any;
  error?: string;
  steps: AgentStep[];
  totalDuration: number;
  metadata: Record<string, any>;
}

export class AdvancedAgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private capabilities: Map<string, AgentCapability> = new Map();
  private sessions: Map<string, AgentContext> = new Map();

  /**
   * Register an agent
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
    console.log(`Agent registered: ${agent.name}`);
  }

  /**
   * Register a capability
   */
  registerCapability(capability: AgentCapability): void {
    this.capabilities.set(capability.name, capability);
    console.log(`Capability registered: ${capability.name}`);
  }

  /**
   * Execute a goal with intelligent orchestration
   */
  async execute(
    goal: string,
    parameters: Record<string, any> = {},
    userId?: string
  ): Promise<AgentResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();

    const context: AgentContext = {
      sessionId,
      userId,
      goal,
      parameters,
      memory: new Map(),
      history: [],
    };

    this.sessions.set(sessionId, context);

    try {
      // Step 1: Analyze goal and create plan
      const plan = await this.createPlan(goal, parameters, context);
      console.log(`Execution plan created: ${plan.steps.length} steps`);

      // Step 2: Execute plan
      const steps = await this.executePlan(plan, context);

      // Step 3: Synthesize results
      const result = this.synthesizeResults(steps, context);

      return {
        success: true,
        data: result,
        steps,
        totalDuration: Date.now() - startTime,
        metadata: {
          sessionId,
          plan,
          confidence: plan.confidence,
        },
      };
    } catch (error: any) {
      console.error('Agent execution failed:', error);
      return {
        success: false,
        error: error.message,
        steps: context.history,
        totalDuration: Date.now() - startTime,
        metadata: {
          sessionId,
        },
      };
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Create an execution plan using AI planning
   */
  private async createPlan(
    goal: string,
    parameters: Record<string, any>,
    context: AgentContext
  ): Promise<AgentPlan> {
    // Analyze goal and decompose into steps
    const steps: PlannedStep[] = [];

    // Example: Content generation goal
    if (goal.includes('generate') || goal.includes('create content')) {
      steps.push({
        agentName: 'research',
        action: 'research_topic',
        description: 'Research the topic and gather information',
        parameters: { topic: parameters.topic },
        dependencies: [],
        priority: 1,
      });

      steps.push({
        agentName: 'content',
        action: 'generate_content',
        description: 'Generate content based on research',
        parameters: { category: parameters.category || 'blog' },
        dependencies: ['research'],
        priority: 2,
      });

      steps.push({
        agentName: 'quality',
        action: 'validate_quality',
        description: 'Validate content quality and accuracy',
        parameters: {},
        dependencies: ['content'],
        priority: 3,
      });

      steps.push({
        agentName: 'formatting',
        action: 'format_content',
        description: 'Format and sanitize content',
        parameters: {},
        dependencies: ['quality'],
        priority: 4,
      });

      steps.push({
        agentName: 'storage',
        action: 'save_content',
        description: 'Save content to database',
        parameters: {},
        dependencies: ['formatting'],
        priority: 5,
      });
    }

    // Example: Analysis goal
    else if (goal.includes('analyze') || goal.includes('evaluate')) {
      steps.push({
        agentName: 'data',
        action: 'fetch_data',
        description: 'Fetch relevant data for analysis',
        parameters,
        dependencies: [],
        priority: 1,
      });

      steps.push({
        agentName: 'analysis',
        action: 'perform_analysis',
        description: 'Analyze data and extract insights',
        parameters,
        dependencies: ['data'],
        priority: 2,
      });

      steps.push({
        agentName: 'visualization',
        action: 'create_visualization',
        description: 'Create visualizations of insights',
        parameters,
        dependencies: ['analysis'],
        priority: 3,
      });
    }

    // Example: Optimization goal
    else if (goal.includes('optimize') || goal.includes('improve')) {
      steps.push({
        agentName: 'profiling',
        action: 'profile_system',
        description: 'Profile system performance',
        parameters,
        dependencies: [],
        priority: 1,
      });

      steps.push({
        agentName: 'recommendation',
        action: 'generate_recommendations',
        description: 'Generate optimization recommendations',
        parameters,
        dependencies: ['profiling'],
        priority: 2,
      });

      steps.push({
        agentName: 'implementation',
        action: 'apply_optimizations',
        description: 'Apply recommended optimizations',
        parameters,
        dependencies: ['recommendation'],
        priority: 3,
      });

      steps.push({
        agentName: 'validation',
        action: 'validate_improvements',
        description: 'Validate performance improvements',
        parameters,
        dependencies: ['implementation'],
        priority: 4,
      });
    }

    // Default: Generic workflow
    else {
      steps.push({
        agentName: 'coordinator',
        action: 'coordinate_execution',
        description: 'Coordinate execution of goal',
        parameters,
        dependencies: [],
        priority: 1,
      });
    }

    return {
      steps,
      estimatedDuration: steps.length * 5000, // 5 seconds per step estimate
      confidence: 0.85,
    };
  }

  /**
   * Execute a plan
   */
  private async executePlan(plan: AgentPlan, context: AgentContext): Promise<AgentStep[]> {
    const executedSteps: AgentStep[] = [];
    const stepOutputs: Map<string, any> = new Map();

    // Sort steps by priority
    const sortedSteps = [...plan.steps].sort((a, b) => a.priority - b.priority);

    for (const plannedStep of sortedSteps) {
      // Check dependencies
      const dependenciesMet = plannedStep.dependencies.every(dep =>
        stepOutputs.has(dep)
      );

      if (!dependenciesMet) {
        throw new Error(`Dependencies not met for step: ${plannedStep.action}`);
      }

      // Execute step
      const step: AgentStep = {
        id: uuidv4(),
        agentName: plannedStep.agentName,
        action: plannedStep.action,
        input: plannedStep.parameters,
        output: null,
        status: 'running',
        startTime: Date.now(),
      };

      context.history.push(step);
      executedSteps.push(step);

      try {
        // Get agent
        const agent = this.agents.get(plannedStep.agentName);
        if (!agent) {
          throw new Error(`Agent not found: ${plannedStep.agentName}`);
        }

        // Execute agent
        const result = await agent.execute(plannedStep.action, {
          ...plannedStep.parameters,
          dependencies: plannedStep.dependencies.map(dep => stepOutputs.get(dep)),
        }, context);

        step.output = result;
        step.status = 'completed';
        step.endTime = Date.now();
        step.durationMs = step.endTime - step.startTime;

        // Store output for dependent steps
        stepOutputs.set(plannedStep.agentName, result);

        console.log(`✓ Step completed: ${plannedStep.action} (${step.durationMs}ms)`);
      } catch (error: any) {
        step.status = 'failed';
        step.error = error.message;
        step.endTime = Date.now();
        step.durationMs = step.endTime - step.startTime;

        console.error(`✗ Step failed: ${plannedStep.action}`, error);

        // Try fallback if available
        if (plan.fallbackPlan) {
          console.log('Attempting fallback plan...');
          return await this.executePlan(plan.fallbackPlan, context);
        }

        throw error;
      }
    }

    return executedSteps;
  }

  /**
   * Synthesize results from executed steps
   */
  private synthesizeResults(steps: AgentStep[], context: AgentContext): any {
    const lastStep = steps[steps.length - 1];
    return lastStep?.output || null;
  }

  /**
   * Get session context
   */
  getSession(sessionId: string): AgentContext | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all registered agents
   */
  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }
}

// Base Agent class
export abstract class Agent {
  constructor(public name: string, public description: string) {}

  abstract execute(
    action: string,
    parameters: Record<string, any>,
    context: AgentContext
  ): Promise<any>;

  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    console.log(`[${this.name}] ${level.toUpperCase()}: ${message}`);
  }
}

// Singleton instance
let orchestratorInstance: AdvancedAgentOrchestrator | null = null;

export function getAdvancedAgentOrchestrator(): AdvancedAgentOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AdvancedAgentOrchestrator();
  }
  return orchestratorInstance;
}

export { AgentContext, AgentStep, AgentResult, AgentPlan };
