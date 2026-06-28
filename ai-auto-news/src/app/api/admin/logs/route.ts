// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/logs — returns recent agent logs for the admin dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import getDb from '@/db/index';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const runId = searchParams.get('run_id');

    const db = getDb();

    let logs;
    if (runId) {
      logs = db.prepare(`
        SELECT id, run_id, agent_name, level, message, metadata, gemini_model, created_at
        FROM agent_logs
        WHERE run_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(runId, limit);
    } else {
      logs = db.prepare(`
        SELECT id, run_id, agent_name, level, message, metadata, gemini_model, created_at
        FROM agent_logs
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);
    }

    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json({ logs: [], error: String(error) }, { status: 500 });
  }
}
