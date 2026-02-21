import { v4 as uuidv4 } from 'uuid';

interface ComplianceControl {
  id: string;
  category: string;
  name: string;
  description: string;
  requirement: string;
  status: 'implemented' | 'partial' | 'planned' | 'not_applicable';
  evidence: string[];
  owner: string;
  lastReviewDate?: Date;
  nextReviewDate?: Date;
}

interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: string;
  userId?: string;
  resourceType: string;
  resourceId: string;
  action: string;
  result: 'success' | 'failure';
  ipAddress?: string;
  userAgent?: string;
  metadata: Record<string, any>;
}

interface DataRetentionPolicy {
  dataType: string;
  retentionDays: number;
  archiveAfterDays?: number;
  deleteAfterDays: number;
  encryptionRequired: boolean;
}

interface AccessLog {
  id: string;
  timestamp: Date;
  userId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  granted: boolean;
  reason?: string;
}

interface SecurityIncident {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  detectedAt: Date;
  resolvedAt?: Date;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  affectedUsers: string[];
  affectedSystems: string[];
  remediationSteps: string[];
  rootCause?: string;
}

export class SOC2ComplianceFramework {
  private controls: Map<string, ComplianceControl> = new Map();
  private auditEvents: AuditEvent[] = [];
  private accessLogs: AccessLog[] = [];
  private incidents: Map<string, SecurityIncident> = new Map();
  private retentionPolicies: Map<string, DataRetentionPolicy> = new Map();

  constructor() {
    this.initializeControls();
    this.initializeRetentionPolicies();
  }

  /**
   * Initialize SOC2 controls
   */
  private initializeControls(): void {
    // Common Criteria (CC) controls for SOC 2
    const controls: Omit<ComplianceControl, 'id'>[] = [
      // CC1: Control Environment
      {
        category: 'CC1',
        name: 'Organizational Structure',
        description: 'Establish organizational structure with clear roles and responsibilities',
        requirement: 'Define and document organizational structure',
        status: 'implemented',
        evidence: ['org_chart.pdf', 'roles_responsibilities.md'],
        owner: 'CTO',
      },
      {
        category: 'CC1',
        name: 'Code of Conduct',
        description: 'Maintain and enforce code of conduct',
        requirement: 'Document and communicate code of conduct to all personnel',
        status: 'implemented',
        evidence: ['code_of_conduct.pdf'],
        owner: 'HR',
      },
      // CC2: Communication and Information
      {
        category: 'CC2',
        name: 'Security Policies',
        description: 'Establish and communicate security policies',
        requirement: 'Document and maintain security policies',
        status: 'implemented',
        evidence: ['security_policy.pdf', 'acceptable_use_policy.pdf'],
        owner: 'CISO',
      },
      {
        category: 'CC2',
        name: 'Incident Response Plan',
        description: 'Maintain incident response procedures',
        requirement: 'Document and test incident response plan',
        status: 'implemented',
        evidence: ['incident_response_plan.pdf', 'drills_log.xlsx'],
        owner: 'Security Team',
      },
      // CC3: Risk Assessment
      {
        category: 'CC3',
        name: 'Risk Assessment Process',
        description: 'Conduct regular risk assessments',
        requirement: 'Perform annual risk assessment',
        status: 'implemented',
        evidence: ['risk_assessment_2024.pdf'],
        owner: 'Risk Manager',
      },
      // CC4: Monitoring Activities
      {
        category: 'CC4',
        name: 'System Monitoring',
        description: 'Monitor system performance and security',
        requirement: 'Implement continuous monitoring',
        status: 'implemented',
        evidence: ['monitoring_dashboard', 'alerting_rules.yaml'],
        owner: 'DevOps',
      },
      // CC5: Control Activities
      {
        category: 'CC5',
        name: 'Access Control',
        description: 'Implement role-based access control',
        requirement: 'Enforce least privilege access',
        status: 'implemented',
        evidence: ['rbac_policy.md', 'access_reviews.xlsx'],
        owner: 'Security Team',
      },
      // CC6: Logical and Physical Access Controls
      {
        category: 'CC6',
        name: 'Authentication',
        description: 'Implement strong authentication mechanisms',
        requirement: 'Require MFA for sensitive access',
        status: 'partial',
        evidence: ['auth_implementation.md'],
        owner: 'Engineering',
      },
      {
        category: 'CC6',
        name: 'Encryption',
        description: 'Encrypt data in transit and at rest',
        requirement: 'Use industry-standard encryption',
        status: 'implemented',
        evidence: ['encryption_policy.md', 'tls_config.yaml'],
        owner: 'Engineering',
      },
      // CC7: System Operations
      {
        category: 'CC7',
        name: 'Change Management',
        description: 'Implement change management process',
        requirement: 'Review and approve all changes',
        status: 'implemented',
        evidence: ['change_management_policy.md', 'change_log.xlsx'],
        owner: 'DevOps',
      },
      {
        category: 'CC7',
        name: 'Backup and Recovery',
        description: 'Maintain backup and recovery procedures',
        requirement: 'Test backups regularly',
        status: 'implemented',
        evidence: ['backup_policy.md', 'recovery_tests.xlsx'],
        owner: 'DevOps',
      },
      // CC8: Change Management
      {
        category: 'CC8',
        name: 'Software Development Lifecycle',
        description: 'Follow secure SDLC practices',
        requirement: 'Implement security in development',
        status: 'implemented',
        evidence: ['sdlc_policy.md', 'code_review_guidelines.md'],
        owner: 'Engineering',
      },
      // CC9: Risk Mitigation
      {
        category: 'CC9',
        name: 'Vendor Management',
        description: 'Assess and monitor third-party vendors',
        requirement: 'Conduct vendor security assessments',
        status: 'implemented',
        evidence: ['vendor_assessment_template.xlsx', 'vendor_reviews.xlsx'],
        owner: 'Procurement',
      },
    ];

    controls.forEach(control => {
      const id = uuidv4();
      this.controls.set(id, { id, ...control });
    });
  }

