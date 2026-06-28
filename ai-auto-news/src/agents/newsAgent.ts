// ─────────────────────────────────────────────────────────────────────────────
// News Agent — legacy agent for generating breaking news content.
// Uses the centralized GeminiService instead of direct API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { ResearchResult, NewsContent } from '@/types';
import { generateContent } from '@/lib/geminiService';
import { logger } from '@/lib/logger';

export async function newsAgent(research: ResearchResult): Promise<NewsContent> {
  const prompt = buildNewsPrompt(research);

  try {
    const response = await generateContent({
      systemPrompt: 'You are a breaking-news reporter. Return only valid JSON. No markdown, no code blocks.',
      userPrompt: prompt,
      expectJson: true,
      temperature: 0.6,
      maxOutputTokens: 4096,
      agentName: 'NewsAgent',
    });

    return parseNewsResponse(response.text, research);
  } catch (error) {
    logger.error('News agent error', error instanceof Error ? error : undefined);
    throw error instanceof Error ? error : new Error('News agent failed');
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

function parseNewsResponse(content: string, research: ResearchResult): NewsContent {
  const cleaned = stripMarkdownFences(content);

  // 1. Try parsing directly
  try {
    return validateNewsContent(JSON.parse(cleaned));
  } catch { /* continue */ }

  // 2. Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateNewsContent(JSON.parse(jsonMatch[0]));
    } catch { /* continue */ }
  }

  // 3. Extract fields via regex as last resort
  const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]+)"/);

  if (titleMatch) {
    logger.warn('[NewsAgent] Extracted partial data from malformed JSON response');
    const title = titleMatch[1];
    return {
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      metaDescription: title.slice(0, 160),
      content: `<p>${summaryMatch?.[1] || research.summary}</p>`,
      summary: summaryMatch?.[1] || research.summary,
      tags: ['news', 'technology'],
    };
  }

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
