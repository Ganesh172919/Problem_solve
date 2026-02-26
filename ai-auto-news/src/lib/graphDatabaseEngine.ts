/**
 * Graph Database Engine
 *
 * In-memory graph database with traversal algorithms, pattern matching,
 * relationship scoring, and path analysis for entity relationships.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  metadata: NodeMetadata;
}

export interface NodeMetadata {
  version: number;
  accessCount: number;
  lastAccessedAt: number;
  importance: number;
  tags: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
  directed: boolean;
  createdAt: number;
}

export interface TraversalResult {
  path: string[];
  edges: GraphEdge[];
  totalWeight: number;
  depth: number;
  visitedNodes: number;
}

export interface PatternMatch {
  nodes: GraphNode[];
  edges: GraphEdge[];
  score: number;
  pattern: string;
}

export interface GraphQuery {
  type: 'match' | 'traverse' | 'shortest_path' | 'neighbors' | 'subgraph' | 'pagerank';
  startNodeId?: string;
  endNodeId?: string;
  nodeType?: string;
  edgeType?: string;
  maxDepth?: number;
  minWeight?: number;
  filters?: QueryFilter[];
  limit?: number;
}

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in';
  value: unknown;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  edgeTypes: Record<string, number>;
  avgDegree: number;
  maxDegree: number;
  density: number;
  connectedComponents: number;
}

export class GraphDatabaseEngine {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacency: Map<string, Set<string>> = new Map();
  private nodeIndex: Map<string, Set<string>> = new Map();
  private edgeIndex: Map<string, Set<string>> = new Map();

  addNode(id: string, type: string, properties: Record<string, unknown> = {}): GraphNode {
    const now = Date.now();
    const node: GraphNode = {
      id,
      type,
      properties,
      createdAt: now,
      updatedAt: now,
      metadata: {
        version: 1,
        accessCount: 0,
        lastAccessedAt: now,
        importance: 0,
        tags: [],
      },
    };

    this.nodes.set(id, node);

    if (!this.adjacencyList.has(id)) {
      this.adjacencyList.set(id, new Set());
    }
    if (!this.reverseAdjacency.has(id)) {
      this.reverseAdjacency.set(id, new Set());
    }

    const typeKey = `type:${type}`;
    if (!this.nodeIndex.has(typeKey)) {
      this.nodeIndex.set(typeKey, new Set());
    }
    this.nodeIndex.get(typeKey)!.add(id);

    logger.debug('Node added', { nodeId: id, type });
    return node;
  }

  getNode(id: string): GraphNode | undefined {
    const node = this.nodes.get(id);
    if (node) {
      node.metadata.accessCount++;
      node.metadata.lastAccessedAt = Date.now();
    }
    return node;
  }

  updateNode(id: string, properties: Record<string, unknown>): GraphNode | null {
    const node = this.nodes.get(id);
    if (!node) return null;

    node.properties = { ...node.properties, ...properties };
    node.updatedAt = Date.now();
    node.metadata.version++;

    return node;
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    const neighbors = this.adjacencyList.get(id) || new Set();
    for (const edgeId of neighbors) {
      this.edges.delete(edgeId);
    }

    const reverseNeighbors = this.reverseAdjacency.get(id) || new Set();
    for (const edgeId of reverseNeighbors) {
      this.edges.delete(edgeId);
    }

    const node = this.nodes.get(id)!;
    const typeKey = `type:${node.type}`;
    this.nodeIndex.get(typeKey)?.delete(id);

    this.nodes.delete(id);
    this.adjacencyList.delete(id);
    this.reverseAdjacency.delete(id);

    return true;
  }

  addEdge(
    source: string,
    target: string,
    type: string,
    weight: number = 1.0,
    properties: Record<string, unknown> = {},
    directed: boolean = true,
  ): GraphEdge | null {
    if (!this.nodes.has(source) || !this.nodes.has(target)) {
      logger.warn('Cannot add edge: source or target node not found', { source, target });
      return null;
    }

    const id = `${source}->${target}:${type}`;
    const edge: GraphEdge = {
      id,
      source,
      target,
      type,
      weight,
      properties,
      directed,
      createdAt: Date.now(),
    };

    this.edges.set(id, edge);
    this.adjacencyList.get(source)!.add(id);
    this.reverseAdjacency.get(target)!.add(id);

    if (!directed) {
      this.adjacencyList.get(target)!.add(id);
      this.reverseAdjacency.get(source)!.add(id);
    }

    const typeKey = `etype:${type}`;
    if (!this.edgeIndex.has(typeKey)) {
      this.edgeIndex.set(typeKey, new Set());
    }
    this.edgeIndex.get(typeKey)!.add(id);

    return edge;
  }

  removeEdge(edgeId: string): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;

    this.adjacencyList.get(edge.source)?.delete(edgeId);
    this.reverseAdjacency.get(edge.target)?.delete(edgeId);

    if (!edge.directed) {
      this.adjacencyList.get(edge.target)?.delete(edgeId);
      this.reverseAdjacency.get(edge.source)?.delete(edgeId);
    }

    const typeKey = `etype:${edge.type}`;
    this.edgeIndex.get(typeKey)?.delete(edgeId);

    this.edges.delete(edgeId);
    return true;
  }

  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    const edgeIds = this.adjacencyList.get(nodeId);
    if (!edgeIds) return [];

    const neighbors: GraphNode[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      if (edgeType && edge.type !== edgeType) continue;

      const neighborId = edge.source === nodeId ? edge.target : edge.source;
      const neighbor = this.nodes.get(neighborId);
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }

    return neighbors;
  }

  traverseBFS(startId: string, maxDepth: number = 5, edgeType?: string): TraversalResult {
    const visited = new Set<string>();
    const queue: { nodeId: string; depth: number; path: string[]; edges: GraphEdge[]; weight: number }[] = [];
    const result: TraversalResult = {
      path: [],
      edges: [],
      totalWeight: 0,
      depth: 0,
      visitedNodes: 0,
    };

    queue.push({ nodeId: startId, depth: 0, path: [startId], edges: [], weight: 0 });
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth > result.depth) {
        result.depth = current.depth;
      }
      result.path = current.path;
      result.edges = current.edges;
      result.totalWeight = current.weight;

      if (current.depth >= maxDepth) continue;

      const edgeIds = this.adjacencyList.get(current.nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (edgeType && edge.type !== edgeType) continue;

        const neighborId = edge.source === current.nodeId ? edge.target : edge.source;
        if (visited.has(neighborId)) continue;

        visited.add(neighborId);
        queue.push({
          nodeId: neighborId,
          depth: current.depth + 1,
          path: [...current.path, neighborId],
          edges: [...current.edges, edge],
          weight: current.weight + edge.weight,
        });
      }
    }

    result.visitedNodes = visited.size;
    return result;
  }

  findShortestPath(startId: string, endId: string): TraversalResult | null {
    if (!this.nodes.has(startId) || !this.nodes.has(endId)) return null;
    if (startId === endId) {
      return { path: [startId], edges: [], totalWeight: 0, depth: 0, visitedNodes: 1 };
    }

    const distances = new Map<string, number>();
    const previous = new Map<string, { nodeId: string; edge: GraphEdge } | null>();
    const unvisited = new Set<string>();

    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, nodeId === startId ? 0 : Infinity);
      previous.set(nodeId, null);
      unvisited.add(nodeId);
    }

    while (unvisited.size > 0) {
      let currentId: string | null = null;
      let minDist = Infinity;

      for (const id of unvisited) {
        const dist = distances.get(id)!;
        if (dist < minDist) {
          minDist = dist;
          currentId = id;
        }
      }

      if (!currentId || minDist === Infinity) break;
      if (currentId === endId) break;

      unvisited.delete(currentId);

      const edgeIds = this.adjacencyList.get(currentId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const neighborId = edge.source === currentId ? edge.target : edge.source;
        if (!unvisited.has(neighborId)) continue;

        const alt = minDist + edge.weight;
        if (alt < (distances.get(neighborId) ?? Infinity)) {
          distances.set(neighborId, alt);
          previous.set(neighborId, { nodeId: currentId, edge });
        }
      }
    }

    if (!previous.get(endId)) return null;

    const path: string[] = [];
    const edges: GraphEdge[] = [];
    let current: string | null = endId;

    while (current) {
      path.unshift(current);
      const prev = previous.get(current);
      if (prev) {
        edges.unshift(prev.edge);
        current = prev.nodeId;
      } else {
        current = null;
      }
    }

    return {
      path,
      edges,
      totalWeight: distances.get(endId) ?? 0,
      depth: path.length - 1,
      visitedNodes: this.nodes.size - unvisited.size,
    };
  }

  computePageRank(damping: number = 0.85, iterations: number = 20): Map<string, number> {
    const nodeCount = this.nodes.size;
    if (nodeCount === 0) return new Map();

    const ranks = new Map<string, number>();
    const initialRank = 1.0 / nodeCount;

    for (const nodeId of this.nodes.keys()) {
      ranks.set(nodeId, initialRank);
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map<string, number>();

      for (const nodeId of this.nodes.keys()) {
        let incomingRank = 0;

        const incomingEdges = this.reverseAdjacency.get(nodeId) || new Set();
        for (const edgeId of incomingEdges) {
          const edge = this.edges.get(edgeId);
          if (!edge) continue;

          const sourceId = edge.source === nodeId ? edge.target : edge.source;
          const sourceOutDegree = (this.adjacencyList.get(sourceId)?.size) || 1;
          incomingRank += (ranks.get(sourceId) || 0) / sourceOutDegree;
        }

        newRanks.set(nodeId, (1 - damping) / nodeCount + damping * incomingRank);
      }

      for (const [id, rank] of newRanks) {
        ranks.set(id, rank);
      }
    }

    return ranks;
  }

  findNodesByType(type: string): GraphNode[] {
    const typeKey = `type:${type}`;
    const nodeIds = this.nodeIndex.get(typeKey);
    if (!nodeIds) return [];

    return Array.from(nodeIds)
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  findEdgesByType(type: string): GraphEdge[] {
    const typeKey = `etype:${type}`;
    const edgeIds = this.edgeIndex.get(typeKey);
    if (!edgeIds) return [];

    return Array.from(edgeIds)
      .map((id) => this.edges.get(id))
      .filter((e): e is GraphEdge => e !== undefined);
  }

  query(graphQuery: GraphQuery): PatternMatch[] {
    const results: PatternMatch[] = [];

    switch (graphQuery.type) {
      case 'match':
        return this.executeMatchQuery(graphQuery);
      case 'neighbors':
        if (graphQuery.startNodeId) {
          const neighbors = this.getNeighbors(graphQuery.startNodeId, graphQuery.edgeType);
          return neighbors.map((n) => ({
            nodes: [n],
            edges: [],
            score: n.metadata.importance,
            pattern: 'neighbor',
          }));
        }
        break;
      case 'subgraph':
        return this.extractSubgraph(graphQuery);
    }

    return results;
  }

  getStats(): GraphStats {
    const nodeTypes: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
    }

    const edgeTypes: Record<string, number> = {};
    for (const edge of this.edges.values()) {
      edgeTypes[edge.type] = (edgeTypes[edge.type] || 0) + 1;
    }

    let maxDegree = 0;
    let totalDegree = 0;
    for (const edges of this.adjacencyList.values()) {
      const degree = edges.size;
      totalDegree += degree;
      maxDegree = Math.max(maxDegree, degree);
    }

    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.size;
    const avgDegree = nodeCount > 0 ? totalDegree / nodeCount : 0;
    const maxEdges = nodeCount * (nodeCount - 1);
    const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

    return {
      nodeCount,
      edgeCount,
      nodeTypes,
      edgeTypes,
      avgDegree,
      maxDegree,
      density,
      connectedComponents: this.countConnectedComponents(),
    };
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacencyList.clear();
    this.reverseAdjacency.clear();
    this.nodeIndex.clear();
    this.edgeIndex.clear();
  }

  private executeMatchQuery(graphQuery: GraphQuery): PatternMatch[] {
    let candidateNodes: GraphNode[] = [];

    if (graphQuery.nodeType) {
      candidateNodes = this.findNodesByType(graphQuery.nodeType);
    } else {
      candidateNodes = Array.from(this.nodes.values());
    }

    if (graphQuery.filters) {
      candidateNodes = candidateNodes.filter((node) =>
        graphQuery.filters!.every((filter) => this.matchesFilter(node, filter)),
      );
    }

    if (graphQuery.limit) {
      candidateNodes = candidateNodes.slice(0, graphQuery.limit);
    }

    return candidateNodes.map((node) => ({
      nodes: [node],
      edges: [],
      score: node.metadata.importance,
      pattern: 'match',
    }));
  }

  private extractSubgraph(graphQuery: GraphQuery): PatternMatch[] {
    if (!graphQuery.startNodeId) return [];

    const traversal = this.traverseBFS(
      graphQuery.startNodeId,
      graphQuery.maxDepth || 3,
      graphQuery.edgeType,
    );

    const nodes = traversal.path
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);

    return [
      {
        nodes,
        edges: traversal.edges,
        score: traversal.totalWeight,
        pattern: 'subgraph',
      },
    ];
  }

  private matchesFilter(node: GraphNode, filter: QueryFilter): boolean {
    const value = node.properties[filter.field];

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'neq':
        return value !== filter.value;
      case 'gt':
        return (value as number) > (filter.value as number);
      case 'lt':
        return (value as number) < (filter.value as number);
      case 'gte':
        return (value as number) >= (filter.value as number);
      case 'lte':
        return (value as number) <= (filter.value as number);
      case 'contains':
        return String(value).includes(String(filter.value));
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      default:
        return false;
    }
  }

  private countConnectedComponents(): number {
    const visited = new Set<string>();
    let components = 0;

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        components++;
        const stack = [nodeId];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);

          const edgeIds = this.adjacencyList.get(current) || new Set();
          for (const edgeId of edgeIds) {
            const edge = this.edges.get(edgeId);
            if (!edge) continue;
            const neighborId = edge.source === current ? edge.target : edge.source;
            if (!visited.has(neighborId)) {
              stack.push(neighborId);
            }
          }
        }
      }
    }

    return components;
  }
}

let graphInstance: GraphDatabaseEngine | null = null;

export function getGraphDatabase(): GraphDatabaseEngine {
  if (!graphInstance) {
    graphInstance = new GraphDatabaseEngine();
  }
  return graphInstance;
}
