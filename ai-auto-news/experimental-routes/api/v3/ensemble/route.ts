import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getMultiModelEnsemble } from '@/lib/multiModelEnsemble';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskType = searchParams.get('taskType');

  try {
    const ensemble = getMultiModelEnsemble();

    const metrics = ensemble.getMetrics();

    logger.info('Ensemble metrics retrieved', { taskType });

    return NextResponse.json({
      success: true,
      data: {
        metrics: {
          totalRequests: metrics.totalRequests,
          avgConsensusScore: metrics.avgConsensusScore,
          avgCost: metrics.avgCost,
          avgLatency: metrics.avgLatency,
          modelUsageDistribution: metrics.modelUsageDistribution,
          costSavings: metrics.costSavings,
        },
        ...(taskType ? { filter: { taskType } } : {}),
      },
    });
  } catch (error) {
    logger.error('Failed to retrieve ensemble metrics', undefined, { taskType, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    prompt: string;
    taskType: string;
    requiredQuality?: number;
    maxCostTokens?: number;
    maxLatencyMs?: number;
    strategy?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { prompt, taskType, requiredQuality, maxCostTokens, maxLatencyMs, strategy } = body;

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  if (!taskType) {
    return NextResponse.json({ error: 'taskType is required' }, { status: 400 });
  }

  try {
    const ensemble = getMultiModelEnsemble();

    const result = await ensemble.infer({
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      prompt,
      taskType,
      requiredQuality: requiredQuality ?? 0.7,
      maxCostTokens: maxCostTokens ?? 4096,
      maxLatencyMs: maxLatencyMs ?? 10000,
      contextWindow: 8192,
    });

    logger.info('Ensemble inference successful', {
      taskType,
      strategy: result.strategy,
      latencyMs: result.totalLatencyMs,
      cost: result.totalCost,
      consensusScore: result.consensusScore,
    });

    return NextResponse.json({
      success: true,
      data: {
        completion: result.finalResponse,
        requestId: result.requestId,
        strategy: strategy ?? result.strategy,
        consensusScore: result.consensusScore,
        totalCost: result.totalCost,
        totalLatencyMs: result.totalLatencyMs,
        modelResponses: result.modelResponses.length,
      },
    });
  } catch (error) {
    logger.error('Ensemble inference failed', undefined, { taskType, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
