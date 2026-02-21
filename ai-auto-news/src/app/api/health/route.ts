import { NextResponse } from 'next/server';
import getDb from '@/db/index';
import { getTaskQueueStatus } from '@/workers/taskQueue';
import { getSchedulerStatus } from '@/scheduler/autoPublisher';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: Record<string, { status: 'ok' | 'fail'; latencyMs?: number; detail?: string }>;
}

const SERVER_START = Date.now();

export async function GET() {
  const checks: HealthStatus['checks'] = {};
  let overallHealthy = true;

  // Check: Database connectivity
  const dbStart = Date.now();
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (e) {
    checks.database = {
      status: 'fail',
      latencyMs: Date.now() - dbStart,
      detail: e instanceof Error ? e.message : 'Unknown error',
    };
    overallHealthy = false;
  }

  // Check: Task queue
  try {
    const tq = getTaskQueueStatus();
    checks.taskQueue = {
      status: 'ok',
      detail: `running=${tq.running}, pending=${tq.taskStats.pending}, failed=${tq.taskStats.failed}`,
    };
  } catch {
    checks.taskQueue = { status: 'fail', detail: 'Task queue unavailable' };
  }

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

  const status: HealthStatus['status'] = overallHealthy ? 'healthy' : 'unhealthy';
  const body: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    checks,
  };

  return NextResponse.json(body, { status: overallHealthy ? 200 : 503 });
}
