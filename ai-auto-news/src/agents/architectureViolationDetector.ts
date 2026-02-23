/**
 * Architecture Violation Detector
 *
 * Enforces architecture rules including layer dependencies, naming conventions,
 * module boundaries, circular dependency detection, and anti-pattern identification.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export interface ArchitectureRule {
  id: string;
  name: string;
  description: string;
  category: 'layer-dependency' | 'naming' | 'module-boundary' | 'anti-pattern' | 'custom';
  severity: Severity;
  enabled: boolean;
  check: (context: AnalysisContext) => Violation[];
}

export interface Violation {
  ruleId: string;
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface AnalysisContext {
  files: FileDescriptor[];
  modules: ModuleDescriptor[];
  dependencies: DependencyEdge[];
  config: DetectorConfig;
}

export interface FileDescriptor {
  path: string;
  module: string;
  layer: string;
  exports: string[];
  imports: ImportDescriptor[];
  lineCount: number;
  functionCount: number;
  classCount: number;
}

export interface ImportDescriptor {
  source: string;
  specifiers: string[];
  isRelative: boolean;
}

export interface ModuleDescriptor {
  name: string;
  layer: string;
  files: string[];
  publicApi: string[];
  internalOnly: string[];
}

export interface DependencyEdge {
  from: string; // module name
  to: string;   // module name
  files: string[];
  weight: number;
}

export interface DetectorConfig {
  layers: LayerConfig[];
  namingRules: NamingRule[];
  maxModuleSize: number;
  maxFileLineCount: number;
  maxFunctionCount: number;
  allowedCrossModuleDeps: string[][]; // pairs [from, to]
}

export interface LayerConfig {
  name: string;
  order: number; // lower = higher layer; higher layers must not depend on lower
  allowedDependencies: string[];
}

export interface NamingRule {
  target: 'file' | 'export' | 'module';
  pattern: string; // regex
  message: string;
}

export interface AnalysisReport {
  violations: Violation[];
  summary: Record<Severity, number>;
  circularDeps: string[][];
  score: number; // 0-100, higher is better
  analyzedFiles: number;
  analyzedModules: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

function defaultConfig(): DetectorConfig {
  return {
    layers: [
      { name: 'presentation', order: 1, allowedDependencies: ['application', 'domain'] },
      { name: 'application', order: 2, allowedDependencies: ['domain', 'infrastructure'] },
      { name: 'domain', order: 3, allowedDependencies: [] },
      { name: 'infrastructure', order: 4, allowedDependencies: ['domain'] },
    ],
    namingRules: [
      { target: 'file', pattern: '^[a-z][a-zA-Z0-9]*\\.[a-z]+$', message: 'File names should be camelCase' },
      { target: 'export', pattern: '^[A-Z][a-zA-Z0-9]*$', message: 'Exported classes/interfaces should be PascalCase' },
      { target: 'module', pattern: '^[a-z][a-z0-9-]*$', message: 'Module names should be kebab-case' },
    ],
    maxModuleSize: 20,
    maxFileLineCount: 500,
    maxFunctionCount: 15,
    allowedCrossModuleDeps: [],
  };
}

// ---------------------------------------------------------------------------
// ArchitectureViolationDetector
// ---------------------------------------------------------------------------

export class ArchitectureViolationDetector {
  private rules: Map<string, ArchitectureRule> = new Map();
  private config: DetectorConfig;

  constructor(config?: Partial<DetectorConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.registerBuiltInRules();
    logger.info('Architecture violation detector constructed', { ruleCount: this.rules.size });
  }

  // ---- Configuration -------------------------------------------------------

  updateConfig(patch: Partial<DetectorConfig>): void {
    this.config = { ...this.config, ...patch };
    logger.info('Detector config updated');
  }

  addRule(rule: ArchitectureRule): void {
    this.rules.set(rule.id, rule);
    logger.info('Custom rule added', { ruleId: rule.id });
  }

  enableRule(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) rule.enabled = enabled;
  }

  // ---- Analysis entry point ------------------------------------------------

  analyze(files: FileDescriptor[], modules: ModuleDescriptor[], dependencies: DependencyEdge[]): AnalysisReport {
    logger.info('Starting architecture analysis', { files: files.length, modules: modules.length });

    const ctx: AnalysisContext = { files, modules, dependencies, config: this.config };
    const violations: Violation[] = [];

    for (const [, rule] of this.rules) {
      if (!rule.enabled) continue;
      try {
        const found = rule.check(ctx);
        violations.push(...found);
      } catch (err) {
        logger.error('Rule check failed', err instanceof Error ? err : undefined, { ruleId: rule.id });
      }
    }

    const circularDeps = this.findCircularDependencies(dependencies, modules);
    for (const cycle of circularDeps) {
      violations.push({
        ruleId: 'circular-dep',
        severity: 'error',
        message: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
        suggestion: 'Break the cycle by introducing an abstraction or event-based communication',
      });
    }

    const summary: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const v of violations) summary[v.severity]++;

    const score = this.computeScore(violations, files.length);

    const report: AnalysisReport = {
      violations,
      summary,
      circularDeps,
      score,
      analyzedFiles: files.length,
      analyzedModules: modules.length,
      timestamp: Date.now(),
    };

    logger.info('Architecture analysis complete', {
      violations: violations.length,
      errors: summary.error,
      warnings: summary.warning,
      score,
    });

    return report;
  }

  // ---- Circular dependency detection (DFS) ---------------------------------

  private findCircularDependencies(edges: DependencyEdge[], modules: ModuleDescriptor[]): string[][] {
    const adj = new Map<string, string[]>();
    for (const m of modules) adj.set(m.name, []);
    for (const e of edges) {
      const list = adj.get(e.from);
      if (list && !list.includes(e.to)) list.push(e.to);
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      inStack.add(node);
      stack.push(node);

      for (const neighbour of adj.get(node) ?? []) {
        if (!visited.has(neighbour)) {
          dfs(neighbour);
        } else if (inStack.has(neighbour)) {
          const cycleStart = stack.indexOf(neighbour);
          if (cycleStart >= 0) {
            cycles.push(stack.slice(cycleStart));
          }
        }
      }

      stack.pop();
      inStack.delete(node);
    };

    for (const m of modules) {
      if (!visited.has(m.name)) dfs(m.name);
    }

    return cycles;
  }

  // ---- Scoring -------------------------------------------------------------

  private computeScore(violations: Violation[], fileCount: number): number {
    if (fileCount === 0) return 100;
    const penalties = violations.reduce((sum, v) => {
      if (v.severity === 'error') return sum + 10;
      if (v.severity === 'warning') return sum + 4;
      return sum + 1;
    }, 0);
    // Normalize: perfect score at 0 penalties, decreasing per penalty relative to project size
    const maxPenalty = Math.max(fileCount * 5, 50);
    return Math.max(0, Math.round(100 * (1 - penalties / maxPenalty)));
  }

  // ---- Built-in rules ------------------------------------------------------

  private registerBuiltInRules(): void {
    this.rules.set('layer-violation', {
      id: 'layer-violation', name: 'Layer Dependency Violation',
      description: 'Higher layers must not be imported by lower layers',
      category: 'layer-dependency', severity: 'error', enabled: true,
      check: (ctx) => this.checkLayerViolations(ctx),
    });

    this.rules.set('module-boundary', {
      id: 'module-boundary', name: 'Module Boundary Violation',
      description: 'Modules must only import via public API',
      category: 'module-boundary', severity: 'warning', enabled: true,
      check: (ctx) => this.checkModuleBoundaries(ctx),
    });

    this.rules.set('naming-convention', {
      id: 'naming-convention', name: 'Naming Convention Violation',
      description: 'Enforce naming patterns for files, exports, and modules',
      category: 'naming', severity: 'warning', enabled: true,
      check: (ctx) => this.checkNaming(ctx),
    });

    this.rules.set('god-module', {
      id: 'god-module', name: 'God Module Detection',
      description: 'Detect oversized modules with too many responsibilities',
      category: 'anti-pattern', severity: 'warning', enabled: true,
      check: (ctx) => this.checkGodModules(ctx),
    });

    this.rules.set('feature-envy', {
      id: 'feature-envy', name: 'Feature Envy Detection',
      description: 'Detect files that depend more on external modules than their own',
      category: 'anti-pattern', severity: 'info', enabled: true,
      check: (ctx) => this.checkFeatureEnvy(ctx),
    });

    this.rules.set('file-size', {
      id: 'file-size', name: 'File Size Limit',
      description: 'Files should not exceed maximum line count',
      category: 'anti-pattern', severity: 'warning', enabled: true,
      check: (ctx) => this.checkFileSize(ctx),
    });

    this.rules.set('excessive-functions', {
      id: 'excessive-functions', name: 'Excessive Functions',
      description: 'Files should not have too many functions',
      category: 'anti-pattern', severity: 'info', enabled: true,
      check: (ctx) => this.checkExcessiveFunctions(ctx),
    });
  }

  // ---- Rule implementations ------------------------------------------------

  private checkLayerViolations(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    const layerMap = new Map<string, LayerConfig>();
    for (const l of ctx.config.layers) layerMap.set(l.name, l);

    for (const file of ctx.files) {
      const fileLayer = layerMap.get(file.layer);
      if (!fileLayer) continue;

      for (const imp of file.imports) {
        const targetFile = ctx.files.find(f => imp.source.includes(f.path) || f.path.includes(imp.source));
        if (!targetFile) continue;
        const targetLayer = layerMap.get(targetFile.layer);
        if (!targetLayer) continue;

        // Check if this import is allowed
        if (!fileLayer.allowedDependencies.includes(targetLayer.name) && fileLayer.name !== targetLayer.name) {
          violations.push({
            ruleId: 'layer-violation',
            severity: 'error',
            message: `File '${file.path}' in layer '${file.layer}' imports from '${targetFile.path}' in forbidden layer '${targetFile.layer}'`,
            file: file.path,
            suggestion: `Move the dependency to an allowed layer or introduce an abstraction in the '${fileLayer.name}' layer`,
          });
        }
      }
    }
    return violations;
  }

  private checkModuleBoundaries(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    const moduleMap = new Map<string, ModuleDescriptor>();
    for (const m of ctx.modules) moduleMap.set(m.name, m);

    for (const file of ctx.files) {
      const fileModule = moduleMap.get(file.module);
      if (!fileModule) continue;

      for (const imp of file.imports) {
        // Only check cross-module imports
        for (const [, targetMod] of moduleMap) {
          if (targetMod.name === file.module) continue;
          const isTargetImport = targetMod.files.some(f => imp.source.includes(f));
          if (!isTargetImport) continue;

          // Check if imported specifier is in public API
          for (const spec of imp.specifiers) {
            if (!targetMod.publicApi.includes(spec) && targetMod.internalOnly.includes(spec)) {
              const allowed = ctx.config.allowedCrossModuleDeps.some(
                ([from, to]) => from === file.module && to === targetMod.name
              );
              if (!allowed) {
                violations.push({
                  ruleId: 'module-boundary',
                  severity: 'warning',
                  message: `File '${file.path}' imports internal symbol '${spec}' from module '${targetMod.name}'`,
                  file: file.path,
                  suggestion: `Use the public API of '${targetMod.name}' or add an explicit exception`,
                });
              }
            }
          }
        }
      }
    }
    return violations;
  }

  private checkNaming(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];

    for (const rule of ctx.config.namingRules) {
      const regex = new RegExp(rule.pattern);

      if (rule.target === 'file') {
        for (const file of ctx.files) {
          const filename = file.path.split('/').pop() ?? '';
          if (!regex.test(filename)) {
            violations.push({
              ruleId: 'naming-convention', severity: 'warning',
              message: `${rule.message}: '${filename}'`,
              file: file.path,
              suggestion: `Rename to match pattern: ${rule.pattern}`,
            });
          }
        }
      } else if (rule.target === 'export') {
        for (const file of ctx.files) {
          for (const exp of file.exports) {
            if (!regex.test(exp)) {
              violations.push({
                ruleId: 'naming-convention', severity: 'warning',
                message: `${rule.message}: '${exp}' in ${file.path}`,
                file: file.path,
              });
            }
          }
        }
      } else if (rule.target === 'module') {
        for (const mod of ctx.modules) {
          if (!regex.test(mod.name)) {
            violations.push({
              ruleId: 'naming-convention', severity: 'warning',
              message: `${rule.message}: module '${mod.name}'`,
            });
          }
        }
      }
    }
    return violations;
  }

  private checkGodModules(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    for (const mod of ctx.modules) {
      if (mod.files.length > ctx.config.maxModuleSize) {
        violations.push({
          ruleId: 'god-module', severity: 'warning',
          message: `Module '${mod.name}' has ${mod.files.length} files (max ${ctx.config.maxModuleSize})`,
          suggestion: 'Split into smaller focused modules',
        });
      }
      // High dependency fan-out
      const outgoing = ctx.dependencies.filter(d => d.from === mod.name);
      if (outgoing.length > 8) {
        violations.push({
          ruleId: 'god-module', severity: 'info',
          message: `Module '${mod.name}' depends on ${outgoing.length} other modules (high coupling)`,
          suggestion: 'Reduce coupling by introducing facades or mediators',
        });
      }
    }
    return violations;
  }

  private checkFeatureEnvy(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    for (const file of ctx.files) {
      let internalImports = 0;
      let externalImports = 0;
      for (const imp of file.imports) {
        const sameModule = ctx.files.some(
          f => f.module === file.module && (imp.source.includes(f.path) || f.path.includes(imp.source))
        );
        if (sameModule) internalImports++;
        else externalImports++;
      }
      if (externalImports > 0 && externalImports > internalImports * 2 && externalImports >= 4) {
        violations.push({
          ruleId: 'feature-envy', severity: 'info',
          message: `File '${file.path}' has ${externalImports} external imports vs ${internalImports} internal – possible feature envy`,
          file: file.path,
          suggestion: 'Consider moving this file to the module it depends on most',
        });
      }
    }
    return violations;
  }

  private checkFileSize(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    for (const file of ctx.files) {
      if (file.lineCount > ctx.config.maxFileLineCount) {
        violations.push({
          ruleId: 'file-size', severity: 'warning',
          message: `File '${file.path}' has ${file.lineCount} lines (max ${ctx.config.maxFileLineCount})`,
          file: file.path,
          suggestion: 'Split into smaller focused files',
        });
      }
    }
    return violations;
  }

  private checkExcessiveFunctions(ctx: AnalysisContext): Violation[] {
    const violations: Violation[] = [];
    for (const file of ctx.files) {
      if (file.functionCount > ctx.config.maxFunctionCount) {
        violations.push({
          ruleId: 'excessive-functions', severity: 'info',
          message: `File '${file.path}' has ${file.functionCount} functions (max ${ctx.config.maxFunctionCount})`,
          file: file.path,
          suggestion: 'Group related functions into separate files or a class',
        });
      }
    }
    return violations;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__architectureViolationDetector__';

export function getArchitectureViolationDetector(config?: Partial<DetectorConfig>): ArchitectureViolationDetector {
  const g = globalThis as unknown as Record<string, ArchitectureViolationDetector>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new ArchitectureViolationDetector(config);
    logger.info('Architecture violation detector initialized');
  }
  return g[GLOBAL_KEY];
}
