import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthMethod = 'api_key' | 'oauth2' | 'jwt';

type TokenRefreshStrategy = 'eager' | 'lazy' | 'sliding';

type AuthResult = { granted: true; identity: AuthIdentity } | { granted: false; reason: string };

interface AuthIdentity {
  id: string;
  method: AuthMethod;
  scopes: string[];
  metadata: Record<string, unknown>;
  authenticatedAt: number;
}

interface ApiKeyRecord {
  key: string;
  clientId: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number;
  usageCount: number;
}

interface OAuthToken {
  accessToken: string;
  refreshToken: string | null;
  clientId: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  refreshedAt: number | null;
}

interface JWTRecord {
  token: string;
  clientId: string;
  claims: Record<string, unknown>;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
}

interface TokenIntrospection {
  active: boolean;
  clientId: string | null;
  method: AuthMethod | null;
  scopes: string[];
  expiresAt: number | null;
  issuedAt: number | null;
  remainingTtlMs: number | null;
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
}

interface AuthTelemetry {
  totalAuthentications: number;
  successfulAuths: number;
  failedAuths: number;
  authsByMethod: Record<AuthMethod, number>;
  averageAuthLatencyMs: number;
  tokenRefreshes: number;
  tokenRefreshFailures: number;
}

interface EndpointAuthRule {
  pattern: string;
  requiredScopes: string[];
  allowedMethods: AuthMethod[];
  rateLimit: RateLimitInfo | null;
}

interface SDKAuthConfig {
  tokenTtlMs: number;
  refreshBufferMs: number;
  refreshStrategy: TokenRefreshStrategy;
  maxTokensPerClient: number;
  cleanupIntervalMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SDKAuthConfig = {
  tokenTtlMs: 3600000, // 1 hour
  refreshBufferMs: 300000, // 5 minutes before expiry
  refreshStrategy: 'lazy',
  maxTokensPerClient: 10,
  cleanupIntervalMs: 60000,
};

function generateToken(): string {
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(Math.random().toString(36).substring(2, 10));
  }
  return parts.join('');
}

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function matchPattern(pattern: string, path: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$');
  return regex.test(path);
}

// ─── SDKAuthProvider ──────────────────────────────────────────────────────────

export class SDKAuthProvider {
  private apiKeys: Map<string, ApiKeyRecord> = new Map();
  private oauthTokens: Map<string, OAuthToken> = new Map();
  private jwtRecords: Map<string, JWTRecord> = new Map();
  private endpointRules: EndpointAuthRule[] = [];
  private rateLimitCounters: Map<string, RateLimitInfo> = new Map();
  private config: SDKAuthConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private telemetry: AuthTelemetry = {
    totalAuthentications: 0,
    successfulAuths: 0,
    failedAuths: 0,
    authsByMethod: { api_key: 0, oauth2: 0, jwt: 0 },
    averageAuthLatencyMs: 0,
    tokenRefreshes: 0,
    tokenRefreshFailures: 0,
  };
  private authLatencySum = 0;

  constructor(config?: Partial<SDKAuthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('SDKAuthProvider initialized', {
      refreshStrategy: this.config.refreshStrategy,
      tokenTtlMs: this.config.tokenTtlMs,
    });
  }

  // ── API Key Management ────────────────────────────────────────────────────

  /**
   * Issue a new API key for a client.
   */
  issueApiKey(
    clientId: string,
    scopes: string[],
    options?: { expiresInMs?: number; metadata?: Record<string, unknown> },
  ): string {
    if (!clientId) throw new Error('SDKAuthProvider: clientId is required');

    const existingCount = Array.from(this.apiKeys.values())
      .filter((k) => k.clientId === clientId && k.active).length;
    if (existingCount >= this.config.maxTokensPerClient) {
      throw new Error(`SDKAuthProvider: client "${clientId}" has reached max API keys (${this.config.maxTokensPerClient})`);
    }

    const key = `sk_${generateToken()}`;
    const now = Date.now();

    const record: ApiKeyRecord = {
      key,
      clientId,
      scopes: [...scopes],
      metadata: options?.metadata ?? {},
      active: true,
      createdAt: now,
      expiresAt: options?.expiresInMs ? now + options.expiresInMs : null,
      lastUsedAt: now,
      usageCount: 0,
    };

    this.apiKeys.set(key, record);
    logger.info('SDKAuthProvider: API key issued', { clientId, scopes });
    return key;
  }

