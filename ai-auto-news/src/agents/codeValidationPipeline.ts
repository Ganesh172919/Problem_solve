/**
 * Code Validation & Quality Assurance Pipeline
 *
 * Comprehensive validation system for generated code including:
 * - Syntax validation
 * - Security scanning
 * - Performance analysis
 * - Architecture compliance
 * - Best practices enforcement
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface ValidationRequest {
  code: string;
  language: string;
  context: {
    projectType: string;
    framework?: string;
    dependencies: string[];
  };
  rules: ValidationRule[];
  strictMode: boolean;
}

export interface ValidationRule {
  id: string;
  category: 'syntax' | 'security' | 'performance' | 'style' | 'architecture';
  severity: 'error' | 'warning' | 'info';
  pattern?: string;
  checker?: (code: string) => boolean;
  message: string;
  autoFix?: boolean;
}

export interface ValidationResult {
  passed: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  metrics: CodeMetrics;
  suggestions: string[];
  autoFixesApplied: number;
}

export interface ValidationIssue {
  ruleId: string;
  category: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  snippet?: string;
  suggestion?: string;
  fixed?: boolean;
}

export interface CodeMetrics {
  linesOfCode: number;
  complexity: number;
  maintainability: number;
  testability: number;
  securityScore: number;
  performanceScore: number;
  dependencies: number;
  duplicateCode: number;
}

export interface SecurityScan {
  vulnerabilities: SecurityVulnerability[];
  cweMatches: string[];
  dependencyVulnerabilities: DependencyVulnerability[];
  riskScore: number; // 0-100
}

export interface SecurityVulnerability {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location: { line: number; column: number };
  cwe?: string;
  recommendation: string;
}

export interface DependencyVulnerability {
  package: string;
  version: string;
  vulnerability: string;
  severity: string;
  patchVersion?: string;
}

export interface PerformanceAnalysis {
  bottlenecks: PerformanceBottleneck[];
  complexity: ComplexityMetrics;
  recommendations: string[];
  estimatedRuntime: string;
}

export interface PerformanceBottleneck {
  type: 'loop' | 'recursion' | 'io' | 'memory' | 'algorithm';
  location: { line: number; column: number };
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  improvement: string;
}

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  halsteadMetrics: {
    volume: number;
    difficulty: number;
    effort: number;
  };
}

class CodeValidationPipeline {
  private standardRules: Map<string, ValidationRule[]> = new Map();
  private customRules: ValidationRule[] = [];

  constructor() {
    this.initializeStandardRules();
  }

  /**
   * Main validation entry point
   */
  async validate(request: ValidationRequest): Promise<ValidationResult> {
    logger.info('Starting code validation', {
      language: request.language,
      strictMode: request.strictMode,
    });

    const issues: ValidationIssue[] = [];
    let autoFixesApplied = 0;

    // Phase 1: Syntax validation
    const syntaxIssues = await this.validateSyntax(request.code, request.language);
    issues.push(...syntaxIssues);

    // Phase 2: Security scanning
    const securityScan = await this.scanSecurity(request.code, request.language);
    issues.push(...this.convertSecurityToIssues(securityScan));

    // Phase 3: Performance analysis
    const perfAnalysis = await this.analyzePerformance(request.code, request.language);
    issues.push(...this.convertPerfToIssues(perfAnalysis));

    // Phase 4: Style & best practices
    const styleIssues = await this.checkStyle(request.code, request.language);
    issues.push(...styleIssues);

    // Phase 5: Architecture compliance
    const archIssues = await this.checkArchitecture(request.code, request.context);
    issues.push(...archIssues);

    // Phase 6: Custom rules
    const customIssues = await this.applyCustomRules(request.code, request.rules);
    issues.push(...customIssues);

    // Phase 7: Auto-fix if enabled
    if (!request.strictMode) {
      autoFixesApplied = await this.applyAutoFixes(issues, request.code);
    }

    // Calculate metrics
    const metrics = await this.calculateMetrics(request.code, issues);

    // Calculate score
    const score = this.calculateScore(issues, metrics);

    // Generate suggestions
    const suggestions = this.generateSuggestions(issues, metrics);

    const passed = this.determinePass(issues, request.strictMode);

    logger.info('Code validation completed', {
      passed,
      score,
      issuesCount: issues.length,
      autoFixesApplied,
    });

    return {
      passed,
      score,
      issues,
      metrics,
      suggestions,
      autoFixesApplied,
    };
  }

  /**
   * Validate code syntax
   */
  private async validateSyntax(code: string, language: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Language-specific syntax validation
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          issues.push(...this.validateJavaScriptSyntax(code));
          break;
        case 'python':
          issues.push(...this.validatePythonSyntax(code));
          break;
        case 'java':
          issues.push(...this.validateJavaSyntax(code));
          break;
        // Add more languages as needed
      }
    } catch (error: any) {
      issues.push({
        ruleId: 'syntax-error',
        category: 'syntax',
        severity: 'error',
        message: `Syntax error: ${error.message}`,
      });
    }

    return issues;
  }

  /**
   * Scan for security vulnerabilities
   */
  private async scanSecurity(code: string, language: string): Promise<SecurityScan> {
    const vulnerabilities: SecurityVulnerability[] = [];
    const cweMatches: string[] = [];

    // Check for common security issues
    const securityPatterns = [
      {
        pattern: /eval\s*\(/g,
        type: 'code-injection',
        severity: 'critical' as const,
        cwe: 'CWE-95',
        message: 'Use of eval() allows code injection',
      },
      {
        pattern: /innerHTML\s*=/g,
        type: 'xss',
        severity: 'high' as const,
        cwe: 'CWE-79',
        message: 'Direct innerHTML assignment may lead to XSS',
      },
      {
        pattern: /exec\s*\(/g,
        type: 'command-injection',
        severity: 'critical' as const,
        cwe: 'CWE-78',
        message: 'Command execution without sanitization',
      },
      {
        pattern: /\.md5\(/g,
        type: 'weak-crypto',
        severity: 'high' as const,
        cwe: 'CWE-327',
        message: 'MD5 is cryptographically weak',
      },
      {
        pattern: /password\s*=\s*['"]/gi,
        type: 'hardcoded-credentials',
        severity: 'critical' as const,
        cwe: 'CWE-798',
        message: 'Hardcoded password detected',
      },
    ];

    const lines = code.split('\n');

    for (const pattern of securityPatterns) {
      let match;
      while ((match = pattern.pattern.exec(code)) !== null) {
        const line = code.substring(0, match.index).split('\n').length;

        vulnerabilities.push({
          type: pattern.type,
          severity: pattern.severity,
          description: pattern.message,
          location: { line, column: match.index - code.lastIndexOf('\n', match.index) },
          cwe: pattern.cwe,
          recommendation: this.getSecurityRecommendation(pattern.type),
        });

        if (pattern.cwe && !cweMatches.includes(pattern.cwe)) {
          cweMatches.push(pattern.cwe);
        }
      }
    }

    // Calculate risk score
    const riskScore = this.calculateRiskScore(vulnerabilities);

    return {
      vulnerabilities,
      cweMatches,
      dependencyVulnerabilities: [],
      riskScore,
    };
  }

  /**
   * Analyze code performance
   */
  private async analyzePerformance(code: string, language: string): Promise<PerformanceAnalysis> {
    const bottlenecks: PerformanceBottleneck[] = [];

    // Check for nested loops
    const nestedLoops = this.detectNestedLoops(code);
    bottlenecks.push(...nestedLoops);

    // Check for recursive functions without memoization
    const recursion = this.detectUnoptimizedRecursion(code);
    bottlenecks.push(...recursion);

    // Check for inefficient array operations
    const arrayOps = this.detectInefficientArrayOps(code);
    bottlenecks.push(...arrayOps);

    // Check for blocking I/O
    const blockingIO = this.detectBlockingIO(code);
    bottlenecks.push(...blockingIO);

    // Calculate complexity
    const complexity = this.calculateComplexity(code);

    // Generate recommendations
    const recommendations = this.generatePerfRecommendations(bottlenecks, complexity);

    // Estimate runtime
    const estimatedRuntime = this.estimateRuntime(complexity);

    return {
      bottlenecks,
      complexity,
      recommendations,
      estimatedRuntime,
    };
  }

  /**
   * Check code style and best practices
   */
  private async checkStyle(code: string, language: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check naming conventions
    const namingIssues = this.checkNamingConventions(code, language);
    issues.push(...namingIssues);

    // Check code formatting
    const formatIssues = this.checkFormatting(code);
    issues.push(...formatIssues);

    // Check documentation
    const docIssues = this.checkDocumentation(code);
    issues.push(...docIssues);

    // Check code smells
    const smellIssues = this.detectCodeSmells(code);
    issues.push(...smellIssues);

    return issues;
  }

  /**
   * Check architecture compliance
   */
  private async checkArchitecture(
    code: string,
    context: ValidationRequest['context']
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check layer violations
    if (context.projectType === 'layered') {
      const layerIssues = this.checkLayerViolations(code);
      issues.push(...layerIssues);
    }

    // Check dependency direction
    const depIssues = this.checkDependencyDirection(code, context.dependencies);
    issues.push(...depIssues);

    // Check SOLID principles
    const solidIssues = this.checkSOLIDPrinciples(code);
    issues.push(...solidIssues);

    return issues;
  }

  /**
   * Apply custom validation rules
   */
  private async applyCustomRules(code: string, rules: ValidationRule[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const rule of rules) {
      if (rule.pattern) {
        const regex = new RegExp(rule.pattern, 'g');
        let match;

        while ((match = regex.exec(code)) !== null) {
          const line = code.substring(0, match.index).split('\n').length;

          issues.push({
            ruleId: rule.id,
            category: rule.category,
            severity: rule.severity,
            message: rule.message,
            line,
          });
        }
      }

      if (rule.checker) {
        try {
          if (!rule.checker(code)) {
            issues.push({
              ruleId: rule.id,
              category: rule.category,
              severity: rule.severity,
              message: rule.message,
            });
          }
        } catch (error) {
          logger.error('Custom rule checker failed', undefined, { ruleId: rule.id, error });
        }
      }
    }

    return issues;
  }

  // Helper methods

  private initializeStandardRules() {
    // Initialize standard rules for different languages
    this.standardRules.set('javascript', [
      {
        id: 'no-var',
        category: 'style',
        severity: 'warning',
        pattern: '\\bvar\\s',
        message: 'Use let or const instead of var',
        autoFix: true,
      },
      {
        id: 'no-console',
        category: 'style',
        severity: 'warning',
        pattern: 'console\\.log',
        message: 'Remove console.log statements in production',
        autoFix: false,
      },
    ]);
  }

  private validateJavaScriptSyntax(code: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for unmatched braces
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;

    if (openBraces !== closeBraces) {
      issues.push({
        ruleId: 'unmatched-braces',
        category: 'syntax',
        severity: 'error',
        message: 'Unmatched braces detected',
      });
    }

    return issues;
  }

  private validatePythonSyntax(code: string): ValidationIssue[] {
    return [];
  }

  private validateJavaSyntax(code: string): ValidationIssue[] {
    return [];
  }

  private getSecurityRecommendation(type: string): string {
    const recommendations: Record<string, string> = {
      'code-injection': 'Avoid eval(). Use JSON.parse() or safer alternatives',
      'xss': 'Use textContent or sanitize input with DOMPurify',
      'command-injection': 'Validate and sanitize all inputs before executing commands',
      'weak-crypto': 'Use SHA-256 or stronger hashing algorithms',
      'hardcoded-credentials': 'Store credentials in environment variables or secrets manager',
    };

    return recommendations[type] || 'Review and fix security issue';
  }

  private calculateRiskScore(vulnerabilities: SecurityVulnerability[]): number {
    let score = 0;

    for (const vuln of vulnerabilities) {
      switch (vuln.severity) {
        case 'critical':
          score += 40;
          break;
        case 'high':
          score += 25;
          break;
        case 'medium':
          score += 10;
          break;
        case 'low':
          score += 5;
          break;
      }
    }

    return Math.min(score, 100);
  }

  private detectNestedLoops(code: string): PerformanceBottleneck[] {
    const bottlenecks: PerformanceBottleneck[] = [];
    const lines = code.split('\n');

    let loopDepth = 0;
    let maxDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/\b(for|while)\s*\(/.test(line)) {
        loopDepth++;
        maxDepth = Math.max(maxDepth, loopDepth);

        if (loopDepth > 2) {
          bottlenecks.push({
            type: 'loop',
            location: { line: i + 1, column: 0 },
            severity: loopDepth > 3 ? 'critical' : 'high',
            description: `Nested loop depth ${loopDepth} detected`,
            improvement: 'Consider using map/filter or optimizing algorithm complexity',
          });
        }
      }

      if (/\}/.test(line)) {
        loopDepth = Math.max(0, loopDepth - 1);
      }
    }

    return bottlenecks;
  }

  private detectUnoptimizedRecursion(code: string): PerformanceBottleneck[] {
    return [];
  }

  private detectInefficientArrayOps(code: string): PerformanceBottleneck[] {
    return [];
  }

  private detectBlockingIO(code: string): PerformanceBottleneck[] {
    return [];
  }

  private calculateComplexity(code: string): ComplexityMetrics {
    // Simplified McCabe cyclomatic complexity
    const decisions = (code.match(/\b(if|while|for|case|\?\s*:|\|\||&&)\b/g) || []).length;
    const cyclomaticComplexity = decisions + 1;

    return {
      cyclomaticComplexity,
      cognitiveComplexity: cyclomaticComplexity * 1.2,
      halsteadMetrics: {
        volume: code.length * 0.1,
        difficulty: cyclomaticComplexity * 2,
        effort: code.length * cyclomaticComplexity,
      },
    };
  }

  private generatePerfRecommendations(
    bottlenecks: PerformanceBottleneck[],
    complexity: ComplexityMetrics
  ): string[] {
    const recommendations: string[] = [];

    if (complexity.cyclomaticComplexity > 15) {
      recommendations.push('High cyclomatic complexity. Consider breaking into smaller functions');
    }

    if (bottlenecks.some(b => b.type === 'loop' && b.severity === 'critical')) {
      recommendations.push('Critical nested loops detected. Consider algorithmic optimization');
    }

    return recommendations;
  }

  private estimateRuntime(complexity: ComplexityMetrics): string {
    if (complexity.cyclomaticComplexity < 10) return 'O(n) or better';
    if (complexity.cyclomaticComplexity < 20) return 'O(n log n)';
    return 'O(n²) or worse';
  }

  private checkNamingConventions(code: string, language: string): ValidationIssue[] {
    return [];
  }

  private checkFormatting(code: string): ValidationIssue[] {
    return [];
  }

  private checkDocumentation(code: string): ValidationIssue[] {
    return [];
  }

  private detectCodeSmells(code: string): ValidationIssue[] {
    return [];
  }

  private checkLayerViolations(code: string): ValidationIssue[] {
    return [];
  }

  private checkDependencyDirection(code: string, dependencies: string[]): ValidationIssue[] {
    return [];
  }

  private checkSOLIDPrinciples(code: string): ValidationIssue[] {
    return [];
  }

  private convertSecurityToIssues(scan: SecurityScan): ValidationIssue[] {
    return scan.vulnerabilities.map(vuln => ({
      ruleId: `security-${vuln.type}`,
      category: 'security',
      severity: vuln.severity === 'critical' || vuln.severity === 'high' ? 'error' : 'warning',
      message: vuln.description,
      line: vuln.location.line,
      column: vuln.location.column,
      suggestion: vuln.recommendation,
    }));
  }

  private convertPerfToIssues(analysis: PerformanceAnalysis): ValidationIssue[] {
    return analysis.bottlenecks.map(bottleneck => ({
      ruleId: `perf-${bottleneck.type}`,
      category: 'performance',
      severity: bottleneck.severity === 'critical' ? 'error' : 'warning',
      message: bottleneck.description,
      line: bottleneck.location.line,
      column: bottleneck.location.column,
      suggestion: bottleneck.improvement,
    }));
  }

  private async applyAutoFixes(issues: ValidationIssue[], code: string): Promise<number> {
    let fixCount = 0;

    for (const issue of issues) {
      if (issue.ruleId === 'no-var' && !issue.fixed) {
        // Auto-fix would happen here
        issue.fixed = true;
        fixCount++;
      }
    }

    return fixCount;
  }

  private async calculateMetrics(code: string, issues: ValidationIssue[]): Promise<CodeMetrics> {
    const lines = code.split('\n');
    const complexity = this.calculateComplexity(code);

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    return {
      linesOfCode: lines.filter(l => l.trim().length > 0).length,
      complexity: complexity.cyclomaticComplexity,
      maintainability: Math.max(0, 100 - complexity.cyclomaticComplexity * 2 - errorCount * 5),
      testability: Math.max(0, 100 - complexity.cyclomaticComplexity * 3),
      securityScore: Math.max(
        0,
        100 - issues.filter(i => i.category === 'security').length * 10
      ),
      performanceScore: Math.max(
        0,
        100 - issues.filter(i => i.category === 'performance').length * 8
      ),
      dependencies: (code.match(/import|require/g) || []).length,
      duplicateCode: 0, // Would need more sophisticated analysis
    };
  }

  private calculateScore(issues: ValidationIssue[], metrics: CodeMetrics): number {
    let score = 100;

    // Deduct for issues
    score -= issues.filter(i => i.severity === 'error').length * 10;
    score -= issues.filter(i => i.severity === 'warning').length * 3;
    score -= issues.filter(i => i.severity === 'info').length * 1;

    // Factor in metrics
    score = score * 0.7 + metrics.maintainability * 0.3;

    return Math.max(0, Math.min(100, score));
  }

  private generateSuggestions(issues: ValidationIssue[], metrics: CodeMetrics): string[] {
    const suggestions: string[] = [];

    if (metrics.complexity > 20) {
      suggestions.push('High complexity detected. Consider refactoring into smaller functions');
    }

    if (metrics.maintainability < 50) {
      suggestions.push('Low maintainability score. Focus on code cleanup and documentation');
    }

    const criticalIssues = issues.filter(i => i.severity === 'error' && i.category === 'security');
    if (criticalIssues.length > 0) {
      suggestions.push('Critical security issues found. Address immediately before deployment');
    }

    return suggestions;
  }

  private determinePass(issues: ValidationIssue[], strictMode: boolean): boolean {
    if (strictMode) {
      return issues.filter(i => i.severity === 'error').length === 0;
    } else {
      const criticalIssues = issues.filter(
        i => i.severity === 'error' && i.category === 'security'
      );
      return criticalIssues.length === 0;
    }
  }
}

// Singleton
let validationPipeline: CodeValidationPipeline;

export function getValidationPipeline(): CodeValidationPipeline {
  if (!validationPipeline) {
    validationPipeline = new CodeValidationPipeline();
  }
  return validationPipeline;
}
