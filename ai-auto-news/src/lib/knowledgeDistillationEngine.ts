/**
 * @module knowledgeDistillationEngine
 * @description Knowledge distillation and compression engine for AI models.
 * Supports teacher-student distillation, weight pruning, quantization planning,
 * knowledge graph compression, and domain-specific fine-tuning data generation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type DistillationStrategy = 'response_based' | 'feature_based' | 'relation_based' | 'attention_transfer';
export type CompressionLevel = 'none' | 'light' | 'moderate' | 'aggressive';
export type QuantizationPrecision = 'fp32' | 'fp16' | 'int8' | 'int4';

export interface ModelProfile {
  id: string;
  name: string;
  parameterCount: number;    // millions
  contextLength: number;
  avgInferenceMs: number;
  costPerToken: number;
  qualityScore: number;      // 0-100
  domains: string[];
  quantization: QuantizationPrecision;
}

export interface KnowledgeUnit {
  id: string;
  domain: string;
  input: string;
  teacherOutput: string;
  softLabels: number[];      // probability distribution over vocabulary
  features: number[];        // hidden state features
  attention: number[][];     // attention matrix
  quality: number;           // 0-1 quality score
  timestamp: number;
}

export interface DistillationConfig {
  teacherModelId: string;
  studentModelId: string;
  strategy: DistillationStrategy;
  temperature: number;       // For soft labels, typically 2-10
  alphaHard: number;         // Weight for hard labels (0-1)
  alphaSoft: number;         // Weight for soft labels (0-1)
  compressionLevel: CompressionLevel;
  targetQualityRetention: number; // 0-1, e.g., 0.95 = retain 95% quality
  maxKnowledgeUnits: number;
}

export interface DistillationResult {
  configId: string;
  teacherModelId: string;
  studentModelId: string;
  knowledgeUnitsProcessed: number;
  qualityRetained: number;   // 0-1
  compressionRatio: number;  // e.g., 4.0 = 4x smaller
  latencyImprovement: number; // multiplier, e.g., 3.5 = 3.5x faster
  costReduction: number;     // 0-1
  domains: string[];
  completedAt: number;
  durationMs: number;
}

export interface PruningPlan {
  modelId: string;
  targetSparsity: number;    // 0-1
  pruningMethod: 'magnitude' | 'gradient' | 'structured' | 'lottery_ticket';
  layersToPrune: string[];
  estimatedParameterReduction: number;
  estimatedQualityImpact: number;
  safeToApply: boolean;
}

export interface QuantizationPlan {
  modelId: string;
  fromPrecision: QuantizationPrecision;
  toPrecision: QuantizationPrecision;
  memorySavingsMB: number;
  speedupMultiplier: number;
  qualityDegradation: number; // 0-1 fraction of quality lost
  calibrationDataRequired: boolean;
}

// ── Quality Estimator ─────────────────────────────────────────────────────────

function estimateKnowledgeQuality(unit: KnowledgeUnit): number {
  // Compute entropy of soft labels (high entropy = uncertain = lower quality signal)
  const entropy = unit.softLabels.length > 0
    ? -unit.softLabels.reduce((sum, p) => {
        const safe = Math.max(p, 1e-10);
        return sum + safe * Math.log2(safe);
      }, 0) / Math.log2(unit.softLabels.length)
    : 0;

  // Lower entropy = more confident teacher = better training signal
  const confidenceScore = 1 - entropy;
  return Math.max(0, Math.min(1, confidenceScore * 0.7 + unit.quality * 0.3));
}

function computeCompressionRatio(teacher: ModelProfile, student: ModelProfile): number {
  if (student.parameterCount === 0) return 1;
  return teacher.parameterCount / student.parameterCount;
}

// ── Core Engine ───────────────────────────────────────────────────────────────

export class KnowledgeDistillationEngine {
  private models = new Map<string, ModelProfile>();
  private knowledgeBank = new Map<string, KnowledgeUnit[]>(); // domain -> units
  private distillationResults = new Map<string, DistillationResult>();
  private totalUnitsProcessed = 0;

  registerModel(model: ModelProfile): void {
    this.models.set(model.id, model);
    logger.info('Model registered for distillation', { id: model.id, name: model.name, params: model.parameterCount });
  }

  addKnowledgeUnit(unit: KnowledgeUnit): void {
    const units = this.knowledgeBank.get(unit.domain) ?? [];
    const quality = estimateKnowledgeQuality(unit);
    unit.quality = quality;
    units.push(unit);

    // Keep highest quality units
    if (units.length > 10000) {
      units.sort((a, b) => b.quality - a.quality);
      units.splice(5000);
    }

    this.knowledgeBank.set(unit.domain, units);
  }

  async distill(config: DistillationConfig): Promise<DistillationResult> {
    const teacher = this.models.get(config.teacherModelId);
    const student = this.models.get(config.studentModelId);

    if (!teacher) throw new Error(`Teacher model not found: ${config.teacherModelId}`);
    if (!student) throw new Error(`Student model not found: ${config.studentModelId}`);

    const start = Date.now();
    logger.info('Distillation started', {
      teacher: teacher.name,
      student: student.name,
      strategy: config.strategy,
    });

    // Gather knowledge units across all relevant domains
    const allUnits: KnowledgeUnit[] = [];
    for (const domain of teacher.domains) {
      const domainUnits = this.knowledgeBank.get(domain) ?? [];
      allUnits.push(...domainUnits);
    }

    // Sort by quality and take top units
    allUnits.sort((a, b) => b.quality - a.quality);
    const selectedUnits = allUnits.slice(0, config.maxKnowledgeUnits);

    // Simulate distillation process
    const batchSize = 32;
    let processedUnits = 0;
    let cumulativeQuality = 0;

    for (let i = 0; i < selectedUnits.length; i += batchSize) {
      const batch = selectedUnits.slice(i, i + batchSize);

      // Compute effective loss with temperature scaling
      for (const unit of batch) {
        const softLoss = this.computeSoftLoss(unit, config.temperature);
        const hardLoss = this.computeHardLoss(unit);
        const combinedLoss = config.alphaHard * hardLoss + config.alphaSoft * softLoss;
        cumulativeQuality += Math.max(0, 1 - combinedLoss);
        processedUnits++;
      }

      // Simulate async processing
      await new Promise(r => setTimeout(r, 0));
    }

    this.totalUnitsProcessed += processedUnits;

    const avgQuality = processedUnits > 0 ? cumulativeQuality / processedUnits : 0;
    const qualityRetained = Math.min(1, avgQuality * config.targetQualityRetention * 1.1);
    const compressionRatio = computeCompressionRatio(teacher, student);
    const latencyImprovement = teacher.avgInferenceMs / Math.max(1, student.avgInferenceMs);
    const costReduction = 1 - (student.costPerToken / Math.max(0.000001, teacher.costPerToken));

    const configId = `dist_${Date.now()}`;
    const result: DistillationResult = {
      configId,
      teacherModelId: config.teacherModelId,
      studentModelId: config.studentModelId,
      knowledgeUnitsProcessed: processedUnits,
      qualityRetained,
      compressionRatio,
      latencyImprovement,
      costReduction,
      domains: teacher.domains,
      completedAt: Date.now(),
      durationMs: Date.now() - start,
    };

    this.distillationResults.set(configId, result);
    logger.info('Distillation completed', {
      configId,
      qualityRetained: qualityRetained.toFixed(3),
      compressionRatio: compressionRatio.toFixed(1),
      costReduction: `${(costReduction * 100).toFixed(1)}%`,
    });

    return result;
  }

  planPruning(modelId: string, targetSparsity: number): PruningPlan {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const safeSparsity = Math.min(0.9, Math.max(0, targetSparsity));
    const method: PruningPlan['pruningMethod'] =
      safeSparsity < 0.3 ? 'magnitude' :
      safeSparsity < 0.6 ? 'gradient' :
      safeSparsity < 0.8 ? 'structured' : 'lottery_ticket';

    return {
      modelId,
      targetSparsity: safeSparsity,
      pruningMethod: method,
      layersToPrune: ['attention', 'feed_forward', 'embedding'],
      estimatedParameterReduction: safeSparsity,
      estimatedQualityImpact: safeSparsity * 0.15, // rough estimate
      safeToApply: safeSparsity <= 0.5,
    };
  }

  planQuantization(modelId: string, targetPrecision: QuantizationPrecision): QuantizationPlan {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);

    const precisionBits: Record<QuantizationPrecision, number> = {
      fp32: 32, fp16: 16, int8: 8, int4: 4,
    };

    const fromBits = precisionBits[model.quantization];
    const toBits = precisionBits[targetPrecision];
    const savingsRatio = 1 - toBits / fromBits;
    const memoryPerParam = fromBits / 8 / 1024 / 1024; // MB per million params
    const memorySavings = model.parameterCount * memoryPerParam * savingsRatio;

    const speedup = Math.sqrt(fromBits / toBits); // Approximate speedup
    const qualityLoss = savingsRatio * 0.05; // Rough estimate

    return {
      modelId,
      fromPrecision: model.quantization,
      toPrecision: targetPrecision,
      memorySavingsMB: memorySavings,
      speedupMultiplier: speedup,
      qualityDegradation: Math.min(0.2, qualityLoss),
      calibrationDataRequired: targetPrecision === 'int8' || targetPrecision === 'int4',
    };
  }

  generateFineTuningData(
    domain: string,
    style: 'qa' | 'instruction' | 'chat',
    count: number
  ): Array<{ input: string; output: string; metadata: Record<string, unknown> }> {
    const units = this.knowledgeBank.get(domain) ?? [];
    const topUnits = units
      .sort((a, b) => b.quality - a.quality)
      .slice(0, count);

    return topUnits.map(unit => ({
      input: unit.input,
      output: unit.teacherOutput,
      metadata: {
        domain: unit.domain,
        quality: unit.quality,
        style,
        sourceId: unit.id,
      },
    }));
  }

  private computeSoftLoss(unit: KnowledgeUnit, temperature: number): number {
    if (unit.softLabels.length === 0) return 0.5;
    // Approximate cross-entropy with temperature-scaled labels
    const maxProb = Math.max(...unit.softLabels);
    const scaled = unit.softLabels.map(p => Math.exp(p / temperature));
    const sum = scaled.reduce((s, v) => s + v, 0);
    const softmax = scaled.map(v => v / sum);
    return -softmax.reduce((s, p, i) => s + (unit.softLabels[i]! > 0.5 ? Math.log(Math.max(p, 1e-10)) : 0), 0) / temperature / temperature;
  }

  private computeHardLoss(unit: KnowledgeUnit): number {
    // Simplified hard loss estimation based on output quality
    return Math.max(0, 1 - unit.quality);
  }

  getDistillationResults(): DistillationResult[] {
    return Array.from(this.distillationResults.values())
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  getKnowledgeBankStats(): Record<string, { count: number; avgQuality: number }> {
    const stats: Record<string, { count: number; avgQuality: number }> = {};
    for (const [domain, units] of this.knowledgeBank.entries()) {
      const avg = units.length > 0
        ? units.reduce((s, u) => s + u.quality, 0) / units.length
        : 0;
      stats[domain] = { count: units.length, avgQuality: avg };
    }
    return stats;
  }

  getStats(): { totalUnitsProcessed: number; registeredModels: number; domains: number } {
    return {
      totalUnitsProcessed: this.totalUnitsProcessed,
      registeredModels: this.models.size,
      domains: this.knowledgeBank.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeDistillationEngine__: KnowledgeDistillationEngine | undefined;
}

export function getKnowledgeDistillation(): KnowledgeDistillationEngine {
  if (!globalThis.__knowledgeDistillationEngine__) {
    globalThis.__knowledgeDistillationEngine__ = new KnowledgeDistillationEngine();
  }
  return globalThis.__knowledgeDistillationEngine__;
}
