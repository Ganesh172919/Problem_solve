/**
 * Hallucination Guard
 *
 * Validates AI-generated content against known facts, checks consistency
 * across outputs, scores confidence, verifies source attribution,
 * detects hallucination patterns, and quarantines suspicious content.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentItem {
  id: string;
  source: string; // agent or model that produced it
  content: string;
  claims: Claim[];
  references: Reference[];
  generatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface Claim {
  id: string;
  text: string;
  category: 'factual' | 'statistical' | 'temporal' | 'attribution' | 'logical';
  confidence?: number;
}

export interface Reference {
  id: string;
  url?: string;
  title: string;
  snippet?: string;
  verified: boolean;
}

export interface ValidationResult {
  contentId: string;
  overallScore: number; // 0-100, higher = more trustworthy
  factCheckResults: FactCheckResult[];
  consistencyScore: number;
  confidenceScore: number;
  attributionScore: number;
  patternsDetected: HallucinationPattern[];
  quarantined: boolean;
  quarantineReason?: string;
  validatedAt: number;
}

export interface FactCheckResult {
  claimId: string;
  claimText: string;
  status: 'verified' | 'unverified' | 'contradicted' | 'uncertain';
  confidence: number;
  evidence?: string;
  stage: string;
}

export interface HallucinationPattern {
  type: 'statistical-anomaly' | 'contradiction' | 'fabricated-reference' | 'impossible-claim' | 'vague-hedge' | 'false-precision';
  severity: 'low' | 'medium' | 'high';
  description: string;
  location?: string;
}

export interface KnownFact {
  id: string;
  statement: string;
  category: string;
  keywords: string[];
  addedAt: number;
}

export interface ConsistencyPair {
  contentIdA: string;
  contentIdB: string;
  contradictions: string[];
  score: number;
}

export interface GuardConfig {
  quarantineThreshold: number;      // below this score → quarantine
  minConfidenceForPass: number;
  maxUnverifiedClaimsRatio: number;
  enablePatternDetection: boolean;
  enableAttributionCheck: boolean;
  validationStages: string[];
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

function defaultGuardConfig(): GuardConfig {
  return {
    quarantineThreshold: 35,
    minConfidenceForPass: 50,
    maxUnverifiedClaimsRatio: 0.4,
    enablePatternDetection: true,
    enableAttributionCheck: true,
    validationStages: ['fact-check', 'consistency', 'pattern', 'attribution'],
  };
}

// ---------------------------------------------------------------------------
// HallucinationGuard
// ---------------------------------------------------------------------------

export class HallucinationGuard {
  private knownFacts: Map<string, KnownFact> = new Map();
  private validationHistory: Map<string, ValidationResult> = new Map();
  private contentStore: Map<string, ContentItem> = new Map();
  private quarantine: Map<string, ContentItem> = new Map();
  private config: GuardConfig;
  private readonly maxStoreSize = 2000;

  constructor(config?: Partial<GuardConfig>) {
    this.config = { ...defaultGuardConfig(), ...config };
    logger.info('Hallucination guard constructed', { stages: this.config.validationStages });
  }

  // ---- Configuration -------------------------------------------------------

  updateConfig(patch: Partial<GuardConfig>): void {
    this.config = { ...this.config, ...patch };
    logger.info('Guard config updated');
  }

  // ---- Fact management -----------------------------------------------------

  addKnownFact(fact: KnownFact): void {
    this.knownFacts.set(fact.id, fact);
  }

  addKnownFacts(facts: KnownFact[]): void {
    for (const f of facts) this.knownFacts.set(f.id, f);
    logger.info('Known facts loaded', { count: facts.length, total: this.knownFacts.size });
  }

  removeKnownFact(factId: string): boolean {
    return this.knownFacts.delete(factId);
  }

  // ---- Main validation pipeline --------------------------------------------

  validate(item: ContentItem): ValidationResult {
    logger.info('Validating content', { contentId: item.id, source: item.source, claims: item.claims.length });

    this.storeContent(item);

    const factCheckResults = this.config.validationStages.includes('fact-check')
      ? this.factCheck(item)
      : [];

    const consistencyScore = this.config.validationStages.includes('consistency')
      ? this.checkConsistency(item)
      : 100;

    const patternsDetected = this.config.enablePatternDetection && this.config.validationStages.includes('pattern')
      ? this.detectPatterns(item)
      : [];

    const attributionScore = this.config.enableAttributionCheck && this.config.validationStages.includes('attribution')
      ? this.verifyAttribution(item)
      : 100;

    const confidenceScore = this.computeConfidence(item, factCheckResults);

    const overallScore = this.computeOverallScore(
      factCheckResults, consistencyScore, confidenceScore, attributionScore, patternsDetected,
    );

    const quarantined = overallScore < this.config.quarantineThreshold;
    let quarantineReason: string | undefined;
    if (quarantined) {
      quarantineReason = `Overall score ${overallScore} below threshold ${this.config.quarantineThreshold}`;
      this.quarantineContent(item, quarantineReason);
    }

    const result: ValidationResult = {
      contentId: item.id,
      overallScore,
      factCheckResults,
      consistencyScore,
      confidenceScore,
      attributionScore,
      patternsDetected,
      quarantined,
      quarantineReason,
      validatedAt: Date.now(),
    };

    this.validationHistory.set(item.id, result);

    logger.info('Content validation complete', {
      contentId: item.id, overallScore, quarantined,
      patterns: patternsDetected.length, factChecks: factCheckResults.length,
    });

    return result;
  }

  // ---- Fact-checking stages ------------------------------------------------

  private factCheck(item: ContentItem): FactCheckResult[] {
    const results: FactCheckResult[] = [];

    for (const claim of item.claims) {
      // Stage 1: Known-facts matching
      const knownMatch = this.matchAgainstKnownFacts(claim);
      if (knownMatch) {
        results.push(knownMatch);
        continue;
      }

      // Stage 2: Statistical plausibility
      if (claim.category === 'statistical') {
        results.push(this.checkStatisticalPlausibility(claim));
        continue;
      }

      // Stage 3: Temporal coherence
      if (claim.category === 'temporal') {
        results.push(this.checkTemporalCoherence(claim));
        continue;
      }

      // Stage 4: Logical consistency
      if (claim.category === 'logical') {
        results.push(this.checkLogicalConsistency(claim, item.claims));
        continue;
      }

      // Default: mark as unverified
      results.push({
        claimId: claim.id,
        claimText: claim.text,
        status: 'uncertain',
        confidence: 30,
        stage: 'default',
      });
    }

    return results;
  }

  private matchAgainstKnownFacts(claim: Claim): FactCheckResult | null {
    const claimLower = claim.text.toLowerCase();
    let bestMatch: KnownFact | null = null;
    let bestScore = 0;

    for (const [, fact] of this.knownFacts) {
      // Keyword overlap scoring
      let matches = 0;
      for (const kw of fact.keywords) {
        if (claimLower.includes(kw.toLowerCase())) matches++;
      }
      const score = fact.keywords.length > 0 ? matches / fact.keywords.length : 0;
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = fact;
      }
    }

    if (!bestMatch) return null;

    // Check if fact supports or contradicts the claim
    const factLower = bestMatch.statement.toLowerCase();
    const isContradiction = this.detectContradiction(claimLower, factLower);

    return {
      claimId: claim.id,
      claimText: claim.text,
      status: isContradiction ? 'contradicted' : 'verified',
      confidence: Math.round(bestScore * 100),
      evidence: bestMatch.statement,
      stage: 'known-facts',
    };
  }

  private detectContradiction(a: string, b: string): boolean {
    // Simple negation and antonym detection
    const negationPatterns = [
      [/\bnot\b/, /\b(?:is|are|was|were|has|have)\b/],
      [/\bnever\b/, /\balways\b/],
      [/\bno\b/, /\byes\b/],
      [/\bincreased?\b/, /\bdecreased?\b/],
      [/\bhigher\b/, /\blower\b/],
      [/\bmore\b/, /\bless\b/],
      [/\bbefore\b/, /\bafter\b/],
    ];

    for (const [patA, patB] of negationPatterns) {
      if ((patA.test(a) && patB.test(b)) || (patB.test(a) && patA.test(b))) {
        return true;
      }
    }

    // Number contradiction: different numbers for same subject
    const numsA = a.match(/\b\d+(?:\.\d+)?%?\b/g);
    const numsB = b.match(/\b\d+(?:\.\d+)?%?\b/g);
    if (numsA && numsB) {
      const setA = new Set(numsA);
      const setB = new Set(numsB);
      // If they mention numbers but share no numbers, possible contradiction
      if (setA.size > 0 && setB.size > 0 && [...setA].every(n => !setB.has(n))) {
        return true;
      }
    }

    return false;
  }

  private checkStatisticalPlausibility(claim: Claim): FactCheckResult {
    const text = claim.text;
    // Flag impossible percentages or extreme values
    const percentages = text.match(/(\d+(?:\.\d+)?)%/g);
    if (percentages) {
      for (const p of percentages) {
        const val = parseFloat(p);
        if (val > 100 || val < 0) {
          return {
            claimId: claim.id, claimText: claim.text,
            status: 'contradicted', confidence: 95,
            evidence: `Invalid percentage: ${p}`,
            stage: 'statistical-plausibility',
          };
        }
      }
    }

    // Flag suspiciously precise numbers (e.g., 73.847%)
    const precisePct = text.match(/\d+\.\d{3,}%/);
    if (precisePct) {
      return {
        claimId: claim.id, claimText: claim.text,
        status: 'uncertain', confidence: 40,
        evidence: `Suspiciously precise value: ${precisePct[0]}`,
        stage: 'statistical-plausibility',
      };
    }

    return {
      claimId: claim.id, claimText: claim.text,
      status: 'unverified', confidence: 50,
      stage: 'statistical-plausibility',
    };
  }

  private checkTemporalCoherence(claim: Claim): FactCheckResult {
    const text = claim.text.toLowerCase();
    const now = new Date();
    const currentYear = now.getFullYear();

    // Extract years
    const years = text.match(/\b(1\d{3}|20\d{2})\b/g)?.map(Number) ?? [];

    // Future dates presented as past
    for (const y of years) {
      if (y > currentYear + 5) {
        return {
          claimId: claim.id, claimText: claim.text,
          status: 'contradicted', confidence: 85,
          evidence: `Year ${y} is far in the future`,
          stage: 'temporal-coherence',
        };
      }
    }

    // Anachronistic claims: technology before it existed
    if (years.length > 0) {
      const minYear = Math.min(...years);
      if (text.includes('internet') && minYear < 1970) {
        return {
          claimId: claim.id, claimText: claim.text,
          status: 'contradicted', confidence: 90,
          evidence: 'Internet did not exist before 1970',
          stage: 'temporal-coherence',
        };
      }
    }

    return {
      claimId: claim.id, claimText: claim.text,
      status: 'unverified', confidence: 50,
      stage: 'temporal-coherence',
    };
  }

  private checkLogicalConsistency(claim: Claim, allClaims: Claim[]): FactCheckResult {
    const claimLower = claim.text.toLowerCase();

    // Check for internal contradictions with other claims
    for (const other of allClaims) {
      if (other.id === claim.id) continue;
      if (this.detectContradiction(claimLower, other.text.toLowerCase())) {
        return {
          claimId: claim.id, claimText: claim.text,
          status: 'contradicted', confidence: 70,
          evidence: `Contradicts claim: "${other.text}"`,
          stage: 'logical-consistency',
        };
      }
    }

    return {
      claimId: claim.id, claimText: claim.text,
      status: 'unverified', confidence: 50,
      stage: 'logical-consistency',
    };
  }

  // ---- Consistency checking ------------------------------------------------

  private checkConsistency(item: ContentItem): number {
    // Compare against recent content from the same source
    const relatedItems: ContentItem[] = [];
    for (const [, stored] of this.contentStore) {
      if (stored.id !== item.id && stored.source === item.source) {
        relatedItems.push(stored);
      }
    }

    if (relatedItems.length === 0) return 100; // no prior context

    let contradictionCount = 0;
    let totalComparisons = 0;

    for (const other of relatedItems.slice(-10)) { // limit comparisons
      for (const claimA of item.claims) {
        for (const claimB of other.claims) {
          totalComparisons++;
          if (this.detectContradiction(claimA.text.toLowerCase(), claimB.text.toLowerCase())) {
            contradictionCount++;
          }
        }
      }
    }

    if (totalComparisons === 0) return 100;
    const ratio = contradictionCount / totalComparisons;
    return Math.round(Math.max(0, (1 - ratio * 5)) * 100); // amplify penalty
  }

  // ---- Pattern detection ---------------------------------------------------

  private detectPatterns(item: ContentItem): HallucinationPattern[] {
    const patterns: HallucinationPattern[] = [];
    const text = item.content;

    // Vague hedging language
    const hedgeWords = ['might', 'perhaps', 'possibly', 'it is believed', 'some say', 'reportedly', 'allegedly'];
    let hedgeCount = 0;
    for (const hw of hedgeWords) {
      const regex = new RegExp(`\\b${hw}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) hedgeCount += matches.length;
    }
    if (hedgeCount > 5) {
      patterns.push({
        type: 'vague-hedge', severity: 'medium',
        description: `Excessive hedging language detected (${hedgeCount} instances)`,
      });
    }

    // False precision
    const falsePrecision = text.match(/\d+\.\d{4,}/g);
    if (falsePrecision && falsePrecision.length > 0) {
      patterns.push({
        type: 'false-precision', severity: 'medium',
        description: `Suspiciously precise numbers: ${falsePrecision.slice(0, 3).join(', ')}`,
      });
    }

    // Fabricated references
    for (const ref of item.references) {
      if (!ref.verified) {
        // Check for typical fabrication patterns
        const suspicious = this.isSuspiciousReference(ref);
        if (suspicious) {
          patterns.push({
            type: 'fabricated-reference', severity: 'high',
            description: `Potentially fabricated reference: "${ref.title}"`,
            location: ref.url,
          });
        }
      }
    }

    // Impossible claims
    for (const claim of item.claims) {
      if (this.isImpossibleClaim(claim)) {
        patterns.push({
          type: 'impossible-claim', severity: 'high',
          description: `Potentially impossible claim: "${claim.text.slice(0, 80)}"`,
        });
      }
    }

    // Statistical anomalies: too many round numbers
    const roundNumbers = text.match(/\b\d+00\b/g);
    const allNumbers = text.match(/\b\d{3,}\b/g);
    if (allNumbers && allNumbers.length > 5 && roundNumbers) {
      const roundRatio = roundNumbers.length / allNumbers.length;
      if (roundRatio > 0.7) {
        patterns.push({
          type: 'statistical-anomaly', severity: 'low',
          description: `${Math.round(roundRatio * 100)}% of multi-digit numbers are round (possible fabrication)`,
        });
      }
    }

    return patterns;
  }

  private isSuspiciousReference(ref: Reference): boolean {
    if (!ref.url && !ref.snippet) return true;

    // Check for DOI-like patterns that look fake
    if (ref.url) {
      const fakeDOI = /10\.\d{4}\/[a-z]{3,}\.\d{4}\.\d{4}/.test(ref.url);
      if (fakeDOI && !ref.verified) return true;
    }

    // Title is generic or too perfect
    const genericTitles = ['a study on', 'research paper about', 'analysis of', 'comprehensive guide'];
    const titleLower = ref.title.toLowerCase();
    for (const gt of genericTitles) {
      if (titleLower.startsWith(gt)) return true;
    }

    return false;
  }

  private isImpossibleClaim(claim: Claim): boolean {
    const text = claim.text.toLowerCase();

    // Impossible percentages
    const pcts = text.match(/(\d+(?:\.\d+)?)\s*%/g);
    if (pcts) {
      for (const p of pcts) {
        const val = parseFloat(p);
        if (val > 100 || val < 0) return true;
      }
    }

    // Impossible dates: future years described with past-tense verbs
    const currentYear = new Date().getFullYear();
    const yearsInText = text.match(/\b(1\d{3}|2\d{3}|[3-9]\d{3})\b/g)?.map(Number) ?? [];
    const hasFutureYear = yearsInText.some(y => y > currentYear + 10);
    if (hasFutureYear && /\b(happened|occurred|was|were|did)\b/.test(text)) return true;

    return false;
  }

  // ---- Attribution verification --------------------------------------------

  private verifyAttribution(item: ContentItem): number {
    if (item.references.length === 0) {
      // No references when there are factual claims = low score
      const factualClaims = item.claims.filter(c => c.category === 'factual' || c.category === 'statistical');
      return factualClaims.length > 0 ? 30 : 80;
    }

    const verified = item.references.filter(r => r.verified).length;
    const total = item.references.length;
    const verifiedRatio = verified / total;

    // Bonus for having snippets (evidence of real sources)
    const withSnippets = item.references.filter(r => r.snippet && r.snippet.length > 20).length;
    const snippetBonus = Math.min(15, (withSnippets / total) * 15);

    return Math.round(Math.min(100, verifiedRatio * 85 + snippetBonus));
  }

  // ---- Confidence scoring --------------------------------------------------

  private computeConfidence(item: ContentItem, factChecks: FactCheckResult[]): number {
    if (item.claims.length === 0) return 70; // neutral

    const verified = factChecks.filter(f => f.status === 'verified').length;
    const contradicted = factChecks.filter(f => f.status === 'contradicted').length;
    const total = factChecks.length;

    if (total === 0) return 50;

    const verifiedRatio = verified / total;
    const contradictedRatio = contradicted / total;

    // Base confidence from verification ratio
    let confidence = verifiedRatio * 80 + (1 - contradictedRatio) * 20;

    // Penalty for claims with low individual confidence
    const avgClaimConfidence = factChecks.reduce((s, f) => s + f.confidence, 0) / total;
    confidence = confidence * 0.7 + avgClaimConfidence * 0.3;

    return Math.round(Math.max(0, Math.min(100, confidence)));
  }

  // ---- Overall scoring -----------------------------------------------------

  private computeOverallScore(
    factChecks: FactCheckResult[],
    consistencyScore: number,
    confidenceScore: number,
    attributionScore: number,
    patterns: HallucinationPattern[],
  ): number {
    // Base from component scores
    let score = (
      consistencyScore * 0.25 +
      confidenceScore * 0.35 +
      attributionScore * 0.2
    );

    // Fact-check bonus/penalty
    if (factChecks.length > 0) {
      const contradicted = factChecks.filter(f => f.status === 'contradicted').length;
      const verified = factChecks.filter(f => f.status === 'verified').length;
      score += (verified / factChecks.length) * 15;
      score -= (contradicted / factChecks.length) * 25;
    } else {
      score += 5; // slight bonus for no claims (low risk)
    }

    // Pattern penalties
    for (const p of patterns) {
      if (p.severity === 'high') score -= 12;
      else if (p.severity === 'medium') score -= 6;
      else score -= 2;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // ---- Quarantine system ---------------------------------------------------

  private quarantineContent(item: ContentItem, reason: string): void {
    this.quarantine.set(item.id, item);
    logger.warn('Content quarantined', { contentId: item.id, reason });
  }

  releaseFromQuarantine(contentId: string): ContentItem | null {
    const item = this.quarantine.get(contentId);
    if (!item) return null;
    this.quarantine.delete(contentId);
    logger.info('Content released from quarantine', { contentId });
    return item;
  }

  getQuarantinedItems(): ContentItem[] {
    return [...this.quarantine.values()];
  }

  isQuarantined(contentId: string): boolean {
    return this.quarantine.has(contentId);
  }

  // ---- Content store -------------------------------------------------------

  private storeContent(item: ContentItem): void {
    this.contentStore.set(item.id, item);
    // Evict oldest when over limit
    if (this.contentStore.size > this.maxStoreSize) {
      const oldest = this.contentStore.keys().next().value;
      if (oldest !== undefined) this.contentStore.delete(oldest);
    }
  }

  getValidationResult(contentId: string): ValidationResult | undefined {
    return this.validationHistory.get(contentId);
  }

  // ---- Batch validation ----------------------------------------------------

  validateBatch(items: ContentItem[]): ValidationResult[] {
    logger.info('Batch validation started', { count: items.length });
    const results: ValidationResult[] = [];
    for (const item of items) {
      results.push(this.validate(item));
    }
    const quarantined = results.filter(r => r.quarantined).length;
    logger.info('Batch validation complete', { total: items.length, quarantined });
    return results;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__hallucinationGuard__';

export function getHallucinationGuard(config?: Partial<GuardConfig>): HallucinationGuard {
  const g = globalThis as unknown as Record<string, HallucinationGuard>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new HallucinationGuard(config);
    logger.info('Hallucination guard initialized');
  }
  return g[GLOBAL_KEY];
}
