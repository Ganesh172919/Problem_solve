import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getCustomerJourneyMapper } from '@/lib/customerJourneyMapper';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const includeInsights = searchParams.get('includeInsights') === 'true';
  const action = searchParams.get('action') ?? 'journey';

  if (!userId && !['insights', 'forecast'].includes(action)) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const mapper = getCustomerJourneyMapper();

    switch (action) {
      case 'journey': {
        const journey = mapper.buildJourney(userId!);
        const report = mapper.exportJourneyReport(userId!);

        let insights = null;
        if (includeInsights) {
          insights = mapper.generateInsights([journey]);
        }

        logger.info('Customer journey retrieved', {
          userId,
          journeyId: journey.id,
          touchpoints: journey.touchPoints.length,
          includeInsights,
        });

        return NextResponse.json({
          success: true,
          data: { journey, report, insights },
        });
      }
      case 'dropoffs': {
        const funnelId = searchParams.get('funnelId');
        if (!funnelId) {
          return NextResponse.json({ error: 'funnelId is required for dropoff analysis' }, { status: 400 });
        }
        const analysis = mapper.analyzeDropoffs(funnelId);
        return NextResponse.json({ success: true, data: analysis });
      }
      case 'attribution': {
        const journeyId = searchParams.get('journeyId');
        const model = (searchParams.get('model') ?? 'linear') as unknown as import('@/lib/customerJourneyMapper').AttributionModel;
        if (!journeyId) {
          return NextResponse.json({ error: 'journeyId is required for attribution' }, { status: 400 });
        }
        const attribution = mapper.computeAttribution(journeyId, model);
        return NextResponse.json({ success: true, data: attribution });
      }
      case 'optimize': {
        const funnelId = searchParams.get('funnelId');
        if (!funnelId) {
          return NextResponse.json({ error: 'funnelId is required for optimization' }, { status: 400 });
        }
        const optimization = mapper.optimizeJourney(funnelId);
        return NextResponse.json({ success: true, data: optimization });
      }
      case 'forecast': {
        const segment = searchParams.get('segment') ?? 'all';
        const forecast = mapper.forecastConversions(segment);
        return NextResponse.json({ success: true, data: { segment, forecast } });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Journey GET failed', undefined, { userId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    userId?: string;
    touchpoint?: import('@/lib/customerJourneyMapper').TouchPoint;
    action?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, touchpoint, action = 'track' } = body;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const mapper = getCustomerJourneyMapper();

    switch (action) {
      case 'track': {
        if (!touchpoint) {
          return NextResponse.json({ error: 'touchpoint is required for track action' }, { status: 400 });
        }
        mapper.trackTouchpoint(userId, touchpoint);
        logger.info('Touchpoint tracked', {
          userId,
          touchpointId: touchpoint.id,
          channel: touchpoint.channel,
          action: touchpoint.action,
        });
        return NextResponse.json({ success: true, data: { userId, touchpointId: touchpoint.id } });
      }
      case 'build': {
        const journey = mapper.buildJourney(userId);
        return NextResponse.json({ success: true, data: journey });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Journey POST failed', undefined, { userId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
