// ─────────────────────────────────────────────────────────────────────────────
// Central Gemini API service. Every agent calls generateContent() from here
// rather than instantiating their own GoogleGenerativeAI clients.
//
// WHY a central service:
//  - Rate limit tracking needs to be shared across all concurrent agents
//  - Model rotation must be deterministic (not each agent independently retrying)
//  - All token usage needs to be aggregated for the admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

import { requireGeminiApiKey } from './aiProvider';
import { APP_CONFIG } from './config';
import { logger } from './logger';

// ── FREE-TIER MODEL POOL ──────────────────────────────────────────────────────
// Models are tried in order. On rate limit (HTTP 429), rotate to the next.
// Updated June 2026 — only models confirmed available in the free tier.
const DEFAULT_MODEL_POOL: string[] = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-pro',
];

// If the user configured a primary model, put it first in the pool
function buildModelPool(): string[] {
  const primary = APP_CONFIG.geminiPrimaryModel;
  if (!primary || DEFAULT_MODEL_POOL.includes(primary)) return DEFAULT_MODEL_POOL;
  return [primary, ...DEFAULT_MODEL_POOL];
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── PER-MODEL RATE LIMIT TRACKING ────────────────────────────────────────────
interface ModelUsage {
  requestsThisMinute: number;
  requestsToday: number;
  tokensToday: number;
  lastMinuteReset: number;
  lastDayReset: string;
  errors: number;
}

// RPM limits per model (conservative — 80% of actual free-tier limit)
const MODEL_RPM_LIMITS: Record<string, number> = {
  'gemini-2.5-flash': 12,
  'gemini-2.0-flash': 12,
  'gemini-2.0-flash-lite': 24,
  'gemini-2.5-pro': 4,
};

const MODEL_RPD_LIMIT = 1200;

// ── IN-MEMORY USAGE STATE ────────────────────────────────────────────────────
const USAGE_KEY = '__geminiServiceUsage__';

function getAllUsage(): Record<string, ModelUsage> {
  const pool = buildModelPool();
  const g = globalThis as unknown as Record<string, Record<string, ModelUsage>>;
  if (!g[USAGE_KEY]) {
    g[USAGE_KEY] = {};
    for (const model of pool) {
      g[USAGE_KEY][model] = {
        requestsThisMinute: 0,
        requestsToday: 0,
        tokensToday: 0,
        lastMinuteReset: Date.now(),
        lastDayReset: new Date().toISOString().split('T')[0],
        errors: 0,
      };
    }
  }

  // Reset daily counters on day rollover
  const today = new Date().toISOString().split('T')[0];
  for (const model of pool) {
    if (!g[USAGE_KEY][model]) continue;
    if (g[USAGE_KEY][model].lastDayReset !== today) {
      g[USAGE_KEY][model].requestsToday = 0;
      g[USAGE_KEY][model].tokensToday = 0;
      g[USAGE_KEY][model].errors = 0;
      g[USAGE_KEY][model].lastDayReset = today;
    }
    // Reset per-minute counter
    if (Date.now() - g[USAGE_KEY][model].lastMinuteReset > 60_000) {
      g[USAGE_KEY][model].requestsThisMinute = 0;
      g[USAGE_KEY][model].lastMinuteReset = Date.now();
    }
  }

  return g[USAGE_KEY];
}

// ── RESPONSE CACHE ────────────────────────────────────────────────────────────
const CACHE_KEY = '__geminiResponseCache__';
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCache(): Map<string, { response: string; cachedAt: number }> {
  const g = globalThis as unknown as Record<string, Map<string, { response: string; cachedAt: number }>>;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = new Map();
  }
  return g[CACHE_KEY];
}

