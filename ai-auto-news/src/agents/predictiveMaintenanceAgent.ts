/**
 * Predictive Maintenance Agent
 *
 * Intelligent predictive maintenance agent that:
 * - Monitors infrastructure and service health metrics
 * - Resource usage forecasting (CPU, memory, disk, network trends)
 * - Failure prediction using threshold + trend analysis
 * - Automated remediation suggestions with confidence scores
 * - Maintenance window optimization (low-traffic periods)
 * - SLA protection: alerts when SLA at risk
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';
import getPredictiveAnalyticsEngine from '../lib/predictiveAnalyticsEngine';

const logger = getLogger();
const cache = getCache();

// ── Interfaces ────────────────────────────────────────────────────────────────

export type MetricName = 'cpu_usage' | 'memory_usage' | 'disk_usage' | 'network_in' | 'network_out' |
  'request_latency_p99' | 'error_rate' | 'db_connections' | 'cache_hit_rate' | 'queue_depth' |
  'gc_pause_ms' | 'fd_count' | 'thread_count' | 'heap_used_mb';

export type ServiceTier = 'critical' | 'high' | 'medium' | 'low';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical' | 'emergency';
export type RemediationType = 'scale_out' | 'scale_up' | 'restart_service' | 'clear_cache' | 'kill_process' |
  'rotate_logs' | 'increase_connection_pool' | 'optimize_query' | 'reduce_batch_size' | 'manual_review';

export interface ServiceMetric {
  serviceId: string;
  serviceName: string;
  metricName: MetricName;
  value: number;
  unit: string;
  timestamp: Date;
  labels: Record<string, string>;
  healthy: boolean;
  threshold: { warning: number; critical: number };
}

export interface MaintenanceWindow {
  id: string;
  serviceId: string;
  serviceName: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  durationMinutes: number;
  reason: string;
  type: 'planned' | 'emergency' | 'rolling';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  affectedComponents: string[];
  estimatedImpact: 'none' | 'minimal' | 'moderate' | 'significant';
  notificationsSent: boolean;
  actualStart?: Date;
  actualEnd?: Date;
  notes?: string;
}

export interface FailurePrediction {
  id: string;
  serviceId: string;
  serviceName: string;
  metricName: MetricName;
  currentValue: number;
  projectedValue: number;
  threshold: number;
  confidence: number;           // 0-1
  estimatedTimeToFailure: number; // minutes
  trend: 'stable' | 'increasing' | 'decreasing' | 'volatile';
  trendSlope: number;           // units per minute
  severity: AlertSeverity;
  predictedAt: Date;
  estimatedFailureAt: Date;
  contributingFactors: string[];
  historicalSimilarEvents: number;
}

export interface RemediationSuggestion {
  id: string;
  predictionId: string;
  serviceId: string;
  type: RemediationType;
  title: string;
  description: string;
  confidence: number;           // 0-1
  estimatedResolutionTimeMin: number;
  estimatedImpact: string;
  riskLevel: 'low' | 'medium' | 'high';
  autoExecutable: boolean;
  prerequisiteChecks: string[];
  steps: string[];
  rollbackPlan: string;
  priority: number;             // 0-100
  createdAt: Date;
  executedAt?: Date;
  outcome?: 'success' | 'failed' | 'partial';
}

export interface SLAAlert {
  id: string;
  serviceId: string;
  serviceName: string;
  slaType: 'availability' | 'latency' | 'error_rate' | 'throughput';
  slaTarget: number;            // e.g. 99.9 for 99.9% availability
  currentValue: number;
  projectedValue: number;       // end-of-period projected
  breach: boolean;
  breachRisk: number;           // 0-1 probability of breach before period end
  remainingBudgetMinutes?: number; // for availability
  period: { start: Date; end: Date };
  severity: AlertSeverity;
  recommendations: string[];
  triggeredAt: Date;
}

export interface MaintenanceReport {
  agentId: string;
  reportId: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  servicesMonitored: number;
  metricsCollected: number;
  predictionsGenerated: number;
  criticalPredictions: number;
  remediationsSuggested: number;
  remediationsExecuted: number;
  maintenanceWindowsScheduled: number;
  slaAlertsTriggered: number;
  slaBreachesPrevented: number;
  overallHealthScore: number;   // 0-100
  serviceHealthSummary: Array<{
    serviceId: string;
    serviceName: string;
    healthScore: number;
    status: 'healthy' | 'degraded' | 'critical' | 'unknown';
    openPredictions: number;
  }>;
  topFailureRisks: FailurePrediction[];
  scheduledWindows: MaintenanceWindow[];
  slaAlerts: SLAAlert[];
}

// ── Internal state ────────────────────────────────────────────────────────────

interface ServiceDefinition {
  id: string;
  name: string;
  tier: ServiceTier;
  slaTargets: { availability: number; latencyP99Ms: number; errorRate: number };
  thresholds: Partial<Record<MetricName, { warning: number; critical: number }>>;
  components: string[];
  dependsOn: string[];
}

interface MetricWindow {
  values: number[];
  timestamps: Date[];
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class PredictiveMaintenanceAgent {
  private readonly agentId = 'predictive-maintenance-agent';
  private analytics = getPredictiveAnalyticsEngine();
  private services = new Map<string, ServiceDefinition>();
  private metricWindows = new Map<string, MetricWindow>();    // `${serviceId}:${metricName}` -> window
  private predictions = new Map<string, FailurePrediction>(); // predictionId -> prediction
  private windows = new Map<string, MaintenanceWindow>();
  private slaAlerts = new Map<string, SLAAlert>();
  private remediations = new Map<string, RemediationSuggestion>();
  private uptimeStore = new Map<string, { totalMinutes: number; downMinutes: number }>();
  private isRunning = false;
  private startedAt = new Date();
  private totalReports = 0;

  private readonly WINDOW_SIZE = 60;         // keep last 60 data points per metric
  private readonly TREND_MIN_POINTS = 5;
  private readonly LOW_TRAFFIC_HOURS = [1, 2, 3, 4, 5];  // UTC hours

  constructor() {
    this.seedServices();
    logger.info('PredictiveMaintenanceAgent initialized', { agentId: this.agentId });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Run a full maintenance cycle: collect → forecast → predict → remediate → optimize → SLA check → report. */
  async run(): Promise<MaintenanceReport> {
    if (this.isRunning) {
      logger.warn('PredictiveMaintenanceAgent already running, skipping cycle', { agentId: this.agentId });
      return this.emptyReport();
    }

    this.isRunning = true;
    const cycleStart = new Date();
    const reportId = `maint_${Date.now()}`;

    logger.info('Predictive maintenance cycle started', { reportId });

    // 1. Collect fresh metrics
    const allMetrics = await this.collectMetrics();

    // 2. Forecast resource usage
    const forecasts = await this.forecastResources();

    // 3. Predict failures
    const newPredictions = await this.predictFailures(allMetrics);
    for (const p of newPredictions) this.predictions.set(p.id, p);

    // 4. Suggest remediation
    const suggestions: RemediationSuggestion[] = [];
    for (const pred of newPredictions) {
      const rems = await this.suggestRemediation(pred);
      for (const r of rems) {
        this.remediations.set(r.id, r);
        suggestions.push(r);
      }
    }

    // 5. Optimize maintenance windows
    const scheduledWindows = await this.optimizeMaintenanceWindows(newPredictions);

    // 6. Check SLA health
    const slaAlerts = await this.checkSLA();

    // 7. Generate report
    const report = await this.generateMaintenanceReport({
      reportId, cycleStart, allMetrics,
      predictions: newPredictions,
      suggestions, scheduledWindows, slaAlerts,
    });

    this.isRunning = false;
    this.totalReports++;

    logger.info('Predictive maintenance cycle completed', {
      reportId,
      durationMs: Date.now() - cycleStart.getTime(),
      predictions: newPredictions.length,
      criticals: newPredictions.filter(p => p.severity === 'critical' || p.severity === 'emergency').length,
      slaAlerts: slaAlerts.length,
    });

    return report;
  }

  /** Collect current metrics from all monitored services. */
  async collectMetrics(): Promise<ServiceMetric[]> {
    const collected: ServiceMetric[] = [];

    for (const svc of this.services.values()) {
      const metricsToCollect: MetricName[] = [
        'cpu_usage', 'memory_usage', 'disk_usage', 'network_in', 'network_out',
        'request_latency_p99', 'error_rate', 'db_connections', 'cache_hit_rate', 'queue_depth',
      ];

      for (const metricName of metricsToCollect) {
        const thresholds = svc.thresholds[metricName] ?? this.defaultThresholds(metricName);
        const value = this.simulateMetric(svc.id, metricName);
        const metric: ServiceMetric = {
          serviceId: svc.id,
          serviceName: svc.name,
          metricName,
          value,
          unit: this.metricUnit(metricName),
          timestamp: new Date(),
          labels: { tier: svc.tier, service: svc.name },
          healthy: value <= thresholds.warning,
          threshold: thresholds,
        };

        collected.push(metric);
        this.recordMetricPoint(svc.id, metricName, value);

        // Feed into predictive analytics engine
        this.analytics.recordMetricPoint(`${svc.id}:${metricName}`, value);

        // Update uptime tracking
        this.trackUptime(svc.id, metric.healthy);
      }
    }

    logger.info('Metrics collected', { count: collected.length, services: this.services.size });
    return collected;
  }

  /** Forecast resource usage for each service using trend analysis. */
  async forecastResources(): Promise<Map<string, { metric: MetricName; forecast: number[]; trend: string }[]>> {
    const cacheKey = `maint:forecasts:${Math.floor(Date.now() / 300_000)}`; // 5-min cache
    const cached = await cache.get<Map<string, any>>(cacheKey);
    if (cached) return cached;

    const forecasts = new Map<string, { metric: MetricName; forecast: number[]; trend: string }[]>();

    for (const svc of this.services.values()) {
      const svcForecasts: { metric: MetricName; forecast: number[]; trend: string }[] = [];
      const keyMetrics: MetricName[] = ['cpu_usage', 'memory_usage', 'disk_usage', 'error_rate', 'request_latency_p99'];

      for (const metricName of keyMetrics) {
        const window = this.metricWindows.get(`${svc.id}:${metricName}`);
        if (!window || window.values.length < this.TREND_MIN_POINTS) continue;

        const { trend, slope } = this.computeTrend(window.values);
        const lastVal = window.values[window.values.length - 1];

        // Project next 30 minutes (30 data points at 1-min resolution)
        const forecastValues: number[] = [];
        for (let i = 1; i <= 30; i++) {
          const projected = Math.max(0, lastVal + slope * i + (Math.random() - 0.5) * slope * 0.5);
          forecastValues.push(Math.round(projected * 100) / 100);
        }

        svcForecasts.push({ metric: metricName, forecast: forecastValues, trend });
      }

      if (svcForecasts.length > 0) {
        forecasts.set(svc.id, svcForecasts);
      }
    }

    await cache.set(cacheKey, forecasts, 300);
    logger.info('Resource forecasts generated', { serviceCount: forecasts.size });
    return forecasts;
  }

  /** Predict failures for each service based on current metrics and trends. */
  async predictFailures(metrics: ServiceMetric[]): Promise<FailurePrediction[]> {
    const predictions: FailurePrediction[] = [];

    // Group metrics by service
    const byService = new Map<string, ServiceMetric[]>();
    for (const m of metrics) {
      const list = byService.get(m.serviceId) ?? [];
      list.push(m);
      byService.set(m.serviceId, list);
    }

    for (const [serviceId, svcMetrics] of byService) {
      const svc = this.services.get(serviceId);
      if (!svc) continue;

      for (const metric of svcMetrics) {
        const window = this.metricWindows.get(`${serviceId}:${metric.metricName}`);
        if (!window || window.values.length < this.TREND_MIN_POINTS) continue;

        const { trend, slope } = this.computeTrend(window.values);
        const thresholds = svc.thresholds[metric.metricName] ?? this.defaultThresholds(metric.metricName);

        if (metric.value < thresholds.warning && trend !== 'increasing') continue;

        // Estimate time to breach critical threshold
        const headroom = thresholds.critical - metric.value;
        const estimatedMinutes = slope > 0 ? Math.max(1, Math.floor(headroom / slope)) : 9999;

        if (estimatedMinutes > 480 && metric.value < thresholds.warning) continue; // Not imminent

        const confidence = this.computeConfidence(metric.value, thresholds, trend, window.values);
        const severity = this.deriveSeverity(estimatedMinutes, svc.tier, metric.value, thresholds);

        const prediction: FailurePrediction = {
          id: `pred_${serviceId}_${metric.metricName}_${Date.now()}`,
          serviceId,
          serviceName: svc.name,
          metricName: metric.metricName,
          currentValue: metric.value,
          projectedValue: Math.min(100, metric.value + slope * Math.min(estimatedMinutes, 60)),
          threshold: thresholds.critical,
          confidence,
          estimatedTimeToFailure: estimatedMinutes,
          trend,
          trendSlope: Math.round(slope * 1000) / 1000,
          severity,
          predictedAt: new Date(),
          estimatedFailureAt: new Date(Date.now() + estimatedMinutes * 60_000),
          contributingFactors: this.identifyContributingFactors(metric, svcMetrics),
          historicalSimilarEvents: Math.floor(Math.random() * 5),
        };

        predictions.push(prediction);
        logger.warn('Failure predicted', {
          serviceId,
          metric: metric.metricName,
          currentValue: metric.value,
          estimatedMinutes,
          severity,
          confidence,
        });
      }
    }

    return predictions;
  }

  /** Generate remediation suggestions for a failure prediction. */
  async suggestRemediation(prediction: FailurePrediction): Promise<RemediationSuggestion[]> {
    const cacheKey = `maint:remediation:${prediction.id}`;
    const cached = await cache.get<RemediationSuggestion[]>(cacheKey);
    if (cached) return cached;

    const suggestions: RemediationSuggestion[] = [];
    const now = new Date();

    const remediationMap: Partial<Record<MetricName, RemediationType[]>> = {
      cpu_usage: ['scale_out', 'scale_up', 'kill_process', 'reduce_batch_size'],
      memory_usage: ['scale_up', 'restart_service', 'clear_cache', 'kill_process'],
      disk_usage: ['rotate_logs', 'scale_up', 'manual_review'],
      db_connections: ['increase_connection_pool', 'restart_service', 'optimize_query'],
      request_latency_p99: ['scale_out', 'clear_cache', 'optimize_query', 'increase_connection_pool'],
      error_rate: ['restart_service', 'scale_out', 'manual_review'],
      queue_depth: ['scale_out', 'increase_connection_pool', 'reduce_batch_size'],
      cache_hit_rate: ['clear_cache', 'scale_up', 'optimize_query'],
      network_in: ['scale_out', 'manual_review'],
      network_out: ['scale_out', 'manual_review'],
    };

    const types = remediationMap[prediction.metricName] ?? ['manual_review'];

    for (let i = 0; i < Math.min(types.length, 3); i++) {
      const type = types[i];
      const priority = 100 - i * 20;
      const confidence = prediction.confidence * (1 - i * 0.1);

      suggestions.push({
        id: `rem_${prediction.id}_${i}`,
        predictionId: prediction.id,
        serviceId: prediction.serviceId,
        type,
        title: this.remediationTitle(type),
        description: this.remediationDescription(type, prediction),
        confidence: Math.round(confidence * 100) / 100,
        estimatedResolutionTimeMin: this.estimatedResolutionTime(type),
        estimatedImpact: this.estimatedImpact(type, prediction),
        riskLevel: this.remediationRisk(type),
        autoExecutable: this.isAutoExecutable(type),
        prerequisiteChecks: this.prerequisiteChecks(type),
        steps: this.remediationSteps(type, prediction),
        rollbackPlan: this.rollbackPlan(type),
        priority,
        createdAt: now,
      });
    }

    await cache.set(cacheKey, suggestions, 600);
    logger.info('Remediation suggestions generated', {
      predictionId: prediction.id,
      serviceId: prediction.serviceId,
      count: suggestions.length,
    });

    return suggestions;
  }

  /** Optimize maintenance windows to schedule during low-traffic periods. */
  async optimizeMaintenanceWindows(predictions: FailurePrediction[]): Promise<MaintenanceWindow[]> {
    const scheduled: MaintenanceWindow[] = [];
    const urgentPredictions = predictions.filter(
      p => p.estimatedTimeToFailure < 120 || p.severity === 'emergency' || p.severity === 'critical',
    );

    for (const prediction of urgentPredictions) {
      const existingWindow = [...this.windows.values()].find(
        w => w.serviceId === prediction.serviceId && w.status === 'scheduled',
      );
      if (existingWindow) continue;

      const windowStart = this.calculateNextLowTrafficWindow(prediction.estimatedTimeToFailure);
      const durationMinutes = this.estimateMaintDuration(prediction);
      const window: MaintenanceWindow = {
        id: `mw_${prediction.serviceId}_${Date.now()}`,
        serviceId: prediction.serviceId,
        serviceName: prediction.serviceName,
        scheduledStart: windowStart,
        scheduledEnd: new Date(windowStart.getTime() + durationMinutes * 60_000),
        durationMinutes,
        reason: `Predicted ${prediction.metricName} failure: ${prediction.currentValue.toFixed(1)} approaching ${prediction.threshold} threshold`,
        type: prediction.severity === 'emergency' ? 'emergency' : 'planned',
        status: 'scheduled',
        affectedComponents: this.services.get(prediction.serviceId)?.components ?? [],
        estimatedImpact: prediction.severity === 'emergency' ? 'moderate' : 'minimal',
        notificationsSent: false,
      };

      this.windows.set(window.id, window);
      scheduled.push(window);

      logger.info('Maintenance window scheduled', {
        windowId: window.id,
        serviceId: prediction.serviceId,
        start: windowStart.toISOString(),
        durationMinutes,
        type: window.type,
      });
    }

    return scheduled;
  }

  /** Check SLA health for all critical services. */
  async checkSLA(): Promise<SLAAlert[]> {
    const alerts: SLAAlert[] = [];
    const periodStart = new Date(Date.now() - 30 * 24 * 3600_000); // rolling 30-day window
    const periodEnd = new Date();

    for (const svc of this.services.values()) {
      if (svc.tier !== 'critical' && svc.tier !== 'high') continue;

      const uptimeData = this.uptimeStore.get(svc.id);
      const latencyWindow = this.metricWindows.get(`${svc.id}:request_latency_p99`);
      const errorWindow = this.metricWindows.get(`${svc.id}:error_rate`);

      // ── Availability SLA ──
      if (uptimeData && uptimeData.totalMinutes > 0) {
        const availabilityPct = ((uptimeData.totalMinutes - uptimeData.downMinutes) / uptimeData.totalMinutes) * 100;
        const slaTarget = svc.slaTargets.availability;
        const remainingMinutes = 30 * 24 * 60 - uptimeData.totalMinutes;
        const maxAllowedDownMinutes = ((100 - slaTarget) / 100) * 30 * 24 * 60;
        const breachRisk = uptimeData.downMinutes >= maxAllowedDownMinutes ? 1 :
          uptimeData.downMinutes / maxAllowedDownMinutes * (1 + remainingMinutes / (30 * 24 * 60));

        if (breachRisk > 0.5 || availabilityPct < slaTarget) {
          const alert = this.buildSLAAlert({
            svc, slaType: 'availability',
            slaTarget, currentValue: availabilityPct,
            breachRisk: Math.min(1, breachRisk),
            remainingBudgetMinutes: Math.max(0, maxAllowedDownMinutes - uptimeData.downMinutes),
            periodStart, periodEnd,
          });
          this.slaAlerts.set(alert.id, alert);
          alerts.push(alert);
        }
      }

      // ── Latency SLA ──
      if (latencyWindow && latencyWindow.values.length > 0) {
        const avgLatency = latencyWindow.values.reduce((s, v) => s + v, 0) / latencyWindow.values.length;
        const slaTarget = svc.slaTargets.latencyP99Ms;
        if (avgLatency > slaTarget * 0.85) {
          const breachRisk = Math.min(1, avgLatency / slaTarget);
          const alert = this.buildSLAAlert({
            svc, slaType: 'latency',
            slaTarget, currentValue: avgLatency,
            breachRisk, periodStart, periodEnd,
          });
          this.slaAlerts.set(alert.id, alert);
          alerts.push(alert);
        }
      }

      // ── Error Rate SLA ──
      if (errorWindow && errorWindow.values.length > 0) {
        const avgErrorRate = errorWindow.values.reduce((s, v) => s + v, 0) / errorWindow.values.length;
        const slaTarget = svc.slaTargets.errorRate;
        if (avgErrorRate > slaTarget * 0.8) {
          const breachRisk = Math.min(1, avgErrorRate / slaTarget);
          const alert = this.buildSLAAlert({
            svc, slaType: 'error_rate',
            slaTarget, currentValue: avgErrorRate,
            breachRisk, periodStart, periodEnd,
          });
          this.slaAlerts.set(alert.id, alert);
          alerts.push(alert);
        }
      }
    }

    if (alerts.length > 0) {
      logger.warn('SLA alerts triggered', { count: alerts.length, services: [...new Set(alerts.map(a => a.serviceName))] });
    }

    return alerts;
  }

  /** Generate a comprehensive maintenance report. */
  async generateMaintenanceReport(ctx: {
    reportId: string;
    cycleStart: Date;
    allMetrics: ServiceMetric[];
    predictions: FailurePrediction[];
    suggestions: RemediationSuggestion[];
    scheduledWindows: MaintenanceWindow[];
    slaAlerts: SLAAlert[];
  }): Promise<MaintenanceReport> {
    const { reportId, cycleStart, allMetrics, predictions, suggestions, scheduledWindows, slaAlerts } = ctx;
    const now = new Date();

    const serviceHealthSummary = [...this.services.values()].map(svc => {
      const svcMetrics = allMetrics.filter(m => m.serviceId === svc.id);
      const unhealthyCount = svcMetrics.filter(m => !m.healthy).length;
      const svcPredictions = predictions.filter(p => p.serviceId === svc.id);
      const criticalCount = svcPredictions.filter(
        p => p.severity === 'critical' || p.severity === 'emergency',
      ).length;

      const healthScore = Math.max(
        0,
        100 - unhealthyCount * 10 - criticalCount * 20 -
        svcPredictions.filter(p => p.severity === 'error').length * 8,
      );

      const status: 'healthy' | 'degraded' | 'critical' | 'unknown' =
        healthScore >= 80 ? 'healthy' :
        healthScore >= 50 ? 'degraded' :
        healthScore >= 20 ? 'critical' : 'unknown';

      return {
        serviceId: svc.id,
        serviceName: svc.name,
        healthScore,
        status,
        openPredictions: svcPredictions.length,
      };
    });

    const overallHealthScore = serviceHealthSummary.length > 0
      ? Math.round(serviceHealthSummary.reduce((s, sv) => s + sv.healthScore, 0) / serviceHealthSummary.length)
      : 100;

    const report: MaintenanceReport = {
      agentId: this.agentId,
      reportId,
      generatedAt: now,
      period: { start: cycleStart, end: now },
      servicesMonitored: this.services.size,
      metricsCollected: allMetrics.length,
      predictionsGenerated: predictions.length,
      criticalPredictions: predictions.filter(
        p => p.severity === 'critical' || p.severity === 'emergency',
      ).length,
      remediationsSuggested: suggestions.length,
      remediationsExecuted: [...this.remediations.values()].filter(r => r.executedAt).length,
      maintenanceWindowsScheduled: scheduledWindows.length,
      slaAlertsTriggered: slaAlerts.length,
      slaBreachesPrevented: slaAlerts.filter(a => a.breachRisk > 0.7 && !a.breach).length,
      overallHealthScore,
      serviceHealthSummary,
      topFailureRisks: predictions.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
      scheduledWindows,
      slaAlerts,
    };

    logger.info('Maintenance report generated', {
      reportId,
      overallHealthScore,
      predictions: predictions.length,
      slaAlerts: slaAlerts.length,
      scheduledWindows: scheduledWindows.length,
    });

    await cache.set(`maint:report:latest`, report, 3600);
    return report;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private seedServices(): void {
    const services: ServiceDefinition[] = [
      {
        id: 'api_gateway', name: 'API Gateway', tier: 'critical',
        slaTargets: { availability: 99.95, latencyP99Ms: 200, errorRate: 0.1 },
        thresholds: {
          cpu_usage: { warning: 70, critical: 85 },
          memory_usage: { warning: 75, critical: 90 },
          request_latency_p99: { warning: 150, critical: 200 },
          error_rate: { warning: 0.5, critical: 1.0 },
        },
        components: ['load-balancer', 'rate-limiter', 'auth-middleware'],
        dependsOn: [],
      },
      {
        id: 'content_service', name: 'Content Service', tier: 'critical',
        slaTargets: { availability: 99.9, latencyP99Ms: 500, errorRate: 0.5 },
        thresholds: {
          cpu_usage: { warning: 75, critical: 90 },
          memory_usage: { warning: 80, critical: 95 },
          db_connections: { warning: 80, critical: 95 },
          request_latency_p99: { warning: 400, critical: 500 },
        },
        components: ['content-api', 'content-db', 'content-cache'],
        dependsOn: ['api_gateway', 'postgres_primary'],
      },
      {
        id: 'postgres_primary', name: 'PostgreSQL Primary', tier: 'critical',
        slaTargets: { availability: 99.99, latencyP99Ms: 50, errorRate: 0.01 },
        thresholds: {
          cpu_usage: { warning: 60, critical: 80 },
          memory_usage: { warning: 70, critical: 85 },
          disk_usage: { warning: 75, critical: 90 },
          db_connections: { warning: 85, critical: 95 },
        },
        components: ['primary-db', 'wal-archiver', 'pgbouncer'],
        dependsOn: [],
      },
      {
        id: 'redis_cluster', name: 'Redis Cache Cluster', tier: 'high',
        slaTargets: { availability: 99.9, latencyP99Ms: 10, errorRate: 0.1 },
        thresholds: {
          memory_usage: { warning: 70, critical: 85 },
          cache_hit_rate: { warning: 80, critical: 70 },
          request_latency_p99: { warning: 8, critical: 15 },
        },
        components: ['redis-master', 'redis-replica-1', 'redis-replica-2'],
        dependsOn: [],
      },
      {
        id: 'worker_queue', name: 'Background Worker Queue', tier: 'high',
        slaTargets: { availability: 99.5, latencyP99Ms: 2000, errorRate: 1.0 },
        thresholds: {
          cpu_usage: { warning: 80, critical: 95 },
          memory_usage: { warning: 80, critical: 92 },
          queue_depth: { warning: 500, critical: 1000 },
          error_rate: { warning: 1.0, critical: 5.0 },
        },
        components: ['task-queue', 'worker-pool', 'dead-letter-queue'],
        dependsOn: ['redis_cluster', 'postgres_primary'],
      },
      {
        id: 'ai_inference', name: 'AI Inference Service', tier: 'medium',
        slaTargets: { availability: 99.0, latencyP99Ms: 5000, errorRate: 2.0 },
        thresholds: {
          cpu_usage: { warning: 85, critical: 95 },
          memory_usage: { warning: 85, critical: 95 },
          request_latency_p99: { warning: 4000, critical: 5000 },
          error_rate: { warning: 2.0, critical: 5.0 },
        },
        components: ['model-server', 'inference-cache', 'gpu-pool'],
        dependsOn: ['api_gateway', 'redis_cluster'],
      },
    ];

    for (const svc of services) this.services.set(svc.id, svc);
  }

  private simulateMetric(serviceId: string, metricName: MetricName): number {
    const window = this.metricWindows.get(`${serviceId}:${metricName}`);
    const lastVal = window?.values[window.values.length - 1];

    const ranges: Record<MetricName, [number, number]> = {
      cpu_usage: [20, 95],
      memory_usage: [30, 95],
      disk_usage: [40, 92],
      network_in: [5, 500],
      network_out: [5, 500],
      request_latency_p99: [10, 600],
      error_rate: [0, 5],
      db_connections: [10, 98],
      cache_hit_rate: [50, 99],
      queue_depth: [0, 1200],
      gc_pause_ms: [1, 300],
      fd_count: [100, 9000],
      thread_count: [10, 500],
      heap_used_mb: [64, 4096],
    };

    const [min, max] = ranges[metricName];
    const base = lastVal ?? (min + (max - min) * 0.4);
    const jitter = (Math.random() - 0.5) * (max - min) * 0.08;
    // Occasionally simulate a spike
    const spike = Math.random() < 0.03 ? (max - base) * 0.4 : 0;
    return Math.max(min, Math.min(max, base + jitter + spike));
  }

  private recordMetricPoint(serviceId: string, metricName: MetricName, value: number): void {
    const key = `${serviceId}:${metricName}`;
    const window = this.metricWindows.get(key) ?? { values: [], timestamps: [] };
    window.values.push(value);
    window.timestamps.push(new Date());
    if (window.values.length > this.WINDOW_SIZE) {
      window.values.shift();
      window.timestamps.shift();
    }
    this.metricWindows.set(key, window);
  }

  private trackUptime(serviceId: string, healthy: boolean): void {
    const existing = this.uptimeStore.get(serviceId) ?? { totalMinutes: 0, downMinutes: 0 };
    existing.totalMinutes++;
    if (!healthy) existing.downMinutes++;
    this.uptimeStore.set(serviceId, existing);
  }

  private computeTrend(values: number[]): { trend: FailurePrediction['trend']; slope: number } {
    if (values.length < 2) return { trend: 'stable', slope: 0 };
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const variance = values.reduce((s, v) => s + Math.pow(v - sumY / n, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    let trend: FailurePrediction['trend'];
    if (stdDev > 15) trend = 'volatile';
    else if (slope > 0.3) trend = 'increasing';
    else if (slope < -0.3) trend = 'decreasing';
    else trend = 'stable';

    return { trend, slope };
  }

  private computeConfidence(value: number, thresholds: { warning: number; critical: number }, trend: string, values: number[]): number {
    const proximityToWarning = Math.min(1, value / thresholds.warning);
    const proximityToCritical = Math.min(1, value / thresholds.critical);
    const trendBonus = trend === 'increasing' ? 0.15 : trend === 'volatile' ? 0.05 : 0;
    const dataPoints = Math.min(1, values.length / 20);
    return Math.round(Math.min(0.99, proximityToWarning * 0.3 + proximityToCritical * 0.4 + trendBonus + dataPoints * 0.15) * 100) / 100;
  }

  private deriveSeverity(etfMinutes: number, tier: ServiceTier, value: number, thresholds: { warning: number; critical: number }): AlertSeverity {
    const atCritical = value >= thresholds.critical;
    if (atCritical && tier === 'critical') return 'emergency';
    if (atCritical) return 'critical';
    if (etfMinutes < 30 && tier === 'critical') return 'critical';
    if (etfMinutes < 60) return 'error';
    if (etfMinutes < 120) return 'warning';
    return 'info';
  }

  private identifyContributingFactors(target: ServiceMetric, svcMetrics: ServiceMetric[]): string[] {
    const factors: string[] = [];
    const correlated: Record<MetricName, MetricName[]> = {
      cpu_usage: ['queue_depth', 'request_latency_p99', 'gc_pause_ms'],
      memory_usage: ['heap_used_mb', 'gc_pause_ms', 'cache_hit_rate'],
      request_latency_p99: ['db_connections', 'cache_hit_rate', 'queue_depth'],
      error_rate: ['request_latency_p99', 'db_connections'],
      disk_usage: ['queue_depth'],
      db_connections: ['queue_depth'],
      cache_hit_rate: ['memory_usage'],
      queue_depth: ['worker_queue' as any],
      network_in: [], network_out: [], gc_pause_ms: [],
      fd_count: [], thread_count: [], heap_used_mb: [],
    };

    const related = correlated[target.metricName] ?? [];
    for (const rel of related) {
      const relMetric = svcMetrics.find(m => m.metricName === rel);
      if (relMetric && !relMetric.healthy) {
        factors.push(`Elevated ${rel.replace(/_/g, ' ')}: ${relMetric.value.toFixed(1)}`);
      }
    }

    const thresholds = target.threshold;
    if (target.value > thresholds.warning) factors.push(`Value ${target.value.toFixed(1)} exceeds warning threshold ${thresholds.warning}`);
    if (factors.length === 0) factors.push('Gradual resource accumulation over time');

    return factors;
  }

  private calculateNextLowTrafficWindow(etfMinutes: number): Date {
    const now = new Date();
    if (etfMinutes < 30) return now; // Emergency: start now
    const currentHour = now.getUTCHours();

    for (let h = 0; h < 24; h++) {
      const candidate = (currentHour + h) % 24;
      if (this.LOW_TRAFFIC_HOURS.includes(candidate)) {
        const minsToWindow = h * 60 - now.getMinutes();
        if (minsToWindow <= etfMinutes * 0.8) {
          return new Date(now.getTime() + Math.max(0, minsToWindow) * 60_000);
        }
      }
    }

    // Fallback: next occurrence of first low-traffic hour
    const nextLow = this.LOW_TRAFFIC_HOURS[0];
    const hoursUntil = (nextLow - currentHour + 24) % 24 || 24;
    return new Date(now.getTime() + hoursUntil * 3_600_000);
  }

  private estimateMaintDuration(prediction: FailurePrediction): number {
    const base: Partial<Record<MetricName, number>> = {
      cpu_usage: 15, memory_usage: 20, disk_usage: 30, db_connections: 10,
      request_latency_p99: 20, error_rate: 30, queue_depth: 15,
    };
    return base[prediction.metricName] ?? 30;
  }

  private buildSLAAlert(params: {
    svc: ServiceDefinition;
    slaType: SLAAlert['slaType'];
    slaTarget: number;
    currentValue: number;
    breachRisk: number;
    remainingBudgetMinutes?: number;
    periodStart: Date;
    periodEnd: Date;
  }): SLAAlert {
    const { svc, slaType, slaTarget, currentValue, breachRisk, remainingBudgetMinutes, periodStart, periodEnd } = params;
    const breach = slaType === 'availability'
      ? currentValue < slaTarget
      : slaType === 'error_rate'
        ? currentValue > slaTarget
        : currentValue > slaTarget;

    const severity: AlertSeverity = breachRisk > 0.9 ? 'critical' : breachRisk > 0.7 ? 'error' : 'warning';
    const recs: string[] = [];
    if (slaType === 'availability') recs.push('Schedule emergency maintenance window', 'Review recent deployment changes', 'Activate failover if available');
    if (slaType === 'latency') recs.push('Scale out application tier', 'Review slow database queries', 'Check cache hit rates');
    if (slaType === 'error_rate') recs.push('Investigate error logs immediately', 'Rollback recent deployment', 'Enable circuit breaker');

    return {
      id: `sla_${svc.id}_${slaType}_${Date.now()}`,
      serviceId: svc.id,
      serviceName: svc.name,
      slaType,
      slaTarget,
      currentValue: Math.round(currentValue * 100) / 100,
      projectedValue: Math.round(currentValue * 100) / 100,
      breach,
      breachRisk: Math.round(breachRisk * 100) / 100,
      remainingBudgetMinutes,
      period: { start: periodStart, end: periodEnd },
      severity,
      recommendations: recs,
      triggeredAt: new Date(),
    };
  }

  private defaultThresholds(metricName: MetricName): { warning: number; critical: number } {
    const defaults: Record<MetricName, { warning: number; critical: number }> = {
      cpu_usage: { warning: 75, critical: 90 },
      memory_usage: { warning: 80, critical: 95 },
      disk_usage: { warning: 80, critical: 92 },
      network_in: { warning: 400, critical: 480 },
      network_out: { warning: 400, critical: 480 },
      request_latency_p99: { warning: 300, critical: 500 },
      error_rate: { warning: 1.0, critical: 5.0 },
      db_connections: { warning: 80, critical: 95 },
      cache_hit_rate: { warning: 75, critical: 60 },
      queue_depth: { warning: 500, critical: 900 },
      gc_pause_ms: { warning: 100, critical: 250 },
      fd_count: { warning: 7000, critical: 9000 },
      thread_count: { warning: 400, critical: 480 },
      heap_used_mb: { warning: 3500, critical: 4000 },
    };
    return defaults[metricName];
  }

  private metricUnit(metricName: MetricName): string {
    const units: Record<MetricName, string> = {
      cpu_usage: '%', memory_usage: '%', disk_usage: '%',
      network_in: 'Mbps', network_out: 'Mbps',
      request_latency_p99: 'ms', error_rate: '%',
      db_connections: '%', cache_hit_rate: '%',
      queue_depth: 'tasks', gc_pause_ms: 'ms',
      fd_count: 'count', thread_count: 'count', heap_used_mb: 'MB',
    };
    return units[metricName] ?? 'units';
  }

  private remediationTitle(type: RemediationType): string {
    const titles: Record<RemediationType, string> = {
      scale_out: 'Scale Out Horizontally', scale_up: 'Scale Up Vertically',
      restart_service: 'Restart Service', clear_cache: 'Clear Application Cache',
      kill_process: 'Terminate Runaway Process', rotate_logs: 'Rotate & Compress Log Files',
      increase_connection_pool: 'Increase Database Connection Pool',
      optimize_query: 'Optimize Slow Queries', reduce_batch_size: 'Reduce Batch Processing Size',
      manual_review: 'Manual Review Required',
    };
    return titles[type];
  }

  private remediationDescription(type: RemediationType, pred: FailurePrediction): string {
    return `${this.remediationTitle(type)} to address elevated ${pred.metricName.replace(/_/g, ' ')} (${pred.currentValue.toFixed(1)}) on ${pred.serviceName}.`;
  }

  private estimatedResolutionTime(type: RemediationType): number {
    const times: Record<RemediationType, number> = {
      scale_out: 5, scale_up: 15, restart_service: 3, clear_cache: 2,
      kill_process: 1, rotate_logs: 5, increase_connection_pool: 3,
      optimize_query: 30, reduce_batch_size: 2, manual_review: 60,
    };
    return times[type];
  }

  private estimatedImpact(type: RemediationType, pred: FailurePrediction): string {
    if (type === 'scale_out') return `Reduce ${pred.metricName.replace(/_/g, ' ')} by ~30-50% within 5 minutes`;
    if (type === 'restart_service') return 'Brief service interruption (~30s), full recovery expected';
    if (type === 'clear_cache') return 'Temporary cache miss spike, normalizes within 2 minutes';
    return `Reduce pressure on ${pred.metricName.replace(/_/g, ' ')}`;
  }

  private remediationRisk(type: RemediationType): RemediationSuggestion['riskLevel'] {
    if (['restart_service', 'kill_process', 'optimize_query'].includes(type)) return 'high';
    if (['scale_up', 'increase_connection_pool', 'rotate_logs'].includes(type)) return 'medium';
    return 'low';
  }

  private isAutoExecutable(type: RemediationType): boolean {
    return ['scale_out', 'clear_cache', 'rotate_logs', 'reduce_batch_size'].includes(type);
  }

  private prerequisiteChecks(type: RemediationType): string[] {
    if (type === 'restart_service') return ['Verify replica/standby is healthy', 'Drain in-flight requests', 'Notify on-call team'];
    if (type === 'scale_out') return ['Check auto-scaling group capacity', 'Verify AMI/container image availability'];
    if (type === 'optimize_query') return ['Identify top slow queries via pg_stat_statements', 'Take DB performance snapshot'];
    return ['Verify system health before proceeding'];
  }

  private remediationSteps(type: RemediationType, pred: FailurePrediction): string[] {
    if (type === 'scale_out') return [
      `Increase desired capacity in auto-scaling group for ${pred.serviceName}`,
      'Wait for new instances to pass health checks (typically 2-3 minutes)',
      'Verify load balancer distributes traffic evenly',
      'Monitor metric for improvement',
    ];
    if (type === 'restart_service') return [
      `Put ${pred.serviceName} into maintenance mode`,
      'Gracefully stop service (SIGTERM, wait 30s)',
      'Force kill if not stopped (SIGKILL)',
      'Start service and validate health endpoint',
      'Remove maintenance mode flag',
    ];
    if (type === 'clear_cache') return [
      'Connect to Redis cluster', 'Run FLUSHDB on application cache namespace',
      'Warm up critical cache keys', 'Monitor cache hit rate recovery',
    ];
    return [`Execute ${type.replace(/_/g, ' ')} remediation`, 'Monitor metric recovery', 'Confirm resolution'];
  }

  private rollbackPlan(type: RemediationType): string {
    if (type === 'scale_out') return 'Reduce instance count back to baseline if cost is prohibitive after recovery';
    if (type === 'restart_service') return 'Roll back to previous deployment version if service fails to start';
    if (type === 'clear_cache') return 'Cache will repopulate automatically; no manual rollback needed';
    return 'Revert any configuration changes and escalate to on-call engineer if issue persists';
  }

  private emptyReport(): MaintenanceReport {
    const now = new Date();
    return {
      agentId: this.agentId, reportId: 'skipped', generatedAt: now,
      period: { start: now, end: now },
      servicesMonitored: this.services.size, metricsCollected: 0,
      predictionsGenerated: 0, criticalPredictions: 0,
      remediationsSuggested: 0, remediationsExecuted: 0,
      maintenanceWindowsScheduled: 0, slaAlertsTriggered: 0,
      slaBreachesPrevented: 0, overallHealthScore: 100,
      serviceHealthSummary: [], topFailureRisks: [],
      scheduledWindows: [], slaAlerts: [],
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: PredictiveMaintenanceAgent | null = null;

export function getInstance(): PredictiveMaintenanceAgent {
  if (!_instance) {
    _instance = new PredictiveMaintenanceAgent();
    logger.info('PredictiveMaintenanceAgent singleton created');
  }
  return _instance;
}

export default PredictiveMaintenanceAgent;
