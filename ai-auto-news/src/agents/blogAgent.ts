import { ResearchResult, BlogContent } from '@/types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function blogAgent(research: ResearchResult): Promise<BlogContent> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return generateFallbackBlog(research);
  }

  try {
    const prompt = buildBlogPrompt(research);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Gemini API error: ${response.status}`);
      return generateFallbackBlog(research);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseBlogResponse(content, research);
  } catch (error) {
    console.error('Blog agent error:', error);
    return generateFallbackBlog(research);
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

function parseBlogResponse(content: string, research: ResearchResult): BlogContent {
  try {
    const parsed = JSON.parse(content);
    return validateBlogContent(parsed);
  } catch {
    // Try to extract JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateBlogContent(parsed);
      } catch {
        // Fall through
      }
    }
    return generateFallbackBlog(research);
  }
}

function validateBlogContent(data: Record<string, unknown>): BlogContent {
  const title = String(data.title || 'Untitled Post');
  return {
    title,
    slug: String(data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    metaDescription: String(data.metaDescription || '').substring(0, 160),
    content: String(data.content || ''),
    summary: String(data.summary || ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : ['technology', 'AI'],
  };
}

function generateFallbackBlog(research: ResearchResult): BlogContent {
  const title = research.headline || `Exploring ${research.topic}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);

  const keyPointsHtml = research.keyPoints
    .map((p) => `<li>${p}</li>`)
    .join('\n        ');

  const content = `
    <h2>Introduction</h2>
    <p>${research.summary}</p>

    <h2>Key Developments</h2>
    <p>The landscape of ${research.topic} continues to evolve rapidly. Here are the most significant developments:</p>
    <ul>
        ${keyPointsHtml}
    </ul>

    <h2>Technical Analysis</h2>
    <p>From a technical perspective, these developments represent a significant leap forward. The underlying technologies have matured to a point where practical applications are becoming increasingly viable. Researchers and engineers are finding novel ways to overcome previous limitations, leading to more robust and efficient systems.</p>

    <h2>Industry Impact</h2>
    <p>The implications for industry are far-reaching. Companies across sectors are evaluating how these advancements can be integrated into their operations. Early adopters are already seeing measurable benefits in terms of efficiency, cost reduction, and competitive advantage.</p>

    <h2>Real-World Applications</h2>
    <p>Beyond theoretical advances, practical implementations are emerging at an accelerating pace. From healthcare to finance, from manufacturing to creative industries, the real-world applications of ${research.topic} are expanding rapidly. Organizations that embrace these technologies early stand to gain a significant competitive edge.</p>

    <h2>What This Means Going Forward</h2>
    <p>Looking ahead, experts predict continued rapid advancement in this space. The convergence of improved algorithms, increased computational power, and growing datasets will likely accelerate progress even further. Stakeholders across the technology ecosystem should stay informed about these developments.</p>

    <h2>Conclusion</h2>
    <p>The developments in ${research.topic} represent an exciting frontier in technology. As these technologies mature, we can expect to see even more innovative applications and transformative impacts across industries. Staying informed and prepared for these changes will be crucial for businesses and professionals alike.</p>

    <h2>Frequently Asked Questions</h2>
    <h3>What are the key trends in ${research.topic}?</h3>
    <p>The main trends include increased practical applications, growing investment from major tech companies, and the development of more efficient and accessible tools and frameworks.</p>

    <h3>How will ${research.topic} affect businesses?</h3>
    <p>Businesses can expect improved efficiency, new capabilities for automation and analysis, and the emergence of new products and services enabled by these technologies.</p>

    <h3>What should professionals know about ${research.topic}?</h3>
    <p>Professionals should focus on understanding the fundamentals, staying current with developments, and identifying opportunities to apply these technologies in their specific domains.</p>
  `.trim();

  return {
    title,
    slug,
    metaDescription: `Explore the latest developments in ${research.topic}. Learn about key trends, industry impact, and what to expect in the future.`.substring(0, 160),
    content,
    summary: research.summary,
    tags: ['technology', 'AI', 'innovation', research.topic.split(' ')[0]],
  };
}
