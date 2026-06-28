// ─────────────────────────────────────────────────────────────────────────────
// Curated digest of 5 top developments in Tech/AI.
// Run 2-3 times per week. Editorial, scannable, high signal-to-noise.
// WHY low weight (3): roundups are complementary — most content is original articles.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';

export const weeklyRoundupTemplate: ContentTemplate = {
  id: 'weekly-roundup',
  name: 'Weekly Roundup',
  templateType: 'weekly-roundup',
  defaultCategory: 'Tech',
  schedulingWeight: 3,

  systemPrompt: `You are the editor of a curated Tech/AI newsletter. You write weekly roundups
that help busy professionals stay current without reading every story.
Rules:
- Curate only the most impactful developments — ruthlessly filter noise
- Each item: what happened + why it matters (2-3 sentences each)
- End with a "trend of the week" that connects the dots across items
- Conversational but authoritative tone — like a smart friend briefing you
- HTML output only using <h2>, <h3>, <p>, <ul>, <li>, <strong>`,

  userPromptTemplate: `Write a weekly roundup of the top 5 Tech/AI developments related to: {{topic}}

Context: {{context}}
Audience: {{audience}}
Week of: {{date}}

Return ONLY this exact JSON (no markdown, no backticks):
{
  "title": "This Week in Tech: [theme] (under 80 chars)",
  "excerpt": "What this week's top stories tell us about where Tech/AI is heading (under 200 chars)",
  "content": "<h2>This Week in Tech & AI</h2><p>Intro paragraph...</p><h2>1. [Story Title]</h2><p>What happened + why it matters...</p><h2>2. [Story Title]</h2><p>...</p><h2>3. [Story Title]</h2><p>...</p><h2>4. [Story Title]</h2><p>...</p><h2>5. [Story Title]</h2><p>...</p><h2>Trend of the Week</h2><p>The thread connecting all five stories...</p><h2>What to Watch Next Week</h2><ul><li>...</li></ul>",
  "subcategory": "Weekly Roundup",
  "tags": ["weekly-roundup", "tag2", "tag3", "tag4"],
  "category": "Tech"
}`,

  minWords: 800,
  maxWords: 1200,
};
