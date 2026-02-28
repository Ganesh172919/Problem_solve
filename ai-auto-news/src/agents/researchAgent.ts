import { ResearchResult } from '@/types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const TOPICS = [
  'latest breakthroughs in artificial intelligence',
  'new developments in machine learning research',
  'trending technology startups and innovations',
  'latest advances in large language models',
  'new developments in robotics and automation',
  'cybersecurity threats and solutions trending today',
  'latest developments in quantum computing',
  'new breakthroughs in computer vision and image AI',
  'trending topics in cloud computing and DevOps',
  'latest news in blockchain and Web3 technology',
  'advances in natural language processing',
  'new developments in autonomous vehicles',
  'trending topics in edge computing and IoT',
  'latest updates in AI regulation and ethics',
  'new developments in generative AI applications',
];

function getRandomTopic(recentTopics: string[]): string {
  const recentLower = recentTopics.map((t) => t.toLowerCase());
  const available = TOPICS.filter(
    (t) => !recentLower.some((r) => r.includes(t.substring(0, 20).toLowerCase()))
  );
  const pool = available.length > 0 ? available : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function researchAgent(recentTopics: string[] = []): Promise<ResearchResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured. Please set a valid Gemini API key in .env.local');
  }

  const topic = getRandomTopic(recentTopics);

  try {
    const prompt = `You are a research assistant. Research the latest news and developments about: "${topic}".

Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks):
{
  "topic": "the main topic",
  "headline": "a compelling headline about the latest development",
  "summary": "2-3 sentence summary of the most recent developments",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4"],
  "references": ["source or reference 1", "source or reference 2"]
}

Make sure the content is factual, current, and insightful. Return ONLY the JSON object.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Gemini API error: ${response.status} — ${errorText}`);
    }

    const data = await response.json();

    // Check if response was truncated due to token limit
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.warn('[ResearchAgent] Response was truncated (MAX_TOKENS). Attempting to repair JSON...');
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseResearchResponse(content, topic);
  } catch (error) {
    console.error('Research agent error:', error);
    throw error instanceof Error
      ? error
      : new Error('Research agent failed with an unknown error');
  }
}

function stripMarkdownFences(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` wrappers
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

/**
 * Attempts to repair truncated JSON by closing open strings, arrays, and objects.
 * This handles cases where the Gemini API response was cut off mid-JSON due to token limits.
 */
function repairTruncatedJson(text: string): string {
  let repaired = text.trim();

  // Remove trailing comma
  repaired = repaired.replace(/,\s*$/, '');

  // If the JSON ends with a truncated string value, close the string
  // e.g., "headline": "Some text that got cut off
  if ((repaired.match(/"/g) || []).length % 2 !== 0) {
    repaired += '"';
  }

  // Count open brackets/braces and close them
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let prevChar = '';

  for (const char of repaired) {
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }
    prevChar = char;
  }

  // Remove any trailing partial key-value pair (e.g., ending with a colon or key)
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*"?$/, '');
  // Re-check quote balance after this trim
  if ((repaired.match(/"/g) || []).length % 2 !== 0) {
    repaired += '"';
  }

  // Close open brackets and braces
  for (let i = 0; i < openBrackets; i++) repaired += ']';
  for (let i = 0; i < openBraces; i++) repaired += '}';

  return repaired;
}

function parseResearchResponse(content: string, fallbackTopic: string): ResearchResult {
  const cleaned = stripMarkdownFences(content);

  // 1. Try parsing directly
  try {
    const parsed = JSON.parse(cleaned);
    return validateResearchResult(parsed);
  } catch {
    // continue to fallbacks
  }

  // 2. Try to extract a complete JSON object from the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateResearchResult(parsed);
    } catch {
      // continue to repair
    }
  }

  // 3. Try to repair truncated JSON
  try {
    const repaired = repairTruncatedJson(cleaned);
    const parsed = JSON.parse(repaired);
    console.warn('[ResearchAgent] Successfully repaired truncated JSON response');
    return validateResearchResult(parsed);
  } catch {
    // continue to final fallback
  }

  // 4. If all else fails, try to extract what we can with regex
  const topicMatch = cleaned.match(/"topic"\s*:\s*"([^"]+)"/);
  const headlineMatch = cleaned.match(/"headline"\s*:\s*"([^"]+)"/);
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]+)"/);

  if (topicMatch || headlineMatch) {
    console.warn('[ResearchAgent] Extracted partial data from malformed JSON response');
    return {
      topic: topicMatch?.[1] || fallbackTopic,
      headline: headlineMatch?.[1] || `Latest developments in ${fallbackTopic}`,
      summary: summaryMatch?.[1] || '',
      keyPoints: [],
      references: [],
    };
  }

  console.error('Raw Gemini research response:', content.substring(0, 500));
  throw new Error(`Failed to parse Gemini research response for topic: ${fallbackTopic}`);
}

function validateResearchResult(data: Record<string, unknown>): ResearchResult {
  if (!data.topic && !data.headline) {
    throw new Error('Gemini returned an empty research result');
  }
  return {
    topic: String(data.topic || ''),
    headline: String(data.headline || ''),
    summary: String(data.summary || ''),
    keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints.map(String) : [],
    references: Array.isArray(data.references) ? data.references.map(String) : [],
  };
}
