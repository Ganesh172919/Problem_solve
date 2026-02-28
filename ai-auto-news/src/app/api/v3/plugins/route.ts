import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getPluginMarketplaceEngine } from '@/lib/pluginMarketplaceEngine';
import { getPluginManagementAgent } from '@/agents/pluginManagementAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const tenantId = searchParams.get('tenantId');

  try {
    const engine = getPluginMarketplaceEngine();
    const agent = getPluginManagementAgent();

    if (action === 'stats') {
      const stats = engine.getStats();
      return NextResponse.json({ success: true, data: { stats } });
    }

    if (action === 'search') {
      const query = searchParams.get('query') ?? '';
      const category = searchParams.get('category') ?? undefined;
      const page = Number(searchParams.get('page') ?? 1);
      const results = engine.search(query, { category, page });
      return NextResponse.json({ success: true, data: { results } });
    }

    if (action === 'reviews') {
      const pluginId = searchParams.get('pluginId') as string;
      const reviews = engine.getReviews(pluginId);
      return NextResponse.json({ success: true, data: { pluginId, reviews } });
    }

    const plugins = agent.getInstalledPlugins(tenantId as string);
    return NextResponse.json({ success: true, data: { tenantId, plugins } });
  } catch (err) {
    logger.error('Plugins GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const engine = getPluginMarketplaceEngine();
    const agent = getPluginManagementAgent();

    if (action === 'register') {
      const plugin = body.plugin as Parameters<typeof engine.registerPlugin>[0];
      const registered = engine.registerPlugin(plugin);
      return NextResponse.json({ success: true, data: { plugin: registered } });
    }

    if (action === 'install') {
      const result = await agent.installPlugin(body.tenantId as string, body.pluginId as string);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'uninstall') {
      await agent.uninstallPlugin(body.tenantId as string, body.pluginId as string);
      return NextResponse.json({ success: true, data: { message: 'Plugin uninstalled' } });
    }

    if (action === 'activate') {
      agent.activatePlugin(body.tenantId as string, body.pluginId as string);
      return NextResponse.json({ success: true, data: { message: 'Plugin activated' } });
    }

    if (action === 'deactivate') {
      agent.deactivatePlugin(body.tenantId as string, body.pluginId as string);
      return NextResponse.json({ success: true, data: { message: 'Plugin deactivated' } });
    }

    if (action === 'review') {
      const review = body.review as Parameters<typeof engine.addReview>[1];
      engine.addReview(body.pluginId as string, review);
      return NextResponse.json({ success: true, data: { message: 'Review submitted' } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Plugins POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
