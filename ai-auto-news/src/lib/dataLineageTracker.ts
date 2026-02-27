/**
 * @module dataLineageTracker
 * @description Data lineage and provenance tracking system. Records transformations
 * between data assets, supports upstream/downstream traversal at configurable depth,
 * performs column-level lineage, detects circular dependencies via DFS, computes
 * downstream impact, and exports lineage graphs in multiple formats.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface DataAsset {
  id: string;
  name: string;
  type: 'table' | 'view' | 'stream' | 'file' | 'api' | 'model' | 'report';
  system: string;
  database?: string;
  schema?: string;
  columns?: ColumnDef[];
  owner: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  pii: boolean;
  description?: string;
}

export interface TransformationRecord {
  id: string;
  name: string;
  type: 'etl' | 'ml_training' | 'aggregation' | 'join' | 'filter' | 'enrichment' | 'copy' | 'api_call';
  sourceAssets: string[];
  targetAssets: string[];
  columnMappings?: ColumnMapping[];
  logic?: string;
  executedBy: string;
  executedAt: Date;
  durationMs: number;
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}

export interface ColumnMapping {
  sourceAsset: string;
  sourceColumn: string;
  targetAsset: string;
  targetColumn: string;
  transformExpression?: string;
}

export interface LineageNode {
  assetId: string;
  asset: DataAsset;
  depth: number;
  direction: 'upstream' | 'downstream' | 'root';
}

export interface LineageEdge {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  transformation: TransformationRecord;
  columnMappings: ColumnMapping[];
}

export interface ProvenanceChain {
  assetId: string;
  chain: Array<{ asset: DataAsset; transformation?: TransformationRecord; timestamp: Date }>;
  verified: boolean;
  verificationIssues: string[];
}

export interface LineageQuery {
  assetId: string;
  direction: 'upstream' | 'downstream' | 'both';
  depth: number;
  system?: string;
  since?: Date;
  columnFilter?: string;
}

export interface ImpactAnalysis {
  sourceAssetId: string;
  impactedAssets: Array<{ assetId: string; assetName: string; depth: number; impactType: 'direct' | 'indirect' }>;
  criticalPaths: string[][];
  estimatedAffectedRows: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface LineageReport {
  rootAssetId: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  stats: LineageStats;
  generatedAt: Date;
}

export interface LineageStats {
  totalAssets: number;
  totalTransformations: number;
  maxDepth: number;
  systemsCovered: string[];
  avgTransformationDurationMs: number;
  piiColumnCount: number;
}

// ─── Graph Storage ────────────────────────────────────────────────────────────
export class DataLineageTracker {
  private assets          = new Map<string, DataAsset>();
  private transformations = new Map<string, TransformationRecord>();
  private edges           = new Map<string, LineageEdge>();
  // adjacency: assetId -> set of edge ids (outgoing)
  private outEdges        = new Map<string, Set<string>>();
  // adjacency: assetId -> set of edge ids (incoming)
  private inEdges         = new Map<string, Set<string>>();

  registerAsset(asset: DataAsset): void {
    this.assets.set(asset.id, asset);
    if (!this.outEdges.has(asset.id)) this.outEdges.set(asset.id, new Set());
    if (!this.inEdges.has(asset.id)) this.inEdges.set(asset.id, new Set());
    logger.debug('Asset registered', { assetId: asset.id, type: asset.type, system: asset.system });
  }

  recordTransformation(source: string | string[], target: string | string[], transform: TransformationRecord): LineageEdge[] {
    const sources = Array.isArray(source) ? source : [source];
    const targets = Array.isArray(target) ? target : [target];

    this.transformations.set(transform.id, transform);
    const createdEdges: LineageEdge[] = [];

    for (const src of sources) {
      for (const tgt of targets) {
        const edgeId = `edge_${src}_${tgt}_${transform.id}`;
        const mappings = (transform.columnMappings ?? []).filter(
          m => m.sourceAsset === src && m.targetAsset === tgt
        );
        const edge: LineageEdge = { id: edgeId, sourceAssetId: src, targetAssetId: tgt, transformation: transform, columnMappings: mappings };
        this.edges.set(edgeId, edge);
        if (!this.outEdges.has(src)) this.outEdges.set(src, new Set());
        if (!this.inEdges.has(tgt)) this.inEdges.set(tgt, new Set());
        this.outEdges.get(src)!.add(edgeId);
        this.inEdges.get(tgt)!.add(edgeId);
        createdEdges.push(edge);
      }
    }

    logger.info('Transformation recorded', { transformId: transform.id, sources, targets, edgeCount: createdEdges.length });
    return createdEdges;
  }

  queryLineage(assetId: string, direction: LineageQuery['direction'], depth: number): LineageNode[] {
    const visited = new Map<string, LineageNode>();
    const rootAsset = this.assets.get(assetId);
    if (rootAsset) {
      visited.set(assetId, { assetId, asset: rootAsset, depth: 0, direction: 'root' });
    }

    if (direction === 'upstream' || direction === 'both') {
      this.traverseUpstream(assetId, 0, depth, visited);
    }
    if (direction === 'downstream' || direction === 'both') {
      this.traverseDownstream(assetId, 0, depth, visited);
    }

    const nodes = Array.from(visited.values());
    logger.debug('Lineage query complete', { assetId, direction, depth, nodesFound: nodes.length });
    return nodes;
  }

  private traverseUpstream(assetId: string, currentDepth: number, maxDepth: number, visited: Map<string, LineageNode>): void {
    if (currentDepth >= maxDepth) return;
    const incomingEdgeIds = this.inEdges.get(assetId) ?? new Set();
    for (const edgeId of incomingEdgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      const srcId = edge.sourceAssetId;
      if (visited.has(srcId)) continue;
      const asset = this.assets.get(srcId);
      if (!asset) continue;
      visited.set(srcId, { assetId: srcId, asset, depth: currentDepth + 1, direction: 'upstream' });
      this.traverseUpstream(srcId, currentDepth + 1, maxDepth, visited);
    }
  }

  private traverseDownstream(assetId: string, currentDepth: number, maxDepth: number, visited: Map<string, LineageNode>): void {
    if (currentDepth >= maxDepth) return;
    const outgoingEdgeIds = this.outEdges.get(assetId) ?? new Set();
    for (const edgeId of outgoingEdgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      const tgtId = edge.targetAssetId;
      if (visited.has(tgtId)) continue;
      const asset = this.assets.get(tgtId);
      if (!asset) continue;
      visited.set(tgtId, { assetId: tgtId, asset, depth: currentDepth + 1, direction: 'downstream' });
      this.traverseDownstream(tgtId, currentDepth + 1, maxDepth, visited);
    }
  }

  computeImpact(assetId: string): ImpactAnalysis {
    const downstream = this.queryLineage(assetId, 'downstream', 10)
      .filter(n => n.direction === 'downstream');
    const directIds = new Set<string>();
    for (const edgeId of (this.outEdges.get(assetId) ?? new Set())) {
      const edge = this.edges.get(edgeId);
      if (edge) directIds.add(edge.targetAssetId);
    }

    const impacted = downstream.map(n => ({
      assetId: n.assetId, assetName: n.asset.name,
      depth: n.depth,
      impactType: (directIds.has(n.assetId) ? 'direct' : 'indirect') as 'direct' | 'indirect',
    }));

    const criticalPaths = this.findCriticalPaths(assetId, 5);
    const estimatedRows = downstream.reduce((s, n) => s + (n.asset.type === 'table' ? 100000 : 1000), 0);
    const riskLevel: ImpactAnalysis['riskLevel'] =
      impacted.length > 20 ? 'critical' :
      impacted.length > 10 ? 'high' :
      impacted.length > 4  ? 'medium' : 'low';

    logger.info('Impact analysis complete', { assetId, impactedCount: impacted.length, riskLevel });
    return { sourceAssetId: assetId, impactedAssets: impacted, criticalPaths, estimatedAffectedRows: estimatedRows, riskLevel };
  }

  private findCriticalPaths(startId: string, maxPaths: number): string[][] {
    const paths: string[][] = [];
    const dfs = (current: string, path: string[]) => {
      if (paths.length >= maxPaths) return;
      const outgoing = this.outEdges.get(current) ?? new Set();
      if (outgoing.size === 0) { paths.push([...path]); return; }
      for (const edgeId of outgoing) {
        const edge = this.edges.get(edgeId);
        if (!edge || path.includes(edge.targetAssetId)) continue;
        dfs(edge.targetAssetId, [...path, edge.targetAssetId]);
      }
    };
    dfs(startId, [startId]);
    return paths;
  }

  validateProvenance(assetId: string): ProvenanceChain {
    const chain: ProvenanceChain['chain'] = [];
    const issues: string[] = [];
    const nodes = this.queryLineage(assetId, 'upstream', 20);
    const sorted = nodes.sort((a, b) => b.depth - a.depth);

    for (const node of sorted) {
      const inEdgeIds = this.inEdges.get(node.assetId) ?? new Set();
      let transform: TransformationRecord | undefined;
      for (const edgeId of inEdgeIds) {
        const edge = this.edges.get(edgeId);
        if (edge) { transform = edge.transformation; break; }
      }
      chain.push({ asset: node.asset, transformation: transform, timestamp: transform?.executedAt ?? node.asset.createdAt });
    }

    // Validate timestamps are monotonically increasing
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].timestamp < chain[i - 1].timestamp) {
        issues.push(`Timestamp anomaly between ${chain[i - 1].asset.name} and ${chain[i].asset.name}`);
      }
    }
    // Check for gaps (assets with no upstream transforms but listed as non-root)
    for (const node of nodes.filter(n => n.direction === 'upstream')) {
      if ((this.inEdges.get(node.assetId) ?? new Set()).size === 0 && node.depth > 1) {
        issues.push(`Asset ${node.asset.name} has no recorded source transformation`);
      }
    }

    return { assetId, chain, verified: issues.length === 0, verificationIssues: issues };
  }

  generateLineageGraph(rootId: string): LineageReport {
    const nodes = this.queryLineage(rootId, 'both', 10);
    const nodeIds = new Set(nodes.map(n => n.assetId));
    const relevantEdges = Array.from(this.edges.values())
      .filter(e => nodeIds.has(e.sourceAssetId) && nodeIds.has(e.targetAssetId));

    const systems = [...new Set(nodes.map(n => n.asset.system))];
    const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const avgDur = relevantEdges.length > 0
      ? relevantEdges.reduce((s, e) => s + e.transformation.durationMs, 0) / relevantEdges.length
      : 0;
    const piiCols = nodes.reduce((s, n) =>
      s + (n.asset.columns?.filter(c => c.pii).length ?? 0), 0);

    const stats: LineageStats = {
      totalAssets: nodes.length, totalTransformations: relevantEdges.length,
      maxDepth, systemsCovered: systems, avgTransformationDurationMs: avgDur, piiColumnCount: piiCols,
    };
    logger.info('Lineage graph generated', { rootId, nodes: nodes.length, edges: relevantEdges.length });
    return { rootAssetId: rootId, nodes, edges: relevantEdges, stats, generatedAt: new Date() };
  }

  detectCircularDependency(assetId: string): string[] {
    const cycles: string[] = [];
    const visited  = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (current: string, path: string[]): boolean => {
      visited.add(current);
      recStack.add(current);
      for (const edgeId of (this.outEdges.get(current) ?? new Set())) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const next = edge.targetAssetId;
        if (!visited.has(next)) {
          if (dfs(next, [...path, next])) return true;
        } else if (recStack.has(next)) {
          const cycleStart = path.indexOf(next);
          cycles.push([...path.slice(cycleStart), next].join(' -> '));
          return true;
        }
      }
      recStack.delete(current);
      return false;
    };

    dfs(assetId, [assetId]);
    if (cycles.length > 0) logger.warn('Circular dependency detected', { assetId, cycles });
    return cycles;
  }

  exportLineage(format: 'json' | 'dot' | 'mermaid'): string {
    const allEdges = Array.from(this.edges.values());
    switch (format) {
      case 'dot': {
        const lines = ['digraph lineage {'];
        for (const [id, asset] of this.assets) lines.push(`  "${id}" [label="${asset.name}\\n(${asset.type})"];`);
        for (const edge of allEdges) lines.push(`  "${edge.sourceAssetId}" -> "${edge.targetAssetId}" [label="${edge.transformation.type}"];`);
        lines.push('}');
        return lines.join('\n');
      }
      case 'mermaid': {
        const lines = ['graph LR'];
        for (const edge of allEdges) {
          const src = this.assets.get(edge.sourceAssetId)?.name ?? edge.sourceAssetId;
          const tgt = this.assets.get(edge.targetAssetId)?.name ?? edge.targetAssetId;
          lines.push(`  ${edge.sourceAssetId}["${src}"] -->|${edge.transformation.type}| ${edge.targetAssetId}["${tgt}"]`);
        }
        return lines.join('\n');
      }
      default:
        return JSON.stringify({ assets: Array.from(this.assets.values()), edges: allEdges }, null, 2);
    }
  }

  getLineageStats(): LineageStats {
    const allEdges = Array.from(this.edges.values());
    const avgDur   = allEdges.length > 0
      ? allEdges.reduce((s, e) => s + e.transformation.durationMs, 0) / allEdges.length
      : 0;
    const piiCols  = Array.from(this.assets.values()).reduce((s, a) => s + (a.columns?.filter(c => c.pii).length ?? 0), 0);
    const systems  = [...new Set(Array.from(this.assets.values()).map(a => a.system))];
    const depths   = this.computeMaxDepth();
    return {
      totalAssets: this.assets.size, totalTransformations: this.transformations.size,
      maxDepth: depths, systemsCovered: systems,
      avgTransformationDurationMs: Math.round(avgDur), piiColumnCount: piiCols,
    };
  }

  private computeMaxDepth(): number {
    let max = 0;
    for (const assetId of this.assets.keys()) {
      if ((this.inEdges.get(assetId) ?? new Set()).size === 0) {
        const downstream = this.queryLineage(assetId, 'downstream', 100);
        max = Math.max(max, ...downstream.map(n => n.depth));
      }
    }
    return max;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export function getDataLineageTracker(): DataLineageTracker {
  if (!(globalThis as Record<string, unknown>).__dataLineageTracker__) {
    (globalThis as Record<string, unknown>).__dataLineageTracker__ = new DataLineageTracker();
  }
  return (globalThis as Record<string, unknown>).__dataLineageTracker__ as DataLineageTracker;
}