  /**
   * Revoke an API key.
   */
  revokeApiKey(key: string): boolean {
    const record = this.apiKeys.get(key);
    if (!record) return false;

    record.active = false;
    logger.info('SDKAuthProvider: API key revoked', { clientId: record.clientId });
    return true;
  }

  // ── OAuth2 Token Management ───────────────────────────────────────────────

  /**
   * Issue an OAuth2 access token.
   */
  issueOAuthToken(
    clientId: string,
    scopes: string[],
    refreshToken?: string,
  ): OAuthToken {
    if (!clientId) throw new Error('SDKAuthProvider: clientId is required');

    const now = Date.now();
    const accessToken = `oat_${generateToken()}`;
    const refresh = refreshToken ?? `ort_${generateToken()}`;

    const token: OAuthToken = {
      accessToken,
      refreshToken: refresh,
      clientId,
      scopes: [...scopes],
      issuedAt: now,
      expiresAt: now + this.config.tokenTtlMs,
      refreshedAt: null,
    };

    this.oauthTokens.set(accessToken, token);
    logger.info('SDKAuthProvider: OAuth token issued', { clientId, scopes });
    return { ...token };
  }

  /**
   * Refresh an OAuth2 token using the refresh token.
   */
  refreshOAuthToken(refreshTokenValue: string): OAuthToken | null {
    let existing: OAuthToken | null = null;

    for (const token of this.oauthTokens.values()) {
      if (token.refreshToken === refreshTokenValue) {
        existing = token;
        break;
      }
    }

    if (!existing) {
      this.telemetry.tokenRefreshFailures++;
      logger.warn('SDKAuthProvider: refresh token not found');
      return null;
    }

    // Remove old token
    this.oauthTokens.delete(existing.accessToken);

    // Issue new token with same scopes
    const newToken = this.issueOAuthToken(existing.clientId, existing.scopes);
    newToken.refreshedAt = Date.now();
    this.oauthTokens.set(newToken.accessToken, newToken);

    this.telemetry.tokenRefreshes++;
    logger.info('SDKAuthProvider: OAuth token refreshed', { clientId: existing.clientId });
    return { ...newToken };
  }

  // ── JWT Management ────────────────────────────────────────────────────────

  /**
   * Register a JWT token for validation.
   */
  registerJWT(
    clientId: string,
    claims: Record<string, unknown>,
    scopes: string[],
    options?: { ttlMs?: number },
  ): string {
    if (!clientId) throw new Error('SDKAuthProvider: clientId is required');

    const now = Date.now();
    const token = `jwt_${generateToken()}`;
    const ttl = options?.ttlMs ?? this.config.tokenTtlMs;

    const record: JWTRecord = {
      token,
      clientId,
      claims: { ...claims },
      scopes: [...scopes],
      issuedAt: now,
      expiresAt: now + ttl,
    };

    this.jwtRecords.set(token, record);
    logger.info('SDKAuthProvider: JWT registered', { clientId, scopes });
    return token;
  }

  // ── Authentication ────────────────────────────────────────────────────────

  /**
   * Authenticate a request using the provided credential.
   */
  authenticate(credential: string, requiredScopes?: string[]): AuthResult {
    const start = Date.now();
    this.telemetry.totalAuthentications++;

    let result: AuthResult;

    if (credential.startsWith('sk_')) {
      result = this.authenticateApiKey(credential, requiredScopes);
      this.telemetry.authsByMethod.api_key++;
    } else if (credential.startsWith('oat_')) {
      result = this.authenticateOAuth(credential, requiredScopes);
      this.telemetry.authsByMethod.oauth2++;
    } else if (credential.startsWith('jwt_')) {
      result = this.authenticateJWT(credential, requiredScopes);
      this.telemetry.authsByMethod.jwt++;
    } else {
      result = { granted: false, reason: 'Unrecognized credential format' };
    }

    const latency = Date.now() - start;
    this.authLatencySum += latency;
    this.telemetry.averageAuthLatencyMs = Math.round(
      this.authLatencySum / this.telemetry.totalAuthentications,
    );

    if (result.granted) {
      this.telemetry.successfulAuths++;
    } else {
      this.telemetry.failedAuths++;
      logger.debug('SDKAuthProvider: authentication failed', { reason: result.reason });
    }

    return result;
  }

