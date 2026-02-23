import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ThreatCategory =
  | 'sql_injection'
  | 'xss'
  | 'path_traversal'
  | 'rate_anomaly'
  | 'size_anomaly'
  | 'bot_activity'
  | 'credential_abuse'
  | 'unknown';
export type ResponseAction = 'allow' | 'monitor' | 'throttle' | 'challenge' | 'block';

export interface ThreatDetection {
  id: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  confidence: number;
  description: string;
  matchedPatterns: string[];
  recommendation: ResponseAction;
  timestamp: string;
}

export interface RequestAnalysis {
  requestId: string;
  ip: string;
  method: string;
  path: string;
  threats: ThreatDetection[];
  overallSeverity: ThreatSeverity;
  overallAction: ResponseAction;
  analysisTimeMs: number;
  timestamp: string;
}

export interface RequestContext {
  ip: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
  contentLength: number;
}

export interface RateWindow {
  ip: string;
  timestamps: number[];
  windowMs: number;
}

export interface ThreatStats {
  totalAnalyzed: number;
  totalThreats: number;
  bySeverity: Record<ThreatSeverity, number>;
  byCategory: Record<string, number>;
  byAction: Record<ResponseAction, number>;
  topOffendingIPs: Array<{ ip: string; threatCount: number }>;
}

