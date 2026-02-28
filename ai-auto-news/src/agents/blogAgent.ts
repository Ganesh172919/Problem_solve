import { ResearchResult, BlogContent } from '@/types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function blogAgent(research: ResearchResult): Promise<BlogContent> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured. Please set a valid Gemini API key in .env.local');
  }

  try {
    const prompt = buildBlogPrompt(research);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
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
      console.warn('[BlogAgent] Response was truncated (MAX_TOKENS). Attempting to repair JSON...');
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseBlogResponse(content, research);
  } catch (error) {
    console.error('Blog agent error:', error);
    throw error instanceof Error
      ? error
      : new Error('Blog agent failed with an unknown error');
  }
}

function buildBlogPrompt(research: ResearchResult): string {
  return `You are a professional tech journalist writing for a technology blog.

TASK: Write a comprehensive blog post based on this research.

RESEARCH DATA:
- Topic: ${research.topic}
- Headline: ${research.headline}
- Summary: ${research.summary}
- Key Points: ${research.keyPoints.join('; ')}
- References: ${research.references.join('; ')}

REQUIREMENTS:
1. Write in professional tech journalist tone
2. SEO optimized content
3. Include: Introduction, 4-6 detailed sections with headings, Technical insights, Real-world implications, Conclusion, and 3 FAQs
4. Content should be 800-1200 words
5. Use HTML tags for formatting (<h2>, <h3>, <p>, <ul>, <li>, <strong>)
6. Do NOT use markdown formatting

OUTPUT: Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks):
{
  "title": "compelling SEO-optimized title",
  "slug": "url-friendly-slug-with-dashes",
  "metaDescription": "150-character meta description for SEO",
  "content": "full HTML-formatted blog content",
  "summary": "2-3 sentence summary",
  "tags": ["tag1", "tag2", "tag3", "tag4"]
}

Return ONLY the JSON. No other text.`;
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

function parseBlogResponse(content: string, research: ResearchResult): BlogContent {
  const cleaned = stripMarkdownFences(content);

  // 1. Try parsing directly
  try {
    const parsed = JSON.parse(cleaned);
    return validateBlogContent(parsed);
  } catch {
    // continue
  }

  // 2. Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateBlogContent(parsed);
    } catch {
      // continue
    }
  }

  // 3. Try to repair truncated JSON
  try {
    const repaired = repairTruncatedJson(cleaned);
    const parsed = JSON.parse(repaired);
    console.warn('[BlogAgent] Successfully repaired truncated JSON response');
    return validateBlogContent(parsed);
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
    console.warn('[BlogAgent] Extracted partial data from malformed JSON response');
    const title = titleMatch[1];
    return {
      title,
      slug: slugMatch?.[1] || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      metaDescription: (metaMatch?.[1] || '').substring(0, 160),
      content: contentMatch?.[1] || `<p>${summaryMatch?.[1] || research.summary}</p>`,
      summary: summaryMatch?.[1] || research.summary,
      tags: ['technology', 'AI'],
    };
  }

  console.error('Raw Gemini blog response:', content.substring(0, 500));
  throw new Error(`Failed to parse Gemini blog response for topic: ${research.topic}`);
}

function validateBlogContent(data: Record<string, unknown>): BlogContent {
  const title = String(data.title || '');
  if (!title || !data.content) {
    throw new Error('Gemini returned an empty blog post');
  }
  return {
    title,
    slug: String(data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    metaDescription: String(data.metaDescription || '').substring(0, 160),
    content: String(data.content || ''),
    summary: String(data.summary || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : ['technology', 'AI'],
  };
}
