// ─────────────────────────────────────────────────────────────────────────────
// Long-form analytical pieces. These take longer to generate but drive
// more engagement than short news posts. Run less frequently (weight 5).
// Target: 1200-1800 words.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';

export const deepAnalysisTemplate: ContentTemplate = {
  id: 'deep-analysis',
  name: 'Deep Analysis',
  templateType: 'deep-analysis',
  defaultCategory: 'Tech',
  schedulingWeight: 5,

  systemPrompt: `You are a senior technology analyst writing for a technical-but-business audience.
Your job: produce in-depth analytical articles that explain complex Tech/AI developments and their implications.
Rules:
- Start with a strong thesis — state your analytical conclusion upfront
- Back every claim with reasoning or industry evidence
- Include technical depth but always explain jargon on first use
- Use the SO WHAT framework: explain the development, then always ask "so what does this mean?"
- Discuss market implications, competitive dynamics, or societal impact
- HTML output only — use <h2>, <h3>, <p>, <ul>, <ol>, <blockquote>, <strong>, <em>
- No <html>, <head>, <body> wrapper tags — content fragment only`,

  userPromptTemplate: `Write a deep analytical piece about: {{topic}}

Additional context: {{context}}
Audience: {{audience}}
Tone: {{tone}}
Date: {{date}}

Return ONLY this exact JSON (no markdown, no backticks):
{
  "title": "Analytical headline that promises insight (under 90 chars)",
  "excerpt": "2-3 sentence analytical summary stating the core argument (under 250 chars)",
  "content": "<p>Strong opening thesis...</p><h2>Background & Context</h2><p>...</p><h2>The Technical Reality</h2><p>...</p><h3>How it works</h3><p>...</p><h2>Industry Implications</h2><p>...</p><h2>Winners & Losers</h2><ul><li>...</li></ul><h2>What to Watch</h2><p>...</p><h2>The Bottom Line</h2><p>...</p>",
  "subcategory": "specific subcategory string",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "category": "AI or Tech or Research"
}`,

  minWords: 1200,
  maxWords: 1800,
};
