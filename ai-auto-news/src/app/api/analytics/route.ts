import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getEventCountsByName, getDailyEventCounts, queryAnalyticsEvents } from '@/db/analytics';
import { getSystemUsageSummary, getTopEndpoints } from '@/db/usage';
import { getUserStats } from '@/db/users';
import { getSubscriptionStats } from '@/db/subscriptions';

// GET /api/analytics — Dashboard analytics (admin only)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'overview';
    const days = parseInt(searchParams.get('days') || '7', 10);
    const eventName = searchParams.get('event') || '';
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    if (view === 'overview') {
      const [userStats, subscriptionStats, usageSummary, topEndpoints, eventCounts] =
        await Promise.all([
          getUserStats(),
          getSubscriptionStats(),
          getSystemUsageSummary(days),
          getTopEndpoints(10, days),
          getEventCountsByName(days),
        ]);

      return NextResponse.json({
        users: userStats,
        subscriptions: subscriptionStats,
        usage: usageSummary,
        topEndpoints,
        events: eventCounts,
        days,
      });
    }

    if (view === 'events') {
      const { events, total } = queryAnalyticsEvents({
        eventName: eventName || undefined,
        limit,
        since: new Date(Date.now() - days * 86_400_000).toISOString(),
      });
      return NextResponse.json({ events, total, days });
    }

    if (view === 'daily' && eventName) {
      const daily = getDailyEventCounts(eventName, days);
      return NextResponse.json({ eventName, daily, days });
    }

    return NextResponse.json({ error: 'Invalid view parameter' }, { status: 400 });
  } catch (error) {
    console.error('Error in analytics GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
