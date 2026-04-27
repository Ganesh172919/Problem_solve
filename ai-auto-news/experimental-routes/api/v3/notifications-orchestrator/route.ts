import { NextRequest, NextResponse } from 'next/server';
import { getMultiChannelNotificationOrchestrator } from '../../../../lib/multiChannelNotificationOrchestrator';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? undefined;
    const action = searchParams.get('action') ?? 'summary';
    const engine = getMultiChannelNotificationOrchestrator();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'delivery_stats') {
      return NextResponse.json({ success: true, data: engine.getDeliveryStats(tenantId) });
    }
    if (action === 'status') {
      // Return delivery stats filtered to tenantId; there is no single-delivery lookup in the public API
      const stats = engine.getDeliveryStats(tenantId);
      return NextResponse.json({ success: true, data: stats });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const engine = getMultiChannelNotificationOrchestrator();

    if (action === 'register_channel') {
      const { channel, config } = body;
      if (!channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 });
      engine.registerChannel(channel, config ?? {});
      return NextResponse.json({ success: true });
    }
    if (action === 'create_template') {
      if (!body.template) return NextResponse.json({ error: 'template is required' }, { status: 400 });
      engine.createTemplate(body.template);
      return NextResponse.json({ success: true });
    }
    if (action === 'send') {
      const { tenantId, userId, templateId, channel, variables, priority, deduplicationKey } = body.notification ?? body;
      if (!tenantId || !userId || !templateId || !channel) {
        return NextResponse.json({ error: 'tenantId, userId, templateId, and channel are required' }, { status: 400 });
      }
      const delivery = engine.sendNotification(tenantId, userId, templateId, channel, variables ?? {}, priority, deduplicationKey);
      return NextResponse.json({ success: true, data: delivery });
    }
    if (action === 'suppress') {
      const { tenantId, recipientId, channel, reason, expiresInMs } = body;
      if (!recipientId || !channel || !reason) {
        return NextResponse.json({ error: 'recipientId, channel, and reason are required' }, { status: 400 });
      }
      engine.suppressRecipient(recipientId, tenantId ?? 'default', channel, reason, expiresInMs);
      return NextResponse.json({ success: true });
    }
    if (action === 'track_engagement') {
      const { deliveryId, userId, event, metadata } = body;
      if (!deliveryId || !userId || !event) {
        return NextResponse.json({ error: 'deliveryId, userId, and event are required' }, { status: 400 });
      }
      engine.trackEngagement(deliveryId, userId, event, metadata);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
