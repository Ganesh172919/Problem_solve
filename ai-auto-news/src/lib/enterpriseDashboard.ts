import { getLogger } from './logger';
import { getCache } from './cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KPIDefinition {
  id: string;
  name: string;
  unit: string;
  category: 'revenue' | 'usage' | 'support' | 'engineering' | 'sales' | 'hr' | 'custom';
  target?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  higherIsBetter: boolean;
}

export interface KPIValue {
  kpiId: string;
  value: number;
  previousValue: number;
  changePercent: number;
  status: 'healthy' | 'warning' | 'critical';
  timestamp: string;
}

export interface ExecutiveSummary {
  period: string;
  generatedAt: string;
  highlights: string[];
  concerns: string[];
  kpis: KPIValue[];
  revenueSnapshot: RevenueSnapshot;
  headcountSnapshot: HeadcountSnapshot;
  topDepartmentMetrics: DepartmentMetric[];
}

export interface RevenueSnapshot {
  mrr: number;
  arr: number;
  mrrGrowthPercent: number;
  newRevenue: number;
  churnedRevenue: number;
  expansionRevenue: number;
  netRevenueRetention: number;
  budgetUtilization: number;
}

export interface HeadcountSnapshot {
  total: number;
  byDepartment: Record<string, number>;
  openPositions: number;
  attritionRate: number;
  newHires: number;
}

export interface DepartmentMetric {
  department: string;
  headcount: number;
  budgetUtilized: number;
  budgetTotal: number;
  keyMetric: string;
  keyMetricValue: number;
  keyMetricUnit: string;
}

export interface BudgetTracker {
  department: string;
  budgetTotal: number;
  budgetSpent: number;
  budgetRemaining: number;
  utilizationPercent: number;
  forecastedOverrun: number;
  lastUpdated: string;
}

export interface UsageHeatmapCell {
  feature: string;
  segment: string;
  usageCount: number;
  uniqueUsers: number;
  adoptionRate: number;
  trend: 'up' | 'down' | 'stable';
}

export interface SupportTicketTrend {
  period: string;
  opened: number;
  closed: number;
  avgResolutionHours: number;
  p90ResolutionHours: number;
  backlog: number;
  satisfactionScore: number;
  topCategories: Array<{ category: string; count: number }>;
}

export interface EngineeringVelocity {
  period: string;
  storyPointsCompleted: number;
  storyPointsPlanned: number;
  velocityTrend: number;
  deployments: number;
  bugCount: number;
  bugFixRate: number;
  codeReviewTurnaroundHours: number;
  testCoverage: number;
  uptimePercent: number;
}

export interface SalesFunnel {
  period: string;
  leads: number;
  mql: number;
  sql: number;
  opportunities: number;
  closedWon: number;
  closedLost: number;
  winRate: number;
  avgDealSizeUsd: number;
  salesCycleDays: number;
  pipelineValueUsd: number;
}

export interface CustomerSuccessMetrics {
  period: string;
  nps: number;
  csat: number;
  ces: number;
  healthScore: number;
  atRiskCount: number;
  churnedCount: number;
  expansions: number;
  qbrsConducted: number;
  adoptionRate: number;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'kpi' | 'chart' | 'table' | 'text' | 'heatmap';
  size: 'small' | 'medium' | 'large' | 'full';
  data: unknown;
  refreshIntervalSeconds: number;
  lastRefreshed: string;
}

export interface DashboardConfig {
  id: string;
  name: string;
  audience: 'executive' | 'department' | 'engineering' | 'sales' | 'support';
  widgets: DashboardWidget[];
  refreshIntervalSeconds: number;
  scheduledReports: ScheduledReport[];
}

export interface ScheduledReport {
  id: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  recipients: string[];
  format: 'pdf' | 'csv' | 'json';
  sections: string[];
  lastSentAt?: string;
  nextSendAt: string;
}

