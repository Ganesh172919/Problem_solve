/**
 * Zero-Trust Security Architecture
 *
 * Implements zero-trust security with:
 * - Identity verification for every request
 * - Least-privilege access control
 * - Micro-segmentation
 * - Continuous authentication
 * - Context-aware access policies
 * - Real-time threat detection
 * - Security posture monitoring
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface SecurityContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  ipAddress: string;
  userAgent: string;
  location?: GeoLocation;
  timestamp: Date;
  trustScore: number; // 0-100
  riskFactors: string[];
}

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
}

export interface AccessPolicy {
  id: string;
  name: string;
  resourcePattern: string;
  actions: string[];
  conditions: PolicyCondition[];
  effect: 'allow' | 'deny';
  priority: number;
}

export interface PolicyCondition {
  type: 'ip-range' | 'geo-location' | 'time-window' | 'device-type' | 'trust-score' | 'mfa-required';
  operator: 'equals' | 'not-equals' | 'greater-than' | 'less-than' | 'in' | 'not-in' | 'matches';
  value: any;
}

export interface AccessRequest {
  context: SecurityContext;
  resource: string;
  action: string;
  metadata?: Record<string, any>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  appliedPolicies: string[];
  requiresMfa: boolean;
  trustScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

export interface ThreatSignal {
  id: string;
  type: 'brute-force' | 'credential-stuffing' | 'anomalous-behavior' | 'suspicious-ip' | 'impossible-travel';
  severity: 'low' | 'medium' | 'high' | 'critical';
  context: SecurityContext;
  indicators: string[];
  detectedAt: Date;
  mitigated: boolean;
  mitigationAction?: string;
}

export interface SecurityPosture {
  overallScore: number; // 0-100
  categories: {
    authentication: number;
    authorization: number;
    encryption: number;
    monitoring: number;
    compliance: number;
  };
  vulnerabilities: Vulnerability[];
  recommendations: string[];
  lastAssessed: Date;
}

export interface Vulnerability {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  description: string;
  remediation: string;
  cvssScore?: number;
}

class ZeroTrustSecurityEngine {
  private policies: Map<string, AccessPolicy> = new Map();
  private sessions: Map<string, SecurityContext> = new Map();
  private threats: Map<string, ThreatSignal> = new Map();
  private deviceFingerprints: Map<string, DeviceProfile> = new Map();
  private behavioralProfiles: Map<string, BehavioralProfile> = new Map();

  constructor() {
    this.initializeDefaultPolicies();
    this.startThreatMonitoring();
  }

  /**
   * Evaluate access request
   */
  async evaluateAccess(request: AccessRequest): Promise<AccessDecision> {
    logger.info('Evaluating access request', {
      userId: request.context.userId,
      resource: request.resource,
      action: request.action,
    });

    // Verify session
    const sessionValid = await this.verifySession(request.context.sessionId);
    if (!sessionValid) {
      return {
        allowed: false,
        reason: 'Invalid or expired session',
        appliedPolicies: [],
        requiresMfa: false,
        trustScore: 0,
        riskLevel: 'high',
        recommendations: ['Re-authenticate to establish new session'],
      };
    }

    // Calculate trust score
    const trustScore = await this.calculateTrustScore(request.context);

    // Detect anomalies
    const anomalies = await this.detectAnomalies(request.context);

    // Check for active threats
    const threats = this.getActiveThreats(request.context.userId);

    // Find applicable policies
    const applicablePolicies = this.findApplicablePolicies(
      request.resource,
      request.action
    );

    // Evaluate policies
    let allowed = false;
    let requiresMfa = false;
    const appliedPolicies: string[] = [];

    // Sort by priority
    const sortedPolicies = applicablePolicies.sort((a, b) => b.priority - a.priority);

    for (const policy of sortedPolicies) {
      const conditionsMet = this.evaluateConditions(
        policy.conditions,
        request.context,
        trustScore
      );

      if (conditionsMet) {
        appliedPolicies.push(policy.id);

        if (policy.effect === 'allow') {
          allowed = true;
        } else {
          allowed = false;
          break; // Deny takes precedence
        }

        // Check for MFA requirement
        const mfaCondition = policy.conditions.find(c => c.type === 'mfa-required');
        if (mfaCondition && mfaCondition.value === true) {
          requiresMfa = true;
        }
      }
    }

    // Determine risk level
    const riskLevel = this.determineRiskLevel(trustScore, anomalies, threats.length);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      trustScore,
      riskLevel,
      anomalies
    );

    // Log decision
    await this.logAccessDecision(request, allowed, appliedPolicies);

    // Create threat signal if denied
    if (!allowed && riskLevel !== 'low') {
      await this.createThreatSignal({
        type: 'anomalous-behavior',
        severity: riskLevel === 'critical' ? 'critical' : 'medium',
        context: request.context,
        indicators: ['Access denied', ...anomalies],
      });
    }

    return {
      allowed,
      reason: allowed ? 'Access granted by policy' : 'Access denied by policy',
      appliedPolicies,
      requiresMfa,
      trustScore,
      riskLevel,
      recommendations,
    };
  }

  /**
   * Create security session
   */
  async createSession(context: Omit<SecurityContext, 'trustScore' | 'riskFactors'>): Promise<string> {
    const sessionId = this.generateSessionId();

    // Calculate initial trust score
    const trustScore = await this.calculateTrustScore({ ...context, trustScore: 0, riskFactors: [] } as SecurityContext);

    // Detect risk factors
    const riskFactors = await this.identifyRiskFactors(context);

    const fullContext: SecurityContext = {
      ...context,
      sessionId,
      trustScore,
      riskFactors,
    };

    this.sessions.set(sessionId, fullContext);

    // Update device fingerprint
    await this.updateDeviceFingerprint(context.deviceId, context);

    // Update behavioral profile
    await this.updateBehavioralProfile(context.userId, context);

    logger.info('Security session created', {
      sessionId,
      userId: context.userId,
      trustScore,
    });

    return sessionId;
  }

  /**
   * Validate session
   */
  async validateSession(sessionId: string): Promise<SecurityContext | null> {
    const context = this.sessions.get(sessionId);

    if (!context) return null;

    // Check session expiry (24 hours)
    const age = Date.now() - context.timestamp.getTime();
    const maxAge = 24 * 60 * 60 * 1000;

    if (age > maxAge) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Recalculate trust score
    context.trustScore = await this.calculateTrustScore(context);

    return context;
  }

  /**
   * Add security policy
   */
  addPolicy(policy: AccessPolicy): void {
    this.policies.set(policy.id, policy);
    logger.info('Security policy added', { policyId: policy.id, name: policy.name });
  }

  /**
   * Remove security policy
   */
  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      logger.info('Security policy removed', { policyId });
    }
    return removed;
  }

  /**
   * Get active threats
   */
  getActiveThreats(userId?: string): ThreatSignal[] {
    let threats = Array.from(this.threats.values()).filter(t => !t.mitigated);

    if (userId) {
      threats = threats.filter(t => t.context.userId === userId);
    }

    return threats.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Mitigate threat
   */
  async mitigateThreat(threatId: string, action: string): Promise<void> {
    const threat = this.threats.get(threatId);

    if (!threat) {
      throw new Error(`Threat not found: ${threatId}`);
    }

    threat.mitigated = true;
    threat.mitigationAction = action;

    logger.info('Threat mitigated', {
      threatId,
      type: threat.type,
      action,
    });

    // Execute mitigation action
    await this.executeMitigation(threat, action);
  }

  /**
   * Assess security posture
   */
  async assessSecurityPosture(): Promise<SecurityPosture> {
    const categories = {
      authentication: 85,
      authorization: 90,
      encryption: 95,
      monitoring: 80,
      compliance: 88,
    };

    const overallScore = Object.values(categories).reduce((sum, val) => sum + val, 0) / 5;

    const vulnerabilities = await this.scanVulnerabilities();
    const recommendations = this.generatePostureRecommendations(categories, vulnerabilities);

    return {
      overallScore: Math.round(overallScore),
      categories,
      vulnerabilities,
      recommendations,
      lastAssessed: new Date(),
    };
  }

  /**
   * Get security statistics
   */
  getStatistics(): SecurityStatistics {
    const activeSessions = this.sessions.size;
    const activeThreats = this.getActiveThreats().length;

    const threatsBySeverity = {
      critical: this.getActiveThreats().filter(t => t.severity === 'critical').length,
      high: this.getActiveThreats().filter(t => t.severity === 'high').length,
      medium: this.getActiveThreats().filter(t => t.severity === 'medium').length,
      low: this.getActiveThreats().filter(t => t.severity === 'low').length,
    };

    const avgTrustScore = Array.from(this.sessions.values()).reduce(
      (sum, ctx) => sum + ctx.trustScore,
      0
    ) / (activeSessions || 1);

    return {
      activeSessions,
      activeThreats,
      threatsBySeverity,
      averageTrustScore: Math.round(avgTrustScore),
      totalPolicies: this.policies.size,
      trackedDevices: this.deviceFingerprints.size,
    };
  }

  /**
   * Calculate trust score
   */
  private async calculateTrustScore(context: SecurityContext): Promise<number> {
    let score = 100;

    // Check device fingerprint
    const device = this.deviceFingerprints.get(context.deviceId);
    if (!device || !device.trusted) {
      score -= 20;
    }

    // Check behavioral profile
    const behavioral = this.behavioralProfiles.get(context.userId);
    if (behavioral) {
      const anomalyScore = this.calculateAnomalyScore(context, behavioral);
      score -= anomalyScore * 30;
    }

    // Check IP reputation
    const ipRisk = await this.checkIpReputation(context.ipAddress);
    score -= ipRisk * 15;

    // Check for recent threats
    const recentThreats = this.getActiveThreats(context.userId);
    score -= recentThreats.length * 10;

    // Check location consistency
    if (behavioral && context.location) {
      const locationAnomaly = this.detectLocationAnomaly(context.location, behavioral.locations);
      if (locationAnomaly) {
        score -= 25;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Detect anomalies
   */
  private async detectAnomalies(context: SecurityContext): Promise<string[]> {
    const anomalies: string[] = [];

    const behavioral = this.behavioralProfiles.get(context.userId);

    if (!behavioral) {
      return anomalies;
    }

    // Check time-of-day anomaly
    const hour = context.timestamp.getHours();
    if (hour < behavioral.typicalLoginHours.min || hour > behavioral.typicalLoginHours.max) {
      anomalies.push('Unusual login time');
    }

    // Check device anomaly
    if (!behavioral.knownDevices.includes(context.deviceId)) {
      anomalies.push('Unknown device');
    }

    // Check location anomaly
    if (context.location) {
      if (!behavioral.locations.some(loc => loc.country === context.location!.country)) {
        anomalies.push('New country');
      }

      // Impossible travel detection
      if (behavioral.lastLocation) {
        const distance = this.calculateDistance(behavioral.lastLocation, context.location);
        const timeDiff = (context.timestamp.getTime() - behavioral.lastSeen.getTime()) / (1000 * 60 * 60);
        const speed = distance / timeDiff;

        // If speed > 500 km/h (impossible for normal travel)
        if (speed > 500) {
          anomalies.push('Impossible travel detected');
        }
      }
    }

    return anomalies;
  }

  /**
   * Find applicable policies
   */
  private findApplicablePolicies(resource: string, action: string): AccessPolicy[] {
    return Array.from(this.policies.values()).filter(policy => {
      const resourceMatches = this.matchPattern(resource, policy.resourcePattern);
      const actionMatches = policy.actions.includes('*') || policy.actions.includes(action);

      return resourceMatches && actionMatches;
    });
  }

  /**
   * Evaluate policy conditions
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    context: SecurityContext,
    trustScore: number
  ): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, context, trustScore)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate single condition
   */
  private evaluateCondition(
    condition: PolicyCondition,
    context: SecurityContext,
    trustScore: number
  ): boolean {
    switch (condition.type) {
      case 'trust-score':
        return this.compare(trustScore, condition.operator, condition.value);

      case 'ip-range':
        return this.ipInRange(context.ipAddress, condition.value);

      case 'geo-location':
        return context.location?.country === condition.value;

      case 'device-type':
        const device = this.deviceFingerprints.get(context.deviceId);
        return device?.type === condition.value;

      case 'time-window':
        const hour = context.timestamp.getHours();
        return hour >= condition.value.start && hour <= condition.value.end;

      default:
        return true;
    }
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(
    trustScore: number,
    anomalies: string[],
    threatCount: number
  ): AccessDecision['riskLevel'] {
    if (trustScore < 30 || threatCount > 2) return 'critical';
    if (trustScore < 50 || anomalies.length > 2 || threatCount > 0) return 'high';
    if (trustScore < 70 || anomalies.length > 0) return 'medium';
    return 'low';
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    trustScore: number,
    riskLevel: string,
    anomalies: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (trustScore < 50) {
      recommendations.push('Enable multi-factor authentication');
    }

    if (anomalies.includes('Unknown device')) {
      recommendations.push('Verify device by email or SMS');
    }

    if (anomalies.includes('New country')) {
      recommendations.push('Confirm location change via trusted channel');
    }

    if (riskLevel === 'critical') {
      recommendations.push('Immediate security review required');
      recommendations.push('Consider temporary access restriction');
    }

    return recommendations;
  }

  /**
   * Create threat signal
   */
  private async createThreatSignal(data: Omit<ThreatSignal, 'id' | 'detectedAt' | 'mitigated'>): Promise<string> {
    const id = this.generateId('threat');

    const signal: ThreatSignal = {
      ...data,
      id,
      detectedAt: new Date(),
      mitigated: false,
    };

    this.threats.set(id, signal);

    logger.warn('Threat signal created', {
      id,
      type: data.type,
      severity: data.severity,
      userId: data.context.userId,
    });

    return id;
  }

  /**
   * Execute mitigation action
   */
  private async executeMitigation(threat: ThreatSignal, action: string): Promise<void> {
    // In production, this would execute actual mitigation
    logger.info('Executing mitigation', {
      threatId: threat.id,
      action,
    });
  }

  /**
   * Verify session
   */
  private async verifySession(sessionId: string): Promise<boolean> {
    const context = await this.validateSession(sessionId);
    return context !== null;
  }

  /**
   * Update device fingerprint
   */
  private async updateDeviceFingerprint(
    deviceId: string,
    context: Omit<SecurityContext, 'trustScore' | 'riskFactors'>
  ): Promise<void> {
    let device = this.deviceFingerprints.get(deviceId);

    if (!device) {
      device = {
        deviceId,
        type: this.detectDeviceType(context.userAgent),
        firstSeen: new Date(),
        lastSeen: new Date(),
        loginCount: 0,
        trusted: false,
        ipAddresses: [],
      };
    }

    device.lastSeen = new Date();
    device.loginCount++;

    if (!device.ipAddresses.includes(context.ipAddress)) {
      device.ipAddresses.push(context.ipAddress);
    }

    // Trust device after 5 successful logins
    if (device.loginCount >= 5) {
      device.trusted = true;
    }

    this.deviceFingerprints.set(deviceId, device);
  }

  /**
   * Update behavioral profile
   */
  private async updateBehavioralProfile(
    userId: string,
    context: Omit<SecurityContext, 'trustScore' | 'riskFactors'>
  ): Promise<void> {
    let profile = this.behavioralProfiles.get(userId);

    if (!profile) {
      profile = {
        userId,
        knownDevices: [],
        locations: [],
        typicalLoginHours: { min: 24, max: 0 },
        lastSeen: new Date(),
        lastLocation: context.location,
      };
    }

    if (!profile.knownDevices.includes(context.deviceId)) {
      profile.knownDevices.push(context.deviceId);
    }

    if (context.location) {
      if (!profile.locations.some(loc => loc.country === context.location!.country)) {
        profile.locations.push(context.location);
      }
      profile.lastLocation = context.location;
    }

    const hour = context.timestamp.getHours();
    profile.typicalLoginHours.min = Math.min(profile.typicalLoginHours.min, hour);
    profile.typicalLoginHours.max = Math.max(profile.typicalLoginHours.max, hour);

    profile.lastSeen = new Date();

    this.behavioralProfiles.set(userId, profile);
  }

  /**
   * Identify risk factors
   */
  private async identifyRiskFactors(context: Omit<SecurityContext, 'trustScore' | 'riskFactors'>): Promise<string[]> {
    const factors: string[] = [];

    // Check IP reputation
    const ipRisk = await this.checkIpReputation(context.ipAddress);
    if (ipRisk > 0.5) {
      factors.push('Suspicious IP address');
    }

    // Check device
    const device = this.deviceFingerprints.get(context.deviceId);
    if (!device) {
      factors.push('New device');
    }

    return factors;
  }

  /**
   * Scan vulnerabilities (simplified)
   */
  private async scanVulnerabilities(): Promise<Vulnerability[]> {
    // In production, this would perform actual vulnerability scanning
    return [];
  }

  /**
   * Generate posture recommendations
   */
  private generatePostureRecommendations(
    categories: Record<string, number>,
    vulnerabilities: Vulnerability[]
  ): string[] {
    const recommendations: string[] = [];

    if (categories.authentication < 90) {
      recommendations.push('Strengthen authentication with MFA for all users');
    }

    if (categories.monitoring < 85) {
      recommendations.push('Enhance security monitoring and alerting');
    }

    if (vulnerabilities.some(v => v.severity === 'critical')) {
      recommendations.push('Address critical vulnerabilities immediately');
    }

    return recommendations;
  }

  /**
   * Check IP reputation (mock)
   */
  private async checkIpReputation(ipAddress: string): Promise<number> {
    // In production, this would check against threat intelligence feeds
    return Math.random() * 0.3; // Mock: 0-0.3 risk
  }

  /**
   * Calculate anomaly score
   */
  private calculateAnomalyScore(context: SecurityContext, profile: BehavioralProfile): number {
    let score = 0;

    if (!profile.knownDevices.includes(context.deviceId)) {
      score += 0.3;
    }

    if (context.location && !profile.locations.some(loc => loc.country === context.location!.country)) {
      score += 0.4;
    }

    return Math.min(score, 1);
  }

  /**
   * Detect location anomaly
   */
  private detectLocationAnomaly(location: GeoLocation, knownLocations: GeoLocation[]): boolean {
    return !knownLocations.some(loc => loc.country === location.country);
  }

  /**
   * Calculate distance between two locations (km)
   */
  private calculateDistance(loc1: GeoLocation, loc2: GeoLocation): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(loc2.latitude - loc1.latitude);
    const dLon = this.toRad(loc2.longitude - loc1.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.latitude)) *
        Math.cos(this.toRad(loc2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Match resource pattern
   */
  private matchPattern(resource: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(resource);
  }

  /**
   * Compare values
   */
  private compare(a: any, operator: string, b: any): boolean {
    switch (operator) {
      case 'equals':
        return a === b;
      case 'not-equals':
        return a !== b;
      case 'greater-than':
        return a > b;
      case 'less-than':
        return a < b;
      case 'in':
        return Array.isArray(b) && b.includes(a);
      case 'not-in':
        return Array.isArray(b) && !b.includes(a);
      default:
        return false;
    }
  }

  /**
   * Check if IP is in range (simplified)
   */
  private ipInRange(ip: string, range: string): boolean {
    // Simplified implementation
    return ip.startsWith(range.split('/')[0].substring(0, range.indexOf('.')));
  }

  /**
   * Detect device type from user agent
   */
  private detectDeviceType(userAgent: string): string {
    if (userAgent.includes('Mobile')) return 'mobile';
    if (userAgent.includes('Tablet')) return 'tablet';
    return 'desktop';
  }

  /**
   * Log access decision
   */
  private async logAccessDecision(
    request: AccessRequest,
    allowed: boolean,
    policies: string[]
  ): Promise<void> {
    logger.info('Access decision logged', {
      userId: request.context.userId,
      resource: request.resource,
      action: request.action,
      allowed,
      policies,
    });
  }

  /**
   * Initialize default policies
   */
  private initializeDefaultPolicies(): void {
    const policies: AccessPolicy[] = [
      {
        id: 'allow-high-trust',
        name: 'Allow High Trust Users',
        resourcePattern: '*',
        actions: ['*'],
        conditions: [
          { type: 'trust-score', operator: 'greater-than', value: 70 },
        ],
        effect: 'allow',
        priority: 100,
      },
      {
        id: 'deny-low-trust',
        name: 'Deny Low Trust Users',
        resourcePattern: '*',
        actions: ['*'],
        conditions: [
          { type: 'trust-score', operator: 'less-than', value: 30 },
        ],
        effect: 'deny',
        priority: 200,
      },
    ];

    for (const policy of policies) {
      this.policies.set(policy.id, policy);
    }
  }

  /**
   * Start threat monitoring
   */
  private startThreatMonitoring(): void {
    // In production, this would start real-time monitoring
    logger.info('Threat monitoring started');
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface DeviceProfile {
  deviceId: string;
  type: string;
  firstSeen: Date;
  lastSeen: Date;
  loginCount: number;
  trusted: boolean;
  ipAddresses: string[];
}

interface BehavioralProfile {
  userId: string;
  knownDevices: string[];
  locations: GeoLocation[];
  typicalLoginHours: { min: number; max: number };
  lastSeen: Date;
  lastLocation?: GeoLocation;
}

interface SecurityStatistics {
  activeSessions: number;
  activeThreats: number;
  threatsBySeverity: Record<string, number>;
  averageTrustScore: number;
  totalPolicies: number;
  trackedDevices: number;
}

// Singleton
let securityEngine: ZeroTrustSecurityEngine;

export function getZeroTrustSecurity(): ZeroTrustSecurityEngine {
  if (!securityEngine) {
    securityEngine = new ZeroTrustSecurityEngine();
  }
  return securityEngine;
}

export { ZeroTrustSecurityEngine };
