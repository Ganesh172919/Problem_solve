import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { metrics } from '@/lib/metrics';
import { getSystemUsageSummary } from '@/db/usage';
import { getTaskQueueStatus } from '@/workers/taskQueue';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';

// GET /api/metrics — System performance metrics (admin only)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const snapshot = metrics.getSnapshot();
    const usageSummary = getSystemUsageSummary(1);
    const taskQueueStatus = getTaskQueueStatus();
    const schedulerStatus = getSchedulerStatus();

    return NextResponse.json({
      endpoints: snapshot,
      usage: usageSummary,
      taskQueue: taskQueueStatus,
      scheduler: schedulerStatus,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in metrics GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
