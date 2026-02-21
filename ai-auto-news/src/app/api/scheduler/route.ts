import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getSchedulerStatus, toggleScheduler } from '@/scheduler/autoPublisher';

export async function GET() {
  try {
    const status = getSchedulerStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error getting scheduler status:', error);
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
    console.error('Error toggling scheduler:', error);
    return NextResponse.json({ error: 'Failed to toggle scheduler' }, { status: 500 });
  }
}
