import { ResearchResult, NewsContent } from '@/types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function newsAgent(research: ResearchResult): Promise<NewsContent> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured. Please set a valid Gemini API key in .env.local');
  }

  try {
    const prompt = buildNewsPrompt(research);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 4096,
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
      console.warn('[NewsAgent] Response was truncated (MAX_TOKENS). Attempting to repair JSON...');
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseNewsResponse(content, research);
  } catch (error) {
    console.error('News agent error:', error);
    throw error instanceof Error
      ? error
      : new Error('News agent failed with an unknown error');
  }
}

function buildNewsPrompt(research: ResearchResult): string {
  return `You are a breaking-news reporter for a technology news outlet.

TASK: Write a concise breaking-news article based on this research.

RESEARCH DATA:
- Topic: ${research.topic}
- Headline: ${research.headline}
- Summary: ${research.summary}
- Key Points: ${research.keyPoints.join('; ')}

REQUIREMENTS:
1. Breaking-news style - short and sharp
2. Clear headline
3. 3-5 short sections
4. Mention sources where applicable
5. SEO friendly
6. Use HTML tags (<h2>, <p>, <strong>, <ul>, <li>)
7. 300-500 words maximum
8. No markdown formatting

OUTPUT: Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "title": "breaking news headline",
  "slug": "url-friendly-slug",
  "metaDescription": "brief meta description under 160 chars",
  "content": "HTML-formatted news content",
  "summary": "1-2 sentence summary",
  "tags": ["tag1", "tag2", "tag3"]
}

Return ONLY the JSON.`;
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

/**
 * Attempts to repair truncated JSON by closing open strings, arrays, and objects.
 */
function repairTruncatedJson(text: string): string {
  let repaired = text.trim();

  // Remove trailing comma
  repaired = repaired.replace(/,\s*$/, '');

  // If the JSON ends with a truncated string value, close the string
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

  // Remove any trailing partial key-value pair
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*"?$/, '');
  if ((repaired.match(/"/g) || []).length % 2 !== 0) {
    repaired += '"';
  }

  for (let i = 0; i < openBrackets; i++) repaired += ']';
  for (let i = 0; i < openBraces; i++) repaired += '}';

  return repaired;
}

function parseNewsResponse(content: string, research: ResearchResult): NewsContent {
  const cleaned = stripMarkdownFences(content);

  // 1. Try parsing directly
  try {
    const parsed = JSON.parse(cleaned);
    return validateNewsContent(parsed);
  } catch {
    // continue
  }

  // 2. Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateNewsContent(parsed);
    } catch {
      // continue
    }
  }

  // 3. Try to repair truncated JSON
  try {
    const repaired = repairTruncatedJson(cleaned);
    const parsed = JSON.parse(repaired);
    console.warn('[NewsAgent] Successfully repaired truncated JSON response');
    return validateNewsContent(parsed);
  } catch {
    // continue
  }

  // 4. Extract fields via regex as last resort
  const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  const slugMatch = cleaned.match(/"slug"\s*:\s*"([^"]+)"/);
  const metaMatch = cleaned.match(/"metaDescription"\s*:\s*"([^"]+)"/);
  const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*})/);
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]+)"/);

  if (titleMatch && (contentMatch || summaryMatch)) {
    console.warn('[NewsAgent] Extracted partial data from malformed JSON response');
    const title = titleMatch[1];
    return {
      title,
      slug: slugMatch?.[1] || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      metaDescription: (metaMatch?.[1] || '').substring(0, 160),
      content: contentMatch?.[1] || `<p>${summaryMatch?.[1] || research.summary}</p>`,
      summary: summaryMatch?.[1] || research.summary,
      tags: ['news', 'technology'],
    };
  }

  console.error('Raw Gemini news response:', content.substring(0, 500));
  throw new Error(`Failed to parse Gemini news response for topic: ${research.topic}`);
}

function validateNewsContent(data: Record<string, unknown>): NewsContent {
  const title = String(data.title || '');
  if (!title || !data.content) {
    throw new Error('Gemini returned an empty news article');
  }
  return {
    title,
    slug: String(data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    metaDescription: String(data.metaDescription || '').substring(0, 160),
    content: String(data.content || ''),
    summary: String(data.summary || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : ['news', 'technology'],
  };
}
