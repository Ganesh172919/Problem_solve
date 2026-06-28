// ─────────────────────────────────────────────────────────────────────────────
// WriterAgent — takes a topic + template and generates a full article via Gemini.
// Validates the response and retries on malformed output.
//
// WHY expectJson=true for generation:
//  - Structured JSON output is easier to validate than parsing markdown
//  - The HTML content lives inside the "content" JSON field
// ─────────────────────────────────────────────────────────────────────────────

import { generateContent } from '@/lib/geminiService';
import { AgentLogger } from '@/lib/agentLogger';
import type { ContentTemplate } from '@/templates/types';
import type { TrendingTopic } from './researchAgent';

export interface RawArticle {
  title: string;
  excerpt: string;
  content: string;
  subcategory: string;
  tags: string[];
  category: string;
  geminiModelUsed: string;
  templateId: string;
  sourceTopic: string;
}

/**
 * writerAgent — generates a full article using a topic and template.
 *
 * @param runId - Unique ID for this generation run
 * @param topic - The trending topic to write about
 * @param template - The content template to use
 * @param tone - User's preferred tone from onboarding
 * @returns RawArticle with all fields populated
 * @throws {Error} If Gemini returns unparseable or missing required fields
 */
export async function writerAgent(
  runId: string,
  topic: TrendingTopic,
  template: ContentTemplate,
  tone: string = 'balanced',
): Promise<RawArticle> {
  const log = new AgentLogger(runId, 'WriterAgent');

  const toneMap: Record<string, string> = {
    quick: 'concise and direct — get to the point fast',
    balanced: 'balanced — accessible but substantive',
    technical: 'technical and detailed — don\'t dumb it down',
  };
  const toneInstruction = toneMap[tone] || toneMap.balanced;

  const userPrompt = template.userPromptTemplate
    .replace('{{topic}}', topic.topic)
    .replace('{{context}}', topic.context || 'No additional context available')
    .replace('{{tone}}', toneInstruction)
    .replace('{{audience}}', 'Technology professionals, engineers, and founders')
    .replace('{{date}}', new Date().toDateString());

  log.info(`Generating article for: "${topic.topic}"`, {
    template: template.id,
    tone,
    promptLength: userPrompt.length,
  });

  const startTime = Date.now();
  const response = await generateContent({
    systemPrompt: template.systemPrompt,
    userPrompt,
    expectJson: true,
    temperature: 0.75,
    maxOutputTokens: 4096,
    agentName: 'WriterAgent',
  });

  log.info(`Generation complete in ${Date.now() - startTime}ms`, {
    model: response.modelUsed,
    tokens: response.tokensUsed,
    retries: response.retryCount,
  });

  // Parse JSON response
  let parsed: Record<string, unknown>;
  try {
    let cleaned = response.text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    // Try direct parse first
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try extracting JSON object
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('No JSON object found in response');
      }
    }
  } catch {
    log.error('Writer received non-JSON response', { sample: response.text.slice(0, 300) });
    throw new Error('WriterAgent: Failed to parse Gemini JSON response');
  }

  // Validate required fields
  const required = ['title', 'excerpt', 'content', 'tags', 'category'];
  const missing = required.filter((f) => !parsed[f]);
  if (missing.length > 0) {
    log.error(`Response missing required fields: ${missing.join(', ')}`);
    throw new Error(`WriterAgent: Missing fields: ${missing.join(', ')}`);
  }

  return {
    title: String(parsed.title),
    excerpt: String(parsed.excerpt),
    content: String(parsed.content),
    subcategory: String(parsed.subcategory || ''),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    category: String(parsed.category || template.defaultCategory),
    geminiModelUsed: response.modelUsed,
    templateId: template.id,
    sourceTopic: topic.topic,
  };
}
