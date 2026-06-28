// ─────────────────────────────────────────────────────────────────────────────
// For fast-breaking Tech/AI news stories.
// Tone: urgent, factual, no fluff. Modeled on TechCrunch breaking posts.
// Target: 400-600 words, 5-minute read max.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentTemplate } from './types';

export const breakingNewsTemplate: ContentTemplate = {
  id: 'breaking-news',
  name: 'Breaking News',
  templateType: 'breaking-news',
  defaultCategory: 'AI',
  schedulingWeight: 8,

  systemPrompt: `You are a senior tech journalist at a leading technology publication.
Your job: write fast, accurate, objective breaking news articles about Tech and AI.
Rules:
- Lead with the most important fact (inverted pyramid style)
- Never speculate — state clearly when something is confirmed vs. rumored
- No marketing language or hype
- Include specific company names, product names, and dates when known
- Always answer: Who, What, When, Where, Why, and What's next
- HTML output only — use <h2>, <p>, <ul>, <strong> tags
- No <html>, <head>, <body>, <article> wrapper tags — content only`,

  userPromptTemplate: `Write a breaking news article about: {{topic}}

Additional context: {{context}}
Audience: {{audience}}
Writing tone: {{tone}}
Date: {{date}}

Return ONLY this exact JSON (no markdown, no backticks):
{
  "title": "Compelling headline under 80 characters — factual, not clickbait",
  "excerpt": "One-sentence summary that answers WHO did WHAT (under 160 chars)",
  "content": "<p>Lead paragraph...</p><h2>What happened</h2><p>...</p><h2>Key details</h2><ul><li>...</li></ul><h2>What this means</h2><p>...</p><h2>What's next</h2><p>...</p>",
  "subcategory": "One of: Large Language Models | Semiconductors | Cybersecurity | Robotics | Cloud | Software | Funding",
  "tags": ["tag1", "tag2", "tag3"],
  "category": "AI or Tech or Startups"
}`,

  minWords: 400,
  maxWords: 600,
};
