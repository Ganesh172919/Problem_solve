import { Post } from '@/types';
import { RecommendedPost } from '@/types/saas';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'RecommendationAgent' });

const CACHE_TTL = 300; // 5 minutes

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);
}

function buildTf(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const total = tokens.length;
  const tf = new Map<string, number>();
  for (const [term, count] of freq) {
    tf.set(term, count / total);
  }
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weight] of a) {
    dot += weight * (b.get(term) || 0);
    normA += weight * weight;
  }
  for (const weight of b.values()) {
    normB += weight * weight;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function getPostVector(post: Post): Map<string, number> {
  const text = [post.title, post.summary, post.tags.join(' ')].join(' ');
  return buildTf(tokenize(text));
}

export function getRecommendations(
  post: Post,
  allPosts: Post[],
  limit = 5,
): RecommendedPost[] {
  const cacheKey = `recommendations:${post.id}:${limit}`;
  const cached = cache.get<RecommendedPost[]>(cacheKey);
  if (cached) return cached;

  const postVector = getPostVector(post);

  const scored = allPosts
    .filter((p) => p.id !== post.id)
    .map((p) => {
      const pVector = getPostVector(p);
      const score = cosineSimilarity(postVector, pVector);

      // Boost score for same category
      const categoryBoost = p.category === post.category ? 0.1 : 0;

      // Boost score for shared tags
      const sharedTags = post.tags.filter((t) => p.tags.includes(t)).length;
      const tagBoost = sharedTags * 0.05;

      return {
        post: p,
        finalScore: score + categoryBoost + tagBoost,
        sharedTags,
      };
    })
    .filter((item) => item.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);

  const results: RecommendedPost[] = scored.map((item) => {
    let reason = 'Similar content';
    if (item.sharedTags > 0) {
      reason = `Shares ${item.sharedTags} tag${item.sharedTags > 1 ? 's' : ''} with this article`;
    } else if (item.post.category === post.category) {
      reason = `More from ${item.post.category}`;
    }

    return {
      id: item.post.id,
      title: item.post.title,
      slug: item.post.slug,
      summary: item.post.summary,
      score: parseFloat(item.finalScore.toFixed(4)),
      reason,
      createdAt: item.post.createdAt,
    };
  });

  cache.set(cacheKey, results, CACHE_TTL);
  log.debug('Recommendations computed', { postId: post.id, count: results.length });

  return results;
}

export function getTrendingTopics(
  posts: Post[],
  days = 7,
  limit = 10,
): { tag: string; count: number }[] {
  const cacheKey = `trending:${days}:${limit}`;
  const cached = cache.get<{ tag: string; count: number }[]>(cacheKey);
  if (cached) return cached;

  const since = new Date(Date.now() - days * 86_400_000);
  const recentPosts = posts.filter((p) => new Date(p.createdAt) > since);

  const tagCount = new Map<string, number>();
  for (const post of recentPosts) {
    for (const tag of post.tags) {
      const normalized = tag.toLowerCase().trim();
      if (normalized.length > 0) {
        tagCount.set(normalized, (tagCount.get(normalized) || 0) + 1);
      }
    }
  }

  const trending = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));

  cache.set(cacheKey, trending, CACHE_TTL);
  return trending;
}

export interface PersonalizedRecommendation {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string[];
  score: number;
  reason: string;
  createdAt: string;
}

export function getPersonalizedRecommendations({
  posts,
  topics = [],
  categories = [],
  excludeSlugs = [],
  limit = 6,
}: {
  posts: Post[];
  topics?: string[];
  categories?: string[];
  excludeSlugs?: string[];
  limit?: number;
}): PersonalizedRecommendation[] {
  const topicSet = new Set(topics.map((topic) => topic.toLowerCase().trim()).filter(Boolean));
  const categorySet = new Set(categories.map((category) => category.toLowerCase().trim()).filter(Boolean));
  const excludeSet = new Set(excludeSlugs.map((slug) => slug.toLowerCase().trim()).filter(Boolean));
  const now = Date.now();

  const scored = posts
    .filter((post) => !excludeSet.has(post.slug.toLowerCase()))
    .map((post) => {
      let score = 0;
      const reasons: string[] = [];
      const category = post.category.toLowerCase();
      const searchable = `${post.title} ${post.summary} ${post.tags.join(' ')}`.toLowerCase();
      const matchingTopics = [...topicSet].filter((topic) => searchable.includes(topic));

      if (categorySet.has(category)) {
        score += 4;
        reasons.push(`matches ${post.category}`);
      }

      if (matchingTopics.length > 0) {
        score += matchingTopics.length * 2.5;
        reasons.push(`mentions ${matchingTopics.slice(0, 2).join(', ')}`);
      }

      if (post.sourceReferences.length > 0) score += 0.75;
      if (post.autoGenerated) score += 0.25;

      const ageHours = Math.max(1, (now - new Date(post.createdAt).getTime()) / 3_600_000);
      score += Math.max(0, 2 - ageHours / 72);

      if (score === 0) {
        score = Math.max(0.1, 1 - ageHours / 240);
        reasons.push('recent from the full feed');
      }

      return {
        post,
        score,
        reason: reasons.length > 0 ? `Recommended because it ${reasons.join(' and ')}` : 'Recommended from recent coverage',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ post, score, reason }) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    category: post.category,
    tags: post.tags,
    score: parseFloat(score.toFixed(4)),
    reason,
    createdAt: post.createdAt,
  }));
}
