import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import {
  listFeatureFlags,
  createFeatureFlag,
  updateFeatureFlag,
  deleteFeatureFlag,
} from '@/db/featureFlags';
import { SubscriptionTier } from '@/types/saas';

const VALID_TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

// GET /api/features — List feature flags (admin only)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const flags = listFeatureFlags();
    return NextResponse.json({ flags, total: flags.length });
  } catch (error) {
    console.error('Error in features GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/features — Create feature flag (admin only)
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Flag name is required' }, { status: 400 });
    }
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
      return NextResponse.json(
        { error: 'Flag name must be lowercase letters, digits, and underscores' },
        { status: 400 },
      );
    }

    const description = String(body.description || '').trim();
    const enabledTiers = Array.isArray(body.enabledTiers)
      ? (body.enabledTiers as string[]).filter((t) => VALID_TIERS.includes(t as SubscriptionTier)) as SubscriptionTier[]
      : VALID_TIERS;
    const isGlobal = Boolean(body.isGlobal);
    const rolloutPercent = Math.min(100, Math.max(0, parseInt(String(body.rolloutPercent || '100'), 10)));

    const flag = createFeatureFlag({ name, description, enabledTiers, isGlobal, rolloutPercent });
    return NextResponse.json({ flag }, { status: 201 });
  } catch (error) {
    console.error('Error in features POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/features?name=<flagName> — Update feature flag (admin only)
export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const flagName = searchParams.get('name');
    if (!flagName) {
      return NextResponse.json({ error: 'Flag name is required' }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: Parameters<typeof updateFeatureFlag>[1] = {};
    if (typeof body.description === 'string') updates.description = body.description;
    if (typeof body.isGlobal === 'boolean') updates.isGlobal = body.isGlobal;
    if (typeof body.rolloutPercent === 'number') {
      updates.rolloutPercent = Math.min(100, Math.max(0, body.rolloutPercent));
    }
    if (Array.isArray(body.enabledTiers)) {
      updates.enabledTiers = (body.enabledTiers as string[]).filter((t) =>
        VALID_TIERS.includes(t as SubscriptionTier),
      ) as SubscriptionTier[];
    }

    const updated = updateFeatureFlag(flagName, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in features PATCH:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/features?name=<flagName> — Delete feature flag (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const flagName = searchParams.get('name');
    if (!flagName) {
      return NextResponse.json({ error: 'Flag name is required' }, { status: 400 });
    }

    const deleted = deleteFeatureFlag(flagName);
    if (!deleted) {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in features DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
