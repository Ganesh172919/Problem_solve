import { describe, it, expect, beforeEach } from '@jest/globals';
import { getSearchEngine } from '../../../src/lib/multiModalSearchEngine';

describe('multiModalSearchEngine', () => {
  let engine: ReturnType<typeof getSearchEngine>;

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)['__multiModalSearchEngine__'];
    engine = getSearchEngine();
  });

  it('returns same singleton instance', () => {
    const a = getSearchEngine();
    const b = getSearchEngine();
    expect(a).toBe(b);
  });

  it('creates a search index', () => {
    const idx = engine.createIndex({ id: 'idx1', name: 'Articles', tenantId: 't1', description: 'desc', schema: { title: { type: 'text', searchable: true, filterable: false, facetable: false, sortable: false } }, language: 'en' });
    expect(idx.id).toBe('idx1');
    expect(idx.status).toBe('active');
  });

  it('throws on search with unknown index', () => {
    expect(() => engine.search({ indexId: 'missing', tenantId: 't1', query: 'test', mode: 'keyword', page: 1, pageSize: 10 })).toThrow();
  });

  it('indexes and retrieves a document', () => {
    engine.createIndex({ id: 'idx2', name: 'Docs', tenantId: 't1', description: '', schema: {}, language: 'en' });
    const doc = engine.indexDocument({ id: 'doc1', indexId: 'idx2', tenantId: 't1', fields: { title: 'Hello World', body: 'foo bar baz' } });
    expect(doc.id).toBe('doc1');
    const fetched = engine.getDocument('idx2', 'doc1');
    expect(fetched?.fields.title).toBe('Hello World');
  });

  it('performs keyword search and finds match', () => {
    engine.createIndex({ id: 'idx3', name: 'KW', tenantId: 't1', description: '', schema: { title: { type: 'text', searchable: true, filterable: false, facetable: false, sortable: false } }, language: 'en' });
    engine.indexDocument({ id: 'd1', indexId: 'idx3', tenantId: 't1', fields: { title: 'quantum computing research' } });
    engine.indexDocument({ id: 'd2', indexId: 'idx3', tenantId: 't1', fields: { title: 'machine learning algorithms' } });
    const result = engine.search({ indexId: 'idx3', tenantId: 't1', query: 'quantum computing', mode: 'keyword', page: 1, pageSize: 10 });
    expect(result.hits.some(h => h.documentId === 'd1')).toBe(true);
  });

  it('performs vector search and finds match', () => {
    engine.createIndex({ id: 'idx4', name: 'Vec', tenantId: 't1', description: '', schema: {}, language: 'en' });
    engine.indexDocument({ id: 'd1', indexId: 'idx4', tenantId: 't1', fields: { title: 'test' }, vector: [0.9, 0.1, 0.0] });
    engine.indexDocument({ id: 'd2', indexId: 'idx4', tenantId: 't1', fields: { title: 'other' }, vector: [0.0, 0.1, 0.9] });
    const result = engine.search({ indexId: 'idx4', tenantId: 't1', query: '', mode: 'vector', vector: [0.9, 0.1, 0.0], page: 1, pageSize: 10 });
    expect(result.hits.some(h => h.documentId === 'd1')).toBe(true);
  });

  it('enforces tenant isolation', () => {
    engine.createIndex({ id: 'idx5', name: 'Isolated', tenantId: 'tenantX', description: '', schema: {}, language: 'en' });
    expect(() => engine.search({ indexId: 'idx5', tenantId: 'tenantY', query: 'test', mode: 'keyword', page: 1, pageSize: 10 })).toThrow();
  });

  it('bulk indexes documents', () => {
    engine.createIndex({ id: 'idx6', name: 'Bulk', tenantId: 't1', description: '', schema: {}, language: 'en' });
    const count = engine.bulkIndex('idx6', [
      { id: 'b1', indexId: 'idx6', tenantId: 't1', fields: { title: 'first doc' } },
      { id: 'b2', indexId: 'idx6', tenantId: 't1', fields: { title: 'second doc' } },
      { id: 'b3', indexId: 'idx6', tenantId: 't1', fields: { title: 'third doc' } },
    ]);
    expect(count).toBe(3);
    const idx = engine.getIndex('idx6');
    expect(idx?.documentCount).toBe(3);
  });

  it('deletes a document', () => {
    engine.createIndex({ id: 'idx7', name: 'Del', tenantId: 't1', description: '', schema: {}, language: 'en' });
    engine.indexDocument({ id: 'delDoc', indexId: 'idx7', tenantId: 't1', fields: { title: 'delete me' } });
    engine.deleteDocument('idx7', 'delDoc');
    expect(engine.getDocument('idx7', 'delDoc')).toBeUndefined();
  });

  it('applies filters correctly', () => {
    engine.createIndex({ id: 'idx8', name: 'Filter', tenantId: 't1', description: '', schema: { status: { type: 'keyword', searchable: false, filterable: true, facetable: true, sortable: false } }, language: 'en' });
    engine.indexDocument({ id: 'f1', indexId: 'idx8', tenantId: 't1', fields: { title: 'active item', status: 'active' } });
    engine.indexDocument({ id: 'f2', indexId: 'idx8', tenantId: 't1', fields: { title: 'inactive item', status: 'inactive' } });
    const result = engine.search({ indexId: 'idx8', tenantId: 't1', query: 'item', mode: 'keyword', filters: [{ field: 'status', operator: 'eq', value: 'active' }], page: 1, pageSize: 10 });
    expect(result.hits.every(h => h.fields.status === 'active')).toBe(true);
  });

  it('getSummary returns correct structure', () => {
    const summary = engine.getSummary();
    expect(typeof summary.totalIndexes).toBe('number');
    expect(typeof summary.totalDocuments).toBe('number');
    expect(typeof summary.avgLatencyMs).toBe('number');
  });

  it('generates analytics after search', () => {
    engine.createIndex({ id: 'idx9', name: 'Analytics', tenantId: 't1', description: '', schema: {}, language: 'en' });
    engine.indexDocument({ id: 'a1', indexId: 'idx9', tenantId: 't1', fields: { content: 'analytics platform reporting' } });
    engine.search({ indexId: 'idx9', tenantId: 't1', query: 'analytics', mode: 'keyword', page: 1, pageSize: 10 });
    const analytics = engine.getAnalytics('idx9');
    expect(analytics.totalQueries).toBeGreaterThan(0);
  });

  it('hybrid search combines scores', () => {
    engine.createIndex({ id: 'idx10', name: 'Hybrid', tenantId: 't1', description: '', schema: {}, language: 'en' });
    engine.indexDocument({ id: 'h1', indexId: 'idx10', tenantId: 't1', fields: { title: 'artificial intelligence systems' }, vector: [0.8, 0.2] });
    engine.indexDocument({ id: 'h2', indexId: 'idx10', tenantId: 't1', fields: { title: 'database management' }, vector: [0.1, 0.9] });
    const result = engine.search({ indexId: 'idx10', tenantId: 't1', query: 'intelligence', mode: 'hybrid', vector: [0.8, 0.2], semanticWeight: 0.5, page: 1, pageSize: 10 });
    expect(Array.isArray(result.hits)).toBe(true);
  });
});
