import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getWorkflowComposer } from '@/lib/aiWorkflowComposer';
import { getWorkflowOrchestrationAgent } from '@/agents/workflowOrchestrationAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get('workflowId');
  const executionId = searchParams.get('executionId');

  try {
    const composer = getWorkflowComposer();
    const agent = getWorkflowOrchestrationAgent();

    if (executionId) {
      const execution = composer.getExecution(executionId);
      if (!execution) {
        return NextResponse.json({ success: false, error: 'Execution not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: { execution } });
    }

    if (workflowId) {
      const metrics = composer.getMetrics(workflowId);
      const health = agent.getHealthReport(workflowId);
      return NextResponse.json({ success: true, data: { metrics, health } });
    }

    const workflows = composer.listWorkflows();
    const stats = agent.getStats();
    const healthReports = agent.getHealthReports();
    const recentExecutions = agent.getRecentExecutions(20);

    return NextResponse.json({
      success: true,
      data: {
        workflows,
        stats,
        healthReports,
        recentExecutions,
      },
    });
  } catch (err) {
    logger.error('Workflow GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const composer = getWorkflowComposer();
    const agent = getWorkflowOrchestrationAgent();

    if (action === 'register') {
      const workflow = body.workflow as Parameters<typeof composer.register>[0];
      composer.register(workflow);
      return NextResponse.json({ success: true, data: { message: 'Workflow registered', workflowId: workflow.id } });
    }

    if (action === 'execute') {
      const workflowId = body.workflowId as string;
      const context = (body.context as Record<string, unknown>) ?? {};
      const triggeredBy = (body.triggeredBy as string) ?? 'api';
      const execution = await agent.triggerWorkflow(workflowId, context, triggeredBy);
      return NextResponse.json({ success: true, data: { execution } });
    }

    if (action === 'compose') {
      const name = body.name as string;
      const steps = body.steps as Array<{ name: string; type: Parameters<typeof composer.composeFromSteps>[1][0]['type']; handler: string; timeoutMs?: number }>;
      const workflow = composer.composeFromSteps(name, steps);
      return NextResponse.json({ success: true, data: { workflow } });
    }

    if (action === 'trigger_template') {
      const templateId = body.templateId as string;
      const context = (body.context as Record<string, unknown>) ?? {};
      const execution = await agent.triggerFromTemplate(templateId, context);
      return NextResponse.json({ success: true, data: { execution } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Workflow POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
