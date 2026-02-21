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

// GET /api/apikeys — List user's API keys
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const keys = getApiKeysByUserId(user.id);

  // Never expose keyHash — only prefix is shown
  const safeKeys = keys.map(({ keyHash: _kh, ...k }) => k);

  return NextResponse.json({ apiKeys: safeKeys, total: safeKeys.length });
}

// POST /api/apikeys — Create new API key
export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const tier = user.tier;
  const maxKeys = TIER_LIMITS[tier].maxApiKeys;

  const activeCount = getActiveApiKeyCountForUser(user.id);
  if (activeCount >= maxKeys) {
    return NextResponse.json(
      { error: `Your ${tier} plan allows a maximum of ${maxKeys} API keys. Upgrade to create more.` },
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

    let name: string;
    let scopes: string[];

    try {
      name = validateApiKeyName(body.name);
      scopes = validateScopes(body.scopes);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
      }
      throw e;
    }

    const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : undefined;

    const { apiKey, rawKey } = createApiKey({ userId: user.id, name, scopes, expiresAt });

    const { keyHash: _kh, ...safeKey } = apiKey;

    return NextResponse.json(
      {
        apiKey: safeKey,
        rawKey,
        message: 'Store this key securely — it will not be shown again.',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error in apikeys POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/apikeys?id=<keyId> — Revoke API key
export async function DELETE(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user } = authResult;
  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get('id');

  if (!keyId) {
    return NextResponse.json({ error: 'API key ID is required' }, { status: 400 });
  }

  const revoked = revokeApiKey(keyId, user.id);
  if (!revoked) {
    return NextResponse.json({ error: 'API key not found or already revoked' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
