import { logger } from '@/lib/logger';

// --- Types ---

interface SLATarget {
  id: string;
  service: string;
  metric: 'availability' | 'latency_p50' | 'latency_p95' | 'latency_p99' | 'error_rate';
  targetValue: number;
  /** For availability: percentage (e.g. 99.9). For latency: ms. For error_rate: percentage. */
  unit: 'percent' | 'ms';
  period: 'daily' | 'weekly' | 'monthly';
  creditPercentage?: number;
}

interface SLADataPoint {
  service: string;
  metric: SLATarget['metric'];
  value: number;
  timestamp: number;
}

interface SLAComplianceStatus {
  targetId: string;
  service: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  compliant: boolean;
  compliancePercent: number;
  errorBudgetTotal: number;
  errorBudgetRemaining: number;
  errorBudgetBurnRate: number;
  breached: boolean;
  updatedAt: string;
}

interface SLABreachEvent {
  targetId: string;
  service: string;
  metric: string;
  targetValue: number;
  actualValue: number;
  severity: 'warning' | 'breach';
  timestamp: number;
  creditAmount: number;
}

interface SLAReport {
  period: SLATarget['period'];
  from: number;
  to: number;
  services: SLAServiceReport[];
  overallCompliance: number;
  generatedAt: string;
}

interface SLAServiceReport {
  service: string;
  targets: SLATargetReport[];
  serviceCompliance: number;
}

interface SLATargetReport {
  targetId: string;
  metric: string;
  targetValue: number;
  avgValue: number;
  minValue: number;
  maxValue: number;
  compliant: boolean;
  compliancePercent: number;
  dataPoints: number;
  breachCount: number;
  totalCredit: number;
}

interface SLATrend {
  targetId: string;
  service: string;
  metric: string;
  periods: { periodStart: number; periodEnd: number; avgValue: number; compliant: boolean }[];
  trend: 'improving' | 'stable' | 'degrading';
}

// --- Helpers ---

const MS_PER_DAY = 86_400_000;

