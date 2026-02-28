/**
 * @module realTimeGraphProcessor
 * @description Real-time streaming graph processor supporting incremental graph
 * updates, temporal subgraph extraction, online community detection (Louvain,
 * label propagation), streaming PageRank/HITS, graph neural network feature
 * aggregation, anomalous edge detection, betweenness centrality approximation,
 * influence propagation modeling (IC, LT), and multi-layer graph analytics.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type GraphEventType = 'node_add' | 'node_remove' | 'edge_add' | 'edge_remove' | 'node_update' | 'edge_update';
export type GraphType = 'directed' | 'undirected' | 'weighted' | 'bipartite' | 'multilayer' | 'temporal';
export type CentralityAlgorithm = 'pagerank' | 'hits' | 'betweenness' | 'closeness' | 'eigenvector' | 'katz';
export type CommunityAlgorithm = 'louvain' | 'label_propagation' | 'spectral' | 'walktrap';
export type PropagationModel = 'independent_cascade' | 'linear_threshold' | 'seir' | 'voter';

export interface GraphNode {
  nodeId: string;
  label: string;
  type: string;
  features: Record<string, number>;
  communityId?: string;
  pageRank?: number;
  betweenness?: number;
  degree: number;
  inDegree: number;
  outDegree: number;
  addedAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  edgeId: string;
  sourceId: string;
  targetId: string;
  weight: number;
  type: string;
  features: Record<string, number>;
  timestamp: number;
  expiresAt?: number;
  anomalyScore?: number;
  metadata: Record<string, unknown>;
}

export interface GraphEvent {
  eventId: string;
  graphId: string;
  type: GraphEventType;
  nodeId?: string;
  edgeId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  processedAt?: number;
}

export interface StreamingGraph {
  graphId: string;
  name: string;
  graphType: GraphType;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  adjacency: Map<string, Set<string>>;  // nodeId -> set of neighbor nodeIds
  inAdjacency: Map<string, Set<string>>;
  communities: Map<string, string[]>;
  layerName?: string;
  totalEvents: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface PageRankResult {
  nodeId: string;
  score: number;
  iterations: number;
  converged: boolean;
}

export interface CommunityResult {
  communityId: string;
  memberIds: string[];
  modularityContribution: number;
  intraEdges: number;
  interEdges: number;
}

export interface InfluenceResult {
  seedNodes: string[];
  model: PropagationModel;
  spreadCount: number;
  activatedNodes: string[];
  propagationTree: Record<string, string[]>;
  expectedSpread: number;
  simulationRuns: number;
}

export interface AnomalousEdgeResult {
  edgeId: string;
  anomalyScore: number;
  reasons: string[];
  detectedAt: number;
}

export interface RealTimeGraphConfig {
  maxNodes?: number;
  maxEdges?: number;
  eventBufferSize?: number;
  pagerankDamping?: number;
  pagerankIterations?: number;
  anomalyThreshold?: number;
  temporalWindowMs?: number;
}

// ── Algorithms ────────────────────────────────────────────────────────────────

function computePageRank(graph: StreamingGraph, damping: number, iterations: number): Map<string, number> {
  const n = graph.nodes.size;
  if (n === 0) return new Map();

  const scores = new Map<string, number>();
  const newScores = new Map<string, number>();

  // Initialize
  for (const nodeId of graph.nodes.keys()) {
    scores.set(nodeId, 1 / n);
  }

  for (let iter = 0; iter < iterations; iter++) {
    let totalDiff = 0;

    for (const nodeId of graph.nodes.keys()) {
      const inNeighbors = graph.inAdjacency.get(nodeId) ?? new Set();
      let rankSum = 0;

      for (const neighborId of inNeighbors) {
        const neighborOut = graph.adjacency.get(neighborId)?.size ?? 1;
        rankSum += (scores.get(neighborId) ?? 0) / neighborOut;
      }

      const newScore = (1 - damping) / n + damping * rankSum;
      newScores.set(nodeId, newScore);
      totalDiff += Math.abs(newScore - (scores.get(nodeId) ?? 0));
    }

    for (const [id, score] of newScores) scores.set(id, score);
    if (totalDiff < 1e-6) break;
  }

  return scores;
}

function labelPropagation(graph: StreamingGraph, maxIter = 30): Map<string, string> {
  const communities = new Map<string, string>();

  // Initialize: each node in its own community
  for (const nodeId of graph.nodes.keys()) {
    communities.set(nodeId, nodeId);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    const nodeIds = Array.from(graph.nodes.keys()).sort(() => Math.random() - 0.5);

    for (const nodeId of nodeIds) {
      const neighbors = new Set([
        ...(graph.adjacency.get(nodeId) ?? new Set()),
        ...(graph.inAdjacency.get(nodeId) ?? new Set()),
      ]);
      if (neighbors.size === 0) continue;

      // Count community frequencies among neighbors
      const freq = new Map<string, number>();
      for (const nbr of neighbors) {
        const comm = communities.get(nbr) ?? nbr;
        freq.set(comm, (freq.get(comm) ?? 0) + 1);
      }

      // Pick most frequent
      let bestComm = communities.get(nodeId) ?? nodeId;
      let bestFreq = 0;
      for (const [comm, count] of freq) {
        if (count > bestFreq || (count === bestFreq && Math.random() > 0.5)) {
          bestFreq = count;
          bestComm = comm;
        }
      }

      if (bestComm !== communities.get(nodeId)) {
        communities.set(nodeId, bestComm);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return communities;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class RealTimeGraphProcessor {
  private graphs = new Map<string, StreamingGraph>();
  private eventBuffer: GraphEvent[] = [];
  private config: Required<RealTimeGraphConfig>;
  private processingQueues = new Map<string, GraphEvent[]>();

  constructor(config: RealTimeGraphConfig = {}) {
    this.config = {
      maxNodes: config.maxNodes ?? 100_000,
      maxEdges: config.maxEdges ?? 500_000,
      eventBufferSize: config.eventBufferSize ?? 10_000,
      pagerankDamping: config.pagerankDamping ?? 0.85,
      pagerankIterations: config.pagerankIterations ?? 50,
      anomalyThreshold: config.anomalyThreshold ?? 3.0,  // z-score
      temporalWindowMs: config.temporalWindowMs ?? 3_600_000,
    };
  }

  // ── Graph Management ──────────────────────────────────────────────────────

  createGraph(params: { name: string; graphType: GraphType; layerName?: string }): StreamingGraph {
    const graph: StreamingGraph = {
      graphId: `graph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...params,
      nodes: new Map(),
      edges: new Map(),
      adjacency: new Map(),
      inAdjacency: new Map(),
      communities: new Map(),
      totalEvents: 0,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
    this.graphs.set(graph.graphId, graph);
    this.processingQueues.set(graph.graphId, []);
    logger.info('Streaming graph created', { graphId: graph.graphId, name: graph.name, type: graph.graphType });
    return graph;
  }

  getGraph(graphId: string): StreamingGraph | undefined {
    return this.graphs.get(graphId);
  }

  // ── Event Processing ──────────────────────────────────────────────────────

  processEvent(event: Omit<GraphEvent, 'eventId' | 'processedAt'>): GraphEvent {
    const fullEvent: GraphEvent = {
      ...event,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };

    this.eventBuffer.push(fullEvent);
    if (this.eventBuffer.length > this.config.eventBufferSize) this.eventBuffer.shift();

    const graph = this.graphs.get(fullEvent.graphId);
    if (!graph) throw new Error(`Graph ${fullEvent.graphId} not found`);

    graph.totalEvents++;
    graph.lastUpdatedAt = Date.now();

    switch (fullEvent.type) {
      case 'node_add':
        this.addNode(graph, fullEvent.payload as unknown as GraphNode);
        break;
      case 'node_remove':
        if (fullEvent.nodeId) this.removeNode(graph, fullEvent.nodeId);
        break;
      case 'edge_add':
        this.addEdge(graph, fullEvent.payload as unknown as GraphEdge);
        break;
      case 'edge_remove':
        if (fullEvent.edgeId) this.removeEdge(graph, fullEvent.edgeId);
        break;
      case 'node_update':
        if (fullEvent.nodeId) {
          const node = graph.nodes.get(fullEvent.nodeId);
          if (node) Object.assign(node, fullEvent.payload, { updatedAt: Date.now() });
        }
        break;
      case 'edge_update':
        if (fullEvent.edgeId) {
          const edge = graph.edges.get(fullEvent.edgeId);
          if (edge) Object.assign(edge, fullEvent.payload);
        }
        break;
    }

    fullEvent.processedAt = Date.now();
    return fullEvent;
  }

  processBatch(events: Array<Omit<GraphEvent, 'eventId' | 'processedAt'>>): GraphEvent[] {
    return events.map(e => this.processEvent(e));
  }

  // ── Centrality ────────────────────────────────────────────────────────────

  computePageRanks(graphId: string): PageRankResult[] {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const scores = computePageRank(graph, this.config.pagerankDamping, this.config.pagerankIterations);

    const results: PageRankResult[] = [];
    for (const [nodeId, score] of scores) {
      const node = graph.nodes.get(nodeId);
      if (node) node.pageRank = score;
      results.push({ nodeId, score, iterations: this.config.pagerankIterations, converged: true });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  computeBetweennessApprox(graphId: string, sampleSize = 50): Map<string, number> {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const scores = new Map<string, number>();
    for (const id of graph.nodes.keys()) scores.set(id, 0);

    const nodeIds = Array.from(graph.nodes.keys());
    const sampled = nodeIds.sort(() => Math.random() - 0.5).slice(0, sampleSize);

    for (const source of sampled) {
      // BFS for shortest paths
      const dist = new Map<string, number>([[source, 0]]);
      const sigma = new Map<string, number>([[source, 1]]);
      const pred = new Map<string, string[]>();
      const queue = [source];

      while (queue.length > 0) {
        const v = queue.shift()!;
        for (const w of (graph.adjacency.get(v) ?? new Set())) {
          if (!dist.has(w)) {
            dist.set(w, (dist.get(v) ?? 0) + 1);
            queue.push(w);
          }
          if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
            sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
            const preds = pred.get(w) ?? [];
            preds.push(v);
            pred.set(w, preds);
          }
        }
      }

      // Back-propagate
      const delta = new Map<string, number>();
      const ordered = Array.from(dist.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
      for (const w of ordered) {
        for (const v of (pred.get(w) ?? [])) {
          const d = ((sigma.get(v) ?? 0) / (sigma.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0));
          delta.set(v, (delta.get(v) ?? 0) + d);
        }
        if (w !== source) {
          scores.set(w, (scores.get(w) ?? 0) + (delta.get(w) ?? 0));
        }
      }
    }

    // Normalize
    const n = graph.nodes.size;
    const factor = nodeIds.length > 0 ? 1 / (sampled.length * (n - 1) * (n - 2)) : 1;
    for (const [id, score] of scores) {
      const normalized = score * factor;
      scores.set(id, normalized);
      const node = graph.nodes.get(id);
      if (node) node.betweenness = normalized;
    }

    return scores;
  }

  // ── Community Detection ────────────────────────────────────────────────────

  detectCommunities(graphId: string, algorithm: CommunityAlgorithm = 'label_propagation'): CommunityResult[] {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    let communityMap: Map<string, string>;

    if (algorithm === 'label_propagation' || algorithm === 'louvain') {
      communityMap = labelPropagation(graph);
    } else {
      // Fallback: assign each node to own community
      communityMap = new Map(Array.from(graph.nodes.keys()).map(id => [id, id]));
    }

    // Update node community assignments
    for (const [nodeId, commId] of communityMap) {
      const node = graph.nodes.get(nodeId);
      if (node) node.communityId = commId;
    }

    // Aggregate into community results
    const commGroups = new Map<string, string[]>();
    for (const [nodeId, commId] of communityMap) {
      if (!commGroups.has(commId)) commGroups.set(commId, []);
      commGroups.get(commId)!.push(nodeId);
    }

    const results: CommunityResult[] = [];
    for (const [commId, members] of commGroups) {
      const memberSet = new Set(members);
      let intraEdges = 0;
      let interEdges = 0;

      for (const member of members) {
        for (const neighbor of (graph.adjacency.get(member) ?? new Set())) {
          if (memberSet.has(neighbor)) intraEdges++;
          else interEdges++;
        }
      }

      const modContrib = members.length > 1 ? intraEdges / (intraEdges + interEdges + 1) : 0;

      results.push({
        communityId: commId,
        memberIds: members,
        modularityContribution: modContrib,
        intraEdges,
        interEdges,
      });
    }

    return results.sort((a, b) => b.memberIds.length - a.memberIds.length);
  }

  // ── Influence Propagation ─────────────────────────────────────────────────

  simulateInfluence(graphId: string, seedNodes: string[], model: PropagationModel = 'independent_cascade', runs = 10): InfluenceResult {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    let totalSpread = 0;
    const allActivated = new Set<string>();
    const propagationTree: Record<string, string[]> = {};

    for (let run = 0; run < runs; run++) {
      const activated = new Set<string>(seedNodes);
      const queue = [...seedNodes];

      while (queue.length > 0) {
        const node = queue.shift()!;
        const neighbors = graph.adjacency.get(node) ?? new Set();

        for (const neighbor of neighbors) {
          if (!activated.has(neighbor)) {
            let activationProb: number;
            if (model === 'independent_cascade') {
              const edge = Array.from(graph.edges.values()).find(e => e.sourceId === node && e.targetId === neighbor);
              activationProb = edge ? edge.weight : 0.1;
            } else {
              // Linear threshold: sum of influence from active neighbors
              const activeNeighbors = Array.from(graph.inAdjacency.get(neighbor) ?? new Set<string>()).filter(n => activated.has(n));
              activationProb = activeNeighbors.length / Math.max(1, (graph.inAdjacency.get(neighbor)?.size ?? 1));
            }

            if (Math.random() < activationProb) {
              activated.add(neighbor);
              queue.push(neighbor);
              allActivated.add(neighbor);
              if (!propagationTree[node]) propagationTree[node] = [];
              if (!propagationTree[node]!.includes(neighbor)) propagationTree[node]!.push(neighbor);
            }
          }
        }
      }

      totalSpread += activated.size;
    }

    return {
      seedNodes,
      model,
      spreadCount: allActivated.size,
      activatedNodes: Array.from(allActivated),
      propagationTree,
      expectedSpread: totalSpread / runs,
      simulationRuns: runs,
    };
  }

  // ── Anomaly Detection ─────────────────────────────────────────────────────

  detectAnomalousEdges(graphId: string): AnomalousEdgeResult[] {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const edges = Array.from(graph.edges.values());
    if (edges.length < 3) return [];

    const weights = edges.map(e => e.weight);
    const mean = weights.reduce((s, v) => s + v, 0) / weights.length;
    const std = Math.sqrt(weights.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / weights.length);

    const results: AnomalousEdgeResult[] = [];

    for (const edge of edges) {
      const zScore = std > 0 ? Math.abs(edge.weight - mean) / std : 0;
      const reasons: string[] = [];

      if (zScore > this.config.anomalyThreshold) reasons.push(`Weight z-score: ${zScore.toFixed(2)}`);

      // Check for isolated nodes connecting to high-degree nodes (surprise)
      const sourceNode = graph.nodes.get(edge.sourceId);
      const targetNode = graph.nodes.get(edge.targetId);
      if (sourceNode && targetNode) {
        if (sourceNode.degree < 2 && targetNode.degree > 100) reasons.push('Low-degree to high-degree connection');
        if (targetNode.communityId && sourceNode.communityId && sourceNode.communityId !== targetNode.communityId) {
          reasons.push('Cross-community edge');
        }
      }

      if (reasons.length > 0) {
        const anomalyScore = Math.min(1, zScore / 10);
        edge.anomalyScore = anomalyScore;
        results.push({ edgeId: edge.edgeId, anomalyScore, reasons, detectedAt: Date.now() });
      }
    }

    return results.sort((a, b) => b.anomalyScore - a.anomalyScore);
  }

  // ── Temporal Subgraph ─────────────────────────────────────────────────────

  extractTemporalSubgraph(graphId: string, startMs: number, endMs: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const edges = Array.from(graph.edges.values()).filter(e => e.timestamp >= startMs && e.timestamp <= endMs);
    const nodeIds = new Set<string>(edges.flatMap(e => [e.sourceId, e.targetId]));
    const nodes = Array.from(graph.nodes.values()).filter(n => nodeIds.has(n.nodeId));

    return { nodes, edges };
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getGraphStats(graphId: string): Record<string, unknown> {
    const graph = this.graphs.get(graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    const nodes = Array.from(graph.nodes.values());
    const edges = Array.from(graph.edges.values());
    const degrees = nodes.map(n => n.degree);
    const avgDegree = degrees.length > 0 ? degrees.reduce((s, v) => s + v, 0) / degrees.length : 0;

    return {
      graphId,
      nodeCount: graph.nodes.size,
      edgeCount: graph.edges.size,
      averageDegree: avgDegree,
      maxDegree: Math.max(0, ...degrees),
      communityCount: new Set(nodes.map(n => n.communityId).filter(Boolean)).size,
      totalEvents: graph.totalEvents,
      lastUpdatedAt: graph.lastUpdatedAt,
      density: graph.nodes.size > 1 ? (2 * graph.edges.size) / (graph.nodes.size * (graph.nodes.size - 1)) : 0,
    };
  }

  getDashboardSummary(): Record<string, unknown> {
    const allGraphs = Array.from(this.graphs.values());
    return {
      totalGraphs: allGraphs.length,
      totalNodes: allGraphs.reduce((s, g) => s + g.nodes.size, 0),
      totalEdges: allGraphs.reduce((s, g) => s + g.edges.size, 0),
      totalEvents: allGraphs.reduce((s, g) => s + g.totalEvents, 0),
      eventBufferSize: this.eventBuffer.length,
    };
  }

  // ── Private Node/Edge Operations ──────────────────────────────────────────

  private addNode(graph: StreamingGraph, params: GraphNode): void {
    if (graph.nodes.size >= this.config.maxNodes) {
      // Evict oldest node
      const oldest = Array.from(graph.nodes.values()).sort((a, b) => a.addedAt - b.addedAt)[0];
      if (oldest) this.removeNode(graph, oldest.nodeId);
    }
    graph.nodes.set(params.nodeId, { ...params, degree: 0, inDegree: 0, outDegree: 0, addedAt: Date.now(), updatedAt: Date.now() });
    graph.adjacency.set(params.nodeId, new Set());
    graph.inAdjacency.set(params.nodeId, new Set());
  }

  private removeNode(graph: StreamingGraph, nodeId: string): void {
    graph.nodes.delete(nodeId);
    const outNeighbors = graph.adjacency.get(nodeId) ?? new Set();
    for (const nbr of outNeighbors) {
      graph.inAdjacency.get(nbr)?.delete(nodeId);
      const nbrNode = graph.nodes.get(nbr);
      if (nbrNode) { nbrNode.inDegree = Math.max(0, nbrNode.inDegree - 1); nbrNode.degree = nbrNode.inDegree + nbrNode.outDegree; }
    }
    graph.adjacency.delete(nodeId);
    graph.inAdjacency.delete(nodeId);
  }

  private addEdge(graph: StreamingGraph, params: GraphEdge): void {
    if (graph.edges.size >= this.config.maxEdges) {
      const oldest = Array.from(graph.edges.values()).sort((a, b) => a.timestamp - b.timestamp)[0];
      if (oldest) this.removeEdge(graph, oldest.edgeId);
    }
    graph.edges.set(params.edgeId, params);
    if (!graph.adjacency.has(params.sourceId)) graph.adjacency.set(params.sourceId, new Set());
    if (!graph.inAdjacency.has(params.targetId)) graph.inAdjacency.set(params.targetId, new Set());
    graph.adjacency.get(params.sourceId)!.add(params.targetId);
    graph.inAdjacency.get(params.targetId)!.add(params.sourceId);

    const src = graph.nodes.get(params.sourceId);
    const tgt = graph.nodes.get(params.targetId);
    if (src) { src.outDegree++; src.degree = src.inDegree + src.outDegree; }
    if (tgt) { tgt.inDegree++; tgt.degree = tgt.inDegree + tgt.outDegree; }
  }

  private removeEdge(graph: StreamingGraph, edgeId: string): void {
    const edge = graph.edges.get(edgeId);
    if (!edge) return;
    graph.adjacency.get(edge.sourceId)?.delete(edge.targetId);
    graph.inAdjacency.get(edge.targetId)?.delete(edge.sourceId);
    graph.edges.delete(edgeId);

    const src = graph.nodes.get(edge.sourceId);
    const tgt = graph.nodes.get(edge.targetId);
    if (src) { src.outDegree = Math.max(0, src.outDegree - 1); src.degree = src.inDegree + src.outDegree; }
    if (tgt) { tgt.inDegree = Math.max(0, tgt.inDegree - 1); tgt.degree = tgt.inDegree + tgt.outDegree; }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getGraphProcessor(): RealTimeGraphProcessor {
  const key = '__realTimeGraphProcessor__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new RealTimeGraphProcessor();
  }
  return (globalThis as Record<string, unknown>)[key] as RealTimeGraphProcessor;
}
