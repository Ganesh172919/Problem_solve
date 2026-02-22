import { getLogger } from './logger';
import { getCache } from './cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContentType = 'text' | 'code' | 'structured' | 'markdown' | 'html' | 'json' | 'plain';

export type OutputFormat = 'markdown' | 'html' | 'json' | 'plain';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface TextAnalysis {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgWordsPerSentence: number;
  readabilityScore: number; // 0-100 Flesch-like
  sentiment: SentimentLabel;
  sentimentScore: number; // -1 to 1
  keywords: string[];
  entities: NamedEntity[];
  language: string;
}

export interface NamedEntity {
  text: string;
  type: 'person' | 'org' | 'location' | 'date' | 'technology' | 'other';
  confidence: number;
}

export interface CodeAnalysis {
  language: string;
  lineCount: number;
  commentLineCount: number;
  blankLineCount: number;
  codeLineCount: number;
  documentationCoverage: number; // 0-1
  complexityScore: number; // cyclomatic-like 1-10
  functions: string[];
  imports: string[];
  hasTests: boolean;
}

export interface StructuredDataAnalysis {
  schema: 'valid' | 'invalid' | 'unknown';
  fieldCount: number;
  nestedDepth: number;
  nullFieldCount: number;
  arrayFieldCount: number;
  detectedType: string; // e.g. "article", "product", "user"
  validationErrors: string[];
}

export interface QualityScore {
  overall: number; // 0-100
  completeness: number;
  accuracy: number;
  clarity: number;
  richness: number;
  modality: ContentType;
}

export interface EnrichmentTag {
  tag: string;
  category: string;
  weight: number;
}

export interface ProcessedContent {
  id: string;
  inputType: ContentType;
  outputFormat: OutputFormat;
  original: string;
  transformed: string;
  summary: string;
  tags: EnrichmentTag[];
  quality: QualityScore;
  textAnalysis?: TextAnalysis;
  codeAnalysis?: CodeAnalysis;
  structuredAnalysis?: StructuredDataAnalysis;
  processingTimeMs: number;
  processedAt: string;
}

export interface BatchProcessingResult {
  total: number;
  succeeded: number;
  failed: number;
  results: ProcessedContent[];
  errors: Array<{ index: number; error: string }>;
  totalTimeMs: number;
}

export interface ProcessorOptions {
  outputFormat?: OutputFormat;
  maxSummaryLength?: number;
  maxKeywords?: number;
  enableEntityExtraction?: boolean;
  enableSentiment?: boolean;
  cacheResults?: boolean;
  cacheTtlSeconds?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  'great','good','excellent','amazing','outstanding','fantastic','wonderful',
  'superb','brilliant','positive','success','achieve','improve','effective',
  'efficient','innovative','leading','best','top','award','growth','profit',
]);

const NEGATIVE_WORDS = new Set([
  'bad','poor','terrible','awful','horrible','negative','fail','failure',
  'problem','issue','risk','loss','decline','decrease','delay','error',
  'bug','vulnerability','breach','attack','crash','outage','deficit',
]);

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','during','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would',
  'could','should','may','might','shall','can','need','that','this','these',
  'those','it','its','we','our','you','your','they','their','he','she','him',
  'her','his','i','me','my','us','not','no','nor','so','yet','both','either',
]);

