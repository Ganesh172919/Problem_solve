// ─────────────────────────────────────────────────────────────────────────────
// Makes AI research papers and complex concepts accessible.
// Audience: engineers/founders who don't have time to read papers.
// Structure: What → Why it matters → How it works (simplified) → Implications.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';

export const researchExplainerTemplate: ContentTemplate = {
  id: 'research-explainer',
  name: 'Research Explainer',
  templateType: 'research-explainer',
  defaultCategory: 'Research',
  schedulingWeight: 4,

  systemPrompt: `You are a science communicator specializing in AI research.
Your audience is senior engineers and technical founders who are smart but busy.
Rules:
- Assume the reader knows programming but has not read the paper
- Explain jargon on first use (e.g., "attention mechanism (the core of transformers)")
- Use analogies generously — make abstract concepts concrete
- Always answer: What's new about this vs. what came before?
- Always address: What are the limitations?
- HTML output: <h2>, <h3>, <p>, <ul>, <ol>, <blockquote>, <strong>, <em>, <code>`,

  userPromptTemplate: `Write a research explainer about: {{topic}}

Context: {{context}}
Audience: {{audience}}
Date: {{date}}

Return ONLY this exact JSON (no markdown, no backticks):
{
  "title": "Headline that highlights the breakthrough (under 85 chars)",
  "excerpt": "What breakthrough this explains and why developers should care (under 220 chars)",
  "content": "<h2>The One-Paragraph Summary</h2><p>ELI-engineer version...</p><h2>Why This Matters</h2><p>The problem this solves and why previous approaches failed...</p><h2>How It Works</h2><p>Simplified technical explanation with analogies...</p><h3>The Key Innovation</h3><p>...</p><h2>Real-World Implications</h2><ul><li>...</li></ul><h2>Limitations & Open Questions</h2><p>...</p><h2>What to Read Next</h2><p>For those who want to go deeper...</p>",
  "subcategory": "AI Research or Machine Learning or NLP or Computer Vision",
  "tags": ["research", "tag2", "tag3", "tag4", "tag5"],
  "category": "Research"
}`,

  minWords: 700,
  maxWords: 1000,
};