  /**
   * Initialize data retention policies
   */
  private initializeRetentionPolicies(): void {
    const policies: DataRetentionPolicy[] = [
      {
        dataType: 'audit_logs',
        retentionDays: 2555, // 7 years
        archiveAfterDays: 90,
        deleteAfterDays: 2555,
        encryptionRequired: true,
      },
      {
        dataType: 'user_data',
        retentionDays: 1825, // 5 years
        deleteAfterDays: 1825,
        encryptionRequired: true,
      },
      {
        dataType: 'payment_records',
        retentionDays: 2555, // 7 years
        deleteAfterDays: 2555,
        encryptionRequired: true,
      },
      {
        dataType: 'access_logs',
        retentionDays: 365,
        archiveAfterDays: 90,
        deleteAfterDays: 365,
        encryptionRequired: true,
      },
      {
        dataType: 'security_incidents',
        retentionDays: 1825,
        deleteAfterDays: 1825,
        encryptionRequired: true,
      },
      {
        dataType: 'session_data',
        retentionDays: 30,
        deleteAfterDays: 30,
        encryptionRequired: false,
      },
    ];

    policies.forEach(policy => {
      this.retentionPolicies.set(policy.dataType, policy);
    });
  }

  /**
   * Log audit event
   */
  logAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const auditEvent: AuditEvent = {
      id: uuidv4(),
      timestamp: new Date(),
      ...event,
    };

    this.auditEvents.push(auditEvent);

    // Enforce retention policy
    this.enforceRetentionPolicy('audit_logs');

