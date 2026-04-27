import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getUserRetentionAgent } from '@/agents/userRetentionAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const segment = searchParams.get('segment') ?? 'all';
  const action = searchParams.get('action') ?? 'metrics';

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  try {
    const agent = getUserRetentionAgent();

    switch (action) {
      case 'metrics': {
        const now = Date.now();
        const period = { from: now - 30 * 24 * 3600_000, to: now };
        const report = agent.generateRetentionReport(period, tenantId);
        logger.info('Retention metrics retrieved', { tenantId, segment });
        return NextResponse.json({ success: true, data: report });
      }
      case 'at_risk': {
        const threshold = parseFloat(searchParams.get('threshold') ?? '50');
        const atRiskSegment = agent.segmentAtRiskUsers(threshold);
        return NextResponse.json({ success: true, data: atRiskSegment });
      }
      default:
        return NextResponse.json({ error: 'Unknown action. Use: metrics | at_risk' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Retention GET failed', undefined, { tenantId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    userId: string;
    action: 'score' | 'predict' | 'intervene' | 'personalize' | 'report';
    horizon?: number;
    tenantId?: string;
    period?: { from: number; to: number };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, action, horizon = 30 } = body;

  if (!userId && action !== 'report') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  if (!action) {
    return NextResponse.json(
      { error: 'action is required: score | predict | intervene | personalize | report' },
      { status: 400 }
    );
  }

  try {
    const agent = getUserRetentionAgent();

    switch (action) {
      case 'score': {
        const score = agent.computeRetentionScore(userId);
        logger.info('Retention score computed', {
          userId,
          score: score.score.toFixed(1),
          grade: score.grade,
          trend: score.trend,
        });
        return NextResponse.json({ success: true, data: score });
      }
      case 'predict': {
        const predictor = agent.predictChurn(userId, horizon);
        logger.info('Churn predicted', {
          userId,
          horizon,
          churnProbability: predictor.churnProbability.toFixed(3),
        });
        return NextResponse.json({ success: true, data: predictor });
      }
      case 'intervene': {
        // Compute fresh signals before designing intervention
        agent.computeRetentionScore(userId);
        agent.predictChurn(userId, horizon);
        const intervention = agent.designIntervention(userId, []);
        logger.info('Intervention designed', {
          userId,
          type: intervention.type,
          channel: intervention.channel,
          priority: intervention.priority,
        });
        return NextResponse.json({ success: true, data: intervention });
      }
      case 'personalize': {
        const boosters = agent.personalizeReEngagement(userId);
        return NextResponse.json({ success: true, data: boosters });
      }
      case 'report': {
        const now = Date.now();
        const period = body.period ?? { from: now - 30 * 24 * 3600_000, to: now };
        const report = agent.generateRetentionReport(period, body.tenantId);
        return NextResponse.json({ success: true, data: report });
      }
      default:
        return NextResponse.json(
          { error: 'Unknown action. Use: score | predict | intervene | personalize | report' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Retention POST failed', undefined, { userId, action, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
