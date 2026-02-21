import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { queryAuditLog, getRecentAuditEntries, purgeOldAuditLogs } from '@/db/auditLog';

// GET /api/audit — Query audit log (admin only)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'recent';

    if (view === 'recent') {
      const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
      const entries = getRecentAuditEntries(limit);
      return NextResponse.json({ entries, total: entries.length });
    }

    // Filtered query
    const actorId = searchParams.get('actorId') || undefined;
    const action = searchParams.get('action') || undefined;
    const resourceType = searchParams.get('resourceType') || undefined;
    const since = searchParams.get('since') || undefined;
    const until = searchParams.get('until') || undefined;
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const offset = (page - 1) * limit;

    const result = queryAuditLog({ actorId, action, resourceType, since, until, limit, offset });

    return NextResponse.json({
      ...result,
      page,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (error) {
    console.error('Error in audit GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/audit?olderThanDays=<n> — Purge old audit entries (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.max(7, parseInt(searchParams.get('olderThanDays') || '90', 10));
    const purged = purgeOldAuditLogs(days);

    return NextResponse.json({ success: true, purged, olderThanDays: days });
  } catch (error) {
    console.error('Error in audit DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
