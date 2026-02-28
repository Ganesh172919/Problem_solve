export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new ValidationError('email', 'Email is required');
  }
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/;
  if (!emailRegex.test(trimmed)) {
    throw new ValidationError('email', 'Invalid email format');
  }
  if (trimmed.length > 320) {
    throw new ValidationError('email', 'Email is too long');
  }
  return trimmed;
}

export function validateUsername(username: unknown): string {
  if (typeof username !== 'string' || username.trim().length === 0) {
    throw new ValidationError('username', 'Username is required');
  }
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 32) {
    throw new ValidationError('username', 'Username must be between 3 and 32 characters');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new ValidationError('username', 'Username may only contain letters, numbers, underscores and hyphens');
  }
  return trimmed;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new ValidationError('password', 'Password is required');
  }
  if (password.length < 8) {
    throw new ValidationError('password', 'Password must be at least 8 characters');
  }
  if (password.length > 128) {
    throw new ValidationError('password', 'Password is too long');
  }
  return password;
}

export function validateUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new ValidationError('url', 'URL is required');
  }
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('url', 'URL must use http or https');
    }
    return parsed.toString();
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError('url', 'Invalid URL');
  }
}

export function validateApiKeyName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name', 'API key name is required');
  }
  const trimmed = name.trim();
  if (trimmed.length > 64) {
    throw new ValidationError('name', 'API key name must be 64 characters or fewer');
  }
  return trimmed;
}

export function validatePagination(page: unknown, limit: unknown): { page: number; limit: number } {
  const p = parseInt(String(page ?? '1'), 10);
  const l = parseInt(String(limit ?? '10'), 10);

  if (isNaN(p) || p < 1) {
    throw new ValidationError('page', 'Page must be a positive integer');
  }
  if (isNaN(l) || l < 1 || l > 100) {
    throw new ValidationError('limit', 'Limit must be between 1 and 100');
  }

  return { page: p, limit: l };
}

export function validateWebhookEvents(events: unknown): string[] {
  const VALID_EVENTS = [
    'post.created',
    'post.deleted',
    'user.registered',
    'user.tier_changed',
    'generation.completed',
    'generation.failed',
  ];

  if (!Array.isArray(events) || events.length === 0) {
    throw new ValidationError('events', 'At least one webhook event is required');
  }
  for (const e of events) {
    if (typeof e !== 'string' || !VALID_EVENTS.includes(e)) {
      throw new ValidationError('events', `Invalid event: ${e}. Valid events: ${VALID_EVENTS.join(', ')}`);
    }
  }
  return events as string[];
}

export function validateScopes(scopes: unknown): string[] {
  const VALID_SCOPES = ['read', 'write', 'generate', 'admin'];
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return ['read'];
  }
  for (const s of scopes) {
    if (typeof s !== 'string' || !VALID_SCOPES.includes(s)) {
      throw new ValidationError('scopes', `Invalid scope: ${s}. Valid scopes: ${VALID_SCOPES.join(', ')}`);
    }
  }
  return scopes as string[];
}

export function sanitizeString(value: unknown, maxLength = 1000): string {
  if (typeof value !== 'string') return '';
  return value.trim().substring(0, maxLength);
}

export function validateApiKey(key: unknown): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return /^aian_[a-zA-Z0-9]{64}$/.test(key);
}

export function validateTier(tier: unknown): boolean {
  return tier === 'free' || tier === 'pro' || tier === 'enterprise';
}
