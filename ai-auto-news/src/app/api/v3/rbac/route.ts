import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getRbacEngine, Principal, Resource, Policy } from '@/lib/multiTenantRbacEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const principalId = searchParams.get('principalId');
  const tenantId = searchParams.get('tenantId');

  try {
    const engine = getRbacEngine();

    if (action === 'audit') {
      const since = searchParams.get('since') ? Number(searchParams.get('since')) : undefined;
      const allowed = searchParams.get('allowed') !== null
        ? searchParams.get('allowed') === 'true'
        : undefined;
      const entries = engine.getAuditLog({
        principalId: principalId ?? undefined,
        tenantId: tenantId ?? undefined,
        allowed,
        since,
      });
      return NextResponse.json({ success: true, data: { entries, count: entries.length } });
    }

    const stats = engine.getStats();
    return NextResponse.json({ success: true, data: { stats } });
  } catch (err) {
    logger.error('RBAC GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const engine = getRbacEngine();

    if (action === 'check') {
      const principal = body.principal as Principal;
      const resource = body.resource as Resource;
      const accessAction = body.accessAction as string;
      const context = (body.context as Record<string, unknown>) ?? {};
      const decision = engine.check(principal, resource, accessAction, context);
      return NextResponse.json({ success: true, data: { decision } });
    }

    if (action === 'check_bulk') {
      const principal = body.principal as Principal;
      const checks = body.checks as Array<{ resource: Resource; action: string }>;
      const results = engine.checkBulk(principal, checks);
      return NextResponse.json({
        success: true,
        data: { results: Object.fromEntries(results) },
      });
    }

    if (action === 'define_role') {
      const role = body.role as Parameters<typeof engine.defineRole>[0];
      engine.defineRole(role);
      return NextResponse.json({ success: true, data: { message: 'Role defined', roleId: role.id } });
    }

    if (action === 'add_policy') {
      const policy = body.policy as Policy;
      engine.addPolicy(policy);
      return NextResponse.json({ success: true, data: { message: 'Policy added', policyId: policy.id } });
    }

    if (action === 'remove_policy') {
      const policyId = body.policyId as string;
      engine.removePolicy(policyId);
      return NextResponse.json({ success: true, data: { message: 'Policy removed', policyId } });
    }

    if (action === 'assign_role') {
      const principal = body.principal as Principal;
      const roleId = body.roleId as string;
      engine.assignRoleToUser(principal, roleId);
      return NextResponse.json({
        success: true,
        data: { message: `Role ${roleId} assigned to ${principal.id}` },
      });
    }

    if (action === 'revoke_role') {
      const principal = body.principal as Principal;
      const roleId = body.roleId as string;
      engine.revokeRoleFromUser(principal, roleId);
      return NextResponse.json({
        success: true,
        data: { message: `Role ${roleId} revoked from ${principal.id}` },
      });
    }

    if (action === 'define_permission') {
      const perm = body.permission as Parameters<typeof engine.definePermission>[0];
      engine.definePermission(perm);
      return NextResponse.json({ success: true, data: { message: 'Permission defined', permId: perm.id } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('RBAC POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
