/**
 * Code Generation Orchestrator
 *
 * Accepts specifications and requirements, produces implementation plans,
 * generates code across multiple files via customizable templates,
 * scores quality, manages token budgets, and supports rollback.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeSpec {
  id: string;
  title: string;
  description: string;
  requirements: SpecRequirement[];
  language: string;
  framework?: string;
  targetFiles: string[];
  templateId?: string;
  maxTokens?: number;
}

export interface SpecRequirement {
  id: string;
  type: 'functional' | 'non-functional' | 'constraint';
  description: string;
  priority: 'must' | 'should' | 'could';
  acceptance: string[];
}

export interface ImplementationPlan {
  specId: string;
  steps: PlanStep[];
  estimatedTokens: number;
  estimatedFiles: number;
  dependencies: string[];
  createdAt: number;
}

export interface PlanStep {
  id: string;
  order: number;
  description: string;
  targetFile: string;
  action: 'create' | 'modify' | 'delete';
  estimatedTokens: number;
  templateId?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  tokens: number;
  qualityScore: QualityScore;
  templateUsed?: string;
}

export interface QualityScore {
  overall: number; // 0-100
  complexity: number;
  maintainability: number;
  testCoverageEstimate: number;
  readability: number;
  details: string[];
}

export interface GenerationResult {
  specId: string;
  planId: string;
  files: GeneratedFile[];
  totalTokens: number;
  qualityScore: QualityScore;
  validationPassed: boolean;
  validationErrors: string[];
  duration: number;
  timestamp: number;
}

export interface CodeTemplate {
  id: string;
  name: string;
  language: string;
  framework?: string;
  skeleton: string;
  placeholders: string[];
  defaultValues: Record<string, string>;
}

interface HistoryEntry {
  result: GenerationResult;
  snapshotFiles: GeneratedFile[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function countTokensEstimate(text: string): number {
  // ~4 chars per token heuristic
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// CodeGenOrchestrator
// ---------------------------------------------------------------------------

export class CodeGenOrchestrator {
  private templates: Map<string, CodeTemplate> = new Map();
  private history: HistoryEntry[] = [];
  private readonly maxHistory = 100;
  private tokenBudget = 0;
  private tokensUsed = 0;

  constructor() {
    this.registerBuiltInTemplates();
  }

  // ---- Token budget --------------------------------------------------------

  setTokenBudget(budget: number): void {
    this.tokenBudget = budget;
    this.tokensUsed = 0;
    logger.info('Token budget set', { budget });
  }

  getRemainingTokens(): number {
    return this.tokenBudget > 0 ? Math.max(0, this.tokenBudget - this.tokensUsed) : Infinity;
  }

  // ---- Templates -----------------------------------------------------------

  registerTemplate(template: CodeTemplate): void {
    this.templates.set(template.id, template);
    logger.info('Template registered', { templateId: template.id, name: template.name });
  }

  private registerBuiltInTemplates(): void {
    const builtins: CodeTemplate[] = [
      {
        id: 'ts-module', name: 'TypeScript Module', language: 'typescript',
        skeleton: `/**\n * {{MODULE_NAME}}\n */\n\nexport class {{CLASS_NAME}} {\n  {{BODY}}\n}\n`,
        placeholders: ['MODULE_NAME', 'CLASS_NAME', 'BODY'],
        defaultValues: { MODULE_NAME: 'Module', CLASS_NAME: 'MyClass', BODY: '// TODO' },
      },
      {
        id: 'ts-function', name: 'TypeScript Function', language: 'typescript',
        skeleton: `/**\n * {{DESCRIPTION}}\n */\nexport function {{FUNC_NAME}}({{PARAMS}}): {{RETURN_TYPE}} {\n  {{BODY}}\n}\n`,
        placeholders: ['DESCRIPTION', 'FUNC_NAME', 'PARAMS', 'RETURN_TYPE', 'BODY'],
        defaultValues: { DESCRIPTION: '', FUNC_NAME: 'myFunction', PARAMS: '', RETURN_TYPE: 'void', BODY: '// TODO' },
      },
      {
        id: 'react-component', name: 'React Component', language: 'typescript', framework: 'react',
        skeleton: `import React from 'react';\n\ninterface {{NAME}}Props {\n  {{PROPS}}\n}\n\nexport function {{NAME}}({ {{DESTRUCTURED}} }: {{NAME}}Props) {\n  return (\n    {{JSX}}\n  );\n}\n`,
        placeholders: ['NAME', 'PROPS', 'DESTRUCTURED', 'JSX'],
        defaultValues: { NAME: 'Component', PROPS: '', DESTRUCTURED: '', JSX: '<div />' },
      },
    ];
    for (const t of builtins) this.templates.set(t.id, t);
  }

  // ---- Plan generation -----------------------------------------------------

  generatePlan(spec: CodeSpec): ImplementationPlan {
    logger.info('Generating implementation plan', { specId: spec.id, title: spec.title });

    const steps: PlanStep[] = [];
    let stepOrder = 0;

    // Analyze requirements into grouped actions
    const musts = spec.requirements.filter(r => r.priority === 'must');
    const shoulds = spec.requirements.filter(r => r.priority === 'should');
    const coulds = spec.requirements.filter(r => r.priority === 'could');

    // Create steps for each target file
    for (const file of spec.targetFiles) {
      const relatedReqs = [...musts, ...shoulds].filter(r =>
        r.description.toLowerCase().includes(file.split('/').pop()?.replace(/\.\w+$/, '') ?? '')
      );
      const estimatedTokens = 200 + relatedReqs.length * 150;

      steps.push({
        id: uid('step'),
        order: stepOrder++,
        description: `Generate ${file}${relatedReqs.length ? ` (${relatedReqs.length} requirements)` : ''}`,
        targetFile: file,
        action: 'create',
        estimatedTokens,
        templateId: spec.templateId ?? this.selectTemplate(spec.language, spec.framework),
      });
    }

    // Add optional enhancement steps for 'could' requirements
    for (const req of coulds) {
      steps.push({
        id: uid('step'),
        order: stepOrder++,
        description: `Enhancement: ${req.description.slice(0, 80)}`,
        targetFile: spec.targetFiles[0] ?? 'enhancement.ts',
        action: 'modify',
        estimatedTokens: 100,
      });
    }

    const plan: ImplementationPlan = {
      specId: spec.id,
      steps,
      estimatedTokens: steps.reduce((s, st) => s + st.estimatedTokens, 0),
      estimatedFiles: spec.targetFiles.length,
      dependencies: this.inferDependencies(spec),
      createdAt: Date.now(),
    };

    logger.info('Implementation plan generated', { specId: spec.id, steps: steps.length, estimatedTokens: plan.estimatedTokens });
    return plan;
  }

  private selectTemplate(language: string, framework?: string): string | undefined {
    for (const [id, t] of this.templates) {
      if (t.language === language && (!framework || t.framework === framework)) return id;
    }
    return undefined;
  }

  private inferDependencies(spec: CodeSpec): string[] {
    const deps: string[] = [];
    if (spec.framework) deps.push(spec.framework);
    for (const req of spec.requirements) {
      const matches = req.description.match(/depends on (\w+)/gi);
      if (matches) deps.push(...matches.map(m => m.replace(/depends on /i, '')));
    }
    return [...new Set(deps)];
  }

  // ---- Code generation -----------------------------------------------------

  generate(spec: CodeSpec): GenerationResult {
    const start = Date.now();
    const plan = this.generatePlan(spec);

    logger.info('Starting code generation', { specId: spec.id });

    // Budget check
    if (this.tokenBudget > 0 && plan.estimatedTokens > this.getRemainingTokens()) {
      logger.warn('Token budget exceeded, generation may be truncated', {
        estimated: plan.estimatedTokens, remaining: this.getRemainingTokens(),
      });
    }

    const files: GeneratedFile[] = [];
    const validationErrors: string[] = [];

    for (const step of plan.steps.filter(s => s.action === 'create' || s.action === 'modify')) {
      const content = this.generateFileContent(spec, step);
      const tokens = countTokensEstimate(content);
      this.tokensUsed += tokens;

      const qualityScore = this.scoreQuality(content, spec.language);
      files.push({
        path: step.targetFile,
        content,
        language: spec.language,
        tokens,
        qualityScore,
        templateUsed: step.templateId,
      });

      // Validate
      const errors = this.validateGenerated(content, spec);
      validationErrors.push(...errors);

      if (this.tokenBudget > 0 && this.tokensUsed >= this.tokenBudget) {
        logger.warn('Token budget exhausted, stopping generation', { used: this.tokensUsed });
        break;
      }
    }

    const aggregateQuality = this.aggregateQuality(files);
    const result: GenerationResult = {
      specId: spec.id,
      planId: uid('gen'),
      files,
      totalTokens: files.reduce((s, f) => s + f.tokens, 0),
      qualityScore: aggregateQuality,
      validationPassed: validationErrors.length === 0,
      validationErrors,
      duration: Date.now() - start,
      timestamp: Date.now(),
    };

    this.recordHistory(result, files);
    logger.info('Code generation complete', {
      specId: spec.id, files: files.length, quality: aggregateQuality.overall, tokens: result.totalTokens,
    });

    return result;
  }

  private generateFileContent(spec: CodeSpec, step: PlanStep): string {
    const template = step.templateId ? this.templates.get(step.templateId) : undefined;

    if (template) {
      return this.applyTemplate(template, spec, step);
    }

    // Fallback: structured code from requirements
    return this.generateFromRequirements(spec, step);
  }

  private applyTemplate(template: CodeTemplate, spec: CodeSpec, step: PlanStep): string {
    let output = template.skeleton;
    const values: Record<string, string> = { ...template.defaultValues };

    // Infer values from spec
    const className = this.toPascalCase(spec.title.replace(/[^a-zA-Z0-9\s]/g, ''));
    values['MODULE_NAME'] = spec.title;
    values['CLASS_NAME'] = className;
    values['NAME'] = className;
    values['FUNC_NAME'] = this.toCamelCase(spec.title.replace(/[^a-zA-Z0-9\s]/g, ''));
    values['DESCRIPTION'] = spec.description;
    values['RETURN_TYPE'] = 'void';

    // Build body from requirements
    const bodyLines = spec.requirements
      .filter(r => r.priority !== 'could')
      .map(r => `  // ${r.type}: ${r.description}`)
      .join('\n');
    values['BODY'] = bodyLines || '  // implementation';

    for (const ph of template.placeholders) {
      output = output.replace(new RegExp(`\\{\\{${ph}\\}\\}`, 'g'), values[ph] ?? '');
    }
    return output;
  }

  private generateFromRequirements(spec: CodeSpec, step: PlanStep): string {
    const lines: string[] = [
      `/**`,
      ` * ${spec.title} – ${step.targetFile}`,
      ` * ${spec.description}`,
      ` */`,
      ``,
    ];

    const musts = spec.requirements.filter(r => r.priority === 'must');
    const shoulds = spec.requirements.filter(r => r.priority === 'should');

    // Build exports based on requirement types
    const funcReqs = [...musts, ...shoulds].filter(r => r.type === 'functional');
    const nonFuncReqs = [...musts, ...shoulds].filter(r => r.type === 'non-functional');

    if (funcReqs.length > 0) {
      for (const req of funcReqs) {
        const name = this.toCamelCase(req.description.slice(0, 40));
        lines.push(`export function ${name}(): void {`);
        for (const acc of req.acceptance) {
          lines.push(`  // Acceptance: ${acc}`);
        }
        lines.push(`  throw new Error('Not yet implemented: ${req.id}');`);
        lines.push(`}`);
        lines.push(``);
      }
    }

    if (nonFuncReqs.length > 0) {
      lines.push(`// Non-functional requirements:`);
      for (const req of nonFuncReqs) {
        lines.push(`// - ${req.description}`);
      }
    }

    return lines.join('\n');
  }

  // ---- Quality scoring -----------------------------------------------------

  scoreQuality(code: string, language: string): QualityScore {
    const details: string[] = [];
    const lines = code.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0).length;

    // Complexity: nesting depth + cyclomatic approximation
    let maxDepth = 0;
    let curDepth = 0;
    let branches = 0;
    for (const line of lines) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      curDepth += opens - closes;
      if (curDepth > maxDepth) maxDepth = curDepth;
      if (/\b(if|else|switch|case|for|while|catch|&&|\|\|)\b/.test(line)) branches++;
    }
    const complexityScore = Math.max(0, 100 - maxDepth * 8 - branches * 3);

    // Maintainability: function length, comments ratio
    const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*)/.test(l)).length;
    const commentRatio = nonEmpty > 0 ? commentLines / nonEmpty : 0;
    let maintainability = 60;
    if (commentRatio > 0.1) maintainability += 15;
    if (commentRatio > 0.2) maintainability += 10;
    if (nonEmpty < 300) maintainability += 10;
    if (maxDepth <= 4) maintainability += 5;
    maintainability = Math.min(100, maintainability);

    // Test coverage estimate: presence of test-related code
    const hasTestPatterns = /\b(describe|it|test|expect|assert|mock)\b/i.test(code);
    const testCoverageEstimate = hasTestPatterns ? 65 : 15;

    // Readability
    const avgLineLen = nonEmpty > 0 ? lines.reduce((s, l) => s + l.length, 0) / nonEmpty : 0;
    let readability = 70;
    if (avgLineLen < 100) readability += 15;
    if (avgLineLen < 80) readability += 10;
    if (/\bexport\b/.test(code)) readability += 5;
    readability = Math.min(100, readability);

    // Language-specific checks
    if (language === 'typescript') {
      if (/\bany\b/.test(code)) { readability -= 10; details.push('Avoid `any` type'); }
      if (!/\binterface\b|\btype\b/.test(code) && nonEmpty > 20) { details.push('Consider adding type definitions'); }
    }

    const overall = Math.round(complexityScore * 0.25 + maintainability * 0.3 + testCoverageEstimate * 0.2 + readability * 0.25);

    return { overall, complexity: Math.round(complexityScore), maintainability: Math.round(maintainability), testCoverageEstimate, readability: Math.round(readability), details };
  }

  private aggregateQuality(files: GeneratedFile[]): QualityScore {
    if (files.length === 0) {
      return { overall: 0, complexity: 0, maintainability: 0, testCoverageEstimate: 0, readability: 0, details: ['No files generated'] };
    }
    const avg = (field: keyof QualityScore) => {
      const vals = files.map(f => f.qualityScore[field] as number);
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return {
      overall: avg('overall'),
      complexity: avg('complexity'),
      maintainability: avg('maintainability'),
      testCoverageEstimate: avg('testCoverageEstimate'),
      readability: avg('readability'),
      details: files.flatMap(f => f.qualityScore.details),
    };
  }

  // ---- Validation ----------------------------------------------------------

  private validateGenerated(code: string, spec: CodeSpec): string[] {
    const errors: string[] = [];

    if (code.trim().length === 0) {
      errors.push('Generated file is empty');
    }

    // Check for unresolved template placeholders
    const unresolvedPlaceholders = code.match(/\{\{[A-Z_]+\}\}/g);
    if (unresolvedPlaceholders) {
      errors.push(`Unresolved placeholders: ${unresolvedPlaceholders.join(', ')}`);
    }

    // Check must-have requirements reflected
    const musts = spec.requirements.filter(r => r.priority === 'must');
    for (const req of musts) {
      const keywords = req.description.split(/\s+/).filter(w => w.length > 4);
      const found = keywords.some(kw => code.toLowerCase().includes(kw.toLowerCase()));
      if (!found && keywords.length > 0) {
        errors.push(`Requirement ${req.id} may not be addressed`);
      }
    }

    // Syntax heuristic: balanced braces
    const opens = (code.match(/\{/g) ?? []).length;
    const closes = (code.match(/\}/g) ?? []).length;
    if (opens !== closes) {
      errors.push(`Unbalanced braces: ${opens} open vs ${closes} close`);
    }

    return errors;
  }

  // ---- History & rollback --------------------------------------------------

  private recordHistory(result: GenerationResult, files: GeneratedFile[]): void {
    this.history.push({ result, snapshotFiles: files.map(f => ({ ...f })) });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  rollback(specId: string): GenerationResult | null {
    const idx = this.history.findIndex(h => h.result.specId === specId);
    if (idx === -1) {
      logger.warn('No history found for rollback', { specId });
      return null;
    }
    const entry = this.history.splice(idx, 1)[0];
    logger.info('Rolled back generation', { specId, files: entry.snapshotFiles.length });
    return entry.result;
  }

  getHistory(): GenerationResult[] {
    return this.history.map(h => h.result);
  }

  // ---- String helpers ------------------------------------------------------

  private toPascalCase(str: string): string {
    return str.replace(/(?:^|\s)\w/g, m => m.trim().toUpperCase()).replace(/\s+/g, '');
  }

  private toCamelCase(str: string): string {
    const pascal = this.toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__codeGenerationOrchestrator__';

export function getCodeGenerationOrchestrator(): CodeGenOrchestrator {
  const g = globalThis as unknown as Record<string, CodeGenOrchestrator>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CodeGenOrchestrator();
    logger.info('Code generation orchestrator initialized');
  }
  return g[GLOBAL_KEY];
}
