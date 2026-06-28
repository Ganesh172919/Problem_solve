// ─────────────────────────────────────────────────────────────────────────────
// Centralized configuration for the Autonomous AI News Platform.
//
// All environment variables are read and validated here.
// Import `APP_CONFIG` anywhere you need a config value.
// Import `validateConfig()` at startup to fail fast on missing vars.
// ─────────────────────────────────────────────────────────────────────────────

// ── HELPER: Parse boolean env vars ───────────────────────────────────────────
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

// ── HELPER: Parse integer env vars ───────────────────────────────────────────
function parseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── CONFIGURATION OBJECT ─────────────────────────────────────────────────────

export const APP_CONFIG = {
  // ── Gemini API ───────────────────────────────────────────────────────────
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
  geminiPrimaryModel: process.env.GEMINI_PRIMARY_MODEL?.trim() || 'gemini-2.5-flash',

  // ── Scheduler ────────────────────────────────────────────────────────────
  schedulerEnabled: parseBoolean(process.env.SCHEDULER_ENABLED, true),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS, 3_600_000), // 1 hour

  // ── Site Identity ────────────────────────────────────────────────────────
  siteName: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || 'TechPulse AI',
  siteTagline: process.env.NEXT_PUBLIC_SITE_TAGLINE?.trim() || 'Autonomous AI Journalism for the Tech World',
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'http://localhost:3000',

  // ── Admin Auth ───────────────────────────────────────────────────────────
  adminUsername: process.env.ADMIN_USERNAME?.trim() || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD?.trim() || 'admin123',
  jwtSecret: process.env.JWT_SECRET?.trim() || 'dev-secret-change-me',

  // ── Logging ──────────────────────────────────────────────────────────────
  logLevel: (process.env.LOG_LEVEL?.trim().toLowerCase() || 'info') as
    | 'debug' | 'info' | 'warn' | 'error',

  // ── Agent Pipeline ───────────────────────────────────────────────────────
  // Quality gate: articles scoring below this are rejected (0-100)
  qualityGateThreshold: parseInt(process.env.QUALITY_GATE_THRESHOLD, 60),

  // Max articles per generation cycle
  maxArticlesPerCycle: parseInt(process.env.MAX_ARTICLES_PER_CYCLE, 2),

  // Delay between article generations (ms) — respects Gemini RPM limits
  interArticleDelayMs: parseInt(process.env.INTER_ARTICLE_DELAY_MS, 15_000),

  // ── Pagination ───────────────────────────────────────────────────────────
  defaultPaginationLimit: 12,
  maxPaginationLimit: 100,

  // ── Legacy / Backward-compat (used by existing API routes & workers) ─────
  apiKeyPrefix: 'aian_',
  apiKeyLength: 32,
  cacheDefaultTtlSeconds: 60,
  cacheLongTtlSeconds: 300,
  taskQueueIntervalMs: parseInt(process.env.TASK_QUEUE_INTERVAL_MS || '10000', 10),
  webhookTimeoutMs: 10_000,
  webhookMaxRetries: 3,
  metricsWindowMs: 60_000,
  apiVersions: ['v1'] as const,

  // Agent timeout — used by legacy agents that still call Gemini directly
  agentTimeouts: {
    research: 30_000,
    blog: 60_000,
    news: 45_000,
  },

  // Content strategy — legacy, now controlled by template weights
  contentStrategy: 'balanced' as const,
} as const;

// ── CONFIG VALIDATION ────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * validateConfig — checks that all required environment variables are set.
 * Call this at server startup (in instrumentation.ts or the first API route).
 *
 * @returns ValidationResult with errors (must fix) and warnings (should fix)
 *
 * @example
 * const result = validateConfig();
 * if (!result.valid) {
 *   console.error('Config errors:', result.errors);
 *   process.exit(1);
 * }
 */
export function validateConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Required: Gemini API Key ─────────────────────────────────────────────
  if (!APP_CONFIG.geminiApiKey) {
    errors.push(
      'GEMINI_API_KEY is not set. The platform requires a real Gemini API key.\n' +
      'Get one free at: https://aistudio.google.com/app/apikey\n' +
      'Then add it to .env.local'
    );
  } else if (APP_CONFIG.geminiApiKey === 'your_gemini_api_key_here') {
    errors.push(
      'GEMINI_API_KEY is set to the placeholder value. Replace it with a real key.'
    );
  }

  // ── Warnings: Non-critical but recommended ───────────────────────────────
  if (APP_CONFIG.jwtSecret === 'dev-secret-change-me') {
    warnings.push(
      'JWT_SECRET is using the default dev value. Change it for any non-local deployment.'
    );
  }

  if (APP_CONFIG.adminPassword === 'admin123') {
    warnings.push(
      'ADMIN_PASSWORD is using the default value. Change it for any non-local deployment.'
    );
  }

  if (APP_CONFIG.schedulerIntervalMs < 300_000) {
    warnings.push(
      `SCHEDULER_INTERVAL_MS is ${APP_CONFIG.schedulerIntervalMs}ms (${Math.round(APP_CONFIG.schedulerIntervalMs / 1000)}s). ` +
      'This may exhaust Gemini API rate limits. Recommended: 1800000 (30 min) or higher.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * getConfigSummary — returns a safe-to-log summary of the current config.
 * Masks sensitive values (API key, JWT secret, password).
 *
 * @returns Object with all config values, sensitive ones masked
 */
export function getConfigSummary(): Record<string, unknown> {
  return {
    geminiApiKey: APP_CONFIG.geminiApiKey
      ? `${APP_CONFIG.geminiApiKey.slice(0, 6)}...${APP_CONFIG.geminiApiKey.slice(-4)}`
      : '(not set)',
    geminiPrimaryModel: APP_CONFIG.geminiPrimaryModel,
    schedulerEnabled: APP_CONFIG.schedulerEnabled,
    schedulerIntervalMs: APP_CONFIG.schedulerIntervalMs,
    schedulerIntervalHuman: `${Math.round(APP_CONFIG.schedulerIntervalMs / 60_000)} min`,
    siteName: APP_CONFIG.siteName,
    logLevel: APP_CONFIG.logLevel,
    qualityGateThreshold: APP_CONFIG.qualityGateThreshold,
    maxArticlesPerCycle: APP_CONFIG.maxArticlesPerCycle,
    adminUsername: APP_CONFIG.adminUsername,
    jwtSecret: APP_CONFIG.jwtSecret ? '****' : '(not set)',
    adminPassword: '****',
  };
}
