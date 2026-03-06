import type { BlogContent, NewsContent, ResearchResult } from '@/types';

const FALLBACK_TOPICS = [
  'local developer experience improvements',
  'AI-assisted writing workflows',
  'TypeScript and Next.js best practices',
  'pragmatic observability for small apps',
  'SQLite performance tips for localhost apps',
  'API design and versioning strategy',
  'security headers and CSP in modern web apps',
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function pickTopic(recentTopics: string[], requestedTopic?: string): string {
  const cleanedRequested = requestedTopic?.trim();
  if (cleanedRequested) return cleanedRequested;

  const recentLower = recentTopics.map((t) => t.toLowerCase());
  const available = FALLBACK_TOPICS.filter((t) => !recentLower.some((r) => r.includes(t)));
  const pool = available.length > 0 ? available : FALLBACK_TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function extractTags(topic: string): string[] {
  const tags = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .slice(0, 6);
  return Array.from(new Set(['ai', 'tech', ...tags])).slice(0, 6);
}

export function mockResearch(recentTopics: string[], requestedTopic?: string): ResearchResult {
  const topic = pickTopic(recentTopics, requestedTopic);
  const headline = `Mock update: ${topic.charAt(0).toUpperCase() + topic.slice(1)}`;
  const summary =
    'This is locally-generated mock research content used when no external AI provider is configured. ' +
    'Set AI_PROVIDER=gemini and provide GEMINI_API_KEY to enable live generation.';

  return {
    topic,
    headline,
    summary,
    keyPoints: [
      'Runs fully offline with deterministic, safe placeholder output.',
      'Keeps the end-to-end publishing workflow functional on localhost.',
      'Helps validate UI, APIs, and database writes without external dependencies.',
      'Switch providers via environment variables without code changes.',
    ],
    references: ['mock://local'],
  };
}

export function mockBlog(research: ResearchResult): BlogContent {
  const title = research.headline || `Mock blog: ${research.topic}`;
  const slug = slugify(title);
  const tags = extractTags(research.topic || title);
  const metaDescription = `${title} (mock content for localhost).`.slice(0, 160);

  const content = [
    `<h2>Introduction</h2>`,
    `<p>${research.summary || 'This post is generated locally for development and testing.'}</p>`,
    `<h2>What changed?</h2>`,
    `<p>This section demonstrates structured HTML content rendering in the UI.</p>`,
    `<h2>Why it matters</h2>`,
    `<ul>`,
    `<li>Validates scheduling, agent orchestration, and persistence.</li>`,
    `<li>Exercises SSR/streaming rendering paths in Next.js.</li>`,
    `<li>Provides realistic enough content for SEO routes (RSS/sitemap) locally.</li>`,
    `</ul>`,
    `<h2>Technical notes</h2>`,
    `<p>Switch to live generation by setting <code>AI_PROVIDER=gemini</code> and a valid <code>GEMINI_API_KEY</code>.</p>`,
    `<h2>FAQs</h2>`,
    `<h3>Is this real news?</h3>`,
    `<p>No. This is mock content to keep localhost workflows functional without external services.</p>`,
    `<h3>Will this publish to production?</h3>`,
    `<p>Not unless you deploy the app and configure a real AI provider.</p>`,
    `<h3>How do I enable live generation?</h3>`,
    `<p>Set the environment variables and restart the server.</p>`,
  ].join('\n');

  return {
    title,
    slug,
    metaDescription,
    content,
    summary: research.summary || 'Mock summary (offline mode).',
    tags,
  };
}

export function mockNews(research: ResearchResult): NewsContent {
  const title = research.headline || `Mock news: ${research.topic}`;
  const slug = slugify(title);
  const tags = extractTags(research.topic || title);
  const metaDescription = `${title} (mock).`.slice(0, 160);

  const content = [
    `<h2>Headline</h2>`,
    `<p><strong>${title}</strong></p>`,
    `<h2>Summary</h2>`,
    `<p>${research.summary || 'Mock summary for localhost development.'}</p>`,
    `<h2>Key points</h2>`,
    `<ul>`,
    ...research.keyPoints.slice(0, 6).map((p) => `<li>${p}</li>`),
    `</ul>`,
    `<p><em>Source:</em> mock://local</p>`,
  ].join('\n');

  return {
    title,
    slug,
    metaDescription,
    content,
    summary: research.summary || 'Mock summary (offline mode).',
    tags,
  };
}

