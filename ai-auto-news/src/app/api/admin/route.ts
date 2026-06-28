// ─────────────────────────────────────────────────────────────────────────────
// /api/admin — returns admin dashboard stats (post counts, scheduler status).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getPostStats } from '@/db/posts';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';
import { getModelUsageStats } from '@/lib/geminiService';
import getDb from '@/db/index';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postStats = getPostStats();
    const schedulerStatus = getSchedulerStatus();
    const geminiStats = getModelUsageStats();

    // Get recent agent log counts
    let recentLogCount = 0;
    let errorCount = 0;
    try {
      const db = getDb();
      recentLogCount = (db.prepare(
        `SELECT COUNT(*) as count FROM agent_logs WHERE created_at > datetime('now', '-24 hours')`
      ).get() as { count: number }).count;
      errorCount = (db.prepare(
        `SELECT COUNT(*) as count FROM agent_logs WHERE level = 'ERROR' AND created_at > datetime('now', '-24 hours')`
      ).get() as { count: number }).count;
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ...postStats,
      scheduler: schedulerStatus,
      gemini: geminiStats,
      logs: { recentCount: recentLogCount, errorCount },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
