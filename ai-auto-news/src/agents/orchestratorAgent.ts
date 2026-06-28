// ─────────────────────────────────────────────────────────────────────────────
// OrchestratorAgent — master coordinator for a single content generation cycle.
// Called by the Scheduler on each tick. Runs the full pipeline:
// Research → Select Template → Write → Quality Check → Publish
//
// WHY sequential (not parallel):
//  - Prevents simultaneous Gemini calls that would exhaust RPM limits
//  - Makes the pipeline debuggable — one linear log stream per run
//  - SQLite doesn't benefit from write concurrency (WAL helps reads only)
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { researchAgent, type TrendingTopic } from './researchAgent';
import { writerAgent } from './writerAgent';
import { qualityAgent } from './qualityAgent';
import { publisherAgent } from './publisherAgent';
import { AgentLogger } from '@/lib/agentLogger';
import { pickWeightedTemplate } from '@/templates';
import getDb from '@/db/index';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UserPreferences {
  topics?: string;
  tone?: string;
  frequency?: string;
}

/**
 * runGenerationCycle — executes the full autonomous publishing pipeline.
 *
 * @param userPreferences - Optional user preferences from onboarding quiz
 * @returns Object with success status, count of articles published, and message
 */
export async function runGenerationCycle(
  userPreferences?: UserPreferences,
): Promise<{ success: boolean; articlesPublished: number; message: string }> {
  const runId = uuidv4();
  const log = new AgentLogger(runId, 'OrchestratorAgent');

  log.info('═══ Generation cycle started ═══', {
    preferences: userPreferences ? {
      topics: userPreferences.topics,
      tone: userPreferences.tone,
    } : 'none',
  });

  try {
    // ── STEP 1: Research ─────────────────────────────────────────────────────
    const preferredTopics = userPreferences?.topics
      ? JSON.parse(userPreferences.topics)
      : [];

    const topics = await researchAgent(runId, preferredTopics);
    log.info(`Research complete — ${topics.length} topics found`);

    if (topics.length === 0) {
      log.warn('No trending topics found — skipping this cycle');
      return { success: true, articlesPublished: 0, message: 'No fresh topics found' };
    }

    // ── STEP 2: Select topics + templates ────────────────────────────────────
    // Take top 2-3 topics and assign templates
    const maxArticles = userPreferences?.frequency === 'breaking' ? 3 : 2;
    const selectedTopics = topics.slice(0, maxArticles);
    const usedTemplateIds: string[] = [];

    let articlesPublished = 0;

    // ── STEP 3-5: Write → Quality → Publish for each topic ───────────────────
    for (const topic of selectedTopics) {
      const template = pickWeightedTemplate(usedTemplateIds);
      usedTemplateIds.push(template.id);

      log.info(`Processing: "${topic.topic}" with template "${template.id}"`);

      try {
        // WRITE
        const article = await writerAgent(runId, topic, template, userPreferences?.tone);

        // QUALITY CHECK
        const quality = await qualityAgent(runId, article.title, article.content);

        if (!quality.passed) {
          log.warn(`Quality check failed — ${quality.reason}. Skipping.`);
          continue;
        }

        // PUBLISH
        const articleId = await publisherAgent(runId, article, quality.score);
        articlesPublished++;

        log.info(`✅ Published article #${articleId}`, {
          title: article.title,
          category: article.category,
          wordCount: quality.wordCount,
          qualityScore: quality.score,
          template: template.id,
        });

        // Pause between articles to respect RPM limits
        if (selectedTopics.indexOf(topic) < selectedTopics.length - 1) {
          await sleep(15_000);
        }
      } catch (articleError) {
        const msg = articleError instanceof Error ? articleError.message : String(articleError);
        log.error(`Failed to generate article for "${topic.topic}": ${msg}`);
      }
    }

    // Update scheduler state
    try {
      const db = getDb();
      db.prepare(`
        UPDATE scheduler_state
        SET total_articles_generated = (SELECT COUNT(*) FROM posts),
            total_runs = total_runs + 1,
            last_run_at = datetime('now'),
            last_error = NULL
        WHERE id = 1
      `).run();
    } catch {
      // Non-fatal
    }

    log.info(`═══ Generation cycle complete: ${articlesPublished} articles published ═══`);
    return {
      success: true,
      articlesPublished,
      message: `Published ${articlesPublished} articles`,
    };
  } catch (cycleError) {
    const msg = cycleError instanceof Error ? cycleError.message : String(cycleError);
    log.error(`Generation cycle failed: ${msg}`);

    // Update scheduler error state
    try {
      const db = getDb();
      db.prepare(`UPDATE scheduler_state SET last_error = ? WHERE id = 1`).run(msg);
    } catch {
      // Non-fatal
    }

    return { success: false, articlesPublished: 0, message: msg };
  }
}
