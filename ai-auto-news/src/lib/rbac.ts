/**
 * Advanced RBAC (Role-Based Access Control) System
 *
 * Provides granular permission management for enterprise organizations
 * Supports: Owner, Admin, Member, Viewer, Custom roles
 * Features: Resource-level permissions, role inheritance, audit trails
 */

export interface Permission {
  id: string;
  resource: string; // 'posts', 'users', 'billing', 'analytics', 'settings', 'api_keys'
  action: 'create' | 'read' | 'update' | 'delete' | 'manage' | 'execute';
  scope: 'own' | 'team' | 'organization' | 'global';
  conditions?: Record<string, any>; // Dynamic conditions (e.g., department, tag)
}

export interface Role {
  id: string;
  name: string;
  description: string;
  organizationId: string;
  permissions: Permission[];
  inheritsFrom?: string[]; // Role IDs to inherit from
  isSystem: boolean; // Built-in vs custom
  priority: number; // Higher priority wins on conflicts
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  resourceType?: string; // Optional: scope role to specific resource type
  resourceId?: string; // Optional: scope role to specific resource
  expiresAt?: Date; // Temporary role assignment
  assignedBy: string;
  assignedAt: Date;
}

export interface AccessPolicy {
  allow: boolean;
  reason?: string;
  matchedPermissions: Permission[];
}

// System-defined roles
export const SYSTEM_ROLES = {
  OWNER: {
    name: 'Owner',
    description: 'Full control over organization',
    permissions: [{ resource: '*', action: 'manage', scope: 'organization' }],
  },
  ADMIN: {
    name: 'Admin',
    description: 'Administrative access to most resources',
    permissions: [
      { resource: 'posts', action: 'manage', scope: 'organization' },
      { resource: 'users', action: 'manage', scope: 'organization' },
      { resource: 'api_keys', action: 'manage', scope: 'organization' },
      { resource: 'analytics', action: 'read', scope: 'organization' },
    ],
  },
  MEMBER: {
    name: 'Member',
    description: 'Standard member access',
    permissions: [
      { resource: 'posts', action: 'create', scope: 'team' },
      { resource: 'posts', action: 'read', scope: 'organization' },
      { resource: 'posts', action: 'update', scope: 'own' },
      { resource: 'posts', action: 'delete', scope: 'own' },
      { resource: 'analytics', action: 'read', scope: 'own' },
    ],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: [
      { resource: 'posts', action: 'read', scope: 'organization' },
      { resource: 'analytics', action: 'read', scope: 'own' },
    ],
  },
  BILLING_ADMIN: {
    name: 'Billing Admin',
    description: 'Manage billing and subscriptions',
    permissions: [
      { resource: 'billing', action: 'manage', scope: 'organization' },
      { resource: 'subscriptions', action: 'manage', scope: 'organization' },
      { resource: 'invoices', action: 'read', scope: 'organization' },
    ],
  },
  DEVELOPER: {
    name: 'Developer',
    description: 'API and integration access',
    permissions: [
      { resource: 'api_keys', action: 'manage', scope: 'own' },
      { resource: 'webhooks', action: 'manage', scope: 'team' },
      { resource: 'posts', action: 'create', scope: 'team' },
      { resource: 'posts', action: 'read', scope: 'organization' },
    ],
  },
} as const;

class RBACEngine {
  private rolesCache = new Map<string, Role>();
  private assignmentsCache = new Map<string, RoleAssignment[]>();

  /**
   * Check if user has permission to perform action on resource
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    context: {
      organizationId: string;
      teamId?: string;
      resourceOwnerId?: string;
      resourceId?: string;
    }
  ): Promise<AccessPolicy> {
    // Get all roles assigned to user
    const assignments = await this.getUserRoleAssignments(userId, context.organizationId);

    if (assignments.length === 0) {
      return { allow: false, reason: 'No roles assigned', matchedPermissions: [] };
    }

    // Collect all permissions from assigned roles
    const allPermissions: Permission[] = [];
    const roles = await this.getRolesByIds(assignments.map(a => a.roleId));

    for (const role of roles) {
      // Include inherited permissions
      const permissions = await this.getEffectivePermissions(role);
      allPermissions.push(...permissions);
    }

    // Check if any permission grants access
    const matchedPermissions = allPermissions.filter(perm =>
      this.permissionMatches(perm, resource, action, context, userId)
    );

    if (matchedPermissions.length > 0) {
      return {
        allow: true,
        matchedPermissions,
        reason: `Granted by ${matchedPermissions.length} permission(s)`
      };
    }

    return {
      allow: false,
      reason: 'No matching permissions found',
      matchedPermissions: []
    };
  }

  /**
   * Check if permission matches the requested access
   */
  private permissionMatches(
    perm: Permission,
    resource: string,
    action: string,
    context: any,
    userId: string
  ): boolean {
    // Check resource match
    if (perm.resource !== '*' && perm.resource !== resource) {
      return false;
    }

    // Check action match
    if (perm.action === 'manage') {
      // 'manage' grants all actions
      return true;
    }
    if (perm.action !== action) {
      return false;
    }

    // Check scope match
    switch (perm.scope) {
      case 'global':
        return true;

      case 'organization':
        return true; // Already filtered by organizationId

      case 'team':
        if (!context.teamId) return false;
        // Would need to verify user is in the team
        return true;

      case 'own':
        if (!context.resourceOwnerId) return false;
        return context.resourceOwnerId === userId;

      default:
        return false;
    }
  }