    return auditEvent;
  }

  /**
   * Log access attempt
   */
  logAccess(log: Omit<AccessLog, 'id' | 'timestamp'>): AccessLog {
    const accessLog: AccessLog = {
      id: uuidv4(),
      timestamp: new Date(),
      ...log,
    };

    this.accessLogs.push(accessLog);

    // Enforce retention policy
    this.enforceRetentionPolicy('access_logs');

    return accessLog;
  }

  /**
   * Report security incident
   */
  reportIncident(incident: Omit<SecurityIncident, 'id' | 'detectedAt' | 'status'>): SecurityIncident {
    const securityIncident: SecurityIncident = {
      id: uuidv4(),
      detectedAt: new Date(),
      status: 'open',
      ...incident,
    };

    this.incidents.set(securityIncident.id, securityIncident);

    console.error(`SECURITY INCIDENT: ${securityIncident.type} - ${securityIncident.description}`);

    return securityIncident;
  }

  /**
   * Update incident status
   */
  updateIncident(
    incidentId: string,
    update: Partial<Omit<SecurityIncident, 'id' | 'detectedAt'>>
  ): SecurityIncident | null {
    const incident = this.incidents.get(incidentId);
    if (!incident) return null;

    Object.assign(incident, update);

    if (update.status === 'resolved' && !incident.resolvedAt) {
      incident.resolvedAt = new Date();
    }

    return incident;
  }

  /**
   * Get compliance status
   */
  getComplianceStatus(): {
    totalControls: number;
    implemented: number;
    partial: number;
    planned: number;
    compliancePercentage: number;
    controlsByCategory: Record<string, number>;
  } {
    const controls = Array.from(this.controls.values());
    const totalControls = controls.length;
    const implemented = controls.filter(c => c.status === 'implemented').length;
    const partial = controls.filter(c => c.status === 'partial').length;
    const planned = controls.filter(c => c.status === 'planned').length;

    const compliancePercentage = ((implemented + partial * 0.5) / totalControls) * 100;

    const controlsByCategory: Record<string, number> = {};
    controls.forEach(control => {
      controlsByCategory[control.category] = (controlsByCategory[control.category] || 0) + 1;
    });

    return {
      totalControls,
      implemented,
      partial,
      planned,
      compliancePercentage,
      controlsByCategory,
    };
  }

  /**
   * Get audit trail for resource
   */
  getAuditTrail(
    resourceType: string,
    resourceId: string,
    startDate?: Date,
    endDate?: Date
  ): AuditEvent[] {
    return this.auditEvents.filter(event => {
      if (event.resourceType !== resourceType || event.resourceId !== resourceId) {
        return false;
      }
      if (startDate && event.timestamp < startDate) {
        return false;
      }
      if (endDate && event.timestamp > endDate) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get access history for user
   */
  getAccessHistory(userId: string, days: number = 30): AccessLog[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.accessLogs.filter(
      log => log.userId === userId && log.timestamp >= cutoff
    );
  }

  /**
   * Get failed access attempts
   */
  getFailedAccessAttempts(hours: number = 24): AccessLog[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.accessLogs.filter(
      log => !log.granted && log.timestamp >= cutoff
    );
  }

  /**
   * Get open incidents
   */
  getOpenIncidents(): SecurityIncident[] {
    return Array.from(this.incidents.values()).filter(
      i => i.status === 'open' || i.status === 'investigating'
    );
  }

  /**
   * Enforce data retention policy
   */
  private enforceRetentionPolicy(dataType: string): void {
    const policy = this.retentionPolicies.get(dataType);
    if (!policy) return;

    const cutoffDate = new Date(Date.now() - policy.deleteAfterDays * 24 * 60 * 60 * 1000);

    if (dataType === 'audit_logs') {
      this.auditEvents = this.auditEvents.filter(
        event => event.timestamp >= cutoffDate
      );
    } else if (dataType === 'access_logs') {
      this.accessLogs = this.accessLogs.filter(
        log => log.timestamp >= cutoffDate
      );
    }
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(): {
    status: ReturnType<typeof this.getComplianceStatus>;
    controls: ComplianceControl[];
    recentAudits: number;
    openIncidents: number;
    failedAccessAttempts: number;
  } {
    return {
      status: this.getComplianceStatus(),
      controls: Array.from(this.controls.values()),
      recentAudits: this.auditEvents.filter(
        e => e.timestamp >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      ).length,
      openIncidents: this.getOpenIncidents().length,
      failedAccessAttempts: this.getFailedAccessAttempts(24).length,
    };
  }

  /**
   * Check control compliance
   */
  checkControlCompliance(controlId: string): {
    compliant: boolean;
    issues: string[];
  } {
    const control = this.controls.get(controlId);
    if (!control) {
      return { compliant: false, issues: ['Control not found'] };
    }

    const issues: string[] = [];

    if (control.status !== 'implemented') {
      issues.push(`Control not fully implemented (status: ${control.status})`);
    }

    if (control.evidence.length === 0) {
      issues.push('No evidence documented');
    }

    if (!control.lastReviewDate) {
      issues.push('No review date recorded');
    } else {
      const daysSinceReview = (Date.now() - control.lastReviewDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReview > 365) {
        issues.push('Control review overdue (> 1 year)');
      }
    }

    return {
      compliant: issues.length === 0,
      issues,
    };
  }

  /**
   * Export audit logs for compliance
   */
  exportAuditLogs(startDate: Date, endDate: Date): AuditEvent[] {
    return this.auditEvents.filter(
      event => event.timestamp >= startDate && event.timestamp <= endDate
    );
  }
}

// Singleton instance
let soc2Instance: SOC2ComplianceFramework | null = null;

export function getSOC2Compliance(): SOC2ComplianceFramework {
  if (!soc2Instance) {
    soc2Instance = new SOC2ComplianceFramework();
  }
  return soc2Instance;
}

export { ComplianceControl, AuditEvent, SecurityIncident, AccessLog, DataRetentionPolicy };
