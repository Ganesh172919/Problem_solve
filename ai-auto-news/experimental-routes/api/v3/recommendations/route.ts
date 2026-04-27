import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getRecommendationEngine } from '@/lib/intelligentRecommendationEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  try {
    const engine = getRecommendationEngine();

    if (action === 'stats') {
      const stats = engine.getStats();
      return NextResponse.json({ success: true, data: { stats } });
    }

    const recommendations = engine.getRecommendations(userId as string);
    return NextResponse.json({ success: true, data: { userId, recommendations } });
  } catch (err) {
    logger.error('Recommendations GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const engine = getRecommendationEngine();

    if (action === 'add_item') {
      const item = body.item as Parameters<typeof engine.addItem>[0];
      engine.addItem(item);
      return NextResponse.json({ success: true, data: { message: 'Item added' } });
    }

    if (action === 'record_interaction') {
      engine.recordInteraction(
        body.userId as string,
        body.itemId as string,
        body.interactionType as string,
      );
      return NextResponse.json({ success: true, data: { message: 'Interaction recorded' } });
    }

    if (action === 'feedback') {
      engine.submitFeedback(body.userId as string, body.itemId as string, body.rating as number);
      return NextResponse.json({ success: true, data: { message: 'Feedback submitted' } });
    }

    if (action === 'get_recommendations') {
      const recommendations = engine.getRecommendations(
        body.userId as string,
        body.options as Record<string, unknown> | undefined,
      );
      return NextResponse.json({ success: true, data: { recommendations } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Recommendations POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
