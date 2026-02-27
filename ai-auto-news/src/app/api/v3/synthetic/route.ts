import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getSyntheticDataGenerator } from '@/lib/syntheticDataGenerator';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const schema = searchParams.get('schema');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 100);

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  try {
    const generator = getSyntheticDataGenerator();
    const stats = generator.getGenerationStats();

    const datasets = stats.recentDatasets
      .filter((d: { tenantId?: string; schema?: string }) => {
        if (d.tenantId && d.tenantId !== tenantId) return false;
        if (schema && d.schema !== schema) return false;
        return true;
      })
      .slice(0, limit);

    logger.info('Synthetic datasets listed', { tenantId, schema, limit, count: datasets.length });

    return NextResponse.json({
      success: true,
      data: {
        datasets,
        stats: {
          totalGenerated: stats.totalGenerated,
          totalRows: stats.totalRows,
          avgGenerationMs: stats.avgGenerationMs,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to list synthetic datasets', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { spec: import('@/lib/syntheticDataGenerator').SyntheticDataSpec; tenantId: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { spec, tenantId } = body;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  if (!spec || !spec.schema) {
    return NextResponse.json({ error: 'spec.schema is required' }, { status: 400 });
  }

  try {
    const generator = getSyntheticDataGenerator();

    const validationErrors = generator.validateSchema(spec.schema);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: 'Schema validation failed', details: validationErrors },
        { status: 422 }
      );
    }

    const dataset = generator.generateDataset({ ...spec, tenantId } as typeof spec & { tenantId: string });
    const statistics = generator.computeStatistics(dataset);
    const anomalyCount = generator.detectAnomalies(dataset);

    logger.info('Synthetic dataset generated', {
      tenantId,
      datasetId: dataset.datasetId,
      rows: dataset.rows.length,
      schema: spec.schema.name,
    });

    return NextResponse.json({
      success: true,
      data: {
        dataset: {
          datasetId: dataset.datasetId,
          schema: dataset.schema,
          rowCount: dataset.rows.length,
          rows: dataset.rows,
          generatedAt: dataset.generatedAt,
        },
        qualityReport: {
          statistics,
          anomalyCount,
          anomalyRate: dataset.rows.length > 0 ? anomalyCount / dataset.rows.length : 0,
          fieldCount: spec.schema.fields.length,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to generate synthetic dataset', { tenantId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
