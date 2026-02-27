import { describe, it, expect, beforeEach } from '@jest/globals';
import { NLPPipelineEngine } from '@/lib/nlpPipelineEngine';

describe('NLPPipelineEngine', () => {
  let nlp: NLPPipelineEngine;

  beforeEach(() => {
    nlp = new NLPPipelineEngine({
      enableEmbeddings: true,
      summaryLength: 'short',
    });
  });

  describe('process', () => {
    it('should process a document and return NLPDocument', () => {
      const doc = nlp.process('doc-1', 'This is a great product. The technology is amazing.');
      expect(doc.id).toBe('doc-1');
      expect(doc.tokens.length).toBeGreaterThan(0);
      expect(doc.sentences.length).toBeGreaterThan(0);
      expect(doc.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should perform tokenization', () => {
      const doc = nlp.process('doc-2', 'Hello world, this is a test.');
      expect(doc.tokens.length).toBeGreaterThan(0);
      expect(doc.tokens[0].text).toBeDefined();
      expect(doc.tokens[0].pos).toBeDefined();
    });

    it('should analyze sentiment', () => {
      const posDoc = nlp.process('pos-1', 'This is excellent, amazing, and wonderful!');
      expect(['positive', 'neutral', 'negative', 'mixed']).toContain(posDoc.sentiment.label);
      expect(posDoc.sentiment.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should extract key phrases', () => {
      const doc = nlp.process('kp-1', 'The machine learning algorithm is very efficient and powerful for data analysis.');
      expect(doc.keyPhrases).toBeDefined();
    });

    it('should classify document into categories', () => {
      const doc = nlp.process('cls-1', 'The software system uses advanced algorithms and data structures for computation.');
      expect(doc.classifications.length).toBeGreaterThan(0);
      expect(doc.classifications[0].label).toBeDefined();
      expect(doc.classifications[0].score).toBeGreaterThanOrEqual(0);
    });

    it('should compute embeddings', () => {
      const doc = nlp.process('emb-1', 'Natural language processing is a field of artificial intelligence.');
      expect(doc.embeddings).toBeDefined();
      expect(doc.embeddings!.length).toBe(128);
    });

    it('should extract topics', () => {
      const doc = nlp.process('topic-1', 'Machine learning deep neural network training optimization gradient descent backpropagation.');
      expect(doc.topics.length).toBeGreaterThan(0);
    });

    it('should generate summary', () => {
      const doc = nlp.process('sum-1', 'The first sentence is very important. The second sentence provides context. The third sentence concludes the topic.');
      expect(doc.summary).toBeDefined();
    });

    it('should store document for retrieval', () => {
      nlp.process('stored-1', 'Test document content.');
      const retrieved = nlp.getDocument('stored-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('stored-1');
    });
  });

  describe('processBatch', () => {
    it('should process multiple documents', () => {
      const docs = [
        { id: 'b1', content: 'First document about technology.' },
        { id: 'b2', content: 'Second document about business.' },
        { id: 'b3', content: 'Third document about science.' },
      ];
      const result = nlp.processBatch(docs);
      expect(result.totalProcessed).toBe(3);
      expect(result.documents.length).toBe(3);
      expect(result.failedIds.length).toBe(0);
      expect(result.batchTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should report average processing time', () => {
      const docs = [{ id: 'x1', content: 'Test.' }, { id: 'x2', content: 'Test.' }];
      const result = nlp.processBatch(docs);
      expect(result.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeSimilarity', () => {
    it('should compute similarity between two documents', () => {
      nlp.process('sim-1', 'Machine learning is a branch of artificial intelligence.');
      nlp.process('sim-2', 'Artificial intelligence includes machine learning techniques.');
      const result = nlp.computeSimilarity('sim-1', 'sim-2');
      expect(result.jaccardSimilarity).toBeGreaterThanOrEqual(0);
      expect(result.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(result.semanticSimilarity).toBeGreaterThanOrEqual(0);
    });

    it('should throw if documents not found', () => {
      expect(() => nlp.computeSimilarity('nonexistent-a', 'nonexistent-b')).toThrow('Documents not found');
    });
  });

  describe('computeTextMetrics', () => {
    it('should compute text metrics', () => {
      nlp.process('metrics-1', 'The quick brown fox jumps over the lazy dog. It is a commonly used sentence.');
      const metrics = nlp.computeTextMetrics('metrics-1');
      expect(metrics.wordCount).toBeGreaterThan(0);
      expect(metrics.sentenceCount).toBeGreaterThan(0);
      expect(metrics.readabilityScore).toBeGreaterThanOrEqual(0);
      expect(metrics.vocabularyRichness).toBeGreaterThanOrEqual(0);
    });

    it('should throw if document not found', () => {
      expect(() => nlp.computeTextMetrics('nonexistent')).toThrow('Document nonexistent not found');
    });
  });

  describe('searchBySentiment', () => {
    it('should return documents by sentiment', () => {
      nlp.process('s1', 'This is great and amazing!');
      nlp.process('s2', 'This is neutral.');
      const results = nlp.searchBySentiment('positive', 0.0);
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
