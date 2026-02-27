/**
 * NLP Pipeline Engine
 *
 * Comprehensive natural language processing pipeline with tokenization,
 * entity extraction, sentiment analysis, topic modeling, text classification,
 * summarization, and semantic similarity computation.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface NLPDocument {
  id: string;
  content: string;
  language: string;
  tokens: Token[];
  sentences: Sentence[];
  entities: NamedEntity[];
  sentiment: SentimentResult;
  topics: Topic[];
  classifications: Classification[];
  summary?: string;
  keyPhrases: string[];
  embeddings?: number[];
  metadata: Record<string, unknown>;
  processedAt: number;
  processingTimeMs: number;
}

export interface Token {
  text: string;
  lemma: string;
  pos: PartOfSpeech;
  tag: string;
  isStop: boolean;
  isPunct: boolean;
  isAlpha: boolean;
  startChar: number;
  endChar: number;
  index: number;
  vector?: number[];
}

export type PartOfSpeech =
  | 'NOUN'
  | 'VERB'
  | 'ADJ'
  | 'ADV'
  | 'PRON'
  | 'DET'
  | 'PREP'
  | 'CONJ'
  | 'NUM'
  | 'PUNCT'
  | 'SYM'
  | 'X'
  | 'INTJ';

export interface Sentence {
  text: string;
  start: number;
  end: number;
  sentiment: number;
  tokens: string[];
}

export interface NamedEntity {
  text: string;
  label: EntityLabel;
  start: number;
  end: number;
  confidence: number;
  canonicalForm?: string;
  knowledgeBaseId?: string;
}

export type EntityLabel =
  | 'PERSON'
  | 'ORG'
  | 'GPE'
  | 'LOC'
  | 'DATE'
  | 'TIME'
  | 'MONEY'
  | 'PERCENT'
  | 'PRODUCT'
  | 'EVENT'
  | 'WORK_OF_ART'
  | 'LAW'
  | 'TECH';

export interface SentimentResult {
  label: 'positive' | 'negative' | 'neutral' | 'mixed';
  score: number;
  confidence: number;
  emotionalTones: EmotionalTone[];
  aspectSentiments: AspectSentiment[];
}

export interface EmotionalTone {
  emotion: 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'disgust' | 'trust' | 'anticipation';
  score: number;
}

export interface AspectSentiment {
  aspect: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  mentions: string[];
}

export interface Topic {
  id: string;
  label: string;
  score: number;
  keywords: string[];
  documents?: string[];
}

export interface Classification {
  label: string;
  score: number;
  confidence: number;
}

export interface NLPPipelineConfig {
  enableTokenization: boolean;
  enableSentenceSegmentation: boolean;
  enableNER: boolean;
  enableSentiment: boolean;
  enableTopicModeling: boolean;
  enableClassification: boolean;
  enableSummarization: boolean;
  enableKeyPhraseExtraction: boolean;
  enableEmbeddings: boolean;
  maxTokens: number;
  language: string;
  classificationLabels: string[];
  topicCount: number;
  summaryLength: 'short' | 'medium' | 'long';
}

export interface BatchProcessResult {
  documents: NLPDocument[];
  failedIds: string[];
  totalProcessed: number;
  avgProcessingTimeMs: number;
  batchTimeMs: number;
}

export interface SimilarityResult {
  documentA: string;
  documentB: string;
  cosineSimilarity: number;
  jaccardSimilarity: number;
  editDistance: number;
  semanticSimilarity: number;
}

export interface TextMetrics {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  readabilityScore: number;
  vocabularyRichness: number;
  avgWordLength: number;
  fleschKincaidGrade: number;
}

export class NLPPipelineEngine {
  private config: NLPPipelineConfig;
  private stopWords: Set<string>;
  private posPatterns: Map<string, PartOfSpeech>;
  private sentimentLexicon: Map<string, number>;
  private entityPatterns: Array<{ pattern: RegExp; label: EntityLabel }>;
  private documentStore = new Map<string, NLPDocument>();
  private topicModel: TopicModel;

  constructor(config?: Partial<NLPPipelineConfig>) {
    this.config = {
      enableTokenization: true,
      enableSentenceSegmentation: true,
      enableNER: true,
      enableSentiment: true,
      enableTopicModeling: true,
      enableClassification: true,
      enableSummarization: true,
      enableKeyPhraseExtraction: true,
      enableEmbeddings: true,
      maxTokens: 10000,
      language: 'en',
      classificationLabels: ['technology', 'business', 'science', 'politics', 'entertainment'],
      topicCount: 10,
      summaryLength: 'medium',
      ...config,
    };

    this.stopWords = this.buildStopWords();
    this.posPatterns = this.buildPOSPatterns();
    this.sentimentLexicon = this.buildSentimentLexicon();
    this.entityPatterns = this.buildEntityPatterns();
    this.topicModel = new TopicModel(this.config.topicCount);
  }

  process(
    id: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): NLPDocument {
    const start = Date.now();
    const truncated = content.slice(0, this.config.maxTokens * 6);

    const tokens = this.config.enableTokenization ? this.tokenize(truncated) : [];
    const sentences = this.config.enableSentenceSegmentation
      ? this.segmentSentences(truncated, tokens)
      : [];
    const entities = this.config.enableNER ? this.extractEntities(truncated, tokens) : [];
    const sentiment = this.config.enableSentiment ? this.analyzeSentiment(tokens, sentences) : this.neutralSentiment();
    const topics = this.config.enableTopicModeling ? this.extractTopics(tokens) : [];
    const classifications = this.config.enableClassification
      ? this.classify(tokens)
      : [];
    const keyPhrases = this.config.enableKeyPhraseExtraction ? this.extractKeyPhrases(tokens, entities) : [];
    const summary = this.config.enableSummarization ? this.summarize(sentences) : undefined;
    const embeddings = this.config.enableEmbeddings ? this.computeEmbeddings(tokens) : undefined;

    const doc: NLPDocument = {
      id,
      content: truncated,
      language: this.config.language,
      tokens,
      sentences,
      entities,
      sentiment,
      topics,
      classifications,
      summary,
      keyPhrases,
      embeddings,
      metadata,
      processedAt: start,
      processingTimeMs: Date.now() - start,
    };

    this.documentStore.set(id, doc);

    logger.debug('NLP document processed', {
      id,
      tokenCount: tokens.length,
      entityCount: entities.length,
      sentiment: sentiment.label,
      processingTimeMs: doc.processingTimeMs,
    });

    return doc;
  }

  processBatch(documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): BatchProcessResult {
    const start = Date.now();
    const results: NLPDocument[] = [];
    const failedIds: string[] = [];

    documents.forEach(doc => {
      try {
        results.push(this.process(doc.id, doc.content, doc.metadata));
      } catch (err) {
        failedIds.push(doc.id);
        logger.warn('NLP batch processing failed for document', { id: doc.id });
      }
    });

    return {
      documents: results,
      failedIds,
      totalProcessed: results.length,
      avgProcessingTimeMs:
        results.reduce((s, d) => s + d.processingTimeMs, 0) / Math.max(results.length, 1),
      batchTimeMs: Date.now() - start,
    };
  }

  computeSimilarity(idA: string, idB: string): SimilarityResult {
    const docA = this.documentStore.get(idA);
    const docB = this.documentStore.get(idB);

    if (!docA || !docB) throw new Error('Documents not found');

    const tokensA = new Set(docA.tokens.filter(t => !t.isStop).map(t => t.lemma));
    const tokensB = new Set(docB.tokens.filter(t => !t.isStop).map(t => t.lemma));

    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);
    const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;

    let cosineSimilarity = 0;
    if (docA.embeddings && docB.embeddings) {
      cosineSimilarity = this.cosineSim(docA.embeddings, docB.embeddings);
    } else {
      cosineSimilarity = jaccardSimilarity;
    }

    const editDistance = this.computeEditDistance(
      docA.content.slice(0, 100),
      docB.content.slice(0, 100)
    );

    return {
      documentA: idA,
      documentB: idB,
      cosineSimilarity,
      jaccardSimilarity,
      editDistance,
      semanticSimilarity: (cosineSimilarity * 0.7 + jaccardSimilarity * 0.3),
    };
  }

  computeTextMetrics(id: string): TextMetrics {
    const doc = this.documentStore.get(id);
    if (!doc) throw new Error(`Document ${id} not found`);

    const words = doc.tokens.filter(t => t.isAlpha && !t.isPunct);
    const sentences = doc.sentences;
    const uniqueWords = new Set(words.map(w => w.lemma.toLowerCase()));

    const avgWordsPerSentence = sentences.length > 0
      ? words.length / sentences.length
      : words.length;

    const avgWordLength = words.length > 0
      ? words.reduce((s, w) => s + w.text.length, 0) / words.length
      : 0;

    const syllables = words.reduce((s, w) => s + this.countSyllables(w.text), 0);
    const fleschKincaid = sentences.length > 0
      ? 0.39 * avgWordsPerSentence +
        11.8 * (syllables / Math.max(words.length, 1)) -
        15.59
      : 0;

    const readability = Math.max(0, Math.min(100, 100 - fleschKincaid * 4));

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      avgWordsPerSentence,
      readabilityScore: readability,
      vocabularyRichness: words.length > 0 ? uniqueWords.size / words.length : 0,
      avgWordLength,
      fleschKincaidGrade: Math.max(0, fleschKincaid),
    };
  }

  getDocument(id: string): NLPDocument | undefined {
    return this.documentStore.get(id);
  }

  searchByEntity(label: EntityLabel, text?: string): NLPDocument[] {
    return Array.from(this.documentStore.values()).filter(doc =>
      doc.entities.some(e => e.label === label && (!text || e.text.toLowerCase().includes(text.toLowerCase())))
    );
  }

  searchBySentiment(label: SentimentResult['label'], minConfidence = 0.5): NLPDocument[] {
    return Array.from(this.documentStore.values()).filter(
      doc => doc.sentiment.label === label && doc.sentiment.confidence >= minConfidence
    );
  }

  private tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const words = text.split(/(\s+|[.,!?;:'"()\[\]{}<>\/\\@#$%^&*\-_+=|~`])/);
    let charPos = 0;

    words.forEach((word, idx) => {
      if (word.trim() === '') {
        charPos += word.length;
        return;
      }

      const lemma = this.lemmatize(word.toLowerCase());
      const pos = this.getPOS(word, idx, words);
      const isStop = this.stopWords.has(word.toLowerCase());
      const isPunct = /^[^\w\s]+$/.test(word);
      const isAlpha = /^[a-zA-Z]+$/.test(word);

      tokens.push({
        text: word,
        lemma,
        pos,
        tag: pos,
        isStop,
        isPunct,
        isAlpha,
        startChar: charPos,
        endChar: charPos + word.length,
        index: tokens.length,
      });

      charPos += word.length;
    });

    return tokens.filter(t => t.text.trim() !== '');
  }

  private segmentSentences(text: string, tokens: Token[]): Sentence[] {
    const sentences: Sentence[] = [];
    const sentencePattern = /[^.!?]+[.!?]*/g;
    let match: RegExpExecArray | null;

    while ((match = sentencePattern.exec(text)) !== null) {
      const sentence = match[0].trim();
      if (sentence.length < 5) continue;

      const sentenceTokens = tokens
        .filter(t => t.startChar >= match!.index && t.endChar <= match!.index + match![0].length)
        .map(t => t.text);

      const sentimentScore = this.computeSentenceSentiment(sentenceTokens);

      sentences.push({
        text: sentence,
        start: match.index,
        end: match.index + match[0].length,
        sentiment: sentimentScore,
        tokens: sentenceTokens,
      });
    }

    return sentences;
  }

  private extractEntities(text: string, tokens: Token[]): NamedEntity[] {
    const entities: NamedEntity[] = [];

    this.entityPatterns.forEach(({ pattern, label }) => {
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, 'gi');
      while ((match = re.exec(text)) !== null) {
        entities.push({
          text: match[0],
          label,
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.8,
        });
      }
    });

    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    let match: RegExpExecArray | null;
    while ((match = capitalizedPattern.exec(text)) !== null) {
      if (!entities.some(e => e.start <= match!.index && e.end >= match!.index + match![0].length)) {
        entities.push({
          text: match[0],
          label: 'PERSON',
          start: match.index,
          end: match.index + match[0].length,
          confidence: 0.6,
        });
      }
    }

    return entities.sort((a, b) => a.start - b.start);
  }

  private analyzeSentiment(tokens: Token[], sentences: Sentence[]): SentimentResult {
    const scores = tokens
      .filter(t => !t.isStop && t.isAlpha)
      .map(t => this.sentimentLexicon.get(t.lemma.toLowerCase()) ?? 0);

    const avgScore = scores.length > 0
      ? scores.reduce((s, v) => s + v, 0) / scores.length
      : 0;

    const positive = scores.filter(s => s > 0).length;
    const negative = scores.filter(s => s < 0).length;
    const total = scores.length || 1;

    let label: SentimentResult['label'];
    if (avgScore > 0.1) label = 'positive';
    else if (avgScore < -0.1) label = 'negative';
    else if (positive > 0 && negative > 0) label = 'mixed';
    else label = 'neutral';

    const emotionalTones: EmotionalTone[] = [
      { emotion: 'joy', score: Math.max(0, avgScore) },
      { emotion: 'sadness', score: Math.max(0, -avgScore) },
      { emotion: 'anger', score: negative / total * 0.5 },
      { emotion: 'fear', score: 0 },
      { emotion: 'surprise', score: 0 },
      { emotion: 'disgust', score: negative / total * 0.3 },
      { emotion: 'trust', score: positive / total * 0.4 },
      { emotion: 'anticipation', score: positive / total * 0.3 },
    ];

    return {
      label,
      score: avgScore,
      confidence: Math.min(1, Math.abs(avgScore) * 2 + 0.3),
      emotionalTones,
      aspectSentiments: [],
    };
  }

  private extractTopics(tokens: Token[]): Topic[] {
    const contentTokens = tokens
      .filter(t => !t.isStop && t.isAlpha && t.text.length > 3)
      .map(t => t.lemma.toLowerCase());

    return this.topicModel.extract(contentTokens).slice(0, 5);
  }

  private classify(tokens: Token[]): Classification[] {
    const contentWords = new Set(
      tokens.filter(t => !t.isStop && t.isAlpha).map(t => t.lemma.toLowerCase())
    );

    const categoryKeywords: Record<string, string[]> = {
      technology: ['software', 'computer', 'data', 'algorithm', 'code', 'system', 'digital', 'tech', 'api', 'cloud'],
      business: ['company', 'market', 'revenue', 'profit', 'customer', 'strategy', 'enterprise', 'startup', 'investment'],
      science: ['research', 'study', 'experiment', 'theory', 'analysis', 'hypothesis', 'discovery', 'biology', 'physics'],
      politics: ['government', 'election', 'policy', 'law', 'senate', 'congress', 'president', 'vote', 'political'],
      entertainment: ['movie', 'music', 'sport', 'game', 'celebrity', 'film', 'art', 'culture', 'festival'],
    };

    return this.config.classificationLabels.map(label => {
      const keywords = categoryKeywords[label] ?? [];
      const matches = keywords.filter(k => contentWords.has(k)).length;
      const score = matches / Math.max(keywords.length, 1);
      return {
        label,
        score,
        confidence: Math.min(1, score * 2),
      };
    }).sort((a, b) => b.score - a.score);
  }

  private extractKeyPhrases(tokens: Token[], entities: NamedEntity[]): string[] {
    const phrases: string[] = [];

    entities.forEach(e => phrases.push(e.text));

    const nounPhrases: string[] = [];
    let currentPhrase: string[] = [];

    tokens.forEach(token => {
      if (token.pos === 'ADJ' || token.pos === 'NOUN') {
        currentPhrase.push(token.text);
      } else {
        if (currentPhrase.length >= 2) {
          nounPhrases.push(currentPhrase.join(' '));
        }
        currentPhrase = [];
      }
    });

    if (currentPhrase.length >= 2) {
      nounPhrases.push(currentPhrase.join(' '));
    }

    phrases.push(...nounPhrases);

    const unique = [...new Set(phrases)];
    return unique
      .filter(p => p.length > 3 && p.split(' ').length <= 5)
      .slice(0, 20);
  }

  private summarize(sentences: Sentence[]): string {
    if (sentences.length === 0) return '';

    const lengthMap: Record<NLPPipelineConfig['summaryLength'], number> = {
      short: 1,
      medium: 3,
      long: 5,
    };
    const targetSentences = lengthMap[this.config.summaryLength];

    const scored = sentences.map((s, i) => ({
      sentence: s,
      score: Math.abs(s.sentiment) * 0.3 + (1 / (i + 1)) * 0.3 + (s.tokens.length / 20) * 0.4,
      index: i,
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, targetSentences)
      .sort((a, b) => a.index - b.index)
      .map(s => s.sentence.text)
      .join(' ');
  }

  private computeEmbeddings(tokens: Token[]): number[] {
    const contentTokens = tokens.filter(t => !t.isStop && t.isAlpha);
    if (contentTokens.length === 0) return new Array(128).fill(0);

    const dims = 128;
    const embedding = new Array(dims).fill(0);

    contentTokens.forEach(token => {
      const hash = this.hashToken(token.lemma);
      for (let i = 0; i < dims; i++) {
        embedding[i] += Math.sin((hash + i) * 0.1) / contentTokens.length;
      }
    });

    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? embedding.map(v => v / norm) : embedding;
  }

  private lemmatize(word: string): string {
    const irregulars: Record<string, string> = {
      are: 'be', is: 'be', was: 'be', were: 'be',
      ran: 'run', runs: 'run', running: 'run',
      better: 'good', best: 'good',
      worse: 'bad', worst: 'bad',
    };
    if (irregulars[word]) return irregulars[word];
    if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
    if (word.endsWith('tion')) return word.slice(0, -4);
    if (word.endsWith('ness')) return word.slice(0, -4);
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
    return word;
  }

  private getPOS(word: string, idx: number, context: string[]): PartOfSpeech {
    if (/^[.,!?;:'"()\[\]{}<>\/\\]$/.test(word)) return 'PUNCT';
    if (/^\d+$/.test(word)) return 'NUM';
    if (this.posPatterns.has(word.toLowerCase())) return this.posPatterns.get(word.toLowerCase())!;
    if (word.endsWith('ly')) return 'ADV';
    if (word.endsWith('ing') || word.endsWith('ed')) return 'VERB';
    if (word.endsWith('tion') || word.endsWith('ness') || word.endsWith('ment')) return 'NOUN';
    if (word.endsWith('ful') || word.endsWith('ous') || word.endsWith('able')) return 'ADJ';
    return 'NOUN';
  }

  private computeSentenceSentiment(tokens: string[]): number {
    const scores = tokens.map(t => this.sentimentLexicon.get(t.toLowerCase()) ?? 0);
    return scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  }

  private cosineSim(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private computeEditDistance(a: string, b: string): number {
    const dp: number[][] = Array.from(
      { length: a.length + 1 },
      (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  private countSyllables(word: string): number {
    const matches = word.toLowerCase().match(/[aeiouy]+/g);
    return matches ? matches.length : 1;
  }

  private hashToken(text: string): number {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
    }
    return hash >>> 0;
  }

  private neutralSentiment(): SentimentResult {
    return {
      label: 'neutral',
      score: 0,
      confidence: 1,
      emotionalTones: [],
      aspectSentiments: [],
    };
  }

  private buildStopWords(): Set<string> {
    return new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these',
      'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'my',
      'your', 'his', 'her', 'our', 'their', 'not', 'no', 'nor', 'so', 'yet',
      'as', 'if', 'then', 'than', 'when', 'where', 'who', 'which', 'what',
    ]);
  }

  private buildPOSPatterns(): Map<string, PartOfSpeech> {
    const patterns = new Map<string, PartOfSpeech>();
    ['run', 'build', 'create', 'use', 'make', 'get', 'set', 'find', 'start', 'stop'].forEach(v => patterns.set(v, 'VERB'));
    ['the', 'a', 'an', 'this', 'that', 'these', 'those'].forEach(d => patterns.set(d, 'DET'));
    ['very', 'quite', 'really', 'not', 'never', 'always', 'often'].forEach(a => patterns.set(a, 'ADV'));
    ['and', 'or', 'but', 'nor', 'yet', 'so', 'for'].forEach(c => patterns.set(c, 'CONJ'));
    ['in', 'on', 'at', 'by', 'for', 'with', 'from', 'to', 'of', 'about'].forEach(p => patterns.set(p, 'PREP'));
    ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'].forEach(p => patterns.set(p, 'PRON'));
    return patterns;
  }

  private buildSentimentLexicon(): Map<string, number> {
    const lexicon = new Map<string, number>();
    const positive = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'best', 'beautiful', 'happy', 'joy', 'success', 'win', 'positive', 'awesome', 'brilliant', 'perfect', 'outstanding'];
    const negative = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'worst', 'ugly', 'sad', 'failure', 'lose', 'negative', 'poor', 'wrong', 'broken', 'failed', 'error', 'problem', 'issue', 'crisis'];
    positive.forEach(w => lexicon.set(w, 0.7 + Math.random() * 0.3));
    negative.forEach(w => lexicon.set(w, -(0.7 + Math.random() * 0.3)));
    return lexicon;
  }

  private buildEntityPatterns(): Array<{ pattern: RegExp; label: EntityLabel }> {
    return [
      { pattern: /\$[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion|trillion))?/i, label: 'MONEY' },
      { pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%/i, label: 'PERCENT' },
      { pattern: /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?/i, label: 'DATE' },
      { pattern: /\b\d{1,2}[:/]\d{2}(?:[:/]\d{2})?\s*(?:am|pm)?/i, label: 'TIME' },
      { pattern: /\b(?:Inc|Corp|Ltd|LLC|Co|Company|Technologies|Solutions|Systems|Group|Holdings)\b/i, label: 'ORG' },
    ];
  }
}

class TopicModel {
  private topicCount: number;
  private vocabulary = new Map<string, number>();
  private termFrequency = new Map<string, number>();

  constructor(topicCount: number) {
    this.topicCount = topicCount;
  }

  extract(tokens: string[]): Topic[] {
    tokens.forEach(t => {
      this.termFrequency.set(t, (this.termFrequency.get(t) ?? 0) + 1);
      if (!this.vocabulary.has(t)) {
        this.vocabulary.set(t, this.vocabulary.size);
      }
    });

    const tokenSet = new Set(tokens);
    const topTerms = Array.from(this.termFrequency.entries())
      .filter(([term]) => tokenSet.has(term))
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.topicCount * 5);

    const topics: Topic[] = [];
    const chunkSize = Math.ceil(topTerms.length / this.topicCount);

    for (let i = 0; i < this.topicCount && i * chunkSize < topTerms.length; i++) {
      const chunk = topTerms.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) continue;

      const keywords = chunk.map(([term]) => term);
      const score = chunk.reduce((s, [, freq]) => s + freq, 0) / tokens.length;

      topics.push({
        id: `topic-${i}`,
        label: keywords[0] ?? `topic-${i}`,
        score,
        keywords: keywords.slice(0, 5),
      });
    }

    return topics.sort((a, b) => b.score - a.score);
  }
}

let _nlpEngine: NLPPipelineEngine | null = null;

export function getNLPPipelineEngine(config?: Partial<NLPPipelineConfig>): NLPPipelineEngine {
  if (!_nlpEngine) {
    _nlpEngine = new NLPPipelineEngine(config);
  }
  return _nlpEngine;
}
