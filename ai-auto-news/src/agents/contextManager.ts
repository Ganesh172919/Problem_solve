/**
 * Advanced Context Management System
 *
 * Manages short-term, long-term, and working memory for AI agents.
 * Implements intelligent context compression, retrieval, and persistence.
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';

const logger = getLogger();

export interface ContextWindow {
  id: string;
  agentId: string;
  sessionId: string;
  maxTokens: number;
  currentTokens: number;
  items: ContextItem[];
  compressionLevel: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface ContextItem {
  id: string;
  type: 'conversation' | 'document' | 'code' | 'knowledge' | 'memory';
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  importance: number;
  accessCount: number;
  tokens: number;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt?: Date;
}

export interface MemoryStore {
  shortTerm: Map<string, ContextItem[]>; // Recent conversations and actions
  workingMemory: Map<string, ContextItem[]>; // Current task context
  longTerm: Map<string, ContextItem[]>; // Persistent knowledge
  episodic: EpisodicMemory[]; // Past experiences
}

export interface EpisodicMemory {
  id: string;
  sessionId: string;
  scenario: string;
  actions: string[];
  outcome: string;
  success: boolean;
  lessons: string[];
  timestamp: Date;
}

export interface RetrievalQuery {
  query: string;
  embedding?: number[];
  filters?: {
    type?: string[];
    minImportance?: number;
    timeRange?: { start: Date; end: Date };
    tags?: string[];
  };
  limit?: number;
  includeRelated?: boolean;
}

export interface RetrievalResult {
  items: ContextItem[];
  totalTokens: number;
  relevanceScores: Map<string, number>;
  compressionApplied: boolean;
}

export interface CompressionStrategy {
  name: string;
  targetReduction: number; // 0-1, percentage to reduce
  preserveImportant: boolean;
  preserveRecent: boolean;
  summarization: boolean;
  chunking: boolean;
}

class AdvancedContextManager {
  private windows: Map<string, ContextWindow> = new Map();
  private memoryStore: MemoryStore;
  private cache = getCache();
  private compressionStrategies: Map<string, CompressionStrategy> = new Map();

  constructor() {
    this.memoryStore = {
      shortTerm: new Map(),
      workingMemory: new Map(),
      longTerm: new Map(),
      episodic: [],
    };

    this.initializeCompressionStrategies();
  }

  /**
   * Create new context window for agent session
   */
  async createWindow(
    agentId: string,
    sessionId: string,
    maxTokens: number = 100000
  ): Promise<ContextWindow> {
    const window: ContextWindow = {
      id: `window_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      agentId,
      sessionId,
      maxTokens,
      currentTokens: 0,
      items: [],
      compressionLevel: 0,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.windows.set(window.id, window);

    logger.info('Context window created', {
      windowId: window.id,
      agentId,
      sessionId,
      maxTokens,
    });

    return window;
  }

  /**
   * Add item to context window
   */
  async addToContext(
    windowId: string,
    item: Omit<ContextItem, 'id' | 'accessCount' | 'createdAt' | 'lastAccessedAt'>
  ): Promise<void> {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }

    const contextItem: ContextItem = {
      ...item,
      id: `item_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      accessCount: 0,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    // Check if we need to compress
    if (window.currentTokens + item.tokens > window.maxTokens) {
      await this.compressWindow(window);
    }

    window.items.push(contextItem);
    window.currentTokens += item.tokens;
    window.lastAccessedAt = new Date();

    // Store in appropriate memory tier
    await this.storeInMemory(contextItem, window.sessionId);

    logger.debug('Item added to context', {
      windowId,
      itemId: contextItem.id,
      tokens: item.tokens,
      currentTokens: window.currentTokens,
    });
  }

  /**
   * Retrieve relevant context based on query
   */
  async retrieve(windowId: string, query: RetrievalQuery): Promise<RetrievalResult> {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Context window not found: ${windowId}`);
    }

    // Filter items based on query
    const candidates = window.items.filter(item => {
      if (query.filters?.type && !query.filters.type.includes(item.type)) {
        return false;
      }

      if (query.filters?.minImportance && item.importance < query.filters.minImportance) {
        return false;
      }

      if (query.filters?.timeRange) {
        if (
          item.createdAt < query.filters.timeRange.start ||
          item.createdAt > query.filters.timeRange.end
        ) {
          return false;
        }
      }

      if (query.filters?.tags) {
        const itemTags = item.metadata.tags || [];
        if (!query.filters.tags.some(tag => itemTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });

    // Calculate relevance scores
    const relevanceScores = new Map<string, number>();

    for (const item of candidates) {
      const score = this.calculateRelevance(item, query);
      relevanceScores.set(item.id, score);
    }

    // Sort by relevance
    candidates.sort((a, b) => {
      const scoreA = relevanceScores.get(a.id) || 0;
      const scoreB = relevanceScores.get(b.id) || 0;
      return scoreB - scoreA;
    });

    // Apply limit
    const limit = query.limit || 10;
    const selected = candidates.slice(0, limit);

    // Include related items if requested
    if (query.includeRelated) {
      const related = await this.findRelatedItems(selected, window);
      selected.push(...related);
    }

    // Update access counts
    for (const item of selected) {
      item.accessCount++;
      item.lastAccessedAt = new Date();
    }

    const totalTokens = selected.reduce((sum, item) => sum + item.tokens, 0);
    const compressionApplied = window.compressionLevel > 0;

    return {
      items: selected,
      totalTokens,
      relevanceScores,
      compressionApplied,
    };
  }

  /**
   * Compress context window to free up space
   */
  private async compressWindow(window: ContextWindow): Promise<void> {
    logger.info('Compressing context window', {
      windowId: window.id,
      currentTokens: window.currentTokens,
      maxTokens: window.maxTokens,
    });

    const strategy = this.selectCompressionStrategy(window);

    // Phase 1: Remove expired items
    window.items = window.items.filter(item => {
      if (item.expiresAt && item.expiresAt < new Date()) {
        window.currentTokens -= item.tokens;
        return false;
      }
      return true;
    });

    // Phase 2: Remove low-importance items
    if (strategy.preserveImportant) {
      const threshold = this.calculateImportanceThreshold(window.items);
      const toRemove = window.items.filter(item => item.importance < threshold);

      for (const item of toRemove) {
        window.currentTokens -= item.tokens;
      }

      window.items = window.items.filter(item => item.importance >= threshold);
    }

    // Phase 3: Summarize old items
    if (strategy.summarization) {
      const oldItems = window.items
        .filter(item => {
          const age = Date.now() - item.createdAt.getTime();
          return age > 3600000; // Older than 1 hour
        })
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      if (oldItems.length > 5) {
        const summary = await this.summarizeItems(oldItems.slice(0, oldItems.length - 5));

        // Remove old items
        for (const item of oldItems.slice(0, oldItems.length - 5)) {
          window.currentTokens -= item.tokens;
          window.items = window.items.filter(i => i.id !== item.id);
        }

        // Add summary
        window.items.push({
          id: `summary_${Date.now()}`,
          type: 'knowledge',
          content: summary.content,
          metadata: { isSummary: true, originalCount: oldItems.length - 5 },
          importance: 0.7,
          accessCount: 0,
          tokens: summary.tokens,
          createdAt: new Date(),
          lastAccessedAt: new Date(),
        });

        window.currentTokens += summary.tokens;
      }
    }

    // Phase 4: Chunk large items
    if (strategy.chunking) {
      const largeItems = window.items.filter(item => item.tokens > 5000);

      for (const item of largeItems) {
        const chunks = this.chunkContent(item.content, 2000);

        // Remove original
        window.currentTokens -= item.tokens;
        window.items = window.items.filter(i => i.id !== item.id);

        // Add most important chunk
        const mostImportant = chunks[0]; // Simplified
        window.items.push({
          ...item,
          id: `${item.id}_chunk_0`,
          content: mostImportant,
          tokens: this.estimateTokens(mostImportant),
          metadata: { ...item.metadata, isChunk: true, chunkIndex: 0 },
        });

        window.currentTokens += this.estimateTokens(mostImportant);
      }
    }

    window.compressionLevel++;

    logger.info('Context window compressed', {
      windowId: window.id,
      newTokens: window.currentTokens,
      compressionLevel: window.compressionLevel,
    });
  }

  /**
   * Store item in appropriate memory tier
   */
  private async storeInMemory(item: ContextItem, sessionId: string): Promise<void> {
    // Short-term: Recent items
    if (!this.memoryStore.shortTerm.has(sessionId)) {
      this.memoryStore.shortTerm.set(sessionId, []);
    }
    this.memoryStore.shortTerm.get(sessionId)!.push(item);

    // Limit short-term memory size
    const shortTerm = this.memoryStore.shortTerm.get(sessionId)!;
    if (shortTerm.length > 100) {
      this.memoryStore.shortTerm.set(sessionId, shortTerm.slice(-100));
    }

    // Long-term: Important items
    if (item.importance > 0.7) {
      const key = `${sessionId}_important`;
      if (!this.memoryStore.longTerm.has(key)) {
        this.memoryStore.longTerm.set(key, []);
      }
      this.memoryStore.longTerm.get(key)!.push(item);
    }

    // Cache frequently accessed items
    if (item.accessCount > 5) {
      await this.cache.set(`context_${item.id}`, item, 3600);
    }
  }

  /**
   * Calculate relevance score for item
   */
  private calculateRelevance(item: ContextItem, query: RetrievalQuery): number {
    let score = 0;

    // Text similarity (simplified - in production use embeddings)
    const queryLower = query.query.toLowerCase();
    const contentLower = item.content.toLowerCase();

    if (contentLower.includes(queryLower)) {
      score += 0.5;
    }

    const queryWords = queryLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => contentLower.includes(word)).length;
    score += (matchingWords / queryWords.length) * 0.3;

    // Importance factor
    score += item.importance * 0.2;

    // Recency factor
    const age = Date.now() - item.lastAccessedAt.getTime();
    const recencyScore = Math.max(0, 1 - age / (7 * 24 * 3600000)); // Decay over 7 days
    score += recencyScore * 0.1;

    // Access frequency factor
    score += Math.min(item.accessCount / 10, 1) * 0.1;

    return Math.min(score, 1);
  }

  /**
   * Find related context items
   */
  private async findRelatedItems(
    items: ContextItem[],
    window: ContextWindow
  ): Promise<ContextItem[]> {
    const related: ContextItem[] = [];
    const addedIds = new Set(items.map(i => i.id));

    for (const item of items) {
      // Find items with similar metadata
      const candidates = window.items.filter(candidate => {
        if (addedIds.has(candidate.id)) return false;

        // Check metadata overlap
        const itemTags = item.metadata.tags || [];
        const candidateTags = candidate.metadata.tags || [];

        const overlap = itemTags.filter((tag: string) => candidateTags.includes(tag)).length;
        return overlap > 0;
      });

      related.push(...candidates.slice(0, 2)); // Limit related items
      candidates.slice(0, 2).forEach(c => addedIds.add(c.id));
    }

    return related;
  }

  /**
   * Select compression strategy based on window state
   */
  private selectCompressionStrategy(window: ContextWindow): CompressionStrategy {
    const utilizationRatio = window.currentTokens / window.maxTokens;

    if (utilizationRatio > 1.5) {
      return this.compressionStrategies.get('aggressive')!;
    } else if (utilizationRatio > 1.2) {
      return this.compressionStrategies.get('moderate')!;
    } else {
      return this.compressionStrategies.get('gentle')!;
    }
  }

  /**
   * Calculate importance threshold for filtering
   */
  private calculateImportanceThreshold(items: ContextItem[]): number {
    if (items.length === 0) return 0;

    const sorted = items.map(i => i.importance).sort((a, b) => b - a);
    const medianIndex = Math.floor(sorted.length / 2);

    return sorted[medianIndex] * 0.8; // 80% of median
  }

  /**
   * Summarize multiple items into one
   */
  private async summarizeItems(
    items: ContextItem[]
  ): Promise<{ content: string; tokens: number }> {
    // In production, use LLM for summarization
    const content = `Summary of ${items.length} items: ${items
      .map(i => i.content.substring(0, 100))
      .join('; ')}`;

    return {
      content,
      tokens: this.estimateTokens(content),
    };
  }

  /**
   * Chunk large content into smaller pieces
   */
  private chunkContent(content: string, maxTokens: number): string[] {
    const chunks: string[] = [];
    const words = content.split(/\s+/);

    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = Math.ceil(word.length / 4); // Rough estimate

      if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentTokens = 0;
      }

      currentChunk.push(word);
      currentTokens += wordTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }

    return chunks;
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Initialize compression strategies
   */
  private initializeCompressionStrategies() {
    this.compressionStrategies.set('gentle', {
      name: 'gentle',
      targetReduction: 0.2,
      preserveImportant: true,
      preserveRecent: true,
      summarization: false,
      chunking: false,
    });

    this.compressionStrategies.set('moderate', {
      name: 'moderate',
      targetReduction: 0.4,
      preserveImportant: true,
      preserveRecent: true,
      summarization: true,
      chunking: false,
    });

    this.compressionStrategies.set('aggressive', {
      name: 'aggressive',
      targetReduction: 0.6,
      preserveImportant: true,
      preserveRecent: false,
      summarization: true,
      chunking: true,
    });
  }

  /**
   * Store episodic memory
   */
  async storeEpisode(episode: Omit<EpisodicMemory, 'id' | 'timestamp'>): Promise<void> {
    const memory: EpisodicMemory = {
      ...episode,
      id: `episode_${Date.now()}`,
      timestamp: new Date(),
    };

    this.memoryStore.episodic.push(memory);

    // Limit episodic memory size
    if (this.memoryStore.episodic.length > 1000) {
      this.memoryStore.episodic = this.memoryStore.episodic.slice(-1000);
    }

    logger.info('Episodic memory stored', {
      episodeId: memory.id,
      scenario: memory.scenario,
      success: memory.success,
    });
  }

  /**
   * Retrieve similar past episodes
   */
  async retrieveEpisodes(scenario: string, limit: number = 5): Promise<EpisodicMemory[]> {
    const scored = this.memoryStore.episodic.map(episode => {
      const similarity = this.calculateSimilarity(scenario, episode.scenario);
      return { episode, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map(s => s.episode);
  }

  /**
   * Calculate text similarity (simplified)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);

    const intersection = words1.filter(word => words2.includes(word)).length;
    const union = new Set([...words1, ...words2]).size;

    return intersection / union;
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    windows: number;
    shortTermSize: number;
    longTermSize: number;
    episodicSize: number;
    totalTokens: number;
  } {
    let totalTokens = 0;

    for (const window of this.windows.values()) {
      totalTokens += window.currentTokens;
    }

    return {
      windows: this.windows.size,
      shortTermSize: Array.from(this.memoryStore.shortTerm.values()).reduce(
        (sum, items) => sum + items.length,
        0
      ),
      longTermSize: Array.from(this.memoryStore.longTerm.values()).reduce(
        (sum, items) => sum + items.length,
        0
      ),
      episodicSize: this.memoryStore.episodic.length,
      totalTokens,
    };
  }
}

// Singleton
let contextManager: AdvancedContextManager;

export function getContextManager(): AdvancedContextManager {
  if (!contextManager) {
    contextManager = new AdvancedContextManager();
  }
  return contextManager;
}
