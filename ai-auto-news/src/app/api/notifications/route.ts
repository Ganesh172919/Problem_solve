import { NextRequest, NextResponse } from 'next/server';
import type { NotificationCategory } from '@/lib/notificationEngine';
import {
  sendNotification,
  sendTemplateNotification,
  getUserInbox,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  updatePreferences,
  getUserPreferences,
  getNotificationStats,
  getTemplates,
} from '@/lib/notificationEngine';

// GET /api/notifications — Get inbox, preferences, or stats
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') ?? 'inbox';
    const userId = searchParams.get('userId');

    if (view === 'templates') {
      return NextResponse.json({ templates: getTemplates() });
    }

    if (view === 'stats') {
      const channel = searchParams.get('channel') as 'email' | 'in_app' | 'push' | 'slack' | 'sms';
      const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
      if (!channel) return NextResponse.json({ error: 'channel required for stats' }, { status: 400 });
      return NextResponse.json({ stats: getNotificationStats(channel, date) });
    }

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    if (view === 'preferences') {
      return NextResponse.json({ preferences: getUserPreferences(userId) });
    }

    if (view === 'unread_count') {
      return NextResponse.json({ count: getUnreadCount(userId) });
    }

    // Default: inbox
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const category = searchParams.get('category') as NotificationCategory | undefined;
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    const notifications = getUserInbox(userId, { unreadOnly, category, limit });
    return NextResponse.json({
      notifications,
      count: notifications.length,
      unreadCount: getUnreadCount(userId),
    });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/notifications — Send notification, mark as read, update preferences
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: string;
      userId?: string;
      notificationId?: string;
      templateId?: string;
      channel?: 'email' | 'in_app' | 'push' | 'slack' | 'sms';
      category?: string;
      priority?: 'critical' | 'high' | 'normal' | 'low';
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      variables?: Record<string, string>;
      channels?: Array<'email' | 'in_app' | 'push' | 'slack' | 'sms'>;
      preferences?: Record<string, unknown>;
      tenantId?: string;
    };

    const { action } = body;

    if (action === 'mark_read') {
      if (!body.userId || !body.notificationId) {
        return NextResponse.json({ error: 'userId and notificationId required' }, { status: 400 });
      }
      const success = markAsRead(body.userId, body.notificationId);
      return NextResponse.json({ success });
    }

    if (action === 'mark_all_read') {
      if (!body.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      const count = markAllAsRead(body.userId);
      return NextResponse.json({ success: true, marked: count });
    }

    if (action === 'update_preferences') {
      if (!body.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      const updated = updatePreferences(body.userId, body.preferences as Parameters<typeof updatePreferences>[1]);
      return NextResponse.json({ preferences: updated });
    }

    if (action === 'send_template') {
      if (!body.templateId || !body.userId || !body.variables) {
        return NextResponse.json({ error: 'templateId, userId, and variables required' }, { status: 400 });
      }
      const notifications = await sendTemplateNotification(
        body.templateId,
        body.userId,
        body.variables,
        body.channels,
        body.tenantId,
      );
      return NextResponse.json({ notifications, sent: notifications.length });
    }

    // Default: send notification
    if (!body.userId || !body.channel || !body.bodyText || !body.category || !body.priority) {
      return NextResponse.json(
        { error: 'userId, channel, bodyText, category, and priority required' },
        { status: 400 },
      );
    }

    const notification = await sendNotification({
      channel: body.channel,
      userId: body.userId,
      tenantId: body.tenantId,
      category: body.category as Parameters<typeof sendNotification>[0]['category'],
      priority: body.priority,
      subject: body.subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      variables: body.variables,
    });

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    console.error('Notifications POST error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error',
    }, { status: 500 });
  }
}
