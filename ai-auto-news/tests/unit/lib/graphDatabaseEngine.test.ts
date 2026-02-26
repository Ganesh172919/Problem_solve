import { describe, it, expect, beforeEach } from '@jest/globals';
import { GraphDatabaseEngine } from '@/lib/graphDatabaseEngine';

describe('GraphDatabaseEngine', () => {
  let graph: GraphDatabaseEngine;

  beforeEach(() => {
    graph = new GraphDatabaseEngine();
  });

  describe('addNode', () => {
    it('should add a node and return it', () => {
      const node = graph.addNode('n1', 'user', { name: 'Alice' });
      expect(node.id).toBe('n1');
      expect(node.type).toBe('user');
      expect(node.properties.name).toBe('Alice');
      expect(node.metadata.version).toBe(1);
    });

    it('should allow multiple nodes of different types', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      expect(graph.findNodesByType('user')).toHaveLength(1);
      expect(graph.findNodesByType('post')).toHaveLength(1);
    });
  });

  describe('getNode', () => {
    it('should retrieve an existing node', () => {
      graph.addNode('n1', 'user', { name: 'Bob' });
      const node = graph.getNode('n1');
      expect(node).toBeDefined();
      expect(node!.properties.name).toBe('Bob');
    });

    it('should return undefined for non-existent node', () => {
      expect(graph.getNode('missing')).toBeUndefined();
    });

    it('should increment access count', () => {
      graph.addNode('n1', 'user', {});
      graph.getNode('n1');
      graph.getNode('n1');
      const node = graph.getNode('n1');
      expect(node!.metadata.accessCount).toBe(3);
    });
  });

  describe('updateNode', () => {
    it('should update node properties', () => {
      graph.addNode('n1', 'user', { name: 'Alice' });
      const updated = graph.updateNode('n1', { name: 'Alice Updated', age: 30 });
      expect(updated).not.toBeNull();
      expect(updated!.properties.name).toBe('Alice Updated');
      expect(updated!.properties.age).toBe(30);
    });

    it('should return null for non-existent node', () => {
      expect(graph.updateNode('missing', {})).toBeNull();
    });
  });

  describe('removeNode', () => {
    it('should remove an existing node', () => {
      graph.addNode('n1', 'user', {});
      expect(graph.removeNode('n1')).toBe(true);
      expect(graph.getNode('n1')).toBeUndefined();
    });

    it('should return false for non-existent node', () => {
      expect(graph.removeNode('missing')).toBe(false);
    });
  });

  describe('addEdge', () => {
    it('should add an edge between existing nodes', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      const edge = graph.addEdge('n1', 'n2', 'authored', 1.0);
      expect(edge).not.toBeNull();
      expect(edge!.source).toBe('n1');
      expect(edge!.target).toBe('n2');
    });

    it('should return null if source node missing', () => {
      graph.addNode('n2', 'post', {});
      expect(graph.addEdge('missing', 'n2', 'authored')).toBeNull();
    });
  });

  describe('getNeighbors', () => {
    it('should return neighbor nodes', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      graph.addNode('n3', 'post', {});
      graph.addEdge('n1', 'n2', 'authored');
      graph.addEdge('n1', 'n3', 'authored');

      const neighbors = graph.getNeighbors('n1');
      expect(neighbors).toHaveLength(2);
    });

    it('should filter by edge type', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      graph.addNode('n3', 'user', {});
      graph.addEdge('n1', 'n2', 'authored');
      graph.addEdge('n1', 'n3', 'follows');

      const authored = graph.getNeighbors('n1', 'authored');
      expect(authored).toHaveLength(1);
      expect(authored[0].id).toBe('n2');
    });
  });

  describe('traverseBFS', () => {
    it('should traverse graph breadth-first', () => {
      graph.addNode('a', 'node', {});
      graph.addNode('b', 'node', {});
      graph.addNode('c', 'node', {});
      graph.addEdge('a', 'b', 'connects');
      graph.addEdge('b', 'c', 'connects');

      const result = graph.traverseBFS('a', 3);
      expect(result.visitedNodes).toBe(3);
      expect(result.depth).toBeGreaterThanOrEqual(1);
    });

    it('should respect max depth', () => {
      graph.addNode('a', 'node', {});
      graph.addNode('b', 'node', {});
      graph.addNode('c', 'node', {});
      graph.addEdge('a', 'b', 'connects');
      graph.addEdge('b', 'c', 'connects');

      const result = graph.traverseBFS('a', 1);
      expect(result.visitedNodes).toBeLessThanOrEqual(3);
    });
  });

  describe('findShortestPath', () => {
    it('should find shortest path between nodes', () => {
      graph.addNode('a', 'node', {});
      graph.addNode('b', 'node', {});
      graph.addNode('c', 'node', {});
      graph.addEdge('a', 'b', 'connects', 1.0);
      graph.addEdge('b', 'c', 'connects', 1.0);
      graph.addEdge('a', 'c', 'connects', 10.0);

      const path = graph.findShortestPath('a', 'c');
      expect(path).not.toBeNull();
      expect(path!.path).toEqual(['a', 'b', 'c']);
      expect(path!.totalWeight).toBe(2.0);
    });

    it('should return null when no path exists', () => {
      graph.addNode('a', 'node', {});
      graph.addNode('b', 'node', {});
      // No edges
      const path = graph.findShortestPath('a', 'b');
      expect(path).toBeNull();
    });

    it('should handle same start and end', () => {
      graph.addNode('a', 'node', {});
      const path = graph.findShortestPath('a', 'a');
      expect(path).not.toBeNull();
      expect(path!.path).toEqual(['a']);
      expect(path!.totalWeight).toBe(0);
    });
  });

  describe('computePageRank', () => {
    it('should compute PageRank scores', () => {
      graph.addNode('a', 'page', {});
      graph.addNode('b', 'page', {});
      graph.addNode('c', 'page', {});
      graph.addEdge('a', 'b', 'links');
      graph.addEdge('b', 'c', 'links');
      graph.addEdge('c', 'a', 'links');

      const ranks = graph.computePageRank(0.85, 20);
      expect(ranks.size).toBe(3);
      for (const rank of ranks.values()) {
        expect(rank).toBeGreaterThan(0);
      }
    });

    it('should return empty map for empty graph', () => {
      const ranks = graph.computePageRank();
      expect(ranks.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      graph.addEdge('n1', 'n2', 'authored');

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.edgeCount).toBe(1);
      expect(stats.nodeTypes.user).toBe(1);
      expect(stats.nodeTypes.post).toBe(1);
      expect(stats.edgeTypes.authored).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      graph.addNode('n1', 'user', {});
      graph.addNode('n2', 'post', {});
      graph.addEdge('n1', 'n2', 'authored');
      graph.clear();

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });
  });
});
