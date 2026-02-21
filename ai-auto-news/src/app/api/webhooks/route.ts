import { NextRequest, NextResponse } from 'next/server';
import { createWebhook, getWebhooksByUserId, deleteWebhook, updateWebhook } from '@/db/webhooks';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { canUseWebhooks } from '@/lib/featureGate';
import { validateUrl, validateWebhookEvents, ValidationError } from '@/lib/validation';

// GET /api/webhooks — List user's webhooks
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;

  if (!canUseWebhooks(user.tier)) {
    return NextResponse.json(
      { error: 'Webhooks require a Pro or Enterprise subscription' },
      { status: 403 },
    );
  }

  const webhooks = getWebhooksByUserId(user.id);
  // Redact secret from listing
  const safeWebhooks = webhooks.map(({ secret: _s, ...w }) => w);

  return NextResponse.json({ webhooks: safeWebhooks, total: safeWebhooks.length });
}

// POST /api/webhooks — Create webhook
export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;

  if (!canUseWebhooks(user.tier)) {
    return NextResponse.json(
      { error: 'Webhooks require a Pro or Enterprise subscription' },
      { status: 403 },
    );
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let url: string;
    let events: string[];

    try {
      url = validateUrl(body.url);
      events = validateWebhookEvents(body.events);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
      }
      throw e;
    }

    const webhook = createWebhook({ userId: user.id, url, events });

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    console.error('Error in webhooks POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/webhooks?id=<webhookId> — Delete webhook
export async function DELETE(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const { searchParams } = new URL(request.url);
  const webhookId = searchParams.get('id');

  if (!webhookId) {
    return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
  }

  const deleted = deleteWebhook(webhookId, user.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/webhooks?id=<webhookId> — Update webhook
export async function PATCH(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const { searchParams } = new URL(request.url);
  const webhookId = searchParams.get('id');

  if (!webhookId) {
    return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: { url?: string; events?: string[]; isActive?: boolean } = {};

    if (body.url !== undefined) {
      try {
        updates.url = validateUrl(body.url);
      } catch (e) {
        if (e instanceof ValidationError) {
          return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
        }
        throw e;
      }
    }

    if (body.events !== undefined) {
      try {
        updates.events = validateWebhookEvents(body.events);
      } catch (e) {
        if (e instanceof ValidationError) {
          return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
        }
        throw e;
      }
    }

    if (typeof body.isActive === 'boolean') {
      updates.isActive = body.isActive;
    }

    const updated = updateWebhook(webhookId, user.id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in webhooks PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
