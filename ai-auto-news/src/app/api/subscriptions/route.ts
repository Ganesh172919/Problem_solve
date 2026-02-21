import { NextRequest, NextResponse } from 'next/server';
import { getSubscriptionByUserId, createSubscription, cancelSubscription, updateSubscriptionTier } from '@/db/subscriptions';
import { updateUserTier, getUserById } from '@/db/users';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { trackAnalyticsEvent } from '@/db/analytics';
import { SubscriptionTier } from '@/types/saas';

const VALID_TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

// GET /api/subscriptions — Get current user's subscription
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const subscription = getSubscriptionByUserId(user.id);
  if (!subscription) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  return NextResponse.json({ subscription });
}

// POST /api/subscriptions — Create or upgrade subscription
export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const tier = body.tier as string;
    if (!tier || !VALID_TIERS.includes(tier as SubscriptionTier)) {
      return NextResponse.json(
        { error: `Invalid tier. Valid tiers: ${VALID_TIERS.join(', ')}` },
        { status: 400 },
      );
    }

    const newTier = tier as SubscriptionTier;
    const existing = getSubscriptionByUserId(user.id);
    const oldTier = user.tier;

    if (existing) {
      updateSubscriptionTier(existing.id, newTier);
    } else {
      createSubscription(user.id, newTier);
    }

    updateUserTier(user.id, newTier);

    trackAnalyticsEvent({
      userId: user.id,
      sessionId: null,
      eventName: 'user.tier_changed',
      properties: { fromTier: oldTier, toTier: newTier },
      ipAddress: request.headers.get('x-forwarded-for') || null,
      userAgent: null,
    });

    const updatedUser = getUserById(user.id);
    const updatedSubscription = getSubscriptionByUserId(user.id);

    return NextResponse.json({ subscription: updatedSubscription, tier: updatedUser?.tier });
  } catch (error) {
    console.error('Error in subscriptions POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/subscriptions — Cancel subscription
export async function DELETE(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const immediate = searchParams.get('immediate') === 'true';

    const subscription = getSubscriptionByUserId(user.id);
    if (!subscription) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    cancelSubscription(subscription.id, immediate);

    if (immediate) {
      updateUserTier(user.id, 'free');
    }

    trackAnalyticsEvent({
      userId: user.id,
      sessionId: null,
      eventName: 'user.tier_changed',
      properties: { fromTier: user.tier, toTier: immediate ? 'free' : user.tier, reason: 'cancellation' },
      ipAddress: null,
      userAgent: null,
    });

    return NextResponse.json({ success: true, immediate });
  } catch (error) {
    console.error('Error in subscriptions DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
