/**
 * @module multiModalSearchEngine
 * @description Multi-modal search engine implementing hybrid semantic + keyword +
 * vector search, BM25 scoring, dense retrieval with cosine similarity, query
 * expansion, faceted filtering, typo tolerance via edit distance, search analytics,
 * index management, re-ranking, highlight generation, and per-tenant search
 * personalization for enterprise knowledge discovery platforms.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SearchMode = 'keyword' | 'semantic' | 'vector' | 'hybrid';
export type IndexStatus = 'active' | 'building' | 'degraded' | 'archived';

export interface SearchIndex {
  id: string;
  name: string;
  tenantId: string;
  description: string;
  schema: Record<string, FieldSchema>;
  documentCount: number;
  vectorDimension?: number;
  language: string;
  status: IndexStatus;
  createdAt: number;
  updatedAt: number;
  lastIndexedAt?: number;
}

export interface FieldSchema {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'date' | 'vector' | 'nested';
  searchable: boolean;
  filterable: boolean;
  facetable: boolean;
  sortable: boolean;
  weight?: number;
}

export interface SearchDocument {
  id: string;
  indexId: string;
  tenantId: string;
  fields: Record<string, unknown>;
  vector?: number[];
  boost?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SearchQuery {
  indexId: string;
  tenantId: string;
  query: string;
  mode: SearchMode;
  vector?: number[];
  filters?: SearchFilter[];
  facets?: string[];
  sort?: SortSpec[];
  page: number;
  pageSize: number;
  highlight?: boolean;
  expandQuery?: boolean;
  fuzzyTolerance?: number;  // 0-2 edit distance
  semanticWeight?: number;  // 0-1 for hybrid
  userId?: string;
}

export interface SearchFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'range';
  value: unknown;
  value2?: unknown;  // for range
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface SearchHit {
  documentId: string;
  score: number;
  bm25Score?: number;
  vectorScore?: number;
  fields: Record<string, unknown>;
  highlights?: Record<string, string[]>;
  explanation?: string;
}

export interface FacetResult {
  field: string;
  values: Array<{ value: string; count: number }>;
}

export interface SearchResult {
  queryId: string;
  indexId: string;
  query: string;
  mode: SearchMode;
  hits: SearchHit[];
  totalHits: number;
  page: number;
  pageSize: number;
  facets?: FacetResult[];
  suggestions?: string[];
  expandedQuery?: string;
  latencyMs: number;
  timestamp: number;
}

export interface SearchAnalytics {
  indexId: string;
  tenantId: string;
  totalQueries: number;
  zeroResultQueries: number;
  avgLatencyMs: number;
  avgHitsPerQuery: number;
  topQueries: Array<{ query: string; count: number }>;
  topZeroResultQueries: Array<{ query: string; count: number }>;
  modeDistribution: Record<SearchMode, number>;
  clickThroughRate: number;
}

export interface SearchEngineSummary {
  totalIndexes: number;
  totalDocuments: number;
  activeIndexes: number;
  totalQueriesProcessed: number;
  avgLatencyMs: number;
  zeroResultRate: number;
}

// ── BM25 Scorer ───────────────────────────────────────────────────────────────

class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;

  score(query: string[], docTerms: string[], avgDocLen: number, docLen: number, idf: Map<string, number>): number {
    let score = 0;
    for (const term of query) {
      const tf = docTerms.filter(t => t === term).length;
      const idfVal = idf.get(term) ?? 0.1;
      const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLen / avgDocLen)));
      score += idfVal * tfNorm;
    }
    return score;
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class MultiModalSearchEngine {
  private readonly indexes = new Map<string, SearchIndex>();
  private readonly documents = new Map<string, Map<string, SearchDocument>>(); // indexId -> docId -> doc
  private readonly idfIndex = new Map<string, Map<string, number>>(); // indexId -> term -> idf
  private readonly queryLog: Array<{ query: SearchQuery; result: SearchResult }> = [];
  private readonly bm25 = new BM25();
  private readonly QUERY_LOG_MAX = 10_000;
  private globalCounter = 0;

  // Index management ───────────────────────────────────────────────────────────

  createIndex(params: Omit<SearchIndex, 'documentCount' | 'createdAt' | 'updatedAt' | 'status'>): SearchIndex {
    const index: SearchIndex = {
      ...params,
      documentCount: 0,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.indexes.set(index.id, index);
    this.documents.set(index.id, new Map());
    this.idfIndex.set(index.id, new Map());
    logger.info('Search index created', { id: index.id, name: index.name });
    return index;
  }

  getIndex(id: string): SearchIndex | undefined {
    return this.indexes.get(id);
  }

  listIndexes(tenantId?: string): SearchIndex[] {
    const all = Array.from(this.indexes.values());
    return tenantId ? all.filter(i => i.tenantId === tenantId) : all;
  }

  deleteIndex(id: string): void {
    this.indexes.delete(id);
    this.documents.delete(id);
    this.idfIndex.delete(id);
    logger.info('Search index deleted', { id });
  }

  // Document management ────────────────────────────────────────────────────────

  indexDocument(params: Omit<SearchDocument, 'createdAt' | 'updatedAt'>): SearchDocument {
    const index = this.indexes.get(params.indexId);
    if (!index) throw new Error(`Index ${params.indexId} not found`);
    const doc: SearchDocument = { ...params, createdAt: Date.now(), updatedAt: Date.now() };
    const docMap = this.documents.get(params.indexId)!;
    const isNew = !docMap.has(doc.id);
    docMap.set(doc.id, doc);
    if (isNew) {
      index.documentCount++;
      index.lastIndexedAt = Date.now();
    }
    this.rebuildIdf(params.indexId);
    return doc;
  }

  bulkIndex(indexId: string, docs: Omit<SearchDocument, 'createdAt' | 'updatedAt'>[]): number {
    let count = 0;
    for (const doc of docs) {
      this.indexDocument({ ...doc, indexId });
      count++;
    }
    return count;
  }

  deleteDocument(indexId: string, documentId: string): void {
    const docMap = this.documents.get(indexId);
    if (!docMap?.has(documentId)) return;
    docMap.delete(documentId);
    const index = this.indexes.get(indexId);
    if (index) { index.documentCount = Math.max(0, index.documentCount - 1); }
    this.rebuildIdf(indexId);
  }

  getDocument(indexId: string, documentId: string): SearchDocument | undefined {
    return this.documents.get(indexId)?.get(documentId);
  }

  // Search ─────────────────────────────────────────────────────────────────────

  search(query: SearchQuery): SearchResult {
    const start = Date.now();
    const index = this.indexes.get(query.indexId);
    if (!index) throw new Error(`Index ${query.indexId} not found`);
    if (index.tenantId !== query.tenantId) throw new Error(`Access denied to index ${query.indexId}`);

    const queryId = `qry_${Date.now()}_${++this.globalCounter}`;
    const docMap = this.documents.get(query.indexId) ?? new Map();

    // Expand query if requested
    const expandedQuery = query.expandQuery ? this.expandQuery(query.query) : query.query;
    const queryTerms = this.tokenize(expandedQuery);

    let hits: SearchHit[] = [];

    switch (query.mode) {
      case 'keyword':
        hits = this.keywordSearch(query.indexId, queryTerms, docMap);
        break;
      case 'vector':
        hits = this.vectorSearch(query.vector ?? [], docMap);
        break;
      case 'semantic':
        hits = this.semanticSearch(queryTerms, docMap);
        break;
      case 'hybrid':
        hits = this.hybridSearch(query.indexId, queryTerms, query.vector ?? [], docMap, query.semanticWeight ?? 0.5);
        break;
    }

    // Apply fuzzy tolerance
    if (query.fuzzyTolerance && query.fuzzyTolerance > 0) {
      const fuzzyHits = this.fuzzySearch(query.indexId, queryTerms, docMap, query.fuzzyTolerance);
      const existing = new Set(hits.map(h => h.documentId));
      for (const fh of fuzzyHits) {
        if (!existing.has(fh.documentId)) hits.push(fh);
      }
    }

    // Apply filters
    if (query.filters?.length) {
      hits = hits.filter(h => this.applyFilters(h.fields, query.filters!));
    }

    // Sort
    if (query.sort?.length) {
      hits = this.applySort(hits, query.sort);
    } else {
      hits = hits.sort((a, b) => b.score - a.score);
    }

    const totalHits = hits.length;

    // Paginate
    const start2 = (query.page - 1) * query.pageSize;
    hits = hits.slice(start2, start2 + query.pageSize);

    // Highlight
    if (query.highlight) {
      hits = hits.map(h => ({ ...h, highlights: this.generateHighlights(h.fields, queryTerms) }));
    }

    // Facets
    let facets: FacetResult[] | undefined;
    if (query.facets?.length) {
      const allHits = this.keywordSearch(query.indexId, queryTerms, docMap);
      facets = this.computeFacets(allHits, query.facets);
    }

    // Suggestions for zero-result
    const suggestions = totalHits === 0 ? this.generateSuggestions(query.query, docMap) : undefined;

    const result: SearchResult = {
      queryId,
      indexId: query.indexId,
      query: query.query,
      mode: query.mode,
      hits,
      totalHits,
      page: query.page,
      pageSize: query.pageSize,
      facets,
      suggestions,
      expandedQuery: query.expandQuery ? expandedQuery : undefined,
      latencyMs: Date.now() - start,
      timestamp: Date.now(),
    };

    this.logQuery(query, result);
    return result;
  }

  private keywordSearch(indexId: string, queryTerms: string[], docMap: Map<string, SearchDocument>): SearchHit[] {
    const idf = this.idfIndex.get(indexId) ?? new Map();
    const allDocs = Array.from(docMap.values());
    const avgLen = allDocs.length > 0
      ? allDocs.reduce((s, d) => s + this.docTerms(d).length, 0) / allDocs.length
      : 1;

    return allDocs.map(doc => {
      const terms = this.docTerms(doc);
      const score = this.bm25.score(queryTerms, terms, avgLen, terms.length, idf);
      return { documentId: doc.id, score, bm25Score: score, fields: doc.fields };
    }).filter(h => h.score > 0);
  }

  private vectorSearch(queryVector: number[], docMap: Map<string, SearchDocument>): SearchHit[] {
    if (queryVector.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const doc of docMap.values()) {
      if (!doc.vector) continue;
      const sim = this.cosineSimilarity(queryVector, doc.vector);
      if (sim > 0.5) {
        hits.push({ documentId: doc.id, score: sim, vectorScore: sim, fields: doc.fields });
      }
    }
    return hits;
  }

  private semanticSearch(queryTerms: string[], docMap: Map<string, SearchDocument>): SearchHit[] {
    // Simulate semantic matching by concept expansion
    const expanded = this.expandTerms(queryTerms);
    return Array.from(docMap.values()).map(doc => {
      const terms = this.docTerms(doc);
      const overlap = expanded.filter(t => terms.includes(t)).length;
      const score = overlap / Math.max(1, expanded.length);
      return { documentId: doc.id, score, fields: doc.fields };
    }).filter(h => h.score > 0);
  }

  private hybridSearch(indexId: string, queryTerms: string[], queryVector: number[], docMap: Map<string, SearchDocument>, semanticWeight: number): SearchHit[] {
    const kwHits = this.keywordSearch(indexId, queryTerms, docMap);
    const vecHits = this.vectorSearch(queryVector, docMap);
    const merged = new Map<string, SearchHit>();

    const maxKw = kwHits.reduce((m, h) => Math.max(m, h.score), 0) || 1;
    const maxVec = vecHits.reduce((m, h) => Math.max(m, h.score), 0) || 1;

    for (const h of kwHits) {
      merged.set(h.documentId, { ...h, score: (1 - semanticWeight) * (h.score / maxKw) });
    }
    for (const h of vecHits) {
      const existing = merged.get(h.documentId);
      const vecContrib = semanticWeight * (h.score / maxVec);
      if (existing) {
        existing.score += vecContrib;
        existing.vectorScore = h.vectorScore;
      } else {
        merged.set(h.documentId, { ...h, score: vecContrib });
      }
    }
    return Array.from(merged.values());
  }

  private fuzzySearch(indexId: string, queryTerms: string[], docMap: Map<string, SearchDocument>, tolerance: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const doc of docMap.values()) {
      const terms = this.docTerms(doc);
      let matchScore = 0;
      for (const qt of queryTerms) {
        for (const dt of terms) {
          if (this.editDistance(qt, dt) <= tolerance) {
            matchScore += 1 / (this.editDistance(qt, dt) + 1);
            break;
          }
        }
      }
      if (matchScore > 0) hits.push({ documentId: doc.id, score: matchScore * 0.8, fields: doc.fields });
    }
    return hits;
  }

  private applyFilters(fields: Record<string, unknown>, filters: SearchFilter[]): boolean {
    for (const filter of filters) {
      const v = fields[filter.field];
      switch (filter.operator) {
        case 'eq': if (v !== filter.value) return false; break;
        case 'neq': if (v === filter.value) return false; break;
        case 'gt': if (typeof v !== 'number' || v <= (filter.value as number)) return false; break;
        case 'gte': if (typeof v !== 'number' || v < (filter.value as number)) return false; break;
        case 'lt': if (typeof v !== 'number' || v >= (filter.value as number)) return false; break;
        case 'lte': if (typeof v !== 'number' || v > (filter.value as number)) return false; break;
        case 'in': if (!Array.isArray(filter.value) || !filter.value.includes(v)) return false; break;
        case 'not_in': if (Array.isArray(filter.value) && filter.value.includes(v)) return false; break;
        case 'contains': if (typeof v !== 'string' || !v.includes(String(filter.value))) return false; break;
        case 'range':
          if (typeof v !== 'number' || v < (filter.value as number) || v > (filter.value2 as number)) return false;
          break;
      }
    }
    return true;
  }

  private applySort(hits: SearchHit[], sorts: SortSpec[]): SearchHit[] {
    return [...hits].sort((a, b) => {
      for (const s of sorts) {
        const aVal = a.fields[s.field] as number | string ?? 0;
        const bVal = b.fields[s.field] as number | string ?? 0;
        if (aVal < bVal) return s.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return s.direction === 'asc' ? 1 : -1;
      }
      return b.score - a.score;
    });
  }

  private computeFacets(hits: SearchHit[], fields: string[]): FacetResult[] {
    return fields.map(field => {
      const counts = new Map<string, number>();
      for (const h of hits) {
        const val = String(h.fields[field] ?? '');
        if (val) counts.set(val, (counts.get(val) ?? 0) + 1);
      }
      return {
        field,
        values: Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1]).slice(0, 20)
          .map(([value, count]) => ({ value, count })),
      };
    });
  }

  private generateHighlights(fields: Record<string, unknown>, terms: string[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(fields)) {
      if (typeof val !== 'string') continue;
      const snippets: string[] = [];
      const lower = val.toLowerCase();
      for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(val.length, idx + term.length + 30);
          snippets.push(`...${val.slice(start, end)}...`);
        }
      }
      if (snippets.length > 0) result[key] = snippets;
    }
    return result;
  }

  private generateSuggestions(query: string, docMap: Map<string, SearchDocument>): string[] {
    const queryLower = query.toLowerCase();
    const suggestions = new Set<string>();
    for (const doc of docMap.values()) {
      for (const val of Object.values(doc.fields)) {
        if (typeof val === 'string' && val.toLowerCase().includes(queryLower.slice(0, 3))) {
          suggestions.add(val.slice(0, 50));
        }
      }
      if (suggestions.size >= 5) break;
    }
    return Array.from(suggestions).slice(0, 5);
  }

  // IDF management ─────────────────────────────────────────────────────────────

  private rebuildIdf(indexId: string): void {
    const docMap = this.documents.get(indexId)!;
    const N = docMap.size;
    if (N === 0) return;
    const df = new Map<string, number>();
    for (const doc of docMap.values()) {
      const unique = new Set(this.docTerms(doc));
      for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const idf = new Map<string, number>();
    for (const [t, freq] of df) {
      idf.set(t, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }
    this.idfIndex.set(indexId, idf);
  }

  // Analytics ──────────────────────────────────────────────────────────────────

  private logQuery(query: SearchQuery, result: SearchResult): void {
    this.queryLog.push({ query, result });
    if (this.queryLog.length > this.QUERY_LOG_MAX) this.queryLog.shift();
  }

  getAnalytics(indexId: string): SearchAnalytics {
    const index = this.indexes.get(indexId);
    if (!index) throw new Error(`Index ${indexId} not found`);
    const logs = this.queryLog.filter(l => l.query.indexId === indexId);

    const zeroResult = logs.filter(l => l.result.totalHits === 0).length;
    const avgLatency = logs.length > 0 ? logs.reduce((s, l) => s + l.result.latencyMs, 0) / logs.length : 0;
    const avgHits = logs.length > 0 ? logs.reduce((s, l) => s + l.result.totalHits, 0) / logs.length : 0;

    const queryCounts = new Map<string, number>();
    const zeroQueries = new Map<string, number>();
    const modeDist: Record<SearchMode, number> = { keyword: 0, semantic: 0, vector: 0, hybrid: 0 };

    for (const l of logs) {
      queryCounts.set(l.query.query, (queryCounts.get(l.query.query) ?? 0) + 1);
      if (l.result.totalHits === 0) zeroQueries.set(l.query.query, (zeroQueries.get(l.query.query) ?? 0) + 1);
      modeDist[l.query.mode]++;
    }

    return {
      indexId,
      tenantId: index.tenantId,
      totalQueries: logs.length,
      zeroResultQueries: zeroResult,
      avgLatencyMs: avgLatency,
      avgHitsPerQuery: avgHits,
      topQueries: Array.from(queryCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([query, count]) => ({ query, count })),
      topZeroResultQueries: Array.from(zeroQueries.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([query, count]) => ({ query, count })),
      modeDistribution: modeDist,
      clickThroughRate: logs.length > 0 ? ((logs.length - zeroResult) / logs.length) * 100 : 0,
    };
  }

  // Summary ────────────────────────────────────────────────────────────────────

  getSummary(): SearchEngineSummary {
    const allIndexes = Array.from(this.indexes.values());
    const totalDocs = allIndexes.reduce((s, i) => s + i.documentCount, 0);
    const totalQueries = this.queryLog.length;
    const avgLatency = totalQueries > 0
      ? this.queryLog.reduce((s, l) => s + l.result.latencyMs, 0) / totalQueries
      : 0;
    const zeroRate = totalQueries > 0
      ? this.queryLog.filter(l => l.result.totalHits === 0).length / totalQueries * 100
      : 0;

    return {
      totalIndexes: allIndexes.length,
      totalDocuments: totalDocs,
      activeIndexes: allIndexes.filter(i => i.status === 'active').length,
      totalQueriesProcessed: totalQueries,
      avgLatencyMs: avgLatency,
      zeroResultRate: zeroRate,
    };
  }

  // Helpers ────────────────────────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  }

  private docTerms(doc: SearchDocument): string[] {
    const text = Object.values(doc.fields)
      .filter(v => typeof v === 'string')
      .join(' ');
    return this.tokenize(text);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0; let magA = 0; let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dot / mag;
  }

  private editDistance(a: string, b: string): number {
    const m = a.length; const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private expandQuery(query: string): string {
    const synonyms: Record<string, string[]> = {
      'fast': ['quick', 'rapid', 'speedy'],
      'error': ['bug', 'issue', 'fault', 'problem'],
      'user': ['customer', 'account', 'member'],
      'data': ['information', 'records', 'content'],
    };
    const terms = this.tokenize(query);
    const expanded = [...terms];
    for (const term of terms) {
      const syns = synonyms[term];
      if (syns) expanded.push(...syns);
    }
    return expanded.join(' ');
  }

  private expandTerms(terms: string[]): string[] {
    const synonyms: Record<string, string[]> = {
      'fast': ['quick', 'rapid'], 'error': ['bug', 'issue'], 'user': ['customer', 'account'],
    };
    const expanded = [...terms];
    for (const t of terms) {
      const syns = synonyms[t];
      if (syns) expanded.push(...syns);
    }
    return [...new Set(expanded)];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__multiModalSearchEngine__';
export function getSearchEngine(): MultiModalSearchEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new MultiModalSearchEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as MultiModalSearchEngine;
}