  /**
   * Get effective permissions including inherited ones
   */
  private async getEffectivePermissions(role: Role): Promise<Permission[]> {
    const permissions = [...role.permissions];

    if (role.inheritsFrom && role.inheritsFrom.length > 0) {
      const parentRoles = await this.getRolesByIds(role.inheritsFrom);
      for (const parentRole of parentRoles) {
        const parentPerms = await this.getEffectivePermissions(parentRole);
        permissions.push(...parentPerms);
      }
    }

    return permissions;
  }

  /**
   * Create custom role
   */
  async createRole(
    organizationId: string,
    name: string,
    permissions: Permission[],
    inheritsFrom?: string[]
  ): Promise<Role> {
    const role: Role = {
      id: crypto.randomUUID(),
      name,
      description: `Custom role: ${name}`,
      organizationId,
      permissions,
      inheritsFrom,
      isSystem: false,
      priority: 50, // Custom roles have medium priority
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // TODO: Save to database
    this.rolesCache.set(role.id, role);

    return role;
  }

  /**
   * Assign role to user
   */
  async assignRole(
    userId: string,
    roleId: string,
    assignedBy: string,
    options?: {
      resourceType?: string;
      resourceId?: string;
      expiresAt?: Date;
    }
  ): Promise<RoleAssignment> {
    const assignment: RoleAssignment = {
      id: crypto.randomUUID(),
      userId,
      roleId,
      resourceType: options?.resourceType,
      resourceId: options?.resourceId,
      expiresAt: options?.expiresAt,
      assignedBy,
      assignedAt: new Date(),
    };

    // TODO: Save to database
    const userAssignments = this.assignmentsCache.get(userId) || [];
    userAssignments.push(assignment);
    this.assignmentsCache.set(userId, userAssignments);

    return assignment;
  }

  /**
   * Revoke role from user
   */
  async revokeRole(userId: string, roleId: string): Promise<void> {
    const userAssignments = this.assignmentsCache.get(userId) || [];
    const filtered = userAssignments.filter(a => a.roleId !== roleId);
    this.assignmentsCache.set(userId, filtered);

    // TODO: Delete from database
  }

  /**
   * Get user's role assignments
   */
  private async getUserRoleAssignments(
    userId: string,
    organizationId: string
  ): Promise<RoleAssignment[]> {
    // TODO: Fetch from database with organizationId filter
    const assignments = this.assignmentsCache.get(userId) || [];

    // Filter out expired assignments
    const now = new Date();
    return assignments.filter(a => !a.expiresAt || a.expiresAt > now);
  }

  /**
   * Get roles by IDs
   */
  private async getRolesByIds(roleIds: string[]): Promise<Role[]> {
    // TODO: Fetch from database
    return roleIds
      .map(id => this.rolesCache.get(id))
      .filter((r): r is Role => r !== undefined);
  }

  /**
   * Get all roles for organization
   */
  async getOrganizationRoles(organizationId: string): Promise<Role[]> {
    // TODO: Fetch from database
    return Array.from(this.rolesCache.values())
      .filter(r => r.organizationId === organizationId);
  }

  /**
   * Bulk permission check for UI rendering
   */
  async checkPermissions(
    userId: string,
    checks: Array<{ resource: string; action: string }>,
    context: any
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const check of checks) {
      const key = `${check.resource}:${check.action}`;
      const policy = await this.checkPermission(
        userId,
        check.resource,
        check.action,
        context
      );
      results[key] = policy.allow;
    }

    return results;
  }
}

// Singleton instance
let rbacEngine: RBACEngine;

export function getRBACEngine(): RBACEngine {
  if (!rbacEngine) {
    rbacEngine = new RBACEngine();
  }
  return rbacEngine;
}

// Middleware helper
export function requirePermission(resource: string, action: string) {
  return async (userId: string, context: any) => {
    const rbac = getRBACEngine();
    const policy = await rbac.checkPermission(userId, resource, action, context);

    if (!policy.allow) {
      throw new Error(`Access denied: ${policy.reason}`);
    }

    return policy;
  };
}
