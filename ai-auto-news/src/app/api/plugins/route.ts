import { NextRequest, NextResponse } from 'next/server';
import {
  searchMarketplace,
  getTenantPlugins,
  installPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  getPluginHealthSummary,
  getMarketplaceListing,
  updatePluginConfig,
} from '@/lib/pluginSystem';

// GET /api/plugins — List installed plugins or search marketplace
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') ?? 'installed';
    const tenantId = searchParams.get('tenantId') ?? 'default';

    if (view === 'marketplace') {
      const query = searchParams.get('query') ?? undefined;
      const category = searchParams.get('category') as Parameters<typeof searchMarketplace>[0]['category'] | undefined;
      const tier = searchParams.get('tier') ?? undefined;
      const sortBy = (searchParams.get('sortBy') ?? 'downloads') as 'downloads' | 'rating' | 'updated';

      const listings = searchMarketplace({ query, category, tier, sortBy });
      return NextResponse.json({ listings, count: listings.length });
    }

    if (view === 'health') {
      const health = getPluginHealthSummary(tenantId);
      return NextResponse.json({ health });
    }

    if (view === 'listing') {
      const pluginId = searchParams.get('pluginId');
      if (!pluginId) return NextResponse.json({ error: 'pluginId required' }, { status: 400 });
      const listing = getMarketplaceListing(pluginId);
      if (!listing) return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
      return NextResponse.json({ listing });
    }

    const plugins = getTenantPlugins(tenantId);
    return NextResponse.json({ plugins, count: plugins.length });
  } catch (error) {
    console.error('Plugins GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/plugins — Install, enable, disable, uninstall, update config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action: string;
      pluginId?: string;
      tenantId?: string;
      installedBy?: string;
      config?: Record<string, unknown>;
      manifest?: Parameters<typeof installPlugin>[0];
    };

    const tenantId = body.tenantId ?? 'default';
    const { action } = body;

    if (action === 'install') {
      if (!body.manifest) return NextResponse.json({ error: 'manifest required' }, { status: 400 });
      const plugin = installPlugin(body.manifest, tenantId, body.installedBy ?? 'user', body.config);
      return NextResponse.json({ plugin }, { status: 201 });
    }

    if (!body.pluginId) return NextResponse.json({ error: 'pluginId required' }, { status: 400 });

    if (action === 'enable') {
      enablePlugin(body.pluginId, tenantId);
      return NextResponse.json({ success: true, status: 'enabled' });
    }

    if (action === 'disable') {
      disablePlugin(body.pluginId, tenantId);
      return NextResponse.json({ success: true, status: 'disabled' });
    }

    if (action === 'uninstall') {
      uninstallPlugin(body.pluginId, tenantId);
      return NextResponse.json({ success: true });
    }

    if (action === 'update_config') {
      if (!body.config) return NextResponse.json({ error: 'config required' }, { status: 400 });
      updatePluginConfig(body.pluginId, tenantId, body.config);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('Plugins POST error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error',
    }, { status: 500 });
  }
}
