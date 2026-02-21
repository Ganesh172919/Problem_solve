import { rateLimiter } from './rateLimit';
import { logger } from './logger';
import { writeAuditLog } from '@/db/auditLog';

const log = logger.child({ module: 'AbuseDetection' });

// Thresholds
const IP_RATE_LIMIT = 200;       // max requests per IP per minute
const LOGIN_ATTEMPT_LIMIT = 5;   // max failed logins per IP per 15 min
const LOGIN_WINDOW_MS = 15 * 60_000;
const IP_WINDOW_MS = 60_000;

export interface AbuseCheckResult {
  blocked: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Check whether an IP address should be blocked due to excessive requests.
 */
export function checkIpRateLimit(ip: string): AbuseCheckResult {
  if (!ip) return { blocked: false };

  const rl = rateLimiter.check(`ip:${ip}`, IP_RATE_LIMIT, IP_WINDOW_MS);
  if (!rl.allowed) {
    log.warn('IP rate limit exceeded', { ip });
    return {
      blocked: true,
      reason: 'Too many requests from this IP address',
      retryAfterMs: rl.resetAt - Date.now(),
    };
  }

  return { blocked: false };
}

/**
 * Track a failed login attempt for an IP and username.
 * Returns true if the account/IP should be temporarily locked.
 */
export function trackFailedLogin(ip: string, identifier: string): boolean {
  const key = `login_fail:${ip}:${identifier}`;
  const rl = rateLimiter.check(key, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);

  if (!rl.allowed) {
    log.warn('Excessive login failures', { ip, identifier });

    writeAuditLog({
      actorType: 'system',
      action: 'user.login_failed',
      resourceType: 'user',
      details: { ip, identifier, reason: 'brute_force_detected' },
      ipAddress: ip,
    });

    return true; // locked
  }

  return false;
}

/**
 * Clear failed login tracking for an IP/identifier after successful auth.
 */
export function clearFailedLogins(ip: string, identifier: string): void {
  rateLimiter.reset(`login_fail:${ip}:${identifier}`);
}

/**
 * Detect anomalous API usage: if a single API key makes > 500 calls in 1 minute,
 * flag it as potentially abusive.
 */
export function checkApiKeyAbuse(
  apiKeyId: string,
  callsInLastMinute: number,
): AbuseCheckResult {
  const ABUSE_THRESHOLD = 500;

  if (callsInLastMinute > ABUSE_THRESHOLD) {
    log.warn('Potential API key abuse', { apiKeyId, callsInLastMinute });

    writeAuditLog({
      actorType: 'system',
      action: 'api_key.abuse_detected',
      resourceType: 'api_key',
      resourceId: apiKeyId,
      details: { callsInLastMinute, threshold: ABUSE_THRESHOLD },
    });

    return {
      blocked: true,
      reason: 'Unusual API usage pattern detected. Key has been temporarily throttled.',
    };
  }

  return { blocked: false };
}

/**
 * Extract the real client IP from a request, handling common proxy headers.
 */
export function extractClientIp(
  forwardedFor: string | null,
  realIp: string | null,
  remoteAddr?: string,
): string {
  // X-Forwarded-For can be a comma-separated list; first entry is the client
  if (forwardedFor) {
    const parts = forwardedFor.split(',');
    const first = parts[0].trim();
    if (isValidIp(first)) return first;
  }

  if (realIp && isValidIp(realIp)) return realIp;

  return remoteAddr || 'unknown';
}

function isValidIp(ip: string): boolean {
  // Simple IPv4/IPv6 check
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

/**
 * Validate that a user-supplied redirect URL stays on the same origin.
 * Prevents open redirect vulnerabilities.
 */
export function isSafeRedirectUrl(url: string, allowedOrigin: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    const origin = new URL(allowedOrigin);
    return parsed.origin === origin.origin;
  } catch {
    return false;
  }
}