export interface FullDashboardData {
  config: DashboardConfig;
  executiveSummary: ExecutiveSummary;
  budgetTrackers: BudgetTracker[];
  usageHeatmap: UsageHeatmapCell[];
  supportTrends: SupportTicketTrend[];
  engineeringVelocity: EngineeringVelocity;
  salesFunnel: SalesFunnel;
  customerSuccess: CustomerSuccessMetrics;
  generatedAt: string;
  dataFreshnessSeconds: number;
}

// ─── Defaults & Helpers ───────────────────────────────────────────────────────

const DEFAULT_KPIS: KPIDefinition[] = [
  { id: 'mrr', name: 'Monthly Recurring Revenue', unit: 'USD', category: 'revenue', higherIsBetter: true, warningThreshold: -5, criticalThreshold: -15 },
  { id: 'nrr', name: 'Net Revenue Retention', unit: '%', category: 'revenue', target: 110, higherIsBetter: true, warningThreshold: 95, criticalThreshold: 85 },
  { id: 'csat', name: 'Customer Satisfaction', unit: '%', category: 'support', target: 90, higherIsBetter: true, warningThreshold: 80, criticalThreshold: 70 },
  { id: 'nps', name: 'Net Promoter Score', unit: 'points', category: 'support', target: 50, higherIsBetter: true, warningThreshold: 30, criticalThreshold: 10 },
  { id: 'dau', name: 'Daily Active Users', unit: 'users', category: 'usage', higherIsBetter: true },
  { id: 'uptime', name: 'Platform Uptime', unit: '%', category: 'engineering', target: 99.9, higherIsBetter: true, warningThreshold: 99.5, criticalThreshold: 99.0 },
  { id: 'churn', name: 'Churn Rate', unit: '%', category: 'revenue', higherIsBetter: false, warningThreshold: 3, criticalThreshold: 6 },
  { id: 'cac', name: 'Customer Acquisition Cost', unit: 'USD', category: 'sales', higherIsBetter: false },
];