export interface ThreatIntelReport {
  generatedAt: string;
  windowHours: number;
  stats: ThreatStats;
  recentCritical: ThreatDetection[];
  patterns: string[];
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

const SQL_INJECTION_PATTERNS: RegExp[] = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|TRUNCATE|DECLARE)\b)/i,
  /(\b(OR|AND)\b\s+[\d'"]+=\s*[\d'"]+)/i,
  /(--|#|\/\*)\s/,
  /(\bUNION\b\s+(ALL\s+)?SELECT\b)/i,
  /('\s*(OR|AND)\s+'[^']*'\s*=\s*')/i,
  /(\b(SLEEP|BENCHMARK|WAITFOR)\s*\()/i,
  /(;\s*(DROP|DELETE|INSERT|UPDATE)\b)/i,
  /(\bINTO\s+(OUTFILE|DUMPFILE)\b)/i,
  /(\bLOAD_FILE\s*\()/i,
  /(\b(CHAR|NCHAR|VARCHAR|NVARCHAR)\s*\()/i,
];

const XSS_PATTERNS: RegExp[] = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(load|error|click|mouseover|submit|focus|blur)\s*=/i,
  /<\s*img[^>]+onerror/i,
  /<\s*svg[^>]+onload/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /document\.(cookie|location|write)/i,
  /(eval|setTimeout|setInterval|Function)\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript/i,
  /<\s*body[^>]+onload/i,
];

const PATH_TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e[%/\\]/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
  /%252e%252e/i,
  /\/(etc\/passwd|etc\/shadow|proc\/self)/i,
  /\\(windows|winnt|boot\.ini)/i,
  /\.(env|htaccess|htpasswd|git|svn)\b/,
  /\/\.\.\//,
];

// ─── Constants ────────────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_ANOMALY_THRESHOLD = 120;
const SIZE_ANOMALY_THRESHOLD = 1_048_576; // 1 MB
const TOP_OFFENDERS_LIMIT = 10;
const MAX_ANALYSES_STORED = 10_000;
const SEVERITY_ORDER: Record<ThreatSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class APIThreatAnalyzer {
  private analyses: RequestAnalysis[] = [];
  private rateWindows: Map<string, RateWindow> = new Map();
  private ipThreatCounts: Map<string, number> = new Map();
  private log = logger.child({ service: 'APIThreatAnalyzer' });

  // ─── Core Analysis ────────────────────────────────────────────────────────

  analyzeRequest(context: RequestContext): RequestAnalysis {
    const start = performance.now();
    const threats: ThreatDetection[] = [];

    // Run all detectors
    threats.push(...this.detectSQLInjection(context));
    threats.push(...this.detectXSS(context));
    threats.push(...this.detectPathTraversal(context));
    threats.push(...this.detectRateAnomaly(context));
    threats.push(...this.detectSizeAnomaly(context));

    // Track rate
    this.trackRate(context.ip);

    const overallSeverity = this.computeOverallSeverity(threats);
    const overallAction = this.computeOverallAction(threats);
    const elapsed = performance.now() - start;

    const analysis: RequestAnalysis = {
      requestId: crypto.randomUUID(),
      ip: context.ip,
      method: context.method,
      path: context.path,
      threats,
      overallSeverity,
      overallAction,
      analysisTimeMs: Math.round(elapsed * 100) / 100,
      timestamp: new Date().toISOString(),
    };

    this.storeAnalysis(analysis);

    if (threats.length > 0) {
      this.ipThreatCounts.set(
        context.ip,
        (this.ipThreatCounts.get(context.ip) ?? 0) + threats.length,
      );
      this.log.warn('Threats detected in request', {
        requestId: analysis.requestId,
        ip: context.ip,
        path: context.path,
        threatCount: threats.length,
        severity: overallSeverity,
        action: overallAction,
      });
    }

    return analysis;
  }

  // ─── SQL Injection Detection ──────────────────────────────────────────────

  private detectSQLInjection(context: RequestContext): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const targets = this.extractTargets(context);

    for (const target of targets) {
      const matched: string[] = [];
      for (const pattern of SQL_INJECTION_PATTERNS) {
        if (pattern.test(target)) {
          matched.push(pattern.source);
        }
      }

      if (matched.length > 0) {
        const confidence = Math.min(matched.length / 3, 1);
        threats.push({
          id: crypto.randomUUID(),
          category: 'sql_injection',
          severity: confidence > 0.6 ? 'critical' : 'high',
          confidence: Math.round(confidence * 100) / 100,
          description: `SQL injection pattern detected in request (${matched.length} pattern(s) matched)`,
          matchedPatterns: matched.slice(0, 5),
          recommendation: confidence > 0.6 ? 'block' : 'challenge',
          timestamp: new Date().toISOString(),
        });
        break; // One detection per category per request
      }
    }

    return threats;
  }

  // ─── XSS Detection ───────────────────────────────────────────────────────

  private detectXSS(context: RequestContext): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const targets = this.extractTargets(context);

    for (const target of targets) {
      const matched: string[] = [];
      for (const pattern of XSS_PATTERNS) {
        if (pattern.test(target)) {
          matched.push(pattern.source);
        }
      }

      if (matched.length > 0) {
        const confidence = Math.min(matched.length / 3, 1);
        threats.push({
          id: crypto.randomUUID(),
          category: 'xss',
          severity: confidence > 0.5 ? 'high' : 'medium',
          confidence: Math.round(confidence * 100) / 100,
          description: `XSS attempt detected (${matched.length} pattern(s) matched)`,
          matchedPatterns: matched.slice(0, 5),
          recommendation: confidence > 0.5 ? 'block' : 'challenge',
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    return threats;
  }

  // ─── Path Traversal Detection ─────────────────────────────────────────────

  private detectPathTraversal(context: RequestContext): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const pathTargets = [context.path, ...Object.values(context.query)];

    for (const target of pathTargets) {
      const matched: string[] = [];
      for (const pattern of PATH_TRAVERSAL_PATTERNS) {
        if (pattern.test(target)) {
          matched.push(pattern.source);
        }
      }

      if (matched.length > 0) {
        const confidence = Math.min(matched.length / 2, 1);
        threats.push({
          id: crypto.randomUUID(),
          category: 'path_traversal',
          severity: 'high',
          confidence: Math.round(confidence * 100) / 100,
          description: `Path traversal attempt detected (${matched.length} pattern(s) matched)`,
          matchedPatterns: matched.slice(0, 5),
          recommendation: 'block',
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    return threats;
  }

  // ─── Rate Anomaly Detection ───────────────────────────────────────────────

  private detectRateAnomaly(context: RequestContext): ThreatDetection[] {
    const window = this.rateWindows.get(context.ip);
    if (!window) return [];

    const now = Date.now();
    const recent = window.timestamps.filter(t => now - t < RATE_WINDOW_MS);
    const rpm = recent.length;

    if (rpm <= RATE_ANOMALY_THRESHOLD) return [];

    const severity: ThreatSeverity = rpm > RATE_ANOMALY_THRESHOLD * 3 ? 'high'
      : rpm > RATE_ANOMALY_THRESHOLD * 2 ? 'medium'
      : 'low';

    return [{
      id: crypto.randomUUID(),
      category: 'rate_anomaly',
      severity,
      confidence: Math.min(rpm / (RATE_ANOMALY_THRESHOLD * 3), 1),
      description: `Abnormal request rate: ${rpm} requests/minute (threshold: ${RATE_ANOMALY_THRESHOLD})`,
      matchedPatterns: [`${rpm} rpm`],
      recommendation: severity === 'high' ? 'block' : 'throttle',
      timestamp: new Date().toISOString(),
    }];
  }

  // ─── Size Anomaly Detection ───────────────────────────────────────────────

  private detectSizeAnomaly(context: RequestContext): ThreatDetection[] {
    if (context.contentLength <= SIZE_ANOMALY_THRESHOLD) return [];

    const ratio = context.contentLength / SIZE_ANOMALY_THRESHOLD;
    const severity: ThreatSeverity = ratio > 10 ? 'high' : ratio > 5 ? 'medium' : 'low';

    return [{
      id: crypto.randomUUID(),
      category: 'size_anomaly',
      severity,
      confidence: Math.min(ratio / 10, 1),
      description: `Request size anomaly: ${(context.contentLength / 1_048_576).toFixed(2)} MB (threshold: 1 MB)`,
      matchedPatterns: [`${context.contentLength} bytes`],
      recommendation: severity === 'high' ? 'block' : 'monitor',
      timestamp: new Date().toISOString(),
    }];
  }

  // ─── Rate Tracking ────────────────────────────────────────────────────────

  private trackRate(ip: string): void {
    const now = Date.now();
    const window = this.rateWindows.get(ip) ?? { ip, timestamps: [], windowMs: RATE_WINDOW_MS };

    window.timestamps.push(now);
    // Trim old entries
    window.timestamps = window.timestamps.filter(t => now - t < RATE_WINDOW_MS);
    this.rateWindows.set(ip, window);
  }

  // ─── Response Computation ─────────────────────────────────────────────────

  private computeOverallSeverity(threats: ThreatDetection[]): ThreatSeverity {
    if (threats.length === 0) return 'info';
    return threats.reduce<ThreatSeverity>((max, t) =>
      SEVERITY_ORDER[t.severity] > SEVERITY_ORDER[max] ? t.severity : max,
      'info',
    );
  }

  private computeOverallAction(threats: ThreatDetection[]): ResponseAction {
    if (threats.length === 0) return 'allow';

    const actionOrder: Record<ResponseAction, number> = {
      allow: 0,
      monitor: 1,
      throttle: 2,
      challenge: 3,
      block: 4,
    };

    return threats.reduce<ResponseAction>((max, t) =>
      actionOrder[t.recommendation] > actionOrder[max] ? t.recommendation : max,
      'allow',
    );
  }

  // ─── Target Extraction ────────────────────────────────────────────────────

  private extractTargets(context: RequestContext): string[] {
    const targets: string[] = [
      context.path,
      ...Object.values(context.query),
      ...Object.values(context.headers),
    ];

    if (context.body) {
      targets.push(context.body);
    }

    return targets.filter(t => t.length > 0);
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  private storeAnalysis(analysis: RequestAnalysis): void {
    this.analyses.push(analysis);
    if (this.analyses.length > MAX_ANALYSES_STORED) {
      this.analyses.splice(0, this.analyses.length - MAX_ANALYSES_STORED);
    }
  }

  // ─── Threat Intelligence Reporting ────────────────────────────────────────

  generateReport(windowHours: number = 24): ThreatIntelReport {
    const cutoff = Date.now() - windowHours * 3_600_000;
    const recentAnalyses = this.analyses.filter(
      a => new Date(a.timestamp).getTime() >= cutoff,
    );

    const allThreats = recentAnalyses.flatMap(a => a.threats);

    const bySeverity: Record<ThreatSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const byCategory: Record<string, number> = {};
    const byAction: Record<ResponseAction, number> = {
      allow: 0,
      monitor: 0,
      throttle: 0,
      challenge: 0,
      block: 0,
    };

    for (const threat of allThreats) {
      bySeverity[threat.severity]++;
      byCategory[threat.category] = (byCategory[threat.category] ?? 0) + 1;
      byAction[threat.recommendation]++;
    }

    // Top offending IPs
    const ipCounts: Map<string, number> = new Map();
    for (const analysis of recentAnalyses) {
      if (analysis.threats.length > 0) {
        ipCounts.set(analysis.ip, (ipCounts.get(analysis.ip) ?? 0) + analysis.threats.length);
      }
    }

    const topOffendingIPs = [...ipCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_OFFENDERS_LIMIT)
      .map(([ip, threatCount]) => ({ ip, threatCount }));

    // Identify patterns
    const patterns: string[] = [];
    if (bySeverity.critical > 0) {
      patterns.push(`${bySeverity.critical} critical threats detected`);
    }
    if (byCategory['sql_injection'] > 5) {
      patterns.push('Elevated SQL injection attempts');
    }
    if (byCategory['xss'] > 5) {
      patterns.push('Elevated XSS attempts');
    }
    if (byCategory['rate_anomaly'] > 10) {
      patterns.push('Widespread rate anomalies suggest DDoS or scraping');
    }
    if (topOffendingIPs.length > 0 && topOffendingIPs[0].threatCount > 20) {
      patterns.push(`Concentrated attack from ${topOffendingIPs[0].ip}`);
    }

    const recentCritical = allThreats
      .filter(t => t.severity === 'critical')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    return {
      generatedAt: new Date().toISOString(),
      windowHours,
      stats: {
        totalAnalyzed: recentAnalyses.length,
        totalThreats: allThreats.length,
        bySeverity,
        byCategory,
        byAction,
        topOffendingIPs,
      },
      recentCritical,
      patterns,
    };
  }

  getAnalysisById(requestId: string): RequestAnalysis | null {
    return this.analyses.find(a => a.requestId === requestId) ?? null;
  }

  getRecentThreats(limit: number = 50): ThreatDetection[] {
    const allThreats = this.analyses.flatMap(a => a.threats);
    return allThreats
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  getThreatsByIP(ip: string): RequestAnalysis[] {
    return this.analyses.filter(a => a.ip === ip && a.threats.length > 0);
  }

  getThreatCountByIP(ip: string): number {
    return this.ipThreatCounts.get(ip) ?? 0;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  clearRateWindow(ip: string): void {
    this.rateWindows.delete(ip);
  }

  resetIPThreatCount(ip: string): void {
    this.ipThreatCounts.delete(ip);
  }

  getStats(): ThreatStats {
    return this.generateReport(24).stats;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getAPIThreatAnalyzer(): APIThreatAnalyzer {
  if (!globalThis.__apiThreatAnalyzer__) {
    globalThis.__apiThreatAnalyzer__ = new APIThreatAnalyzer();
  }
  return globalThis.__apiThreatAnalyzer__ as APIThreatAnalyzer;
}
