// ── AI Provider ─────────────────────────────────────────────────────────────
// Validates that a real Gemini API key is present. No mock fallback —
// the platform requires a live Gemini API key to function.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getGeminiApiKey — returns the trimmed Gemini API key from environment.
 *
 * @returns The API key string, or null if not set / set to placeholder
 * @throws Never throws — returns null so callers can handle gracefully
 */
export function getGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (apiKey === 'your_gemini_api_key_here' || apiKey === '') return null;
  return apiKey;
}

/**
 * requireGeminiApiKey — returns the key or throws a descriptive error.
 * Use this at startup / first API call to fail loudly if key is missing.
 *
 * @returns The validated API key string
 * @throws {Error} If GEMINI_API_KEY is not set or is a placeholder
 */
export function requireGeminiApiKey(): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      '❌ GEMINI_API_KEY is not set in .env.local. ' +
      'The platform requires a real Gemini API key. ' +
      'Get one free at https://aistudio.google.com/app/apikey'
    );
  }
  return key;
}
