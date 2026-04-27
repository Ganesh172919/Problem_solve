import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getKnowledgeDistillation } from '@/lib/knowledgeDistillationEngine';
import { getKnowledgeOpsAgent } from '@/agents/knowledgeOpsAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const domain = searchParams.get('domain') ?? undefined;

  try {
    const distillation = getKnowledgeDistillation();
    const agent = getKnowledgeOpsAgent();

    if (action === 'gaps') {
      const gaps = agent.getGaps();
      return NextResponse.json({ success: true, data: { gaps } });
    }

    if (action === 'insights') {
      const insights = agent.getInsights();
      return NextResponse.json({ success: true, data: { insights } });
    }

    if (action === 'distillation_results') {
      const results = distillation.getDistillationResults();
      return NextResponse.json({ success: true, data: { results } });
    }

    if (action === 'bank_stats') {
      const stats = distillation.getKnowledgeBankStats();
      return NextResponse.json({ success: true, data: { stats, domain } });
    }

    const agentStats = agent.getStats();
    const distillationStats = distillation.getStats();

    return NextResponse.json({
      success: true,
      data: {
        agent: agentStats,
        distillation: distillationStats,
      },
    });
  } catch (err) {
    logger.error('Knowledge GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const distillation = getKnowledgeDistillation();
    const agent = getKnowledgeOpsAgent();

    if (action === 'ingest') {
      const doc = body.document as Parameters<typeof agent.ingest>[0];
      agent.ingest(doc);
      return NextResponse.json({ success: true, data: { message: 'Document ingested', id: doc.id } });
    }

    if (action === 'ingest_batch') {
      const docs = body.documents as Parameters<typeof agent.ingestBatch>[0];
      agent.ingestBatch(docs);
      return NextResponse.json({ success: true, data: { message: 'Batch ingested', count: docs.length } });
    }

    if (action === 'search') {
      const query = body.query as Parameters<typeof agent.search>[0];
      const result = agent.search(query);
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'register_model') {
      const model = body.model as Parameters<typeof distillation.registerModel>[0];
      distillation.registerModel(model);
      return NextResponse.json({ success: true, data: { message: 'Model registered', id: model.id } });
    }

    if (action === 'distill') {
      const config = body.config as Parameters<typeof distillation.distill>[0];
      const result = await distillation.distill(config);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'plan_pruning') {
      const modelId = body.modelId as string;
      const targetSparsity = body.targetSparsity as number;
      const plan = distillation.planPruning(modelId, targetSparsity);
      return NextResponse.json({ success: true, data: { plan } });
    }

    if (action === 'plan_quantization') {
      const modelId = body.modelId as string;
      const targetPrecision = body.targetPrecision as Parameters<typeof distillation.planQuantization>[1];
      const plan = distillation.planQuantization(modelId, targetPrecision);
      return NextResponse.json({ success: true, data: { plan } });
    }

    if (action === 'generate_finetuning_data') {
      const domain = body.domain as string;
      const style = body.style as Parameters<typeof distillation.generateFineTuningData>[1];
      const count = body.count as number ?? 100;
      const data = distillation.generateFineTuningData(domain, style, count);
      return NextResponse.json({ success: true, data: { count: data.length, samples: data.slice(0, 10) } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Knowledge POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
