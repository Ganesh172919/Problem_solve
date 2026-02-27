import { NextRequest, NextResponse } from 'next/server';
import { getFederatedLearningEngine } from '@/lib/federatedLearningEngine';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const engine = getFederatedLearningEngine();
  const { action } = body;

  try {
    switch (action) {
      case 'create_model': {
        const model = engine.createModel(
          body.id,
          body.name,
          body.architecture,
          body.strategy,
          body.privacyBudget
        );
        return NextResponse.json({ success: true, data: model });
      }
      case 'register_participant': {
        const participant = engine.registerParticipant(
          body.participantId,
          body.tenantId,
          body.modelId,
          body.dataSize,
          body.config
        );
        return NextResponse.json({ success: true, data: participant });
      }
      case 'start_round': {
        const round = engine.startRound(body.modelId);
        return NextResponse.json({ success: true, data: round });
      }
      case 'submit_update': {
        engine.submitUpdate(body.roundId, body.update);
        return NextResponse.json({ success: true });
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
  const modelId = searchParams.get('modelId');
  const action = searchParams.get('action') ?? 'stats';

  const engine = getFederatedLearningEngine();

  try {
    switch (action) {
      case 'stats': {
        if (!modelId) return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
        const stats = engine.getModelStats(modelId);
        return NextResponse.json({ success: true, data: stats });
      }
      case 'list': {
        const models = engine.listModels();
        return NextResponse.json({ success: true, data: models });
      }
      case 'round': {
        if (!modelId) return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
        const round = engine.getActiveRound(modelId);
        return NextResponse.json({ success: true, data: round ?? null });
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
