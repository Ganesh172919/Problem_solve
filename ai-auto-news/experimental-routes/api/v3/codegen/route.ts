import { NextRequest, NextResponse } from 'next/server';
import { createAutonomousCodeGenAgent } from '@/agents/autonomousCodeGenAgent';

export async function POST(request: NextRequest) {
  const agent = createAutonomousCodeGenAgent();
  const body = await request.json();
  const action = body.action || 'generate';

  switch (action) {
    case 'generate': {
      const modules = await agent.processRequest(body.request);
      return NextResponse.json({ modules, count: modules.length }, { status: 201 });
    }

    case 'plan': {
      const plan = agent.createPlan(body.request);
      return NextResponse.json(plan);
    }

    case 'decompose': {
      const tasks = agent.decomposeRequirements(body.request);
      return NextResponse.json(tasks);
    }

    case 'history': {
      const history = agent.getGenerationHistory(body.requestId);
      return NextResponse.json(history);
    }

    case 'memory':
      return NextResponse.json({
        patternsCount: agent.getMemory().patterns.size,
        decisionsCount: agent.getMemory().decisions.length,
        errorsCount: agent.getMemory().errors.length,
      });

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
