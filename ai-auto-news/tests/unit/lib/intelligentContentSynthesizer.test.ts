import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  IntelligentContentSynthesizer,
  getIntelligentContentSynthesizer,
  ContentTemplate,
} from '@/lib/intelligentContentSynthesizer';

function makeTemplate(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id: 'tmpl-1',
    name: 'Article Template',
    format: 'article',
    structure: ['Hello {{name}} and {{topic}}.'],
    variables: ['name', 'topic'],
    minWords: 1,
    maxWords: 100,
    tone: 'formal',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('IntelligentContentSynthesizer', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__intelligentContentSynthesizer__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getIntelligentContentSynthesizer();
    const b = getIntelligentContentSynthesizer();
    expect(a).toBe(b);
  });

  it('new instance is an IntelligentContentSynthesizer', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    expect(synthesizer).toBeInstanceOf(IntelligentContentSynthesizer);
  });

  it('createTemplate registers template and reflects in summary', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    synthesizer.createTemplate(makeTemplate());
    const summary = synthesizer.getSummary();
    expect(summary.totalTemplates).toBe(1);
  });

  it('synthesizeContent returns content with qualityScore and correct fields', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    synthesizer.createTemplate(makeTemplate());
    const content = synthesizer.synthesizeContent(
      'tmpl-1',
      'cluster-none',
      { name: 'World', topic: 'testing', title: 'Test Article' },
    );
    expect(content.id).toBeDefined();
    expect(content.templateId).toBe('tmpl-1');
    expect(content.title).toBe('Test Article');
    expect(content.qualityScore).toBeGreaterThanOrEqual(0);
    expect(content.qualityScore).toBeLessThanOrEqual(100);
    expect(typeof content.wordCount).toBe('number');
    expect(typeof content.readabilityScore).toBe('number');
  });

  it('synthesizeContent increments totalContent in summary', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    synthesizer.createTemplate(makeTemplate());
    synthesizer.synthesizeContent('tmpl-1', 'cluster-none', { name: 'A', topic: 'B' });
    synthesizer.synthesizeContent('tmpl-1', 'cluster-none', { name: 'C', topic: 'D' });
    expect(synthesizer.getSummary().totalContent).toBe(2);
  });

  it('detectDuplicate returns null for unknown hash', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    expect(synthesizer.detectDuplicate('00000000')).toBeNull();
  });

  it('detectDuplicate returns contentId for hash produced by synthesizeContent', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    synthesizer.createTemplate(makeTemplate());
    const content = synthesizer.synthesizeContent(
      'tmpl-1', 'cluster-none', { name: 'World', topic: 'testing', title: 'Test' },
    );
    const found = synthesizer.detectDuplicate(content.similarityHash);
    expect(found).toBe(content.id);
  });

  it('clusterTopics returns array of new TopicClusters', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    const clusters = synthesizer.clusterTopics([
      { label: 'AI News', keywords: ['machine learning', 'neural network'] },
      { label: 'Finance', keywords: ['stocks', 'bonds', 'market cap'] },
    ]);
    expect(Array.isArray(clusters)).toBe(true);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].id).toBeDefined();
    expect(clusters[0].keywords.length).toBeGreaterThan(0);
    expect(synthesizer.getSummary().totalClusters).toBeGreaterThan(0);
  });

  it('computeReadability returns valid metrics for simple text', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    const metrics = synthesizer.computeReadability('The quick brown fox jumps over the lazy dog.');
    expect(metrics.score).toBeGreaterThanOrEqual(0);
    expect(metrics.score).toBeLessThanOrEqual(100);
    expect(metrics.avgSentenceLength).toBeGreaterThan(0);
    expect(typeof metrics.fleschReadingEase).toBe('number');
  });

  it('getSummary has correct shape', () => {
    const synthesizer = getIntelligentContentSynthesizer();
    const summary = synthesizer.getSummary();
    expect(typeof summary.totalTemplates).toBe('number');
    expect(typeof summary.totalContent).toBe('number');
    expect(typeof summary.totalClusters).toBe('number');
    expect(typeof summary.avgQualityScore).toBe('number');
    expect(typeof summary.avgReadabilityScore).toBe('number');
    expect(typeof summary.avgSeoScore).toBe('number');
    expect(typeof summary.duplicatesDetected).toBe('number');
    expect(Array.isArray(summary.topPerformingTopics)).toBe(true);
    expect(typeof summary.contentByFormat).toBe('object');
  });
});
