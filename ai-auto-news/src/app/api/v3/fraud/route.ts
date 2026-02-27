import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getFraudDetector, FraudEvent } from '@/lib/realtimeFraudDetector';
import { getFraudDetectionAgent } from '@/agents/fraudDetectionAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const action = searchParams.get('action');

  try {
    const detector = getFraudDetector();
    const agent = getFraudDetectionAgent();

    if (action === 'report') {
      const from = Number(searchParams.get('from') ?? Date.now() - 86400_000);
      const to = Number(searchParams.get('to') ?? Date.now());
      const report = agent.generateReport(from, to);
      return NextResponse.json({ success: true, data: { report } });
    }

    if (userId) {
      const history = detector.getUserHistory(userId);
      const alerts = agent.getAlerts(50).filter(a => a.assessment.userId === userId);
      return NextResponse.json({ success: true, data: { userId, history, alerts } });
    }

    const stats = agent.getStats();
    const recentAlerts = agent.getAlerts(50);

    return NextResponse.json({
      success: true,
      data: { stats, recentAlerts },
    });
  } catch (err) {
    logger.error('Fraud GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const detector = getFraudDetector();
    const agent = getFraudDetectionAgent();

    if (action === 'assess') {
      const event = body.event as FraudEvent;
      const alert = await agent.assessImmediate(event);
      return NextResponse.json({ success: true, data: { alert } });
    }

    if (action === 'submit') {
      const event = body.event as FraudEvent;
      agent.submitEvent(event);
      return NextResponse.json({ success: true, data: { message: 'Event queued for processing' } });
    }

    if (action === 'update_profile') {
      const profile = body.profile as Parameters<typeof detector.updateProfile>[0];
      detector.updateProfile(profile);
      return NextResponse.json({ success: true, data: { message: 'Profile updated' } });
    }

    if (action === 'blocklist') {
      const identifier = body.identifier as string;
      const remove = body.remove === true;
      if (remove) {
        detector.removeFromBlocklist(identifier);
        return NextResponse.json({ success: true, data: { message: `${identifier} removed from blocklist` } });
      }
      detector.addToBlocklist(identifier);
      return NextResponse.json({ success: true, data: { message: `${identifier} added to blocklist` } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Fraud POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