  /**
   * Create auth middleware function for a specific endpoint pattern.
   */
  createMiddleware(
    endpointPattern: string,
    options?: { requiredScopes?: string[]; allowedMethods?: AuthMethod[]; rateLimit?: RateLimitInfo },
  ): (credential: string) => AuthResult & { rateLimit?: RateLimitInfo } {
    const rule: EndpointAuthRule = {
      pattern: endpointPattern,
      requiredScopes: options?.requiredScopes ?? [],
      allowedMethods: options?.allowedMethods ?? ['api_key', 'oauth2', 'jwt'],
      rateLimit: options?.rateLimit ?? null,
    };

    this.endpointRules.push(rule);

    return (credential: string) => {
      const authResult = this.authenticate(credential, rule.requiredScopes);

      if (authResult.granted) {
        if (!rule.allowedMethods.includes(authResult.identity.method)) {
          return { granted: false, reason: `Auth method "${authResult.identity.method}" not allowed for this endpoint` };
        }

        if (rule.rateLimit) {
          const key = `${authResult.identity.id}:${endpointPattern}`;
          const rl = this.checkRateLimit(key, rule.rateLimit);
          if (rl.remaining <= 0) {
            return { granted: false, reason: 'Rate limit exceeded', rateLimit: rl };
          }
          return { ...authResult, rateLimit: rl };
        }
      }

      return authResult;
    };
  }

  /**
   * Introspect a token to get its current state.
   */
  introspect(credential: string): TokenIntrospection {
    const now = Date.now();

    if (credential.startsWith('sk_')) {
      const record = this.apiKeys.get(credential);
      if (!record || !record.active) {
        return { active: false, clientId: null, method: null, scopes: [], expiresAt: null, issuedAt: null, remainingTtlMs: null };
      }
      const expired = record.expiresAt !== null && record.expiresAt <= now;
      return {
        active: !expired,
        clientId: record.clientId,
        method: 'api_key',
        scopes: [...record.scopes],
        expiresAt: record.expiresAt,
        issuedAt: record.createdAt,
        remainingTtlMs: record.expiresAt ? Math.max(0, record.expiresAt - now) : null,
      };
    }

    if (credential.startsWith('oat_')) {
      const token = this.oauthTokens.get(credential);
      if (!token) {
        return { active: false, clientId: null, method: null, scopes: [], expiresAt: null, issuedAt: null, remainingTtlMs: null };
      }
      return {
        active: token.expiresAt > now,
        clientId: token.clientId,
        method: 'oauth2',
        scopes: [...token.scopes],
        expiresAt: token.expiresAt,
        issuedAt: token.issuedAt,
        remainingTtlMs: Math.max(0, token.expiresAt - now),
      };
    }

    if (credential.startsWith('jwt_')) {
      const record = this.jwtRecords.get(credential);
      if (!record) {
        return { active: false, clientId: null, method: null, scopes: [], expiresAt: null, issuedAt: null, remainingTtlMs: null };
      }
      return {
        active: record.expiresAt > now,
        clientId: record.clientId,
        method: 'jwt',
        scopes: [...record.scopes],
        expiresAt: record.expiresAt,
        issuedAt: record.issuedAt,
        remainingTtlMs: Math.max(0, record.expiresAt - now),
      };
    }

    return { active: false, clientId: null, method: null, scopes: [], expiresAt: null, issuedAt: null, remainingTtlMs: null };
  }

  /**
   * Check if a token needs refreshing based on configured strategy.
   */
  needsRefresh(credential: string): boolean {
    const info = this.introspect(credential);
    if (!info.active || info.remainingTtlMs === null) return false;

    switch (this.config.refreshStrategy) {
      case 'eager':
        return info.remainingTtlMs < this.config.refreshBufferMs * 2;
      case 'lazy':
        return info.remainingTtlMs < this.config.refreshBufferMs;
      case 'sliding':
        return info.remainingTtlMs < this.config.tokenTtlMs * 0.5;
      default:
        return false;
    }
  }

  getTelemetry(): AuthTelemetry {
    return { ...this.telemetry, authsByMethod: { ...this.telemetry.authsByMethod } };
  }

