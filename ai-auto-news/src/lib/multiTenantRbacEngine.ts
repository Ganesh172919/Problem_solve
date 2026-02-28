/**
 * @module multiTenantRbacEngine
 * @description Enterprise-grade multi-tenant Role-Based Access Control engine
 * with attribute-based policies, hierarchical roles, permission inheritance,
 * dynamic policy evaluation, and audit logging for all access decisions.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type Effect = 'allow' | 'deny';
export type PolicyOperator = 'all' | 'any';

export interface Resource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  tenantId: string;
  ownerId?: string;
}

export interface Principal {
  id: string;
  type: 'user' | 'service' | 'api_key' | 'system';
  tenantId: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string;
}

export interface Role {
  id: string;
  name: string;
  tenantId: string | null; // null = global role
  permissions: string[];
  inherits: string[];      // parent role ids
  description: string;
  createdAt: number;
}

export interface PolicyCondition {
  attribute: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'not_in' | 'contains' | 'starts_with';
  value: unknown;
  target: 'principal' | 'resource' | 'context';
}

export interface Policy {
  id: string;
  name: string;
  tenantId: string | null;
  effect: Effect;
  principals: string[];    // role ids or principal ids
  resources: string[];     // resource type patterns
  actions: string[];
  conditions: PolicyCondition[];
  conditionOperator: PolicyOperator;
  priority: number;        // higher = evaluated first
  enabled: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  effect: Effect;
  matchedPolicies: string[];
  deniedPolicies: string[];
  reasons: string[];
  processingMs: number;
  principalId: string;
  resourceId: string;
  action: string;
  timestamp: number;
}

export interface AuditEntry {
  decisionId: string;
  principalId: string;
  principalType: string;
  tenantId: string;
  resource: string;
  action: string;
  decision: AccessDecision;
  timestamp: number;
}

// ── Policy Evaluator ──────────────────────────────────────────────────────────

function evaluateCondition(
  condition: PolicyCondition,
  principal: Principal,
  resource: Resource,
  context: Record<string, unknown>
): boolean {
  let target: Record<string, unknown>;
  switch (condition.target) {
    case 'principal': target = principal.attributes; break;
    case 'resource': target = resource.attributes; break;
    case 'context': target = context; break;
    default: return false;
  }

  const val = target[condition.attribute];

  switch (condition.operator) {
    case 'eq': return val === condition.value;
    case 'neq': return val !== condition.value;
    case 'gt': return typeof val === 'number' && val > (condition.value as number);
    case 'lt': return typeof val === 'number' && val < (condition.value as number);
    case 'in': return Array.isArray(condition.value) && (condition.value as unknown[]).includes(val);
    case 'not_in': return Array.isArray(condition.value) && !(condition.value as unknown[]).includes(val);
    case 'contains': return typeof val === 'string' && val.includes(String(condition.value));
    case 'starts_with': return typeof val === 'string' && val.startsWith(String(condition.value));
    default: return false;
  }
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

// ── Core Engine ───────────────────────────────────────────────────────────────

export class MultiTenantRbacEngine {
  private roles = new Map<string, Role>();
  private permissions = new Map<string, Permission>();
  private policies = new Map<string, Policy>();
  private auditLog: AuditEntry[] = [];
  private permissionCache = new Map<string, boolean>();
  private cacheHits = 0;
  private totalDecisions = 0;
  private maxAuditLog = 10000;

  // ── Role Management ──────────────────────────────────────────────────────

  definePermission(perm: Permission): void {
    this.permissions.set(perm.id, perm);
  }

  defineRole(role: Role): void {
    this.roles.set(role.id, role);
    this.permissionCache.clear();
    logger.debug('Role defined', { id: role.id, name: role.name });
  }

  assignRoleToUser(principal: Principal, roleId: string): void {
    if (!principal.roles.includes(roleId)) {
      principal.roles.push(roleId);
      this.permissionCache.clear();
    }
  }

  revokeRoleFromUser(principal: Principal, roleId: string): void {
    principal.roles = principal.roles.filter(r => r !== roleId);
    this.permissionCache.clear();
  }

  // ── Policy Management ────────────────────────────────────────────────────

  addPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
    this.permissionCache.clear();
    logger.debug('Policy added', { id: policy.id, name: policy.name, effect: policy.effect });
  }

  removePolicy(policyId: string): void {
    this.policies.delete(policyId);
    this.permissionCache.clear();
  }

  // ── Permission Resolution ────────────────────────────────────────────────

  private resolveRolePermissions(roleId: string, visited = new Set<string>()): Set<string> {
    if (visited.has(roleId)) return new Set(); // Prevent cycles
    visited.add(roleId);

    const role = this.roles.get(roleId);
    if (!role) return new Set();

    const perms = new Set<string>(role.permissions);

    // Recurse through inheritance
    for (const parentId of role.inherits) {
      for (const perm of this.resolveRolePermissions(parentId, visited)) {
        perms.add(perm);
      }
    }

    return perms;
  }

  private getPrincipalPermissions(principal: Principal): Set<string> {
    const allPerms = new Set<string>();
    for (const roleId of principal.roles) {
      for (const perm of this.resolveRolePermissions(roleId)) {
        allPerms.add(perm);
      }
    }
    return allPerms;
  }

  // ── Access Check ─────────────────────────────────────────────────────────

  check(
    principal: Principal,
    resource: Resource,
    action: string,
    context: Record<string, unknown> = {}
  ): AccessDecision {
    const start = Date.now();
    this.totalDecisions++;

    // Tenant isolation: deny cross-tenant access unless system/service
    if (principal.type === 'user' && principal.tenantId !== resource.tenantId) {
      return this.deny(principal, resource, action, ['Cross-tenant access denied'], [], start);
    }

    // Cache key
    const cacheKey = `${principal.id}:${resource.type}:${action}:${resource.id}`;
    if (this.permissionCache.has(cacheKey)) {
      this.cacheHits++;
      // Return cached but record fresh timing
      const cached = this.permissionCache.get(cacheKey)!;
      const decision: AccessDecision = {
        allowed: cached,
        effect: cached ? 'allow' : 'deny',
        matchedPolicies: ['(cached)'],
        deniedPolicies: [],
        reasons: ['Decision served from cache'],
        processingMs: Date.now() - start,
        principalId: principal.id,
        resourceId: resource.id,
        action,
        timestamp: Date.now(),
      };
      this.addAudit(principal, resource, action, decision);
      return decision;
    }

    // Get applicable policies, sorted by priority descending
    const applicablePolicies = Array.from(this.policies.values())
      .filter(p =>
        p.enabled &&
        (p.tenantId === null || p.tenantId === principal.tenantId) &&
        p.resources.some(r => matchPattern(r, resource.type)) &&
        p.actions.some(a => matchPattern(a, action)) &&
        (p.principals.length === 0 ||
          p.principals.some(pid =>
            pid === principal.id || principal.roles.includes(pid)
          ))
      )
      .sort((a, b) => b.priority - a.priority);

    const matchedPolicies: string[] = [];
    const deniedPolicies: string[] = [];
    const reasons: string[] = [];
    let explicitAllow = false;
    let explicitDeny = false;

    for (const policy of applicablePolicies) {
      // Evaluate conditions
      const conditionResults = policy.conditions.map(c =>
        evaluateCondition(c, principal, resource, context)
      );

      const conditionsPassed = policy.conditions.length === 0 ||
        (policy.conditionOperator === 'all'
          ? conditionResults.every(Boolean)
          : conditionResults.some(Boolean));

      if (!conditionsPassed) continue;

      if (policy.effect === 'deny') {
        explicitDeny = true;
        deniedPolicies.push(policy.id);
        reasons.push(`Denied by policy: ${policy.name}`);
      } else {
        explicitAllow = true;
        matchedPolicies.push(policy.id);
        reasons.push(`Allowed by policy: ${policy.name}`);
      }
    }

    // Check permission-based access (fallback)
    if (!explicitDeny && !explicitAllow) {
      const perms = this.getPrincipalPermissions(principal);
      const permId = `${resource.type}:${action}`;
      const resourceWildcard = `${resource.type}:*`;
      const actionWildcard = `*:${action}`;
      const superPermId = `*:*`;

      if (
        perms.has(permId) ||
        perms.has(resourceWildcard) ||
        perms.has(actionWildcard) ||
        perms.has(superPermId)
      ) {
        explicitAllow = true;
        reasons.push(`Allowed by role permission: ${permId}`);
      }
    }

    // Deny takes precedence
    const allowed = explicitAllow && !explicitDeny;

    if (!explicitAllow && !explicitDeny) {
      reasons.push('No matching policy or permission found - default deny');
    }

    const decision = allowed
      ? this.allow(principal, resource, action, reasons, matchedPolicies, deniedPolicies, start)
      : this.deny(principal, resource, action, reasons, deniedPolicies, start);

    // Cache for 60 seconds
    this.permissionCache.set(cacheKey, allowed);
    setTimeout(() => this.permissionCache.delete(cacheKey), 60_000);

    this.addAudit(principal, resource, action, decision);
    return decision;
  }

  checkBulk(
    principal: Principal,
    checks: Array<{ resource: Resource; action: string }>
  ): Map<string, AccessDecision> {
    const results = new Map<string, AccessDecision>();
    for (const { resource, action } of checks) {
      const key = `${resource.type}:${resource.id}:${action}`;
      results.set(key, this.check(principal, resource, action));
    }
    return results;
  }

  private allow(
    principal: Principal,
    resource: Resource,
    action: string,
    reasons: string[],
    matchedPolicies: string[],
    deniedPolicies: string[],
    start: number
  ): AccessDecision {
    return {
      allowed: true,
      effect: 'allow',
      matchedPolicies,
      deniedPolicies,
      reasons,
      processingMs: Date.now() - start,
      principalId: principal.id,
      resourceId: resource.id,
      action,
      timestamp: Date.now(),
    };
  }

  private deny(
    principal: Principal,
    resource: Resource,
    action: string,
    reasons: string[],
    deniedPolicies: string[],
    start: number
  ): AccessDecision {
    return {
      allowed: false,
      effect: 'deny',
      matchedPolicies: [],
      deniedPolicies,
      reasons,
      processingMs: Date.now() - start,
      principalId: principal.id,
      resourceId: resource.id,
      action,
      timestamp: Date.now(),
    };
  }

  private addAudit(
    principal: Principal,
    resource: Resource,
    action: string,
    decision: AccessDecision
  ): void {
    if (this.auditLog.length >= this.maxAuditLog) {
      this.auditLog.splice(0, 100);
    }
    this.auditLog.push({
      decisionId: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      principalId: principal.id,
      principalType: principal.type,
      tenantId: principal.tenantId,
      resource: `${resource.type}:${resource.id}`,
      action,
      decision,
      timestamp: Date.now(),
    });
  }

  getAuditLog(filters?: {
    principalId?: string;
    tenantId?: string;
    allowed?: boolean;
    since?: number;
  }): AuditEntry[] {
    let entries = [...this.auditLog];
    if (filters?.principalId) entries = entries.filter(e => e.principalId === filters.principalId);
    if (filters?.tenantId) entries = entries.filter(e => e.tenantId === filters.tenantId);
    if (filters?.allowed !== undefined) entries = entries.filter(e => e.decision.allowed === filters.allowed);
    if (filters?.since) entries = entries.filter(e => e.timestamp >= filters.since!);
    return entries.slice(-1000);
  }

  getStats(): {
    totalDecisions: number;
    cacheHitRate: number;
    roleCount: number;
    policyCount: number;
    permissionCount: number;
  } {
    return {
      totalDecisions: this.totalDecisions,
      cacheHitRate: this.totalDecisions > 0 ? this.cacheHits / this.totalDecisions : 0,
      roleCount: this.roles.size,
      policyCount: this.policies.size,
      permissionCount: this.permissions.size,
    };
  }

  // ── Bootstrap Defaults ──────────────────────────────────────────────────

  bootstrapDefaultRoles(): void {
    const defaultRoles: Role[] = [
      {
        id: 'super_admin', name: 'Super Admin', tenantId: null,
        permissions: ['*:*'], inherits: [], description: 'Full platform access',
        createdAt: Date.now(),
      },
      {
        id: 'tenant_admin', name: 'Tenant Admin', tenantId: null,
        permissions: ['*:read', '*:write', '*:delete', 'users:manage', 'billing:manage'],
        inherits: [], description: 'Full tenant access', createdAt: Date.now(),
      },
      {
        id: 'developer', name: 'Developer', tenantId: null,
        permissions: ['api:read', 'api:write', 'deployments:manage', 'logs:read'],
        inherits: ['viewer'], description: 'Developer access', createdAt: Date.now(),
      },
      {
        id: 'viewer', name: 'Viewer', tenantId: null,
        permissions: ['*:read'], inherits: [], description: 'Read-only access',
        createdAt: Date.now(),
      },
    ];

    for (const role of defaultRoles) this.defineRole(role);
    logger.info('Default RBAC roles bootstrapped', { count: defaultRoles.length });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __multiTenantRbacEngine__: MultiTenantRbacEngine | undefined;
}

export function getRbacEngine(): MultiTenantRbacEngine {
  if (!globalThis.__multiTenantRbacEngine__) {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    globalThis.__multiTenantRbacEngine__ = engine;
  }
  return globalThis.__multiTenantRbacEngine__;
}
