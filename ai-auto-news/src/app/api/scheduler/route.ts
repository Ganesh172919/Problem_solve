import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getSchedulerStatus, toggleScheduler } from '@/scheduler/autoPublisher';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const status = getSchedulerStatus();
    return NextResponse.json(status);
  } catch (error) {
    logger.error('Error getting scheduler status', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const running = toggleScheduler();
    return NextResponse.json({ running });
  } catch (error) {
    logger.error('Error toggling scheduler', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Failed to toggle scheduler' }, { status: 500 });
  }
}
