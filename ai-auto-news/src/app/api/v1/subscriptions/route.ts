import { NextRequest, NextResponse } from 'next/server';
import { getSubscriptionByUserId } from '@/db/subscriptions';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { logger } from '@/lib/logger';

// GET /api/v1/subscriptions — Get current user's subscription
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;
    const subscription = getSubscriptionByUserId(user.id);
    if (!subscription) {
      return NextResponse.json({ success: false, error: 'No subscription found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: subscription });
  } catch (error) {
    logger.error('v1/subscriptions GET error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
