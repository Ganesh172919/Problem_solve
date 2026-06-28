// ─────────────────────────────────────────────────────────────────────────────
// Blog Agent — legacy agent for generating blog content.
// Uses the centralized GeminiService instead of direct API calls.
// ─────────────────────────────────────────────────────────────────────────────

import { ResearchResult, BlogContent } from '@/types';
import { generateContent } from '@/lib/geminiService';
import { logger } from '@/lib/logger';

export async function blogAgent(research: ResearchResult): Promise<BlogContent> {
  const prompt = buildBlogPrompt(research);

  try {
    const response = await generateContent({
      systemPrompt: 'You are a professional tech journalist. Return only valid JSON. No markdown, no code blocks.',
      userPrompt: prompt,
      expectJson: true,
      temperature: 0.7,
      maxOutputTokens: 8192,
      agentName: 'BlogAgent',
    });

    return parseBlogResponse(response.text, research);
  } catch (error) {
    logger.error('Blog agent error', error instanceof Error ? error : undefined);
    throw error instanceof Error ? error : new Error('Blog agent failed');
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

function parseBlogResponse(content: string, research: ResearchResult): BlogContent {
  const cleaned = stripMarkdownFences(content);

  // 1. Try parsing directly
  try {
    const parsed = JSON.parse(cleaned);
    return validateBlogContent(parsed);
  } catch { /* continue */ }

  // 2. Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return validateBlogContent(JSON.parse(jsonMatch[0]));
    } catch { /* continue */ }
  }

  // 3. Extract fields via regex as last resort
  const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]+)"/);

  if (titleMatch) {
    logger.warn('[BlogAgent] Extracted partial data from malformed JSON response');
    const title = titleMatch[1];
    return {
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      metaDescription: title.slice(0, 160),
      content: `<p>${summaryMatch?.[1] || research.summary}</p>`,
      summary: summaryMatch?.[1] || research.summary,
      tags: ['technology', 'AI'],
    };
  }

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
