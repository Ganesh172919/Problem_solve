// ─────────────────────────────────────────────────────────────────────────────
// /api/health — system health check endpoint.
// Returns Gemini config status, DB connectivity, and scheduler state.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import getDb from '@/db/index';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';
import { getGeminiApiKey } from '@/lib/aiProvider';

const SERVER_START = Date.now();

export async function GET() {
  const checks: Record<string, { status: 'ok' | 'fail'; detail?: string }> = {};
  let overallHealthy = true;

  // Check: Database
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.database = { status: 'ok' };
  } catch (e) {
    checks.database = { status: 'fail', detail: e instanceof Error ? e.message : 'Unknown' };
    overallHealthy = false;
  }

  // Check: Gemini API key
  const geminiKey = getGeminiApiKey();
  checks.gemini = {
    status: geminiKey ? 'ok' : 'fail',
    detail: geminiKey ? 'API key configured' : 'GEMINI_API_KEY not set',
  };

  // Check: Scheduler
  try {
    const sched = getSchedulerStatus();
    checks.scheduler = {
      status: 'ok',
      detail: `running=${sched.running}, generated=${sched.totalGenerated}`,
    };
  } catch {
    checks.scheduler = { status: 'fail', detail: 'Scheduler unavailable' };
  }

  return NextResponse.json({
    status: overallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    geminiConfigured: !!geminiKey,
    checks,
  });
}
