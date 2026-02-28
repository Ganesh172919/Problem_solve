import { NextRequest, NextResponse } from 'next/server';
import { getNeuralArchitectureSearch } from '../../../../lib/neuralArchitectureSearch';

const nas = getNeuralArchitectureSearch();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const archId = searchParams.get('archId');
  const jobId = searchParams.get('jobId');

  try {
    if (action === 'summary') return NextResponse.json(nas.getDashboardSummary());
    if (action === 'architectures') return NextResponse.json(nas.listArchitectures());
    if (action === 'architecture' && archId) {
      const arch = nas.getArchitecture(archId);
      if (!arch) return NextResponse.json({ error: 'Architecture not found' }, { status: 404 });
      return NextResponse.json(arch);
    }
    if (action === 'export' && archId) return NextResponse.json(nas.exportArchitecture(archId));
    if (action === 'jobs') return NextResponse.json(nas.listJobs());
    if (action === 'job' && jobId) {
      const job = nas.getJob(jobId);
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      return NextResponse.json(job);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'define_space') {
      const space = nas.defineSearchSpace(body as Parameters<typeof nas.defineSearchSpace>[0]);
      return NextResponse.json(space, { status: 201 });
    }
    if (action === 'create_job') {
      const job = nas.createSearchJob(body as Parameters<typeof nas.createSearchJob>[0]);
      return NextResponse.json(job, { status: 201 });
    }
    if (action === 'run_job') {
      const { jobId } = body as { jobId: string };
      // Run asynchronously and return immediately
      nas.runSearchJob(jobId).catch(() => void 0);
      return NextResponse.json({ ok: true, jobId, status: 'started' });
    }
    if (action === 'generate') {
      const { spaceId, generation } = body as { spaceId: string; generation?: number };
      const arch = nas.generateRandomArchitecture(spaceId, generation);
      return NextResponse.json(arch, { status: 201 });
    }
    if (action === 'evaluate') {
      const { archId, hardwareTarget } = body as { archId: string; hardwareTarget?: Parameters<typeof nas.evaluateArchitecture>[1] };
      const arch = nas.evaluateArchitecture(archId, hardwareTarget);
      return NextResponse.json(arch);
    }
    if (action === 'mutate') {
      const { parentId, spaceId } = body as { parentId: string; spaceId: string };
      const child = nas.mutateArchitecture(parentId, spaceId);
      return NextResponse.json(child, { status: 201 });
    }
    if (action === 'pareto') {
      const { archIds, objectives } = body as { archIds: string[]; objectives: Parameters<typeof nas.computeParetoFront>[1] };
      const front = nas.computeParetoFront(archIds, objectives);
      return NextResponse.json({ paretoFront: front, visualization: nas.getParetoVisualization(front) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
