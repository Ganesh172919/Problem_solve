import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  MultiTenantRbacEngine,
  getRbacEngine,
  Principal,
  Resource,
  Role,
  Policy,
} from '../../../src/lib/multiTenantRbacEngine';

const TENANT = 'tenant_test';

const ADMIN: Principal = {
  id: 'admin_1',
  type: 'user',
  tenantId: TENANT,
  roles: ['tenant_admin'],
  attributes: { department: 'engineering' },
};

const VIEWER_USER: Principal = {
  id: 'viewer_1',
  type: 'user',
  tenantId: TENANT,
  roles: ['viewer'],
  attributes: {},
};

const ARTICLE: Resource = {
  type: 'article',
  id: 'article_123',
  attributes: { published: true },
  tenantId: TENANT,
  ownerId: 'admin_1',
};

describe('MultiTenantRbacEngine', () => {
  beforeEach(() => {
    (globalThis as any).__multiTenantRbacEngine__ = undefined;
  });

  it('singleton returns the same instance', () => {
    const a = getRbacEngine();
    const b = getRbacEngine();
    expect(a).toBe(b);
  });

  it('default roles bootstrapped on singleton creation', () => {
    const engine = getRbacEngine();
    const stats = engine.getStats();
    expect(stats.roleCount).toBeGreaterThan(0);
  });

  it('viewer can read articles', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const decision = engine.check(VIEWER_USER, ARTICLE, 'read');
    expect(decision.allowed).toBe(true);
  });

  it('viewer cannot delete articles', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const decision = engine.check(VIEWER_USER, ARTICLE, 'delete');
    expect(decision.allowed).toBe(false);
  });

  it('super_admin can do anything', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const superAdmin: Principal = {
      id: 'sa', type: 'user', tenantId: TENANT, roles: ['super_admin'], attributes: {},
    };
    const decision = engine.check(superAdmin, ARTICLE, 'delete');
    expect(decision.allowed).toBe(true);
  });

  it('cross-tenant access is denied for regular users', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const crossUser: Principal = {
      id: 'other_user', type: 'user', tenantId: 'different_tenant', roles: ['tenant_admin'], attributes: {},
    };
    const decision = engine.check(crossUser, ARTICLE, 'read');
    expect(decision.allowed).toBe(false);
  });

  it('explicit deny policy overrides allow', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const denyPolicy: Policy = {
      id: 'deny_article_read',
      name: 'Deny Article Read',
      tenantId: null,
      effect: 'deny',
      principals: ['viewer'],
      resources: ['article'],
      actions: ['read'],
      conditions: [],
      conditionOperator: 'all',
      priority: 100,
      enabled: true,
    };
    engine.addPolicy(denyPolicy);
    const decision = engine.check(VIEWER_USER, ARTICLE, 'read');
    expect(decision.allowed).toBe(false);
  });

  it('assignRoleToUser adds role to principal', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const user: Principal = {
      id: 'plain_user', type: 'user', tenantId: TENANT, roles: [], attributes: {},
    };
    engine.assignRoleToUser(user, 'viewer');
    expect(user.roles).toContain('viewer');
  });

  it('revokeRoleFromUser removes role', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const user: Principal = {
      id: 'plain_user2', type: 'user', tenantId: TENANT, roles: ['viewer'], attributes: {},
    };
    engine.revokeRoleFromUser(user, 'viewer');
    expect(user.roles).not.toContain('viewer');
  });

  it('getAuditLog returns entries after checks', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    engine.check(VIEWER_USER, ARTICLE, 'read');
    const audit = engine.getAuditLog({ principalId: 'viewer_1' });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('checkBulk returns map of decisions', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const results = engine.checkBulk(VIEWER_USER, [
      { resource: ARTICLE, action: 'read' },
      { resource: ARTICLE, action: 'write' },
    ]);
    expect(results.size).toBe(2);
  });

  it('getStats returns role and policy counts', () => {
    const engine = new MultiTenantRbacEngine();
    engine.bootstrapDefaultRoles();
    const stats = engine.getStats();
    expect(stats.roleCount).toBeGreaterThan(0);
    expect(typeof stats.cacheHitRate).toBe('number');
  });
});
