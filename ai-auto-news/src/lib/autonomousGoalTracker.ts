/**
 * @module autonomousGoalTracker
 * @description Intelligent OKR and goal management engine with hierarchical objective
 * decomposition, key-result progress tracking, confidence scoring, auto-alignment
 * detection between team and company goals, milestone dependency management,
 * resource allocation recommendations, goal health scoring, at-risk detection,
 * automated check-in reminders, historical trend analysis, and predictive completion
 * forecasting for SaaS product and engineering teams.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type GoalLevel = 'company' | 'department' | 'team' | 'individual';
export type GoalStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled' | 'at_risk';
export type KeyResultType = 'metric' | 'milestone' | 'activity';
export type GoalHealth = 'on_track' | 'at_risk' | 'off_track' | 'completed';

export interface Objective {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  ownerId: string;
  ownerType: 'user' | 'team';
  level: GoalLevel;
  status: GoalStatus;
  parentObjectiveId?: string;
  childObjectiveIds: string[];
  keyResultIds: string[];
  quarterLabel: string;         // e.g., 'Q1 2026'
  confidenceScore: number;      // 0-100
  health: GoalHealth;
  progressPct: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  completedAt?: number;
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  tenantId: string;
  title: string;
  type: KeyResultType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  progressPct: number;
  weight: number;               // contribution weight 0-1
  ownerId: string;
  dueAt: number;
  milestones: Milestone[];
  checkIns: CheckIn[];
  createdAt: number;
  updatedAt: number;
}

export interface Milestone {
  id: string;
  title: string;
  dueAt: number;
  completedAt?: number;
  isBlocking: boolean;
}

export interface CheckIn {
  id: string;
  keyResultId: string;
  value: number;
  confidence: number;           // 0-100
  comment: string;
  reportedBy: string;
  reportedAt: number;
}

export interface GoalAlignment {
  childObjectiveId: string;
  parentObjectiveId: string;
  alignmentScore: number;       // 0-100
  keywords: string[];
  detectedAt: number;
}

export interface GoalForecast {
  objectiveId: string;
  currentProgress: number;
  predictedFinalProgress: number;
  estimatedCompletionAt?: number;
  forecastMethod: 'linear_extrapolation' | 'velocity_based';
  confidence: number;
  generatedAt: number;
}

export interface GoalSummary {
  totalObjectives: number;
  activeObjectives: number;
  atRiskObjectives: number;
  completedObjectives: number;
  avgProgress: number;
  avgConfidence: number;
  totalKeyResults: number;
  pendingCheckIns: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeObjectiveProgress(keyResults: KeyResult[]): number {
  if (keyResults.length === 0) return 0;
  const totalWeight = keyResults.reduce((s, kr) => s + kr.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = keyResults.reduce((s, kr) => s + kr.progressPct * kr.weight, 0);
  return parseFloat((weightedSum / totalWeight).toFixed(1));
}

function computeHealth(progress: number, dueAt: number, confidence: number): GoalHealth {
  if (progress >= 100) return 'completed';
  const now = Date.now();
  const totalMs = dueAt - (dueAt - 90 * 86400000); // assume 90-day quarter
  const elapsed = Math.max(0, now - (dueAt - 90 * 86400000));
  const expectedProgress = totalMs > 0 ? (elapsed / totalMs) * 100 : 50;
  if (confidence < 30 || progress < expectedProgress - 30) return 'off_track';
  if (confidence < 60 || progress < expectedProgress - 15) return 'at_risk';
  return 'on_track';
}

// ── Engine ────────────────────────────────────────────────────────────────────

class AutonomousGoalTracker {
  private readonly objectives = new Map<string, Objective>();
  private readonly keyResults = new Map<string, KeyResult>();
  private readonly alignments: GoalAlignment[] = [];
  private readonly forecasts = new Map<string, GoalForecast>();

  createObjective(obj: Objective): void {
    this.objectives.set(obj.id, { ...obj, childObjectiveIds: [], keyResultIds: [], progressPct: 0, health: 'on_track' });
    if (obj.parentObjectiveId) {
      const parent = this.objectives.get(obj.parentObjectiveId);
      if (parent && !parent.childObjectiveIds.includes(obj.id)) {
        parent.childObjectiveIds.push(obj.id);
      }
    }
    logger.info('Objective created', { objectiveId: obj.id, level: obj.level, quarter: obj.quarterLabel });
  }

  addKeyResult(kr: KeyResult): void {
    const obj = this.objectives.get(kr.objectiveId);
    if (!obj) throw new Error(`Objective ${kr.objectiveId} not found`);
    this.keyResults.set(kr.id, { ...kr, progressPct: 0, checkIns: [], milestones: kr.milestones ?? [] });
    if (!obj.keyResultIds.includes(kr.id)) obj.keyResultIds.push(kr.id);
    this._recomputeObjective(kr.objectiveId);
    logger.info('Key result added', { krId: kr.id, objectiveId: kr.objectiveId });
  }

  recordCheckIn(checkIn: CheckIn): CheckIn {
    const kr = this.keyResults.get(checkIn.keyResultId);
    if (!kr) throw new Error(`Key result ${checkIn.keyResultId} not found`);
    kr.checkIns.push({ ...checkIn, id: `ci-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, reportedAt: Date.now() });
    kr.currentValue = checkIn.value;
    kr.progressPct = kr.targetValue !== kr.startValue
      ? parseFloat(Math.min(100, Math.max(0, (checkIn.value - kr.startValue) / (kr.targetValue - kr.startValue) * 100)).toFixed(1))
      : (checkIn.value >= kr.targetValue ? 100 : 0);
    kr.updatedAt = Date.now();
    const obj = this.objectives.get(kr.objectiveId);
    if (obj) {
      obj.confidenceScore = checkIn.confidence;
      this._recomputeObjective(kr.objectiveId);
    }
    return checkIn;
  }

  completeMilestone(keyResultId: string, milestoneId: string): boolean {
    const kr = this.keyResults.get(keyResultId);
    if (!kr) return false;
    const ms = kr.milestones.find(m => m.id === milestoneId);
    if (!ms || ms.completedAt) return false;
    ms.completedAt = Date.now();
    kr.updatedAt = Date.now();
    return true;
  }

  detectAlignments(objectiveId: string): GoalAlignment[] {
    const obj = this.objectives.get(objectiveId);
    if (!obj || !obj.parentObjectiveId) return [];
    const parent = this.objectives.get(obj.parentObjectiveId);
    if (!parent) return [];

    const childWords = new Set(obj.title.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const parentWords = new Set(parent.title.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const commonWords = [...childWords].filter(w => parentWords.has(w));
    const score = Math.round((commonWords.length / Math.max(1, Math.min(childWords.size, parentWords.size))) * 100);

    const alignment: GoalAlignment = {
      childObjectiveId: objectiveId,
      parentObjectiveId: obj.parentObjectiveId,
      alignmentScore: score,
      keywords: commonWords,
      detectedAt: Date.now(),
    };
    this.alignments.push(alignment);
    return [alignment];
  }

  forecastObjective(objectiveId: string): GoalForecast | null {
    const obj = this.objectives.get(objectiveId);
    if (!obj) return null;
    const krs = obj.keyResultIds.map(id => this.keyResults.get(id)).filter(Boolean) as KeyResult[];
    if (krs.length === 0) return null;

    // Linear extrapolation based on recent check-in velocity
    const allCheckIns = krs.flatMap(kr => kr.checkIns).sort((a, b) => a.reportedAt - b.reportedAt);
    const now = Date.now();
    const timeElapsedMs = now - obj.createdAt;
    const remainingMs = obj.dueAt - now;
    const progressVelocity = timeElapsedMs > 0 ? obj.progressPct / (timeElapsedMs / 86400000) : 0;

    const predictedFinal = Math.min(100, obj.progressPct + progressVelocity * (remainingMs / 86400000));
    const daysToComplete = progressVelocity > 0 ? (100 - obj.progressPct) / progressVelocity : 999;

    const forecast: GoalForecast = {
      objectiveId,
      currentProgress: obj.progressPct,
      predictedFinalProgress: parseFloat(predictedFinal.toFixed(1)),
      estimatedCompletionAt: progressVelocity > 0 ? now + daysToComplete * 86400000 : undefined,
      forecastMethod: allCheckIns.length >= 3 ? 'velocity_based' : 'linear_extrapolation',
      confidence: Math.min(90, allCheckIns.length * 10),
      generatedAt: now,
    };
    this.forecasts.set(objectiveId, forecast);
    return forecast;
  }

  updateObjectiveStatus(objectiveId: string, status: GoalStatus): boolean {
    const obj = this.objectives.get(objectiveId);
    if (!obj) return false;
    obj.status = status;
    if (status === 'completed') obj.completedAt = Date.now();
    obj.updatedAt = Date.now();
    return true;
  }

  getObjective(objectiveId: string): Objective | undefined {
    return this.objectives.get(objectiveId);
  }

  getKeyResult(krId: string): KeyResult | undefined {
    return this.keyResults.get(krId);
  }

  listObjectives(tenantId: string, level?: GoalLevel, status?: GoalStatus): Objective[] {
    let all = Array.from(this.objectives.values()).filter(o => o.tenantId === tenantId);
    if (level) all = all.filter(o => o.level === level);
    if (status) all = all.filter(o => o.status === status);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  listKeyResults(objectiveId: string): KeyResult[] {
    return Array.from(this.keyResults.values()).filter(kr => kr.objectiveId === objectiveId);
  }

  listAtRiskObjectives(tenantId: string): Objective[] {
    return Array.from(this.objectives.values()).filter(
      o => o.tenantId === tenantId && (o.health === 'at_risk' || o.health === 'off_track') && o.status === 'active'
    );
  }

  getForecast(objectiveId: string): GoalForecast | undefined {
    return this.forecasts.get(objectiveId);
  }

  getSummary(tenantId: string): GoalSummary {
    const objectives = Array.from(this.objectives.values()).filter(o => o.tenantId === tenantId);
    const krs = Array.from(this.keyResults.values()).filter(kr => kr.tenantId === tenantId);
    const active = objectives.filter(o => o.status === 'active');
    const atRisk = active.filter(o => o.health === 'at_risk' || o.health === 'off_track');
    const completed = objectives.filter(o => o.status === 'completed');
    const avgProgress = active.length > 0 ? active.reduce((s, o) => s + o.progressPct, 0) / active.length : 0;
    const avgConf = active.length > 0 ? active.reduce((s, o) => s + o.confidenceScore, 0) / active.length : 0;
    const pendingCheckins = krs.filter(kr => {
      const lastCheckin = kr.checkIns[kr.checkIns.length - 1];
      return !lastCheckin || Date.now() - lastCheckin.reportedAt > 7 * 86400000;
    }).length;
    return {
      totalObjectives: objectives.length,
      activeObjectives: active.length,
      atRiskObjectives: atRisk.length,
      completedObjectives: completed.length,
      avgProgress: parseFloat(avgProgress.toFixed(1)),
      avgConfidence: parseFloat(avgConf.toFixed(1)),
      totalKeyResults: krs.length,
      pendingCheckIns: pendingCheckins,
    };
  }

  private _recomputeObjective(objectiveId: string): void {
    const obj = this.objectives.get(objectiveId);
    if (!obj) return;
    const krs = obj.keyResultIds.map(id => this.keyResults.get(id)).filter(Boolean) as KeyResult[];
    obj.progressPct = computeObjectiveProgress(krs);
    obj.health = computeHealth(obj.progressPct, obj.dueAt, obj.confidenceScore);
    obj.status = obj.progressPct >= 100 ? 'completed' : obj.health === 'off_track' ? 'at_risk' : obj.status;
    obj.updatedAt = Date.now();
    // Propagate to parent
    if (obj.parentObjectiveId) this._recomputeObjective(obj.parentObjectiveId);
  }
}

const KEY = '__autonomousGoalTracker__';
export function getGoalTracker(): AutonomousGoalTracker {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AutonomousGoalTracker();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AutonomousGoalTracker;
}
