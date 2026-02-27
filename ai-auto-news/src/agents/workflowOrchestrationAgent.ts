/**
 * @module workflowOrchestrationAgent
 * @description Autonomous workflow orchestration agent that manages complex
 * multi-step business processes, monitors workflow health, handles failures,
 * optimizes execution paths, and provides end-to-end workflow intelligence.
 */

import { getLogger } from '../lib/logger';
import {
  getWorkflowComposer,
  WorkflowDefinition,
  WorkflowExecution,
  StepType,
} from '../lib/aiWorkflowComposer';

const logger = getLogger();

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  stepTemplates: Array<{
    name: string;
    type: StepType;
    handler: string;
    timeoutMs: number;
  }>;
  tags: string[];
}

export interface WorkflowHealthReport {
  workflowId: string;
  name: string;
  status: 'healthy' | 'degraded' | 'critical';
  successRate: number;
  avgDurationMs: number;
  p99DurationMs: number;
  recentFailures: number;
  recommendations: string[];
}

export interface OrchestrationStats {
  totalWorkflows: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgSuccessRate: number;
  activeTemplates: number;
}

export class WorkflowOrchestrationAgent {
  private composer = getWorkflowComposer();
  private templates = new Map<string, WorkflowTemplate>();
  private executionHistory: WorkflowExecution[] = [];
  private healthReports = new Map<string, WorkflowHealthReport>();
  private monitoringHandle: ReturnType<typeof setInterval> | null = null;
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;

  start(intervalMs = 30_000): void {
    this.monitoringHandle = setInterval(() => this.runHealthCheck(), intervalMs);
    this.registerDefaultTemplates();
    logger.info('WorkflowOrchestrationAgent started');
  }

