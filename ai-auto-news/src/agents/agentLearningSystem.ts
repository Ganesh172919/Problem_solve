/**
 * Agent Learning System
 *
 * Reinforcement learning feedback loops for AI agents:
 * - Experience replay buffer with prioritized sampling
 * - Reward signal computation from multiple sources
 * - Policy gradient optimization (simplified)
 * - Multi-armed bandit (epsilon-greedy, UCB, Thompson sampling)
 * - Knowledge distillation and transfer learning
 * - Curriculum learning with progressive difficulty
 * - Exploration vs exploitation balancing
 * - Performance baseline tracking and learning rate scheduling
 * - Memory consolidation (short-term to long-term)
 * - Skill acquisition and competency assessment
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Experience {
  id: string;
  agentId: string;
  state: number[];
  action: string;
  reward: number;
  nextState: number[];
  done: boolean;
  timestamp: number;
  metadata: Record<string, unknown>;
  tdError?: number;
  priority?: number;
}

export interface RewardSignal {
  source: 'user_feedback' | 'task_success' | 'quality_metric' | 'time_efficiency' | 'composite';
  value: number;
  weight: number;
  timestamp: number;
}

export interface PolicyParameters {
  weights: number[];
  bias: number[];
  learningRate: number;
  entropy: number;
}

export interface BanditArm {
  id: string;
  action: string;
  pulls: number;
  totalReward: number;
  meanReward: number;
  variance: number;
  alpha: number;
  beta: number;
}

export interface SkillProfile {
  skillId: string;
  agentId: string;
  level: number;
  experience: number;
  successRate: number;
  avgReward: number;
  lastPracticed: number;
  history: { timestamp: number; reward: number }[];
}

export interface CurriculumStage {
  id: string;
  name: string;
  difficulty: number;
  prerequisites: string[];
  completionThreshold: number;
  maxAttempts: number;
  taskGenerator: () => CurriculumTask;
}

export interface CurriculumTask {
  id: string;
  stageId: string;
  difficulty: number;
  state: number[];
  targetActions: string[];
  timeLimit: number;
}

export interface CompetencyAssessment {
  agentId: string;
  timestamp: number;
  overallScore: number;
  skills: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export interface LearningProgress {
  agentId: string;
  epoch: number;
  cumulativeReward: number;
  avgRewardPerEpisode: number;
  explorationRate: number;
  learningRate: number;
  skillLevels: Record<string, number>;
  baselineComparison: number;
  convergenceMetric: number;
}

export interface ConsolidationResult {
  promoted: number;
  pruned: number;
  merged: number;
  shortTermSize: number;
  longTermSize: number;
}

export type BanditStrategy = 'epsilon_greedy' | 'ucb' | 'thompson';

// ─── Experience Replay Buffer ────────────────────────────────────────────────

export class PrioritizedReplayBuffer {
  private buffer: Experience[] = [];
  private priorities: number[] = [];
  private maxSize: number;
  private alpha: number;
  private betaStart: number;
  private betaFrames: number;
  private frameCount = 0;

  constructor(maxSize = 10000, alpha = 0.6, betaStart = 0.4, betaFrames = 100000) {
    this.maxSize = maxSize;
    this.alpha = alpha;
    this.betaStart = betaStart;
    this.betaFrames = betaFrames;
  }

  get size(): number { return this.buffer.length; }

  add(experience: Experience): void {
    const maxPriority = this.priorities.length > 0 ? Math.max(...this.priorities) : 1.0;
    if (this.buffer.length >= this.maxSize) {
      const minIdx = this.priorities.indexOf(Math.min(...this.priorities));
      this.buffer.splice(minIdx, 1);
      this.priorities.splice(minIdx, 1);
    }
    experience.priority = maxPriority;
    this.buffer.push(experience);
    this.priorities.push(maxPriority);
  }

  sample(batchSize: number): { experiences: Experience[]; weights: number[]; indices: number[] } {
    batchSize = Math.min(batchSize, this.buffer.length);
    this.frameCount++;
    const beta = Math.min(1.0, this.betaStart + (1.0 - this.betaStart) * this.frameCount / this.betaFrames);
    const scaled = this.priorities.map(p => Math.pow(p + 1e-6, this.alpha));
    const total = scaled.reduce((a, b) => a + b, 0);
    const probs = scaled.map(p => p / total);

    const n = this.buffer.length;
    const minProb = Math.min(...probs);
    const maxWeight = Math.pow(n * minProb, -beta);
    const indices: number[] = [], experiences: Experience[] = [], weights: number[] = [];

    for (let i = 0; i < batchSize; i++) {
      const idx = this.weightedSample(probs);
      indices.push(idx);
      experiences.push(this.buffer[idx]);
      weights.push(Math.pow(n * probs[idx], -beta) / maxWeight);
    }
    return { experiences, weights, indices };
  }

  updatePriorities(indices: number[], tdErrors: number[]): void {
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] < this.priorities.length) {
        this.priorities[indices[i]] = Math.abs(tdErrors[i]) + 1e-6;
      }
    }
  }

  private weightedSample(probs: number[]): number {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < probs.length; i++) { cum += probs[i]; if (r <= cum) return i; }
    return probs.length - 1;
  }
}

// ─── Reward Computation ──────────────────────────────────────────────────────

export function computeCompositeReward(signals: RewardSignal[]): number {
  if (signals.length === 0) return 0;
  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  if (totalWeight === 0) return 0;

  const now = Date.now();
  const decayed = signals.map(s => {
    const decay = Math.exp(-(now - s.timestamp) / (3600000 * 24));
    return { value: s.value, weight: s.weight * decay };
  });
  const dTotal = decayed.reduce((s, d) => s + d.weight, 0);
  if (dTotal === 0) return signals.reduce((s, sig) => s + sig.value * sig.weight, 0) / totalWeight;
  return decayed.reduce((s, d) => s + d.value * d.weight, 0) / dTotal;
}

export function computeRewardFromFeedback(rating: number, maxRating: number, sentiment = 0): RewardSignal {
  const normalized = (rating / maxRating) * 2 - 1;
  return { source: 'user_feedback', value: 0.8 * normalized + 0.2 * sentiment, weight: 1.0, timestamp: Date.now() };
}

export function computeRewardFromTaskSuccess(
  success: boolean, completionTime: number, expectedTime: number, qualityScore: number,
): RewardSignal {
  let value = success ? 1.0 : -0.5;
  if (success && completionTime < expectedTime) value += 0.2 * (1 - completionTime / expectedTime);
  else if (success && completionTime > expectedTime * 1.5) value -= 0.1;
  value = value * 0.7 + qualityScore * 0.3;
  return { source: 'task_success', value: Math.max(-1, Math.min(1, value)), weight: 1.5, timestamp: Date.now() };
}

// ─── Simplified Policy Gradient ──────────────────────────────────────────────

export class SimplifiedPolicyGradient {
  private params: PolicyParameters;
  private actionSpace: string[];
  private baselineReward = 0;
  private baselineDecay = 0.99;

  constructor(stateSize: number, actionSpace: string[], learningRate = 0.01) {
    this.actionSpace = actionSpace;
    this.params = {
      weights: Array.from({ length: stateSize * actionSpace.length }, () => (Math.random() - 0.5) * 0.1),
      bias: new Array(actionSpace.length).fill(0),
      learningRate,
      entropy: 0,
    };
  }

  selectAction(state: number[]): { action: string; probabilities: number[] } {
    const probs = this.softmax(this.computeLogits(state));
    let r = Math.random(), sel = probs.length - 1;
    for (let i = 0, cum = 0; i < probs.length; i++) { cum += probs[i]; if (r <= cum) { sel = i; break; } }
    return { action: this.actionSpace[sel], probabilities: probs };
  }

  update(states: number[][], actions: string[], rewards: number[]): number {
    const T = states.length;
    if (T === 0) return 0;

    // Discounted returns
    const gamma = 0.99, returns: number[] = new Array(T);
    returns[T - 1] = rewards[T - 1];
    for (let t = T - 2; t >= 0; t--) returns[t] = rewards[t] + gamma * returns[t + 1];

    // Advantages with running baseline
    const advantages = returns.map(r => {
      const adv = r - this.baselineReward;
      this.baselineReward = this.baselineDecay * this.baselineReward + (1 - this.baselineDecay) * r;
      return adv;
    });

    const gradW = new Array(this.params.weights.length).fill(0);
    const gradB = new Array(this.params.bias.length).fill(0);
    let totalLoss = 0;

    for (let t = 0; t < T; t++) {
      const probs = this.softmax(this.computeLogits(states[t]));
      const aIdx = this.actionSpace.indexOf(actions[t]);
      if (aIdx === -1) continue;

      for (let a = 0; a < this.actionSpace.length; a++) {
        const grad = (a === aIdx ? 1 : 0) - probs[a];
        for (let s = 0; s < states[t].length; s++) {
          gradW[a * states[t].length + s] += grad * states[t][s] * advantages[t];
        }
        gradB[a] += grad * advantages[t];
      }
      const entropy = -probs.reduce((s, p) => s + (p > 1e-8 ? p * Math.log(p) : 0), 0);
      totalLoss += -Math.log(Math.max(probs[aIdx], 1e-8)) * advantages[t] - 0.01 * entropy;
    }

    // Gradient clipping and application
    const norm = Math.sqrt(gradW.reduce((s, g) => s + g * g, 0));
    const clip = norm > 1.0 ? 1.0 / norm : 1.0;
    for (let i = 0; i < this.params.weights.length; i++) this.params.weights[i] += this.params.learningRate * gradW[i] * clip / T;
    for (let i = 0; i < this.params.bias.length; i++) this.params.bias[i] += this.params.learningRate * gradB[i] * clip / T;

    this.params.entropy = -this.softmax(this.computeLogits(states[0])).reduce((s, p) => s + (p > 1e-8 ? p * Math.log(p) : 0), 0);
    return totalLoss / T;
  }

  getParameters(): PolicyParameters { return { ...this.params, weights: [...this.params.weights], bias: [...this.params.bias] }; }
  loadParameters(p: PolicyParameters): void { this.params = { ...p, weights: [...p.weights], bias: [...p.bias] }; }

  private computeLogits(state: number[]): number[] {
    return this.actionSpace.map((_, a) => {
      let logit = this.params.bias[a];
      for (let s = 0; s < state.length; s++) {
        const idx = a * state.length + s;
        if (idx < this.params.weights.length) logit += this.params.weights[idx] * state[s];
      }
      return logit;
    });
  }

  private softmax(logits: number[]): number[] {
    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }
}

// ─── Multi-Armed Bandit ──────────────────────────────────────────────────────

export class MultiArmedBandit {
  private arms: Map<string, BanditArm> = new Map();
  private epsilon: number;
  private epsilonDecay: number;
  private epsilonMin: number;
  private totalPulls = 0;
  private ucbC: number;

  constructor(actions: string[], epsilon = 0.1, epsilonDecay = 0.999, epsilonMin = 0.01, ucbC = 2.0) {
    this.epsilon = epsilon;
    this.epsilonDecay = epsilonDecay;
    this.epsilonMin = epsilonMin;
    this.ucbC = ucbC;
    for (const action of actions) {
      this.arms.set(action, { id: action, action, pulls: 0, totalReward: 0, meanReward: 0, variance: 1.0, alpha: 1.0, beta: 1.0 });
    }
  }

  selectAction(strategy: BanditStrategy): string {
    const armList = Array.from(this.arms.values());
    const unpulled = armList.filter(a => a.pulls === 0);
    if (unpulled.length > 0) return unpulled[Math.floor(Math.random() * unpulled.length)].action;

    if (strategy === 'ucb') {
      const logT = Math.log(this.totalPulls);
      return armList.reduce((best, arm) => {
        const ucb = arm.meanReward + this.ucbC * Math.sqrt(logT / arm.pulls);
        const bestUcb = best.meanReward + this.ucbC * Math.sqrt(logT / best.pulls);
        return ucb > bestUcb ? arm : best;
      }).action;
    }
    if (strategy === 'thompson') {
      let bestSample = -Infinity, bestAction = armList[0].action;
      for (const arm of armList) {
        const sample = this.sampleBeta(arm.alpha, arm.beta);
        if (sample > bestSample) { bestSample = sample; bestAction = arm.action; }
      }
      return bestAction;
    }
    // epsilon-greedy
    if (Math.random() < this.epsilon) return armList[Math.floor(Math.random() * armList.length)].action;
    return armList.reduce((best, arm) => arm.meanReward > best.meanReward ? arm : best).action;
  }

  updateArm(action: string, reward: number): void {
    const arm = this.arms.get(action);
    if (!arm) { logger.warn('Unknown bandit arm', { action }); return; }
    arm.pulls++;
    this.totalPulls++;
    arm.totalReward += reward;
    const oldMean = arm.meanReward;
    arm.meanReward = arm.totalReward / arm.pulls;
    if (arm.pulls > 1) arm.variance += (reward - oldMean) * (reward - arm.meanReward);
    const norm = (reward + 1) / 2;
    arm.alpha += norm;
    arm.beta += 1 - norm;
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  getArmStats(): BanditArm[] { return Array.from(this.arms.values()); }
  getExplorationRate(): number { return this.epsilon; }

  /** Beta sampling via gamma ratio method with Marsaglia-Tsang */
  private sampleBeta(a: number, b: number): number {
    const x = this.sampleGamma(a), y = this.sampleGamma(b);
    return x / (x + y + 1e-10);
  }

  private sampleGamma(shape: number): number {
    if (shape < 1) return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 1000; i++) {
      let x: number, v: number;
      do { x = this.randn(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return shape;
  }

  private randn(): number {
    return Math.sqrt(-2 * Math.log(Math.random() + 1e-10)) * Math.cos(2 * Math.PI * Math.random());
  }
}

// ─── Curriculum Learning ─────────────────────────────────────────────────────

export class CurriculumLearner {
  private stages: CurriculumStage[] = [];
  private currentStageIdx = 0;
  private stageAttempts: Map<string, number> = new Map();
  private stageScores: Map<string, number[]> = new Map();

  addStage(stage: CurriculumStage): void {
    this.stages.push(stage);
    this.stages.sort((a, b) => a.difficulty - b.difficulty);
    this.stageAttempts.set(stage.id, 0);
    this.stageScores.set(stage.id, []);
  }

  getCurrentStage(): CurriculumStage | null { return this.stages[this.currentStageIdx] ?? null; }

  generateTask(): CurriculumTask | null {
    const stage = this.getCurrentStage();
    if (!stage) return null;
    this.stageAttempts.set(stage.id, (this.stageAttempts.get(stage.id) ?? 0) + 1);
    return stage.taskGenerator();
  }

  recordResult(stageId: string, score: number): { advanced: boolean; completed: boolean } {
    const scores = this.stageScores.get(stageId);
    if (!scores) return { advanced: false, completed: false };
    scores.push(score);

    const stage = this.stages.find(s => s.id === stageId);
    if (!stage) return { advanced: false, completed: false };

    const window = Math.max(5, Math.floor(stage.maxAttempts * 0.3));
    const recent = scores.slice(-window);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const advanced = avg >= stage.completionThreshold && recent.length >= window;

    if (advanced && this.currentStageIdx < this.stages.length - 1) {
      this.currentStageIdx++;
      logger.info('Curriculum advanced', { from: stageId, to: this.stages[this.currentStageIdx].id, avgScore: avg });
    }
    return { advanced, completed: advanced && this.currentStageIdx >= this.stages.length - 1 };
  }

  getProgress(): { currentStage: number; totalStages: number; stageScores: Record<string, number> } {
    const avg: Record<string, number> = {};
    this.stageScores.forEach((scores, id) => {
      avg[id] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    });
    return { currentStage: this.currentStageIdx, totalStages: this.stages.length, stageScores: avg };
  }
}

// ─── Main Agent Learning System ──────────────────────────────────────────────

export class AgentLearningSystem {
  private replayBuffer: PrioritizedReplayBuffer;
  private policy: SimplifiedPolicyGradient;
  private bandit: MultiArmedBandit;
  private curriculum: CurriculumLearner;
  private skills: Map<string, SkillProfile> = new Map();
  private shortTermMemory: Experience[] = [];
  private longTermMemory: Experience[] = [];
  private rewardHistory: number[] = [];
  private lrSchedule: { epoch: number; lr: number }[] = [];
  private epoch = 0;
  private baseLR: number;
  private currentLR: number;
  private batchSize: number;
  private consolidationThreshold: number;
  private agentId: string;

  constructor(config: {
    agentId: string;
    stateSize: number;
    actionSpace: string[];
    bufferSize?: number;
    batchSize?: number;
    learningRate?: number;
    epsilon?: number;
    consolidationThreshold?: number;
  }) {
    this.agentId = config.agentId;
    this.batchSize = config.batchSize ?? 32;
    this.baseLR = config.learningRate ?? 0.01;
    this.currentLR = this.baseLR;
    this.consolidationThreshold = config.consolidationThreshold ?? 50;
    this.replayBuffer = new PrioritizedReplayBuffer(config.bufferSize ?? 10000);
    this.policy = new SimplifiedPolicyGradient(config.stateSize, config.actionSpace, this.baseLR);
    this.bandit = new MultiArmedBandit(config.actionSpace, config.epsilon ?? 0.1);
    this.curriculum = new CurriculumLearner();
    logger.info('Agent learning system initialized', { agentId: config.agentId, stateSize: config.stateSize, actions: config.actionSpace.length });
  }

  // ─── Online Learning ───────────────────────────────────────────────────────

  recordExperience(state: number[], action: string, reward: number, nextState: number[], done: boolean, metadata: Record<string, unknown> = {}): void {
    const exp: Experience = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId: this.agentId, state, action, reward, nextState, done, timestamp: Date.now(), metadata,
    };
    this.replayBuffer.add(exp);
    this.shortTermMemory.push(exp);
    this.rewardHistory.push(reward);
    this.bandit.updateArm(action, reward);
    this.updateSkill(action, reward);
    if (this.shortTermMemory.length >= this.consolidationThreshold) this.consolidateMemory();
  }

  selectAction(state: number[], strategy: BanditStrategy = 'thompson'): string {
    const banditAction = this.bandit.selectAction(strategy);
    const { action: policyAction, probabilities } = this.policy.selectAction(state);
    // Adaptive blend: use policy more as training progresses
    const policyWeight = Math.min(0.8, this.epoch / 100);
    if (Math.max(...probabilities) > 0.7 && Math.random() < policyWeight) return policyAction;
    return banditAction;
  }

  // ─── Batch Learning ────────────────────────────────────────────────────────

  trainBatch(): { loss: number; batchSize: number } {
    if (this.replayBuffer.size < this.batchSize) return { loss: 0, batchSize: 0 };
    const { experiences, weights, indices } = this.replayBuffer.sample(this.batchSize);
    const rewards = experiences.map((e, i) => e.reward * weights[i]);
    const loss = this.policy.update(experiences.map(e => e.state), experiences.map(e => e.action), rewards);
    this.replayBuffer.updatePriorities(indices, experiences.map(e => Math.abs(e.reward - (e.tdError ?? 0))));
    this.epoch++;
    this.updateLearningRate();
    logger.debug('Batch training complete', { epoch: this.epoch, loss, batchSize: experiences.length });
    return { loss, batchSize: experiences.length };
  }

  trainFromHistory(data: Experience[]): { epochs: number; finalLoss: number } {
    for (const exp of data) this.replayBuffer.add(exp);
    let finalLoss = 0;
    const maxEpochs = Math.ceil(data.length / this.batchSize) * 3;
    for (let i = 0; i < maxEpochs; i++) {
      const { loss } = this.trainBatch();
      finalLoss = loss;
      if (i > 10 && Math.abs(loss) < 0.001) break;
    }
    logger.info('Historical training complete', { dataPoints: data.length, epochs: this.epoch, finalLoss });
    return { epochs: this.epoch, finalLoss };
  }

  // ─── Knowledge Distillation & Transfer ─────────────────────────────────────

  exportKnowledge(): { policyParams: PolicyParameters; banditStats: BanditArm[]; skills: SkillProfile[] } {
    return { policyParams: this.policy.getParameters(), banditStats: this.bandit.getArmStats(), skills: Array.from(this.skills.values()) };
  }

  importKnowledge(source: { policyParams: PolicyParameters; skills: SkillProfile[] }, blendFactor = 0.5): void {
    const current = this.policy.getParameters();
    this.policy.loadParameters({
      weights: current.weights.map((w, i) => w * (1 - blendFactor) + (source.policyParams.weights[i] ?? 0) * blendFactor),
      bias: current.bias.map((b, i) => b * (1 - blendFactor) + (source.policyParams.bias[i] ?? 0) * blendFactor),
      learningRate: current.learningRate,
      entropy: current.entropy,
    });
    for (const skill of source.skills) {
      const existing = this.skills.get(skill.skillId);
      if (existing) {
        existing.level = Math.max(existing.level, skill.level * blendFactor);
        existing.avgReward = existing.avgReward * (1 - blendFactor) + skill.avgReward * blendFactor;
      } else {
        this.skills.set(skill.skillId, { ...skill, level: skill.level * blendFactor, agentId: this.agentId });
      }
    }
    logger.info('Knowledge imported', { blendFactor, sourceSkills: source.skills.length });
  }

  // ─── Memory Consolidation ──────────────────────────────────────────────────

  consolidateMemory(): ConsolidationResult {
    const result: ConsolidationResult = { promoted: 0, pruned: 0, merged: 0, shortTermSize: 0, longTermSize: 0 };
    const highValue = this.shortTermMemory.filter(e => Math.abs(e.reward) > 0.5);
    const lowValue = this.shortTermMemory.filter(e => Math.abs(e.reward) <= 0.5);

    // Merge similar low-value experiences by action
    const groups = new Map<string, Experience[]>();
    for (const exp of lowValue) { const g = groups.get(exp.action) ?? []; g.push(exp); groups.set(exp.action, g); }
    const merged: Experience[] = [];
    groups.forEach((group) => {
      if (group.length <= 1) { merged.push(...group); return; }
      const avgState = group[0].state.map((_, i) => group.reduce((s, e) => s + (e.state[i] ?? 0), 0) / group.length);
      const avgReward = group.reduce((s, e) => s + e.reward, 0) / group.length;
      merged.push({ ...group[0], id: `merged_${Date.now()}`, state: avgState, reward: avgReward, metadata: { mergedCount: group.length } });
    });
    result.merged = lowValue.length - merged.length;

    this.longTermMemory.push(...highValue, ...merged);
    result.promoted = highValue.length + merged.length;

    if (this.longTermMemory.length > 5000) {
      this.longTermMemory.sort((a, b) => Math.abs(b.reward) - Math.abs(a.reward));
      result.pruned = this.longTermMemory.length - 5000;
      this.longTermMemory = this.longTermMemory.slice(0, 5000);
    }

    this.shortTermMemory = [];
    result.longTermSize = this.longTermMemory.length;
    logger.debug('Memory consolidated', result as unknown as Record<string, unknown>);
    return result;
  }

  // ─── Skill Tracking ────────────────────────────────────────────────────────

  private updateSkill(action: string, reward: number): void {
    const key = `${this.agentId}:${action}`;
    let skill = this.skills.get(key);
    if (!skill) {
      skill = { skillId: key, agentId: this.agentId, level: 0, experience: 0, successRate: 0, avgReward: 0, lastPracticed: Date.now(), history: [] };
      this.skills.set(key, skill);
    }
    skill.experience++;
    skill.history.push({ timestamp: Date.now(), reward });
    if (skill.history.length > 200) skill.history.shift();
    skill.avgReward = skill.avgReward * 0.9 + reward * 0.1;
    skill.successRate = skill.history.filter(h => h.reward > 0).length / skill.history.length;
    skill.level = Math.min(100, Math.log2(skill.experience + 1) * skill.successRate * 15);
    skill.lastPracticed = Date.now();
  }

  // ─── Competency Assessment ─────────────────────────────────────────────────

  assessCompetency(): CompetencyAssessment {
    const entries = Array.from(this.skills.values()).filter(s => s.agentId === this.agentId);
    const skillScores: Record<string, number> = {};
    for (const s of entries) skillScores[s.skillId] = s.level;
    const avg = entries.length > 0 ? entries.reduce((s, sk) => s + sk.level, 0) / entries.length : 0;
    const sorted = [...entries].sort((a, b) => b.level - a.level);
    const recommendations: string[] = [];
    for (const s of entries) {
      if (s.successRate < 0.4) recommendations.push(`Increase practice for ${s.skillId} (${(s.successRate * 100).toFixed(1)}% success)`);
      if (Date.now() - s.lastPracticed > 86400000) recommendations.push(`Resume ${s.skillId} (idle >24h)`);
    }
    return {
      agentId: this.agentId, timestamp: Date.now(), overallScore: avg, skills: skillScores,
      strengths: sorted.slice(0, 3).map(s => s.skillId), weaknesses: sorted.slice(-3).map(s => s.skillId), recommendations,
    };
  }

  // ─── Learning Rate Scheduling (cosine annealing with warm restarts) ────────

  private updateLearningRate(): void {
    const cycle = 50, pos = this.epoch % cycle;
    this.currentLR = this.baseLR * Math.max(0.01, 0.5 * (1 + Math.cos(Math.PI * pos / cycle)));
    const params = this.policy.getParameters();
    params.learningRate = this.currentLR;
    this.policy.loadParameters(params);
    this.lrSchedule.push({ epoch: this.epoch, lr: this.currentLR });
    if (this.lrSchedule.length > 1000) this.lrSchedule = this.lrSchedule.slice(-500);
  }

  // ─── Curriculum Interface ──────────────────────────────────────────────────

  addCurriculumStage(stage: CurriculumStage): void { this.curriculum.addStage(stage); }
  getNextCurriculumTask(): CurriculumTask | null { return this.curriculum.generateTask(); }
  recordCurriculumResult(stageId: string, score: number): { advanced: boolean; completed: boolean } { return this.curriculum.recordResult(stageId, score); }

  // ─── Progress & Visualization Data ─────────────────────────────────────────

  getLearningProgress(): LearningProgress {
    const recent = this.rewardHistory.slice(-100);
    const avg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const early = this.rewardHistory.slice(0, 100);
    const earlyAvg = early.length > 0 ? early.reduce((a, b) => a + b, 0) / early.length : 0;
    const variance = recent.length > 1 ? recent.reduce((s, r) => s + (r - avg) ** 2, 0) / (recent.length - 1) : 1;
    const skillLevels: Record<string, number> = {};
    this.skills.forEach((s, id) => { skillLevels[id] = s.level; });
    return {
      agentId: this.agentId, epoch: this.epoch,
      cumulativeReward: this.rewardHistory.reduce((a, b) => a + b, 0),
      avgRewardPerEpisode: avg, explorationRate: this.bandit.getExplorationRate(),
      learningRate: this.currentLR, skillLevels,
      baselineComparison: earlyAvg !== 0 ? avg / earlyAvg : 1,
      convergenceMetric: 1 / (1 + variance),
    };
  }

  getRewardHistory(): number[] { return [...this.rewardHistory]; }
  getLearningRateSchedule(): { epoch: number; lr: number }[] { return [...this.lrSchedule]; }
  getBufferStats(): { size: number; longTermSize: number; shortTermSize: number } {
    return { size: this.replayBuffer.size, longTermSize: this.longTermMemory.length, shortTermSize: this.shortTermMemory.length };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createAgentLearningSystem(config: {
  agentId: string; stateSize: number; actionSpace: string[];
  bufferSize?: number; batchSize?: number; learningRate?: number; epsilon?: number;
}): AgentLearningSystem {
  return new AgentLearningSystem(config);
}
