// ─────────────────────────────────────────────────────────────────────────────
// Central registry of all content templates.
// OrchestratorAgent imports TEMPLATE_REGISTRY to pick templates by weight.
// Admin dashboard lists templates from here.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';
import { breakingNewsTemplate } from './breakingNews';
import { deepAnalysisTemplate } from './deepAnalysis';
import { weeklyRoundupTemplate } from './weeklyRoundup';
import { productReviewTemplate } from './productReview';
import { researchExplainerTemplate } from './researchExplainer';

export type { ContentTemplate };

export const TEMPLATE_REGISTRY: ContentTemplate[] = [
  breakingNewsTemplate,
  deepAnalysisTemplate,
  weeklyRoundupTemplate,
  productReviewTemplate,
  researchExplainerTemplate,
];

/**
 * getTemplateById — look up a template by ID.
 * Returns undefined if ID is not found (caller should log a warning).
 */
export function getTemplateById(id: string): ContentTemplate | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.id === id);
}

/**
 * pickWeightedTemplate — selects a template using weighted random selection.
 * Higher schedulingWeight = more likely to be chosen.
 * Used by the orchestrator to vary content types.
 *
 * @param excludeIds - Template IDs to exclude (e.g., recently used)
 * @returns A randomly selected template respecting weights
 */
export function pickWeightedTemplate(excludeIds: string[] = []): ContentTemplate {
  const eligible = TEMPLATE_REGISTRY.filter((t) => !excludeIds.includes(t.id));
  const pool = eligible.length > 0 ? eligible : TEMPLATE_REGISTRY;

  const totalWeight = pool.reduce((sum, t) => sum + t.schedulingWeight, 0);
  let random = Math.random() * totalWeight;

  for (const template of pool) {
    random -= template.schedulingWeight;
    if (random <= 0) return template;
  }

  return pool[pool.length - 1];
}
