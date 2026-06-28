import { NextRequest, NextResponse } from 'next/server';
import { getWebhooksByUserId, createWebhook, deleteWebhook } from '@/db/webhooks';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { canUseWebhooks } from '@/lib/featureGate';
import { validateUrl, validateWebhookEvents, ValidationError } from '@/lib/validation';
import { logger } from '@/lib/logger';

// GET /api/v1/webhooks — List user's webhooks
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;

    if (!canUseWebhooks(user.tier)) {
      return NextResponse.json(
        { success: false, error: 'Webhooks require a Pro or Enterprise subscription' },
        { status: 403 },
      );
    }

    const webhooks = getWebhooksByUserId(user.id);
    // Redact secret from listing
    const safeWebhooks = webhooks.map(({ secret: _s, ...w }) => w);

    return NextResponse.json({ success: true, data: safeWebhooks, total: safeWebhooks.length });
  } catch (error) {
    logger.error('v1/webhooks GET error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/v1/webhooks — Create webhook
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;

    if (!canUseWebhooks(user.tier)) {
      return NextResponse.json(
        { success: false, error: 'Webhooks require a Pro or Enterprise subscription' },
        { status: 403 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    let url: string;
    let events: string[];

    try {
      url = validateUrl(body.url);
      events = validateWebhookEvents(body.events);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ success: false, error: e.message, field: e.field }, { status: 400 });
      }
      throw e;
    }

    const webhook = createWebhook({ userId: user.id, url, events });
    const { secret: _s, ...safeWebhook } = webhook;

    return NextResponse.json(
      {
        success: true,
        data: safeWebhook,
        secret: webhook.secret,
        message: 'Store this secret securely — it is used to verify webhook signatures.',
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('v1/webhooks POST error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/v1/webhooks?id=<webhookId> — Delete webhook
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;
    const { searchParams } = new URL(request.url);
    const webhookId = searchParams.get('id');

    if (!webhookId) {
      return NextResponse.json({ success: false, error: 'Webhook ID is required' }, { status: 400 });
    }

    const deleted = deleteWebhook(webhookId, user.id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('v1/webhooks DELETE error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
