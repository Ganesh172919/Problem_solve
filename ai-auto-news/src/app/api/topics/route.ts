import { NextRequest, NextResponse } from 'next/server';
import {
  createCustomTopic,
  getCustomTopicsByUserId,
  updateCustomTopic,
  deleteCustomTopic,
  getTopicCount,
} from '@/db/customTopics';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { canUseCustomTopics } from '@/lib/featureGate';
import { writeAuditLog } from '@/db/auditLog';

const MAX_TOPICS_PER_USER = 50;

// GET /api/topics — List user's custom topics
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  if (!canUseCustomTopics(user.tier)) {
    return NextResponse.json(
      { error: 'Custom topics require a Pro or Enterprise subscription' },
      { status: 403 },
    );
  }

  const topics = getCustomTopicsByUserId(user.id);
  return NextResponse.json({ topics, total: topics.length });
}

// POST /api/topics — Create a custom topic
export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  if (!canUseCustomTopics(user.tier)) {
    return NextResponse.json(
      { error: 'Custom topics require a Pro or Enterprise subscription' },
      { status: 403 },
    );
  }

  const count = getTopicCount(user.id);
  if (count >= MAX_TOPICS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_TOPICS_PER_USER} custom topics allowed per user` },
      { status: 409 },
    );
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (!topic || topic.length < 3) {
      return NextResponse.json(
        { error: 'Topic must be at least 3 characters' },
        { status: 400 },
      );
    }
    if (topic.length > 200) {
      return NextResponse.json({ error: 'Topic must be 200 characters or fewer' }, { status: 400 });
    }

    const weight = typeof body.weight === 'number' ? Math.max(1, Math.min(10, Math.floor(body.weight))) : 1;

    const created = createCustomTopic(user.id, topic, weight);

    writeAuditLog({
      actorId: user.id,
      actorType: 'user',
      action: 'topic.created',
      resourceType: 'custom_topic',
      resourceId: created.id,
      details: { topic, weight },
      ipAddress: request.headers.get('x-forwarded-for'),
    });

    return NextResponse.json({ topic: created }, { status: 201 });
  } catch (error) {
    console.error('Error in topics POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/topics?id=<topicId> — Update a custom topic
export async function PATCH(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  if (!canUseCustomTopics(user.tier)) {
    return NextResponse.json(
      { error: 'Custom topics require a Pro or Enterprise subscription' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get('id');
  if (!topicId) {
    return NextResponse.json({ error: 'Topic ID is required' }, { status: 400 });
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: { topic?: string; isActive?: boolean; weight?: number } = {};
    if (typeof body.topic === 'string') {
      const t = body.topic.trim();
      if (t.length < 3 || t.length > 200) {
        return NextResponse.json({ error: 'Topic must be 3–200 characters' }, { status: 400 });
      }
      updates.topic = t;
    }
    if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
    if (typeof body.weight === 'number') {
      updates.weight = Math.max(1, Math.min(10, Math.floor(body.weight)));
    }

    const updated = updateCustomTopic(topicId, user.id, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
    }

    writeAuditLog({
      actorId: user.id,
      actorType: 'user',
      action: 'topic.updated',
      resourceType: 'custom_topic',
      resourceId: topicId,
      details: updates,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in topics PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/topics?id=<topicId> — Delete a custom topic
export async function DELETE(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get('id');
  if (!topicId) {
    return NextResponse.json({ error: 'Topic ID is required' }, { status: 400 });
  }

  const deleted = deleteCustomTopic(topicId, user.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
  }

  writeAuditLog({
    actorId: user.id,
    actorType: 'user',
    action: 'topic.deleted',
    resourceType: 'custom_topic',
    resourceId: topicId,
    details: {},
    ipAddress: request.headers.get('x-forwarded-for'),
  });

  return NextResponse.json({ success: true });
}
