import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  name: string;
  type: 'person' | 'organization' | 'location' | 'topic' | 'product' | 'event' | 'concept';
  aliases: string[];
  properties: Record<string, unknown>;
  tfidfVector?: number[];
  mentionCount: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string; // e.g. 'mentions', 'related_to', 'part_of', 'created_by'
  weight: number; // 0–1
  evidence: string[];
  createdAt: Date;
}

export interface GraphNode {
  entity: Entity;
  inDegree: number;
  outDegree: number;
  pageRankScore: number;
  communityId?: string;
}

export interface GraphEdge {
  relationship: Relationship;
  sourceNode: GraphNode;
  targetNode: GraphNode;
}

export interface KnowledgeGraph {
  entityCount: number;
  relationshipCount: number;
  topEntities: Entity[];
  communities: EntityCluster[];
  lastUpdated: Date;
}

export interface EntityCluster {
  id: string;
  label: string;
  centroidEntityId: string;
  memberIds: string[];
  cohesionScore: number;
}

interface TFIDFCorpus {
  docCount: number;
  termDocFreq: Map<string, number>; // term -> number of docs containing it
}

// ─── Engine ──────────────────────────────────────────────────────────────────

// NER-style regex patterns
const NER_PATTERNS: Array<{ type: Entity['type']; pattern: RegExp }> = [
  { type: 'person',       pattern: /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g },
  { type: 'organization', pattern: /\b([A-Z][A-Za-z&]+(?:\s[A-Z][A-Za-z&]+){0,3}\s(?:Inc|Corp|LLC|Ltd|Co|Group|Foundation|Institute|University|College)\.?)\b/g },
  { type: 'location',     pattern: /\b(?:in|at|near|from)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/g },
  { type: 'topic',        pattern: /\b([A-Z][A-Z_]{2,})\b/g },
  { type: 'product',      pattern: /\b([A-Z][a-z]+(?:\s\d+)?(?:\sPro|Plus|Max|Ultra|Mini)?)\b/g },
];

class KnowledgeGraphEngine {
  private entities   = new Map<string, Entity>();
  private adjOut     = new Map<string, Set<string>>(); // entityId -> set of targetIds
  private adjIn      = new Map<string, Set<string>>(); // entityId -> set of sourceIds
  private rels       = new Map<string, Relationship>();
  private corpus: TFIDFCorpus = { docCount: 0, termDocFreq: new Map() };
  private vocabulary = new Map<string, number>(); // term -> index

  // ── Entity management ──────────────────────────────────────────────────────

  addEntity(entity: Omit<Entity, 'tfidfVector' | 'mentionCount' | 'firstSeen' | 'lastSeen'>): Entity {
    const existing = this.entities.get(entity.id);
    if (existing) {
      existing.mentionCount++;
      existing.lastSeen = new Date();
      Object.assign(existing.properties, entity.properties);
      return existing;
    }
    const full: Entity = {
      ...entity,
      mentionCount: 1,
      firstSeen: new Date(),
      lastSeen: new Date(),
    };
    this.entities.set(full.id, full);
    if (!this.adjOut.has(full.id)) this.adjOut.set(full.id, new Set());
    if (!this.adjIn.has(full.id))  this.adjIn.set(full.id, new Set());
    logger.info('Entity added to knowledge graph', { id: full.id, type: full.type, name: full.name });
    return full;
  }

  // ── Relationship management ────────────────────────────────────────────────

  addRelationship(rel: Omit<Relationship, 'id' | 'createdAt'>): Relationship {
    if (!this.entities.has(rel.sourceId)) throw new Error(`Source entity not found: ${rel.sourceId}`);
    if (!this.entities.has(rel.targetId)) throw new Error(`Target entity not found: ${rel.targetId}`);

    // Deduplicate by source+target+type
    const key = `${rel.sourceId}|${rel.targetId}|${rel.type}`;
    for (const existing of this.rels.values()) {
      if (`${existing.sourceId}|${existing.targetId}|${existing.type}` === key) {
        existing.weight = Math.min(1, existing.weight + 0.05);
        existing.evidence.push(...rel.evidence);
        return existing;
      }
    }

    const full: Relationship = {
      ...rel,
      id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
    };
    this.rels.set(full.id, full);
    this.adjOut.get(rel.sourceId)?.add(rel.targetId);
    this.adjIn.get(rel.targetId)?.add(rel.sourceId);
    return full;
  }

