export type AiProvider = 'gemini' | 'mock';

export function getGeminiApiKey(): string | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (apiKey === 'your_gemini_api_key_here') return null;
  return apiKey;
}

export function getAiProvider(): AiProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (configured === 'mock') return 'mock';
  if (configured === 'gemini') return getGeminiApiKey() ? 'gemini' : 'mock';

  // Default: use Gemini only when configured, otherwise stay fully-local.
  return getGeminiApiKey() ? 'gemini' : 'mock';
}

