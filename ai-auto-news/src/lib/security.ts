import type { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Apply production security headers to a NextResponse.
 * Call this on all API responses and page responses.
 */
export function applySecurityHeaders(
  response: NextResponse,
  options: { noIndex?: boolean } = {},
): NextResponse {
  const h = response.headers;

  // Prevent MIME-type sniffing
  h.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  h.set('X-Frame-Options', 'DENY');

  // Enforce HTTPS (1 year, include subdomains)
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Restrict referrer info
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy — disable unused browser APIs
  h.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );

  // Basic Content-Security-Policy for API responses
  h.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );

  if (options.noIndex) {
    h.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return response;
}

/**
 * Generate a cryptographically secure nonce for use in CSP headers.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Build a Content-Security-Policy header value for rendered HTML pages.
 */
export function buildPageCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');
}

/**
 * Mask sensitive fields (e.g. passwords, tokens) in log output.
 */
export function maskSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = new Set([
    'password', 'passwordhash', 'token', 'secret', 'apikey',
    'keyhash', 'authorization', 'cookie', 'jwt',
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = maskSensitiveFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Generate a random alphanumeric token (e.g. for password reset, email verification).
 */
export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(aBuf, bBuf);
}
