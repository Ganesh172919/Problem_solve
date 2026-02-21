import { NextRequest } from 'next/server';
import { getApiKeyByHash } from '@/db/apiKeys';
import { getUserById, updateUserLastActive } from '@/db/users';
import { incrementApiKeyUsage } from '@/db/apiKeys';
import { ApiKey } from '@/types/saas';
import { User } from '@/types/saas';

type ApiKeyAuthFailure = {
  valid: false;
  error: string;
};

type ApiKeyAuthSuccess = {
  valid: true;
  apiKey: ApiKey;
  user: User;
};

export type ApiKeyAuthResult = ApiKeyAuthFailure | ApiKeyAuthSuccess;;

export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function authenticateApiKey(request: NextRequest): Promise<ApiKeyAuthResult> {
  const rawKey = extractBearerToken(request);
  if (!rawKey) {
    return { valid: false, error: 'Missing Authorization header. Use: Bearer <api_key>' };
  }

  if (!rawKey.startsWith('aian_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const apiKey = getApiKeyByHash(rawKey);
  if (!apiKey) {
    return { valid: false, error: 'Invalid or revoked API key' };
  }

  const user = getUserById(apiKey.userId);
  if (!user) {
    return { valid: false, error: 'API key owner not found' };
  }

  if (!user.isActive) {
    return { valid: false, error: 'Account is deactivated' };
  }

  // Track usage asynchronously - don't await so it doesn't slow down the request
  void Promise.resolve().then(() => {
    incrementApiKeyUsage(apiKey.id);
    updateUserLastActive(user.id);
  });

  return { valid: true, apiKey, user };
}

export function hasScope(apiKey: ApiKey, requiredScope: string): boolean {
  return apiKey.scopes.includes(requiredScope) || apiKey.scopes.includes('admin');
}