function hashPrompt(model: string, system: string, user: string): string {
  // Simple hash for cache key — not cryptographic, just dedup
  const raw = `${model}::${system}::${user}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `${model}-${Math.abs(hash).toString(36)}`;
}

// ── EXPORTED TYPES ────────────────────────────────────────────────────────────

export interface GeminiRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  expectJson?: boolean;
  agentName?: string;
}

export interface GeminiResponse {
  text: string;
  modelUsed: string;
  tokensUsed: number;
  latencyMs: number;
  fromCache: boolean;
  retryCount: number;
}

// ── SLEEP HELPER ──────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── MAIN FUNCTION ─────────────────────────────────────────────────────────────

/**
 * generateContent — send a prompt to Gemini and return the response.
 *
 * Handles model rotation, rate limiting, caching, and retries automatically.
 * Agents should NEVER call the Gemini API directly — always use this.
 *
 * @param request - The prompt and configuration for generation
 * @returns GeminiResponse with text, metadata, and diagnostics
 * @throws {Error} If all models fail after exhausting retries
 */
export async function generateContent(request: GeminiRequest): Promise<GeminiResponse> {
  const apiKey = requireGeminiApiKey();
  const usage = getAllUsage();
  const cache = getCache();
  const agentName = request.agentName || 'UnknownAgent';
  const startTime = Date.now();

  const modelPool = buildModelPool();

  // Check cache first
  const cacheKey = hashPrompt(modelPool[0], request.systemPrompt, request.userPrompt);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    logger.debug(`[GeminiService] Cache hit for ${agentName}`);
    return {
      text: cached.response,
      modelUsed: 'cached',
      tokensUsed: 0,
      latencyMs: Date.now() - startTime,
      fromCache: true,
      retryCount: 0,
    };
  }

  const errors: string[] = [];
  let retryCount = 0;

  // Try each model in the pool
  for (const model of modelPool) {
    const modelUsage = usage[model];

    // Check RPM limit
    if (modelUsage.requestsThisMinute >= (MODEL_RPM_LIMITS[model] || 12)) {
      logger.debug(`[GeminiService] Skipping ${model} — RPM limit reached`);
      continue;
    }

    // Check RPD limit
    if (modelUsage.requestsToday >= MODEL_RPD_LIMIT) {
      logger.debug(`[GeminiService] Skipping ${model} — RPD limit reached`);
      continue;
    }

    try {
      const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;

      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: request.userPrompt }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.75,
          maxOutputTokens: request.maxOutputTokens ?? 4096,
          ...(request.expectJson ? { responseMimeType: 'application/json' } : {}),
        },
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429) {
        const errorText = await response.text().catch(() => 'Rate limited');
        retryCount++;
        logger.warn(`[GeminiService] 429 on ${model}, trying next model`, {
          agent: agentName,
          error: errorText.slice(0, 200),
        });
        modelUsage.errors++;
        errors.push(`${model}: 429 rate limited`);
        await sleep(2000 * retryCount); // Brief backoff
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        retryCount++;
        logger.warn(`[GeminiService] ${response.status} on ${model}`, {
          agent: agentName,
          error: errorText.slice(0, 200),
        });
        modelUsage.errors++;
        errors.push(`${model}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const tokensUsed = data.usageMetadata?.totalTokenCount || 0;

      if (!text) {
        errors.push(`${model}: empty response`);
        continue;
      }

      // Update usage counters
      modelUsage.requestsThisMinute++;
      modelUsage.requestsToday++;
      modelUsage.tokensToday += tokensUsed;

      // Cache the response
      cache.set(cacheKey, { response: text, cachedAt: Date.now() });

      const latencyMs = Date.now() - startTime;
      logger.info(`[GeminiService] Success via ${model}`, {
        agent: agentName,
        tokens: tokensUsed,
        latencyMs,
        retries: retryCount,
      });

      return {
        text,
        modelUsed: model,
        tokensUsed,
        latencyMs,
        fromCache: false,
        retryCount,
      };
    } catch (err) {
      retryCount++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${model}: ${msg}`);
      logger.warn(`[GeminiService] Error on ${model}: ${msg}`, { agent: agentName });
    }
  }

  // All models failed
  const errorMsg = `All Gemini models failed for ${agentName}. Errors: ${errors.join('; ')}`;
  logger.error(`[GeminiService] ${errorMsg}`);
  throw new Error(errorMsg);
}

/**
 * getModelUsageStats — returns current usage stats for all models.
 * Used by the admin dashboard to show rate limit status.
 */
export function getModelUsageStats(): Record<string, ModelUsage> {
  return getAllUsage();
}

/**
 * resetDailyUsage — resets daily counters for all models.
 * Call at midnight UTC or from admin dashboard.
 */
export function resetDailyUsage(): void {
  const usage = getAllUsage();
  const pool = buildModelPool();
  for (const model of pool) {
    if (!usage[model]) continue;
    usage[model].requestsToday = 0;
    usage[model].tokensToday = 0;
    usage[model].errors = 0;
  }
  logger.info('[GeminiService] Daily usage counters reset');
}