  getEndpointRules(): EndpointAuthRule[] {
    return this.endpointRules.map((r) => ({ ...r, requiredScopes: [...r.requiredScopes] }));
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.apiKeys.clear();
    this.oauthTokens.clear();
    this.jwtRecords.clear();
    this.rateLimitCounters.clear();
    this.endpointRules.length = 0;
    logger.info('SDKAuthProvider destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private authenticateApiKey(key: string, requiredScopes?: string[]): AuthResult {
    const record = this.apiKeys.get(key);
    if (!record) return { granted: false, reason: 'API key not found' };
    if (!record.active) return { granted: false, reason: 'API key has been revoked' };

    if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
      record.active = false;
      return { granted: false, reason: 'API key has expired' };
    }

    if (requiredScopes && !this.hasRequiredScopes(record.scopes, requiredScopes)) {
      return { granted: false, reason: `Insufficient scopes. Required: ${requiredScopes.join(', ')}` };
    }

    record.lastUsedAt = Date.now();
    record.usageCount++;

    return {
      granted: true,
      identity: {
        id: record.clientId,
        method: 'api_key',
        scopes: [...record.scopes],
        metadata: { ...record.metadata },
        authenticatedAt: Date.now(),
      },
    };
  }

  private authenticateOAuth(accessToken: string, requiredScopes?: string[]): AuthResult {
    const token = this.oauthTokens.get(accessToken);
    if (!token) return { granted: false, reason: 'OAuth token not found' };

    if (token.expiresAt <= Date.now()) {
      this.oauthTokens.delete(accessToken);
      return { granted: false, reason: 'OAuth token has expired' };
    }

    if (requiredScopes && !this.hasRequiredScopes(token.scopes, requiredScopes)) {
      return { granted: false, reason: `Insufficient scopes. Required: ${requiredScopes.join(', ')}` };
    }

    return {
      granted: true,
      identity: {
        id: token.clientId,
        method: 'oauth2',
        scopes: [...token.scopes],
        metadata: {},
        authenticatedAt: Date.now(),
      },
    };
  }

  private authenticateJWT(token: string, requiredScopes?: string[]): AuthResult {
    const record = this.jwtRecords.get(token);
    if (!record) return { granted: false, reason: 'JWT not found' };

    if (record.expiresAt <= Date.now()) {
      this.jwtRecords.delete(token);
      return { granted: false, reason: 'JWT has expired' };
    }

    if (requiredScopes && !this.hasRequiredScopes(record.scopes, requiredScopes)) {
      return { granted: false, reason: `Insufficient scopes. Required: ${requiredScopes.join(', ')}` };
    }

    return {
      granted: true,
      identity: {
        id: record.clientId,
        method: 'jwt',
        scopes: [...record.scopes],
        metadata: { ...record.claims },
        authenticatedAt: Date.now(),
      },
    };
  }

  private hasRequiredScopes(granted: string[], required: string[]): boolean {
    if (granted.includes('*')) return true;
    return required.every((scope) => granted.includes(scope));
  }

  private checkRateLimit(key: string, limit: RateLimitInfo): RateLimitInfo {
    const now = Date.now();
    const existing = this.rateLimitCounters.get(key);

    if (!existing || existing.resetAt <= now) {
      const counter: RateLimitInfo = {
        limit: limit.limit,
        remaining: limit.limit - 1,
        resetAt: now + 60000,
      };
      this.rateLimitCounters.set(key, counter);
      return { ...counter };
    }

    existing.remaining = Math.max(0, existing.remaining - 1);
    return { ...existing };
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, token] of this.oauthTokens) {
      if (token.expiresAt <= now) {
        this.oauthTokens.delete(key);
        removed++;
      }
    }

    for (const [key, record] of this.jwtRecords) {
      if (record.expiresAt <= now) {
        this.jwtRecords.delete(key);
        removed++;
      }
    }

    for (const [key, record] of this.apiKeys) {
      if (record.expiresAt !== null && record.expiresAt <= now) {
        this.apiKeys.delete(key);
        removed++;
      }
    }

    for (const [key, counter] of this.rateLimitCounters) {
      if (counter.resetAt <= now) {
        this.rateLimitCounters.delete(key);
      }
    }

    if (removed > 0) {
      logger.debug('SDKAuthProvider: cleanup completed', { removed });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getSDKAuthProvider(): SDKAuthProvider {
  const g = globalThis as unknown as Record<string, SDKAuthProvider>;
  if (!g.__sdkAuthProvider__) {
    g.__sdkAuthProvider__ = new SDKAuthProvider();
  }
  return g.__sdkAuthProvider__;
}
