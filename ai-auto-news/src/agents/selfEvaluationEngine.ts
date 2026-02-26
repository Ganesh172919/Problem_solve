/**
 * Self-Evaluation Engine
 *
 * Agent self-assessment system that evaluates generated output quality,
 * identifies improvement areas, and provides iterative feedback loops.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface EvaluationCriteria {
  id: string;
  name: string;
  weight: number;
  threshold: number;
  evaluator: EvaluatorType;
  config: Record<string, unknown>;
}

export type EvaluatorType =
  | 'code_quality'
  | 'test_coverage'
  | 'security_scan'
  | 'performance_check'
  | 'architecture_compliance'
  | 'documentation_check'
  | 'dependency_audit'
  | 'complexity_analysis';

export interface EvaluationResult {
  id: string;
  timestamp: number;
  targetId: string;
  criteria: EvaluationCriteria[];
  scores: CriteriaScore[];
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  passed: boolean;
  improvements: ImprovementSuggestion[];
  comparisonWithPrevious: ScoreComparison | null;
  executionTimeMs: number;
}

export interface CriteriaScore {
  criteriaId: string;
  score: number;
  maxScore: number;
  normalized: number;
  details: string;
  findings: Finding[];
}

export interface Finding {
  type: 'positive' | 'negative' | 'neutral';
  category: string;
  message: string;
  impact: 'high' | 'medium' | 'low';
  location?: string;
  suggestedAction?: string;
}

export interface ImprovementSuggestion {
  id: string;
  priority: number;
  category: string;
  description: string;
  estimatedImpact: number;
  estimatedEffort: number;
  autoFixAvailable: boolean;
  fixCode?: string;
}

export interface ScoreComparison {
  previousScore: number;
  currentScore: number;
  delta: number;
  trend: 'improving' | 'declining' | 'stable';
  criteriaChanges: { criteriaId: string; previousScore: number; currentScore: number }[];
}

export interface EvaluationHistory {
  targetId: string;
  evaluations: EvaluationResult[];
  averageScore: number;
  trend: number[];
  bestScore: number;
  worstScore: number;
}

export interface LearningFeedback {
  evaluationId: string;
  wasAccurate: boolean;
  humanScore?: number;
  corrections: string[];
  timestamp: number;
}

export class SelfEvaluationEngine {
  private criteria: Map<string, EvaluationCriteria> = new Map();
  private history: Map<string, EvaluationResult[]> = new Map();
  private feedbackLog: LearningFeedback[] = [];
  private calibrationFactors: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultCriteria();
  }

  private initializeDefaultCriteria(): void {
    const defaults: EvaluationCriteria[] = [
      {
        id: 'code_quality',
        name: 'Code Quality',
        weight: 0.25,
        threshold: 0.7,
        evaluator: 'code_quality',
        config: { maxComplexity: 15, maxLineLength: 120, maxFileLength: 500 },
      },
      {
        id: 'test_coverage',
        name: 'Test Coverage',
        weight: 0.15,
        threshold: 0.7,
        evaluator: 'test_coverage',
        config: { minBranches: 70, minFunctions: 70, minLines: 70 },
      },
      {
        id: 'security',
        name: 'Security',
        weight: 0.2,
        threshold: 0.8,
        evaluator: 'security_scan',
        config: { scanDepth: 'deep', includeDepAudit: true },
      },
      {
        id: 'performance',
        name: 'Performance',
        weight: 0.15,
        threshold: 0.6,
        evaluator: 'performance_check',
        config: { maxResponseTimeMs: 200, maxMemoryMB: 128 },
      },
      {
        id: 'architecture',
        name: 'Architecture Compliance',
        weight: 0.15,
        threshold: 0.75,
        evaluator: 'architecture_compliance',
        config: { patterns: ['layered', 'dependency_inversion'] },
      },
      {
        id: 'complexity',
        name: 'Complexity Analysis',
        weight: 0.1,
        threshold: 0.6,
        evaluator: 'complexity_analysis',
        config: { maxCyclomatic: 20, maxCognitive: 30 },
      },
    ];

    for (const criteria of defaults) {
      this.criteria.set(criteria.id, criteria);
    }
  }

  async evaluate(
    targetId: string,
    code: string,
    customCriteria?: EvaluationCriteria[],
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    const activeCriteria = customCriteria || Array.from(this.criteria.values());

    const scores: CriteriaScore[] = [];

    for (const criteria of activeCriteria) {
      const score = await this.evaluateCriteria(criteria, code);
      const calibration = this.calibrationFactors.get(criteria.id) || 1.0;
      score.normalized = Math.min(1.0, score.normalized * calibration);
      scores.push(score);
    }

    const overallScore = this.calculateWeightedScore(scores, activeCriteria);
    const grade = this.assignGrade(overallScore);
    const passed = this.checkPassCriteria(scores, activeCriteria);
    const improvements = this.generateImprovements(scores, activeCriteria);

    const previousEvals = this.history.get(targetId) || [];
    const comparison =
      previousEvals.length > 0
        ? this.compareWithPrevious(overallScore, scores, previousEvals[previousEvals.length - 1])
        : null;

    const result: EvaluationResult = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      targetId,
      criteria: activeCriteria,
      scores,
      overallScore,
      grade,
      passed,
      improvements,
      comparisonWithPrevious: comparison,
      executionTimeMs: Date.now() - startTime,
    };

    previousEvals.push(result);
    this.history.set(targetId, previousEvals);

    logger.info('Evaluation completed', {
      targetId,
      overallScore: overallScore.toFixed(2),
      grade,
      passed,
      improvements: improvements.length,
    });

    return result;
  }

  private async evaluateCriteria(
    criteria: EvaluationCriteria,
    code: string,
  ): Promise<CriteriaScore> {
    switch (criteria.evaluator) {
      case 'code_quality':
        return this.evaluateCodeQuality(criteria, code);
      case 'test_coverage':
        return this.evaluateTestCoverage(criteria, code);
      case 'security_scan':
        return this.evaluateSecurity(criteria, code);
      case 'performance_check':
        return this.evaluatePerformance(criteria, code);
      case 'architecture_compliance':
        return this.evaluateArchitecture(criteria, code);
      case 'complexity_analysis':
        return this.evaluateComplexity(criteria, code);
      default:
        return {
          criteriaId: criteria.id,
          score: 0,
          maxScore: 100,
          normalized: 0,
          details: 'Unknown evaluator',
          findings: [],
        };
    }
  }

  private evaluateCodeQuality(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    let score = 100;
    const lines = code.split('\n');
    const maxLineLength = (criteria.config.maxLineLength as number) || 120;
    const maxFileLength = (criteria.config.maxFileLength as number) || 500;

    const longLines = lines.filter((l) => l.length > maxLineLength).length;
    if (longLines > 0) {
      score -= Math.min(20, longLines * 2);
      findings.push({
        type: 'negative',
        category: 'line_length',
        message: `${longLines} lines exceed ${maxLineLength} characters`,
        impact: longLines > 10 ? 'high' : 'medium',
        suggestedAction: 'Break long lines into multiple lines',
      });
    }

    if (lines.length > maxFileLength) {
      score -= 15;
      findings.push({
        type: 'negative',
        category: 'file_length',
        message: `File has ${lines.length} lines (max: ${maxFileLength})`,
        impact: 'high',
        suggestedAction: 'Split into multiple focused modules',
      });
    }

    const hasTypeAnnotations = /:\s*(string|number|boolean|void|Promise|Record|Map)/.test(code);
    if (hasTypeAnnotations) {
      findings.push({
        type: 'positive',
        category: 'typing',
        message: 'Type annotations detected',
        impact: 'medium',
      });
    }

    const hasErrorHandling = /try\s*\{/.test(code) || /catch\s*\(/.test(code);
    if (hasErrorHandling) {
      findings.push({
        type: 'positive',
        category: 'error_handling',
        message: 'Error handling present',
        impact: 'high',
      });
    } else if (code.includes('async')) {
      score -= 10;
      findings.push({
        type: 'negative',
        category: 'error_handling',
        message: 'Async code without try-catch blocks',
        impact: 'high',
        suggestedAction: 'Add try-catch blocks around async operations',
      });
    }

    const hasComments = /\/\//.test(code) || /\/\*/.test(code);
    if (!hasComments && lines.length > 50) {
      score -= 5;
      findings.push({
        type: 'negative',
        category: 'documentation',
        message: 'No comments in substantial code',
        impact: 'low',
      });
    }

    return {
      criteriaId: criteria.id,
      score: Math.max(0, score),
      maxScore: 100,
      normalized: Math.max(0, score) / 100,
      details: `Code quality score: ${Math.max(0, score)}/100`,
      findings,
    };
  }

  private evaluateTestCoverage(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    const hasTests = code.includes('describe(') || code.includes('it(') || code.includes('test(');
    const hasAssertions = code.includes('expect(') || code.includes('assert');

    let score = 50;

    if (hasTests) {
      score += 25;
      findings.push({
        type: 'positive',
        category: 'test_presence',
        message: 'Test suites detected',
        impact: 'high',
      });
    }

    if (hasAssertions) {
      score += 25;
      findings.push({
        type: 'positive',
        category: 'assertions',
        message: 'Assertions present in tests',
        impact: 'high',
      });
    }

    if (!hasTests) {
      findings.push({
        type: 'negative',
        category: 'test_absence',
        message: 'No test code detected',
        impact: 'high',
        suggestedAction: 'Add unit tests for all public methods',
      });
    }

    return {
      criteriaId: criteria.id,
      score,
      maxScore: 100,
      normalized: score / 100,
      details: `Test coverage estimation: ${score}/100`,
      findings,
    };
  }

  private evaluateSecurity(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    let score = 100;
    const lower = code.toLowerCase();

    const dangerousPatterns = [
      { pattern: 'eval(', name: 'eval usage', penalty: 25 },
      { pattern: 'innerhtml', name: 'innerHTML assignment', penalty: 15 },
      { pattern: 'document.write', name: 'document.write usage', penalty: 15 },
      { pattern: 'exec(', name: 'exec usage', penalty: 20 },
      { pattern: '\\$\\{.*\\}.*sql', name: 'potential SQL injection', penalty: 25 },
    ];

    for (const dp of dangerousPatterns) {
      if (lower.includes(dp.pattern.toLowerCase())) {
        score -= dp.penalty;
        findings.push({
          type: 'negative',
          category: 'security',
          message: `Dangerous pattern detected: ${dp.name}`,
          impact: 'high',
          suggestedAction: `Remove or replace ${dp.name} with safe alternative`,
        });
      }
    }

    const hasInputValidation = /validate|sanitize|escape|purify/i.test(code);
    if (hasInputValidation) {
      findings.push({
        type: 'positive',
        category: 'validation',
        message: 'Input validation/sanitization detected',
        impact: 'high',
      });
    }

    return {
      criteriaId: criteria.id,
      score: Math.max(0, score),
      maxScore: 100,
      normalized: Math.max(0, score) / 100,
      details: `Security score: ${Math.max(0, score)}/100`,
      findings,
    };
  }

  private evaluatePerformance(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    let score = 100;

    const nestedLoops = (code.match(/for\s*\(.*\{[^}]*for\s*\(/g) || []).length;
    if (nestedLoops > 0) {
      score -= nestedLoops * 15;
      findings.push({
        type: 'negative',
        category: 'complexity',
        message: `${nestedLoops} nested loop(s) detected`,
        impact: 'high',
        suggestedAction: 'Consider using Map/Set for O(1) lookups instead of nested loops',
      });
    }

    const usesMap = /new Map|new Set/.test(code);
    if (usesMap) {
      findings.push({
        type: 'positive',
        category: 'data_structures',
        message: 'Uses efficient data structures (Map/Set)',
        impact: 'medium',
      });
    }

    const hasAsync = /async\s|await\s/.test(code);
    if (hasAsync) {
      findings.push({
        type: 'positive',
        category: 'async',
        message: 'Uses async/await for non-blocking operations',
        impact: 'medium',
      });
    }

    return {
      criteriaId: criteria.id,
      score: Math.max(0, score),
      maxScore: 100,
      normalized: Math.max(0, score) / 100,
      details: `Performance score: ${Math.max(0, score)}/100`,
      findings,
    };
  }

  private evaluateArchitecture(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    let score = 100;

    const hasExports = /export\s+(class|function|const|interface|type)/.test(code);
    if (!hasExports) {
      score -= 20;
      findings.push({
        type: 'negative',
        category: 'modularity',
        message: 'No exports detected - module may not be reusable',
        impact: 'high',
      });
    }

    const importCount = (code.match(/import\s+/g) || []).length;
    if (importCount > 15) {
      score -= 15;
      findings.push({
        type: 'negative',
        category: 'coupling',
        message: `High import count (${importCount}) suggests tight coupling`,
        impact: 'medium',
        suggestedAction: 'Consider using dependency injection',
      });
    }

    const hasInterfaces = /interface\s+\w+/.test(code);
    if (hasInterfaces) {
      findings.push({
        type: 'positive',
        category: 'abstraction',
        message: 'Uses interfaces for abstraction',
        impact: 'high',
      });
    }

    return {
      criteriaId: criteria.id,
      score: Math.max(0, score),
      maxScore: 100,
      normalized: Math.max(0, score) / 100,
      details: `Architecture compliance: ${Math.max(0, score)}/100`,
      findings,
    };
  }

  private evaluateComplexity(criteria: EvaluationCriteria, code: string): CriteriaScore {
    const findings: Finding[] = [];
    const maxCyclomatic = (criteria.config.maxCyclomatic as number) || 20;
    const conditionals = (code.match(/\b(if|else|switch|case|for|while|do|&&|\|\||\?)\b/g) || []).length;
    const cyclomatic = conditionals + 1;

    let score = 100;
    if (cyclomatic > maxCyclomatic) {
      score -= Math.min(40, (cyclomatic - maxCyclomatic) * 3);
      findings.push({
        type: 'negative',
        category: 'cyclomatic',
        message: `Cyclomatic complexity ${cyclomatic} exceeds threshold ${maxCyclomatic}`,
        impact: 'high',
        suggestedAction: 'Break complex logic into smaller functions',
      });
    }

    const functions = (code.match(/\b(function|=>)\b/g) || []).length;
    const lines = code.split('\n').length;
    const avgFnLength = functions > 0 ? lines / functions : lines;

    if (avgFnLength > 50) {
      score -= 10;
      findings.push({
        type: 'negative',
        category: 'function_length',
        message: `Average function length ~${Math.round(avgFnLength)} lines`,
        impact: 'medium',
      });
    }

    return {
      criteriaId: criteria.id,
      score: Math.max(0, score),
      maxScore: 100,
      normalized: Math.max(0, score) / 100,
      details: `Complexity: cyclomatic=${cyclomatic}, avgFnLength=${Math.round(avgFnLength)}`,
      findings,
    };
  }

  private calculateWeightedScore(
    scores: CriteriaScore[],
    criteria: EvaluationCriteria[],
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const score of scores) {
      const crit = criteria.find((c) => c.id === score.criteriaId);
      if (crit) {
        weightedSum += score.normalized * crit.weight;
        totalWeight += crit.weight;
      }
    }

    return totalWeight > 0 ? parseFloat((weightedSum / totalWeight).toFixed(4)) : 0;
  }

  private assignGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.6) return 'D';
    return 'F';
  }

  private checkPassCriteria(
    scores: CriteriaScore[],
    criteria: EvaluationCriteria[],
  ): boolean {
    for (const score of scores) {
      const crit = criteria.find((c) => c.id === score.criteriaId);
      if (crit && score.normalized < crit.threshold) {
        return false;
      }
    }
    return true;
  }

  private generateImprovements(
    scores: CriteriaScore[],
    criteria: EvaluationCriteria[],
  ): ImprovementSuggestion[] {
    const improvements: ImprovementSuggestion[] = [];
    let priority = 1;

    for (const score of scores) {
      const crit = criteria.find((c) => c.id === score.criteriaId);
      if (!crit || score.normalized >= crit.threshold) continue;

      for (const finding of score.findings) {
        if (finding.type === 'negative') {
          improvements.push({
            id: `imp_${priority}`,
            priority,
            category: finding.category,
            description: finding.message,
            estimatedImpact: finding.impact === 'high' ? 0.8 : finding.impact === 'medium' ? 0.5 : 0.2,
            estimatedEffort: finding.impact === 'high' ? 4 : finding.impact === 'medium' ? 2 : 1,
            autoFixAvailable: !!finding.suggestedAction,
          });
          priority++;
        }
      }
    }

    return improvements.sort((a, b) => b.estimatedImpact - a.estimatedImpact);
  }

  private compareWithPrevious(
    currentScore: number,
    currentScores: CriteriaScore[],
    previous: EvaluationResult,
  ): ScoreComparison {
    const delta = currentScore - previous.overallScore;
    const trend: 'improving' | 'declining' | 'stable' =
      delta > 0.02 ? 'improving' : delta < -0.02 ? 'declining' : 'stable';

    const criteriaChanges = currentScores.map((cs) => {
      const prev = previous.scores.find((ps) => ps.criteriaId === cs.criteriaId);
      return {
        criteriaId: cs.criteriaId,
        previousScore: prev?.normalized || 0,
        currentScore: cs.normalized,
      };
    });

    return {
      previousScore: previous.overallScore,
      currentScore,
      delta: parseFloat(delta.toFixed(4)),
      trend,
      criteriaChanges,
    };
  }

  recordFeedback(feedback: LearningFeedback): void {
    this.feedbackLog.push(feedback);

    if (feedback.humanScore !== undefined) {
      const evalResult = this.findEvaluation(feedback.evaluationId);
      if (evalResult) {
        const diff = feedback.humanScore - evalResult.overallScore;
        for (const criteria of evalResult.criteria) {
          const currentFactor = this.calibrationFactors.get(criteria.id) || 1.0;
          const adjustment = diff * 0.1;
          this.calibrationFactors.set(
            criteria.id,
            Math.max(0.5, Math.min(1.5, currentFactor + adjustment)),
          );
        }
      }
    }
  }

  getHistory(targetId: string): EvaluationHistory | null {
    const evals = this.history.get(targetId);
    if (!evals || evals.length === 0) return null;

    const scores = evals.map((e) => e.overallScore);

    return {
      targetId,
      evaluations: evals,
      averageScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      trend: scores,
      bestScore: Math.max(...scores),
      worstScore: Math.min(...scores),
    };
  }

  addCriteria(criteria: EvaluationCriteria): void {
    this.criteria.set(criteria.id, criteria);
  }

  removeCriteria(criteriaId: string): boolean {
    return this.criteria.delete(criteriaId);
  }

  getCriteria(): EvaluationCriteria[] {
    return Array.from(this.criteria.values());
  }

  private findEvaluation(evaluationId: string): EvaluationResult | null {
    for (const evals of this.history.values()) {
      const found = evals.find((e) => e.id === evaluationId);
      if (found) return found;
    }
    return null;
  }
}

let evaluationInstance: SelfEvaluationEngine | null = null;

export function getSelfEvaluationEngine(): SelfEvaluationEngine {
  if (!evaluationInstance) {
    evaluationInstance = new SelfEvaluationEngine();
  }
  return evaluationInstance;
}
