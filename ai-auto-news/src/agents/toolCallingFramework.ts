/**
 * Tool Calling Framework
 *
 * Orchestration layer for AI agent tool invocations with
 * validation, rate limiting, caching, error recovery, and telemetry.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  parameters: ToolParameter[];
  returns: ToolReturnType;
  rateLimit: ToolRateLimit;
  timeout: number;
  retryPolicy: RetryPolicy;
  cacheable: boolean;
  cacheTTL: number;
  requiresAuth: boolean;
  permissions: string[];
}

export type ToolCategory =
  | 'code_generation'
  | 'code_analysis'
  | 'file_operations'
  | 'database'
  | 'api_call'
  | 'search'
  | 'transformation'
  | 'validation'
  | 'deployment'
  | 'monitoring';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  default?: unknown;
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  pattern?: string;
  min?: number;
  max?: number;
  enum?: unknown[];
  maxLength?: number;
}

export interface ToolReturnType {
  type: string;
  schema: Record<string, unknown>;
  nullable: boolean;
}

export interface ToolRateLimit {
  maxCallsPerMinute: number;
  maxCallsPerHour: number;
  burstLimit: number;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffType: 'fixed' | 'exponential' | 'linear';
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export interface ToolInvocation {
  id: string;
  toolId: string;
  parameters: Record<string, unknown>;
  callerAgent: string;
  priority: number;
  context: InvocationContext;
  timestamp: number;
}

export interface InvocationContext {
  sessionId: string;
  parentInvocationId?: string;
  conversationHistory: string[];
  metadata: Record<string, unknown>;
}

export interface ToolResult {
  invocationId: string;
  toolId: string;
  success: boolean;
  data: unknown;
  error?: ToolError;
  metrics: InvocationMetrics;
  fromCache: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface InvocationMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  retryCount: number;
  tokensCost: number;
  cacheHit: boolean;
}

export interface ToolExecutionPlan {
  id: string;
  steps: ExecutionStep[];
  totalEstimatedTime: number;
  parallelizable: boolean;
  dependencies: Map<string, string[]>;
}

export interface ExecutionStep {
  id: string;
  toolId: string;
  parameters: Record<string, unknown>;
  dependsOn: string[];
  condition?: string;
  fallbackToolId?: string;
}

interface ToolHandler {
  definition: ToolDefinition;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

interface RateLimitState {
  minuteCount: number;
  hourCount: number;
  minuteResetAt: number;
  hourResetAt: number;
}

export class ToolCallingFramework {
  private tools: Map<string, ToolHandler> = new Map();
  private rateLimits: Map<string, RateLimitState> = new Map();
  private cache: Map<string, { result: unknown; expiresAt: number }> = new Map();
  private invocationLog: ToolResult[] = [];
  private middlewares: ToolMiddleware[] = [];
  private activePlans: Map<string, ToolExecutionPlan> = new Map();

  registerTool(
    definition: ToolDefinition,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(definition.id, { definition, execute: handler });
    this.rateLimits.set(definition.id, {
      minuteCount: 0,
      hourCount: 0,
      minuteResetAt: Date.now() + 60000,
      hourResetAt: Date.now() + 3600000,
    });

    logger.info('Tool registered', { toolId: definition.id, name: definition.name });
  }

  unregisterTool(toolId: string): boolean {
    const removed = this.tools.delete(toolId);
    this.rateLimits.delete(toolId);
    return removed;
  }

  async invoke(invocation: ToolInvocation): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(invocation.toolId);

    if (!tool) {
      return this.createErrorResult(invocation, 'TOOL_NOT_FOUND', `Tool ${invocation.toolId} not found`, false, startTime);
    }

    const validationError = this.validateParameters(tool.definition, invocation.parameters);
    if (validationError) {
      return this.createErrorResult(invocation, 'VALIDATION_ERROR', validationError, false, startTime);
    }

    const rateLimitError = this.checkRateLimit(invocation.toolId, tool.definition.rateLimit);
    if (rateLimitError) {
      return this.createErrorResult(invocation, 'RATE_LIMITED', rateLimitError, true, startTime);
    }

    if (tool.definition.cacheable) {
      const cached = this.checkCache(invocation.toolId, invocation.parameters);
      if (cached !== undefined) {
        const result: ToolResult = {
          invocationId: invocation.id,
          toolId: invocation.toolId,
          success: true,
          data: cached,
          metrics: {
            startTime,
            endTime: Date.now(),
            durationMs: Date.now() - startTime,
            retryCount: 0,
            tokensCost: 0,
            cacheHit: true,
          },
          fromCache: true,
        };
        this.invocationLog.push(result);
        return result;
      }
    }

    let modifiedParams = invocation.parameters;
    for (const middleware of this.middlewares) {
      if (middleware.beforeInvoke) {
        modifiedParams = await middleware.beforeInvoke(invocation.toolId, modifiedParams);
      }
    }

    let lastError: Error | null = null;
    let retryCount = 0;
    const maxRetries = tool.definition.retryPolicy.maxRetries;

    while (retryCount <= maxRetries) {
      try {
        const data = await this.executeWithTimeout(
          tool.execute(modifiedParams),
          tool.definition.timeout,
        );

        if (tool.definition.cacheable) {
          this.setCache(invocation.toolId, invocation.parameters, data, tool.definition.cacheTTL);
        }

        this.updateRateLimit(invocation.toolId);

        let resultData = data;
        for (const middleware of this.middlewares) {
          if (middleware.afterInvoke) {
            resultData = await middleware.afterInvoke(invocation.toolId, resultData);
          }
        }

        const result: ToolResult = {
          invocationId: invocation.id,
          toolId: invocation.toolId,
          success: true,
          data: resultData,
          metrics: {
            startTime,
            endTime: Date.now(),
            durationMs: Date.now() - startTime,
            retryCount,
            tokensCost: 0,
            cacheHit: false,
          },
          fromCache: false,
        };

        this.invocationLog.push(result);
        return result;
      } catch (error) {
        lastError = error as Error;
        const isRetryable = this.isRetryableError(error as Error, tool.definition.retryPolicy);

        if (!isRetryable || retryCount >= maxRetries) break;

        retryCount++;
        const delay = this.calculateBackoff(tool.definition.retryPolicy, retryCount);
        await this.sleep(delay);
      }
    }

    const errorResult = this.createErrorResult(
      invocation,
      'EXECUTION_FAILED',
      lastError?.message || 'Unknown error',
      false,
      startTime,
      retryCount,
    );

    this.invocationLog.push(errorResult);
    return errorResult;
  }

  async executePlan(plan: ToolExecutionPlan, agentId: string): Promise<Map<string, ToolResult>> {
    this.activePlans.set(plan.id, plan);
    const results = new Map<string, ToolResult>();
    const completed = new Set<string>();

    try {
      const sortedSteps = this.topologicalSort(plan.steps);

      for (const step of sortedSteps) {
        const depsReady = step.dependsOn.every((dep) => completed.has(dep));
        if (!depsReady) {
          results.set(step.id, this.createErrorResult(
            { id: step.id, toolId: step.toolId, parameters: step.parameters, callerAgent: agentId, priority: 5, context: { sessionId: plan.id, conversationHistory: [], metadata: {} }, timestamp: Date.now() },
            'DEPENDENCY_FAILED',
            'Required dependencies not completed',
            false,
            Date.now(),
          ));
          continue;
        }

        const enrichedParams = this.enrichParameters(step.parameters, results);

        const invocation: ToolInvocation = {
          id: `${plan.id}_${step.id}`,
          toolId: step.toolId,
          parameters: enrichedParams,
          callerAgent: agentId,
          priority: 5,
          context: {
            sessionId: plan.id,
            parentInvocationId: plan.id,
            conversationHistory: [],
            metadata: { planId: plan.id, stepId: step.id },
          },
          timestamp: Date.now(),
        };

        const result = await this.invoke(invocation);
        results.set(step.id, result);

        if (result.success) {
          completed.add(step.id);
        } else if (step.fallbackToolId) {
          const fallbackInvocation = { ...invocation, toolId: step.fallbackToolId, id: `${invocation.id}_fallback` };
          const fallbackResult = await this.invoke(fallbackInvocation);
          results.set(step.id, fallbackResult);
          if (fallbackResult.success) {
            completed.add(step.id);
          }
        }
      }
    } finally {
      this.activePlans.delete(plan.id);
    }

    return results;
  }

  addMiddleware(middleware: ToolMiddleware): void {
    this.middlewares.push(middleware);
  }

  getRegisteredTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getToolById(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId)?.definition;
  }

  getInvocationLog(toolId?: string, limit?: number): ToolResult[] {
    let log = [...this.invocationLog];
    if (toolId) {
      log = log.filter((r) => r.toolId === toolId);
    }
    log.sort((a, b) => b.metrics.startTime - a.metrics.startTime);
    return limit ? log.slice(0, limit) : log;
  }

  getToolMetrics(toolId: string): {
    totalInvocations: number;
    successRate: number;
    avgDurationMs: number;
    cacheHitRate: number;
    errorRate: number;
  } {
    const results = this.invocationLog.filter((r) => r.toolId === toolId);
    if (results.length === 0) {
      return { totalInvocations: 0, successRate: 0, avgDurationMs: 0, cacheHitRate: 0, errorRate: 0 };
    }

    const successes = results.filter((r) => r.success).length;
    const cacheHits = results.filter((r) => r.fromCache).length;
    const totalDuration = results.reduce((sum, r) => sum + r.metrics.durationMs, 0);

    return {
      totalInvocations: results.length,
      successRate: successes / results.length,
      avgDurationMs: totalDuration / results.length,
      cacheHitRate: cacheHits / results.length,
      errorRate: 1 - successes / results.length,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private validateParameters(
    definition: ToolDefinition,
    params: Record<string, unknown>,
  ): string | null {
    for (const param of definition.parameters) {
      if (param.required && !(param.name in params)) {
        return `Missing required parameter: ${param.name}`;
      }

      if (param.name in params && params[param.name] !== undefined) {
        const value = params[param.name];

        if (param.type === 'string' && typeof value !== 'string') {
          return `Parameter ${param.name} must be a string`;
        }
        if (param.type === 'number' && typeof value !== 'number') {
          return `Parameter ${param.name} must be a number`;
        }
        if (param.type === 'boolean' && typeof value !== 'boolean') {
          return `Parameter ${param.name} must be a boolean`;
        }

        if (param.validation) {
          if (param.validation.min !== undefined && (value as number) < param.validation.min) {
            return `Parameter ${param.name} must be >= ${param.validation.min}`;
          }
          if (param.validation.max !== undefined && (value as number) > param.validation.max) {
            return `Parameter ${param.name} must be <= ${param.validation.max}`;
          }
          if (param.validation.maxLength !== undefined && String(value).length > param.validation.maxLength) {
            return `Parameter ${param.name} exceeds max length ${param.validation.maxLength}`;
          }
          if (param.validation.enum && !param.validation.enum.includes(value)) {
            return `Parameter ${param.name} must be one of: ${param.validation.enum.join(', ')}`;
          }
        }
      }
    }

    return null;
  }

  private checkRateLimit(toolId: string, limit: ToolRateLimit): string | null {
    const state = this.rateLimits.get(toolId);
    if (!state) return null;

    const now = Date.now();

    if (now >= state.minuteResetAt) {
      state.minuteCount = 0;
      state.minuteResetAt = now + 60000;
    }
    if (now >= state.hourResetAt) {
      state.hourCount = 0;
      state.hourResetAt = now + 3600000;
    }

    if (state.minuteCount >= limit.maxCallsPerMinute) {
      return `Rate limit exceeded: ${limit.maxCallsPerMinute} calls/minute`;
    }
    if (state.hourCount >= limit.maxCallsPerHour) {
      return `Rate limit exceeded: ${limit.maxCallsPerHour} calls/hour`;
    }

    return null;
  }

  private updateRateLimit(toolId: string): void {
    const state = this.rateLimits.get(toolId);
    if (state) {
      state.minuteCount++;
      state.hourCount++;
    }
  }

  private checkCache(toolId: string, params: Record<string, unknown>): unknown | undefined {
    const key = this.getCacheKey(toolId, params);
    const entry = this.cache.get(key);

    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result;
  }

  private setCache(toolId: string, params: Record<string, unknown>, result: unknown, ttl: number): void {
    const key = this.getCacheKey(toolId, params);
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  private getCacheKey(toolId: string, params: Record<string, unknown>): string {
    return `${toolId}:${JSON.stringify(params)}`;
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private isRetryableError(error: Error, policy: RetryPolicy): boolean {
    if (policy.retryableErrors.length === 0) return true;
    return policy.retryableErrors.some((e) => error.message.includes(e));
  }

  private calculateBackoff(policy: RetryPolicy, retryCount: number): number {
    switch (policy.backoffType) {
      case 'fixed':
        return policy.initialDelayMs;
      case 'linear':
        return Math.min(policy.maxDelayMs, policy.initialDelayMs * retryCount);
      case 'exponential':
        return Math.min(policy.maxDelayMs, policy.initialDelayMs * Math.pow(2, retryCount - 1));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createErrorResult(
    invocation: ToolInvocation,
    code: string,
    message: string,
    retryable: boolean,
    startTime: number,
    retryCount: number = 0,
  ): ToolResult {
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      success: false,
      data: null,
      error: { code, message, retryable },
      metrics: {
        startTime,
        endTime: Date.now(),
        durationMs: Date.now() - startTime,
        retryCount,
        tokensCost: 0,
        cacheHit: false,
      },
      fromCache: false,
    };
  }

  private topologicalSort(steps: ExecutionStep[]): ExecutionStep[] {
    const visited = new Set<string>();
    const result: ExecutionStep[] = [];
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    const visit = (stepId: string) => {
      if (visited.has(stepId)) return;
      visited.add(stepId);

      const step = stepMap.get(stepId);
      if (!step) return;

      for (const dep of step.dependsOn) {
        visit(dep);
      }

      result.push(step);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return result;
  }

  private enrichParameters(
    params: Record<string, unknown>,
    previousResults: Map<string, ToolResult>,
  ): Record<string, unknown> {
    const enriched = { ...params };

    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string' && value.startsWith('$ref:')) {
        const refStepId = value.substring(5);
        const refResult = previousResults.get(refStepId);
        if (refResult?.success) {
          enriched[key] = refResult.data;
        }
      }
    }

    return enriched;
  }
}

export interface ToolMiddleware {
  name: string;
  beforeInvoke?: (toolId: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  afterInvoke?: (toolId: string, result: unknown) => Promise<unknown>;
}

let frameworkInstance: ToolCallingFramework | null = null;

export function getToolCallingFramework(): ToolCallingFramework {
  if (!frameworkInstance) {
    frameworkInstance = new ToolCallingFramework();
  }
  return frameworkInstance;
}