  // ── NER-style entity extraction ───────────────────────────────────────────

  extractEntities(text: string, sourceContentId?: string): Entity[] {
    const extracted: Entity[] = [];
    const seen = new Set<string>();

    for (const { type, pattern } of NER_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = (match[1] ?? match[0]).trim();
        if (name.length < 3 || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        const id = `ent_${type}_${name.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
        const entity = this.addEntity({
          id, name, type, aliases: [],
          properties: sourceContentId ? { sourceContent: sourceContentId } : {},
        });
        extracted.push(entity);
      }
    }

    // Update TF-IDF corpus
    this.updateCorpus(text);
    // Compute TF-IDF vectors for extracted entities
    for (const entity of extracted) {
      entity.tfidfVector = this.computeTFIDFVector(entity.name + ' ' + entity.aliases.join(' '));
    }

    logger.info('Entities extracted', { count: extracted.length, sourceContentId });
    return extracted;
  }

  // ── TF-IDF helpers ────────────────────────────────────────────────────────

  private tokenise(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  private updateCorpus(doc: string): void {
    const terms = new Set(this.tokenise(doc));
    for (const term of terms) {
      this.corpus.termDocFreq.set(term, (this.corpus.termDocFreq.get(term) ?? 0) + 1);
      if (!this.vocabulary.has(term)) this.vocabulary.set(term, this.vocabulary.size);
    }
    this.corpus.docCount++;
  }

  private computeTFIDFVector(text: string): number[] {
    const tokens = this.tokenise(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vector = new Array<number>(this.vocabulary.size).fill(0);
    for (const [term, freq] of tf) {
      const idx = this.vocabulary.get(term);
      if (idx === undefined) continue;
      const idf = Math.log((this.corpus.docCount + 1) / ((this.corpus.termDocFreq.get(term) ?? 0) + 1));
      vector[idx] = (freq / tokens.length) * idf;
    }
    return vector;
  }

  // ── Cosine similarity ─────────────────────────────────────────────────────

  computeSimilarity(entityIdA: string, entityIdB: string): number {
    const a = this.entities.get(entityIdA);
    const b = this.entities.get(entityIdB);
    if (!a || !b) return 0;

    if (!a.tfidfVector) a.tfidfVector = this.computeTFIDFVector(a.name + ' ' + a.aliases.join(' '));
    if (!b.tfidfVector) b.tfidfVector = this.computeTFIDFVector(b.name + ' ' + b.aliases.join(' '));

    const va = a.tfidfVector;
    const vb = b.tfidfVector;
    const len = Math.min(va.length, vb.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      dot   += va[i] * vb[i];
      normA += va[i] * va[i];
      normB += vb[i] * vb[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // ── Graph traversal ───────────────────────────────────────────────────────

  bfs(startId: string, maxDepth = 3): Entity[] {
    if (!this.entities.has(startId)) return [];
    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const result: Entity[] = [];
    while (queue.length) {
      const { id, depth } = queue.shift()!;
      const entity = this.entities.get(id);
      if (entity && id !== startId) result.push(entity);
      if (depth >= maxDepth) continue;
      for (const neighbourId of (this.adjOut.get(id) ?? [])) {
        if (!visited.has(neighbourId)) {
          visited.add(neighbourId);
          queue.push({ id: neighbourId, depth: depth + 1 });
        }
      }
    }
    return result;
  }

  dfs(startId: string, maxDepth = 3): Entity[] {
    const visited = new Set<string>();
    const result: Entity[] = [];
    const recurse = (id: string, depth: number) => {
      if (visited.has(id) || depth > maxDepth) return;
      visited.add(id);
      const entity = this.entities.get(id);
      if (entity && id !== startId) result.push(entity);
      for (const neighbourId of (this.adjOut.get(id) ?? [])) {
        recurse(neighbourId, depth + 1);
      }
    };
    recurse(startId, 0);
    return result;
  }

  // ── Related entities ──────────────────────────────────────────────────────

  findRelatedEntities(entityId: string, topK = 10): Array<{ entity: Entity; score: number }> {
    const cacheKey = `kg_related_${entityId}_${topK}`;
    const cached = cache.get<Array<{ entity: Entity; score: number }>>(cacheKey);
    if (cached) return cached;

    const scores: Array<{ entity: Entity; score: number }> = [];

    // Structural proximity (graph neighbours)
    const neighbours = new Set([
      ...(this.adjOut.get(entityId) ?? []),
      ...(this.adjIn.get(entityId) ?? []),
    ]);

    for (const [id, entity] of this.entities) {
      if (id === entityId) continue;
      const structuralScore = neighbours.has(id) ? 0.6 : 0;
      const semanticScore   = this.computeSimilarity(entityId, id) * 0.4;
      const total = structuralScore + semanticScore;
      if (total > 0.01) scores.push({ entity, score: total });
    }

    scores.sort((a, b) => b.score - a.score);
    const result = scores.slice(0, topK);
    cache.set(cacheKey, result, 300);
    return result;
  }

  // ── PageRank ──────────────────────────────────────────────────────────────

  private computePageRank(iterations = 20, damping = 0.85): Map<string, number> {
    const ids = Array.from(this.entities.keys());
    const n   = ids.length;
    if (n === 0) return new Map();
    const ranks = new Map<string, number>(ids.map(id => [id, 1 / n]));
    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map<string, number>(ids.map(id => [id, (1 - damping) / n]));
      for (const id of ids) {
        const outNeighbours = this.adjOut.get(id) ?? new Set();
        if (outNeighbours.size === 0) {
          // Dangling node: distribute rank equally
          const share = (damping * (ranks.get(id) ?? 0)) / n;
          for (const other of ids) newRanks.set(other, (newRanks.get(other) ?? 0) + share);
        } else {
          const share = (damping * (ranks.get(id) ?? 0)) / outNeighbours.size;
          for (const nb of outNeighbours) newRanks.set(nb, (newRanks.get(nb) ?? 0) + share);
        }
      }
      for (const [id, v] of newRanks) ranks.set(id, v);
    }
    return ranks;
  }

  // ── Topic clustering (k-means style) ─────────────────────────────────────

  clusterEntities(k = 5): EntityCluster[] {
    const cacheKey = `kg_clusters_${k}`;
    const cached = cache.get<EntityCluster[]>(cacheKey);
    if (cached) return cached;

    const entities = Array.from(this.entities.values()).filter(e => e.tfidfVector && e.tfidfVector.length > 0);
    if (entities.length < k) k = Math.max(1, entities.length);

    // Initialise centroids using k-means++ style seeding
    const centroids: number[][] = [entities[0].tfidfVector!.slice()];
    for (let i = 1; i < k; i++) {
      const dists = entities.map(e => {
        // Use sqrt(2*(1-sim)) as angular distance, clamped to [0,2] to handle sim outside [0,1]
        const minDist = centroids.reduce((m, c) => {
          const sim  = this.cosineSim(e.tfidfVector!, c);
          const dist = Math.sqrt(Math.max(0, 2 * (1 - sim)));
          return Math.min(m, dist);
        }, Infinity);
        return minDist;
      });
      const total = dists.reduce((a, b) => a + b, 0);
      let rnd = Math.random() * total;
      let idx = 0;
      for (; idx < dists.length - 1; idx++) {
        rnd -= dists[idx];
        if (rnd <= 0) break;
      }
      centroids.push(entities[idx].tfidfVector!.slice());
    }

    // k-means iterations
    const assignments = new Array<number>(entities.length).fill(0);
    for (let iter = 0; iter < 30; iter++) {
      let changed = false;
      for (let i = 0; i < entities.length; i++) {
        let best = 0, bestSim = -Infinity;
        for (let c = 0; c < k; c++) {
          const sim = this.cosineSim(entities[i].tfidfVector!, centroids[c]);
          if (sim > bestSim) { bestSim = sim; best = c; }
        }
        if (assignments[i] !== best) { assignments[i] = best; changed = true; }
      }
      if (!changed) break;
      // Recompute centroids
      for (let c = 0; c < k; c++) {
        const members = entities.filter((_, i) => assignments[i] === c);
        if (members.length === 0) continue;
        const dim = centroids[c].length;
        const newC = new Array<number>(dim).fill(0);
        for (const m of members) {
          for (let d = 0; d < dim; d++) newC[d] += (m.tfidfVector![d] ?? 0) / members.length;
        }
        centroids[c] = newC;
      }
    }

    // Build clusters
    const clusters: EntityCluster[] = [];
    for (let c = 0; c < k; c++) {
      const memberIds = entities.filter((_, i) => assignments[i] === c).map(e => e.id);
      if (memberIds.length === 0) continue;
      // Centroid entity = highest mention count
      const centroid = entities
        .filter((_, i) => assignments[i] === c)
        .sort((a, b) => b.mentionCount - a.mentionCount)[0];
      // Cohesion = average pairwise similarity (sample)
      const sample = memberIds.slice(0, 10);
      let cohesionSum = 0; let cohesionN = 0;
      for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
          cohesionSum += this.computeSimilarity(sample[i], sample[j]);
          cohesionN++;
        }
      }
      clusters.push({
        id: `cluster_${c}`,
        label: centroid.name,
        centroidEntityId: centroid.id,
        memberIds,
        cohesionScore: cohesionN > 0 ? cohesionSum / cohesionN : 0,
      });
    }

    cache.set(cacheKey, clusters, 600);
    return clusters;
  }

  private cosineSim(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d > 0 ? dot / d : 0;
  }

  // ── Graph-based recommendations ───────────────────────────────────────────

  getRecommendations(entityId: string, topK = 5): Entity[] {
    const related = this.findRelatedEntities(entityId, topK * 3);
    const ranks   = this.computePageRank();
    const scored  = related.map(r => ({
      entity: r.entity,
      score:  r.score * 0.7 + (ranks.get(r.entity.id) ?? 0) * 0.3,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.entity);
  }

  // ── Trending detection ────────────────────────────────────────────────────

  detectTrending(windowHours = 24, topK = 10): Array<{ entity: Entity; trendScore: number }> {
    const cutoff = Date.now() - windowHours * 3600000;
    const scores: Array<{ entity: Entity; trendScore: number }> = [];
    for (const entity of this.entities.values()) {
      if (entity.lastSeen.getTime() < cutoff) continue;
      // Trend score = recent mentions / age (hours) capped at windowHours
      const ageFraction = Math.max(1, (Date.now() - entity.firstSeen.getTime()) / 3600000);
      const trendScore = entity.mentionCount / Math.log(ageFraction + 1);
      scores.push({ entity, trendScore });
    }
    scores.sort((a, b) => b.trendScore - a.trendScore);
    return scores.slice(0, topK);
  }

  // ── Cross-content link suggestions ────────────────────────────────────────

  suggestLinks(contentText: string, topK = 5): Array<{ entity: Entity; relevance: number }> {
    const extracted = this.extractEntities(contentText);
    const candidates = new Map<string, number>();
    for (const ent of extracted) {
      const related = this.findRelatedEntities(ent.id, 10);
      for (const r of related) {
        candidates.set(r.entity.id, (candidates.get(r.entity.id) ?? 0) + r.score);
      }
    }
    const result = Array.from(candidates.entries())
      .map(([id, score]) => ({ entity: this.entities.get(id)!, relevance: score }))
      .filter(r => r.entity !== undefined)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, topK);
    logger.info('Link suggestions generated', { count: result.length });
    return result;
  }

  // ── Graph summary ─────────────────────────────────────────────────────────

  getGraphSummary(): KnowledgeGraph {
    const ranks = this.computePageRank();
    const topEntities = Array.from(this.entities.values())
      .map(e => ({ e, pr: ranks.get(e.id) ?? 0 }))
      .sort((a, b) => b.pr - a.pr)
      .slice(0, 10)
      .map(x => x.e);
    return {
      entityCount: this.entities.size,
      relationshipCount: this.rels.size,
      topEntities,
      communities: this.clusterEntities(),
      lastUpdated: new Date(),
    };
  }

  getNode(entityId: string): GraphNode | null {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    const ranks = this.computePageRank();
    return {
      entity,
      inDegree:  this.adjIn.get(entityId)?.size  ?? 0,
      outDegree: this.adjOut.get(entityId)?.size ?? 0,
      pageRankScore: ranks.get(entityId) ?? 0,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getKnowledgeGraphEngine(): KnowledgeGraphEngine {
  if (!(globalThis as any).__knowledgeGraphEngine__) {
    (globalThis as any).__knowledgeGraphEngine__ = new KnowledgeGraphEngine();
  }
  return (globalThis as any).__knowledgeGraphEngine__;
}
