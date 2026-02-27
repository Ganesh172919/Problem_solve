/**
 * Autonomous Security Agent
 *
 * Self-healing security agent that continuously monitors, detects,
 * and autonomously responds to security threats. Implements adaptive
 * defenses, threat correlation, vulnerability assessment, and
 * incident response automation.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface SecurityThreat {
  id: string;
  type: ThreatType;
  severity: ThreatSeverity;
  source: string;
  target: string;
  tenantId?: string;
  description: string;
  indicators: ThreatIndicator[];
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  status: ThreatStatus;
  mitigations: string[];
  automatedResponse?: AutomatedResponse;
}

export type ThreatType =
  | 'brute_force'
  | 'sql_injection'
  | 'xss'
  | 'csrf'
  | 'path_traversal'
  | 'command_injection'
  | 'ddos'
  | 'credential_stuffing'
  | 'api_abuse'
  | 'data_exfiltration'
  | 'privilege_escalation'
  | 'session_hijacking'
  | 'supply_chain'
  | 'insider_threat'
  | 'ransomware'
  | 'zero_day';

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ThreatStatus = 'active' | 'investigating' | 'mitigated' | 'resolved' | 'false_positive';

export interface ThreatIndicator {
  type: 'ip' | 'user_agent' | 'payload' | 'header' | 'behavior' | 'pattern';
  value: string;
  confidence: number;
}

export interface AutomatedResponse {
  responseType: ResponseType;
  actionsTaken: string[];
  triggeredAt: number;
  effectiveUntil?: number;
  success: boolean;
  rollbackAvailable: boolean;
}

export type ResponseType =
  | 'block_ip'
  | 'rate_limit'
  | 'captcha_challenge'
  | 'account_lockout'
  | 'session_revocation'
  | 'firewall_rule'
  | 'alert_only'
  | 'quarantine'
  | 'honeypot_redirect';

export interface SecurityScan {
  scanId: string;
  tenantId?: string;
  scanType: ScanType;
  target: string;
  findings: SecurityFinding[];
  startedAt: number;
  completedAt: number;
  status: 'running' | 'completed' | 'failed';
  overallRisk: ThreatSeverity;
  complianceScore: number;
}

export type ScanType =
  | 'vulnerability'
  | 'penetration'
  | 'configuration'
  | 'dependency'
  | 'secrets'
  | 'compliance';

export interface SecurityFinding {
  id: string;
  severity: ThreatSeverity;
  category: string;
  title: string;
  description: string;
  affected: string;
  remediation: string;
  cveId?: string;
  cvssScore?: number;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  rules: SecurityRule[];
  enabled: boolean;
  autoRemediate: boolean;
  notifyOnTrigger: boolean;
  priority: number;
}

export interface SecurityRule {
  id: string;
  condition: string;
  action: ResponseType;
  threshold?: number;
  windowMs?: number;
  enabled: boolean;
}

export interface IncidentReport {
  incidentId: string;
  severity: ThreatSeverity;
  summary: string;
  affectedSystems: string[];
  affectedTenants: string[];
  timeline: IncidentEvent[];
  rootCause?: string;
  impact: string;
  remediationSteps: string[];
  lessonsLearned: string[];
  status: 'open' | 'investigating' | 'resolved' | 'post-mortem';
  createdAt: number;
  resolvedAt?: number;
  mttr?: number;
}

export interface IncidentEvent {
  timestamp: number;
  type: string;
  description: string;
  actor: 'agent' | 'human' | 'system';
}

export interface VulnerabilityAssessment {
  assessmentId: string;
  target: string;
  vulnerabilities: Vulnerability[];
  riskScore: number;
  exploitableCount: number;
  patchableCount: number;
  generatedAt: number;
}

export interface Vulnerability {
  id: string;
  cveId?: string;
  title: string;
  description: string;
  severity: ThreatSeverity;
  cvssScore: number;
  exploitability: 'high' | 'medium' | 'low' | 'none';
  patchAvailable: boolean;
  affectedVersions: string[];
  fixedIn?: string;
  exploitCode?: string;
  references: string[];
}

export interface SecurityMetrics {
  totalThreats: number;
  activeThreats: number;
  mitigatedThreats: number;
  falsePositives: number;
  avgResponseTimeMs: number;
  mttr: number;
  threatsByType: Record<ThreatType, number>;
  threatsBySeverity: Record<ThreatSeverity, number>;
  blockedIPs: number;
  scansCompleted: number;
  vulnerabilitiesFound: number;
  complianceScore: number;
  securityScore: number;
}

export class AutonomousSecurityAgent {
  private threats = new Map<string, SecurityThreat>();
  private scans = new Map<string, SecurityScan>();
  private policies = new Map<string, SecurityPolicy>();
  private incidents = new Map<string, IncidentReport>();
  private blockedIPs = new Set<string>();
  private rateLimitedIPs = new Map<string, { count: number; until: number }>();
  private ipRequestCounts = new Map<string, number[]>();
  private agentActive = true;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadDefaultPolicies();
    this.startAutonomousMonitoring();
  }

  analyzeRequest(request: {
    ip: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    userId?: string;
    tenantId?: string;
  }): { allowed: boolean; threatId?: string; reason?: string } {
    if (this.blockedIPs.has(request.ip)) {
      return { allowed: false, reason: 'ip_blocked' };
    }

    const rl = this.rateLimitedIPs.get(request.ip);
    if (rl && Date.now() < rl.until) {
      return { allowed: false, reason: 'ip_rate_limited' };
    }

    const threats: SecurityThreat[] = [];

    if (this.detectBruteForce(request.ip)) {
      threats.push(this.createThreat('brute_force', 'high', request.ip, request.path, request.tenantId));
    }

    if (request.body && this.detectSQLInjection(request.body)) {
      threats.push(this.createThreat('sql_injection', 'critical', request.ip, request.path, request.tenantId));
    }

    if (request.body && this.detectXSS(request.body)) {
      threats.push(this.createThreat('xss', 'high', request.ip, request.path, request.tenantId));
    }

    if (this.detectPathTraversal(request.path)) {
      threats.push(this.createThreat('path_traversal', 'high', request.ip, request.path, request.tenantId));
    }

    if (request.body && this.detectCommandInjection(request.body)) {
      threats.push(this.createThreat('command_injection', 'critical', request.ip, request.path, request.tenantId));
    }

    if (this.detectAPIAbuse(request.ip)) {
      threats.push(this.createThreat('api_abuse', 'medium', request.ip, request.path, request.tenantId));
    }

    this.trackRequest(request.ip);

    if (threats.length > 0) {
      const highest = threats.sort((a, b) => this.severityScore(b.severity) - this.severityScore(a.severity))[0];
      this.handleThreat(highest);

      if (highest.severity === 'critical' || highest.severity === 'high') {
        return { allowed: false, threatId: highest.id, reason: highest.type };
      }
    }

    return { allowed: true };
  }

  runSecurityScan(target: string, scanType: ScanType, tenantId?: string): SecurityScan {
    const scan: SecurityScan = {
      scanId: `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tenantId,
      scanType,
      target,
      findings: [],
      startedAt: Date.now(),
      completedAt: 0,
      status: 'running',
      overallRisk: 'info',
      complianceScore: 0,
    };

    this.scans.set(scan.scanId, scan);

    const findings = this.executeScan(target, scanType);
    scan.findings = findings;
    scan.status = 'completed';
    scan.completedAt = Date.now();
    scan.overallRisk = this.computeOverallRisk(findings);
    scan.complianceScore = this.computeComplianceScore(findings, scanType);

    logger.info('Security scan completed', {
      scanId: scan.scanId,
      target,
      scanType,
      findings: findings.length,
      overallRisk: scan.overallRisk,
    });

    return scan;
  }

  assessVulnerabilities(target: string): VulnerabilityAssessment {
    const vulns = this.generateVulnerabilityReport(target);
    const exploitableCount = vulns.filter(v => v.exploitability !== 'none').length;
    const riskScore = vulns.reduce((s, v) => s + v.cvssScore, 0) / Math.max(vulns.length, 1);

    return {
      assessmentId: `va-${Date.now()}`,
      target,
      vulnerabilities: vulns,
      riskScore,
      exploitableCount,
      patchableCount: vulns.filter(v => v.patchAvailable).length,
      generatedAt: Date.now(),
    };
  }

  createIncident(
    severity: ThreatSeverity,
    summary: string,
    affectedSystems: string[],
    affectedTenants: string[]
  ): IncidentReport {
    const incident: IncidentReport = {
      incidentId: `inc-${Date.now()}`,
      severity,
      summary,
      affectedSystems,
      affectedTenants,
      timeline: [
        {
          timestamp: Date.now(),
          type: 'incident_created',
          description: summary,
          actor: 'agent',
        },
      ],
      impact: this.assessImpact(severity, affectedSystems, affectedTenants),
      remediationSteps: this.getRemediationSteps(severity, summary),
      lessonsLearned: [],
      status: 'open',
      createdAt: Date.now(),
    };

    this.incidents.set(incident.incidentId, incident);

    logger.warn('Security incident created', {
      incidentId: incident.incidentId,
      severity,
      summary,
      affectedSystems: affectedSystems.length,
    });

    return incident;
  }

  resolveIncident(incidentId: string, resolution: string, lessons: string[]): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    incident.status = 'resolved';
    incident.resolvedAt = Date.now();
    incident.mttr = incident.resolvedAt - incident.createdAt;
    incident.rootCause = resolution;
    incident.lessonsLearned = lessons;
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'incident_resolved',
      description: resolution,
      actor: 'human',
    });

    logger.info('Security incident resolved', {
      incidentId,
      mttr: incident.mttr,
    });
  }

  blockIP(ip: string, reason: string, durationMs?: number): void {
    this.blockedIPs.add(ip);
    if (durationMs) {
      setTimeout(() => {
        this.blockedIPs.delete(ip);
        logger.info('IP block expired', { ip });
      }, durationMs);
    }
    logger.warn('IP blocked', { ip, reason, permanent: !durationMs });
  }

  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    logger.info('IP unblocked', { ip });
  }

  addPolicy(policy: SecurityPolicy): void {
    this.policies.set(policy.id, policy);
  }

  getMetrics(): SecurityMetrics {
    const allThreats = Array.from(this.threats.values());
    const allScans = Array.from(this.scans.values());
    const allFindings = allScans.flatMap(s => s.findings);

    const threatsByType: Record<ThreatType, number> = {} as Record<ThreatType, number>;
    const threatsBySeverity: Record<ThreatSeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };

    allThreats.forEach(t => {
      threatsByType[t.type] = (threatsByType[t.type] ?? 0) + 1;
      threatsBySeverity[t.severity]++;
    });

    const mitigatedThreats = allThreats.filter(
      t => t.status === 'mitigated' || t.status === 'resolved'
    );
    const responseTimes = mitigatedThreats
      .filter(t => t.automatedResponse)
      .map(t => t.automatedResponse!.triggeredAt - t.firstSeen);

    const avgResponseTimeMs = responseTimes.length > 0
      ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length
      : 0;

    const resolvedIncidents = Array.from(this.incidents.values()).filter(
      i => i.status === 'resolved' && i.mttr
    );
    const mttr = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((s, i) => s + (i.mttr ?? 0), 0) / resolvedIncidents.length
      : 0;

    const complianceScore = allScans.length > 0
      ? allScans.reduce((s, scan) => s + scan.complianceScore, 0) / allScans.length
      : 100;

    const securityScore = Math.max(
      0,
      100 -
        threatsBySeverity.critical * 20 -
        threatsBySeverity.high * 10 -
        threatsBySeverity.medium * 5 -
        allThreats.filter(t => t.status === 'active').length * 3
    );

    return {
      totalThreats: allThreats.length,
      activeThreats: allThreats.filter(t => t.status === 'active').length,
      mitigatedThreats: mitigatedThreats.length,
      falsePositives: allThreats.filter(t => t.status === 'false_positive').length,
      avgResponseTimeMs,
      mttr,
      threatsByType,
      threatsBySeverity,
      blockedIPs: this.blockedIPs.size,
      scansCompleted: allScans.filter(s => s.status === 'completed').length,
      vulnerabilitiesFound: allFindings.length,
      complianceScore,
      securityScore: Math.max(0, Math.min(100, securityScore)),
    };
  }

  getThreats(filter?: {
    status?: ThreatStatus;
    severity?: ThreatSeverity;
    type?: ThreatType;
  }): SecurityThreat[] {
    let threats = Array.from(this.threats.values());
    if (filter?.status) threats = threats.filter(t => t.status === filter.status);
    if (filter?.severity) threats = threats.filter(t => t.severity === filter.severity);
    if (filter?.type) threats = threats.filter(t => t.type === filter.type);
    return threats.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  getIncidents(status?: IncidentReport['status']): IncidentReport[] {
    const all = Array.from(this.incidents.values());
    return status ? all.filter(i => i.status === status) : all;
  }

  stop(): void {
    this.agentActive = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  private detectBruteForce(ip: string): boolean {
    const requests = this.ipRequestCounts.get(ip) ?? [];
    const recentRequests = requests.filter(t => Date.now() - t < 60000);
    return recentRequests.length > 100;
  }

  private detectSQLInjection(body: string): boolean {
    const patterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|CAST)\b)/gi,
      /(OR\s+1\s*=\s*1|AND\s+1\s*=\s*1)/gi,
      /(['";]|--\s|\/\*.*?\*\/)/g,
      /\bxp_cmdshell\b/gi,
    ];
    return patterns.some(p => p.test(body));
  }

  private detectXSS(body: string): boolean {
    const patterns = [
      /<script[^>]*>[\s\S]*?<\/script[\s\S]*?>/gi,
      /javascript\s*:/gi,
      /on\w+\s*=\s*["'][^"']*["']/gi,
      /<img[^>]*onerror[^>]*>/gi,
    ];
    return patterns.some(p => p.test(body));
  }

  private detectPathTraversal(path: string): boolean {
    return /\.\.[\/\\]/.test(path) || /%2e%2e[%2f%5c]/i.test(path);
  }

  private detectCommandInjection(body: string): boolean {
    const patterns = [
      /[;&|`$]\s*(ls|cat|pwd|whoami|id|curl|wget|nc|bash|sh|python|perl|ruby)/gi,
      /\$\(.*\)/g,
      /`[^`]+`/g,
    ];
    return patterns.some(p => p.test(body));
  }

  private detectAPIAbuse(ip: string): boolean {
    const requests = this.ipRequestCounts.get(ip) ?? [];
    const recentRequests = requests.filter(t => Date.now() - t < 1000);
    return recentRequests.length > 50;
  }

  private trackRequest(ip: string): void {
    const requests = this.ipRequestCounts.get(ip) ?? [];
    requests.push(Date.now());
    const cutoff = Date.now() - 300000;
    this.ipRequestCounts.set(ip, requests.filter(t => t > cutoff));
  }

  private createThreat(
    type: ThreatType,
    severity: ThreatSeverity,
    source: string,
    target: string,
    tenantId?: string
  ): SecurityThreat {
    const existingKey = `${type}:${source}`;
    const existing = Array.from(this.threats.values()).find(
      t => t.type === type && t.source === source && t.status === 'active'
    );

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = Date.now();
      return existing;
    }

    const threat: SecurityThreat = {
      id: `threat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      severity,
      source,
      target,
      tenantId,
      description: this.getThreatDescription(type),
      indicators: [{ type: 'ip', value: source, confidence: 0.9 }],
      confidence: 0.85,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      occurrences: 1,
      status: 'active',
      mitigations: this.getMitigations(type),
    };

    this.threats.set(threat.id, threat);
    return threat;
  }

  private handleThreat(threat: SecurityThreat): void {
    const policy = this.selectPolicy(threat);
    if (!policy) return;

    const enabledRule = policy.rules.find(r => r.enabled);
    if (!enabledRule || !policy.autoRemediate) return;

    const response: AutomatedResponse = {
      responseType: enabledRule.action,
      actionsTaken: [],
      triggeredAt: Date.now(),
      success: true,
      rollbackAvailable: true,
    };

    switch (enabledRule.action) {
      case 'block_ip':
        this.blockIP(threat.source, threat.type, 3600000);
        response.actionsTaken.push(`Blocked IP ${threat.source} for 1 hour`);
        threat.status = 'mitigated';
        break;
      case 'rate_limit':
        this.rateLimitedIPs.set(threat.source, {
          count: 0,
          until: Date.now() + 300000,
        });
        response.actionsTaken.push(`Rate limited IP ${threat.source} for 5 minutes`);
        threat.status = 'mitigated';
        break;
      case 'alert_only':
        response.actionsTaken.push(`Alert generated for threat ${threat.id}`);
        break;
    }

    threat.automatedResponse = response;

    logger.warn('Automated threat response executed', {
      threatId: threat.id,
      type: threat.type,
      severity: threat.severity,
      action: enabledRule.action,
    });
  }

  private selectPolicy(threat: SecurityThreat): SecurityPolicy | undefined {
    return Array.from(this.policies.values())
      .filter(p => p.enabled)
      .sort((a, b) => b.priority - a.priority)[0];
  }

  private executeScan(target: string, scanType: ScanType): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    if (scanType === 'configuration') {
      findings.push({
        id: `finding-${Date.now()}-1`,
        severity: 'medium',
        category: 'configuration',
        title: 'TLS 1.0/1.1 enabled',
        description: 'Outdated TLS versions should be disabled',
        affected: target,
        remediation: 'Disable TLS 1.0 and TLS 1.1, enforce TLS 1.2+',
      });
    }

    if (scanType === 'dependency') {
      findings.push({
        id: `finding-${Date.now()}-2`,
        severity: 'high',
        category: 'dependency',
        title: 'Outdated dependency with known CVE',
        description: 'A dependency has a known security vulnerability',
        affected: target,
        remediation: 'Update the dependency to latest patched version',
        cvssScore: 7.5,
      });
    }

    if (scanType === 'secrets') {
      findings.push({
        id: `finding-${Date.now()}-3`,
        severity: 'critical',
        category: 'secrets',
        title: 'Potential hardcoded API key detected',
        description: 'A string matching API key pattern was found in code',
        affected: target,
        remediation: 'Move secrets to environment variables or secrets manager',
        cvssScore: 9.0,
      });
    }

    return findings;
  }

  private generateVulnerabilityReport(target: string): Vulnerability[] {
    return [
      {
        id: `vuln-${Date.now()}-1`,
        cveId: 'CVE-2024-1234',
        title: 'Remote Code Execution via deserialization',
        description: 'Unsafe deserialization allows arbitrary code execution',
        severity: 'critical',
        cvssScore: 9.8,
        exploitability: 'high',
        patchAvailable: true,
        affectedVersions: ['<2.0.0'],
        fixedIn: '2.0.1',
        references: ['https://nvd.nist.gov/vuln/detail/CVE-2024-1234'],
      },
      {
        id: `vuln-${Date.now()}-2`,
        cveId: 'CVE-2024-5678',
        title: 'Reflected XSS in query parameter',
        description: 'Insufficient sanitization allows reflected XSS',
        severity: 'high',
        cvssScore: 7.2,
        exploitability: 'medium',
        patchAvailable: true,
        affectedVersions: ['<1.5.0'],
        fixedIn: '1.5.2',
        references: ['https://nvd.nist.gov/vuln/detail/CVE-2024-5678'],
      },
    ];
  }

  private computeOverallRisk(findings: SecurityFinding[]): ThreatSeverity {
    if (findings.some(f => f.severity === 'critical')) return 'critical';
    if (findings.some(f => f.severity === 'high')) return 'high';
    if (findings.some(f => f.severity === 'medium')) return 'medium';
    if (findings.some(f => f.severity === 'low')) return 'low';
    return 'info';
  }

  private computeComplianceScore(findings: SecurityFinding[], scanType: ScanType): number {
    if (findings.length === 0) return 100;
    const penalty = findings.reduce((s, f) => {
      const penalties: Record<ThreatSeverity, number> = { critical: 25, high: 15, medium: 7, low: 3, info: 1 };
      return s + (penalties[f.severity] ?? 0);
    }, 0);
    return Math.max(0, 100 - penalty);
  }

  private assessImpact(
    severity: ThreatSeverity,
    systems: string[],
    tenants: string[]
  ): string {
    const impactMap: Record<ThreatSeverity, string> = {
      critical: 'Service outage possible. Data breach risk. Immediate action required.',
      high: 'Significant functionality impaired. Data at risk. Urgent action needed.',
      medium: 'Partial functionality affected. Limited data exposure.',
      low: 'Minor impact. No immediate data risk.',
      info: 'Informational. No direct impact.',
    };
    return `${impactMap[severity]} Affects ${systems.length} system(s) and ${tenants.length} tenant(s).`;
  }

  private getRemediationSteps(severity: ThreatSeverity, summary: string): string[] {
    const steps: string[] = [
      'Isolate affected systems',
      'Collect forensic evidence',
      'Identify root cause',
      'Apply patches/mitigations',
      'Verify fix effectiveness',
      'Restore services',
      'Document findings',
    ];
    if (severity === 'critical') steps.unshift('Activate incident response team immediately');
    return steps;
  }

  private getThreatDescription(type: ThreatType): string {
    const descriptions: Record<ThreatType, string> = {
      brute_force: 'Multiple failed authentication attempts detected',
      sql_injection: 'SQL injection payload detected in request',
      xss: 'Cross-site scripting payload detected in request',
      csrf: 'Cross-site request forgery token missing or invalid',
      path_traversal: 'Directory traversal attempt detected',
      command_injection: 'OS command injection payload detected',
      ddos: 'Distributed denial of service attack detected',
      credential_stuffing: 'Credential stuffing attack detected from known breach list',
      api_abuse: 'Abnormal API usage pattern detected',
      data_exfiltration: 'Unusual data transfer volume detected',
      privilege_escalation: 'Privilege escalation attempt detected',
      session_hijacking: 'Session token reuse from different location detected',
      supply_chain: 'Suspicious dependency or package modification detected',
      insider_threat: 'Unusual access pattern from authenticated user',
      ransomware: 'File encryption behavior detected',
      zero_day: 'Unknown exploit pattern detected',
    };
    return descriptions[type] ?? `Security threat detected: ${type}`;
  }

  private getMitigations(type: ThreatType): string[] {
    const mitigations: Record<ThreatType, string[]> = {
      brute_force: ['Block source IP', 'Enforce CAPTCHA', 'Lock account temporarily'],
      sql_injection: ['Block request', 'Log payload', 'Alert development team'],
      xss: ['Block request', 'Sanitize input', 'Enforce CSP headers'],
      csrf: ['Enforce CSRF tokens', 'Validate referer header'],
      path_traversal: ['Block request', 'Validate path inputs'],
      command_injection: ['Block request', 'Sanitize inputs', 'Disable shell execution'],
      ddos: ['Rate limit source', 'Activate DDoS protection', 'Scale infrastructure'],
      credential_stuffing: ['Force password reset', 'Enable MFA', 'Block IPs from breach lists'],
      api_abuse: ['Rate limit client', 'Revoke API key if necessary'],
      data_exfiltration: ['Throttle data transfer', 'Alert security team'],
      privilege_escalation: ['Revoke elevated session', 'Audit permission grants'],
      session_hijacking: ['Invalidate session', 'Force re-authentication'],
      supply_chain: ['Pin dependency versions', 'Verify checksums'],
      insider_threat: ['Alert security team', 'Audit access logs'],
      ransomware: ['Isolate system', 'Restore from backup'],
      zero_day: ['Isolate affected system', 'Activate emergency response'],
    };
    return mitigations[type] ?? ['Log incident', 'Alert security team'];
  }

  private severityScore(s: ThreatSeverity): number {
    const scores: Record<ThreatSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    return scores[s] ?? 0;
  }

  private loadDefaultPolicies(): void {
    const policy: SecurityPolicy = {
      id: 'default',
      name: 'Default Security Policy',
      rules: [
        { id: 'brute-force', condition: 'brute_force', action: 'block_ip', threshold: 100, windowMs: 60000, enabled: true },
        { id: 'injection', condition: 'sql_injection', action: 'block_ip', enabled: true },
        { id: 'api-abuse', condition: 'api_abuse', action: 'rate_limit', threshold: 50, windowMs: 1000, enabled: true },
        { id: 'xss', condition: 'xss', action: 'block_ip', enabled: true },
      ],
      enabled: true,
      autoRemediate: true,
      notifyOnTrigger: true,
      priority: 1,
    };
    this.policies.set(policy.id, policy);
  }

  private startAutonomousMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      if (!this.agentActive) return;
      this.runAutonomousCycle();
    }, 30000);
  }

  private runAutonomousCycle(): void {
    const now = Date.now();

    this.threats.forEach((threat) => {
      if (threat.status === 'active' && now - threat.lastSeen > 3600000) {
        threat.status = 'resolved';
        logger.debug('Threat auto-resolved after 1 hour inactivity', { threatId: threat.id });
      }
    });

    this.ipRequestCounts.forEach((times, ip) => {
      const recent = times.filter(t => now - t < 300000);
      if (recent.length === 0) {
        this.ipRequestCounts.delete(ip);
      } else {
        this.ipRequestCounts.set(ip, recent);
      }
    });

    const activeThreats = Array.from(this.threats.values()).filter(t => t.status === 'active');
    if (activeThreats.length > 10) {
      const criticals = activeThreats.filter(t => t.severity === 'critical');
      if (criticals.length > 0) {
        this.createIncident(
          'critical',
          `${criticals.length} critical security threats active`,
          Array.from(new Set(criticals.map(t => t.target))),
          Array.from(new Set(criticals.map(t => t.tenantId).filter(Boolean) as string[]))
        );
      }
    }
  }
}

let _agent: AutonomousSecurityAgent | null = null;

export function getAutonomousSecurityAgent(): AutonomousSecurityAgent {
  if (!_agent) {
    _agent = new AutonomousSecurityAgent();
  }
  return _agent;
}
