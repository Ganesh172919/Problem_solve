import { NextRequest, NextResponse } from 'next/server';
import { getMLOpsOrchestrator } from '@/agents/mlOpsOrchestrator';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const orchestrator = getMLOpsOrchestrator();
  const { action } = body;

  try {
    switch (action) {
      case 'create_experiment': {
        const exp = orchestrator.createExperiment(body.name, body.projectId, body.description, body.tags);
        return NextResponse.json({ success: true, data: exp });
      }
      case 'log_run': {
        const run = orchestrator.logRun(body.experimentId, body.params, body.metrics, body.artifacts);
        return NextResponse.json({ success: true, data: run });
      }
      case 'register_model': {
        const model = orchestrator.registerModel(body.name, body.framework, body.task, body.description, body.tags);
        return NextResponse.json({ success: true, data: model });
      }
      case 'add_version': {
        const version = orchestrator.addModelVersion(
          body.modelId, body.runId, body.metrics, body.params, body.signature, body.requirements
        );
        return NextResponse.json({ success: true, data: version });
      }
      case 'promote': {
        orchestrator.promoteModel(body.modelId, body.version, body.stage, body.approvedBy);
        return NextResponse.json({ success: true });
      }
      case 'hyperparameter_search': {
        const result = orchestrator.runHyperparameterSearch(body.experimentId, body.config);
        return NextResponse.json({ success: true, data: result });
      }
      case 'deploy': {
        const deployment = orchestrator.deployModel(
          body.modelId, body.version, body.environment, body.strategy, body.config
        );
        return NextResponse.json({ success: true, data: deployment });
      }
      case 'detect_drift': {
        const report = orchestrator.detectDrift(body.modelId, body.version, body.featureStats);
        return NextResponse.json({ success: true, data: report });
      }
      case 'schedule_retraining': {
        const job = orchestrator.scheduleRetraining(body.modelId, body.trigger);
        return NextResponse.json({ success: true, data: job });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'catalog';

  const orchestrator = getMLOpsOrchestrator();

  try {
    switch (action) {
      case 'catalog': {
        const models = orchestrator.getModelCatalog();
        return NextResponse.json({ success: true, data: models });
      }
      case 'experiment_summary': {
        const experimentId = searchParams.get('experimentId');
        if (!experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 });
        const summary = orchestrator.getExperimentSummary(experimentId);
        return NextResponse.json({ success: true, data: summary });
      }
      case 'deployment': {
        const deploymentId = searchParams.get('deploymentId');
        if (!deploymentId) return NextResponse.json({ error: 'deploymentId required' }, { status: 400 });
        const deployment = orchestrator.getDeploymentStatus(deploymentId);
        if (!deployment) return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        return NextResponse.json({ success: true, data: deployment });
      }
      case 'drift_history': {
        const modelId = searchParams.get('modelId');
        if (!modelId) return NextResponse.json({ error: 'modelId required' }, { status: 400 });
        const history = orchestrator.getDriftHistory(modelId);
        return NextResponse.json({ success: true, data: history });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