function periodMs(period: SLATarget['period']): number {
  switch (period) {
    case 'daily': return MS_PER_DAY;
    case 'weekly': return MS_PER_DAY * 7;
    case 'monthly': return MS_PER_DAY * 30;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Engine ---

class SLAMonitoringEngine {
  private targets = new Map<string, SLATarget>();
  private dataPoints: SLADataPoint[] = [];
  private breaches: SLABreachEvent[] = [];
  private readonly maxDataPoints: number;
  private breachCallbacks: ((breach: SLABreachEvent) => void)[] = [];

  constructor(maxDataPoints = 1_000_000) {
    this.maxDataPoints = maxDataPoints;
    logger.info('SLAMonitoringEngine initialized', { maxDataPoints });
  }

  defineTarget(target: SLATarget): void {
    if (target.targetValue <= 0) {
      throw new Error('Target value must be positive');
    }
    this.targets.set(target.id, target);
    logger.info('SLA target defined', {
      targetId: target.id,
      service: target.service,
      metric: target.metric,
      target: target.targetValue,
    });
  }

  removeTarget(id: string): boolean {
    return this.targets.delete(id);
  }

  getTarget(id: string): SLATarget | undefined {
    return this.targets.get(id);
  }

  listTargets(service?: string): SLATarget[] {
    const all = Array.from(this.targets.values());
    return service ? all.filter((t) => t.service === service) : all;
  }

  onBreach(callback: (breach: SLABreachEvent) => void): void {
    this.breachCallbacks.push(callback);
  }

  recordDataPoint(dp: SLADataPoint): void {
    this.dataPoints.push(dp);
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints = this.dataPoints.slice(this.dataPoints.length - this.maxDataPoints);
    }
    this.evaluateCompliance(dp);
  }

  recordDataPoints(dps: SLADataPoint[]): void {
    for (const dp of dps) this.recordDataPoint(dp);
  }

  private evaluateCompliance(dp: SLADataPoint): void {
    for (const target of this.targets.values()) {
      if (target.service !== dp.service || target.metric !== dp.metric) continue;

      const violated = this.isViolation(target, dp.value);
      if (violated) {
        const severity = this.assessSeverity(target, dp.value);
        const credit = this.calculateCredit(target, dp.value);

        const breach: SLABreachEvent = {
          targetId: target.id,
          service: target.service,
          metric: target.metric,
          targetValue: target.targetValue,
          actualValue: dp.value,
          severity,
          timestamp: dp.timestamp,
          creditAmount: credit,
        };

        this.breaches.push(breach);
        logger.warn('SLA breach detected', {
          targetId: target.id,
          severity,
          target: target.targetValue,
          actual: dp.value,
        });

        for (const cb of this.breachCallbacks) {
          try {
            cb(breach);
          } catch (err) {
            logger.error('Breach callback error', err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
    }
  }

  private isViolation(target: SLATarget, value: number): boolean {
    switch (target.metric) {
      case 'availability':
        return value < target.targetValue;
      case 'latency_p50':
      case 'latency_p95':
      case 'latency_p99':
        return value > target.targetValue;
      case 'error_rate':
        return value > target.targetValue;
      default:
        return false;
    }
  }

  private assessSeverity(target: SLATarget, value: number): 'warning' | 'breach' {
    const diff = Math.abs(value - target.targetValue);
    const threshold = target.targetValue * 0.1;
    return diff > threshold ? 'breach' : 'warning';
  }

  private calculateCredit(target: SLATarget, value: number): number {
    if (!target.creditPercentage) return 0;
    const diff = Math.abs(value - target.targetValue);
    const severity = diff / target.targetValue;
    return parseFloat((target.creditPercentage * Math.min(severity * 10, 1)).toFixed(2));
  }

  getComplianceStatus(targetId: string): SLAComplianceStatus | null {
    const target = this.targets.get(targetId);
    if (!target) return null;

    const now = Date.now();
    const pMs = periodMs(target.period);
    const periodStart = now - pMs;

    const points = this.dataPoints.filter(
      (dp) =>
        dp.service === target.service &&
        dp.metric === target.metric &&
        dp.timestamp >= periodStart,
    );

    if (points.length === 0) {
      return {
        targetId,
        service: target.service,
        metric: target.metric,
        targetValue: target.targetValue,
        currentValue: 0,
        compliant: true,
        compliancePercent: 100,
        errorBudgetTotal: this.calculateErrorBudget(target),
        errorBudgetRemaining: this.calculateErrorBudget(target),
        errorBudgetBurnRate: 0,
        breached: false,
        updatedAt: new Date().toISOString(),
      };
    }

    const values = points.map((p) => p.value);
    const currentValue = parseFloat(avg(values).toFixed(3));
    const compliantPoints = points.filter((p) => !this.isViolation(target, p.value)).length;
    const compliancePercent = parseFloat(((compliantPoints / points.length) * 100).toFixed(2));
    const compliant = !this.isViolation(target, currentValue);

    const errorBudgetTotal = this.calculateErrorBudget(target);
    const violationCount = points.length - compliantPoints;
    const errorBudgetUsed = points.length > 0 ? (violationCount / points.length) * errorBudgetTotal : 0;
    const errorBudgetRemaining = Math.max(0, errorBudgetTotal - errorBudgetUsed);

    const elapsed = now - periodStart;
    const expectedBurn = elapsed > 0 ? (errorBudgetUsed / elapsed) * pMs : 0;
    const burnRate = errorBudgetTotal > 0 ? parseFloat((expectedBurn / errorBudgetTotal).toFixed(3)) : 0;

    const breachCount = this.breaches.filter(
      (b) => b.targetId === targetId && b.timestamp >= periodStart,
    ).length;

    return {
      targetId,
      service: target.service,
      metric: target.metric,
      targetValue: target.targetValue,
      currentValue,
      compliant,
      compliancePercent,
      errorBudgetTotal: parseFloat(errorBudgetTotal.toFixed(3)),
      errorBudgetRemaining: parseFloat(errorBudgetRemaining.toFixed(3)),
      errorBudgetBurnRate: burnRate,
      breached: breachCount > 0,
      updatedAt: new Date().toISOString(),
    };
  }

  private calculateErrorBudget(target: SLATarget): number {
    switch (target.metric) {
      case 'availability':
        return 100 - target.targetValue;
      case 'error_rate':
        return target.targetValue;
      case 'latency_p50':
      case 'latency_p95':
      case 'latency_p99':
        return target.targetValue * 0.2;
      default:
        return 0;
    }
  }

  generateReport(period: SLATarget['period'], from?: number, to?: number): SLAReport {
    const now = Date.now();
    const pMs = periodMs(period);
    const reportFrom = from ?? now - pMs;
    const reportTo = to ?? now;

    const serviceMap = new Map<string, SLATarget[]>();
    for (const target of this.targets.values()) {
      if (target.period !== period) continue;
      if (!serviceMap.has(target.service)) serviceMap.set(target.service, []);
      serviceMap.get(target.service)!.push(target);
    }

    const services: SLAServiceReport[] = [];
    let totalTargets = 0;
    let compliantTargets = 0;

    for (const [service, targets] of serviceMap) {
      const targetReports: SLATargetReport[] = [];

      for (const target of targets) {
        const points = this.dataPoints.filter(
          (dp) =>
            dp.service === target.service &&
            dp.metric === target.metric &&
            dp.timestamp >= reportFrom &&
            dp.timestamp <= reportTo,
        );

        const values = points.map((p) => p.value);
        const avgVal = avg(values);
        const minVal = values.length > 0 ? Math.min(...values) : 0;
        const maxVal = values.length > 0 ? Math.max(...values) : 0;
        const compliantCount = points.filter((p) => !this.isViolation(target, p.value)).length;
        const compliancePercent = points.length > 0
          ? parseFloat(((compliantCount / points.length) * 100).toFixed(2))
          : 100;
        const compliant = compliancePercent >= 100 * (target.targetValue / 100);

        const targetBreaches = this.breaches.filter(
          (b) => b.targetId === target.id && b.timestamp >= reportFrom && b.timestamp <= reportTo,
        );

        totalTargets++;
        if (compliancePercent >= 99) compliantTargets++;

        targetReports.push({
          targetId: target.id,
          metric: target.metric,
          targetValue: target.targetValue,
          avgValue: parseFloat(avgVal.toFixed(3)),
          minValue: parseFloat(minVal.toFixed(3)),
          maxValue: parseFloat(maxVal.toFixed(3)),
          compliant,
          compliancePercent,
          dataPoints: points.length,
          breachCount: targetBreaches.length,
          totalCredit: parseFloat(
            targetBreaches.reduce((s, b) => s + b.creditAmount, 0).toFixed(2),
          ),
        });
      }

      const svcCompliance = targetReports.length > 0
        ? parseFloat(
            (targetReports.reduce((s, t) => s + t.compliancePercent, 0) / targetReports.length).toFixed(2),
          )
        : 100;

      services.push({
        service,
        targets: targetReports,
        serviceCompliance: svcCompliance,
      });
    }

    return {
      period,
      from: reportFrom,
      to: reportTo,
      services,
      overallCompliance: totalTargets > 0
        ? parseFloat(((compliantTargets / totalTargets) * 100).toFixed(2))
        : 100,
      generatedAt: new Date().toISOString(),
    };
  }

  getAggregatedCompliance(services?: string[]): { service: string; compliance: number }[] {
    const allServices = new Set<string>();
    for (const t of this.targets.values()) allServices.add(t.service);

    const result: { service: string; compliance: number }[] = [];
    for (const service of allServices) {
      if (services && !services.includes(service)) continue;
      const targets = this.listTargets(service);
      const statuses = targets
        .map((t) => this.getComplianceStatus(t.id))
        .filter((s): s is SLAComplianceStatus => s !== null);

      const compliance = statuses.length > 0
        ? parseFloat(
            (statuses.reduce((s, st) => s + st.compliancePercent, 0) / statuses.length).toFixed(2),
          )
        : 100;

      result.push({ service, compliance });
    }

    return result.sort((a, b) => a.compliance - b.compliance);
  }

  getTotalCredits(from?: number, to?: number): { service: string; totalCredit: number }[] {
    const serviceCredits = new Map<string, number>();
    for (const b of this.breaches) {
      if (from && b.timestamp < from) continue;
      if (to && b.timestamp > to) continue;
      serviceCredits.set(b.service, (serviceCredits.get(b.service) ?? 0) + b.creditAmount);
    }
    return Array.from(serviceCredits.entries())
      .map(([service, totalCredit]) => ({ service, totalCredit: parseFloat(totalCredit.toFixed(2)) }))
      .sort((a, b) => b.totalCredit - a.totalCredit);
  }

  trendAnalysis(targetId: string, periodCount = 6): SLATrend | null {
    const target = this.targets.get(targetId);
    if (!target) return null;

    const pMs = periodMs(target.period);
    const now = Date.now();
    const periods: SLATrend['periods'] = [];

    for (let i = periodCount - 1; i >= 0; i--) {
      const periodEnd = now - i * pMs;
      const periodStart = periodEnd - pMs;

      const points = this.dataPoints.filter(
        (dp) =>
          dp.service === target.service &&
          dp.metric === target.metric &&
          dp.timestamp >= periodStart &&
          dp.timestamp < periodEnd,
      );

      const avgValue = points.length > 0 ? parseFloat(avg(points.map((p) => p.value)).toFixed(3)) : 0;
      const compliant = points.length > 0 ? !this.isViolation(target, avgValue) : true;

      periods.push({ periodStart, periodEnd, avgValue, compliant });
    }

    // Determine trend direction from the last 3 valid periods
    const validPeriods = periods.filter((p) => p.avgValue > 0);
    let trend: SLATrend['trend'] = 'stable';
    if (validPeriods.length >= 3) {
      const recent = validPeriods.slice(-3);
      const isUpward = recent[2].avgValue > recent[0].avgValue;
      const delta = Math.abs(recent[2].avgValue - recent[0].avgValue);
      const threshold = recent[0].avgValue * 0.05;

      if (delta > threshold) {
        if (target.metric === 'availability') {
          trend = isUpward ? 'improving' : 'degrading';
        } else {
          trend = isUpward ? 'degrading' : 'improving';
        }
      }
    }

    return { targetId, service: target.service, metric: target.metric, periods, trend };
  }

  getBreaches(targetId?: string, since?: number): SLABreachEvent[] {
    return this.breaches.filter((b) => {
      if (targetId && b.targetId !== targetId) return false;
      if (since && b.timestamp < since) return false;
      return true;
    });
  }

  clearData(): void {
    this.dataPoints = [];
    this.breaches = [];
    logger.info('SLA data cleared');
  }
}

// --- Singleton ---

const GLOBAL_KEY = '__slaMonitoringEngine__';

export function getSLAMonitoringEngine(): SLAMonitoringEngine {
  const g = globalThis as unknown as Record<string, SLAMonitoringEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SLAMonitoringEngine();
  }
  return g[GLOBAL_KEY];
}

export type {
  SLATarget,
  SLADataPoint,
  SLAComplianceStatus,
  SLABreachEvent,
  SLAReport,
  SLAServiceReport,
  SLATargetReport,
  SLATrend,
};