function computeKPIStatus(kpi: KPIDefinition, value: number): KPIValue['status'] {
  const changeIsPositive = kpi.higherIsBetter ? value > 0 : value < 0;
  if (kpi.criticalThreshold !== undefined) {
    const over = kpi.higherIsBetter ? value < kpi.criticalThreshold : value > kpi.criticalThreshold;
    if (over) return 'critical';
  }
  if (kpi.warningThreshold !== undefined) {
    const over = kpi.higherIsBetter ? value < kpi.warningThreshold : value > kpi.warningThreshold;
    if (over) return 'warning';
  }
  return changeIsPositive || kpi.warningThreshold === undefined ? 'healthy' : 'warning';
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextReportDate(frequency: ScheduledReport['frequency']): string {
  const d = new Date();
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
  }
  return d.toISOString();
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class EnterpriseDashboard {
  private readonly logger = getLogger();
  private readonly cache = getCache();
  private kpiRegistry: Map<string, KPIDefinition> = new Map(DEFAULT_KPIS.map(k => [k.id, k]));
  private dashboardConfigs: Map<string, DashboardConfig> = new Map();

  // ── KPI Registry ─────────────────────────────────────────────────────────────

  registerKPI(kpi: KPIDefinition): void {
    this.kpiRegistry.set(kpi.id, kpi);
    this.logger.info('EnterpriseDashboard: registered KPI', { id: kpi.id, name: kpi.name });
  }

  getKPIDefinition(id: string): KPIDefinition | undefined {
    return this.kpiRegistry.get(id);
  }

  listKPIs(): KPIDefinition[] {
    return [...this.kpiRegistry.values()];
  }

  // ── Real-time KPI Aggregation ─────────────────────────────────────────────────

  aggregateKPIs(rawData: Record<string, { current: number; previous: number }>): KPIValue[] {
    const results: KPIValue[] = [];
    for (const [kpiId, { current, previous }] of Object.entries(rawData)) {
      const kpi = this.kpiRegistry.get(kpiId);
      if (!kpi) continue;
      const changePercent = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0;
      results.push({
        kpiId,
        value: current,
        previousValue: previous,
        changePercent: Math.round(changePercent * 100) / 100,
        status: computeKPIStatus(kpi, kpi.higherIsBetter ? current : changePercent),
        timestamp: new Date().toISOString(),
      });
    }
    this.logger.info('EnterpriseDashboard: aggregated KPIs', { count: results.length });
    return results;
  }

  // ── Executive Summary ─────────────────────────────────────────────────────────

  generateExecutiveSummary(
    kpis: KPIValue[],
    revenue: RevenueSnapshot,
    headcount: HeadcountSnapshot,
    departments: DepartmentMetric[],
  ): ExecutiveSummary {
    const cacheKey = `exec-summary:${currentPeriod()}`;
    const cached = this.cache.get<ExecutiveSummary>(cacheKey);
    if (cached) return cached;

    const highlights: string[] = [];
    const concerns: string[] = [];

    // Revenue highlights
    if (revenue.mrrGrowthPercent > 0) {
      highlights.push(`MRR grew ${revenue.mrrGrowthPercent.toFixed(1)}% this period to $${(revenue.mrr / 1000).toFixed(0)}K`);
    }
    if (revenue.netRevenueRetention >= 110) {
      highlights.push(`Net Revenue Retention is ${revenue.netRevenueRetention}% — strong expansion`);
    }
    if (revenue.netRevenueRetention < 95) {
      concerns.push(`Net Revenue Retention dropped to ${revenue.netRevenueRetention}% — churn risk`);
    }

    // KPI-based highlights/concerns
    for (const kpi of kpis) {
      const def = this.kpiRegistry.get(kpi.kpiId);
      if (!def) continue;
      if (kpi.status === 'critical') {
        concerns.push(`${def.name} is at critical level: ${kpi.value}${def.unit}`);
      } else if (kpi.changePercent > 10 && def.higherIsBetter) {
        highlights.push(`${def.name} improved ${kpi.changePercent.toFixed(1)}% vs prior period`);
      }
    }

    // Headcount
    if (headcount.attritionRate > 15) {
      concerns.push(`Attrition rate at ${headcount.attritionRate.toFixed(1)}% — exceeds healthy threshold`);
    }
    if (headcount.openPositions > 20) {
      concerns.push(`${headcount.openPositions} open positions may impact delivery capacity`);
    }

    const summary: ExecutiveSummary = {
      period: currentPeriod(),
      generatedAt: new Date().toISOString(),
      highlights: highlights.slice(0, 5),
      concerns: concerns.slice(0, 5),
      kpis,
      revenueSnapshot: revenue,
      headcountSnapshot: headcount,
      topDepartmentMetrics: departments.slice(0, 6),
    };

    this.cache.set(cacheKey, summary, 300);
    this.logger.info('EnterpriseDashboard: generated executive summary', { period: summary.period, highlights: highlights.length, concerns: concerns.length });
    return summary;
  }

  // ── Budget vs Actual Tracking ─────────────────────────────────────────────────

  trackBudgets(
    departments: Array<{ department: string; budgetTotal: number; budgetSpent: number }>,
  ): BudgetTracker[] {
    return departments.map(d => {
      const remaining = d.budgetTotal - d.budgetSpent;
      const utilization = d.budgetTotal > 0 ? (d.budgetSpent / d.budgetTotal) * 100 : 0;
      // Simple forecast: extrapolate based on current month progress
      const dayOfMonth = new Date().getDate();
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const monthProgress = dayOfMonth / daysInMonth;
      const projectedSpend = monthProgress > 0 ? d.budgetSpent / monthProgress : d.budgetSpent;
      const forecastedOverrun = Math.max(0, projectedSpend - d.budgetTotal);

      return {
        department: d.department,
        budgetTotal: d.budgetTotal,
        budgetSpent: d.budgetSpent,
        budgetRemaining: remaining,
        utilizationPercent: Math.round(utilization * 10) / 10,
        forecastedOverrun: Math.round(forecastedOverrun),
        lastUpdated: new Date().toISOString(),
      };
    });
  }

  // ── Usage Heatmap ─────────────────────────────────────────────────────────────

  buildUsageHeatmap(
    events: Array<{ feature: string; segment: string; userId: string; count: number }>,
    totalUsersBySegment: Record<string, number>,
  ): UsageHeatmapCell[] {
    const map = new Map<string, { count: number; users: Set<string> }>();

    for (const e of events) {
      const key = `${e.feature}:${e.segment}`;
      const entry = map.get(key) ?? { count: 0, users: new Set() };
      entry.count += e.count;
      entry.users.add(e.userId);
      map.set(key, entry);
    }

    const cells: UsageHeatmapCell[] = [];
    for (const [key, data] of map.entries()) {
      const [feature, segment] = key.split(':');
      const total = totalUsersBySegment[segment] ?? 1;
      const adoptionRate = Math.min(1, data.users.size / total);
      cells.push({
        feature,
        segment,
        usageCount: data.count,
        uniqueUsers: data.users.size,
        adoptionRate: Math.round(adoptionRate * 1000) / 1000,
        trend: adoptionRate > 0.7 ? 'up' : adoptionRate < 0.3 ? 'down' : 'stable',
      });
    }

    return cells.sort((a, b) => b.usageCount - a.usageCount);
  }

  // ── Support Ticket Trends ─────────────────────────────────────────────────────

  analyzeSupportTrends(
    tickets: Array<{
      openedAt: string;
      closedAt?: string;
      resolutionHours?: number;
      category: string;
      satisfactionScore?: number;
    }>,
    period: string,
  ): SupportTicketTrend {
    const opened = tickets.length;
    const closedTickets = tickets.filter(t => t.closedAt);
    const closed = closedTickets.length;
    const resolutionTimes = closedTickets.map(t => t.resolutionHours ?? 24).sort((a, b) => a - b);

    const avgResolution = resolutionTimes.length > 0
      ? resolutionTimes.reduce((s, v) => s + v, 0) / resolutionTimes.length
      : 0;
    const p90Index = Math.floor(resolutionTimes.length * 0.9);
    const p90Resolution = resolutionTimes[p90Index] ?? avgResolution;

    const satisfactionScores = tickets.filter(t => t.satisfactionScore !== undefined).map(t => t.satisfactionScore!);
    const avgSatisfaction = satisfactionScores.length > 0
      ? satisfactionScores.reduce((s, v) => s + v, 0) / satisfactionScores.length
      : 0;

    const categoryMap = new Map<string, number>();
    tickets.forEach(t => categoryMap.set(t.category, (categoryMap.get(t.category) ?? 0) + 1));
    const topCategories = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      period,
      opened,
      closed,
      avgResolutionHours: Math.round(avgResolution * 10) / 10,
      p90ResolutionHours: Math.round(p90Resolution * 10) / 10,
      backlog: opened - closed,
      satisfactionScore: Math.round(avgSatisfaction * 10) / 10,
      topCategories,
    };
  }

  // ── Engineering Velocity ──────────────────────────────────────────────────────

  computeEngineeringVelocity(data: {
    period: string;
    storyPointsCompleted: number;
    storyPointsPlanned: number;
    previousVelocity: number;
    deployments: number;
    bugsOpened: number;
    bugsClosed: number;
    reviewTurnaroundHours: number;
    testCoverage: number;
    uptimePercent: number;
  }): EngineeringVelocity {
    const velocityTrend = data.previousVelocity > 0
      ? ((data.storyPointsCompleted - data.previousVelocity) / data.previousVelocity) * 100
      : 0;
    const bugFixRate = data.bugsOpened > 0 ? data.bugsClosed / data.bugsOpened : 1;

    return {
      period: data.period,
      storyPointsCompleted: data.storyPointsCompleted,
      storyPointsPlanned: data.storyPointsPlanned,
      velocityTrend: Math.round(velocityTrend * 10) / 10,
      deployments: data.deployments,
      bugCount: data.bugsOpened,
      bugFixRate: Math.round(bugFixRate * 100) / 100,
      codeReviewTurnaroundHours: data.reviewTurnaroundHours,
      testCoverage: data.testCoverage,
      uptimePercent: data.uptimePercent,
    };
  }

  // ── Sales Funnel ──────────────────────────────────────────────────────────────

  computeSalesFunnel(data: {
    period: string;
    leads: number;
    mql: number;
    sql: number;
    opportunities: number;
    closedWon: number;
    closedLost: number;
    totalRevenueWon: number;
    avgSalesCycleDays: number;
  }): SalesFunnel {
    const totalClosed = data.closedWon + data.closedLost;
    const winRate = totalClosed > 0 ? (data.closedWon / totalClosed) * 100 : 0;
    const avgDealSize = data.closedWon > 0 ? data.totalRevenueWon / data.closedWon : 0;
    const pipelineValue = data.opportunities * avgDealSize * (winRate / 100);

    return {
      period: data.period,
      leads: data.leads,
      mql: data.mql,
      sql: data.sql,
      opportunities: data.opportunities,
      closedWon: data.closedWon,
      closedLost: data.closedLost,
      winRate: Math.round(winRate * 10) / 10,
      avgDealSizeUsd: Math.round(avgDealSize),
      salesCycleDays: data.avgSalesCycleDays,
      pipelineValueUsd: Math.round(pipelineValue),
    };
  }

  // ── Customer Success Rollup ───────────────────────────────────────────────────

  rollupCustomerSuccess(data: {
    period: string;
    npsResponses: number[];
    csatScores: number[];
    cesScores: number[];
    healthScores: number[];
    atRiskCount: number;
    churnedCount: number;
    expansions: number;
    qbrsConducted: number;
    activeUsers: number;
    totalUsers: number;
  }): CustomerSuccessMetrics {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const promoters = data.npsResponses.filter(s => s >= 9).length;
    const detractors = data.npsResponses.filter(s => s <= 6).length;
    const nps = data.npsResponses.length > 0
      ? ((promoters - detractors) / data.npsResponses.length) * 100
      : 0;

    return {
      period: data.period,
      nps: Math.round(nps),
      csat: Math.round(avg(data.csatScores) * 10) / 10,
      ces: Math.round(avg(data.cesScores) * 10) / 10,
      healthScore: Math.round(avg(data.healthScores) * 10) / 10,
      atRiskCount: data.atRiskCount,
      churnedCount: data.churnedCount,
      expansions: data.expansions,
      qbrsConducted: data.qbrsConducted,
      adoptionRate: data.totalUsers > 0
        ? Math.round((data.activeUsers / data.totalUsers) * 1000) / 10
        : 0,
    };
  }

  // ── Widget System ─────────────────────────────────────────────────────────────

  createWidget(params: Omit<DashboardWidget, 'lastRefreshed'>): DashboardWidget {
    return { ...params, lastRefreshed: new Date().toISOString() };
  }

  registerDashboard(config: DashboardConfig): void {
    this.dashboardConfigs.set(config.id, config);
    this.logger.info('EnterpriseDashboard: registered dashboard', { id: config.id, audience: config.audience });
  }

  getDashboardConfig(id: string): DashboardConfig | undefined {
    return this.dashboardConfigs.get(id);
  }

  // ── Scheduled Report Management ───────────────────────────────────────────────

  scheduleReport(dashboardId: string, report: Omit<ScheduledReport, 'nextSendAt'>): ScheduledReport {
    const dashboard = this.dashboardConfigs.get(dashboardId);
    if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);

    const scheduled: ScheduledReport = { ...report, nextSendAt: nextReportDate(report.frequency) };
    dashboard.scheduledReports.push(scheduled);
    this.logger.info('EnterpriseDashboard: scheduled report', { dashboardId, reportId: report.id, frequency: report.frequency, nextSendAt: scheduled.nextSendAt });
    return scheduled;
  }

  getDueReports(): Array<{ dashboardId: string; report: ScheduledReport }> {
    const now = new Date();
    const due: Array<{ dashboardId: string; report: ScheduledReport }> = [];
    for (const [dashboardId, config] of this.dashboardConfigs.entries()) {
      for (const report of config.scheduledReports) {
        if (new Date(report.nextSendAt) <= now) {
          due.push({ dashboardId, report });
        }
      }
    }
    return due;
  }

  markReportSent(dashboardId: string, reportId: string): void {
    const dashboard = this.dashboardConfigs.get(dashboardId);
    if (!dashboard) return;
    const report = dashboard.scheduledReports.find(r => r.id === reportId);
    if (!report) return;
    report.lastSentAt = new Date().toISOString();
    report.nextSendAt = nextReportDate(report.frequency);
    this.logger.info('EnterpriseDashboard: report sent', { dashboardId, reportId, nextSendAt: report.nextSendAt });
  }

  // ── Full Dashboard Snapshot ───────────────────────────────────────────────────

  async buildFullDashboard(
    dashboardId: string,
    inputs: {
      kpiData: Record<string, { current: number; previous: number }>;
      revenue: RevenueSnapshot;
      headcount: HeadcountSnapshot;
      departments: DepartmentMetric[];
      budgets: Array<{ department: string; budgetTotal: number; budgetSpent: number }>;
      usageEvents: Array<{ feature: string; segment: string; userId: string; count: number }>;
      usersBySegment: Record<string, number>;
      supportTickets: Array<{ openedAt: string; closedAt?: string; resolutionHours?: number; category: string; satisfactionScore?: number }>;
      engineeringData: Parameters<EnterpriseDashboard['computeEngineeringVelocity']>[0];
      salesData: Parameters<EnterpriseDashboard['computeSalesFunnel']>[0];
      customerSuccessData: Parameters<EnterpriseDashboard['rollupCustomerSuccess']>[0];
    },
  ): Promise<FullDashboardData> {
    const config = this.dashboardConfigs.get(dashboardId);
    if (!config) throw new Error(`Dashboard ${dashboardId} not found`);

    const cacheKey = `full-dashboard:${dashboardId}:${currentPeriod()}`;
    const cached = this.cache.get<FullDashboardData>(cacheKey);
    if (cached) {
      const ageSeconds = (Date.now() - new Date(cached.generatedAt).getTime()) / 1000;
      if (ageSeconds < config.refreshIntervalSeconds) return cached;
    }

    const kpis = this.aggregateKPIs(inputs.kpiData);
    const executiveSummary = this.generateExecutiveSummary(kpis, inputs.revenue, inputs.headcount, inputs.departments);
    const budgetTrackers = this.trackBudgets(inputs.budgets);
    const usageHeatmap = this.buildUsageHeatmap(inputs.usageEvents, inputs.usersBySegment);
    const supportTrends = this.analyzeSupportTrends(inputs.supportTickets, currentPeriod());
    const engineeringVelocity = this.computeEngineeringVelocity(inputs.engineeringData);
    const salesFunnel = this.computeSalesFunnel(inputs.salesData);
    const customerSuccess = this.rollupCustomerSuccess(inputs.customerSuccessData);

    const result: FullDashboardData = {
      config,
      executiveSummary,
      budgetTrackers,
      usageHeatmap,
      supportTrends: [supportTrends],
      engineeringVelocity,
      salesFunnel,
      customerSuccess,
      generatedAt: new Date().toISOString(),
      dataFreshnessSeconds: 0,
    };

    this.cache.set(cacheKey, result, config.refreshIntervalSeconds);
    this.logger.info('EnterpriseDashboard: built full dashboard', { dashboardId, generatedAt: result.generatedAt });
    return result;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getEnterpriseDashboard(): EnterpriseDashboard {
  if (!globalThis.__enterpriseDashboard__) {
    globalThis.__enterpriseDashboard__ = new EnterpriseDashboard();
  }
  return globalThis.__enterpriseDashboard__ as EnterpriseDashboard;
}
