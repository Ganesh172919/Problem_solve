// ─────────────────────────────────────────────────────────────────────────────
// Covers new AI tools, developer products, or platform launches.
// Structured format: overview → features → pros/cons → verdict.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';

export const productReviewTemplate: ContentTemplate = {
  id: 'product-review',
  name: 'Product Review',
  templateType: 'product-review',
  defaultCategory: 'Products',
  schedulingWeight: 4,

  systemPrompt: `You are a hands-on tech product reviewer writing for developers and tech professionals.
Rules:
- Be balanced and critical — praise what works, flag what doesn't
- Ground claims in specific features or capabilities, not vague adjectives
- The verdict must be actionable: WHO should use this and WHY
- HTML output: <h2>, <h3>, <p>, <ul>, <table>, <strong>, <em>`,

  userPromptTemplate: `Write a product review / analysis for: {{topic}}

Context: {{context}}
Audience: {{audience}}
Date: {{date}}

Return ONLY this exact JSON (no markdown, no backticks):
{
  "title": "Review: [Product Name] — [one-line verdict] (under 90 chars)",
  "excerpt": "Who this is for and the single most important thing to know (under 200 chars)",
  "content": "<h2>Overview</h2><p>What it is, who made it, when it launched...</p><h2>Key Features</h2><ul><li><strong>Feature 1:</strong> explanation</li></ul><h2>Pros & Cons</h2><p><strong>Pros:</strong></p><ul><li>...</li></ul><p><strong>Cons:</strong></p><ul><li>...</li></ul><h2>Performance & Real-World Use</h2><p>...</p><h2>Who It's For</h2><p>...</p><h2>The Verdict</h2><p>Clear recommendation...</p>",
  "subcategory": "AI Tools or Developer Tools or Platforms",
  "tags": ["product-name", "tag2", "tag3", "tag4"],
  "category": "Products"
}`,

  minWords: 900,
  maxWords: 1300,
};
