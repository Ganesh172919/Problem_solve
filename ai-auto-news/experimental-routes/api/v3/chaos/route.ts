import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getIntelligentChaosEngine, type ChaosExperiment } from '@/lib/intelligentChaosEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const targetService = searchParams.get('targetService');

  try {
    const engine = getIntelligentChaosEngine();

    // Access the internal experiments map via type cast – no public list method exists
    const engineInternal = engine as unknown as { experiments: Map<string, ChaosExperiment> };
    const allExperiments = Array.from(engineInternal.experiments.values());
    const filtered = allExperiments.filter(exp => {
      if (status && exp.status !== status) return false;
      if (targetService && exp.targetService !== targetService) return false;
      return true;
    });

    const metrics = engine.getMetrics();

    logger.info('Chaos experiments listed', {
      total: allExperiments.length,
      filtered: filtered.length,
      status,
      targetService,
    });

    return NextResponse.json({
      success: true,
      data: {
        experiments: filtered,
        metrics: {
          totalExperiments: metrics.totalExperiments,
          successRate: metrics.successRate,
          avgResilienceScore: metrics.avgResilienceScore,
          mttrImprovement: metrics.mttrImprovement,
          slosBreached: metrics.slosBreached,
        },
        filters: { status, targetService },
      },
    });
  } catch (error) {
    logger.error('Failed to list chaos experiments', undefined, { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action: 'create' | 'run' | 'abort' | 'analyze';
    experiment?: Record<string, unknown>;
    experimentId?: string;
    config?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, experiment, experimentId } = body;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  try {
    const engine = getIntelligentChaosEngine();

    if (action === 'create') {
      if (!experiment) {
        return NextResponse.json({ error: 'experiment is required for action=create' }, { status: 400 });
      }
      const created = engine.createExperiment(experiment as Parameters<typeof engine.createExperiment>[0]);
      logger.info('Chaos experiment created', { experimentId: created.id });
      return NextResponse.json({ success: true, data: { experiment: created } });
    }

    if (action === 'run') {
      if (!experimentId) {
        return NextResponse.json({ error: 'experimentId is required for action=run' }, { status: 400 });
      }
      const observations = await engine.runExperiment(experimentId);
      logger.info('Chaos experiment run', { experimentId, observations: observations.length });
      return NextResponse.json({ success: true, data: { observations } });
    }

    if (action === 'abort') {
      if (!experimentId) {
        return NextResponse.json({ error: 'experimentId is required for action=abort' }, { status: 400 });
      }
      await engine.abortAndRollback(experimentId, 'api_request');
      logger.info('Chaos experiment aborted', { experimentId });
      return NextResponse.json({ success: true, data: { experimentId, aborted: true } });
    }

    if (action === 'analyze') {
      if (!experimentId) {
        return NextResponse.json({ error: 'experimentId is required for action=analyze' }, { status: 400 });
      }
      const analysis = engine.analyzeResilience(experimentId);
      logger.info('Chaos experiment analyzed', { experimentId, score: analysis.score });
      return NextResponse.json({ success: true, data: { analysis } });
    }

    return NextResponse.json(
      { error: `Unknown action '${action}'. Valid actions: create, run, abort, analyze` },
      { status: 400 },
    );
  } catch (error) {
    logger.error('Chaos API error', undefined, { action, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
