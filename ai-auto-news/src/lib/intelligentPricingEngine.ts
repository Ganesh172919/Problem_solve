import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PricingPlan {
  id: string;
  name: string;
  basePrice: number;
  currency: string;
  billingCycle: 'monthly' | 'annual' | 'weekly' | 'one-time';
  features: string[];
  targetCohort?: string;
  floorPrice: number;
  ceilingPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PricePoint {
  planId: string;
  price: number;
  timestamp: Date;
  source: 'manual' | 'ml' | 'competitor' | 'experiment' | 'realtime';
  demandIndex: number;
  conversionRate?: number;
  revenueImpact?: number;
}

export interface ElasticityModel {
  planId: string;
  basePrice: number;
  baseQuantity: number;
  elasticityCoefficient: number; // price elasticity of demand (PED)
  r2Score: number;               // goodness of fit
  sampleSize: number;
  lastUpdated: Date;
}

export interface CompetitorPrice {
  competitorId: string;
  competitorName: string;
  planId: string;
  price: number;
  features: string[];
  observedAt: Date;
  priceIndex: number; // relative to our price (1.0 = same)
}

export interface PricingExperiment {
  id: string;
  name: string;
  planId: string;
  controlPrice: number;
  variantPrice: number;
  trafficSplit: number; // 0–1 fraction going to variant
  startDate: Date;
  endDate?: Date;
  status: 'draft' | 'running' | 'completed' | 'stopped';
  controlConversions: number;
  variantConversions: number;
  controlExposures: number;
  variantExposures: number;
  pValue?: number;
  winner?: 'control' | 'variant' | 'inconclusive';
}

export interface PricingRecommendation {
  planId: string;
  currentPrice: number;
  recommendedPrice: number;
  expectedRevenueLift: number; // percentage
  expectedConversionChange: number; // percentage
  confidence: number; // 0–1
  reasoning: string[];
  generatedAt: Date;
}

export interface DemandForecast {
  planId: string;
  horizon: number; // days
  forecast: { date: Date; expectedDemand: number; lower: number; upper: number }[];
  method: string;
  accuracy: number;
}

interface PriceObservation {
  price: number;
  quantity: number;
  timestamp: Date;
}

interface CohortPricingRule {
  cohortId: string;
  modifier: number; // multiplier, e.g. 0.9 = 10% discount
  reason: string;
}

interface TimeBasedRule {
  id: string;
  name: string;
  modifier: number;
  daysOfWeek?: number[]; // 0=Sun, 6=Sat
  hoursStart?: number;   // 0–23
  hoursEnd?: number;     // 0–23
  monthsOfYear?: number[];
}

// ─── Engine ──────────────────────────────────────────────────────────────────

class IntelligentPricingEngine {
  private plans = new Map<string, PricingPlan>();
  private priceHistory = new Map<string, PricePoint[]>();
  private elasticityModels = new Map<string, ElasticityModel>();
  private competitorPrices = new Map<string, CompetitorPrice[]>();
  private experiments = new Map<string, PricingExperiment>();
  private observations = new Map<string, PriceObservation[]>();
  private cohortRules = new Map<string, CohortPricingRule[]>();
  private timeRules: TimeBasedRule[] = [];

  // ── Plan management ────────────────────────────────────────────────────────

  registerPlan(plan: PricingPlan): void {
    this.plans.set(plan.id, plan);
    if (!this.priceHistory.has(plan.id)) this.priceHistory.set(plan.id, []);
    if (!this.observations.has(plan.id)) this.observations.set(plan.id, []);
    logger.info('Pricing plan registered', { planId: plan.id, basePrice: plan.basePrice });
  }

  addCohortRule(planId: string, rule: CohortPricingRule): void {
    const existing = this.cohortRules.get(planId) ?? [];
    existing.push(rule);
    this.cohortRules.set(planId, existing);
  }

  addTimeBasedRule(rule: TimeBasedRule): void {
    this.timeRules.push(rule);
    logger.info('Time-based pricing rule added', { ruleId: rule.id, modifier: rule.modifier });
  }

  recordObservation(planId: string, price: number, quantity: number): void {
    const obs = this.observations.get(planId) ?? [];
    obs.push({ price, quantity, timestamp: new Date() });
    // Keep last 500 observations
    if (obs.length > 500) obs.splice(0, obs.length - 500);
    this.observations.set(planId, obs);
    // Refresh elasticity model after each new observation (debounced via cache)
    const cacheKey = `elasticity_dirty_${planId}`;
    if (!cache.get(cacheKey)) {
      cache.set(cacheKey, true, 300); // recompute every 5 min
      this.modelElasticity(planId);
    }
  }

  // ── Elasticity modelling ──────────────────────────────────────────────────

  modelElasticity(planId: string): ElasticityModel | null {
    const obs = this.observations.get(planId);
    if (!obs || obs.length < 5) {
      logger.warn('Insufficient observations for elasticity modelling', { planId, count: obs?.length ?? 0 });
      return null;
    }

    // Log-linear demand model: ln(Q) = a + b * ln(P)  =>  b is PED
    const logPrices = obs.map(o => Math.log(o.price));
    const logQtys   = obs.map(o => Math.log(Math.max(o.quantity, 1)));
    const n = obs.length;

    const sumX  = logPrices.reduce((a, v) => a + v, 0);
    const sumY  = logQtys.reduce((a, v) => a + v, 0);
    const sumXY = logPrices.reduce((a, v, i) => a + v * logQtys[i], 0);
    const sumX2 = logPrices.reduce((a, v) => a + v * v, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;

    const b = (n * sumXY - sumX * sumY) / denom; // PED
    const a = (sumY - b * sumX) / n;

    // R² calculation
    const yMean = sumY / n;
    const ssTot = logQtys.reduce((acc, y) => acc + (y - yMean) ** 2, 0);
    const ssRes = logQtys.reduce((acc, y, i) => acc + (y - (a + b * logPrices[i])) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const plan = this.plans.get(planId);
    const basePrice = plan?.basePrice ?? Math.exp(sumX / n);
    const baseQuantity = Math.exp(a + b * Math.log(basePrice));

    const model: ElasticityModel = {
      planId,
      basePrice,
      baseQuantity,
      elasticityCoefficient: b,
      r2Score: Math.max(0, r2),
      sampleSize: n,
      lastUpdated: new Date(),
    };

    this.elasticityModels.set(planId, model);
    logger.info('Elasticity model updated', { planId, PED: b.toFixed(3), r2: r2.toFixed(3) });
    return model;
  }

  // ── Optimal price (gradient ascent on revenue) ────────────────────────────

  calculateOptimalPrice(planId: string, cohortId?: string): number {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const model = this.elasticityModels.get(planId) ?? this.modelElasticity(planId);
    if (!model) {
      logger.warn('No elasticity model; returning base price', { planId });
      return this.applyConstraints(plan.basePrice, plan);
    }

    // Revenue = P * Q(P) = P * Q0 * (P/P0)^b
    // dR/dP = Q0*(P/P0)^b * (1 + b) = 0  =>  optimal when b = -1 (unit elastic)
    // Gradient ascent to find revenue-maximising price
    const { basePrice, baseQuantity, elasticityCoefficient: b } = model;

    const revenue = (p: number): number =>
      p * baseQuantity * Math.pow(p / basePrice, b);

    let price = plan.basePrice;
    const lr = 0.001;
    const epsilon = 0.01;
    for (let i = 0; i < 2000; i++) {
      const grad = (revenue(price + epsilon) - revenue(price - epsilon)) / (2 * epsilon);
      price += lr * grad;
      price = Math.max(plan.floorPrice, Math.min(plan.ceilingPrice, price));
      if (Math.abs(grad) < 1e-6) break;
    }

    // Apply cohort modifier
    if (cohortId) {
      const rules = this.cohortRules.get(planId) ?? [];
      const rule = rules.find(r => r.cohortId === cohortId);
      if (rule) price *= rule.modifier;
    }

    // Apply time-based modifier
    const timeModifier = this.getTimeModifier();
    price *= timeModifier;

    price = this.applyConstraints(price, plan);
    logger.info('Optimal price calculated', { planId, price: price.toFixed(2), cohortId });
    return Math.round(price * 100) / 100;
  }

  private applyConstraints(price: number, plan: PricingPlan): number {
    return Math.max(plan.floorPrice, Math.min(plan.ceilingPrice, price));
  }

  private getTimeModifier(): number {
    const now = new Date();
    const hour = now.getHours();
    const dow  = now.getDay();
    const month = now.getMonth() + 1;
    let modifier = 1.0;
    for (const rule of this.timeRules) {
      let matches = true;
      if (rule.daysOfWeek && !rule.daysOfWeek.includes(dow)) matches = false;
      if (rule.hoursStart !== undefined && rule.hoursEnd !== undefined) {
        if (hour < rule.hoursStart || hour >= rule.hoursEnd) matches = false;
      }
      if (rule.monthsOfYear && !rule.monthsOfYear.includes(month)) matches = false;
      if (matches) modifier *= rule.modifier;
    }
    return modifier;
  }

  // ── Competitor tracking ───────────────────────────────────────────────────

  trackCompetitorPrice(entry: Omit<CompetitorPrice, 'priceIndex'>): void {
    const plan = this.plans.get(entry.planId);
    const ourPrice = plan?.basePrice ?? 1;
    const full: CompetitorPrice = { ...entry, priceIndex: entry.price / ourPrice };
    const existing = this.competitorPrices.get(entry.planId) ?? [];
    // Replace stale entry for same competitor
    const idx = existing.findIndex(e => e.competitorId === entry.competitorId);
    if (idx >= 0) existing[idx] = full;
    else existing.push(full);
    this.competitorPrices.set(entry.planId, existing);
    logger.info('Competitor price tracked', {
      planId: entry.planId,
      competitor: entry.competitorName,
      price: entry.price,
      index: full.priceIndex.toFixed(2),
    });
  }

  getCompetitorSummary(planId: string): {
    min: number; max: number; average: number; ourPosition: string;
  } | null {
    const plan = this.plans.get(planId);
    const competitors = this.competitorPrices.get(planId);
    if (!plan || !competitors || competitors.length === 0) return null;
    const prices = competitors.map(c => c.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;
    const ourPrice = plan.basePrice;
    const position =
      ourPrice <= min ? 'lowest' :
      ourPrice >= max ? 'highest' :
      ourPrice < average ? 'below-average' : 'above-average';
    return { min, max, average, ourPosition: position };
  }

  // ── A/B price experiments ─────────────────────────────────────────────────

  createPricingExperiment(
    planId: string,
    name: string,
    variantPrice: number,
    trafficSplit = 0.5,
    durationDays = 14,
  ): PricingExperiment {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    const exp: PricingExperiment = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      planId,
      controlPrice: plan.basePrice,
      variantPrice,
      trafficSplit,
      startDate: new Date(),
      endDate: new Date(Date.now() + durationDays * 86400000),
      status: 'running',
      controlConversions: 0,
      variantConversions: 0,
      controlExposures: 0,
      variantExposures: 0,
    };
    this.experiments.set(exp.id, exp);
    logger.info('Pricing experiment created', { id: exp.id, planId, variantPrice });
    return exp;
  }

  recordExperimentExposure(experimentId: string, converted: boolean): 'control' | 'variant' {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') throw new Error('Experiment not active');
    const bucket = Math.random() < exp.trafficSplit ? 'variant' : 'control';
    if (bucket === 'variant') {
      exp.variantExposures++;
      if (converted) exp.variantConversions++;
    } else {
      exp.controlExposures++;
      if (converted) exp.controlConversions++;
    }
    // Auto-analyse after 100+ exposures per arm
    if (exp.controlExposures >= 100 && exp.variantExposures >= 100) {
      this.analyseExperiment(experimentId);
    }
    return bucket;
  }

  private analyseExperiment(id: string): void {
    const exp = this.experiments.get(id);
    if (!exp) return;
    const rateC = exp.controlExposures > 0 ? exp.controlConversions / exp.controlExposures : 0;
    const rateV = exp.variantExposures  > 0 ? exp.variantConversions  / exp.variantExposures  : 0;
    // Two-proportion z-test
    const pooled = (exp.controlConversions + exp.variantConversions) /
                   (exp.controlExposures + exp.variantExposures);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / exp.controlExposures + 1 / exp.variantExposures));
    const z  = se > 0 ? (rateV - rateC) / se : 0;
    // Approximate p-value via normal CDF
    exp.pValue = 2 * (1 - this.normalCDF(Math.abs(z)));
    if (exp.pValue < 0.05) {
      exp.winner = rateV > rateC ? 'variant' : 'control';
    } else {
      exp.winner = 'inconclusive';
    }
    logger.info('Experiment analysed', { id, rateC: rateC.toFixed(3), rateV: rateV.toFixed(3), pValue: exp.pValue.toFixed(4), winner: exp.winner });
  }

  private normalCDF(z: number): number {
    // Abramowitz & Stegun approximation; valid for z >= 0; reflect for z < 0
    const absZ = Math.abs(z);
    const t    = 1 / (1 + 0.3275911 * absZ);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const upper = 1 - poly * Math.exp(-absZ * absZ / 2);
    return z >= 0 ? upper : 1 - upper;
  }

  stopExperiment(id: string): PricingExperiment {
    const exp = this.experiments.get(id);
    if (!exp) throw new Error('Experiment not found');
    exp.status = 'stopped';
    exp.endDate = new Date();
    this.analyseExperiment(id);
    return exp;
  }

  // ── Real-time price adjustment ────────────────────────────────────────────

  adjustPriceRealtime(planId: string, demandSignal: number, cohortId?: string): PricePoint {
    // demandSignal: 1.0 = baseline, >1 = high demand, <1 = low demand
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const model = this.elasticityModels.get(planId);
    let price = plan.basePrice;

    if (model && model.elasticityCoefficient < 0) {
      // Surge pricing: raise price when demand is high (within elasticity limits)
      // Delta price proportional to demand deviation and inversely proportional to |PED|
      const demandDelta = demandSignal - 1.0;
      const adjustment = demandDelta / Math.abs(model.elasticityCoefficient);
      price = plan.basePrice * (1 + adjustment);
    }

    if (cohortId) {
      const rules = this.cohortRules.get(planId) ?? [];
      const rule = rules.find(r => r.cohortId === cohortId);
      if (rule) price *= rule.modifier;
    }

    price *= this.getTimeModifier();
    price = this.applyConstraints(price, plan);
    price = Math.round(price * 100) / 100;

    const point: PricePoint = {
      planId,
      price,
      timestamp: new Date(),
      source: 'realtime',
      demandIndex: demandSignal,
    };
    const hist = this.priceHistory.get(planId) ?? [];
    hist.push(point);
    if (hist.length > 1000) hist.splice(0, hist.length - 1000);
    this.priceHistory.set(planId, hist);

    logger.info('Real-time price adjusted', { planId, price, demandSignal });
    return point;
  }

  // ── Demand forecasting (Holt-Winters simple adaptation) ──────────────────

  forecastDemand(planId: string, horizonDays = 7): DemandForecast {
    const obs = this.observations.get(planId) ?? [];
    if (obs.length < 3) {
      return {
        planId, horizon: horizonDays,
        forecast: Array.from({ length: horizonDays }, (_, i) => ({
          date: new Date(Date.now() + i * 86400000),
          expectedDemand: 0, lower: 0, upper: 0,
        })),
        method: 'naive', accuracy: 0,
      };
    }

    // Group observations by day
    const daily = new Map<string, number[]>();
    for (const o of obs) {
      const key = o.timestamp.toISOString().slice(0, 10);
      const list = daily.get(key) ?? [];
      list.push(o.quantity);
      daily.set(key, list);
    }

    const series: number[] = [];
    for (const vals of daily.values()) {
      series.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // Exponential smoothing with trend (Holt's linear)
    const alpha = 0.3; // smoothing
    const beta  = 0.1; // trend
    let level = series[0];
    let trend = series.length > 1 ? series[1] - series[0] : 0;
    for (let i = 1; i < series.length; i++) {
      const prevLevel = level;
      level = alpha * series[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    // Compute residual std for confidence interval
    const residuals: number[] = [];
    let l = series[0]; let tr = series.length > 1 ? series[1] - series[0] : 0;
    for (let i = 1; i < series.length; i++) {
      const pred = l + tr;
      residuals.push(series[i] - pred);
      const pl = l;
      l  = alpha * series[i] + (1 - alpha) * (l + tr);
      tr = beta  * (l - pl)  + (1 - beta)  * tr;
    }
    const stdRes = residuals.length > 0
      ? Math.sqrt(residuals.reduce((a, v) => a + v * v, 0) / residuals.length)
      : level * 0.2;

    // MAPE-based accuracy
    const actuals = series.slice(1);
    const mape = actuals.length > 0
      ? actuals.reduce((acc, v, i) => {
          const pred = series[i] + (i > 0 ? (series[i] - series[i - 1]) * beta : 0);
          return acc + Math.abs((v - pred) / Math.max(v, 1));
        }, 0) / actuals.length
      : 0.2;

    const forecast = Array.from({ length: horizonDays }, (_, i) => {
      const h = i + 1;
      const expected = Math.max(0, level + trend * h);
      const ci = 1.96 * stdRes * Math.sqrt(h);
      return {
        date: new Date(Date.now() + i * 86400000),
        expectedDemand: Math.round(expected * 100) / 100,
        lower: Math.max(0, Math.round((expected - ci) * 100) / 100),
        upper: Math.round((expected + ci) * 100) / 100,
      };
    });

    logger.info('Demand forecast generated', { planId, horizonDays, accuracy: (1 - mape).toFixed(3) });
    return { planId, horizon: horizonDays, forecast, method: 'holt-linear', accuracy: Math.max(0, 1 - mape) };
  }

  // ── Recommendations ───────────────────────────────────────────────────────

  getPricingRecommendations(planId: string): PricingRecommendation {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const model = this.elasticityModels.get(planId);
    const compSummary = this.getCompetitorSummary(planId);
    const optimalPrice = model ? this.calculateOptimalPrice(planId) : plan.basePrice;
    const reasoning: string[] = [];
    let confidence = 0.5;

    if (model) {
      confidence = Math.min(0.95, 0.4 + model.r2Score * 0.5 + Math.min(model.sampleSize / 200, 0.1));
      reasoning.push(`Elasticity PED=${model.elasticityCoefficient.toFixed(2)} (R²=${model.r2Score.toFixed(2)}, n=${model.sampleSize})`);
      if (model.elasticityCoefficient > -1) reasoning.push('Demand is inelastic – price increase likely beneficial');
      else reasoning.push('Demand is elastic – price decrease may boost revenue via volume');
    }

    if (compSummary) {
      reasoning.push(`Competitors: avg=${compSummary.average.toFixed(2)}, our position=${compSummary.ourPosition}`);
      if (compSummary.ourPosition === 'above-average') reasoning.push('Consider modest reduction to stay competitive');
    }

    // Expected revenue lift
    const revenueLift = model
      ? ((optimalPrice / plan.basePrice) *
         Math.pow(optimalPrice / plan.basePrice, model.elasticityCoefficient) - 1) * 100
      : 0;

    const conversionChange = model
      ? (Math.pow(optimalPrice / plan.basePrice, model.elasticityCoefficient) - 1) * 100
      : 0;

    return {
      planId,
      currentPrice: plan.basePrice,
      recommendedPrice: optimalPrice,
      expectedRevenueLift: Math.round(revenueLift * 100) / 100,
      expectedConversionChange: Math.round(conversionChange * 100) / 100,
      confidence,
      reasoning,
      generatedAt: new Date(),
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  getPriceHistory(planId: string, limit = 100): PricePoint[] {
    const hist = this.priceHistory.get(planId) ?? [];
    return hist.slice(-limit);
  }

  getExperiment(id: string): PricingExperiment | undefined {
    return this.experiments.get(id);
  }

  listExperiments(planId?: string): PricingExperiment[] {
    const all = Array.from(this.experiments.values());
    return planId ? all.filter(e => e.planId === planId) : all;
  }

  getElasticityModel(planId: string): ElasticityModel | undefined {
    return this.elasticityModels.get(planId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getIntelligentPricingEngine(): IntelligentPricingEngine {
  if (!(globalThis as any).__intelligentPricingEngine__) {
    (globalThis as any).__intelligentPricingEngine__ = new IntelligentPricingEngine();
  }
  return (globalThis as any).__intelligentPricingEngine__;
}
