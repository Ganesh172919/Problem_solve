/**
 * Enterprise Security Audit Engine
 *
 * Provides:
 * - Enterprise security audit automation
 * - Vulnerability scanning (weak passwords, exposed endpoints, stale tokens)
 * - Access pattern anomaly detection (deviation from baseline)
 * - Compliance gap analysis (SOC2, GDPR, HIPAA controls mapping)
 * - Security score calculation (0-100 weighted)
 * - Remediation workflows with priority ordering
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SecurityScan {
  id: string;
  name: string;
  type: 'full' | 'vulnerability' | 'compliance' | 'access' | 'configuration';
  status: 'pending' | 'running' | 'completed' | 'failed';
  targetScope: string[];
  startedAt?: Date;
  completedAt?: Date;
  vulnerabilities: Vulnerability[];
  anomalies: AccessAnomaly[];
  complianceGaps: ComplianceControl[];
  score: SecurityScore;
  createdAt: Date;
}

export interface Vulnerability {
  id: string;
  scanId: string;
  type: 'weak-password' | 'exposed-endpoint' | 'stale-token' | 'misconfiguration' | 'missing-encryption' | 'sql-injection-risk' | 'xss-risk' | 'csrf-risk' | 'open-redirect' | 'insecure-dependency' | 'privilege-escalation' | 'data-exposure';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  title: string;
  description: string;
  affectedResource: string;
  evidence: string;
  cvssScore?: number; // 0-10
  cveId?: string;
  status: 'open' | 'acknowledged' | 'remediated' | 'accepted-risk' | 'false-positive';
  remediationSteps: string[];
  detectedAt: Date;
  updatedAt: Date;
}

export interface ComplianceControl {
  id: string;
  framework: 'SOC2' | 'GDPR' | 'HIPAA';
  controlId: string;
  controlName: string;
  description: string;
  category: string;
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable' | 'unknown';
  evidence?: string;
  gaps: string[];
  remediationRequired: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  lastAssessedAt: Date;
}

export interface AccessAnomaly {
  id: string;
  userId?: string;
  ipAddress?: string;
  type: 'unusual-hour' | 'geo-anomaly' | 'high-frequency' | 'privilege-escalation' | 'data-exfiltration' | 'brute-force' | 'concurrent-session' | 'impossible-travel';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  baselineValue: number;
  observedValue: number;
  deviationPercent: number;
  context: Record<string, unknown>;
  detectedAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface SecurityScore {
  overall: number; // 0-100
  components: Array<{
    category: 'vulnerability' | 'compliance' | 'access-control' | 'configuration' | 'data-protection';
    score: number;
    weight: number;
    weightedScore: number;
    details: string;
  }>;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  trend: 'improving' | 'stable' | 'degrading';
  calculatedAt: Date;
}

export interface RemediationWorkflow {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in-progress' | 'pending-review' | 'completed' | 'deferred';
  assignedTo?: string;
  linkedVulnerabilities: string[];
  linkedControls: string[];
  steps: Array<{
    order: number;
    title: string;
    description: string;
    status: 'pending' | 'completed' | 'skipped';
    completedAt?: Date;
    completedBy?: string;
  }>;
  estimatedEffortHours: number;
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditReport {
  id: string;
  title: string;
  generatedFor: string; // organization/system name
  period: { start: Date; end: Date };
  executiveSummary: string;
  securityScore: SecurityScore;
  vulnerabilitySummary: {
    total: number;
    bySeverity: Record<Vulnerability['severity'], number>;
    byType: Record<string, number>;
    openCount: number;
    remediatedCount: number;
  };
  complianceSummary: {
    frameworks: Array<{
      framework: 'SOC2' | 'GDPR' | 'HIPAA';
      totalControls: number;
      compliantCount: number;
      partialCount: number;
      nonCompliantCount: number;
      complianceRate: number;
    }>;
  };
  anomalySummary: {
    total: number;
    bySeverity: Record<AccessAnomaly['severity'], number>;
    resolvedCount: number;
  };
  topRisks: Array<{ rank: number; description: string; severity: string; recommendation: string }>;
  remediationWorkflows: RemediationWorkflow[];
  generatedAt: Date;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class EnterpriseSecurityAuditEngine {
  private scans: Map<string, SecurityScan> = new Map();
  private vulnerabilities: Map<string, Vulnerability> = new Map();
  private controls: Map<string, ComplianceControl> = new Map();
  private anomalies: Map<string, AccessAnomaly> = new Map();
  private workflows: Map<string, RemediationWorkflow> = new Map();
  private accessBaselines: Map<string, { hourly: number[]; dailyRequestAvg: number; typicalGeos: string[] }> = new Map();
  private scoreHistory: Array<{ score: number; calculatedAt: Date }> = [];

  // ─── Baseline Management ──────────────────────────────────────────────────

  setAccessBaseline(userId: string, baseline: { hourly: number[]; dailyRequestAvg: number; typicalGeos: string[] }): void {
    this.accessBaselines.set(userId, baseline);
  }

  // ─── Vulnerability Scanning ───────────────────────────────────────────────

  runSecurityScan(
    scanId: string,
    scanName: string,
    type: SecurityScan['type'],
    targetScope: string[],
    scanInput: {
      passwords?: Array<{ resource: string; hash: string; lastChanged: Date; complexity?: number }>;
      endpoints?: Array<{ url: string; method: string; authenticated: boolean; rateLimit: boolean; httpsOnly: boolean }>;
      tokens?: Array<{ id: string; resource: string; issuedAt: Date; lastUsed?: Date; scope: string[]; neverExpires: boolean }>;
      configs?: Array<{ resource: string; settings: Record<string, unknown> }>;
    },
  ): SecurityScan {
    logger.info('Security scan started', { scanId, type, scope: targetScope.length });

    const vulnerabilities: Vulnerability[] = [];
    const now = new Date();

    // ── Weak password detection ──
    if (scanInput.passwords) {
      for (const pwd of scanInput.passwords) {
        const complexity = pwd.complexity ?? 0;
        const ageMs = now.getTime() - pwd.lastChanged.getTime();
        const ageDays = ageMs / (1000 * 3600 * 24);

        if (complexity < 3) {
          vulnerabilities.push(this.createVulnerability(scanId, 'weak-password', 'high',
            'Weak Password Policy',
            `Resource ${pwd.resource} is protected by a weak password (complexity score: ${complexity}/5).`,
            pwd.resource, `Complexity score ${complexity}/5, last changed ${Math.round(ageDays)} days ago`,
            ['Enforce minimum 12-character passwords with uppercase, lowercase, numbers, and symbols', 'Enable MFA immediately', 'Force password reset'],
            7.5));
        }
        if (ageDays > 90) {
          vulnerabilities.push(this.createVulnerability(scanId, 'stale-token', 'medium',
            'Stale Password — Exceeds Rotation Policy',
            `Password for ${pwd.resource} has not been changed in ${Math.round(ageDays)} days.`,
            pwd.resource, `Age: ${Math.round(ageDays)} days (policy: 90 days max)`,
            ['Enforce 90-day password rotation policy', 'Send rotation reminder notifications', 'Implement automated rotation for service accounts'],
            4.5));
        }
      }
    }

    // ── Exposed endpoint detection ──
    if (scanInput.endpoints) {
      for (const ep of scanInput.endpoints) {
        if (!ep.httpsOnly) {
          vulnerabilities.push(this.createVulnerability(scanId, 'exposed-endpoint', 'critical',
            'Endpoint Accessible Over HTTP',
            `Endpoint ${ep.method} ${ep.url} allows unencrypted HTTP traffic.`,
            ep.url, 'HTTP traffic allowed — data in transit unencrypted',
            ['Enforce HTTPS with HSTS', 'Redirect all HTTP to HTTPS', 'Configure TLS 1.2+ only'],
            9.0));
        }
        if (!ep.authenticated) {
          vulnerabilities.push(this.createVulnerability(scanId, 'exposed-endpoint', 'high',
            'Unauthenticated Endpoint Exposure',
            `Endpoint ${ep.method} ${ep.url} is publicly accessible without authentication.`,
            ep.url, 'No authentication required',
            ['Add authentication middleware', 'Implement API key or JWT validation', 'Review if endpoint requires public access'],
            8.0));
        }
        if (!ep.rateLimit) {
          vulnerabilities.push(this.createVulnerability(scanId, 'misconfiguration', 'medium',
            'Missing Rate Limiting',
            `Endpoint ${ep.method} ${ep.url} has no rate limiting — susceptible to abuse.`,
            ep.url, 'No rate limit configured',
            ['Implement rate limiting (e.g., 100 req/min per IP)', 'Add progressive backoff on repeated failures', 'Monitor for abuse patterns'],
            5.0));
        }
      }
    }

    // ── Stale token detection ──
    if (scanInput.tokens) {
      for (const token of scanInput.tokens) {
        const ageDays = (now.getTime() - token.issuedAt.getTime()) / (1000 * 3600 * 24);
        if (token.neverExpires && ageDays > 180) {
          vulnerabilities.push(this.createVulnerability(scanId, 'stale-token', 'high',
            'Non-Expiring Token — Long-Lived',
            `Token ${token.id} for ${token.resource} was issued ${Math.round(ageDays)} days ago and never expires.`,
            token.resource, `Token age: ${Math.round(ageDays)} days, never expires, scopes: ${token.scope.join(', ')}`,
            ['Set token expiration (max 90 days)', 'Rotate non-expiring tokens immediately', 'Implement token refresh flow'],
            7.0));
        }
        if (!token.lastUsed && ageDays > 30) {
          vulnerabilities.push(this.createVulnerability(scanId, 'stale-token', 'low',
            'Unused Token — Possible Orphan',
            `Token ${token.id} for ${token.resource} was never used and is ${Math.round(ageDays)} days old.`,
            token.resource, `Never used, age: ${Math.round(ageDays)} days`,
            ['Revoke unused tokens', 'Audit all tokens for active use', 'Implement token usage monitoring'],
            3.0));
        }
        if (token.scope.includes('admin') || token.scope.includes('write:all') || token.scope.includes('superuser')) {
          vulnerabilities.push(this.createVulnerability(scanId, 'privilege-escalation', 'high',
            'Overly Broad Token Scope',
            `Token ${token.id} for ${token.resource} has administrative/broad scopes.`,
            token.resource, `Scopes: ${token.scope.join(', ')}`,
            ['Apply principle of least privilege', 'Narrow token scopes to minimum required', 'Audit and rotate broad-scope tokens'],
            7.5));
        }
      }
    }

    // ── Configuration misconfiguration checks ──
    if (scanInput.configs) {
      for (const cfg of scanInput.configs) {
        const { settings } = cfg;
        if (settings['debug'] === true || settings['debugMode'] === true) {
          vulnerabilities.push(this.createVulnerability(scanId, 'misconfiguration', 'high',
            'Debug Mode Enabled in Production',
            `Resource ${cfg.resource} has debug mode enabled — may expose stack traces and internal info.`,
            cfg.resource, 'debug=true detected',
            ['Disable debug mode in production', 'Use environment-specific configurations', 'Review error handling to prevent info leakage'],
            7.0));
        }
        if (settings['allowOrigin'] === '*') {
          vulnerabilities.push(this.createVulnerability(scanId, 'misconfiguration', 'medium',
            'Permissive CORS Policy',
            `Resource ${cfg.resource} allows all origins (Access-Control-Allow-Origin: *).`,
            cfg.resource, 'CORS: Access-Control-Allow-Origin: *',
            ['Restrict CORS to known domains', 'Validate Origin header', 'Use allowlist approach for CORS configuration'],
            5.5));
        }
        if (settings['encryptionAtRest'] === false || settings['encryption'] === false) {
          vulnerabilities.push(this.createVulnerability(scanId, 'missing-encryption', 'critical',
            'Missing Encryption at Rest',
            `Resource ${cfg.resource} stores data without encryption at rest.`,
            cfg.resource, 'encryptionAtRest=false detected',
            ['Enable AES-256 encryption at rest', 'Encrypt database backups', 'Use cloud-native encryption (e.g., AWS KMS, GCP CMEK)'],
            9.5));
        }
        if (settings['mfaRequired'] === false) {
          vulnerabilities.push(this.createVulnerability(scanId, 'misconfiguration', 'high',
            'MFA Not Required',
            `Resource ${cfg.resource} does not enforce multi-factor authentication.`,
            cfg.resource, 'mfaRequired=false',
            ['Enforce MFA for all users', 'Require MFA for admin accounts immediately', 'Consider hardware keys for privileged access'],
            7.5));
        }
      }
    }

    vulnerabilities.forEach((v) => this.vulnerabilities.set(v.id, v));

    const score = this.calculateSecurityScore(vulnerabilities, [], []);
    this.scoreHistory.push({ score: score.overall, calculatedAt: now });

    const scan: SecurityScan = {
      id: scanId,
      name: scanName,
      type,
      status: 'completed',
      targetScope,
      startedAt: now,
      completedAt: new Date(),
      vulnerabilities,
      anomalies: [],
      complianceGaps: [],
      score,
      createdAt: now,
    };

    this.scans.set(scanId, scan);
    logger.info('Security scan completed', { scanId, vulnerabilityCount: vulnerabilities.length, score: score.overall });
    return scan;
  }

  private createVulnerability(
    scanId: string,
    type: Vulnerability['type'],
    severity: Vulnerability['severity'],
    title: string,
    description: string,
    affectedResource: string,
    evidence: string,
    remediationSteps: string[],
    cvssScore?: number,
  ): Vulnerability {
    const id = `vuln:${scanId}:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    return {
      id,
      scanId,
      type,
      severity,
      title,
      description,
      affectedResource,
      evidence,
      cvssScore,
      status: 'open',
      remediationSteps,
      detectedAt: now,
      updatedAt: now,
    };
  }

  // ─── Access Anomaly Detection ─────────────────────────────────────────────

  detectAccessAnomalies(
    events: Array<{
      userId: string;
      ipAddress: string;
      timestamp: Date;
      requestCount: number;
      geoCountry?: string;
      hour?: number;
      sessionId: string;
    }>,
  ): AccessAnomaly[] {
    const anomalies: AccessAnomaly[] = [];
    const now = new Date();

    // Group by userId
    const byUser = new Map<string, typeof events>();
    for (const event of events) {
      if (!byUser.has(event.userId)) byUser.set(event.userId, []);
      byUser.get(event.userId)!.push(event);
    }

    for (const [userId, userEvents] of byUser.entries()) {
      const baseline = this.accessBaselines.get(userId);

      // High frequency anomaly
      const totalRequests = userEvents.reduce((a, e) => a + e.requestCount, 0);
      const baselineDaily = baseline?.dailyRequestAvg ?? 100;
      if (totalRequests > baselineDaily * 3) {
        const deviationPercent = Math.round(((totalRequests - baselineDaily) / baselineDaily) * 100);
        anomalies.push(this.createAnomaly(userId, 'high-frequency', 'high',
          `Unusually high request volume: ${totalRequests} (baseline: ${baselineDaily})`,
          baselineDaily, totalRequests, deviationPercent,
          { totalRequests, events: userEvents.length }));
      }

      // Unusual hour access
      const offHourEvents = userEvents.filter((e) => {
        const hour = e.hour ?? e.timestamp.getHours();
        const baselineHourly = baseline?.hourly[hour] ?? 5;
        return e.requestCount > baselineHourly * 5 && (hour < 6 || hour > 22);
      });
      if (offHourEvents.length > 0) {
        anomalies.push(this.createAnomaly(userId, 'unusual-hour', 'medium',
          `Access detected during unusual hours (${offHourEvents.map((e) => e.hour ?? e.timestamp.getHours()).join(', ')}h)`,
          0, offHourEvents.length, 100,
          { offHourEvents: offHourEvents.length }));
      }

      // Geographic anomaly
      if (baseline?.typicalGeos) {
        const unusualGeos = userEvents.filter(
          (e) => e.geoCountry && !baseline.typicalGeos.includes(e.geoCountry),
        );
        if (unusualGeos.length > 0) {
          const countries = [...new Set(unusualGeos.map((e) => e.geoCountry))];
          anomalies.push(this.createAnomaly(userId, 'geo-anomaly', 'high',
            `Access from unusual geographies: ${countries.join(', ')}`,
            0, unusualGeos.length, 100,
            { countries, typicalGeos: baseline.typicalGeos }));
        }
      }

      // Concurrent sessions (same user, multiple IPs simultaneously)
      const uniqueIPs = new Set(userEvents.map((e) => e.ipAddress));
      if (uniqueIPs.size >= 3) {
        anomalies.push(this.createAnomaly(userId, 'concurrent-session', 'critical',
          `User accessing from ${uniqueIPs.size} different IP addresses concurrently`,
          1, uniqueIPs.size, (uniqueIPs.size - 1) * 100,
          { ipAddresses: Array.from(uniqueIPs) }));
      }

      // Impossible travel detection
      const sortedEvents = userEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 1; i < sortedEvents.length; i++) {
        const prev = sortedEvents[i - 1];
        const curr = sortedEvents[i];
        if (prev.geoCountry && curr.geoCountry && prev.geoCountry !== curr.geoCountry) {
          const timeDiffHours = (curr.timestamp.getTime() - prev.timestamp.getTime()) / (1000 * 3600);
          if (timeDiffHours < 2) {
            anomalies.push(this.createAnomaly(userId, 'impossible-travel', 'critical',
              `Impossible travel: ${prev.geoCountry} → ${curr.geoCountry} in ${timeDiffHours.toFixed(1)} hours`,
              2, timeDiffHours, Math.round(((2 - timeDiffHours) / 2) * 100),
              { from: prev.geoCountry, to: curr.geoCountry, timeDiffHours }));
          }
        }
      }
    }

    anomalies.forEach((a) => this.anomalies.set(a.id, a));
    logger.info('Access anomaly detection complete', { anomalyCount: anomalies.length, userCount: byUser.size });
    return anomalies;
  }

  private createAnomaly(
    userId: string,
    type: AccessAnomaly['type'],
    severity: AccessAnomaly['severity'],
    description: string,
    baselineValue: number,
    observedValue: number,
    deviationPercent: number,
    context: Record<string, unknown>,
  ): AccessAnomaly {
    return {
      id: `anomaly:${userId}:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      userId,
      type,
      severity,
      description,
      baselineValue,
      observedValue,
      deviationPercent,
      context,
      detectedAt: new Date(),
      resolved: false,
    };
  }

  // ─── Compliance Analysis ──────────────────────────────────────────────────

  analyzeCompliance(framework: 'SOC2' | 'GDPR' | 'HIPAA', evidenceMap: Record<string, { implemented: boolean; evidence?: string; partial?: boolean }>): ComplianceControl[] {
    let controls: ComplianceControl[] = [];
    if (framework === 'SOC2') controls = this.checkSOC2Controls(evidenceMap);
    else if (framework === 'GDPR') controls = this.checkGDPRControls(evidenceMap);
    else if (framework === 'HIPAA') controls = this.checkHIPAAControls(evidenceMap);
    controls.forEach((c) => this.controls.set(c.id, c));
    logger.info('Compliance analysis complete', { framework, totalControls: controls.length, nonCompliant: controls.filter((c) => c.status === 'non-compliant').length });
    return controls;
  }

  checkSOC2Controls(evidence: Record<string, { implemented: boolean; evidence?: string; partial?: boolean }>): ComplianceControl[] {
    const controls: Array<Omit<ComplianceControl, 'id' | 'lastAssessedAt'>> = [
      { framework: 'SOC2', controlId: 'CC6.1', controlName: 'Logical Access Security', description: 'Restrict logical access to systems based on authorized and appropriate access rights', category: 'Access Control', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC6.2', controlName: 'User Authentication', description: 'Prior to issuing system credentials, registered users are identified and authenticated', category: 'Access Control', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC6.3', controlName: 'Segregation of Duties', description: 'Role-based access controls prevent unauthorized data modification', category: 'Access Control', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC7.1', controlName: 'System Monitoring', description: 'Detect and respond to system anomalies and unauthorized activities', category: 'Monitoring', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC7.2', controlName: 'Security Incident Response', description: 'Procedures exist to respond to security incidents', category: 'Incident Response', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC8.1', controlName: 'Change Management', description: 'Changes to system components are authorized and tested', category: 'Change Management', priority: 'medium', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'CC9.1', controlName: 'Risk Assessment', description: 'Identify, assess, and manage risks including vendor and business partner risk', category: 'Risk Management', priority: 'medium', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'A1.1', controlName: 'Availability Performance Monitoring', description: 'Meet availability commitments and system performance obligations', category: 'Availability', priority: 'medium', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'C1.1', controlName: 'Confidentiality Policy', description: 'Identify and maintain confidentiality of information', category: 'Confidentiality', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'SOC2', controlId: 'PI1.1', controlName: 'Privacy Notice', description: 'Notice is provided to data subjects about personal information collection', category: 'Privacy', priority: 'medium', remediationRequired: false, gaps: [], status: 'unknown' },
    ];

    return controls.map((c) => this.applyEvidenceToControl(c, evidence, 'SOC2'));
  }

  checkGDPRControls(evidence: Record<string, { implemented: boolean; evidence?: string; partial?: boolean }>): ComplianceControl[] {
    const controls: Array<Omit<ComplianceControl, 'id' | 'lastAssessedAt'>> = [
      { framework: 'GDPR', controlId: 'ART6', controlName: 'Lawfulness of Processing', description: 'Personal data must be processed on a lawful basis', category: 'Lawful Basis', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART7', controlName: 'Consent Management', description: 'Freely given, specific, informed and unambiguous consent for data processing', category: 'Consent', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART13', controlName: 'Privacy Notice / Information', description: 'Transparent information provided at data collection', category: 'Transparency', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART17', controlName: 'Right to Erasure', description: 'Data subjects can request deletion of personal data', category: 'Data Subject Rights', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART20', controlName: 'Data Portability', description: 'Data subjects can receive and transmit personal data in machine-readable format', category: 'Data Subject Rights', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART25', controlName: 'Privacy by Design', description: 'Data protection integrated into processing activities by default', category: 'Privacy by Design', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART30', controlName: 'Records of Processing Activities', description: 'Maintain records of all data processing activities', category: 'Documentation', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART32', controlName: 'Security of Processing', description: 'Appropriate technical and organizational measures to ensure data security', category: 'Security', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART33', controlName: 'Breach Notification (72h)', description: 'Report personal data breaches to supervisory authority within 72 hours', category: 'Incident Response', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART35', controlName: 'Data Protection Impact Assessment', description: 'DPIA required for high-risk processing activities', category: 'Risk Assessment', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART37', controlName: 'Data Protection Officer', description: 'Appoint DPO where required', category: 'Governance', priority: 'medium', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'GDPR', controlId: 'ART44', controlName: 'Cross-Border Transfer Controls', description: 'Ensure adequate protection for international data transfers', category: 'Data Transfers', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
    ];

    return controls.map((c) => this.applyEvidenceToControl(c, evidence, 'GDPR'));
  }

  checkHIPAAControls(evidence: Record<string, { implemented: boolean; evidence?: string; partial?: boolean }>): ComplianceControl[] {
    const controls: Array<Omit<ComplianceControl, 'id' | 'lastAssessedAt'>> = [
      { framework: 'HIPAA', controlId: 'HIPAA-164.306', controlName: 'Security Standards', description: 'Implement reasonable and appropriate safeguards for ePHI', category: 'Administrative Safeguards', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.308a1', controlName: 'Risk Analysis', description: 'Conduct accurate and thorough assessment of potential risks to ePHI', category: 'Administrative Safeguards', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.308a3', controlName: 'Workforce Security', description: 'Implement policies to ensure workforce access to ePHI is authorized', category: 'Administrative Safeguards', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.308a5', controlName: 'Security Awareness Training', description: 'Security and awareness training for all members of the workforce', category: 'Administrative Safeguards', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.308a6', controlName: 'Security Incident Procedures', description: 'Implement policies to address security incidents', category: 'Incident Response', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.310a1', controlName: 'Facility Access Controls', description: 'Limit physical access to ePHI to authorized persons', category: 'Physical Safeguards', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.312a1', controlName: 'Access Control', description: 'Unique user IDs and emergency access procedures for ePHI systems', category: 'Technical Safeguards', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.312b', controlName: 'Audit Controls', description: 'Hardware, software, and procedural mechanisms to record and examine activity', category: 'Technical Safeguards', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.312e1', controlName: 'Transmission Security', description: 'Guard against unauthorized access to ePHI transmitted over networks', category: 'Technical Safeguards', priority: 'critical', remediationRequired: false, gaps: [], status: 'unknown' },
      { framework: 'HIPAA', controlId: 'HIPAA-164.314a1', controlName: 'Business Associate Agreements', description: 'Written contracts ensuring BAs protect ePHI', category: 'Organizational Requirements', priority: 'high', remediationRequired: false, gaps: [], status: 'unknown' },
    ];

    return controls.map((c) => this.applyEvidenceToControl(c, evidence, 'HIPAA'));
  }

  private applyEvidenceToControl(
    control: Omit<ComplianceControl, 'id' | 'lastAssessedAt'>,
    evidence: Record<string, { implemented: boolean; evidence?: string; partial?: boolean }>,
    framework: string,
  ): ComplianceControl {
    const ev = evidence[control.controlId];
    let status: ComplianceControl['status'] = 'unknown';
    const gaps: string[] = [];

    if (ev) {
      if (ev.implemented && !ev.partial) {
        status = 'compliant';
      } else if (ev.partial) {
        status = 'partial';
        gaps.push('Partial implementation — review gaps and complete remaining controls');
      } else {
        status = 'non-compliant';
        gaps.push(`${control.controlName} is not implemented — immediate action required`);
      }
    } else {
      status = 'unknown';
      gaps.push('No evidence provided — assessment required');
    }

    return {
      ...control,
      id: `ctrl:${framework}:${control.controlId}`,
      status,
      evidence: ev?.evidence,
      gaps,
      remediationRequired: status === 'non-compliant' || status === 'partial',
      lastAssessedAt: new Date(),
    };
  }

  // ─── Security Score ───────────────────────────────────────────────────────

  calculateSecurityScore(
    vulnerabilities: Vulnerability[],
    controls: ComplianceControl[],
    anomalies: AccessAnomaly[],
  ): SecurityScore {
    const vulnComponents = this.scoreVulnerabilities(vulnerabilities);
    const complianceComponent = this.scoreCompliance(controls);
    const accessComponent = this.scoreAccessControl(anomalies);
    const configComponent = this.scoreConfiguration(vulnerabilities);
    const dataProtectionComponent = this.scoreDataProtection(vulnerabilities, controls);

    const components = [
      { category: 'vulnerability' as const, score: vulnComponents, weight: 0.30, details: `${vulnerabilities.filter((v) => v.status === 'open').length} open vulnerabilities` },
      { category: 'compliance' as const, score: complianceComponent, weight: 0.25, details: `${controls.filter((c) => c.status === 'compliant').length}/${controls.length} controls compliant` },
      { category: 'access-control' as const, score: accessComponent, weight: 0.20, details: `${anomalies.filter((a) => !a.resolved).length} unresolved anomalies` },
      { category: 'configuration' as const, score: configComponent, weight: 0.15, details: 'Configuration security posture' },
      { category: 'data-protection' as const, score: dataProtectionComponent, weight: 0.10, details: 'Encryption and data handling controls' },
    ].map((c) => ({ ...c, weightedScore: Math.round(c.score * c.weight) }));

    const overall = Math.round(components.reduce((a, c) => a + c.weightedScore, 0));
    const grade: SecurityScore['grade'] = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F';

    const lastScore = this.scoreHistory[this.scoreHistory.length - 2]?.score;
    const trend: SecurityScore['trend'] = lastScore === undefined ? 'stable' : overall > lastScore ? 'improving' : overall < lastScore ? 'degrading' : 'stable';

    return { overall, components, grade, trend, calculatedAt: new Date() };
  }

  private scoreVulnerabilities(vulns: Vulnerability[]): number {
    const open = vulns.filter((v) => v.status === 'open');
    let deduction = 0;
    open.forEach((v) => {
      deduction += v.severity === 'critical' ? 20 : v.severity === 'high' ? 10 : v.severity === 'medium' ? 5 : v.severity === 'low' ? 2 : 0;
    });
    return Math.max(0, 100 - deduction);
  }

  private scoreCompliance(controls: ComplianceControl[]): number {
    if (controls.length === 0) return 75; // no data = assume moderate
    const compliant = controls.filter((c) => c.status === 'compliant').length;
    const partial = controls.filter((c) => c.status === 'partial').length;
    return Math.round(((compliant + partial * 0.5) / controls.length) * 100);
  }

  private scoreAccessControl(anomalies: AccessAnomaly[]): number {
    const unresolved = anomalies.filter((a) => !a.resolved);
    let deduction = 0;
    unresolved.forEach((a) => {
      deduction += a.severity === 'critical' ? 25 : a.severity === 'high' ? 15 : a.severity === 'medium' ? 8 : 3;
    });
    return Math.max(0, 100 - deduction);
  }

  private scoreConfiguration(vulns: Vulnerability[]): number {
    const configVulns = vulns.filter((v) => v.type === 'misconfiguration' && v.status === 'open');
    return Math.max(0, 100 - configVulns.length * 10);
  }

  private scoreDataProtection(vulns: Vulnerability[], controls: ComplianceControl[]): number {
    const encryptionVulns = vulns.filter((v) => v.type === 'missing-encryption' && v.status === 'open');
    const privacyControls = controls.filter((c) => c.category.toLowerCase().includes('privacy') || c.category.toLowerCase().includes('data'));
    const privacyScore = privacyControls.length > 0 ? this.scoreCompliance(privacyControls) : 75;
    return Math.max(0, privacyScore - encryptionVulns.length * 25);
  }

  // ─── Remediation Workflows ────────────────────────────────────────────────

  createRemediationWorkflow(
    title: string,
    description: string,
    priority: RemediationWorkflow['priority'],
    linkedVulnerabilities: string[],
    linkedControls: string[],
    steps: Array<{ title: string; description: string }>,
    estimatedEffortHours: number,
    dueDate?: Date,
  ): RemediationWorkflow {
    const id = `wf:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const workflow: RemediationWorkflow = {
      id,
      title,
      description,
      priority,
      status: 'open',
      linkedVulnerabilities,
      linkedControls,
      steps: steps.map((s, i) => ({ order: i + 1, ...s, status: 'pending' as const })),
      estimatedEffortHours,
      dueDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.workflows.set(id, workflow);
    logger.info('Remediation workflow created', { id, title, priority });
    return workflow;
  }

  completeWorkflowStep(workflowId: string, stepOrder: number, completedBy?: string): RemediationWorkflow | null {
    const wf = this.workflows.get(workflowId);
    if (!wf) return null;
    const step = wf.steps.find((s) => s.order === stepOrder);
    if (step) {
      step.status = 'completed';
      step.completedAt = new Date();
      step.completedBy = completedBy;
    }
    const allDone = wf.steps.every((s) => s.status === 'completed' || s.status === 'skipped');
    if (allDone) wf.status = 'completed';
    wf.updatedAt = new Date();
    return wf;
  }

  autoGenerateRemediationWorkflows(scanId: string): RemediationWorkflow[] {
    const scan = this.scans.get(scanId);
    if (!scan) return [];

    const generated: RemediationWorkflow[] = [];
    const criticalVulns = scan.vulnerabilities.filter((v) => v.severity === 'critical' && v.status === 'open');
    const highVulns = scan.vulnerabilities.filter((v) => v.severity === 'high' && v.status === 'open');

    if (criticalVulns.length > 0) {
      const wf = this.createRemediationWorkflow(
        'Critical Vulnerability Remediation',
        `Address ${criticalVulns.length} critical security vulnerabilities detected in scan ${scanId}`,
        'critical',
        criticalVulns.map((v) => v.id),
        [],
        [
          { title: 'Triage & assign owners', description: 'Review each critical vulnerability and assign engineering owners' },
          { title: 'Implement fixes', description: criticalVulns.map((v) => v.remediationSteps[0]).join('; ') },
          { title: 'Test and validate', description: 'Verify fixes in staging environment with security tooling' },
          { title: 'Deploy and re-scan', description: 'Deploy fixes to production and run a follow-up vulnerability scan' },
        ],
        criticalVulns.length * 4,
        (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d; })(),
      );
      generated.push(wf);
    }

    if (highVulns.length > 0) {
      const wf = this.createRemediationWorkflow(
        'High Severity Vulnerability Remediation',
        `Address ${highVulns.length} high severity vulnerabilities`,
        'high',
        highVulns.map((v) => v.id),
        [],
        [
          { title: 'Prioritize vulnerabilities', description: 'Order by CVSS score and business impact' },
          { title: 'Implement fixes', description: 'Apply remediations starting with highest CVSS score' },
          { title: 'Code review and test', description: 'Security-focused code review and regression testing' },
          { title: 'Deploy and monitor', description: 'Deploy to production and monitor for regressions' },
        ],
        highVulns.length * 2,
        (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d; })(),
      );
      generated.push(wf);
    }

    const nonCompliant = scan.complianceGaps.filter((c) => c.status === 'non-compliant');
    if (nonCompliant.length > 0) {
      const byFramework = nonCompliant.reduce<Record<string, ComplianceControl[]>>((acc, c) => {
        acc[c.framework] = acc[c.framework] ?? [];
        acc[c.framework].push(c);
        return acc;
      }, {});
      for (const [fw, controls] of Object.entries(byFramework)) {
        const wf = this.createRemediationWorkflow(
          `${fw} Compliance Gap Remediation`,
          `Address ${controls.length} non-compliant ${fw} controls`,
          'high',
          [],
          controls.map((c) => c.id),
          [
            { title: 'Review gap analysis', description: 'Understand each control gap and its business impact' },
            { title: 'Develop remediation plan', description: 'Document specific actions for each control gap' },
            { title: 'Implement controls', description: controls.map((c) => c.gaps[0]).filter(Boolean).join('; ') },
            { title: 'Document evidence', description: 'Collect and record evidence of control implementation' },
            { title: 'Internal audit review', description: 'Validate remediation with internal or external auditor' },
          ],
          controls.length * 6,
          (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; })(),
        );
        generated.push(wf);
      }
    }

    return generated;
  }

  // ─── Audit Report ─────────────────────────────────────────────────────────

  generateAuditReport(reportId: string, orgName: string, periodStart: Date, periodEnd: Date): AuditReport {
    const cacheKey = `audit_report:${reportId}`;
    const cached = cache.get<AuditReport>(cacheKey);
    if (cached) return cached;

    const allVulns = Array.from(this.vulnerabilities.values());
    const allControls = Array.from(this.controls.values());
    const allAnomalies = Array.from(this.anomalies.values());
    const allWorkflows = Array.from(this.workflows.values());

    const periodVulns = allVulns.filter((v) => v.detectedAt >= periodStart && v.detectedAt <= periodEnd);
    const periodAnomalies = allAnomalies.filter((a) => a.detectedAt >= periodStart && a.detectedAt <= periodEnd);

    const score = this.calculateSecurityScore(allVulns, allControls, allAnomalies);

    const vulnBySeverity = (['critical', 'high', 'medium', 'low', 'informational'] as Vulnerability['severity'][])
      .reduce<Record<Vulnerability['severity'], number>>((acc, s) => { acc[s] = periodVulns.filter((v) => v.severity === s).length; return acc; }, { critical: 0, high: 0, medium: 0, low: 0, informational: 0 });

    const vulnByType = periodVulns.reduce<Record<string, number>>((acc, v) => { acc[v.type] = (acc[v.type] ?? 0) + 1; return acc; }, {});

    const frameworks: AuditReport['complianceSummary']['frameworks'] = (['SOC2', 'GDPR', 'HIPAA'] as const).map((fw) => {
      const fwControls = allControls.filter((c) => c.framework === fw);
      return {
        framework: fw,
        totalControls: fwControls.length,
        compliantCount: fwControls.filter((c) => c.status === 'compliant').length,
        partialCount: fwControls.filter((c) => c.status === 'partial').length,
        nonCompliantCount: fwControls.filter((c) => c.status === 'non-compliant').length,
        complianceRate: fwControls.length > 0 ? Math.round((fwControls.filter((c) => c.status === 'compliant').length / fwControls.length) * 100) : 0,
      };
    }).filter((fw) => fw.totalControls > 0);

    const anomBySeverity = (['critical', 'high', 'medium', 'low'] as AccessAnomaly['severity'][])
      .reduce<Record<AccessAnomaly['severity'], number>>((acc, s) => { acc[s] = periodAnomalies.filter((a) => a.severity === s).length; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 });

    // Top risks
    const topRisks: AuditReport['topRisks'] = [
      ...periodVulns.filter((v) => v.severity === 'critical').slice(0, 3).map((v, i) => ({
        rank: i + 1,
        description: v.title,
        severity: v.severity,
        recommendation: v.remediationSteps[0] ?? 'Review and remediate immediately',
      })),
      ...periodAnomalies.filter((a) => a.severity === 'critical').slice(0, 2).map((a, i) => ({
        rank: 4 + i,
        description: a.description,
        severity: a.severity,
        recommendation: 'Investigate and resolve access anomaly immediately',
      })),
    ].slice(0, 5);

    const executiveSummary =
      `Security audit for ${orgName} covering ${periodStart.toDateString()} to ${periodEnd.toDateString()}. ` +
      `Overall security score: ${score.overall}/100 (Grade ${score.grade}). ` +
      `Identified ${periodVulns.length} vulnerabilities (${vulnBySeverity.critical} critical, ${vulnBySeverity.high} high). ` +
      `Detected ${periodAnomalies.length} access anomalies. ` +
      `${allWorkflows.filter((w) => w.status === 'completed').length} of ${allWorkflows.length} remediation workflows completed.`;

    const report: AuditReport = {
      id: reportId,
      title: `Security Audit Report — ${orgName}`,
      generatedFor: orgName,
      period: { start: periodStart, end: periodEnd },
      executiveSummary,
      securityScore: score,
      vulnerabilitySummary: {
        total: periodVulns.length,
        bySeverity: vulnBySeverity,
        byType: vulnByType,
        openCount: periodVulns.filter((v) => v.status === 'open').length,
        remediatedCount: periodVulns.filter((v) => v.status === 'remediated').length,
      },
      complianceSummary: { frameworks },
      anomalySummary: {
        total: periodAnomalies.length,
        bySeverity: anomBySeverity,
        resolvedCount: periodAnomalies.filter((a) => a.resolved).length,
      },
      topRisks,
      remediationWorkflows: allWorkflows,
      generatedAt: new Date(),
    };

    cache.set(cacheKey, report, 3600);
    logger.info('Audit report generated', { reportId, orgName, score: score.overall, grade: score.grade });
    return report;
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  resolveAnomaly(anomalyId: string): void {
    const anomaly = this.anomalies.get(anomalyId);
    if (anomaly) {
      anomaly.resolved = true;
      anomaly.resolvedAt = new Date();
      logger.info('Anomaly resolved', { anomalyId });
    }
  }

  updateVulnerabilityStatus(vulnId: string, status: Vulnerability['status']): Vulnerability | null {
    const vuln = this.vulnerabilities.get(vulnId);
    if (!vuln) return null;
    vuln.status = status;
    vuln.updatedAt = new Date();
    logger.info('Vulnerability status updated', { vulnId, status });
    return vuln;
  }

  getOpenVulnerabilities(severity?: Vulnerability['severity']): Vulnerability[] {
    return Array.from(this.vulnerabilities.values()).filter((v) => v.status === 'open' && (!severity || v.severity === severity));
  }

  getScanById(scanId: string): SecurityScan | undefined {
    return this.scans.get(scanId);
  }

  getAllWorkflows(): RemediationWorkflow[] {
    return Array.from(this.workflows.values()).sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getEnterpriseSecurityAuditEngine(): EnterpriseSecurityAuditEngine {
  if (!(globalThis as any).__enterpriseSecurityAuditEngine__) {
    (globalThis as any).__enterpriseSecurityAuditEngine__ = new EnterpriseSecurityAuditEngine();
  }
  return (globalThis as any).__enterpriseSecurityAuditEngine__;
}
