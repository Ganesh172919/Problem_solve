import { NextRequest, NextResponse } from 'next/server';
import { getFeatureAdoptionTracker } from '@/lib/featureAdoptionTracker';

export async function GET(request: NextRequest) {
  const tracker = getFeatureAdoptionTracker();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'health';

  switch (action) {
    case 'health':
      return NextResponse.json(tracker.getProductHealthScore());

    case 'metrics': {
      const featureId = searchParams.get('featureId');
      if (!featureId) return NextResponse.json({ error: 'featureId required' }, { status: 400 });
      return NextResponse.json(tracker.getAdoptionMetrics(featureId));
    }

    case 'correlations':
      return NextResponse.json(tracker.getFeatureCorrelations());

    case 'journey': {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      return NextResponse.json(tracker.getUserJourney(userId));
    }

    case 'insights':
      return NextResponse.json(tracker.generateInsights());

    case 'features':
      return NextResponse.json(tracker.getFeatures());

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const tracker = getFeatureAdoptionTracker();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'register_feature':
      tracker.registerFeature(body.feature);
      return NextResponse.json({ success: true });

    case 'track':
      tracker.trackUsage(body.event);
      return NextResponse.json({ success: true });

    case 'set_total_users':
      tracker.setTotalUsers(body.count);
      return NextResponse.json({ success: true });

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
