import { NextRequest, NextResponse } from 'next/server';
import {
  createExperiment,
  startExperiment,
  stopExperiment,
  listExperiments,
  getExperiment,
  analyseExperiment,
  getVariantAssignment,
  recordConversion,
  getExperimentStats,
} from '@/lib/experimentationEngine';
import type { Experiment } from '@/lib/experimentationEngine';

// GET /api/experiments — List experiments or get stats
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const experimentId = searchParams.get('id');
    const view = searchParams.get('view');

    if (view === 'stats') {
      return NextResponse.json({ stats: getExperimentStats() });
    }

    if (experimentId) {
      const exp = getExperiment(experimentId);
      if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      return NextResponse.json({ experiment: exp });
    }

    const status = searchParams.get('status') as Experiment['status'] | undefined;
    const experiments = listExperiments(status ?? undefined);
    return NextResponse.json({ experiments, count: experiments.length });
  } catch (error) {
    console.error('Experiments GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/experiments — Create, start, stop, analyse, or get assignment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: string;
      experimentId?: string;
      identifier?: string;
      context?: Record<string, string>;
      revenue?: number;
      experiment?: Partial<Experiment>;
    };

    const { action } = body;

    if (action === 'assign') {
      if (!body.experimentId || !body.identifier) {
        return NextResponse.json({ error: 'experimentId and identifier required' }, { status: 400 });
      }
      const variant = getVariantAssignment(body.experimentId, body.identifier, body.context);
      return NextResponse.json({ variant });
    }

    if (action === 'convert') {
      if (!body.experimentId || !body.identifier) {
        return NextResponse.json({ error: 'experimentId and identifier required' }, { status: 400 });
      }
      recordConversion(body.experimentId, body.identifier, body.revenue ?? 0);
      return NextResponse.json({ success: true });
    }

    if (action === 'start') {
      if (!body.experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 });
      startExperiment(body.experimentId);
      return NextResponse.json({ success: true, status: 'running' });
    }

    if (action === 'stop') {
      if (!body.experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 });
      stopExperiment(body.experimentId);
      return NextResponse.json({ success: true, status: 'stopped' });
    }

    if (action === 'analyse') {
      if (!body.experimentId) return NextResponse.json({ error: 'experimentId required' }, { status: 400 });
      const analysis = analyseExperiment(body.experimentId);
      return NextResponse.json({ analysis });
    }

    // Default: create experiment
    if (!body.experiment) {
      return NextResponse.json({ error: 'experiment data required' }, { status: 400 });
    }

    const exp = createExperiment(body.experiment as Parameters<typeof createExperiment>[0]);
    return NextResponse.json({ experiment: exp }, { status: 201 });
  } catch (error) {
    console.error('Experiments POST error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error',
    }, { status: 500 });
  }
}
