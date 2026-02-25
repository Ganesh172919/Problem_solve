/**
 * Autonomous Incident Responder — automated incident detection, classification,
 * correlation, remediation, and learning with minimal human intervention.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export enum Severity { P1 = 'P1', P2 = 'P2', P3 = 'P3', P4 = 'P4', P5 = 'P5' }

export enum IncidentStatus {
  Detected = 'detected', Triaged = 'triaged', Investigating = 'investigating',
  Remediating = 'remediating', Resolved = 'resolved', PostMortem = 'post_mortem', Closed = 'closed',
}

export enum SignalSource {
  Metric = 'metric', Log = 'log', Alert = 'alert',
  HealthCheck = 'health_check', Synthetic = 'synthetic', UserReport = 'user_report',
}

export enum RemediationAction {
  RestartService = 'restart_service', ScaleUp = 'scale_up', Failover = 'failover',
  Rollback = 'rollback', PurgeCDN = 'purge_cdn', DrainNode = 'drain_node',
  ToggleFeatureFlag = 'toggle_feature_flag', FlushCache = 'flush_cache',
}

export interface Signal {
  id: string; source: SignalSource; timestamp: number; service: string;
  message: string; metadata: Record<string, unknown>; severity?: Severity;
}

export interface SeverityScore {
  severity: Severity; confidence: number;
  factors: { name: string; weight: number; value: number }[];
}

export interface RunbookStep {
  id: string; action: RemediationAction | string; parameters: Record<string, unknown>;
  timeout: number; rollbackAction?: string; continueOnFailure?: boolean;
}

export interface Runbook {
  id: string; name: string; incidentType: string;
  steps: RunbookStep[]; maxRetries: number; requiresApproval: boolean;
}

export interface CorrelationCluster {
  clusterId: string; rootSignalId: string; signalIds: string[];
  services: string[]; correlationScore: number; mergedAt: number;
}

export interface RootCauseHypothesis {
  description: string; probability: number;
  evidence: string[]; suggestedActions: RemediationAction[];
}

export interface TimelineEntry {
  timestamp: number;
  type: 'signal' | 'action' | 'escalation' | 'status_change' | 'communication' | 'note';
  description: string; actor: string; metadata?: Record<string, unknown>;
}

export interface EscalationPolicy {
  name: string; levels: EscalationLevel[]; repeatAfterMinutes: number;
}

export interface EscalationLevel {
  level: number; targets: string[]; delayMinutes: number;
  channels: ('email' | 'sms' | 'slack' | 'pagerduty' | 'phone')[];
}

export interface OnCallSchedule {
  teamId: string;
  rotations: { userId: string; start: number; end: number }[];
  overrides: { userId: string; start: number; end: number }[];
}

export interface SLAPolicy {
  severity: Severity; acknowledgeWithinMinutes: number;
  resolveWithinMinutes: number; updateFrequencyMinutes: number;
}

export interface Incident {
  id: string; title: string; status: IncidentStatus; severity: Severity;
  severityScore: SeverityScore; signals: Signal[];
  correlationCluster?: CorrelationCluster; rootCauses: RootCauseHypothesis[];
  timeline: TimelineEntry[]; affectedServices: string[];
  assignee?: string; commander?: string;
  createdAt: number; acknowledgedAt?: number; resolvedAt?: number;
  slaBreachPrediction?: { breachType: string; predictedAt: number; confidence: number };
  remediationLog: { action: RemediationAction; status: 'pending' | 'running' | 'success' | 'failed'; startedAt: number; completedAt?: number }[];
  postMortem?: PostMortemData; tags: string[];
}

export interface PostMortemData {
  summary: string; rootCause: string;
  impact: { usersAffected: number; durationMinutes: number; revenueImpact: number };
  timeline: TimelineEntry[]; lessonsLearned: string[];
  actionItems: { description: string; owner: string; dueDate: number; completed: boolean }[];
}

export interface IncidentPattern {
  patternId: string; fingerprint: string; occurrences: number; lastSeen: number;
  avgResolutionMinutes: number; successfulRemediations: RemediationAction[];
}

export interface WarRoomState {
  incidentId: string; participants: string[]; channelId: string; createdAt: number;
  sharedDocuments: string[];
  decisions: { description: string; madeBy: string; timestamp: number }[];
}

export interface CommunicationPayload {
  channel: string; recipients: string[]; subject: string;
  body: string; priority: 'critical' | 'high' | 'normal' | 'low';
}

const SEVERITY_WEIGHTS = {
  errorRate: 0.25,
  latencyImpact: 0.15,
  userImpact: 0.2,
  servicesCritical: 0.2,
  recentFrequency: 0.1,
  timeOfDay: 0.1,
} as const;

const CRITICAL_SERVICES = new Set(['api-gateway', 'auth', 'payment', 'database', 'cdn']);

export function classifySeverity(signals: Signal[], serviceGraph: Map<string, string[]>): SeverityScore {
  const factors: SeverityScore['factors'] = [];

  const errorSignals = signals.filter(s => s.metadata['level'] === 'error' || s.metadata['level'] === 'critical');
  const errorRate = signals.length > 0 ? errorSignals.length / signals.length : 0;
  factors.push({ name: 'errorRate', weight: SEVERITY_WEIGHTS.errorRate, value: errorRate });

  const latencies = signals
    .map(s => Number(s.metadata['latencyMs'] ?? 0))
    .filter(l => l > 0);
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const latencyScore = Math.min(avgLatency / 5000, 1);
  factors.push({ name: 'latencyImpact', weight: SEVERITY_WEIGHTS.latencyImpact, value: latencyScore });

  const affectedServices = new Set(signals.map(s => s.service));
  let downstreamCount = 0;
  for (const svc of affectedServices) {
    const deps = serviceGraph.get(svc) ?? [];
    downstreamCount += deps.length;
  }
  const userImpact = Math.min((affectedServices.size + downstreamCount) / 20, 1);
  factors.push({ name: 'userImpact', weight: SEVERITY_WEIGHTS.userImpact, value: userImpact });

  const criticalHit = [...affectedServices].some(s => CRITICAL_SERVICES.has(s));
  const criticalScore = criticalHit ? 1.0 : 0.2;
  factors.push({ name: 'servicesCritical', weight: SEVERITY_WEIGHTS.servicesCritical, value: criticalScore });

  const now = Date.now();
  const recentWindow = 15 * 60 * 1000;
  const recentCount = signals.filter(s => now - s.timestamp < recentWindow).length;
  const freqScore = Math.min(recentCount / 50, 1);
  factors.push({ name: 'recentFrequency', weight: SEVERITY_WEIGHTS.recentFrequency, value: freqScore });

  const hour = new Date().getUTCHours();
  const peakHours = hour >= 13 && hour <= 22;
  const todScore = peakHours ? 0.8 : 0.3;
  factors.push({ name: 'timeOfDay', weight: SEVERITY_WEIGHTS.timeOfDay, value: todScore });

  const composite = factors.reduce((sum, f) => sum + f.weight * f.value, 0);

  let severity: Severity;
  if (composite >= 0.8) severity = Severity.P1;
  else if (composite >= 0.6) severity = Severity.P2;
  else if (composite >= 0.4) severity = Severity.P3;
  else if (composite >= 0.2) severity = Severity.P4;
  else severity = Severity.P5;

  return { severity, confidence: Math.min(composite + 0.2, 1), factors };
}

export function computeSignalFingerprint(signal: Signal): string {
  const parts = [
    signal.source,
    signal.service,
    String(signal.metadata['alertName'] ?? ''),
    String(signal.metadata['errorCode'] ?? ''),
  ];
  let hash = 0;
  const raw = parts.join('|');
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `fp_${(hash >>> 0).toString(36)}`;
}

export function deduplicateSignals(signals: Signal[], windowMs: number = 300_000): Signal[] {
  const seen = new Map<string, Signal>();
  const deduped: Signal[] = [];

  for (const signal of signals) {
    const fp = computeSignalFingerprint(signal);
    const existing = seen.get(fp);
    if (existing && Math.abs(signal.timestamp - existing.timestamp) < windowMs) {
      logger.debug('Deduplicated signal', { fingerpint: fp, signalId: signal.id });
      continue;
    }
    seen.set(fp, signal);
    deduped.push(signal);
  }

  logger.info('Deduplication complete', { input: signals.length, output: deduped.length });
  return deduped;
}

export function correlateSignals(
  signals: Signal[],
  serviceGraph: Map<string, string[]>,
  timeWindowMs: number = 600_000,
): CorrelationCluster[] {
  const clusters: CorrelationCluster[] = [];
  const assigned = new Set<string>();

  const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);

  for (const signal of sorted) {
    if (assigned.has(signal.id)) continue;

    const cluster: CorrelationCluster = {
      clusterId: `cluster_${signal.id}`,
      rootSignalId: signal.id,
      signalIds: [signal.id],
      services: [signal.service],
      correlationScore: 1.0,
      mergedAt: Date.now(),
    };
    assigned.add(signal.id);

    const relatedServices = new Set<string>(serviceGraph.get(signal.service) ?? []);
    relatedServices.add(signal.service);

    for (const candidate of sorted) {
      if (assigned.has(candidate.id)) continue;

      const timeDelta = Math.abs(candidate.timestamp - signal.timestamp);
      if (timeDelta > timeWindowMs) continue;

      const serviceRelated = relatedServices.has(candidate.service);
      const temporalScore = 1 - timeDelta / timeWindowMs;
      const metadataMatch = candidate.metadata['errorCode'] === signal.metadata['errorCode'] && signal.metadata['errorCode'] !== undefined;

      const score = (serviceRelated ? 0.5 : 0) + temporalScore * 0.3 + (metadataMatch ? 0.2 : 0);

      if (score >= 0.4) {
        cluster.signalIds.push(candidate.id);
        if (!cluster.services.includes(candidate.service)) {
          cluster.services.push(candidate.service);
        }
        cluster.correlationScore = Math.min(cluster.correlationScore, score);
        assigned.add(candidate.id);

        const candidateDeps = serviceGraph.get(candidate.service) ?? [];
        for (const dep of candidateDeps) relatedServices.add(dep);
      }
    }

    if (cluster.signalIds.length > 1) {
      logger.info('Correlated signal cluster', { clusterId: cluster.clusterId, size: cluster.signalIds.length });
    }
    clusters.push(cluster);
  }

  return clusters;
}

export function analyzeRootCause(
  incident: Incident,
  serviceGraph: Map<string, string[]>,
  patterns: IncidentPattern[],
): RootCauseHypothesis[] {
  const hypotheses: RootCauseHypothesis[] = [];

  const deploySignals = incident.signals.filter(
    s => s.metadata['type'] === 'deployment' || String(s.message).toLowerCase().includes('deploy'),
  );
  if (deploySignals.length > 0) {
    const recentDeploy = deploySignals.sort((a, b) => b.timestamp - a.timestamp)[0];
    hypotheses.push({
      description: `Recent deployment to ${recentDeploy.service} likely caused regression`,
      probability: 0.8,
      evidence: [`Deployment signal at ${new Date(recentDeploy.timestamp).toISOString()}`, `Service: ${recentDeploy.service}`],
      suggestedActions: [RemediationAction.Rollback],
    });
  }

  const upstreamServices = new Set<string>();
  for (const [svc, deps] of serviceGraph.entries()) {
    if (deps.some(d => incident.affectedServices.includes(d))) {
      upstreamServices.add(svc);
    }
  }
  const rootServices = incident.affectedServices.filter(s => upstreamServices.has(s));
  if (rootServices.length > 0) {
    hypotheses.push({
      description: `Upstream service failure in ${rootServices.join(', ')} cascading to dependents`,
      probability: 0.65,
      evidence: rootServices.map(s => `${s} is upstream of affected services`),
      suggestedActions: [RemediationAction.RestartService, RemediationAction.Failover],
    });
  }

  const resourceSignals = incident.signals.filter(
    s => Number(s.metadata['cpuPercent'] ?? 0) > 85 || Number(s.metadata['memoryPercent'] ?? 0) > 90,
  );
  if (resourceSignals.length > 0) {
    hypotheses.push({
      description: 'Resource exhaustion detected — high CPU or memory usage',
      probability: 0.7,
      evidence: resourceSignals.map(s => `${s.service}: CPU ${s.metadata['cpuPercent']}%, MEM ${s.metadata['memoryPercent']}%`),
      suggestedActions: [RemediationAction.ScaleUp, RemediationAction.RestartService],
    });
  }

  const fp = incident.signals.length > 0 ? computeSignalFingerprint(incident.signals[0]) : '';
  const matchedPattern = patterns.find(p => p.fingerprint === fp);
  if (matchedPattern && matchedPattern.occurrences > 2) {
    hypotheses.push({
      description: `Recurring incident pattern (seen ${matchedPattern.occurrences} times, avg resolution ${matchedPattern.avgResolutionMinutes}min)`,
      probability: 0.75,
      evidence: [`Pattern ${matchedPattern.patternId} matched`, `Last seen ${new Date(matchedPattern.lastSeen).toISOString()}`],
      suggestedActions: matchedPattern.successfulRemediations,
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      description: 'No automated root cause identified — manual investigation required',
      probability: 0.1,
      evidence: ['No deployment, dependency, resource, or pattern signals matched'],
      suggestedActions: [],
    });
  }

  hypotheses.sort((a, b) => b.probability - a.probability);
  logger.info('Root cause analysis complete', { incidentId: incident.id, hypotheses: hypotheses.length });
  return hypotheses;
}

export async function executeRunbook(
  runbook: Runbook,
  incident: Incident,
  executor: (step: RunbookStep, incident: Incident) => Promise<{ success: boolean; output: string }>,
): Promise<{ success: boolean; stepsCompleted: number; results: { stepId: string; success: boolean; output: string }[] }> {
  const results: { stepId: string; success: boolean; output: string }[] = [];
  let overallSuccess = true;

  logger.info('Starting runbook execution', { runbookId: runbook.id, incidentId: incident.id, steps: runbook.steps.length });

  for (const step of runbook.steps) {
    let attemptSuccess = false;
    let lastOutput = '';

    for (let attempt = 0; attempt <= runbook.maxRetries; attempt++) {
      if (attempt > 0) {
        logger.warn('Retrying runbook step', { stepId: step.id, attempt });
        await sleep(Math.min(1000 * Math.pow(2, attempt), 30_000));
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Step timed out')), step.timeout),
        );
        const result = await Promise.race([executor(step, incident), timeoutPromise]);
        attemptSuccess = result.success;
        lastOutput = result.output;
        if (attemptSuccess) break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastOutput = message;
        logger.error('Runbook step error', err instanceof Error ? err : new Error(message), { stepId: step.id, attempt });
      }
    }

    results.push({ stepId: step.id, success: attemptSuccess, output: lastOutput });
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'action',
      description: `Runbook step ${step.id} (${step.action}): ${attemptSuccess ? 'succeeded' : 'failed'}`,
      actor: 'auto-responder',
      metadata: { output: lastOutput },
    });

    if (!attemptSuccess) {
      overallSuccess = false;
      if (!step.continueOnFailure) {
        logger.warn('Runbook halted due to step failure', { stepId: step.id, runbookId: runbook.id });
        break;
      }
    }
  }

  logger.info('Runbook execution finished', { runbookId: runbook.id, success: overallSuccess, stepsCompleted: results.length });
  return { success: overallSuccess, stepsCompleted: results.length, results };
}

const DEFAULT_SLA_POLICIES: SLAPolicy[] = [
  { severity: Severity.P1, acknowledgeWithinMinutes: 5, resolveWithinMinutes: 60, updateFrequencyMinutes: 15 },
  { severity: Severity.P2, acknowledgeWithinMinutes: 15, resolveWithinMinutes: 240, updateFrequencyMinutes: 30 },
  { severity: Severity.P3, acknowledgeWithinMinutes: 60, resolveWithinMinutes: 1440, updateFrequencyMinutes: 120 },
  { severity: Severity.P4, acknowledgeWithinMinutes: 480, resolveWithinMinutes: 4320, updateFrequencyMinutes: 480 },
  { severity: Severity.P5, acknowledgeWithinMinutes: 1440, resolveWithinMinutes: 10080, updateFrequencyMinutes: 1440 },
];

export function predictSLABreach(
  incident: Incident,
  policies: SLAPolicy[] = DEFAULT_SLA_POLICIES,
): Incident['slaBreachPrediction'] {
  const policy = policies.find(p => p.severity === incident.severity);
  if (!policy) return undefined;

  const now = Date.now();
  const ageMinutes = (now - incident.createdAt) / 60_000;

  if (!incident.acknowledgedAt) {
    const remaining = policy.acknowledgeWithinMinutes - ageMinutes;
    if (remaining < 0) {
      return { breachType: 'acknowledge', predictedAt: incident.createdAt + policy.acknowledgeWithinMinutes * 60_000, confidence: 1.0 };
    }
    const velocity = ageMinutes / policy.acknowledgeWithinMinutes;
    if (velocity > 0.7) {
      return { breachType: 'acknowledge', predictedAt: now + remaining * 60_000, confidence: velocity };
    }
  }

  if (incident.status !== IncidentStatus.Resolved && incident.status !== IncidentStatus.Closed) {
    const resolveRemaining = policy.resolveWithinMinutes - ageMinutes;
    if (resolveRemaining < 0) {
      return { breachType: 'resolve', predictedAt: incident.createdAt + policy.resolveWithinMinutes * 60_000, confidence: 1.0 };
    }
    const resolveVelocity = ageMinutes / policy.resolveWithinMinutes;
    if (resolveVelocity > 0.6) {
      return { breachType: 'resolve', predictedAt: now + resolveRemaining * 60_000, confidence: resolveVelocity };
    }
  }

  return undefined;
}

export function resolveOnCall(schedule: OnCallSchedule, timestamp: number = Date.now()): string | undefined {
  const override = schedule.overrides.find(o => timestamp >= o.start && timestamp < o.end);
  if (override) return override.userId;

  const rotation = schedule.rotations.find(r => timestamp >= r.start && timestamp < r.end);
  return rotation?.userId;
}

export function determineEscalationLevel(
  incident: Incident,
  policy: EscalationPolicy,
): EscalationLevel | undefined {
  const ageMinutes = (Date.now() - incident.createdAt) / 60_000;
  let accumulated = 0;

  for (const level of policy.levels) {
    accumulated += level.delayMinutes;
    if (ageMinutes < accumulated) return level;
  }

  const repeatCycles = Math.floor((ageMinutes - accumulated) / policy.repeatAfterMinutes);
  const levelIndex = repeatCycles % policy.levels.length;
  return policy.levels[policy.levels.length - 1 - Math.min(levelIndex, policy.levels.length - 1)];
}

export function buildStatusPageUpdate(incident: Incident): CommunicationPayload {
  const statusMap: Record<IncidentStatus, string> = {
    [IncidentStatus.Detected]: 'Investigating',
    [IncidentStatus.Triaged]: 'Investigating',
    [IncidentStatus.Investigating]: 'Investigating',
    [IncidentStatus.Remediating]: 'Identified — applying fix',
    [IncidentStatus.Resolved]: 'Resolved',
    [IncidentStatus.PostMortem]: 'Resolved — post-mortem in progress',
    [IncidentStatus.Closed]: 'Resolved',
  };

  const impactLevel = incident.severity <= Severity.P2 ? 'Major' : incident.severity === Severity.P3 ? 'Minor' : 'None';

  return {
    channel: 'status_page',
    recipients: [],
    subject: `[${incident.severity}] ${incident.title}`,
    body: [
      `**Status:** ${statusMap[incident.status]}`,
      `**Impact:** ${impactLevel}`,
      `**Affected Services:** ${incident.affectedServices.join(', ')}`,
      `**Last Updated:** ${new Date().toISOString()}`,
      incident.rootCauses.length > 0 ? `**Root Cause:** ${incident.rootCauses[0].description}` : '',
    ].filter(Boolean).join('\n'),
    priority: incident.severity <= Severity.P2 ? 'critical' : 'normal',
  };
}

export function buildTeamNotification(incident: Incident, targets: string[]): CommunicationPayload {
  const topCause = incident.rootCauses[0]?.description ?? 'Under investigation';
  return {
    channel: 'slack',
    recipients: targets,
    subject: `🚨 [${incident.severity}] ${incident.title}`,
    body: [
      `*Incident:* ${incident.id}`,
      `*Severity:* ${incident.severity} (confidence: ${(incident.severityScore.confidence * 100).toFixed(0)}%)`,
      `*Services:* ${incident.affectedServices.join(', ')}`,
      `*Status:* ${incident.status}`,
      `*Root Cause:* ${topCause}`,
      `*Commander:* ${incident.commander ?? 'Unassigned'}`,
    ].join('\n'),
    priority: incident.severity <= Severity.P2 ? 'critical' : incident.severity === Severity.P3 ? 'high' : 'normal',
  };
}

export function createWarRoom(incident: Incident, onCallUsers: string[]): WarRoomState {
  logger.info('Creating war room', { incidentId: incident.id, participants: onCallUsers.length });
  return {
    incidentId: incident.id,
    participants: onCallUsers,
    channelId: `war-room-${incident.id}`,
    createdAt: Date.now(),
    sharedDocuments: [],
    decisions: [],
  };
}

export function generatePostMortem(incident: Incident): PostMortemData {
  const durationMinutes = incident.resolvedAt
    ? (incident.resolvedAt - incident.createdAt) / 60_000
    : (Date.now() - incident.createdAt) / 60_000;
  const topCause = incident.rootCauses[0]?.description ?? 'Unknown';
  const estimatedUsers = incident.affectedServices.length * 500;
  const revenueImpact = incident.severity <= Severity.P2 ? durationMinutes * 150 : durationMinutes * 25;
  const lessonsLearned: string[] = [];
  const actionItems: PostMortemData['actionItems'] = [];
  const owner = incident.commander ?? 'unassigned';

  const failedRemediations = incident.remediationLog.filter(r => r.status === 'failed');
  if (failedRemediations.length > 0) {
    lessonsLearned.push(`Automated remediation failed for ${failedRemediations.length} action(s) — runbooks need updating.`);
    actionItems.push({ description: 'Review and update failed runbook steps', owner, dueDate: Date.now() + 7 * 86_400_000, completed: false });
  }
  if (durationMinutes > 60) {
    lessonsLearned.push('Incident resolution exceeded 1 hour — consider adding pre-built runbooks or improving monitoring coverage.');
  }
  if (!incident.acknowledgedAt || (incident.acknowledgedAt - incident.createdAt) / 60_000 > 10) {
    lessonsLearned.push('Acknowledgement was delayed — review on-call response procedures.');
    actionItems.push({ description: 'Audit on-call acknowledgement time and paging configuration', owner, dueDate: Date.now() + 14 * 86_400_000, completed: false });
  }
  if (incident.rootCauses.some(rc => rc.suggestedActions.includes(RemediationAction.Rollback))) {
    lessonsLearned.push('Incident likely triggered by deployment — add canary analysis or extend bake time.');
    actionItems.push({ description: 'Implement canary deployment analysis for affected service(s)', owner, dueDate: Date.now() + 30 * 86_400_000, completed: false });
  }
  if (lessonsLearned.length === 0) lessonsLearned.push('Incident was handled within expected parameters.');

  logger.info('Post-mortem generated', { incidentId: incident.id, actionItems: actionItems.length });
  return {
    summary: `${incident.severity} incident affecting ${incident.affectedServices.join(', ')} lasting ${durationMinutes.toFixed(0)} minutes.`,
    rootCause: topCause,
    impact: { usersAffected: estimatedUsers, durationMinutes: Math.round(durationMinutes), revenueImpact: Math.round(revenueImpact) },
    timeline: incident.timeline, lessonsLearned, actionItems,
  };
}

export function updatePatternDatabase(
  patterns: IncidentPattern[],
  incident: Incident,
): IncidentPattern[] {
  if (incident.signals.length === 0) return patterns;

  const fp = computeSignalFingerprint(incident.signals[0]);
  const existing = patterns.find(p => p.fingerprint === fp);

  const resolutionMinutes = incident.resolvedAt
    ? (incident.resolvedAt - incident.createdAt) / 60_000
    : 0;

  const successActions = incident.remediationLog
    .filter(r => r.status === 'success')
    .map(r => r.action);

  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = Date.now();
    if (resolutionMinutes > 0) {
      existing.avgResolutionMinutes =
        (existing.avgResolutionMinutes * (existing.occurrences - 1) + resolutionMinutes) / existing.occurrences;
    }
    for (const action of successActions) {
      if (!existing.successfulRemediations.includes(action)) {
        existing.successfulRemediations.push(action);
      }
    }
    logger.info('Updated incident pattern', { patternId: existing.patternId, occurrences: existing.occurrences });
  } else {
    const newPattern: IncidentPattern = {
      patternId: `pat_${fp}`,
      fingerprint: fp,
      occurrences: 1,
      lastSeen: Date.now(),
      avgResolutionMinutes: resolutionMinutes,
      successfulRemediations: successActions,
    };
    patterns.push(newPattern);
    logger.info('New incident pattern recorded', { patternId: newPattern.patternId });
  }

  return patterns;
}

export async function verifyRecovery(
  incident: Incident,
  healthChecker: (service: string) => Promise<{ healthy: boolean; latencyMs: number }>,
  checkIntervalMs: number = 15_000,
  maxChecks: number = 8,
): Promise<{ recovered: boolean; details: { service: string; healthy: boolean; latencyMs: number }[] }> {
  logger.info('Starting recovery verification', { incidentId: incident.id, services: incident.affectedServices.length });

  const details: { service: string; healthy: boolean; latencyMs: number }[] = [];
  let allHealthy = false;

  for (let check = 0; check < maxChecks; check++) {
    details.length = 0;
    allHealthy = true;

    for (const service of incident.affectedServices) {
      try {
        const result = await healthChecker(service);
        details.push({ service, ...result });
        if (!result.healthy) allHealthy = false;
      } catch {
        details.push({ service, healthy: false, latencyMs: -1 });
        allHealthy = false;
      }
    }

    if (allHealthy) {
      logger.info('Recovery verified — all services healthy', { incidentId: incident.id, check: check + 1 });
      return { recovered: true, details };
    }

    if (check < maxChecks - 1) {
      await sleep(checkIntervalMs);
    }
  }

  logger.warn('Recovery verification failed', { incidentId: incident.id, unhealthy: details.filter(d => !d.healthy).length });
  return { recovered: false, details };
}

export interface ResponderConfig {
  serviceGraph: Map<string, string[]>;
  runbooks: Runbook[];
  escalationPolicies: Map<string, EscalationPolicy>;
  onCallSchedules: Map<string, OnCallSchedule>;
  slaPolicies?: SLAPolicy[];
  patterns: IncidentPattern[];
  executor: (step: RunbookStep, incident: Incident) => Promise<{ success: boolean; output: string }>;
  healthChecker: (service: string) => Promise<{ healthy: boolean; latencyMs: number }>;
  notifier: (payload: CommunicationPayload) => Promise<void>;
}

export async function handleIncident(signals: Signal[], config: ResponderConfig): Promise<Incident> {
  const deduped = deduplicateSignals(signals);
  if (deduped.length === 0) {
    logger.warn('All signals deduplicated — no incident created');
    throw new Error('No actionable signals after deduplication');
  }

  const clusters = correlateSignals(deduped, config.serviceGraph);
  const primaryCluster = clusters.reduce((a, b) => (a.signalIds.length >= b.signalIds.length ? a : b));

  const clusterSignals = deduped.filter(s => primaryCluster.signalIds.includes(s.id));
  const severityScore = classifySeverity(clusterSignals, config.serviceGraph);

  const affectedServices = [...new Set(clusterSignals.map(s => s.service))];
  const incidentId = `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const incident: Incident = {
    id: incidentId,
    title: `${severityScore.severity} — ${affectedServices.join(', ')} degradation`,
    status: IncidentStatus.Detected,
    severity: severityScore.severity,
    severityScore,
    signals: clusterSignals,
    correlationCluster: primaryCluster,
    rootCauses: [],
    timeline: [{ timestamp: Date.now(), type: 'status_change', description: 'Incident detected', actor: 'auto-responder' }],
    affectedServices,
    createdAt: Date.now(),
    remediationLog: [],
    tags: [],
  };

  logger.info('Incident created', { id: incidentId, severity: severityScore.severity, services: affectedServices });

  const addTimeline = (type: TimelineEntry['type'], description: string, meta?: Record<string, unknown>) =>
    incident.timeline.push({ timestamp: Date.now(), type, description, actor: 'auto-responder', metadata: meta });

  const safeNotify = (payload: CommunicationPayload) =>
    config.notifier(payload).catch(err => logger.error('Notification failed', err instanceof Error ? err : new Error(String(err))));

  for (const [teamId, schedule] of config.onCallSchedules) {
    const userId = resolveOnCall(schedule);
    if (userId) {
      incident.assignee = userId;
      incident.commander = userId;
      addTimeline('action', `Assigned to ${userId} (${teamId})`);
      break;
    }
  }

  incident.status = IncidentStatus.Triaged;
  addTimeline('status_change', 'Incident triaged');

  incident.rootCauses = analyzeRootCause(incident, config.serviceGraph, config.patterns);
  incident.status = IncidentStatus.Investigating;

  incident.slaBreachPrediction = predictSLABreach(incident, config.slaPolicies);
  if (incident.slaBreachPrediction) {
    logger.warn('SLA breach predicted', { incidentId, breachType: incident.slaBreachPrediction.breachType });
  }

  const policyKey = incident.severity <= Severity.P2 ? 'critical' : 'default';
  const escPolicy = config.escalationPolicies.get(policyKey);
  if (escPolicy) {
    const level = determineEscalationLevel(incident, escPolicy);
    if (level) {
      addTimeline('escalation', `Escalated to level ${level.level}: ${level.targets.join(', ')}`);
      await safeNotify(buildTeamNotification(incident, level.targets));
    }
  }

  if (incident.severity <= Severity.P2) {
    createWarRoom(incident, incident.commander ? [incident.commander] : []);
  }

  await safeNotify(buildStatusPageUpdate(incident));

  const topCause = incident.rootCauses[0];
  if (topCause && topCause.probability >= 0.6 && topCause.suggestedActions.length > 0) {
    const matchingRunbook = config.runbooks.find(rb =>
      topCause.suggestedActions.some(a => rb.steps.some(s => s.action === a)),
    );

    if (matchingRunbook && !matchingRunbook.requiresApproval) {
      incident.status = IncidentStatus.Remediating;
      addTimeline('action', `Executing runbook: ${matchingRunbook.name}`);

      const runbookResult = await executeRunbook(matchingRunbook, incident, config.executor);
      for (const step of matchingRunbook.steps) {
        const result = runbookResult.results.find(r => r.stepId === step.id);
        incident.remediationLog.push({
          action: step.action as RemediationAction,
          status: result?.success ? 'success' : 'failed',
          startedAt: Date.now(), completedAt: Date.now(),
        });
      }

      if (runbookResult.success) {
        const recovery = await verifyRecovery(incident, config.healthChecker);
        if (recovery.recovered) {
          incident.status = IncidentStatus.Resolved;
          incident.resolvedAt = Date.now();
          addTimeline('status_change', 'Incident resolved — recovery verified');
        } else {
          addTimeline('note', 'Remediation applied but recovery not confirmed');
        }
      }
    } else if (matchingRunbook?.requiresApproval) {
      addTimeline('note', `Runbook ${matchingRunbook.name} requires manual approval`);
    }
  }

  if (incident.status === IncidentStatus.Resolved) {
    incident.postMortem = generatePostMortem(incident);
    incident.status = IncidentStatus.PostMortem;
  }

  config.patterns = updatePatternDatabase(config.patterns, incident);
  await safeNotify(buildStatusPageUpdate(incident));

  logger.info('Incident handling complete', {
    id: incident.id, status: incident.status, severity: incident.severity,
    timelineEntries: incident.timeline.length, remediations: incident.remediationLog.length,
  });

  return incident;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