  stop(): void {
    if (this.monitoringHandle) {
      clearInterval(this.monitoringHandle);
      this.monitoringHandle = null;
    }
    logger.info('WorkflowOrchestrationAgent stopped');
  }

  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
    logger.info('Workflow template registered', { id: template.id, name: template.name });
  }

  instantiateTemplate(templateId: string, name?: string): WorkflowDefinition {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    const workflow = this.composer.composeFromSteps(
      name ?? template.name,
      template.stepTemplates
    );

    logger.info('Workflow instantiated from template', {
      templateId,
      workflowId: workflow.id,
      stepCount: workflow.steps.length,
    });

    return workflow;
  }

  async triggerWorkflow(
    workflowId: string,
    context: Record<string, unknown>,
    triggeredBy = 'orchestration_agent'
  ): Promise<WorkflowExecution> {
    this.totalExecutions++;

    try {
      const execution = await this.composer.execute(workflowId, context, triggeredBy);

      this.executionHistory.push(execution);
      if (this.executionHistory.length > 1000) this.executionHistory.splice(0, 100);

      if (execution.status === 'completed') {
        this.successfulExecutions++;
      } else {
        this.failedExecutions++;
        logger.warn('Workflow execution failed', {
          workflowId,
          executionId: execution.executionId,
          error: execution.error,
        });
      }

      return execution;
    } catch (err) {
      this.failedExecutions++;
      logger.error('Failed to trigger workflow', err instanceof Error ? err : new Error(String(err)), { workflowId });
      throw err;
    }
  }

  async triggerFromTemplate(
    templateId: string,
    context: Record<string, unknown>
  ): Promise<WorkflowExecution> {
    const workflow = this.instantiateTemplate(templateId);
    return this.triggerWorkflow(workflow.id, context, `template:${templateId}`);
  }

  private runHealthCheck(): void {
    const workflows = this.composer.listWorkflows();

    for (const workflow of workflows) {
      const metrics = this.composer.getMetrics(workflow.id);
      if (!metrics) continue;

      const successRate = metrics.totalExecutions > 0
        ? metrics.successfulExecutions / metrics.totalExecutions
        : 1;

      const recentExecutions = this.executionHistory.filter(e => e.workflowId === workflow.id);
      const recentFailures = recentExecutions.slice(-10).filter(e => e.status === 'failed').length;

      const recommendations: string[] = [];
      let status: WorkflowHealthReport['status'] = 'healthy';

      if (successRate < 0.8) {
        status = 'critical';
        recommendations.push('High failure rate - investigate error patterns');
      } else if (successRate < 0.95) {
        status = 'degraded';
        recommendations.push('Elevated failure rate - monitor closely');
      }

      if (metrics.avgDurationMs > metrics.p95DurationMs * 2) {
        recommendations.push('High latency variance - check for timeout issues');
      }

      if (recentFailures >= 3) {
        recommendations.push('Multiple recent failures - consider circuit breaking');
        if (status === 'healthy') status = 'degraded';
      }

      const report: WorkflowHealthReport = {
        workflowId: workflow.id,
        name: workflow.name,
        status,
        successRate,
        avgDurationMs: metrics.avgDurationMs,
        p99DurationMs: metrics.p99DurationMs,
        recentFailures,
        recommendations,
      };

      this.healthReports.set(workflow.id, report);

      if (status !== 'healthy') {
        logger.warn('Workflow health degraded', {
          workflowId: workflow.id,
          name: workflow.name,
          status,
          successRate,
        });
      }
    }
  }

  private registerDefaultTemplates(): void {
    const defaultTemplates: WorkflowTemplate[] = [
      {
        id: 'content_processing',
        name: 'Content Processing Pipeline',
        category: 'content',
        description: 'Ingest, validate, enrich, and publish content',
        stepTemplates: [
          { name: 'Validate Input', type: 'validate', handler: 'content.validate', timeoutMs: 2000 },
          { name: 'Enrich Content', type: 'enrich', handler: 'content.enrich', timeoutMs: 5000 },
          { name: 'Transform Format', type: 'transform', handler: 'content.transform', timeoutMs: 3000 },
          { name: 'Publish Output', type: 'emit_event', handler: 'content.publish', timeoutMs: 2000 },
        ],
        tags: ['content', 'ingestion'],
      },
      {
        id: 'user_onboarding',
        name: 'User Onboarding Workflow',
        category: 'user',
        description: 'New user registration, verification, and setup',
        stepTemplates: [
          { name: 'Validate Registration', type: 'validate', handler: 'user.validateReg', timeoutMs: 1000 },
          { name: 'Create Account', type: 'transform', handler: 'user.create', timeoutMs: 2000 },
          { name: 'Send Welcome Email', type: 'external_call', handler: 'email.welcome', timeoutMs: 5000 },
          { name: 'Setup Defaults', type: 'transform', handler: 'user.setupDefaults', timeoutMs: 2000 },
        ],
        tags: ['user', 'onboarding'],
      },
      {
        id: 'billing_cycle',
        name: 'Monthly Billing Cycle',
        category: 'billing',
        description: 'Calculate usage, generate invoice, process payment',
        stepTemplates: [
          { name: 'Aggregate Usage', type: 'aggregate', handler: 'billing.aggregateUsage', timeoutMs: 10000 },
          { name: 'Calculate Invoice', type: 'transform', handler: 'billing.calculate', timeoutMs: 5000 },
          { name: 'Process Payment', type: 'external_call', handler: 'billing.processPayment', timeoutMs: 15000 },
          { name: 'Send Receipt', type: 'emit_event', handler: 'billing.sendReceipt', timeoutMs: 3000 },
        ],
        tags: ['billing', 'finance'],
      },
    ];

    for (const template of defaultTemplates) {
      this.registerTemplate(template);
    }
  }

  getHealthReports(): WorkflowHealthReport[] {
    return Array.from(this.healthReports.values());
  }

  getHealthReport(workflowId: string): WorkflowHealthReport | undefined {
    return this.healthReports.get(workflowId);
  }

  getRecentExecutions(limit = 50): WorkflowExecution[] {
    return this.executionHistory.slice(-limit);
  }

  getStats(): OrchestrationStats {
    const workflows = this.composer.listWorkflows();
    const successRates = workflows.map(w => {
      const m = this.composer.getMetrics(w.id);
      return m && m.totalExecutions > 0 ? m.successfulExecutions / m.totalExecutions : 1;
    });
    const avgSuccessRate = successRates.length > 0
      ? successRates.reduce((s, v) => s + v, 0) / successRates.length
      : 1;

    return {
      totalWorkflows: workflows.length,
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      avgSuccessRate,
      activeTemplates: this.templates.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __workflowOrchestrationAgent__: WorkflowOrchestrationAgent | undefined;
}

export function getWorkflowOrchestrationAgent(): WorkflowOrchestrationAgent {
  if (!globalThis.__workflowOrchestrationAgent__) {
    globalThis.__workflowOrchestrationAgent__ = new WorkflowOrchestrationAgent();
  }
  return globalThis.__workflowOrchestrationAgent__;
}
