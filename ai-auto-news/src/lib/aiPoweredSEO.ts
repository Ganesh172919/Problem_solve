/**
 * AI-Powered SEO Engine
 *
 * Provides:
 * - Keyword density analysis and meta tag optimization
 * - Title and description generation (template + keyword injection)
 * - Schema markup generation (Article, BreadcrumbList, FAQPage, etc.)
 * - Internal linking recommendations
 * - Canonical URL management
 * - Core Web Vitals tracking (LCP, FID, CLS)
 * - Structured data injection
 * - Competitor keyword gap analysis
 * - SEO score calculation
 * - Sitemap generation
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface KeywordDensity {
  keyword: string;
  count: number;
  density: number; // percentage
  positions: number[]; // word indices
  prominence: number; // 0-100 (higher = in title/h1/first paragraph)
  tfIdf: number;
  recommended: boolean;
  suggestion?: string;
}

export interface SEOAnalysis {
  url: string;
  title: string;
  description: string;
  wordCount: number;
  readabilityScore: number; // Flesch-Kincaid
  keywordDensities: KeywordDensity[];
  headings: { level: number; text: string; keywordMatch: boolean }[];
  internalLinks: number;
  externalLinks: number;
  images: { src: string; alt: string; hasAlt: boolean }[];
  canonicalUrl?: string;
  score: number;
  issues: SEOIssue[];
  recommendations: string[];
  analyzedAt: Date;
}

export interface SEOIssue {
  type: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  impact: 'high' | 'medium' | 'low';
  field?: string;
}

export interface MetaOptimization {
  url: string;
  original: { title: string; description: string; keywords?: string };
  optimized: { title: string; description: string; keywords: string };
  changes: string[];
  scoreBefore: number;
  scoreAfter: number;
  titleLength: number;
  descriptionLength: number;
  focusKeyword: string;
}

export interface SchemaMarkup {
  type: 'Article' | 'BreadcrumbList' | 'FAQPage' | 'HowTo' | 'Product' | 'Organization' | 'WebSite' | 'NewsArticle';
  jsonLd: Record<string, unknown>;
  rendered: string;
}

export interface CoreWebVitals {
  url: string;
  lcp: number;    // Largest Contentful Paint (ms)
  fid: number;    // First Input Delay (ms)
  cls: number;    // Cumulative Layout Shift (score)
  fcp: number;    // First Contentful Paint (ms)
  ttfb: number;   // Time to First Byte (ms)
  si: number;     // Speed Index (ms)
  tti: number;    // Time to Interactive (ms)
  lcpRating: 'good' | 'needs-improvement' | 'poor';
  fidRating: 'good' | 'needs-improvement' | 'poor';
  clsRating: 'good' | 'needs-improvement' | 'poor';
  overallRating: 'good' | 'needs-improvement' | 'poor';
  measuredAt: Date;
  device: 'desktop' | 'mobile';
}

export interface LinkRecommendation {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  relevanceScore: number;
  contextSnippet: string;
  type: 'internal' | 'external';
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface KeywordGap {
  keyword: string;
  yourRanking?: number;
  competitorRankings: Record<string, number>;
  searchVolume: number;
  difficulty: number;
  opportunity: number; // 0-100
  priority: 'high' | 'medium' | 'low';
  suggestedContent?: string;
}

export interface SitemapEntry {
  url: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export interface Sitemap {
  xml: string;
  entries: SitemapEntry[];
  generatedAt: Date;
  totalUrls: number;
}

export interface ContentDocument {
  id: string;
  url: string;
  title: string;
  description: string;
  body: string;
  headings: string[];
  tags: string[];
  publishedAt: Date;
  updatedAt?: Date;
  imageUrl?: string;
  author?: string;
  category?: string;
}

// ─── AI-Powered SEO Engine ────────────────────────────────────────────────────

class AIPoweredSEO {
  private vitalsStore = new Map<string, CoreWebVitals[]>();
  private canonicalMap = new Map<string, string>(); // variant -> canonical
  private contentIndex = new Map<string, ContentDocument>();
  private readonly CACHE_TTL = 600;

  // Stop words for keyword analysis
  private readonly STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
    'those', 'it', 'its', 'as', 'if', 'not', 'no', 'so', 'up', 'out',
    'about', 'into', 'through', 'than', 'then', 'more', 'also', 'just',
    'i', 'we', 'you', 'he', 'she', 'they', 'my', 'our', 'your', 'their',
  ]);

  // Competitor keyword database (simulated)
  private readonly COMPETITOR_KEYWORDS: Record<string, Array<{ keyword: string; ranking: number; volume: number; difficulty: number }>> = {
    'competitor-a.com': [
      { keyword: 'ai news automation', ranking: 1, volume: 8100, difficulty: 72 },
      { keyword: 'news aggregator ai', ranking: 2, volume: 5400, difficulty: 65 },
      { keyword: 'automated journalism', ranking: 3, volume: 3600, difficulty: 58 },
      { keyword: 'content intelligence platform', ranking: 5, volume: 2900, difficulty: 61 },
      { keyword: 'real-time news api', ranking: 4, volume: 4400, difficulty: 55 },
    ],
    'competitor-b.com': [
      { keyword: 'news recommendation engine', ranking: 1, volume: 6700, difficulty: 68 },
      { keyword: 'ai content curation', ranking: 2, volume: 4100, difficulty: 62 },
      { keyword: 'personalized news feed', ranking: 1, volume: 12000, difficulty: 74 },
      { keyword: 'media intelligence tool', ranking: 6, volume: 1900, difficulty: 48 },
      { keyword: 'automated news writing', ranking: 3, volume: 5100, difficulty: 70 },
    ],
  };

  constructor() {
    this.seedContentIndex();
    logger.info('AIPoweredSEO initialized');
  }

  private seedContentIndex(): void {
    const articles: ContentDocument[] = [
      {
        id: 'art_001', url: '/articles/ai-news-automation',
        title: 'How AI is Transforming News Automation in 2025',
        description: 'Discover the latest AI-powered tools transforming how newsrooms automate content creation and distribution.',
        body: 'Artificial intelligence is rapidly changing the landscape of news media. From automated writing to intelligent content distribution, AI tools are enabling newsrooms to publish faster, reach broader audiences, and personalize content at scale. This comprehensive guide explores the most impactful AI applications in modern journalism, including natural language generation, real-time fact-checking, and predictive analytics for editorial decisions.',
        headings: ['AI in Modern Journalism', 'Automated Writing Tools', 'Content Distribution', 'The Future of AI News'],
        tags: ['ai', 'news', 'automation', 'journalism', 'technology'],
        publishedAt: new Date('2025-01-15'),
        author: 'Jane Smith',
        category: 'Technology',
      },
      {
        id: 'art_002', url: '/articles/seo-best-practices',
        title: 'SEO Best Practices for Digital Publishers',
        description: 'A complete guide to search engine optimization for digital news publishers, including technical SEO and content strategy.',
        body: 'Search engine optimization remains critical for digital publishers competing for visibility. Technical SEO foundations including proper schema markup, canonical URLs, and Core Web Vitals directly impact search rankings. Publishers must balance content quality, keyword optimization, and user experience to achieve sustainable organic growth.',
        headings: ['Technical SEO Foundations', 'Content Optimization', 'Core Web Vitals', 'Schema Markup'],
        tags: ['seo', 'digital publishing', 'search', 'optimization'],
        publishedAt: new Date('2025-01-10'),
        author: 'Bob Chen',
        category: 'SEO',
      },
    ];
    for (const doc of articles) this.contentIndex.set(doc.id, doc);
  }

  // ─── Content Analysis ─────────────────────────────────────────────────────

  analyzeContent(doc: ContentDocument): SEOAnalysis {
    const cacheKey = `seo:analysis:${doc.id}`;
    const cached = cache.get<SEOAnalysis>(cacheKey);
    if (cached) return cached;

    const words = this.tokenize(doc.body);
    const titleWords = this.tokenize(doc.title);
    const allText = `${doc.title} ${doc.body}`;

    const keywordDensities = this.computeKeywordDensities(words, titleWords);
    const headings = doc.headings.map((h, i) => ({
      level: i === 0 ? 1 : 2,
      text: h,
      keywordMatch: keywordDensities.some((kd) => h.toLowerCase().includes(kd.keyword)),
    }));

    const issues: SEOIssue[] = [];
    const recommendations: string[] = [];

    // Title length check
    if (doc.title.length < 30) {
      issues.push({ type: 'warning', code: 'TITLE_TOO_SHORT', message: `Title is ${doc.title.length} chars; aim for 50-60`, impact: 'medium', field: 'title' });
    } else if (doc.title.length > 70) {
      issues.push({ type: 'warning', code: 'TITLE_TOO_LONG', message: `Title is ${doc.title.length} chars; keep under 60`, impact: 'medium', field: 'title' });
    }

    // Description length
    if (doc.description.length < 100) {
      issues.push({ type: 'warning', code: 'DESC_TOO_SHORT', message: 'Meta description under 100 chars', impact: 'medium', field: 'description' });
    } else if (doc.description.length > 160) {
      issues.push({ type: 'warning', code: 'DESC_TOO_LONG', message: 'Meta description over 160 chars will be truncated', impact: 'low', field: 'description' });
    }

    // Word count
    if (words.length < 300) {
      issues.push({ type: 'error', code: 'THIN_CONTENT', message: `Only ${words.length} words; aim for 600+`, impact: 'high' });
      recommendations.push('Expand content to at least 600 words for better ranking potential');
    }

    // Keyword density check
    const overDenseKeywords = keywordDensities.filter((kd) => kd.density > 3);
    if (overDenseKeywords.length > 0) {
      issues.push({
        type: 'warning', code: 'KEYWORD_STUFFING',
        message: `Keywords over 3% density: ${overDenseKeywords.map((k) => k.keyword).join(', ')}`,
        impact: 'high',
      });
    }

    // Image alt check
    const images = doc.imageUrl
      ? [{ src: doc.imageUrl, alt: doc.title, hasAlt: true }]
      : [];

    // H1 check
    if (!headings.some((h) => h.level === 1)) {
      issues.push({ type: 'error', code: 'MISSING_H1', message: 'No H1 heading found', impact: 'high' });
    }

    if (!doc.url.startsWith('/') && !doc.url.startsWith('http')) {
      issues.push({ type: 'warning', code: 'INVALID_URL', message: 'URL format should start with / or https://', impact: 'low' });
    }

    if (keywordDensities.length > 0) {
      recommendations.push(`Focus on primary keyword: "${keywordDensities[0].keyword}"`);
    }
    if (images.length === 0) {
      recommendations.push('Add at least one optimized image with descriptive alt text');
    }
    recommendations.push('Ensure internal linking to 2-3 related articles');

    const score = this.calculateSEOScore({
      titleLen: doc.title.length,
      descLen: doc.description.length,
      wordCount: words.length,
      hasH1: headings.some((h) => h.level === 1),
      keywordInTitle: keywordDensities.some((kd) => doc.title.toLowerCase().includes(kd.keyword)),
      issueCount: issues.filter((i) => i.type === 'error').length,
    });

    const analysis: SEOAnalysis = {
      url: doc.url,
      title: doc.title,
      description: doc.description,
      wordCount: words.length,
      readabilityScore: this.fleschKincaid(doc.body),
      keywordDensities,
      headings,
      internalLinks: 0,
      externalLinks: 0,
      images,
      canonicalUrl: this.canonicalMap.get(doc.url) ?? doc.url,
      score,
      issues,
      recommendations,
      analyzedAt: new Date(),
    };

    cache.set(cacheKey, analysis, this.CACHE_TTL);
    return analysis;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !this.STOP_WORDS.has(w));
  }

  private computeKeywordDensities(bodyWords: string[], titleWords: string[]): KeywordDensity[] {
    const freq: Record<string, { count: number; positions: number[] }> = {};
    const allWords = bodyWords;

    for (let i = 0; i < allWords.length; i++) {
      const w = allWords[i];
      if (!freq[w]) freq[w] = { count: 0, positions: [] };
      freq[w].count++;
      freq[w].positions.push(i);
    }

    // Also compute bigrams
    for (let i = 0; i < allWords.length - 1; i++) {
      const bigram = `${allWords[i]} ${allWords[i + 1]}`;
      if (!freq[bigram]) freq[bigram] = { count: 0, positions: [] };
      freq[bigram].count++;
      freq[bigram].positions.push(i);
    }

    const totalWords = allWords.length || 1;
    const docCount = 100; // simulated document corpus size for TF-IDF

    return Object.entries(freq)
      .filter(([, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([keyword, data]) => {
        const density = parseFloat(((data.count / totalWords) * 100).toFixed(2));
        const inTitle = titleWords.includes(keyword) || titleWords.join(' ').includes(keyword);
        const prominence = inTitle ? 90 : data.positions[0] < 50 ? 70 : data.positions[0] < 200 ? 40 : 20;
        const tf = data.count / totalWords;
        const idf = Math.log(docCount / (1 + 1)); // simulated IDF
        const tfIdf = parseFloat((tf * idf).toFixed(4));
        const recommended = density >= 0.5 && density <= 2.5;

        let suggestion: string | undefined;
        if (density > 3) suggestion = `Reduce usage (${density}% is too high; target 1-2%)`;
        else if (density < 0.5 && inTitle) suggestion = `Increase usage in body (only ${density}%)`;

        return { keyword, count: data.count, density, positions: data.positions.slice(0, 10), prominence, tfIdf, recommended, suggestion };
      });
  }

  // Flesch-Kincaid Readability (approximate)
  private fleschKincaid(text: string): number {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const syllables = words.reduce((s, w) => s + this.countSyllables(w), 0);
    if (!sentences.length || !words.length) return 0;
    const asl = words.length / sentences.length;
    const asw = syllables / words.length;
    return parseFloat(Math.max(0, Math.min(100, 206.835 - 1.015 * asl - 84.6 * asw)).toFixed(1));
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const match = word.match(/[aeiouy]{1,2}/g);
    return match ? match.length : 1;
  }

  // ─── Meta Optimization ────────────────────────────────────────────────────

  optimizeMeta(doc: ContentDocument, focusKeyword: string): MetaOptimization {
    const original = { title: doc.title, description: doc.description };
    const scoreBefore = this.calculateSEOScore({
      titleLen: doc.title.length,
      descLen: doc.description.length,
      wordCount: this.tokenize(doc.body).length,
      hasH1: true,
      keywordInTitle: doc.title.toLowerCase().includes(focusKeyword.toLowerCase()),
      issueCount: 0,
    });

    const changes: string[] = [];
    let optimizedTitle = doc.title;
    let optimizedDesc = doc.description;

    // Ensure focus keyword in title
    if (!optimizedTitle.toLowerCase().includes(focusKeyword.toLowerCase())) {
      optimizedTitle = `${focusKeyword.charAt(0).toUpperCase() + focusKeyword.slice(1)}: ${optimizedTitle}`;
      changes.push(`Added focus keyword "${focusKeyword}" to title`);
    }

    // Trim title if too long
    if (optimizedTitle.length > 60) {
      optimizedTitle = optimizedTitle.substring(0, 57) + '...';
      changes.push('Trimmed title to 60 characters');
    }

    // Ensure keyword in description
    if (!optimizedDesc.toLowerCase().includes(focusKeyword.toLowerCase())) {
      optimizedDesc = `${optimizedDesc} Learn more about ${focusKeyword}.`;
      changes.push(`Injected focus keyword into description`);
    }

    // Trim description if too long
    if (optimizedDesc.length > 160) {
      optimizedDesc = optimizedDesc.substring(0, 157) + '...';
      changes.push('Trimmed description to 160 characters');
    }

    // Pad description if too short
    if (optimizedDesc.length < 100) {
      const supplement = ` Explore in-depth coverage on ${doc.tags.slice(0, 3).join(', ')}.`;
      optimizedDesc += supplement;
      changes.push('Extended description to improve length');
    }

    const optimizedKeywords = [focusKeyword, ...doc.tags.slice(0, 5)].join(', ');

    const scoreAfter = this.calculateSEOScore({
      titleLen: optimizedTitle.length,
      descLen: optimizedDesc.length,
      wordCount: this.tokenize(doc.body).length,
      hasH1: true,
      keywordInTitle: true,
      issueCount: 0,
    });

    return {
      url: doc.url,
      original,
      optimized: { title: optimizedTitle, description: optimizedDesc, keywords: optimizedKeywords },
      changes,
      scoreBefore,
      scoreAfter,
      titleLength: optimizedTitle.length,
      descriptionLength: optimizedDesc.length,
      focusKeyword,
    };
  }

  // ─── Suggested Title Generation ───────────────────────────────────────────

  suggestTitle(doc: ContentDocument, focusKeyword: string): string[] {
    const templates = [
      `${focusKeyword}: A Complete Guide for ${new Date().getFullYear()}`,
      `How to Master ${focusKeyword} — Proven Strategies`,
      `The Ultimate ${focusKeyword} Handbook`,
      `${focusKeyword} Explained: What You Need to Know`,
      `Top ${focusKeyword} Techniques That Actually Work`,
      `${doc.title} | ${focusKeyword} Deep Dive`,
      `Why ${focusKeyword} Matters More Than Ever`,
      `${focusKeyword}: Best Practices & Expert Insights`,
    ];
    return templates.map((t) => t.slice(0, 70));
  }

  // ─── Schema Markup Generation ─────────────────────────────────────────────

  generateSchema(doc: ContentDocument, type: SchemaMarkup['type']): SchemaMarkup {
    let jsonLd: Record<string, unknown> = {};

    switch (type) {
      case 'Article':
      case 'NewsArticle':
        jsonLd = {
          '@context': 'https://schema.org',
          '@type': type,
          headline: doc.title,
          description: doc.description,
          author: { '@type': 'Person', name: doc.author ?? 'Editorial Team' },
          datePublished: doc.publishedAt.toISOString(),
          dateModified: (doc.updatedAt ?? doc.publishedAt).toISOString(),
          url: doc.url,
          image: doc.imageUrl ?? '',
          articleSection: doc.category ?? 'General',
          keywords: doc.tags.join(', '),
          publisher: {
            '@type': 'Organization',
            name: 'AI Auto News',
            logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' },
          },
        };
        break;

      case 'BreadcrumbList':
        jsonLd = {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com' },
            { '@type': 'ListItem', position: 2, name: doc.category ?? 'Articles', item: `https://example.com/${doc.category?.toLowerCase() ?? 'articles'}` },
            { '@type': 'ListItem', position: 3, name: doc.title, item: `https://example.com${doc.url}` },
          ],
        };
        break;

      case 'FAQPage':
        jsonLd = {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: doc.headings.map((h) => ({
            '@type': 'Question',
            name: h.endsWith('?') ? h : `${h}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `${h} is discussed in detail in this article about ${doc.title}.`,
            },
          })),
        };
        break;

      case 'WebSite':
        jsonLd = {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'AI Auto News',
          url: 'https://example.com',
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: 'https://example.com/search?q={search_term_string}' },
            'query-input': 'required name=search_term_string',
          },
        };
        break;

      case 'Organization':
        jsonLd = {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'AI Auto News',
          url: 'https://example.com',
          logo: 'https://example.com/logo.png',
          sameAs: ['https://twitter.com/aiautonews', 'https://linkedin.com/company/aiautonews'],
          contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'support@example.com' },
        };
        break;

      default:
        jsonLd = { '@context': 'https://schema.org', '@type': type };
    }

    const rendered = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
    return { type, jsonLd, rendered };
  }

  // ─── Internal Link Recommendations ───────────────────────────────────────

  recommendLinks(sourceDoc: ContentDocument, maxRecommendations = 5): LinkRecommendation[] {
    const cacheKey = `seo:links:${sourceDoc.id}`;
    const cached = cache.get<LinkRecommendation[]>(cacheKey);
    if (cached) return cached;

    const sourceTags = new Set(sourceDoc.tags);
    const sourceKeywords = this.tokenize(sourceDoc.body);
    const recommendations: LinkRecommendation[] = [];

    for (const [, doc] of this.contentIndex) {
      if (doc.id === sourceDoc.id) continue;

      // Relevance: shared tags + keyword overlap
      const sharedTags = doc.tags.filter((t) => sourceTags.has(t)).length;
      const docKeywords = new Set(this.tokenize(doc.body));
      const keywordOverlap = sourceKeywords.filter((k) => docKeywords.has(k)).length;
      const relevanceScore = Math.round(sharedTags * 15 + keywordOverlap * 2);

      if (relevanceScore < 5) continue;

      // Find best anchor text from source body
      const commonKeyword = sourceKeywords.find((k) => docKeywords.has(k) && !this.STOP_WORDS.has(k)) ?? doc.title;

      // Find context snippet
      const bodyWords = sourceDoc.body.split(' ');
      const kwIdx = bodyWords.findIndex((w) => w.toLowerCase().includes(commonKeyword.toLowerCase()));
      const snippetStart = Math.max(0, kwIdx - 5);
      const contextSnippet = bodyWords.slice(snippetStart, snippetStart + 15).join(' ') + '...';

      recommendations.push({
        sourceUrl: sourceDoc.url,
        targetUrl: doc.url,
        anchorText: commonKeyword,
        relevanceScore,
        contextSnippet,
        type: 'internal',
        priority: relevanceScore > 30 ? 'high' : relevanceScore > 15 ? 'medium' : 'low',
        reason: `${sharedTags} shared tags, ${keywordOverlap} keyword overlap`,
      });
    }

    const result = recommendations
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxRecommendations);
    cache.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  // ─── Core Web Vitals Tracking ─────────────────────────────────────────────

  trackCoreWebVitals(vitals: Omit<CoreWebVitals, 'lcpRating' | 'fidRating' | 'clsRating' | 'overallRating' | 'measuredAt'>): CoreWebVitals {
    const lcpRating = vitals.lcp <= 2500 ? 'good' : vitals.lcp <= 4000 ? 'needs-improvement' : 'poor';
    const fidRating = vitals.fid <= 100 ? 'good' : vitals.fid <= 300 ? 'needs-improvement' : 'poor';
    const clsRating = vitals.cls <= 0.1 ? 'good' : vitals.cls <= 0.25 ? 'needs-improvement' : 'poor';

    const ratings = [lcpRating, fidRating, clsRating];
    const overallRating: CoreWebVitals['overallRating'] = ratings.every((r) => r === 'good')
      ? 'good'
      : ratings.some((r) => r === 'poor')
      ? 'poor'
      : 'needs-improvement';

    const full: CoreWebVitals = {
      ...vitals,
      lcpRating,
      fidRating,
      clsRating,
      overallRating,
      measuredAt: new Date(),
    };

    const existing = this.vitalsStore.get(vitals.url) ?? [];
    existing.push(full);
    if (existing.length > 1000) existing.shift();
    this.vitalsStore.set(vitals.url, existing);

    if (overallRating !== 'good') {
      logger.warn('Core Web Vitals issue detected', {
        url: vitals.url,
        lcp: vitals.lcp,
        fid: vitals.fid,
        cls: vitals.cls,
        rating: overallRating,
      });
    }
    return full;
  }

  getCoreWebVitalsSummary(url: string): { avg: Partial<CoreWebVitals>; p75: Partial<CoreWebVitals>; latest: CoreWebVitals | null } {
    const records = this.vitalsStore.get(url) ?? [];
    if (!records.length) return { avg: {}, p75: {}, latest: null };

    const avg = (arr: number[]) => parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
    const p75 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    };

    return {
      avg: {
        lcp: avg(records.map((r) => r.lcp)),
        fid: avg(records.map((r) => r.fid)),
        cls: parseFloat(avg(records.map((r) => r.cls)).toFixed(3)),
        fcp: avg(records.map((r) => r.fcp)),
        ttfb: avg(records.map((r) => r.ttfb)),
      },
      p75: {
        lcp: p75(records.map((r) => r.lcp)),
        fid: p75(records.map((r) => r.fid)),
        cls: parseFloat(p75(records.map((r) => r.cls)).toFixed(3)),
      },
      latest: records[records.length - 1],
    };
  }

  // ─── Keyword Gap Analysis ─────────────────────────────────────────────────

  findKeywordGaps(ownKeywords: string[], competitors?: string[]): KeywordGap[] {
    const cacheKey = `seo:gaps:${ownKeywords.join(',').slice(0, 60)}`;
    const cached = cache.get<KeywordGap[]>(cacheKey);
    if (cached) return cached;

    const targetCompetitors = competitors ?? Object.keys(this.COMPETITOR_KEYWORDS);
    const ownSet = new Set(ownKeywords.map((k) => k.toLowerCase()));
    const gaps: KeywordGap[] = [];

    for (const competitor of targetCompetitors) {
      const compKeywords = this.COMPETITOR_KEYWORDS[competitor] ?? [];
      for (const kw of compKeywords) {
        if (!ownSet.has(kw.keyword.toLowerCase())) {
          const existing = gaps.find((g) => g.keyword === kw.keyword);
          if (existing) {
            existing.competitorRankings[competitor] = kw.ranking;
          } else {
            gaps.push({
              keyword: kw.keyword,
              yourRanking: undefined,
              competitorRankings: { [competitor]: kw.ranking },
              searchVolume: kw.volume,
              difficulty: kw.difficulty,
              opportunity: this.computeOpportunityScore(kw.volume, kw.difficulty),
              priority: kw.volume > 5000 && kw.difficulty < 70 ? 'high' : kw.volume > 2000 ? 'medium' : 'low',
              suggestedContent: `Create a comprehensive guide targeting "${kw.keyword}"`,
            });
          }
        }
      }
    }

    const result = gaps.sort((a, b) => b.opportunity - a.opportunity);
    cache.set(cacheKey, result, this.CACHE_TTL);
    logger.info('Keyword gap analysis complete', { gaps: result.length });
    return result;
  }

  private computeOpportunityScore(volume: number, difficulty: number): number {
    // Higher volume + lower difficulty = higher opportunity
    const volumeScore = Math.min(100, (volume / 10000) * 100);
    const easeScore = 100 - difficulty;
    return parseFloat(((volumeScore * 0.6 + easeScore * 0.4)).toFixed(1));
  }

  // ─── SEO Score Calculation ────────────────────────────────────────────────

  calculateSEOScore(params: {
    titleLen: number;
    descLen: number;
    wordCount: number;
    hasH1: boolean;
    keywordInTitle: boolean;
    issueCount: number;
  }): number {
    let score = 0;

    // Title (20 pts)
    if (params.titleLen >= 50 && params.titleLen <= 60) score += 20;
    else if (params.titleLen >= 40 && params.titleLen <= 70) score += 15;
    else if (params.titleLen > 0) score += 8;

    // Description (20 pts)
    if (params.descLen >= 130 && params.descLen <= 160) score += 20;
    else if (params.descLen >= 100 && params.descLen <= 175) score += 15;
    else if (params.descLen > 0) score += 8;

    // Word count (20 pts)
    if (params.wordCount >= 1000) score += 20;
    else if (params.wordCount >= 600) score += 15;
    else if (params.wordCount >= 300) score += 10;
    else score += 3;

    // H1 (15 pts)
    if (params.hasH1) score += 15;

    // Keyword in title (15 pts)
    if (params.keywordInTitle) score += 15;

    // Deduct for errors (10 pts)
    score -= params.issueCount * 5;

    return Math.max(0, Math.min(100, score));
  }

  // ─── Canonical URL Management ─────────────────────────────────────────────

  setCanonical(variantUrl: string, canonicalUrl: string): void {
    this.canonicalMap.set(variantUrl, canonicalUrl);
    logger.info('Canonical set', { variantUrl, canonicalUrl });
  }

  getCanonical(url: string): string {
    return this.canonicalMap.get(url) ?? url;
  }

  // ─── Sitemap Generation ───────────────────────────────────────────────────

  generateSitemap(baseUrl: string, additionalUrls?: SitemapEntry[]): Sitemap {
    const entries: SitemapEntry[] = [];

    // Add homepage
    entries.push({ url: baseUrl, lastmod: new Date().toISOString().split('T')[0], changefreq: 'daily', priority: 1.0 });

    // Content index
    for (const [, doc] of this.contentIndex) {
      entries.push({
        url: `${baseUrl}${doc.url}`,
        lastmod: (doc.updatedAt ?? doc.publishedAt).toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: 0.8,
      });
    }

    // Additional entries
    if (additionalUrls) entries.push(...additionalUrls);

    // Deduplicate
    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...deduped.map((e) => [
        '  <url>',
        `    <loc>${e.url}</loc>`,
        `    <lastmod>${e.lastmod}</lastmod>`,
        `    <changefreq>${e.changefreq}</changefreq>`,
        `    <priority>${e.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n')),
      '</urlset>',
    ].join('\n');

    const sitemap: Sitemap = { xml, entries: deduped, generatedAt: new Date(), totalUrls: deduped.length };
    cache.set(`seo:sitemap:${baseUrl}`, sitemap, 3600);
    logger.info('Sitemap generated', { baseUrl, totalUrls: deduped.length });
    return sitemap;
  }

  // ─── Structured Data Injection ────────────────────────────────────────────

  injectStructuredData(html: string, schemas: SchemaMarkup[]): string {
    const schemaHtml = schemas.map((s) => s.rendered).join('\n');
    // Inject before closing </head> tag
    if (html.includes('</head>')) {
      return html.replace('</head>', `${schemaHtml}\n</head>`);
    }
    return schemaHtml + '\n' + html;
  }

  // ─── Content Index Management ─────────────────────────────────────────────

  indexContent(doc: ContentDocument): void {
    this.contentIndex.set(doc.id, doc);
  }

  getIndexedContent(): ContentDocument[] {
    return Array.from(this.contentIndex.values());
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getAIPoweredSEO(): AIPoweredSEO {
  if (!(globalThis as any).__aiPoweredSEO__) {
    (globalThis as any).__aiPoweredSEO__ = new AIPoweredSEO();
  }
  return (globalThis as any).__aiPoweredSEO__;
}
