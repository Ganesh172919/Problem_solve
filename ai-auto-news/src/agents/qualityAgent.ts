// ─────────────────────────────────────────────────────────────────────────────
// QualityAgent — validates generated content before publishing.
// Rejects low-quality, off-topic, or malformed articles.
//
// Scoring breakdown (total = 100):
//   30pts — Minimum word count met
//   20pts — Title uniqueness (no duplicate in last 7 days)
//   20pts — Content is actually about Tech/AI (keyword check)
//   15pts — No Gemini refusal patterns detected
//   15pts — No placeholder text present
//
// REJECT threshold: score < 60
// ─────────────────────────────────────────────────────────────────────────────

import { AgentLogger } from '@/lib/agentLogger';
import getDb from '@/db/index';

const AI_TECH_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'neural', 'model', 'llm',
  'gpt', 'gemini', 'claude', 'openai', 'google', 'microsoft', 'meta', 'apple',
  'startup', 'tech', 'software', 'algorithm', 'data', 'compute', 'chip', 'gpu',
  'transformer', 'training', 'inference', 'api', 'cloud', 'developer', 'open source',
];

const REFUSAL_PATTERNS = [
  'i cannot', 'i am unable', 'as an ai', 'i\'m an ai', 'i don\'t have the ability',
  'i apologize', 'i\'m sorry, but', 'this request', 'i cannot fulfill',
];

const PLACEHOLDER_PATTERNS = [
  'lorem ipsum', '[insert', '[placeholder', 'your content here', 'tbd', 'to be determined',
  '{{', '}}', '[company name]', '[product name]',
];

export interface QualityResult {
  passed: boolean;
  score: number;
  reason: string;
  wordCount: number;
}

/**
 * qualityAgent — scores an article and determines if it passes the quality gate.
 *
 * @param runId - Unique ID for this generation run
 * @param title - Article title to check for uniqueness
 * @param content - Article HTML content to analyze
 * @returns QualityResult with pass/fail, score, and diagnostics
 */
export async function qualityAgent(
  runId: string,
  title: string,
  content: string,
): Promise<QualityResult> {
  const log = new AgentLogger(runId, 'QualityAgent');
  let score = 0;
  const issues: string[] = [];
  const contentLower = content.toLowerCase();
  const textContent = content.replace(/<[^>]+>/g, ' ').trim();
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  // ── CHECK 1: Word count (30pts) ───────────────────────────────────────────
  if (wordCount >= 300) {
    score += 30;
  } else {
    issues.push(`Word count too low: ${wordCount} < 300`);
  }

  // ── CHECK 2: Title uniqueness (20pts) ─────────────────────────────────────
  try {
    const db = getDb();
    const similar = db.prepare(`
      SELECT id FROM posts WHERE LOWER(title) = LOWER(?) AND createdAt > datetime('now', '-7 days')
    `).get(title);

    if (!similar) {
      score += 20;
    } else {
      issues.push(`Duplicate title found in last 7 days`);
    }
  } catch {
    // If DB check fails, give benefit of the doubt
    score += 20;
  }

  // ── CHECK 3: Tech/AI relevance (20pts) ────────────────────────────────────
  const keywordMatches = AI_TECH_KEYWORDS.filter((kw) => contentLower.includes(kw));
  if (keywordMatches.length >= 3) {
    score += 20;
  } else {
    issues.push(`Content lacks Tech/AI keywords (found ${keywordMatches.length}, need 3+)`);
  }

  // ── CHECK 4: No refusal patterns (15pts) ──────────────────────────────────
  const refusalFound = REFUSAL_PATTERNS.find((p) => contentLower.includes(p));
  if (!refusalFound) {
    score += 15;
  } else {
    issues.push(`Gemini refusal pattern detected: "${refusalFound}"`);
  }

  // ── CHECK 5: No placeholder text (15pts) ──────────────────────────────────
  const placeholderFound = PLACEHOLDER_PATTERNS.find((p) => contentLower.includes(p));
  if (!placeholderFound) {
    score += 15;
  } else {
    issues.push(`Placeholder text detected: "${placeholderFound}"`);
  }

  const passed = score >= 60;
  const reason = issues.length > 0 ? issues.join('; ') : 'All checks passed';

  log.info(`Quality check: ${score}/100 — ${passed ? 'PASSED' : 'REJECTED'}`, {
    title,
    wordCount,
    score,
    issues,
  });

  return { passed, score, reason, wordCount };
}
