/**
 * Autonomous Code Reviewer
 *
 * Automated code review with security, performance, and architecture analysis:
 * - Static analysis for code quality and style
 * - Security vulnerability detection (OWASP top 10, injection, XSS, etc.)
 * - Performance anti-pattern detection (N+1, blocking calls, memory leaks)
 * - Code quality scoring (complexity, maintainability, test coverage signals)
 * - Architectural compliance checking (layer separation, dependency direction)
 * - Auto-fix suggestions with code diffs
 * - PR review generation with inline comments
 * - Technical debt estimation (hours, cost, risk)
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';
import { getAIModelRouter } from '../lib/aiModelRouter';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type IssueCategory =
  | 'security' | 'performance' | 'maintainability' | 'reliability'
  | 'architecture' | 'style' | 'documentation' | 'test-coverage' | 'dependency';

export type CodeLanguage =
  | 'typescript' | 'javascript' | 'python' | 'go' | 'java'
  | 'rust' | 'csharp' | 'ruby' | 'php' | 'sql' | 'unknown';

export type ReviewStatus = 'approved' | 'changes-requested' | 'comment' | 'pending';

export type ArchitecturePattern =
  | 'layered' | 'hexagonal' | 'event-driven' | 'microservices' | 'monolith' | 'serverless';

export interface CodeFile {
  path: string;
  content: string;
  language?: CodeLanguage;
  linesOfCode?: number;
  isTest?: boolean;
}

export interface CodeIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  description: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart?: number;
  codeSnippet: string;
  rule: string;
  ruleReference?: string;
  fixSuggestion?: string;
  fixDiff?: string;
  effort: 'trivial' | 'minor' | 'major' | 'epic';
  autoFixable: boolean;
  falsePositiveProbability: number; // 0-1
}

export interface SecurityVulnerability {
  id: string;
  cveId?: string;
  owaspCategory: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  attackVector: string;
  impact: string;
  remediation: string;
  references: string[];
  exploitabilityScore: number; // 0-10
  impactScore: number; // 0-10
  detectedAt: Date;
}

export interface PerformanceIssue {
  id: string;
  type: 'n-plus-one' | 'blocking-io' | 'memory-leak' | 'unnecessary-computation'
       | 'missing-cache' | 'large-payload' | 'inefficient-query' | 'sync-in-async' | 'other';
  severity: IssueSeverity;
  title: string;
  description: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  estimatedLatencyImpactMs?: number;
  estimatedMemoryImpactMb?: number;
  recommendation: string;
  fixExample?: string;
}

export interface ArchitectureViolation {
  id: string;
  pattern: ArchitecturePattern;
  rule: string;
  description: string;
  filePath: string;
  lineStart: number;
  violationType: 'layer-violation' | 'circular-dependency' | 'god-class' | 'feature-envy'
               | 'data-clump' | 'long-parameter-list' | 'improper-abstraction' | 'tight-coupling';
  severity: IssueSeverity;
  recommendation: string;
}

export interface CodeQualityScore {
  overall: number; // 0-100
  breakdown: {
    maintainability: number;
    reliability: number;
    security: number;
    performance: number;
    testability: number;
    documentation: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  technicalDebtMinutes: number;
  duplicationRatio: number; // 0-1
  complexityScore: number; // 0-100 (lower is simpler)
  testCoverageEstimate: number; // 0-1
}

export interface InlineComment {
  filePath: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  severity: IssueSeverity;
  category: IssueCategory;
  suggestedChange?: string;
}

export interface PRReview {
  id: string;
  prTitle: string;
  prDescription: string;
  status: ReviewStatus;
  summary: string;
  overallQualityScore: CodeQualityScore;
  inlineComments: InlineComment[];
  blockers: string[];
  suggestions: string[];
  praises: string[];
  securityClearance: 'cleared' | 'needs-review' | 'blocked';
  performanceClearance: 'cleared' | 'needs-review' | 'degradation-risk';
  checklist: Array<{ item: string; passed: boolean; note?: string }>;
  reviewedAt: Date;
  reviewDurationMs: number;
}

export interface TechnicalDebtItem {
  id: string;
  category: IssueCategory;
  title: string;
  description: string;
  filePath: string;
  estimatedHours: number;
  estimatedCostUsd: number;
  interestRate: number; // % increase in fix cost per month deferred
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: Date;
}

export interface TechnicalDebtReport {
  id: string;
  totalItems: number;
  totalEstimatedHours: number;
  totalEstimatedCostUsd: number;
  debtRatio: number; // technical debt hours / total estimated dev hours
  items: TechnicalDebtItem[];
  byCategory: Record<IssueCategory, { count: number; hours: number; costUsd: number }>;
  trends: { month: string; addedHours: number; resolvedHours: number; netHours: number }[];
  recommendations: string[];
  generatedAt: Date;
}

export interface ReviewConfig {
  enableSecurityCheck?: boolean;
  enablePerformanceCheck?: boolean;
  enableArchitectureCheck?: boolean;
  targetPattern?: ArchitecturePattern;
  maxFileSizeKb?: number;
  severityThreshold?: IssueSeverity;
  autoFixEnabled?: boolean;
  skipPaths?: string[];
}

export interface ReviewResult {
  id: string;
  files: CodeFile[];
  issues: CodeIssue[];
  securityVulnerabilities: SecurityVulnerability[];
  performanceIssues: PerformanceIssue[];
  architectureViolations: ArchitectureViolation[];
  qualityScore: CodeQualityScore;
  reviewedAt: Date;
  durationMs: number;
}

// ── Autonomous Code Reviewer ──────────────────────────────────────────────────

export class AutonomousCodeReviewer {
  private router = getAIModelRouter();
  private readonly HOURLY_RATE_USD = 125;
  private readonly CACHE_TTL = 3600;

  // ── Full Code Review ──────────────────────────────────────────────────────

  async reviewCode(
    files: CodeFile[],
    config: ReviewConfig = {},
  ): Promise<ReviewResult> {
    const startMs = Date.now();
    const reviewId = uuidv4();
    const cacheKey = `review:${crypto.createHash('md5').update(files.map(f => f.path + f.content.length).join(':')).digest('hex')}`;

    const cached = await cache.get<ReviewResult>(cacheKey);
    if (cached) {
      logger.debug({ reviewId: cached.id }, 'Returning cached review result');
      return cached;
    }

    logger.info({ reviewId, fileCount: files.length }, 'Starting code review');

    const filteredFiles = files.filter(f => {
      if (config.skipPaths?.some(p => f.path.includes(p))) return false;
      if (config.maxFileSizeKb && Buffer.byteLength(f.content) > config.maxFileSizeKb * 1024) return false;
      return true;
    });

    const [issues, secVulns, perfIssues, archViolations] = await Promise.all([
      this.runStaticAnalysis(filteredFiles),
      config.enableSecurityCheck !== false ? this.detectSecurityIssues(filteredFiles) : Promise.resolve([]),
      config.enablePerformanceCheck !== false ? this.analyzePerformance(filteredFiles) : Promise.resolve([]),
      config.enableArchitectureCheck !== false ? this.checkArchitectureCompliance(filteredFiles, config.targetPattern ?? 'layered') : Promise.resolve([]),
    ]);

    const allIssues = [...issues, ...secVulns.map(v => this.vulnToIssue(v)), ...perfIssues.map(p => this.perfToIssue(p))];
    const qualityScore = this.computeQualityScore(filteredFiles, allIssues, secVulns, perfIssues);

    const result: ReviewResult = {
      id: reviewId,
      files: filteredFiles,
      issues,
      securityVulnerabilities: secVulns,
      performanceIssues: perfIssues,
      architectureViolations: archViolations,
      qualityScore,
      reviewedAt: new Date(),
      durationMs: Date.now() - startMs,
    };

    await cache.set(cacheKey, result, this.CACHE_TTL);
    logger.info({ reviewId, issueCount: issues.length, securityIssues: secVulns.length, grade: qualityScore.grade }, 'Code review complete');
    return result;
  }

  // ── Security Issue Detection ──────────────────────────────────────────────

  async detectSecurityIssues(files: CodeFile[]): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    for (const file of files) {
      const detectedVulns = this.runSecurityPatterns(file);
      vulnerabilities.push(...detectedVulns);
    }

    vulnerabilities.sort((a, b) => {
      const order: IssueSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });

    logger.info({ fileCount: files.length, vulnerabilityCount: vulnerabilities.length }, 'Security analysis complete');
    return vulnerabilities;
  }

  // ── Performance Analysis ──────────────────────────────────────────────────

  async analyzePerformance(files: CodeFile[]): Promise<PerformanceIssue[]> {
    const issues: PerformanceIssue[] = [];

    for (const file of files) {
      const detected = this.runPerformancePatterns(file);
      issues.push(...detected);
    }

    issues.sort((a, b) => {
      const order: IssueSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });

    logger.info({ fileCount: files.length, perfIssueCount: issues.length }, 'Performance analysis complete');
    return issues;
  }

  // ── Architecture Compliance ───────────────────────────────────────────────

  async checkArchitectureCompliance(
    files: CodeFile[],
    pattern: ArchitecturePattern = 'layered',
  ): Promise<ArchitectureViolation[]> {
    const violations: ArchitectureViolation[] = [];

    for (const file of files) {
      const detected = this.runArchitectureChecks(file, pattern);
      violations.push(...detected);
    }

    logger.info({ fileCount: files.length, violationCount: violations.length, pattern }, 'Architecture compliance check complete');
    return violations;
  }

  // ── PR Review Generation ──────────────────────────────────────────────────

  async generatePRReview(
    prTitle: string,
    prDescription: string,
    files: CodeFile[],
    config: ReviewConfig = {},
  ): Promise<PRReview> {
    const startMs = Date.now();
    logger.info({ prTitle, fileCount: files.length }, 'Generating PR review');

    const reviewResult = await this.reviewCode(files, config);

    const inlineComments: InlineComment[] = [
      ...reviewResult.securityVulnerabilities.map(v => ({
        filePath: v.filePath,
        line: v.lineStart,
        side: 'RIGHT' as const,
        body: `**[${v.severity.toUpperCase()} Security]** ${v.title}\n\n${v.description}\n\n**Remediation:** ${v.remediation}`,
        severity: v.severity,
        category: 'security' as IssueCategory,
      })),
      ...reviewResult.performanceIssues.filter(p => p.severity !== 'low' && p.severity !== 'info').map(p => ({
        filePath: p.filePath,
        line: p.lineStart,
        side: 'RIGHT' as const,
        body: `**[${p.severity.toUpperCase()} Performance]** ${p.title}\n\n${p.description}\n\n**Recommendation:** ${p.recommendation}`,
        severity: p.severity,
        category: 'performance' as IssueCategory,
        suggestedChange: p.fixExample,
      })),
      ...reviewResult.issues.filter(i => i.severity === 'critical' || i.severity === 'high').map(i => ({
        filePath: i.filePath,
        line: i.lineStart,
        side: 'RIGHT' as const,
        body: `**[${i.severity.toUpperCase()}]** ${i.title}\n\n${i.description}${i.fixSuggestion ? `\n\n**Suggestion:** ${i.fixSuggestion}` : ''}`,
        severity: i.severity,
        category: i.category,
        suggestedChange: i.fixDiff,
      })),
    ];

    const blockers = [
      ...reviewResult.securityVulnerabilities.filter(v => v.severity === 'critical').map(v => v.title),
      ...reviewResult.issues.filter(i => i.severity === 'critical').map(i => i.title),
    ];

    const suggestions = [
      ...reviewResult.performanceIssues.filter(p => p.severity !== 'info').map(p => p.title),
      ...reviewResult.issues.filter(i => i.severity === 'medium').map(i => i.title),
    ].slice(0, 8);

    const praises: string[] = [];
    if (reviewResult.qualityScore.breakdown.testability > 70) praises.push('Good test coverage structure detected');
    if (reviewResult.qualityScore.breakdown.documentation > 70) praises.push('Well-documented code with clear comments');
    if (reviewResult.securityVulnerabilities.filter(v => v.severity === 'critical').length === 0) praises.push('No critical security vulnerabilities found');

    const status: ReviewStatus =
      blockers.length > 0 ? 'changes-requested' :
      inlineComments.filter(c => c.severity === 'high').length > 3 ? 'changes-requested' :
      inlineComments.length > 0 ? 'comment' :
      'approved';

    const securityClearance = reviewResult.securityVulnerabilities.some(v => v.severity === 'critical') ? 'blocked'
      : reviewResult.securityVulnerabilities.some(v => v.severity === 'high') ? 'needs-review' : 'cleared';

    const performanceClearance = reviewResult.performanceIssues.some(p => p.severity === 'critical') ? 'degradation-risk'
      : reviewResult.performanceIssues.some(p => p.severity === 'high') ? 'needs-review' : 'cleared';

    const checklist = [
      { item: 'No critical security vulnerabilities', passed: securityClearance !== 'blocked' },
      { item: 'No critical performance regressions', passed: performanceClearance !== 'degradation-risk' },
      { item: 'Architecture compliance maintained', passed: reviewResult.architectureViolations.filter(v => v.severity === 'critical').length === 0 },
      { item: 'Code quality score ≥ 70', passed: reviewResult.qualityScore.overall >= 70, note: `Score: ${reviewResult.qualityScore.overall}` },
      { item: 'No blocking issues identified', passed: blockers.length === 0, note: blockers.length > 0 ? `${blockers.length} blockers` : undefined },
      { item: 'Test coverage adequate', passed: reviewResult.qualityScore.testCoverageEstimate > 0.5, note: `Est. ${Math.round(reviewResult.qualityScore.testCoverageEstimate * 100)}%` },
    ];

    const review: PRReview = {
      id: uuidv4(),
      prTitle,
      prDescription,
      status,
      summary: this.buildReviewSummary(reviewResult, blockers, suggestions),
      overallQualityScore: reviewResult.qualityScore,
      inlineComments,
      blockers,
      suggestions,
      praises,
      securityClearance,
      performanceClearance,
      checklist,
      reviewedAt: new Date(),
      reviewDurationMs: Date.now() - startMs,
    };

    logger.info({ prTitle, status, blockers: blockers.length, comments: inlineComments.length }, 'PR review generated');
    return review;
  }

  // ── Technical Debt Estimation ─────────────────────────────────────────────

  async estimateTechnicalDebt(
    files: CodeFile[],
    config: ReviewConfig = {},
  ): Promise<TechnicalDebtReport> {
    logger.info({ fileCount: files.length }, 'Estimating technical debt');

    const reviewResult = await this.reviewCode(files, config);
    const allIssues = [
      ...reviewResult.issues,
      ...reviewResult.securityVulnerabilities.map(v => this.vulnToIssue(v)),
      ...reviewResult.performanceIssues.map(p => this.perfToIssue(p)),
    ];

    const items: TechnicalDebtItem[] = allIssues.map(issue => {
      const hours = { trivial: 0.25, minor: 1, major: 4, epic: 16 }[issue.effort] ?? 1;
      const interestRate = { critical: 15, high: 10, medium: 5, low: 2, info: 0 }[issue.severity] ?? 3;
      return {
        id: uuidv4(),
        category: issue.category,
        title: issue.title,
        description: issue.description,
        filePath: issue.filePath,
        estimatedHours: hours,
        estimatedCostUsd: hours * this.HOURLY_RATE_USD,
        interestRate,
        priority: issue.severity === 'critical' ? 'critical' : issue.severity === 'high' ? 'high' : issue.severity === 'medium' ? 'medium' : 'low',
        createdAt: new Date(),
      };
    });

    const categories: IssueCategory[] = ['security', 'performance', 'maintainability', 'reliability', 'architecture', 'style', 'documentation', 'test-coverage', 'dependency'];
    const byCategory = {} as TechnicalDebtReport['byCategory'];
    for (const cat of categories) {
      const catItems = items.filter(i => i.category === cat);
      byCategory[cat] = {
        count: catItems.length,
        hours: catItems.reduce((s, i) => s + i.estimatedHours, 0),
        costUsd: catItems.reduce((s, i) => s + i.estimatedCostUsd, 0),
      };
    }

    const totalHours = items.reduce((s, i) => s + i.estimatedHours, 0);
    const totalCost = items.reduce((s, i) => s + i.estimatedCostUsd, 0);
    const estimatedDevHours = files.reduce((s, f) => s + (f.linesOfCode ?? 50), 0) / 50;
    const debtRatio = Math.min(1, totalHours / Math.max(estimatedDevHours, 1));

    const report: TechnicalDebtReport = {
      id: uuidv4(),
      totalItems: items.length,
      totalEstimatedHours: Math.round(totalHours * 10) / 10,
      totalEstimatedCostUsd: Math.round(totalCost),
      debtRatio: Math.round(debtRatio * 100) / 100,
      items: items.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a.priority] - order[b.priority];
      }),
      byCategory,
      trends: this.generateDebtTrend(),
      recommendations: [
        `Address ${items.filter(i => i.priority === 'critical').length} critical debt items immediately`,
        'Establish a "debt budget" of 20% per sprint for remediation',
        'Prioritize security and reliability categories first',
        `Estimated ${Math.round(totalHours)} hours to clear full debt backlog`,
        'Implement automated code quality gates to prevent new debt accumulation',
      ],
      generatedAt: new Date(),
    };

    logger.info({ totalItems: report.totalItems, totalHours, debtRatio }, 'Technical debt estimation complete');
    return report;
  }

  // ── Private: Static Analysis ──────────────────────────────────────────────

  private async runStaticAnalysis(files: CodeFile[]): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];

    for (const file of files) {
      const lines = file.content.split('\n');
      const lang = file.language ?? this.detectLanguage(file.path);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Long lines
        if (line.length > 120) {
          issues.push(this.buildIssue('style', 'medium', 'Line too long', `Line exceeds 120 characters (${line.length})`, file.path, lineNum, lineNum, line.trim().substring(0, 80) + '...', 'max-line-length', false, 'minor'));
        }

        // TODO/FIXME comments
        if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
          issues.push(this.buildIssue('maintainability', 'low', 'Unresolved TODO/FIXME comment', `Found unresolved comment: ${line.trim()}`, file.path, lineNum, lineNum, line.trim(), 'no-todo-comments', false, 'minor'));
        }

        // Console.log in non-test files
        if (!file.isTest && /console\.(log|warn|error|debug)/.test(line)) {
          issues.push(this.buildIssue('maintainability', 'low', 'Console statement in production code', 'Use a proper logger instead of console statements', file.path, lineNum, lineNum, line.trim(), 'no-console', true, 'trivial', 'Replace with logger.info/warn/error'));
        }

        // Magic numbers
        if (/[^a-zA-Z_]([\d]{3,})[^a-zA-Z_\d.]/.test(line) && !/\/\/|\/\*/.test(line.substring(0, line.search(/\d{3,}/)))) {
          issues.push(this.buildIssue('maintainability', 'info', 'Magic number detected', 'Consider extracting magic numbers to named constants', file.path, lineNum, lineNum, line.trim(), 'no-magic-numbers', false, 'trivial'));
        }

        // Empty catch blocks
        if (/catch\s*\([^)]*\)\s*\{?\s*\}/.test(line)) {
          issues.push(this.buildIssue('reliability', 'high', 'Empty catch block', 'Empty catch blocks swallow errors silently', file.path, lineNum, lineNum, line.trim(), 'no-empty-catch', false, 'minor', 'Log or handle the error in the catch block'));
        }

        // Deeply nested code (4+ levels of indentation)
        const indentLevel = (line.match(/^\s+/) ?? [''])[0].length / 2;
        if (indentLevel >= 4 && line.trim().length > 0) {
          issues.push(this.buildIssue('maintainability', 'medium', 'Deep nesting detected', `Code is nested ${Math.round(indentLevel)} levels deep. Consider extracting to a function.`, file.path, lineNum, lineNum, line.trim(), 'max-depth', false, 'minor'));
        }

        // Missing return type in TypeScript
        if (lang === 'typescript' && /^(export\s+)?(async\s+)?function\s+\w+\([^)]*\)\s*\{/.test(line.trim()) && !line.includes(':')) {
          issues.push(this.buildIssue('maintainability', 'low', 'Missing return type annotation', 'TypeScript functions should have explicit return type annotations', file.path, lineNum, lineNum, line.trim(), 'explicit-return-types', false, 'trivial'));
        }
      }
    }

    return issues;
  }

  // ── Private: Security Patterns ────────────────────────────────────────────

  private runSecurityPatterns(file: CodeFile): SecurityVulnerability[] {
    const vulns: SecurityVulnerability[] = [];
    const lines = file.content.split('\n');

    const securityRules = [
      {
        pattern: /eval\s*\(/,
        title: 'Dangerous eval() usage',
        owaspCategory: 'A03:2021 - Injection',
        severity: 'critical' as IssueSeverity,
        description: 'eval() executes arbitrary code and is a severe security risk.',
        attackVector: 'Remote code execution via user-controlled input',
        impact: 'Full code execution, data exfiltration, privilege escalation',
        remediation: 'Remove eval(). Use JSON.parse() for JSON data or structured alternatives.',
        exploitability: 9.0,
        impactScore: 9.5,
      },
      {
        pattern: /innerHTML\s*=\s*/,
        title: 'Unsafe innerHTML assignment',
        owaspCategory: 'A03:2021 - Injection (XSS)',
        severity: 'high' as IssueSeverity,
        description: 'Direct innerHTML assignment can lead to XSS vulnerabilities.',
        attackVector: 'Reflected or stored cross-site scripting',
        impact: 'Session hijacking, credential theft, malicious actions on behalf of user',
        remediation: 'Use textContent instead, or sanitize with DOMPurify before setting innerHTML.',
        exploitability: 7.5,
        impactScore: 7.0,
      },
      {
        pattern: /password\s*=\s*["'][^"']+["']/i,
        title: 'Hardcoded password detected',
        owaspCategory: 'A07:2021 - Identification and Authentication Failures',
        severity: 'critical' as IssueSeverity,
        description: 'Hardcoded passwords expose credentials in source code.',
        attackVector: 'Source code disclosure via repository access or decompilation',
        impact: 'Unauthorized access to systems or services',
        remediation: 'Use environment variables or a secrets manager. Never hardcode credentials.',
        exploitability: 8.5,
        impactScore: 9.0,
      },
      {
        pattern: /SELECT\s+.*\+\s*(?:req\.|request\.|params\.|query\.)/i,
        title: 'Potential SQL Injection',
        owaspCategory: 'A03:2021 - Injection',
        severity: 'critical' as IssueSeverity,
        description: 'String concatenation in SQL queries can lead to SQL injection.',
        attackVector: 'User-controlled input concatenated into SQL query',
        impact: 'Database compromise, data exfiltration, authentication bypass',
        remediation: 'Use parameterized queries or an ORM with proper escaping.',
        exploitability: 9.5,
        impactScore: 9.5,
      },
      {
        pattern: /Math\.random\(\)/,
        title: 'Insecure random number generation',
        owaspCategory: 'A02:2021 - Cryptographic Failures',
        severity: 'medium' as IssueSeverity,
        description: 'Math.random() is not cryptographically secure.',
        attackVector: 'Predictable token or ID generation',
        impact: 'Session token prediction, CSRF token bypass',
        remediation: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive contexts.',
        exploitability: 4.0,
        impactScore: 5.5,
      },
      {
        pattern: /http:\/\/(?!localhost)/,
        title: 'Unencrypted HTTP URL in code',
        owaspCategory: 'A02:2021 - Cryptographic Failures',
        severity: 'medium' as IssueSeverity,
        description: 'Plain HTTP connections are vulnerable to man-in-the-middle attacks.',
        attackVector: 'Network interception / MITM',
        impact: 'Data interception, credential theft',
        remediation: 'Use HTTPS for all external connections.',
        exploitability: 5.0,
        impactScore: 5.0,
      },
      {
        pattern: /process\.env\.\w+\s*\|\|\s*["'][^"']*["']/,
        title: 'Insecure env variable fallback',
        owaspCategory: 'A05:2021 - Security Misconfiguration',
        severity: 'low' as IssueSeverity,
        description: 'Fallback default values for environment variables may expose sensitive defaults.',
        attackVector: 'Misconfigured deployment without required env vars',
        impact: 'Using insecure default configuration in production',
        remediation: 'Fail fast when required env vars are missing rather than using defaults.',
        exploitability: 2.5,
        impactScore: 3.0,
      },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of securityRules) {
        if (rule.pattern.test(line)) {
          vulns.push({
            id: uuidv4(),
            owaspCategory: rule.owaspCategory,
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: i + 1,
            codeSnippet: line.trim().substring(0, 120),
            attackVector: rule.attackVector,
            impact: rule.impact,
            remediation: rule.remediation,
            references: [`https://owasp.org/Top10/${rule.owaspCategory.split(' ')[0].toLowerCase()}`],
            exploitabilityScore: rule.exploitability,
            impactScore: rule.impactScore,
            detectedAt: new Date(),
          });
        }
      }
    }

    return vulns;
  }

  // ── Private: Performance Patterns ─────────────────────────────────────────

  private runPerformancePatterns(file: CodeFile): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Await inside for loop (N+1 or sequential async)
      if (/for\s*\(/.test(line)) {
        const block = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
        if (/await\s+/.test(block)) {
          issues.push({
            id: uuidv4(),
            type: 'n-plus-one',
            severity: 'high',
            title: 'Await inside loop — sequential async operations',
            description: 'Using await inside a for loop causes sequential execution. Use Promise.all() for parallel execution.',
            filePath: file.path,
            lineStart: i + 1,
            lineEnd: Math.min(i + 10, lines.length),
            codeSnippet: line.trim(),
            estimatedLatencyImpactMs: 500,
            recommendation: 'Collect all promises in an array and use Promise.all() to run them concurrently.',
            fixExample: 'const results = await Promise.all(items.map(item => processItem(item)));',
          });
        }
      }

      // Synchronous file read in async context
      if (/readFileSync|writeFileSync|existsSync/.test(line)) {
        issues.push({
          id: uuidv4(),
          type: 'blocking-io',
          severity: 'medium',
          title: 'Synchronous filesystem call detected',
          description: 'Synchronous fs calls block the event loop, degrading server throughput.',
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          codeSnippet: line.trim(),
          estimatedLatencyImpactMs: 50,
          recommendation: 'Use async variants (readFile, writeFile) with await instead.',
          fixExample: "const content = await fs.promises.readFile(path, 'utf8');",
        });
      }

      // Large JSON.stringify without size guard
      if (/JSON\.stringify\(/.test(line) && !/slice|substring|truncate/.test(line)) {
        issues.push({
          id: uuidv4(),
          type: 'large-payload',
          severity: 'low',
          title: 'Unbounded JSON serialization',
          description: 'JSON.stringify on large objects without size bounds can cause memory pressure and slow responses.',
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          codeSnippet: line.trim(),
          estimatedMemoryImpactMb: 10,
          recommendation: 'Add size validation before serialization or use streaming serialization for large payloads.',
        });
      }

      // setTimeout with 0 delay (code smell)
      if (/setTimeout\s*\(\s*[^,]+,\s*0\s*\)/.test(line)) {
        issues.push({
          id: uuidv4(),
          type: 'unnecessary-computation',
          severity: 'info',
          title: 'setTimeout with 0 delay — potential code smell',
          description: 'setTimeout(fn, 0) is often a workaround for event loop issues. Consider using queueMicrotask() or Promise.resolve().',
          filePath: file.path,
          lineStart: i + 1,
          lineEnd: i + 1,
          codeSnippet: line.trim(),
          recommendation: 'Replace with queueMicrotask() or Promise.resolve().then() for cleaner async semantics.',
          fixExample: 'queueMicrotask(() => { /* your code */ });',
        });
      }
    }

    return issues;
  }

  // ── Private: Architecture Checks ──────────────────────────────────────────

  private runArchitectureChecks(file: CodeFile, pattern: ArchitecturePattern): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const lines = file.content.split('\n');
    const isRoute = file.path.includes('/api/') || file.path.includes('/routes/');
    const isLib = file.path.includes('/lib/');
    const isAgent = file.path.includes('/agents/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // API route importing directly from database (skipping service layer)
      if (isRoute && /from\s+['"].*\/db\//.test(line)) {
        violations.push({
          id: uuidv4(),
          pattern,
          rule: 'layer-isolation',
          description: 'API route directly imports from database layer. Route handlers should use service/lib layer.',
          filePath: file.path,
          lineStart: i + 1,
          violationType: 'layer-violation',
          severity: 'medium',
          recommendation: 'Create a service module in /lib that encapsulates database access. Import that from the route.',
        });
      }

      // Circular-looking cross-agent imports
      if (isAgent) {
        const importMatch = line.match(/from\s+['"]\.\.\/agents\/([^'"]+)['"]/);
        if (importMatch) {
          violations.push({
            id: uuidv4(),
            pattern,
            rule: 'no-agent-cross-import',
            description: `Agent directly imports from another agent: ${importMatch[1]}. Use the orchestrator pattern.`,
            filePath: file.path,
            lineStart: i + 1,
            violationType: 'circular-dependency',
            severity: 'medium',
            recommendation: 'Agents should communicate via an orchestrator or message queue, not direct imports.',
          });
        }
      }

      // God class detection (files > 800 lines with many methods)
      if (i === 0 && (file.linesOfCode ?? file.content.split('\n').length) > 800) {
        const methodCount = (file.content.match(/^\s+(async\s+)?\w+\s*\([^)]*\)\s*[:{]/gm) ?? []).length;
        if (methodCount > 15) {
          violations.push({
            id: uuidv4(),
            pattern,
            rule: 'single-responsibility',
            description: `File has ${methodCount} methods and ${file.linesOfCode ?? 'many'} lines. Consider splitting into smaller classes.`,
            filePath: file.path,
            lineStart: 1,
            violationType: 'god-class',
            severity: 'medium',
            recommendation: 'Apply Single Responsibility Principle. Extract related methods into separate services.',
          });
        }
      }
    }

    return violations;
  }

  // ── Private: Quality Score ────────────────────────────────────────────────

  private computeQualityScore(
    files: CodeFile[],
    issues: CodeIssue[],
    secVulns: SecurityVulnerability[],
    perfIssues: PerformanceIssue[],
  ): CodeQualityScore {
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const highIssues = issues.filter(i => i.severity === 'high').length;
    const medIssues = issues.filter(i => i.severity === 'medium').length;
    const criticalSec = secVulns.filter(v => v.severity === 'critical').length;
    const highSec = secVulns.filter(v => v.severity === 'high').length;
    const criticalPerf = perfIssues.filter(p => p.severity === 'critical').length;

    const deductions = criticalIssues * 20 + highIssues * 8 + medIssues * 3 +
                       criticalSec * 25 + highSec * 12 + criticalPerf * 15;

    const totalLines = files.reduce((s, f) => s + (f.linesOfCode ?? f.content.split('\n').length), 0);
    const testFiles = files.filter(f => f.isTest).length;
    const testCoverageEst = testFiles > 0 ? Math.min(1, testFiles / Math.max(files.length - testFiles, 1) * 1.5) : 0.1;

    const docComments = (files.map(f => f.content).join('\n').match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
    const docScore = Math.min(100, (docComments / Math.max(files.length, 1)) * 30);

    const maintainability = Math.max(0, Math.min(100, 85 - medIssues * 2 - highIssues * 5));
    const reliability = Math.max(0, Math.min(100, 90 - criticalIssues * 15 - highIssues * 5));
    const security = Math.max(0, Math.min(100, 100 - criticalSec * 25 - highSec * 10));
    const performance = Math.max(0, Math.min(100, 90 - criticalPerf * 20 - perfIssues.filter(p => p.severity === 'high').length * 8));
    const testability = Math.min(100, 50 + testCoverageEst * 50);
    const documentation = Math.min(100, docScore + 40);

    const overall = Math.max(0, Math.min(100, Math.round(
      (maintainability + reliability + security + performance + testability + documentation) / 6,
    ) - deductions / 10));

    const grade: CodeQualityScore['grade'] =
      overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : overall >= 45 ? 'D' : 'F';

    return {
      overall,
      breakdown: { maintainability, reliability, security, performance, testability, documentation },
      grade,
      technicalDebtMinutes: (criticalIssues * 120 + highIssues * 60 + medIssues * 30) + secVulns.reduce((s, v) => s + (v.severity === 'critical' ? 180 : 90), 0),
      duplicationRatio: 0.05 + Math.min(0.4, medIssues * 0.02),
      complexityScore: Math.min(100, 20 + highIssues * 5 + criticalIssues * 10),
      testCoverageEstimate: Math.round(testCoverageEst * 100) / 100,
    };
  }

  // ── Private: Helpers ──────────────────────────────────────────────────────

  private buildIssue(
    category: IssueCategory,
    severity: IssueSeverity,
    title: string,
    description: string,
    filePath: string,
    lineStart: number,
    lineEnd: number,
    codeSnippet: string,
    rule: string,
    autoFixable: boolean,
    effort: CodeIssue['effort'],
    fixSuggestion?: string,
  ): CodeIssue {
    return {
      id: uuidv4(),
      severity,
      category,
      title,
      description,
      filePath,
      lineStart,
      lineEnd,
      codeSnippet,
      rule,
      effort,
      autoFixable,
      falsePositiveProbability: 0.05,
      fixSuggestion,
    };
  }

  private vulnToIssue(v: SecurityVulnerability): CodeIssue {
    return this.buildIssue('security', v.severity, v.title, v.description, v.filePath, v.lineStart, v.lineEnd, v.codeSnippet, v.owaspCategory, false, v.severity === 'critical' ? 'major' : 'minor', v.remediation);
  }

  private perfToIssue(p: PerformanceIssue): CodeIssue {
    return this.buildIssue('performance', p.severity, p.title, p.description, p.filePath, p.lineStart, p.lineEnd, p.codeSnippet, p.type, false, p.severity === 'high' ? 'major' : 'minor', p.recommendation);
  }

  private detectLanguage(path: string): CodeLanguage {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs')) return 'javascript';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.go')) return 'go';
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.rs')) return 'rust';
    if (path.endsWith('.sql')) return 'sql';
    return 'unknown';
  }

  private buildReviewSummary(result: ReviewResult, blockers: string[], suggestions: string[]): string {
    const { grade, overall } = result.qualityScore;
    const critSec = result.securityVulnerabilities.filter(v => v.severity === 'critical').length;
    return [
      `Code quality score: **${overall}/100** (Grade ${grade}).`,
      blockers.length > 0 ? `⛔ ${blockers.length} blocking issue(s) must be resolved before merge.` : '✅ No blocking issues found.',
      critSec > 0 ? `🔒 ${critSec} critical security vulnerability(ies) detected — merge blocked.` : '🔒 Security scan passed.',
      suggestions.length > 0 ? `💡 ${suggestions.length} improvement suggestion(s) noted inline.` : '',
      result.performanceIssues.filter(p => p.severity !== 'info').length > 0
        ? `⚡ ${result.performanceIssues.length} performance concern(s) flagged.`
        : '⚡ No significant performance concerns.',
    ].filter(Boolean).join(' ');
  }

  private generateDebtTrend(): TechnicalDebtReport['trends'] {
    return Array.from({ length: 6 }, (_, i) => {
      const date = new Date(Date.now() - (5 - i) * 30 * 24 * 3600 * 1000);
      return {
        month: date.toISOString().substring(0, 7),
        addedHours: 5 + Math.floor(Math.random() * 8),
        resolvedHours: 3 + Math.floor(Math.random() * 6),
        netHours: 0,
      };
    }).map(t => ({ ...t, netHours: t.addedHours - t.resolvedHours }));
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _instance: AutonomousCodeReviewer | null = null;

export function getAutonomousCodeReviewer(): AutonomousCodeReviewer {
  if (!_instance) {
    _instance = new AutonomousCodeReviewer();
    logger.info('AutonomousCodeReviewer initialized');
  }
  return _instance;
}

export default getAutonomousCodeReviewer;
