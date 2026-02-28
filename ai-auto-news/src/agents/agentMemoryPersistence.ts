/**
 * Agent Memory Persistence Layer
 *
 * Provides persistent storage for agent memories with:
 * - Vector embeddings for semantic search
 * - Short-term, long-term, and episodic memory types
 * - Automatic memory consolidation
 * - Memory decay and pruning
 * - Cross-agent memory sharing
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface Memory {
  id: string;
  agentId: string;
  type: 'short-term' | 'long-term' | 'episodic';
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  importance: number; // 0-1 scale
  accessCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  expiresAt?: Date;
  tags: string[];
}

export interface MemoryQuery {
  agentId?: string;
  type?: Memory['type'];
  query?: string;
  queryEmbedding?: number[];
  tags?: string[];
  minImportance?: number;
  limit?: number;
  includeExpired?: boolean;
}

export interface MemoryConsolidationResult {
  consolidated: number;
  promoted: number;
  pruned: number;
  totalMemories: number;
}

class AgentMemoryPersistence {
  private memories: Map<string, Memory> = new Map();
  private embeddingCache: Map<string, number[]> = new Map();
  private consolidationIntervalMs = 3600000; // 1 hour
  private consolidationTimer?: NodeJS.Timeout;

  constructor() {
    this.startConsolidation();
  }

  /**
   * Store a memory
   */
  async storeMemory(memory: Omit<Memory, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>): Promise<string> {
    const id = this.generateId();

    const fullMemory: Memory = {
      ...memory,
      id,
      accessCount: 0,
      lastAccessedAt: new Date(),
      createdAt: new Date(),
    };

    // Generate embedding if not provided
    if (!fullMemory.embedding && fullMemory.content) {
      fullMemory.embedding = await this.generateEmbedding(fullMemory.content);
    }

    this.memories.set(id, fullMemory);

    logger.debug('Memory stored', {
      id,
      agentId: memory.agentId,
      type: memory.type,
      importance: memory.importance,
    });

    return id;
  }

  /**
   * Retrieve memory by ID
   */
  async getMemory(id: string): Promise<Memory | null> {
    const memory = this.memories.get(id);

    if (!memory) return null;

    // Check expiration
    if (memory.expiresAt && new Date() > memory.expiresAt) {
      this.memories.delete(id);
      return null;
    }

    // Update access tracking
    memory.accessCount++;
    memory.lastAccessedAt = new Date();

    return memory;
  }

  /**
   * Search memories
   */
  async searchMemories(query: MemoryQuery): Promise<Memory[]> {
    let results = Array.from(this.memories.values());

    // Filter by agent
    if (query.agentId) {
      results = results.filter(m => m.agentId === query.agentId);
    }

    // Filter by type
    if (query.type) {
      results = results.filter(m => m.type === query.type);
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(m =>
        query.tags!.some(tag => m.tags.includes(tag))
      );
    }

    // Filter by importance
    if (query.minImportance !== undefined) {
      results = results.filter(m => m.importance >= query.minImportance!);
    }

    // Filter expired
    if (!query.includeExpired) {
      results = results.filter(m =>
        !m.expiresAt || new Date() <= m.expiresAt
      );
    }

    // Semantic search
    if (query.query || query.queryEmbedding) {
      const queryEmb = query.queryEmbedding ||
        await this.generateEmbedding(query.query!);

      // Calculate cosine similarity
      results = results
        .filter(m => m.embedding)
        .map(m => ({
          memory: m,
          similarity: this.cosineSimilarity(queryEmb, m.embedding!),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .map(r => r.memory);
    } else {
      // Sort by recency and importance
      results.sort((a, b) => {
        const scoreA = a.importance * 0.6 +
          (1 - this.getAgeDays(a.createdAt) / 365) * 0.4;
        const scoreB = b.importance * 0.6 +
          (1 - this.getAgeDays(b.createdAt) / 365) * 0.4;
        return scoreB - scoreA;
      });
    }

    // Limit results
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Update memory
   */
  async updateMemory(id: string, updates: Partial<Memory>): Promise<boolean> {
    const memory = this.memories.get(id);

    if (!memory) return false;

    // Update fields
    Object.assign(memory, updates);

    // Regenerate embedding if content changed
    if (updates.content) {
      memory.embedding = await this.generateEmbedding(updates.content);
    }

    logger.debug('Memory updated', { id, agentId: memory.agentId });

    return true;
  }

  /**
   * Delete memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    const deleted = this.memories.delete(id);

    if (deleted) {
      logger.debug('Memory deleted', { id });
    }

    return deleted;
  }

  /**
   * Get agent memories
   */
  async getAgentMemories(agentId: string, type?: Memory['type']): Promise<Memory[]> {
    return this.searchMemories({
      agentId,
      type,
      includeExpired: false,
    });
  }

  /**
   * Share memory across agents
   */
  async shareMemory(memoryId: string, targetAgentIds: string[]): Promise<string[]> {
    const sourceMemory = await this.getMemory(memoryId);

    if (!sourceMemory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    const sharedIds: string[] = [];

    for (const targetAgentId of targetAgentIds) {
      const sharedId = await this.storeMemory({
        agentId: targetAgentId,
        type: sourceMemory.type,
        content: sourceMemory.content,
        embedding: sourceMemory.embedding,
        metadata: {
          ...sourceMemory.metadata,
          sharedFrom: sourceMemory.agentId,
          originalMemoryId: memoryId,
        },
        importance: sourceMemory.importance * 0.8, // Slightly reduce importance for shared memories
        tags: [...sourceMemory.tags, 'shared'],
      });

      sharedIds.push(sharedId);
    }

    logger.info('Memory shared', {
      sourceMemoryId: memoryId,
      targetAgents: targetAgentIds,
      sharedCount: sharedIds.length,
    });

    return sharedIds;
  }

  /**
   * Consolidate memories
   */
  async consolidateMemories(agentId?: string): Promise<MemoryConsolidationResult> {
    let consolidated = 0;
    let promoted = 0;
    let pruned = 0;

    const memories = agentId
      ? await this.getAgentMemories(agentId)
      : Array.from(this.memories.values());

    // Group short-term memories by similarity
    const shortTermMemories = memories.filter(m => m.type === 'short-term');
    const clusters = this.clusterMemories(shortTermMemories);

    for (const cluster of clusters) {
      if (cluster.length >= 3) {
        // Consolidate into long-term memory
        const consolidatedMemory = await this.createConsolidatedMemory(cluster);
        await this.storeMemory(consolidatedMemory);

        // Remove original short-term memories
        for (const memory of cluster) {
          await this.deleteMemory(memory.id);
          pruned++;
        }

        consolidated++;
      }
    }

    // Promote frequently accessed short-term to long-term
    for (const memory of shortTermMemories) {
      if (memory.accessCount >= 5 && memory.importance >= 0.7) {
        await this.updateMemory(memory.id, { type: 'long-term' });
        promoted++;
      }
    }

    // Prune low-importance old memories
    const oldMemories = memories.filter(m =>
      m.importance < 0.3 &&
      this.getAgeDays(m.createdAt) > 30 &&
      m.accessCount < 2
    );

    for (const memory of oldMemories) {
      await this.deleteMemory(memory.id);
      pruned++;
    }

    logger.info('Memory consolidation complete', {
      agentId,
      consolidated,
      promoted,
      pruned,
      totalMemories: this.memories.size,
    });

    return {
      consolidated,
      promoted,
      pruned,
      totalMemories: this.memories.size,
    };
  }

  /**
   * Get memory statistics
   */
  getStatistics(agentId?: string): MemoryStatistics {
    let memories = Array.from(this.memories.values());

    if (agentId) {
      memories = memories.filter(m => m.agentId === agentId);
    }

    const byType = {
      'short-term': memories.filter(m => m.type === 'short-term').length,
      'long-term': memories.filter(m => m.type === 'long-term').length,
      episodic: memories.filter(m => m.type === 'episodic').length,
    };

    const totalImportance = memories.reduce((sum, m) => sum + m.importance, 0);
    const avgImportance = memories.length > 0 ? totalImportance / memories.length : 0;

    const totalAccesses = memories.reduce((sum, m) => sum + m.accessCount, 0);

    return {
      totalMemories: memories.length,
      byType,
      averageImportance: avgImportance,
      totalAccesses,
      oldestMemory: memories.length > 0
        ? new Date(Math.min(...memories.map(m => m.createdAt.getTime())))
        : null,
      newestMemory: memories.length > 0
        ? new Date(Math.max(...memories.map(m => m.createdAt.getTime())))
        : null,
    };
  }

  /**
   * Start automatic consolidation
   */
  private startConsolidation(): void {
    this.consolidationTimer = setInterval(async () => {
      try {
        await this.consolidateMemories();
      } catch (error) {
        logger.error('Memory consolidation failed', error instanceof Error ? error : undefined);
      }
    }, this.consolidationIntervalMs);
  }

  /**
   * Stop automatic consolidation
   */
  stopConsolidation(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = undefined;
    }
  }

  /**
   * Generate embedding for text (simplified mock)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Check cache
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text)!;
    }

    // In production, this would call an embedding API (OpenAI, Cohere, etc.)
    // For now, generate a simple hash-based embedding
    const embedding = this.simpleEmbedding(text);

    this.embeddingCache.set(text, embedding);

    // Limit cache size
    if (this.embeddingCache.size > 10000) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }

    return embedding;
  }

  /**
   * Simple embedding generation (mock)
   */
  private simpleEmbedding(text: string): number[] {
    const dims = 384; // Common embedding dimension
    const embedding = new Array(dims).fill(0);

    // Simple character-based hashing
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % dims;
      embedding[index] += 1;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / (magnitude || 1));
  }

  /**
   * Calculate cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 0;

    return dotProduct / (magA * magB);
  }

  /**
   * Cluster memories by similarity
   */
  private clusterMemories(memories: Memory[], threshold = 0.8): Memory[][] {
    const clusters: Memory[][] = [];
    const assigned = new Set<string>();

    for (const memory of memories) {
      if (assigned.has(memory.id) || !memory.embedding) continue;

      const cluster: Memory[] = [memory];
      assigned.add(memory.id);

      for (const other of memories) {
        if (assigned.has(other.id) || !other.embedding) continue;

        const similarity = this.cosineSimilarity(memory.embedding, other.embedding);

        if (similarity >= threshold) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Create consolidated memory from cluster
   */
  private async createConsolidatedMemory(
    cluster: Memory[]
  ): Promise<Omit<Memory, 'id' | 'accessCount' | 'lastAccessedAt' | 'createdAt'>> {
    const agentId = cluster[0].agentId;

    // Combine content
    const contents = cluster.map(m => m.content).join(' ');

    // Average importance
    const avgImportance = cluster.reduce((sum, m) => sum + m.importance, 0) / cluster.length;

    // Combine tags
    const allTags = new Set<string>();
    cluster.forEach(m => m.tags.forEach(tag => allTags.add(tag)));

    // Combine metadata
    const combinedMetadata = {
      consolidatedFrom: cluster.map(m => m.id),
      consolidatedAt: new Date().toISOString(),
      clusterSize: cluster.length,
    };

    return {
      agentId,
      type: 'long-term',
      content: `Consolidated memory: ${contents.substring(0, 1000)}`,
      importance: Math.min(avgImportance * 1.2, 1), // Boost importance slightly
      metadata: combinedMetadata,
      tags: Array.from(allTags).concat(['consolidated']),
    };
  }

  /**
   * Get age of memory in days
   */
  private getAgeDays(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface MemoryStatistics {
  totalMemories: number;
  byType: Record<string, number>;
  averageImportance: number;
  totalAccesses: number;
  oldestMemory: Date | null;
  newestMemory: Date | null;
}

// Singleton
let memoryPersistence: AgentMemoryPersistence;

export function getAgentMemoryPersistence(): AgentMemoryPersistence {
  if (!memoryPersistence) {
    memoryPersistence = new AgentMemoryPersistence();
  }
  return memoryPersistence;
}

export { AgentMemoryPersistence };
