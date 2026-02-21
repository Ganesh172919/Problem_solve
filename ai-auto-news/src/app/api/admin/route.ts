import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getPostStats } from '@/db/posts';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postStats = getPostStats();
    const schedulerStatus = getSchedulerStatus();

    return NextResponse.json({
      ...postStats,
      scheduler: schedulerStatus,
    });
  } catch (error) {
    console.error('Error getting admin stats:', error);
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
