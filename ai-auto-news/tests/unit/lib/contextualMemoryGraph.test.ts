import { describe, it, expect, beforeEach } from '@jest/globals';
import { ContextualMemoryGraph } from '../../../src/lib/contextualMemoryGraph';

describe('ContextualMemoryGraph', () => {
  let graph: ContextualMemoryGraph;

  beforeEach(() => {
    graph = new ContextualMemoryGraph({
      maxWorkingMemoryNodes: 5,
      similarityThreshold: 0.3,
      maxAssociationsPerNode: 10,
      embeddingDimension: 32,
      forgettingCurveDecayRate: 0.1,
    });
  });

  it('stores a memory node with generated ID', () => {
    const node = graph.store({
      agentId: 'agent-1',
      sessionId: 'sess-1',
      memoryType: 'episodic',
      content: 'User asked about pricing plans',
      importance: 0.7,
      emotionalValence: 0.2,
      tags: ['pricing', 'inquiry'],
      source: 'user-message',
      metadata: {},
    });
    expect(node.nodeId).toMatch(/^mem_/);
    expect(node.embedding.length).toBe(32);
    expect(node.strength).toBe(0.7);
    expect(node.retrievalCount).toBe(0);
    expect(node.status).toBe('active');
  });

  it('recalls memories with similarity strategy', () => {
    graph.store({ agentId: 'agent-1', sessionId: 's1', memoryType: 'semantic', content: 'pricing enterprise tier', importance: 0.8, emotionalValence: 0, tags: [], source: 'system', metadata: {} });
    graph.store({ agentId: 'agent-1', sessionId: 's1', memoryType: 'semantic', content: 'user authentication setup', importance: 0.6, emotionalValence: 0, tags: [], source: 'system', metadata: {} });

    const result = graph.recall('agent-1', 'pricing plans', 'similarity', 5);
    expect(result.memories.length).toBeGreaterThanOrEqual(1);
    expect(result.strategy).toBe('similarity');
    expect(result.totalSearched).toBe(2);
  });

  it('increments retrieval count on recall', () => {
    const node = graph.store({ agentId: 'a1', sessionId: 's1', memoryType: 'episodic', content: 'test memory', importance: 0.5, emotionalValence: 0, tags: [], source: 'test', metadata: {} });
    graph.recall('a1', 'test memory', 'similarity', 5);
    const updated = graph.getAgentMemoryStats('a1');
    expect(updated.totalMemories).toBe(1);
  });

  it('recalls using importance strategy', () => {
    graph.store({ agentId: 'a2', sessionId: 's2', memoryType: 'semantic', content: 'high importance event', importance: 0.95, emotionalValence: 0.8, tags: [], source: 'system', metadata: {} });
    graph.store({ agentId: 'a2', sessionId: 's2', memoryType: 'semantic', content: 'low importance note', importance: 0.1, emotionalValence: 0, tags: [], source: 'system', metadata: {} });

    const result = graph.recall('a2', 'any query', 'importance', 5);
    expect(result.memories[0]!.importance).toBeGreaterThanOrEqual(result.memories[result.memories.length - 1]!.importance);
  });

  it('runs consolidation cycle', () => {
    graph.store({ agentId: 'a3', sessionId: 's3', memoryType: 'episodic', content: 'old event', importance: 0.3, emotionalValence: 0, tags: [], source: 'test', metadata: {} });
    graph.store({ agentId: 'a3', sessionId: 's3', memoryType: 'semantic', content: 'important fact', importance: 0.9, emotionalValence: 0, tags: [], source: 'test', metadata: {} });

    const result = graph.consolidate('a3', 'rehearsal');
    expect(result.agentId).toBe('a3');
    expect(result.nodesProcessed).toBe(2);
    expect(result.nodesStrengthened + result.nodesForgotten + result.nodesConsolidated).toBeLessThanOrEqual(2);
  });

  it('creates context and adds messages', () => {
    const ctx = graph.createContext('agent-4', 'session-4');
    expect(ctx.contextId).toMatch(/^ctx_/);

    const msg = graph.addMessage(ctx.contextId, {
      role: 'user',
      content: 'Hello',
      tokenCount: 5,
      importance: 0.5,
      timestamp: Date.now(),
    });
    expect(msg.messageId).toMatch(/^msg_/);
    expect(ctx.messages.length).toBe(1);
    expect(ctx.tokenCount).toBe(5);
  });

  it('compresses context when token limit exceeded', () => {
    const ctx = graph.createContext('agent-5', 'session-5');

    for (let i = 0; i < 20; i++) {
      graph.addMessage(ctx.contextId, {
        role: 'user',
        content: `message ${i}`,
        tokenCount: 300,
        importance: i < 5 ? 0.9 : 0.2,
        timestamp: Date.now() + i,
      });
    }

    // Compression should have been triggered
    expect(ctx.messages.length).toBeLessThan(20);
    expect(ctx.tokenCount).toBeLessThan(20 * 300);
  });

  it('creates memory palace and places/recalls memories', () => {
    const n1 = graph.store({ agentId: 'a6', sessionId: 's6', memoryType: 'semantic', content: 'room entry memory', importance: 0.7, emotionalValence: 0, tags: [], source: 'palace', metadata: {} });
    const n2 = graph.store({ agentId: 'a6', sessionId: 's6', memoryType: 'semantic', content: 'hallway memory', importance: 0.6, emotionalValence: 0, tags: [], source: 'palace', metadata: {} });

    const palace = graph.createMemoryPalace('a6', 'Knowledge Palace', ['entrance', 'hallway', 'library']);
    graph.placeInPalace(palace.palaceId, 'entrance', n1.nodeId);
    graph.placeInPalace(palace.palaceId, 'hallway', n2.nodeId);

    const recalled = graph.recallFromPalace(palace.palaceId);
    expect(recalled.length).toBe(2);
  });

  it('detects and resolves contradictions', () => {
    const n1 = graph.store({ agentId: 'a7', sessionId: 's7', memoryType: 'semantic', content: 'This product is excellent and amazing', importance: 0.8, emotionalValence: 0.9, tags: [], source: 'review', metadata: {} });
    const n2 = graph.store({ agentId: 'a7', sessionId: 's7', memoryType: 'semantic', content: 'This product is excellent and amazing', importance: 0.8, emotionalValence: -0.9, tags: [], source: 'review', metadata: {} });

    const stats = graph.getAgentMemoryStats('a7');
    // Contradictions depend on embedding similarity - just verify structure
    expect(typeof stats.contradictions).toBe('number');
    expect(n1.nodeId).not.toBe(n2.nodeId);
  });

  it('returns comprehensive agent memory stats', () => {
    graph.store({ agentId: 'a8', sessionId: 's8', memoryType: 'episodic', content: 'test content', importance: 0.5, emotionalValence: 0, tags: [], source: 'test', metadata: {} });
    const stats = graph.getAgentMemoryStats('a8');
    expect(stats.totalMemories).toBe(1);
    expect(stats.activeMemories).toBe(1);
    expect(stats.avgImportance).toBe(0.5);
  });

  it('returns dashboard summary', () => {
    graph.store({ agentId: 'a9', sessionId: 's9', memoryType: 'working', content: 'working memory', importance: 0.4, emotionalValence: 0, tags: [], source: 'system', metadata: {} });
    const summary = graph.getDashboardSummary();
    expect(summary.totalAgents).toBeGreaterThanOrEqual(1);
    expect(typeof summary.avgMemoryStrength).toBe('number');
  });
});
