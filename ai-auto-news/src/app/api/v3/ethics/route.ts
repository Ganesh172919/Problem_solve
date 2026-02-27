import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getEthicsGovernance } from '@/lib/aiEthicsGovernance';
import { getEthicsGovernanceAgent } from '@/agents/ethicsGovernanceAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modelId = searchParams.get('modelId');
  const tenantId = searchParams.get('tenantId');

  try {
    const governance = getEthicsGovernance();
    const agent = getEthicsGovernanceAgent();

    if (modelId) {
      const model = governance.getModel(modelId);
      if (!model) return NextResponse.json({ success: false, error: 'Model not found' }, { status: 404 });
      const card = governance.getModelCard(modelId);
      const auditResult = agent.getAuditResult(modelId);
      return NextResponse.json({ success: true, data: { model, card, auditResult } });
    }

    const models = governance.listModels(tenantId ?? undefined);
    const dashboard = governance.getGovernanceDashboard();
    const agentStats = agent.getStats();

    return NextResponse.json({ success: true, data: { models, dashboard, agentStats } });
  } catch (err) {
    logger.error('Ethics GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const governance = getEthicsGovernance();

    if (action === 'register_model') {
      const model = governance.registerModel(body.model as Parameters<typeof governance.registerModel>[0]);
      return NextResponse.json({ success: true, data: { model } });
    }

    if (action === 'analyze_bias') {
      const result = governance.analyzeBias(body.params as Parameters<typeof governance.analyzeBias>[0]);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'create_assessment') {
      const assessment = governance.createImpactAssessment(body.assessment as Parameters<typeof governance.createImpactAssessment>[0]);
      return NextResponse.json({ success: true, data: { assessment } });
    }

    if (action === 'approve_assessment') {
      const { assessmentId, approvedBy, conditions } = body as { assessmentId: string; approvedBy: string; conditions?: string[] };
      governance.approveImpactAssessment(assessmentId, approvedBy, conditions);
      return NextResponse.json({ success: true, data: { message: 'Assessment approved' } });
    }

    if (action === 'generate_card') {
      const { modelId } = body as { modelId: string };
      const card = governance.generateModelCard(modelId);
      return NextResponse.json({ success: true, data: { card } });
    }

    if (action === 'audit_decision') {
      const entry = governance.auditDecision(body.entry as Parameters<typeof governance.auditDecision>[0]);
      return NextResponse.json({ success: true, data: { entry } });
    }

    if (action === 'record_consent') {
      const consent = governance.recordConsent(body.consent as Parameters<typeof governance.recordConsent>[0]);
      return NextResponse.json({ success: true, data: { consent } });
    }

    if (action === 'validate_policy') {
      const { modelId, policyId } = body as { modelId: string; policyId: string };
      const result = governance.validateModelAgainstPolicy(modelId, policyId);
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Ethics POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