const CODE_LANGUAGE_PATTERNS: Array<{ language: string; pattern: RegExp }> = [
  { language: 'typescript', pattern: /(?:interface\s+\w+|type\s+\w+\s*=|:\s*(?:string|number|boolean|void|unknown|any)\b|import\s+.*from\s+['"])/ },
  { language: 'javascript', pattern: /(?:const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|function\s+\w+|=>\s*{|require\()/ },
  { language: 'python', pattern: /(?:def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|if\s+__name__\s*==|print\s*\()/ },
  { language: 'java', pattern: /(?:public\s+class\s+\w+|private\s+\w+\s+\w+|@Override|System\.out\.print|void\s+main)/ },
  { language: 'go', pattern: /(?:func\s+\w+\s*\(|package\s+\w+|import\s+\(|:=\s|go\s+func)/ },
  { language: 'rust', pattern: /(?:fn\s+\w+\s*\(|let\s+mut\s+|impl\s+\w+|use\s+std::|println!)/ },
  { language: 'sql', pattern: /(?:SELECT\s+|FROM\s+\w+|WHERE\s+|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE)/i },
  { language: 'bash', pattern: /(?:echo\s+|sudo\s+|chmod\s+|\$\(|\$\{|export\s+\w+=|fi\b|esac\b)/ },
  { language: 'css', pattern: /(?:[.#]\w+\s*{|\s*:\s*\w+(?:px|em|rem|%)|@media\s*\()/ },
  { language: 'html', pattern: /(?:<html|<body|<div|<span|<p\b|<!DOCTYPE)/ },
];

function generateId(): string {
  return `proc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  return Math.max(1, (w.match(/[aeiouy]+/g) || []).length);
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class MultiModalProcessor {
  private readonly logger = getLogger();
  private readonly cache = getCache();
  private readonly defaultOptions: Required<ProcessorOptions> = {
    outputFormat: 'plain',
    maxSummaryLength: 300,
    maxKeywords: 10,
    enableEntityExtraction: true,
    enableSentiment: true,
    cacheResults: true,
    cacheTtlSeconds: 600,
  };

  // ── Content Type Detection ──────────────────────────────────────────────────

  detectContentType(content: string): ContentType {
    const trimmed = content.trimStart();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { JSON.parse(content); return 'json'; } catch { /* not json */ }
    }
    if (/<html|<!DOCTYPE/i.test(trimmed.slice(0, 200))) return 'html';
    if (/^#{1,6}\s|^\*\*|\*\s|^-\s|\[.*]\(.*\)/m.test(content)) return 'markdown';

    // Heuristic: significant code indicators
    const codeScore = CODE_LANGUAGE_PATTERNS.reduce((s, { pattern }) => s + (pattern.test(content) ? 1 : 0), 0);
    if (codeScore >= 2) return 'code';

    // Structured: key-value like content
    const kvLines = content.split('\n').filter(l => /^\s*[\w\s]+:\s*.+/.test(l));
    if (kvLines.length >= 3 && kvLines.length / content.split('\n').length >= 0.4) return 'structured';

    return 'text';
  }

  // ── Text Analysis ───────────────────────────────────────────────────────────

  analyzeText(content: string, opts: Partial<ProcessorOptions> = {}): TextAnalysis {
    const o = { ...this.defaultOptions, ...opts };
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const words = content.split(/\s+/).filter(w => w.length > 0);

    const wordCount = words.length;
    const sentenceCount = Math.max(1, sentences.length);
    const avgWordsPerSentence = wordCount / sentenceCount;

    // Flesch Reading Ease approximation
    const totalSyllables = words.reduce((s, w) => s + countSyllables(w), 0);
    const readabilityScore = Math.min(
      100,
      Math.max(0, 206.835 - 1.015 * avgWordsPerSentence - 84.6 * (totalSyllables / Math.max(1, wordCount))),
    );

    // Sentiment
    let posCount = 0;
    let negCount = 0;
    const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
    lowerWords.forEach(w => {
      if (POSITIVE_WORDS.has(w)) posCount++;
      if (NEGATIVE_WORDS.has(w)) negCount++;
    });
    const total = posCount + negCount || 1;
    const sentimentScore = (posCount - negCount) / total;
    const sentiment: SentimentLabel =
      sentimentScore > 0.1 ? 'positive' : sentimentScore < -0.1 ? 'negative' : 'neutral';

    // Keywords: TF-based, filtered by stop words
    const freq = new Map<string, number>();
    lowerWords.forEach(w => {
      if (w.length > 3 && !STOP_WORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    });
    const keywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, o.maxKeywords)
      .map(([w]) => w);

    // Named entity extraction (rule-based heuristic)
    const entities: NamedEntity[] = [];
    if (o.enableEntityExtraction) {
      // Capitalized consecutive words → likely org/person/location
      const entityMatches = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? [];
      const entityFreq = new Map<string, number>();
      entityMatches.forEach(e => entityFreq.set(e, (entityFreq.get(e) ?? 0) + 1));

      const TECH_TERMS = new Set(['API','SDK','TypeScript','JavaScript','Python','React','Node','AWS','Azure','GCP','Docker','Kubernetes','AI','ML']);
      const DATE_PAT = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/;

      for (const [text, freq] of [...entityFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        if (STOP_WORDS.has(text.toLowerCase())) continue;
        let type: NamedEntity['type'] = 'other';
        if (TECH_TERMS.has(text) || /\.js$|\.ts$/.test(text)) type = 'technology';
        else if (DATE_PAT.test(text)) type = 'date';
        else if (/Inc\.|Corp\.|Ltd\.|LLC/.test(text)) type = 'org';
        entities.push({ text, type, confidence: Math.min(0.95, 0.5 + freq * 0.1) });
      }
    }

    return {
      wordCount,
      sentenceCount,
      paragraphCount: Math.max(1, paragraphs.length),
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      readabilityScore: Math.round(readabilityScore),
      sentiment,
      sentimentScore: Math.round(sentimentScore * 100) / 100,
      keywords,
      entities: entities.slice(0, 15),
      language: 'en',
    };
  }

  // ── Code Analysis ────────────────────────────────────────────────────────────

  analyzeCode(content: string): CodeAnalysis {
    const lines = content.split('\n');
    const blankLines = lines.filter(l => l.trim() === '').length;
    const commentLines = lines.filter(l => /^\s*(?:\/\/|\/\*|\*|#|--|<!--)/.test(l)).length;
    const codeLines = lines.length - blankLines - commentLines;

    // Detect language
    let language = 'unknown';
    let bestScore = 0;
    for (const { language: lang, pattern } of CODE_LANGUAGE_PATTERNS) {
      const matches = (content.match(new RegExp(pattern.source, 'g')) || []).length;
      if (matches > bestScore) { bestScore = matches; language = lang; }
    }

    // Extract function names
    const funcPatterns = [
      /function\s+(\w+)\s*\(/g,
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
      /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*{/g,
      /def\s+(\w+)\s*\(/g,
      /func\s+(\w+)\s*\(/g,
      /fn\s+(\w+)\s*\(/g,
    ];
    const functions = new Set<string>();
    funcPatterns.forEach(p => {
      let m: RegExpExecArray | null;
      while ((m = p.exec(content)) !== null) {
        if (m[1] && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while') {
          functions.add(m[1]);
        }
      }
    });

    // Extract imports
    const importPatterns = [
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g,
      /import\s+['"]([^'"]+)['"]/g,
      /from\s+(\w+)\s+import/g,
      /use\s+([\w:]+);/g,
    ];
    const imports = new Set<string>();
    importPatterns.forEach(p => {
      let m: RegExpExecArray | null;
      while ((m = p.exec(content)) !== null) imports.add(m[1]);
    });

    const docCoverage = codeLines > 0 ? Math.min(1, commentLines / codeLines) : 0;
    const funcCount = functions.size || 1;

    // Cyclomatic complexity approximation: count branching keywords
    const branches = (content.match(/\b(?:if|else|for|while|switch|case|catch|&&|\|\||\?)/g) || []).length;
    const complexityScore = Math.min(10, Math.ceil(1 + branches / funcCount));

    return {
      language,
      lineCount: lines.length,
      commentLineCount: commentLines,
      blankLineCount: blankLines,
      codeLineCount: codeLines,
      documentationCoverage: Math.round(docCoverage * 100) / 100,
      complexityScore,
      functions: [...functions].slice(0, 30),
      imports: [...imports].slice(0, 30),
      hasTests: /(?:test|spec|describe|it\(|expect|assert)\s*\(/.test(content),
    };
  }

  // ── Structured Data Analysis ─────────────────────────────────────────────────

  analyzeStructuredData(content: string): StructuredDataAnalysis {
    const errors: string[] = [];
    let parsed: unknown;
    let schema: StructuredDataAnalysis['schema'] = 'unknown';

    try {
      parsed = JSON.parse(content);
      schema = 'valid';
    } catch (e) {
      errors.push(`JSON parse error: ${(e as Error).message}`);
      schema = 'invalid';
      return { schema, fieldCount: 0, nestedDepth: 0, nullFieldCount: 0, arrayFieldCount: 0, detectedType: 'unknown', validationErrors: errors };
    }

    function measure(obj: unknown, depth = 0): { fields: number; nulls: number; arrays: number; maxDepth: number } {
      if (obj === null || typeof obj !== 'object') return { fields: 0, nulls: 0, arrays: 0, maxDepth: depth };
      if (Array.isArray(obj)) {
        const sub = obj.map(i => measure(i, depth + 1));
        return {
          fields: sub.reduce((s, r) => s + r.fields, 0),
          nulls: sub.reduce((s, r) => s + r.nulls, 0),
          arrays: 1 + sub.reduce((s, r) => s + r.arrays, 0),
          maxDepth: Math.max(depth, ...sub.map(r => r.maxDepth)),
        };
      }
      const entries = Object.entries(obj as Record<string, unknown>);
      let fields = entries.length;
      let nulls = 0;
      let arrays = 0;
      let maxDepth = depth;
      for (const [, v] of entries) {
        if (v === null) nulls++;
        if (Array.isArray(v)) arrays++;
        if (v !== null && typeof v === 'object') {
          const r = measure(v, depth + 1);
          fields += r.fields;
          nulls += r.nulls;
          arrays += r.arrays;
          maxDepth = Math.max(maxDepth, r.maxDepth);
        }
      }
      return { fields, nulls, arrays, maxDepth };
    }

    const m = measure(parsed);
    const keys = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).map(k => k.toLowerCase())
      : [];

    let detectedType = 'unknown';
    if (keys.includes('title') && (keys.includes('content') || keys.includes('body'))) detectedType = 'article';
    else if (keys.includes('price') || keys.includes('sku')) detectedType = 'product';
    else if (keys.includes('email') || keys.includes('username')) detectedType = 'user';
    else if (keys.includes('event') || keys.includes('timestamp')) detectedType = 'event';
    else if (keys.includes('id') && keys.includes('name')) detectedType = 'entity';

    return {
      schema,
      fieldCount: m.fields,
      nestedDepth: m.maxDepth,
      nullFieldCount: m.nulls,
      arrayFieldCount: m.arrays,
      detectedType,
      validationErrors: errors,
    };
  }

  // ── Quality Scoring ──────────────────────────────────────────────────────────

  scoreQuality(content: string, type: ContentType, analysis?: TextAnalysis | CodeAnalysis): QualityScore {
    let completeness = 50;
    let clarity = 50;
    let richness = 50;
    let accuracy = 70; // hard to check without ground truth

    if (type === 'text' || type === 'markdown' || type === 'html') {
      const ta = analysis as TextAnalysis | undefined;
      const wc = ta?.wordCount ?? content.split(/\s+/).length;
      completeness = Math.min(100, (wc / 500) * 100);
      clarity = ta ? Math.min(100, ta.readabilityScore) : 50;
      richness = Math.min(100, ((ta?.keywords.length ?? 0) / 10) * 100);
    } else if (type === 'code') {
      const ca = analysis as CodeAnalysis | undefined;
      completeness = ca ? Math.min(100, (ca.codeLineCount / 50) * 100) : 50;
      clarity = ca ? Math.min(100, 100 - (ca.complexityScore - 1) * 10) : 50;
      richness = ca ? ca.documentationCoverage * 100 : 30;
    } else if (type === 'json' || type === 'structured') {
      completeness = content.length > 100 ? 70 : 40;
      clarity = 80;
      richness = 60;
    }

    const overall = Math.round((completeness + clarity + richness + accuracy) / 4);
    return {
      overall: Math.min(100, overall),
      completeness: Math.round(completeness),
      accuracy: Math.round(accuracy),
      clarity: Math.round(clarity),
      richness: Math.round(richness),
      modality: type,
    };
  }

  // ── Summarization ─────────────────────────────────────────────────────────────

  summarize(content: string, maxLength = 300): string {
    const sentences = content
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 20);

    if (sentences.length === 0) return content.slice(0, maxLength);
    if (sentences.length <= 2) return sentences.join(' ').slice(0, maxLength);

    // Score sentences by keyword presence and position
    const allWords = content.toLowerCase().split(/\s+/);
    const freq = new Map<string, number>();
    allWords.forEach(w => { if (!STOP_WORDS.has(w) && w.length > 3) freq.set(w, (freq.get(w) ?? 0) + 1); });

    const scored = sentences.map((s, i) => {
      const words = s.toLowerCase().split(/\s+/);
      const score = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0)
        + (i === 0 ? 5 : 0) // first sentence bonus
        + (i === 1 ? 2 : 0);
      return { sentence: s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    let summary = scored.slice(0, 3).map(s => s.sentence).join(' ');
    if (summary.length > maxLength) summary = summary.slice(0, maxLength - 3) + '...';
    return summary;
  }

  // ── Tagging ───────────────────────────────────────────────────────────────────

  generateTags(content: string, type: ContentType, analysis?: TextAnalysis): EnrichmentTag[] {
    const tags: EnrichmentTag[] = [];

    // Type tag
    tags.push({ tag: type, category: 'content-type', weight: 1.0 });

    // Keywords as tags
    if (analysis && 'keywords' in analysis) {
      analysis.keywords.slice(0, 5).forEach((kw, i) => {
        tags.push({ tag: kw, category: 'keyword', weight: 1 - i * 0.1 });
      });
    }

    // Sentiment tag
    if (analysis && 'sentiment' in analysis) {
      tags.push({ tag: analysis.sentiment, category: 'sentiment', weight: 0.8 });
    }

    // Technology tags from code
    if (type === 'code' && analysis && 'language' in analysis) {
      tags.push({ tag: (analysis as CodeAnalysis).language, category: 'language', weight: 1.0 });
    }

    // Deduplicate
    const seen = new Set<string>();
    return tags.filter(t => { if (seen.has(t.tag)) return false; seen.add(t.tag); return true; });
  }

  // ── Content Transformation ────────────────────────────────────────────────────

  /** Strip all HTML tags using a character-level state machine (no regex tag stripping). */
  private stripHtml(html: string): string {
    let result = '';
    let inTag = false;
    let inScript = false;
    let inStyle = false;
    let tagBuf = '';

    for (let i = 0; i < html.length; i++) {
      const ch = html[i];
      if (inTag) {
        tagBuf += ch;
        if (ch === '>') {
          const lower = tagBuf.toLowerCase();
          if (lower === 'script' || lower.startsWith('script ') || lower.startsWith('script/')) inScript = true;
          else if (lower === '/script') inScript = false;
          else if (lower === 'style' || lower.startsWith('style ') || lower.startsWith('style/')) inStyle = true;
          else if (lower === '/style') inStyle = false;
          else if (lower === 'br' || lower.startsWith('br ') || lower === 'br/') result += '\n';
          inTag = false;
          tagBuf = '';
        }
      } else if (ch === '<') {
        inTag = true;
        tagBuf = '';
      } else if (!inScript && !inStyle) {
        result += ch;
      }
    }
    return result;
  }

  transform(content: string, from: ContentType, to: OutputFormat): string {
    if (from === to as unknown as ContentType) return content;

    switch (to) {
      case 'plain': {
        const noHtml = (from === 'html') ? this.stripHtml(content) : content;
        return noHtml
          .replace(/#{1,6}\s/g, '')
          .replace(/[*_`~]/g, '')
          .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();
      }

      case 'markdown':
        if (from === 'html') {
          // Convert semantic block elements before stripping remaining tags
          const converted = content
            .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => '#'.repeat(Number(l)) + ' ' + this.stripHtml(t) + '\n')
            .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => '**' + this.stripHtml(t) + '**')
            .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => '_' + this.stripHtml(t) + '_')
            .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => '[' + this.stripHtml(t) + '](' + href + ')')
            .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => this.stripHtml(t) + '\n\n');
          return this.stripHtml(converted).trim();
        }
        return content;

      case 'html':
        if (from === 'markdown') {
          return content
            .replace(/^#{6}\s(.+)$/gm, '<h6>$1</h6>')
            .replace(/^#{5}\s(.+)$/gm, '<h5>$1</h5>')
            .replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>')
            .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
            .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
            .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
        }
        if (from === 'text' || from === 'plain') {
          return '<p>' + content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
        }
        return content;

      case 'json':
        return JSON.stringify({ content, type: from, length: content.length }, null, 2);

      default:
        return content;
    }
  }

  // ── Main Process Entry Point ──────────────────────────────────────────────────

  async process(content: string, options: ProcessorOptions = {}): Promise<ProcessedContent> {
    const o = { ...this.defaultOptions, ...options };
    const cacheKey = `mmp:${Buffer.from(content.slice(0, 200)).toString('base64')}:${o.outputFormat}`;

    if (o.cacheResults) {
      const cached = this.cache.get<ProcessedContent>(cacheKey);
      if (cached) return cached;
    }

    const start = Date.now();
    const id = generateId();
    const inputType = this.detectContentType(content);

    let textAnalysis: TextAnalysis | undefined;
    let codeAnalysis: CodeAnalysis | undefined;
    let structuredAnalysis: StructuredDataAnalysis | undefined;

    if (inputType === 'text' || inputType === 'markdown' || inputType === 'html') {
      textAnalysis = this.analyzeText(content, o);
    } else if (inputType === 'code') {
      codeAnalysis = this.analyzeCode(content);
    } else if (inputType === 'json' || inputType === 'structured') {
      structuredAnalysis = this.analyzeStructuredData(content);
    }

    const analysisForScoring = textAnalysis ?? codeAnalysis;
    const quality = this.scoreQuality(content, inputType, analysisForScoring);
    const summary = this.summarize(content, o.maxSummaryLength);
    const tags = this.generateTags(content, inputType, textAnalysis);
    const transformed = this.transform(content, inputType, o.outputFormat);

    const result: ProcessedContent = {
      id,
      inputType,
      outputFormat: o.outputFormat,
      original: content,
      transformed,
      summary,
      tags,
      quality,
      textAnalysis,
      codeAnalysis,
      structuredAnalysis,
      processingTimeMs: Date.now() - start,
      processedAt: new Date().toISOString(),
    };

    if (o.cacheResults) {
      this.cache.set(cacheKey, result, o.cacheTtlSeconds);
    }

    this.logger.info('MultiModalProcessor: processed content', {
      id,
      inputType,
      wordCount: textAnalysis?.wordCount,
      quality: quality.overall,
      processingTimeMs: result.processingTimeMs,
    });

    return result;
  }

  // ── Batch Processing ──────────────────────────────────────────────────────────

  async processBatch(
    items: Array<{ content: string; options?: ProcessorOptions }>,
    concurrency = 5,
  ): Promise<BatchProcessingResult> {
    const start = Date.now();
    const results: ProcessedContent[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let succeeded = 0;

    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map(item => this.process(item.content, item.options)),
      );
      settled.forEach((r, j) => {
        if (r.status === 'fulfilled') {
          results.push(r.value);
          succeeded++;
        } else {
          errors.push({ index: i + j, error: (r.reason as Error).message });
          this.logger.warn('MultiModalProcessor: batch item failed', { index: i + j, error: (r.reason as Error).message });
        }
      });
    }

    const batchResult: BatchProcessingResult = {
      total: items.length,
      succeeded,
      failed: errors.length,
      results,
      errors,
      totalTimeMs: Date.now() - start,
    };

    this.logger.info('MultiModalProcessor: batch complete', {
      total: batchResult.total,
      succeeded: batchResult.succeeded,
      failed: batchResult.failed,
      totalTimeMs: batchResult.totalTimeMs,
    });

    return batchResult;
  }

  // ── Content Enrichment Pipeline ───────────────────────────────────────────────

  async enrich(content: string, options: ProcessorOptions = {}): Promise<ProcessedContent> {
    const processed = await this.process(content, { ...options, enableEntityExtraction: true, enableSentiment: true });

    // Add enrichment tags based on entities
    if (processed.textAnalysis?.entities) {
      for (const entity of processed.textAnalysis.entities) {
        processed.tags.push({ tag: entity.text, category: `entity-${entity.type}`, weight: entity.confidence });
      }
    }

    // Boost quality score for enriched content
    processed.quality.richness = Math.min(100, processed.quality.richness + 10);
    processed.quality.overall = Math.round(
      (processed.quality.completeness + processed.quality.accuracy + processed.quality.clarity + processed.quality.richness) / 4,
    );

    return processed;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getMultiModalProcessor(): MultiModalProcessor {
  if (!globalThis.__multiModalProcessor__) {
    globalThis.__multiModalProcessor__ = new MultiModalProcessor();
  }
  return globalThis.__multiModalProcessor__ as MultiModalProcessor;
}
