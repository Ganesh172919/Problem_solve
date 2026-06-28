// ─────────────────────────────────────────────────────────────────────────────
// Autonomous Publisher — legacy entry point that delegates to the new
// OrchestratorAgent pipeline. Maintained for backward compatibility with
// existing API routes (/api/generate, /api/scheduler).
// ─────────────────────────────────────────────────────────────────────────────

import { runGenerationCycle } from './orchestratorAgent';
import getDb from '@/db/index';

/**
 * autonomousPublisher — triggers a single content generation cycle.
 * Used by the /api/generate endpoint and the scheduler.
 *
 * @returns Object with success status and message
 */
export async function autonomousPublisher(): Promise<{ success: boolean; message: string }> {
  try {
    // Fetch user preferences if available
    let prefs: Record<string, string> | undefined;
    try {
      const db = getDb();
      const row = db.prepare(
        `SELECT topics, tone, frequency FROM user_preferences ORDER BY created_at DESC LIMIT 1`
      ).get() as Record<string, string> | undefined;
      if (row) prefs = row;
    } catch {
      // No preferences — use defaults
    }

    const result = await runGenerationCycle(prefs);
    return { success: result.success, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}
