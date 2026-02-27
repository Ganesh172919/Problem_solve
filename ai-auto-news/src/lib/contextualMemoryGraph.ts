/**
 * @module contextualMemoryGraph
 * @description Contextual memory graph for persistent AI agent memory management
 * implementing episodic, semantic, and procedural memory types, associative recall
 * with cosine-similarity search, memory consolidation and forgetting curves (Ebbinghaus),
 * importance-weighted retention, context window compression for LLM conversations,
 * temporal decay, working memory management, memory palaces for structured retrieval,
 * cross-session context persistence, and contradiction detection with conflict resolution.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'working' | 'flashbulb' | 'prospective';
export type MemoryStatus = 'active' | 'consolidated' | 'fading' | 'archived' | 'forgotten';
export type RecallStrategy = 'similarity' | 'temporal' | 'importance' | 'associative' | 'contextual' | 'random_walk';
export type ConsolidationTrigger = 'sleep' | 'review' | 'rehearsal' | 'spaced_repetition' | 'emotional_significance';

export interface MemoryNode {
  nodeId: string;
  agentId: string;
  sessionId: string;
  memoryType: MemoryType;
  content: string;
  embedding: number[];        // semantic vector representation
  importance: number;         // 0-1
  emotionalValence: number;   // -1 to 1 (negative to positive)
  retrievalCount: number;
  lastRetrievedAt?: number;
  createdAt: number;
  consolidatedAt?: number;
  strength: number;           // memory strength 0-1 (decays over time)
  status: MemoryStatus;
  associations: string[];     // connected nodeIds
  tags: string[];
  source: string;             // origin of the memory
  metadata: Record<string, unknown>;
}

export interface MemoryEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: 'causes' | 'follows' | 'similar_to' | 'contradicts' | 'part_of' | 'used_by' | 'reminds_of';
  strength: number;
  createdAt: number;
  activationCount: number;
}

export interface ConversationContext {
  contextId: string;
  agentId: string;
  sessionId: string;
  messages: ContextMessage[];
  activeMemoryIds: string[];
  workingMemoryIds: string[];
  tokenCount: number;
  maxTokens: number;
  compressionRatio?: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface ContextMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokenCount: number;
  importance: number;
  timestamp: number;
  memoryIds: string[];    // memories recalled/created during this turn
}

export interface RecallResult {
  memories: MemoryNode[];
  scores: Record<string, number>;
  strategy: RecallStrategy;
  elapsedMs: number;
  totalSearched: number;
}

export interface Contradiction {
  contradictionId: string;
  nodeIdA: string;
  nodeIdB: string;
  reason: string;
  confidence: number;
  resolvedAt?: number;
  resolution?: string;
  detectedAt: number;
}

export interface MemoryConsolidationResult {
  agentId: string;
  nodesProcessed: number;
  nodesForgotten: number;
  nodesConsolidated: number;
  nodesStrengthened: number;
  newAssociations: number;
  contradictionsFound: number;
  trigger: ConsolidationTrigger;
  completedAt: number;
}

export interface MemoryPalace {
  palaceId: string;
  agentId: string;
  name: string;
  rooms: Record<string, string[]>;   // room -> array of nodeIds
  navigationPath: string[];          // ordered room names for retrieval
  createdAt: number;
}

export interface ContextualMemoryConfig {
  maxWorkingMemoryNodes?: number;
  forgettingCurveDecayRate?: number;    // per hour
  consolidationThreshold?: number;      // strength below this triggers consolidation
  similarityThreshold?: number;         // minimum cosine sim for association
  maxAssociationsPerNode?: number;
  embeddingDimension?: number;
  maxContextTokens?: number;
}

// ── Cosine Similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Ebbinghaus Forgetting Curve ───────────────────────────────────────────────

function computeRetention(strength: number, hoursSinceCreation: number, importance: number, retrievalCount: number, decayRate: number): number {
  const R = Math.exp(-decayRate * hoursSinceCreation / (retrievalCount + 1));
  return Math.min(1, (strength * 0.5 + importance * 0.3 + R * 0.2));
}

// ── Simple Embedding Generator ────────────────────────────────────────────────

function generateEmbedding(text: string, dim: number): number[] {
  const vec: number[] = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[i % dim]! += Math.sin(code * (i + 1) * 0.01);
    vec[(i * 3) % dim]! += Math.cos(code * 0.07);
  }
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return magnitude > 0 ? vec.map(v => v / magnitude) : vec;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class ContextualMemoryGraph {
  private nodes = new Map<string, MemoryNode>();
  private edges = new Map<string, MemoryEdge>();
  private contexts = new Map<string, ConversationContext>();
  private palaces = new Map<string, MemoryPalace>();
  private contradictions = new Map<string, Contradiction>();
  private agentMemoryIndex = new Map<string, Set<string>>();  // agentId -> nodeIds
  private config: Required<ContextualMemoryConfig>;

  constructor(config: ContextualMemoryConfig = {}) {
    this.config = {
      maxWorkingMemoryNodes: config.maxWorkingMemoryNodes ?? 10,
      forgettingCurveDecayRate: config.forgettingCurveDecayRate ?? 0.05,
      consolidationThreshold: config.consolidationThreshold ?? 0.3,
      similarityThreshold: config.similarityThreshold ?? 0.75,
      maxAssociationsPerNode: config.maxAssociationsPerNode ?? 20,
      embeddingDimension: config.embeddingDimension ?? 128,
      maxContextTokens: config.maxContextTokens ?? 4096,
    };
  }

  // ── Memory Storage ────────────────────────────────────────────────────────

  store(params: Omit<MemoryNode, 'nodeId' | 'embedding' | 'retrievalCount' | 'strength' | 'status' | 'associations' | 'createdAt'>): MemoryNode {
    const embedding = generateEmbedding(params.content, this.config.embeddingDimension);

    const node: MemoryNode = {
      ...params,
      nodeId: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      embedding,
      retrievalCount: 0,
      strength: params.importance,
      status: 'active',
      associations: [],
      createdAt: Date.now(),
    };

    this.nodes.set(node.nodeId, node);

    // Index by agent
    if (!this.agentMemoryIndex.has(params.agentId)) {
      this.agentMemoryIndex.set(params.agentId, new Set());
    }
    this.agentMemoryIndex.get(params.agentId)!.add(node.nodeId);

    // Auto-discover associations
    this.discoverAssociations(node);

    // Check for contradictions
    this.detectContradictions(node);

    logger.info('Memory stored', { nodeId: node.nodeId, agentId: node.agentId, memoryType: node.memoryType, importance: node.importance });
    return node;
  }

  // ── Recall ────────────────────────────────────────────────────────────────

  recall(agentId: string, query: string, strategy: RecallStrategy = 'similarity', limit = 10): RecallResult {
    const start = Date.now();
    const agentNodeIds = this.agentMemoryIndex.get(agentId) ?? new Set<string>();
    const agentNodes = Array.from(agentNodeIds)
      .map(id => this.nodes.get(id))
      .filter((n): n is MemoryNode => n !== undefined && n.status !== 'forgotten');

    const queryEmbedding = generateEmbedding(query, this.config.embeddingDimension);
    const scores: Record<string, number> = {};

    for (const node of agentNodes) {
      let score = 0;

      switch (strategy) {
        case 'similarity':
          score = cosineSimilarity(queryEmbedding, node.embedding);
          break;
        case 'importance':
          score = node.importance * node.strength;
          break;
        case 'temporal':
          score = 1 / (1 + (Date.now() - node.createdAt) / 3_600_000);
          break;
        case 'associative': {
          const querySim = cosineSimilarity(queryEmbedding, node.embedding);
          const assocBonus = node.associations.length * 0.05;
          score = querySim + assocBonus;
          break;
        }
        case 'contextual': {
          const simScore = cosineSimilarity(queryEmbedding, node.embedding);
          const recencyScore = 1 / (1 + (Date.now() - (node.lastRetrievedAt ?? node.createdAt)) / 3_600_000);
          score = simScore * 0.6 + node.importance * 0.2 + recencyScore * 0.2;
          break;
        }
        case 'random_walk': {
          const baseSim = cosineSimilarity(queryEmbedding, node.embedding);
          score = baseSim + Math.random() * 0.1;  // exploration bonus
          break;
        }
      }

      scores[node.nodeId] = score;
    }

    const retrieved = agentNodes
      .sort((a, b) => (scores[b.nodeId] ?? 0) - (scores[a.nodeId] ?? 0))
      .slice(0, limit);

    // Update retrieval stats
    for (const node of retrieved) {
      node.retrievalCount++;
      node.lastRetrievedAt = Date.now();
      node.strength = Math.min(1, node.strength + 0.05);  // retrieval strengthens memory
    }

    return {
      memories: retrieved,
      scores,
      strategy,
      elapsedMs: Date.now() - start,
      totalSearched: agentNodes.length,
    };
  }

  // ── Working Memory ────────────────────────────────────────────────────────

  updateWorkingMemory(contextId: string, newMemoryIds: string[]): void {
    const context = this.contexts.get(contextId);
    if (!context) throw new Error(`Context ${contextId} not found`);

    // Add new memories
    for (const id of newMemoryIds) {
      if (!context.workingMemoryIds.includes(id)) {
        context.workingMemoryIds.push(id);
      }
    }

    // Evict least important when over capacity
    while (context.workingMemoryIds.length > this.config.maxWorkingMemoryNodes) {
      const evictId = context.workingMemoryIds.reduce((worst, id) => {
        const w = this.nodes.get(worst);
        const c = this.nodes.get(id);
        return (w?.importance ?? 1) > (c?.importance ?? 1) ? id : worst;
      });
      context.workingMemoryIds = context.workingMemoryIds.filter(id => id !== evictId);
    }
  }

  // ── Consolidation ─────────────────────────────────────────────────────────

  consolidate(agentId: string, trigger: ConsolidationTrigger): MemoryConsolidationResult {
    const agentNodeIds = this.agentMemoryIndex.get(agentId) ?? new Set<string>();
    const agentNodes = Array.from(agentNodeIds).map(id => this.nodes.get(id)).filter((n): n is MemoryNode => n !== undefined);

    let forgotten = 0;
    let consolidated = 0;
    let strengthened = 0;
    let newAssociations = 0;
    let contradictionsFound = 0;

    for (const node of agentNodes) {
      const hoursSince = (Date.now() - node.createdAt) / 3_600_000;
      const retention = computeRetention(node.strength, hoursSince, node.importance, node.retrievalCount, this.config.forgettingCurveDecayRate);

      if (retention < 0.05 && node.importance < 0.3) {
        node.status = 'forgotten';
        forgotten++;
      } else if (retention < this.config.consolidationThreshold) {
        node.status = 'fading';
      } else if (trigger === 'rehearsal' || trigger === 'spaced_repetition') {
        node.strength = Math.min(1, node.strength + 0.1);
        node.consolidatedAt = Date.now();
        node.status = 'consolidated';
        strengthened++;
      } else {
        node.status = 'consolidated';
        consolidated++;
      }

      // Build new associations during consolidation
      if (node.status === 'consolidated' && Math.random() > 0.8) {
        const newAssoc = this.discoverAssociations(node);
        newAssociations += newAssoc;
      }
    }

    // Re-check contradictions
    for (const node of agentNodes.filter(n => n.status === 'active' || n.status === 'consolidated')) {
      if (this.detectContradictions(node) > 0) contradictionsFound++;
    }

    const result: MemoryConsolidationResult = {
      agentId,
      nodesProcessed: agentNodes.length,
      nodesForgotten: forgotten,
      nodesConsolidated: consolidated,
      nodesStrengthened: strengthened,
      newAssociations,
      contradictionsFound,
      trigger,
      completedAt: Date.now(),
    };

    logger.info('Memory consolidation completed', { agentId, forgotten, consolidated, strengthened, trigger });
    return result;
  }

  // ── Contradiction Detection ────────────────────────────────────────────────

  detectContradictions(newNode: MemoryNode): number {
    const agentNodeIds = this.agentMemoryIndex.get(newNode.agentId) ?? new Set<string>();
    let found = 0;

    for (const existingId of agentNodeIds) {
      if (existingId === newNode.nodeId) continue;
      const existing = this.nodes.get(existingId);
      if (!existing || existing.status === 'forgotten') continue;

      const similarity = cosineSimilarity(newNode.embedding, existing.embedding);

      if (similarity > 0.9 && newNode.emotionalValence * existing.emotionalValence < 0) {
        // Very similar content with opposite sentiment = potential contradiction
        const existing_contradiction = Array.from(this.contradictions.values()).find(
          c => (c.nodeIdA === newNode.nodeId && c.nodeIdB === existingId) ||
               (c.nodeIdA === existingId && c.nodeIdB === newNode.nodeId),
        );

        if (!existing_contradiction) {
          const contradiction: Contradiction = {
            contradictionId: `contra_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            nodeIdA: existingId,
            nodeIdB: newNode.nodeId,
            reason: `High similarity (${similarity.toFixed(2)}) with opposite emotional valence`,
            confidence: similarity,
            detectedAt: Date.now(),
          };
          this.contradictions.set(contradiction.contradictionId, contradiction);
          found++;
        }
      }
    }

    return found;
  }

  resolveContradiction(contradictionId: string, resolution: string, keepNodeId: string): void {
    const contradiction = this.contradictions.get(contradictionId);
    if (!contradiction) throw new Error(`Contradiction ${contradictionId} not found`);

    const discardNodeId = contradiction.nodeIdA === keepNodeId ? contradiction.nodeIdB : contradiction.nodeIdA;
    const discard = this.nodes.get(discardNodeId);
    if (discard) {
      discard.status = 'archived';
      discard.importance *= 0.5;
    }

    contradiction.resolvedAt = Date.now();
    contradiction.resolution = resolution;
  }

  // ── Context Management ─────────────────────────────────────────────────────

  createContext(agentId: string, sessionId: string): ConversationContext {
    const context: ConversationContext = {
      contextId: `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      agentId,
      sessionId,
      messages: [],
      activeMemoryIds: [],
      workingMemoryIds: [],
      tokenCount: 0,
      maxTokens: this.config.maxContextTokens,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    this.contexts.set(context.contextId, context);
    return context;
  }

  addMessage(contextId: string, message: Omit<ContextMessage, 'messageId' | 'memoryIds'>): ContextMessage {
    const context = this.contexts.get(contextId);
    if (!context) throw new Error(`Context ${contextId} not found`);

    const fullMessage: ContextMessage = {
      ...message,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      memoryIds: [],
    };

    context.messages.push(fullMessage);
    context.tokenCount += message.tokenCount;
    context.lastUpdatedAt = Date.now();

    // Compress if over budget
    if (context.tokenCount > context.maxTokens * 0.9) {
      this.compressContext(contextId);
    }

    return fullMessage;
  }

  compressContext(contextId: string): number {
    const context = this.contexts.get(contextId);
    if (!context) throw new Error(`Context ${contextId} not found`);

    const original = context.messages.length;

    // Remove low-importance messages, keeping system messages and recent turns
    const systemMessages = context.messages.filter(m => m.role === 'system');
    const recentMessages = context.messages.slice(-10);
    const importantMessages = context.messages.filter(m => m.importance > 0.7);

    const kept = new Set([
      ...systemMessages.map(m => m.messageId),
      ...recentMessages.map(m => m.messageId),
      ...importantMessages.map(m => m.messageId),
    ]);

    context.messages = context.messages.filter(m => kept.has(m.messageId));
    context.tokenCount = context.messages.reduce((s, m) => s + m.tokenCount, 0);
    context.compressionRatio = original / Math.max(1, context.messages.length);

    return original - context.messages.length;
  }

  // ── Memory Palace ─────────────────────────────────────────────────────────

  createMemoryPalace(agentId: string, name: string, rooms: string[]): MemoryPalace {
    const palace: MemoryPalace = {
      palaceId: `palace_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      agentId,
      name,
      rooms: Object.fromEntries(rooms.map(r => [r, []])),
      navigationPath: rooms,
      createdAt: Date.now(),
    };
    this.palaces.set(palace.palaceId, palace);
    return palace;
  }

  placeInPalace(palaceId: string, room: string, nodeId: string): void {
    const palace = this.palaces.get(palaceId);
    if (!palace) throw new Error(`Palace ${palaceId} not found`);
    if (!palace.rooms[room]) palace.rooms[room] = [];
    palace.rooms[room]!.push(nodeId);
  }

  recallFromPalace(palaceId: string): MemoryNode[] {
    const palace = this.palaces.get(palaceId);
    if (!palace) throw new Error(`Palace ${palaceId} not found`);

    const results: MemoryNode[] = [];
    for (const room of palace.navigationPath) {
      const nodeIds = palace.rooms[room] ?? [];
      for (const id of nodeIds) {
        const node = this.nodes.get(id);
        if (node && node.status !== 'forgotten') {
          node.retrievalCount++;
          node.lastRetrievedAt = Date.now();
          results.push(node);
        }
      }
    }
    return results;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private discoverAssociations(node: MemoryNode): number {
    const agentNodeIds = this.agentMemoryIndex.get(node.agentId) ?? new Set<string>();
    let newAssociations = 0;

    for (const existingId of agentNodeIds) {
      if (existingId === node.nodeId) continue;
      if (node.associations.length >= this.config.maxAssociationsPerNode) break;

      const existing = this.nodes.get(existingId);
      if (!existing || existing.status === 'forgotten') continue;

      const sim = cosineSimilarity(node.embedding, existing.embedding);
      if (sim >= this.config.similarityThreshold && !node.associations.includes(existingId)) {
        node.associations.push(existingId);
        existing.associations.push(node.nodeId);

        const edgeId = `edge_${node.nodeId}_${existingId}`;
        if (!this.edges.has(edgeId)) {
          this.edges.set(edgeId, {
            edgeId,
            fromNodeId: node.nodeId,
            toNodeId: existingId,
            relationshipType: 'similar_to',
            strength: sim,
            createdAt: Date.now(),
            activationCount: 1,
          });
          newAssociations++;
        }
      }
    }

    return newAssociations;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getAgentMemoryStats(agentId: string): Record<string, unknown> {
    const nodeIds = this.agentMemoryIndex.get(agentId) ?? new Set<string>();
    const nodes = Array.from(nodeIds).map(id => this.nodes.get(id)).filter((n): n is MemoryNode => n !== undefined);

    return {
      totalMemories: nodes.length,
      activeMemories: nodes.filter(n => n.status === 'active').length,
      consolidatedMemories: nodes.filter(n => n.status === 'consolidated').length,
      fadingMemories: nodes.filter(n => n.status === 'fading').length,
      forgottenMemories: nodes.filter(n => n.status === 'forgotten').length,
      avgImportance: nodes.length > 0 ? nodes.reduce((s, n) => s + n.importance, 0) / nodes.length : 0,
      avgStrength: nodes.length > 0 ? nodes.reduce((s, n) => s + n.strength, 0) / nodes.length : 0,
      totalAssociations: this.edges.size,
      contradictions: Array.from(this.contradictions.values()).filter(c => !c.resolvedAt).length,
    };
  }

  getDashboardSummary(): Record<string, unknown> {
    const allNodes = Array.from(this.nodes.values());
    return {
      totalNodes: allNodes.length,
      totalAgents: this.agentMemoryIndex.size,
      totalEdges: this.edges.size,
      totalContexts: this.contexts.size,
      totalPalaces: this.palaces.size,
      unresolvedContradictions: Array.from(this.contradictions.values()).filter(c => !c.resolvedAt).length,
      forgottenNodes: allNodes.filter(n => n.status === 'forgotten').length,
      avgMemoryStrength: allNodes.length > 0 ? allNodes.reduce((s, n) => s + n.strength, 0) / allNodes.length : 0,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getMemoryGraph(): ContextualMemoryGraph {
  const key = '__contextualMemoryGraph__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new ContextualMemoryGraph();
  }
  return (globalThis as Record<string, unknown>)[key] as ContextualMemoryGraph;
}
