import { NextRequest, NextResponse } from 'next/server';
import {
  createApiKey,
  getApiKeysByUserId,
  revokeApiKey,
  getActiveApiKeyCountForUser,
} from '@/db/apiKeys';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { validateApiKeyName, validateScopes, ValidationError } from '@/lib/validation';
import { TIER_LIMITS } from '@/lib/config';
import { logger } from '@/lib/logger';

// GET /api/v1/apikeys — List user's API keys
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;
    const keys = getApiKeysByUserId(user.id);

    // Never expose keyHash — only prefix is shown
    const safeKeys = keys.map(({ keyHash: _kh, ...k }) => k);

    return NextResponse.json({ success: true, data: safeKeys, total: safeKeys.length });
  } catch (error) {
    logger.error('v1/apikeys GET error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/v1/apikeys — Create new API key
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;
    const tier = user.tier;
    const maxKeys = TIER_LIMITS[tier].maxApiKeys;

    const activeCount = getActiveApiKeyCountForUser(user.id);
    if (activeCount >= maxKeys) {
      return NextResponse.json(
        { success: false, error: `Your ${tier} plan allows a maximum of ${maxKeys} API keys.` },
        { status: 403 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    let name: string;
    let scopes: string[];

    try {
      name = validateApiKeyName(body.name);
      scopes = validateScopes(body.scopes);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ success: false, error: e.message, field: e.field }, { status: 400 });
      }
      throw e;
    }

    const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : undefined;
    const { apiKey, rawKey } = createApiKey({ userId: user.id, name, scopes, expiresAt });
    const { keyHash: _kh, ...safeKey } = apiKey;

    return NextResponse.json(
      {
        success: true,
        data: safeKey,
        rawKey,
        message: 'Store this key securely — it will not be shown again.',
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('v1/apikeys POST error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/v1/apikeys?id=<keyId> — Revoke API key
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateApiKey(request);
    if (!authResult.valid) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    const { user } = authResult;
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('id');

    if (!keyId) {
      return NextResponse.json({ success: false, error: 'API key ID is required' }, { status: 400 });
    }

    const revoked = revokeApiKey(keyId, user.id);
    if (!revoked) {
      return NextResponse.json({ success: false, error: 'API key not found or already revoked' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('v1/apikeys DELETE error', error instanceof Error ? error : undefined);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
