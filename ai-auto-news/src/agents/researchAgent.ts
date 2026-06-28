// ─────────────────────────────────────────────────────────────────────────────
// ResearchAgent — queries Gemini to discover trending Tech/AI topics,
// then filters them against topics already covered in the last 48 hours.
//
// WHY 48-hour dedup window (not 7 days):
//  - Tech news moves fast — yesterday's story may need a follow-up today
//  - 7 days would make the topic pool too small after the first week
// ─────────────────────────────────────────────────────────────────────────────

import { generateContent } from '@/lib/geminiService';
import { AgentLogger } from '@/lib/agentLogger';
import getDb from '@/db/index';

export interface TrendingTopic {
  topic: string;
  context: string;
  companies: string[];
  topicType: string;
  urgency: number;
}

const RESEARCH_PROMPT = `You are a senior tech editor. Today is {{date}}.

List the 10 most trending and significant topics in Technology and AI right now.
For each topic, include:
- topic: the specific subject (be precise — "OpenAI o3 benchmark controversy" not just "AI")
- why_trending: 1 sentence on why it's generating discussion
- companies: key companies involved (array of strings, max 3)
- topic_type: one of "product_launch" | "research" | "funding" | "controversy" | "analysis" | "regulation"
- urgency: 1 (evergreen) to 5 (breaking right now)

User's preferred topics: {{preferredTopics}}

Return ONLY valid JSON: { "topics": [ { "topic": "", "why_trending": "", "companies": [], "topic_type": "", "urgency": 1 } ] }`;

/**
 * researchAgent — discovers trending Tech/AI topics via Gemini.
 *
 * @param runId - Unique ID for this generation run (for log correlation)
 * @param preferredTopics - User's preferred topics from onboarding quiz
 * @returns Array of TrendingTopic sorted by urgency (highest first)
 * @throws {Error} If Gemini returns unparseable JSON after all retries
 */
export async function researchAgent(
  runId: string,
  preferredTopics: string[] = [],
): Promise<TrendingTopic[]> {
  const log = new AgentLogger(runId, 'ResearchAgent');
  log.info('Starting topic research', { preferredTopics });

  const prompt = RESEARCH_PROMPT
    .replace('{{date}}', new Date().toISOString().split('T')[0])
    .replace('{{preferredTopics}}', JSON.stringify(preferredTopics));

  const startTime = Date.now();
  const response = await generateContent({
    systemPrompt: 'You are a tech editor. Return only valid JSON. No markdown, no code blocks.',
    userPrompt: prompt,
    expectJson: true,
    temperature: 0.3,
    agentName: 'ResearchAgent',
  });
  log.info(`Gemini responded in ${Date.now() - startTime}ms`, { model: response.modelUsed });

  // Parse response JSON
  let parsed: { topics: TrendingTopic[] };
  try {
    // Strip markdown fences if present
    let cleaned = response.text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    log.error('Failed to parse Gemini response as JSON', { raw: response.text.slice(0, 300) });
    return [];
  }

  if (!parsed.topics || !Array.isArray(parsed.topics)) {
    log.warn('Response missing topics array', { keys: Object.keys(parsed) });
    return [];
  }

  // Filter topics already covered in last 48 hours
  const db = getDb();
  const recentTitles = db
    .prepare(`SELECT title FROM posts WHERE createdAt > datetime('now', '-48 hours')`)
    .all() as { title: string }[];
  const recentLower = recentTitles.map((r) => r.title.toLowerCase());

  const freshTopics = parsed.topics.filter((t) => {
    const words = t.topic.toLowerCase().split(' ').slice(0, 3).join(' ');
    const alreadyCovered = recentLower.some((title) => title.includes(words));
    if (alreadyCovered) {
      log.debug(`Filtered out "${t.topic}" — already covered in last 48h`);
    }
    return !alreadyCovered;
  });

  log.info(`${parsed.topics.length} topics found, ${freshTopics.length} are fresh`);

  // Store fresh topics in trending_topics table
  try {
    const insert = db.prepare(`
      INSERT INTO trending_topics (topic, context, relevance_score, expires_at)
      VALUES (?, ?, ?, datetime('now', '+24 hours'))
    `);
    for (const t of freshTopics) {
      insert.run(t.topic, t.why_trending, t.urgency / 5.0);
    }
  } catch {
    // Non-fatal — trending_topics is optional
  }

  return freshTopics
    .sort((a, b) => b.urgency - a.urgency)
    .map((t) => ({
      topic: t.topic,
      context: t.why_trending,
      companies: t.companies || [],
      topicType: t.topic_type || 'analysis',
      urgency: t.urgency || 3,
    }));
}
