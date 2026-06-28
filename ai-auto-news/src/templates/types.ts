// ─────────────────────────────────────────────────────────────────────────────
// Defines the shape of all content templates.
// Every template produces the same output shape so the pipeline is uniform.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentTemplate {
  /** Unique ID used in DB and logs (e.g., "breaking-news") */
  id: string;

  /** Human-readable name for admin dashboard */
  name: string;

  /** Controls which pipeline path this takes */
  templateType: 'breaking-news' | 'deep-analysis' | 'weekly-roundup' | 'product-review' | 'research-explainer';

  /** Primary category tag for generated articles */
  defaultCategory: 'AI' | 'Tech' | 'Startups' | 'Research' | 'Products';

  /**
   * System prompt for Gemini — sets the writer's persona and rules.
   * Keep this under 1000 tokens to preserve output token budget.
   */
  systemPrompt: string;

  /**
   * User prompt template with {{variable}} placeholders.
   * Available variables: {{topic}}, {{context}}, {{tone}}, {{date}}, {{audience}}
   * Interpolated by WriterAgent before sending to Gemini.
   */
  userPromptTemplate: string;

  /** Article length targets */
  minWords: number;
  maxWords: number;

  /**
   * Scheduling weight (1-10).
   * Higher = selected more often by the orchestrator.
   */
  schedulingWeight: number;
}
