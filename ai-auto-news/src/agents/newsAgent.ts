import { ResearchResult, NewsContent } from '@/types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function newsAgent(research: ResearchResult): Promise<NewsContent> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return generateFallbackNews(research);
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
          maxOutputTokens: 2048,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Gemini API error: ${response.status}`);
      return generateFallbackNews(research);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseNewsResponse(content, research);
  } catch (error) {
    console.error('News agent error:', error);
    return generateFallbackNews(research);
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

function parseNewsResponse(content: string, research: ResearchResult): NewsContent {
  try {
    const parsed = JSON.parse(content);
    return validateNewsContent(parsed);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateNewsContent(parsed);
      } catch {
        // Fall through
      }
    }
    return generateFallbackNews(research);
  }
}

function validateNewsContent(data: Record<string, unknown>): NewsContent {
  const title = String(data.title || 'Breaking News');
  return {
    title,
    slug: String(data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    metaDescription: String(data.metaDescription || '').substring(0, 160),
    content: String(data.content || ''),
    summary: String(data.summary || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : ['news', 'technology'],
  };
}

function generateFallbackNews(research: ResearchResult): NewsContent {
  const title = `Breaking: ${research.headline || research.topic}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);

  const content = `
    <p><strong>${research.summary}</strong></p>

    <h2>What&apos;s Happening</h2>
    <p>In a significant development for the tech industry, new advancements in ${research.topic} are making headlines. Industry observers note that these developments could have far-reaching implications for businesses and consumers.</p>

    <h2>Key Details</h2>
    <ul>
      ${research.keyPoints.map((p) => `<li>${p}</li>`).join('\n      ')}
    </ul>

    <h2>Industry Reaction</h2>
    <p>Technology leaders and analysts are closely monitoring these developments. The consensus among experts is that ${research.topic} will continue to be a major area of focus for innovation and investment in the coming months.</p>

    <h2>What&apos;s Next</h2>
    <p>Analysts expect further announcements in the near future as companies race to capitalize on these developments. Stay tuned for updates as this story develops.</p>
  `.trim();

  return {
    title,
    slug,
    metaDescription: `Breaking: Latest developments in ${research.topic}. Key updates and industry reaction.`.substring(0, 160),
    content,
    summary: research.summary,
    tags: ['breaking-news', 'technology', research.topic.split(' ')[0]],
  };
}
