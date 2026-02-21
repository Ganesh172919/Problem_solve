import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getPostStats } from '@/db/posts';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';
import { getUserStats } from '@/db/users';
import { getSubscriptionStats } from '@/db/subscriptions';
import { getTaskQueueStatus } from '@/workers/taskQueue';
import { getSystemUsageSummary } from '@/db/usage';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postStats = getPostStats();
    const schedulerStatus = getSchedulerStatus();
    const userStats = getUserStats();
    const subscriptionStats = getSubscriptionStats();
    const taskQueueStatus = getTaskQueueStatus();
    const usageSummary = getSystemUsageSummary(7);

    return NextResponse.json({
      ...postStats,
      scheduler: schedulerStatus,
      users: userStats,
      subscriptions: subscriptionStats,
      taskQueue: taskQueueStatus,
      usage: usageSummary,
    });
  } catch (error) {
    console.error('Error getting admin stats:', error);
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
