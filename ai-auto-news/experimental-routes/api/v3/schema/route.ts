import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getSchemaEvolution } from '@/lib/dynamicSchemaEvolution';
import { getSchemaEvolutionAgent } from '@/agents/schemaEvolutionAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const action = searchParams.get('action');

  try {
    const evolution = getSchemaEvolution();
    const agent = getSchemaEvolutionAgent();

    if (action === 'history') {
      const migrations = evolution.getMigrationHistory();
      return NextResponse.json({ success: true, data: { migrations } });
    }

    if (action === 'pending') {
      const pending = evolution.getPendingMigrations();
      return NextResponse.json({ success: true, data: { pending } });
    }

    if (action === 'proposals') {
      const proposals = agent.getProposals();
      return NextResponse.json({ success: true, data: { proposals } });
    }

    if (tenantId) {
      const version = evolution.getSchemaVersion(tenantId);
      return NextResponse.json({ success: true, data: { tenantId, version } });
    }

    const stats = agent.getStats();
    const proposals = agent.getProposals().slice(0, 10);
    const pending = evolution.getPendingMigrations().length;

    return NextResponse.json({
      success: true,
      data: { stats, proposals, pendingCount: pending },
    });
  } catch (err) {
    logger.error('Schema GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const evolution = getSchemaEvolution();
    const agent = getSchemaEvolutionAgent();

    if (action === 'analyze') {
      const tables = body.tables as Parameters<typeof agent.analyzeTables>[0];
      const analysis = agent.analyzeTables(tables);
      return NextResponse.json({ success: true, data: { analysis } });
    }

    if (action === 'propose') {
      const tables = body.tables as Parameters<typeof agent.proposeOptimizations>[0];
      const tenantId = body.tenantId as string | undefined;
      const proposals = agent.proposeOptimizations(tables, tenantId);
      return NextResponse.json({ success: true, data: { proposals } });
    }

    if (action === 'create_migration') {
      const name = body.name as string;
      const version = body.version as string;
      const changes = body.changes as Parameters<typeof evolution.createMigration>[2];
      const tenantIds = (body.tenantIds as string[]) ?? [];
      const migration = evolution.createMigration(name, version, changes, tenantIds);
      return NextResponse.json({ success: true, data: { migration } });
    }

    if (action === 'apply_migration') {
      const migrationId = body.migrationId as string;
      const dryRun = body.dryRun === true;
      const migration = await evolution.applyMigration(migrationId, dryRun);
      return NextResponse.json({ success: true, data: { migration } });
    }

    if (action === 'apply_proposal') {
      const proposalId = body.proposalId as string;
      const dryRun = body.dryRun === true;
      const result = await agent.applyProposal(proposalId, dryRun);
      return NextResponse.json({ success: result.success, data: result });
    }

    if (action === 'rollback') {
      const migrationId = body.migrationId as string;
      const migration = await evolution.rollback(migrationId);
      return NextResponse.json({ success: true, data: { migration } });
    }

    if (action === 'register_schema') {
      const tenantId = body.tenantId as string;
      const tables = body.tables as Parameters<typeof evolution.registerSchema>[1];
      evolution.registerSchema(tenantId, tables);
      return NextResponse.json({ success: true, data: { message: 'Schema registered', tenantId } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Schema POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
