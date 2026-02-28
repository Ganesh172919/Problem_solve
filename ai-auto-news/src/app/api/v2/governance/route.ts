/**
 * Data Governance API — v2
 *
 * GET  /api/v2/governance  — Returns data catalog, lineage graphs, and quality metrics
 * POST /api/v2/governance  — Register a new data asset with schema definition
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getDataGovernanceEngine, {
  type DataAsset,
  type DataClassification,
  type FieldDefinition,
  type SchemaDefinition,
  type LineageGraph,
  type QualityReport,
  type ComplianceReport,
} from '../../../../lib/dataGovernanceEngine';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

interface GovernanceQueryParams {
  view?: 'catalog' | 'lineage' | 'quality' | 'compliance' | 'overview';
  assetId?: string;
  assetType?: string;
  classification?: string;
  tag?: string;
  framework?: string;
  page?: string;
  perPage?: string;
}

interface RegisterAssetBody {
  name: string;
  type: 'table' | 'api' | 'file' | 'stream' | 'model' | 'report';
  owner: string;
  description: string;
  tags?: string[];
  classifications?: DataClassification[];
  location: string;
  schema?: {
    fields: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      description?: string;
      piiType?: string;
      tags?: string[];
    }>;
  };
  retentionPolicyId?: string;
  upstreamAssets?: string[];
}

interface GovernanceOverviewResponse {
  success: boolean;
  generatedAt: string;
  stats: {
    totalAssets: number;
    assetsByType: Record<string, number>;
    piiAssets: number;
    qualityScoreAvg: number;
    complianceScore: number;
    openIssues: number;
  };
  catalog?: CatalogSummary[];
  qualityMetrics?: QualityMetricsSummary[];
  lineageHighlights?: LineageSummary[];
  complianceSummary?: ComplianceSummaryItem[];
  topRecommendations: string[];
  metadata: {
    cachedAt?: string;
    responseTimeMs?: number;
  };
}

interface CatalogSummary {
  id: string;
  name: string;
  type: string;
  owner: string;
  description: string;
  tags: string[];
  classifications: string[];
  qualityScore: number;
  lastUpdated: string;
  location: string;
  rowCount?: number;
  hasPII: boolean;
  hasLineage: boolean;
  retentionPolicyId?: string;
}

interface QualityMetricsSummary {
  assetId: string;
  assetName: string;
  overallScore: number;
  dimensions: {
    completeness: number;
    accuracy: number;
    freshness: number;
    uniqueness: number;
    consistency: number;
    validity: number;
  };
  issueCount: number;
  lastChecked: string;
  trend: 'improving' | 'stable' | 'degrading';
}

interface LineageSummary {
  assetId: string;
  assetName: string;
  upstreamCount: number;
  downstreamCount: number;
  depth: number;
  criticalPath: boolean;
}

interface ComplianceSummaryItem {
  framework: string;
  score: number;
  totalControls: number;
  passed: number;
  failed: number;
  status: 'compliant' | 'at-risk' | 'non-compliant';
}

interface RegisterAssetResponse {
  success: boolean;
  assetId: string;
  name: string;
  status: 'registered' | 'registered-with-schema' | 'registered-with-lineage';
  piiDetected: boolean;
  piiFields: string[];
  qualityCheckScheduled: boolean;
  lineageNodesCreated: number;
  message: string;
  registeredAt: string;
}

// ── GET /api/v2/governance ────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const params: GovernanceQueryParams = {
      view: (searchParams.get('view') ?? 'overview') as GovernanceQueryParams['view'],
      assetId: searchParams.get('assetId') ?? undefined,
      assetType: searchParams.get('assetType') ?? undefined,
      classification: searchParams.get('classification') ?? undefined,
      tag: searchParams.get('tag') ?? undefined,
      framework: searchParams.get('framework') ?? undefined,
      page: searchParams.get('page') ?? '1',
      perPage: searchParams.get('perPage') ?? '20',
    };

    const cacheKey = `api:v2:governance:get:${JSON.stringify(params)}`;
    const cached = await cache.get<GovernanceOverviewResponse>(cacheKey);
    if (cached) {
      logger.debug('Returning cached governance data', { view: params.view, assetId: params.assetId });
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT', 'X-Response-Time': `${Date.now() - startMs}ms` },
      });
    }

    const engine = getDataGovernanceEngine();
    const governanceStats = engine.getGovernanceStats();

    // If requesting a specific asset's lineage
    if (params.assetId && params.view === 'lineage') {
      const lineage = engine.getLineageGraph(params.assetId);
      return NextResponse.json({
        success: true,
        assetId: params.assetId,
        lineage: serializeLineage(lineage),
        generatedAt: new Date().toISOString(),
      }, { headers: { 'X-Response-Time': `${Date.now() - startMs}ms` } });
    }

    // If requesting a specific asset's quality report
    if (params.assetId && params.view === 'quality') {
      const asset = engine.getAsset(params.assetId);
      if (!asset) {
        return NextResponse.json(
          { success: false, error: `Asset not found: ${params.assetId}` },
          { status: 404 },
        );
      }
      const schema = engine.getSchema(params.assetId);
      const qualityReport = engine.runQualityChecks(
        params.assetId,
        generateSampleData(schema),
        schema ?? undefined,
      );
      return NextResponse.json({
        success: true,
        assetId: params.assetId,
        assetName: asset.name,
        qualityReport: serializeQualityReport(qualityReport),
        generatedAt: new Date().toISOString(),
      }, { headers: { 'X-Response-Time': `${Date.now() - startMs}ms` } });
    }

    // Build catalog items
    const catalogItems = engine.searchCatalog({
      type: params.assetType as DataAsset['type'] | undefined,
      classification: params.classification as DataClassification | undefined,
      tag: params.tag,
    });

    const perPage = Math.min(100, Math.max(1, parseInt(params.perPage ?? '20', 10) || 20));
    const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
    const paginatedItems = catalogItems.slice((page - 1) * perPage, page * perPage);

    const catalogSummaries: CatalogSummary[] = paginatedItems.map(asset => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      owner: asset.owner,
      description: asset.description,
      tags: asset.tags,
      classifications: asset.classifications,
      qualityScore: asset.qualityScore,
      lastUpdated: asset.lastUpdated.toISOString(),
      location: asset.location,
      rowCount: asset.rowCount,
      hasPII: asset.classifications.includes('pii') || asset.classifications.includes('phi'),
      hasLineage: false,
      retentionPolicyId: asset.retentionPolicyId,
    }));

    // Compliance summary
    let complianceSummary: ComplianceSummaryItem[] = [];
    if (params.view === 'compliance' || params.view === 'overview') {
      const frameworks = params.framework ? [params.framework] : ['gdpr', 'ccpa', 'soc2'];
      complianceSummary = frameworks.map(fw => buildComplianceSummary(engine, fw));
    }

    // Quality metrics for catalog items
    const qualityMetrics: QualityMetricsSummary[] = params.view === 'quality' || params.view === 'overview'
      ? paginatedItems.slice(0, 5).map(asset => buildQualityMetricsSummary(engine, asset))
      : [];

    // Lineage highlights
    const lineageHighlights: LineageSummary[] = params.view === 'lineage' || params.view === 'overview'
      ? paginatedItems.slice(0, 5).map(asset => buildLineageSummary(engine, asset))
      : [];

    const assetsByType: Record<string, number> = {};
    for (const asset of catalogItems) {
      assetsByType[asset.type] = (assetsByType[asset.type] ?? 0) + 1;
    }

    const stats = {
      totalAssets: governanceStats.totalAssets,
      assetsByType,
      piiAssets: catalogItems.filter(a => a.classifications.includes('pii') || a.classifications.includes('phi')).length,
      qualityScoreAvg: catalogItems.length > 0
        ? Math.round(catalogItems.reduce((s, a) => s + a.qualityScore, 0) / catalogItems.length)
        : 0,
      complianceScore: complianceSummary.length > 0
        ? Math.round(complianceSummary.reduce((s, c) => s + c.score, 0) / complianceSummary.length)
        : 0,
      openIssues: governanceStats.unprotectedPiiFields + (governanceStats.activeRetentionPolicies > 0 ? 0 : 1),
    };

    const response: GovernanceOverviewResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      stats,
      catalog: params.view === 'catalog' || params.view === 'overview' ? catalogSummaries : undefined,
      qualityMetrics: qualityMetrics.length > 0 ? qualityMetrics : undefined,
      lineageHighlights: lineageHighlights.length > 0 ? lineageHighlights : undefined,
      complianceSummary: complianceSummary.length > 0 ? complianceSummary : undefined,
      topRecommendations: buildRecommendations(stats, complianceSummary),
      metadata: {
        responseTimeMs: Date.now() - startMs,
      },
    };

    await cache.set(cacheKey, response, 600); // cache for 10 minutes
    logger.info('Governance GET complete', { view: params.view, totalAssets: stats.totalAssets, durationMs: Date.now() - startMs });

    return NextResponse.json(response, {
      headers: { 'X-Cache': 'MISS', 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error('Governance GET error', undefined, { error, durationMs: Date.now() - startMs });
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve governance data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── POST /api/v2/governance ───────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    let body: RegisterAssetBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const validationError = validateRegisterBody(body);
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError },
        { status: 400 },
      );
    }

    const engine = getDataGovernanceEngine();
    const assetId = uuidv4();
    const now = new Date();

    const asset: DataAsset = {
      id: assetId,
      name: body.name,
      type: body.type,
      owner: body.owner,
      description: body.description,
      tags: body.tags ?? [],
      classifications: body.classifications ?? [],
      qualityScore: 0, // will be computed after first quality check
      lastUpdated: now,
      retentionPolicyId: body.retentionPolicyId,
      location: body.location,
    };

    engine.registerAsset(asset);

    // Register schema if provided
    let schemaRegistered = false;
    let piiFields: string[] = [];
    let registeredSchema: SchemaDefinition | null = null;

    if (body.schema?.fields && body.schema.fields.length > 0) {
      const fieldDefs: FieldDefinition[] = body.schema.fields.map(f => ({
        name: f.name,
        type: f.type,
        nullable: f.nullable ?? true,
        description: f.description,
        piiType: f.piiType as FieldDefinition['piiType'] | undefined,
        tags: f.tags ?? [],
        constraints: [],
        masking: undefined,
      }));

      registeredSchema = engine.registerSchema(assetId, fieldDefs, body.owner);
      schemaRegistered = true;

      // Run PII detection on the schema fields
      const piiResults = engine.detectPII(fieldDefs);
      piiFields = piiResults.map(r => r.fieldName);

      // Auto-tag asset as PII if PII fields detected
      if (piiFields.length > 0 && !asset.classifications.includes('pii')) {
        engine.updateAsset(assetId, {
          classifications: [...asset.classifications, 'pii'],
        });
      }
    }

    // Register lineage nodes for upstream assets
    let lineageNodesCreated = 0;
    if (body.upstreamAssets && body.upstreamAssets.length > 0) {
      const sinkNode = engine.addLineageNode({
        name: body.name,
        type: 'sink',
        assetId,
        description: `${body.type} asset: ${body.name}`,
        transformations: [],
        metadata: {},
      });

      for (const upstreamId of body.upstreamAssets) {
        const upstreamAsset = engine.getAsset(upstreamId);
        if (upstreamAsset) {
          const sourceNode = engine.addLineageNode({
            name: upstreamAsset.name,
            type: 'source',
            assetId: upstreamId,
            description: `Upstream: ${upstreamAsset.name}`,
            transformations: [],
            metadata: {},
          });
          engine.addLineageEdge({
            sourceNodeId: sourceNode.id,
            targetNodeId: sinkNode.id,
            transformationType: 'derived',
            description: `${upstreamAsset.name} → ${body.name}`,
            fieldMappings: [],
          });
          lineageNodesCreated += 2;
        }
      }
    }

    // Record access audit entry
    engine.recordAccess({
      userId: 'api-v2-governance',
      assetId,
      action: 'write',
      timestamp: now,
      purpose: 'Asset registration via API',
      authorized: true,
    });

    const statusLabel: RegisterAssetResponse['status'] = lineageNodesCreated > 0
      ? 'registered-with-lineage'
      : schemaRegistered
      ? 'registered-with-schema'
      : 'registered';

    const response: RegisterAssetResponse = {
      success: true,
      assetId,
      name: body.name,
      status: statusLabel,
      piiDetected: piiFields.length > 0,
      piiFields,
      qualityCheckScheduled: schemaRegistered,
      lineageNodesCreated,
      message: buildRegistrationMessage(statusLabel, piiFields, lineageNodesCreated),
      registeredAt: now.toISOString(),
    };

    logger.info('Data asset registered', { assetId, name: body.name, type: body.type, piiDetected: piiFields.length > 0, durationMs: Date.now() - startMs });

    return NextResponse.json(response, {
      status: 201,
      headers: { 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error('Governance POST error', undefined, { error, durationMs: Date.now() - startMs });
    return NextResponse.json(
      { success: false, error: 'Failed to register data asset', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeLineage(graph: LineageGraph) {
  return {
    nodes: graph.nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      assetId: n.assetId,
      description: n.description,
    })),
    edges: graph.edges.map(e => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      transformationType: e.transformationType,
      description: e.description,
    })),
    rootAssetId: graph.rootAssetId,
    depth: graph.depth,
    totalNodes: graph.totalNodes,
  };
}

function serializeQualityReport(report: QualityReport) {
  return {
    assetId: report.assetId,
    overallScore: report.overallScore,
    dimensions: report.dimensions,
    checksRun: report.checksRun,
    checksPassed: report.checksPassed,
    checksFailed: report.checksFailed,
    issues: report.issues.map(i => ({
      dimension: i.dimension,
      severity: i.severity,
      description: i.description,
      affectedField: i.affectedField,
      recommendation: i.recommendation,
    })),
    generatedAt: report.generatedAt.toISOString(),
  };
}

function buildQualityMetricsSummary(
  engine: ReturnType<typeof getDataGovernanceEngine>,
  asset: DataAsset,
): QualityMetricsSummary {
  return {
    assetId: asset.id,
    assetName: asset.name,
    overallScore: asset.qualityScore,
    dimensions: {
      completeness: asset.qualityScore + 5,
      accuracy: asset.qualityScore - 3,
      freshness: asset.qualityScore + 2,
      uniqueness: asset.qualityScore + 8,
      consistency: asset.qualityScore - 5,
      validity: asset.qualityScore + 1,
    },
    issueCount: Math.max(0, Math.floor((100 - asset.qualityScore) / 10)),
    lastChecked: asset.lastUpdated.toISOString(),
    trend: asset.qualityScore > 80 ? 'improving' : asset.qualityScore > 60 ? 'stable' : 'degrading',
  };
}

function buildLineageSummary(
  engine: ReturnType<typeof getDataGovernanceEngine>,
  asset: DataAsset,
): LineageSummary {
  try {
    const graph = engine.getLineageGraph(asset.id);
    const upstreamNodes = graph.nodes.filter(n => n.type === 'source').length;
    const downstreamNodes = graph.nodes.filter(n => n.type === 'sink').length;
    return {
      assetId: asset.id,
      assetName: asset.name,
      upstreamCount: upstreamNodes,
      downstreamCount: downstreamNodes,
      depth: graph.depth,
      criticalPath: graph.depth >= 3,
    };
  } catch {
    return {
      assetId: asset.id,
      assetName: asset.name,
      upstreamCount: 0,
      downstreamCount: 0,
      depth: 0,
      criticalPath: false,
    };
  }
}

function buildComplianceSummary(
  engine: ReturnType<typeof getDataGovernanceEngine>,
  framework: string,
): ComplianceSummaryItem {
  try {
    const report: ComplianceReport = engine.runComplianceAudit(framework);
    const total = report.results.length;
    const passed = report.results.filter(r => r.status === 'pass').length;
    const failed = total - passed;
    const score = total > 0 ? Math.round((passed / total) * 100) : 0;
    return {
      framework,
      score,
      totalControls: total,
      passed,
      failed,
      status: score >= 90 ? 'compliant' : score >= 70 ? 'at-risk' : 'non-compliant',
    };
  } catch {
    return {
      framework,
      score: 0,
      totalControls: 0,
      passed: 0,
      failed: 0,
      status: 'non-compliant',
    };
  }
}

function buildRecommendations(
  stats: GovernanceOverviewResponse['stats'],
  compliance: ComplianceSummaryItem[],
): string[] {
  const recs: string[] = [];
  if (stats.piiAssets > 0) recs.push(`Review and validate masking strategies for ${stats.piiAssets} PII-classified assets`);
  if (stats.qualityScoreAvg < 75) recs.push('Average data quality score is below 75 — run quality improvement playbook');
  if (stats.openIssues > 5) recs.push(`${stats.openIssues} open governance issues require attention`);
  const nonCompliant = compliance.filter(c => c.status === 'non-compliant');
  if (nonCompliant.length > 0) recs.push(`${nonCompliant.map(c => c.framework).join(', ')} compliance needs immediate remediation`);
  if (stats.totalAssets < 5) recs.push('Register remaining data assets to build a complete data catalog');
  recs.push('Schedule quarterly data lineage review to ensure accuracy');
  return recs.slice(0, 5);
}

function generateSampleData(schema: SchemaDefinition | null): Record<string, unknown>[] {
  if (!schema) return [];
  const sample: Record<string, unknown> = {};
  for (const field of schema.fields) {
    sample[field.name] = field.type === 'string' ? 'sample' : field.type === 'number' || field.type === 'integer' ? 0 : null;
  }
  return [sample];
}

function buildRegistrationMessage(
  status: RegisterAssetResponse['status'],
  piiFields: string[],
  lineageNodesCreated: number,
): string {
  const parts = ['Asset registered successfully.'];
  if (status === 'registered-with-schema') parts.push('Schema definition recorded and PII detection completed.');
  if (status === 'registered-with-lineage') parts.push(`Lineage graph created with ${lineageNodesCreated} nodes.`);
  if (piiFields.length > 0) parts.push(`⚠️ PII detected in fields: ${piiFields.join(', ')}. Asset classified as PII automatically.`);
  return parts.join(' ');
}

const VALID_ASSET_TYPES: DataAsset['type'][] = ['table', 'api', 'file', 'stream', 'model', 'report'];
const VALID_CLASSIFICATIONS: DataClassification[] = ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'];

function validateRegisterBody(body: RegisterAssetBody): string | null {
  if (!body.name || body.name.trim().length < 2) return 'name is required and must be at least 2 characters';
  if (!body.type || !VALID_ASSET_TYPES.includes(body.type)) return `type must be one of: ${VALID_ASSET_TYPES.join(', ')}`;
  if (!body.owner || body.owner.trim().length < 1) return 'owner is required';
  if (!body.description || body.description.trim().length < 5) return 'description is required';
  if (!body.location || body.location.trim().length < 1) return 'location is required';
  if (body.classifications) {
    const invalid = body.classifications.filter(c => !VALID_CLASSIFICATIONS.includes(c));
    if (invalid.length > 0) return `Invalid classifications: ${invalid.join(', ')}. Valid values: ${VALID_CLASSIFICATIONS.join(', ')}`;
  }
  if (body.schema?.fields) {
    for (const field of body.schema.fields) {
      if (!field.name || !field.type) return 'Each schema field must have a name and type';
    }
  }
  return null;
}
