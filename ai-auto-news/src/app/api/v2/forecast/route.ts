/**
 * Revenue Forecasting API — v2
 *
 * GET  /api/v2/forecast  — Returns 12-month revenue forecast with scenarios
 * POST /api/v2/forecast  — Accept custom forecast parameters and return tailored forecast
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getRevenueForecastingEngine from '../../../../lib/revenueForecastingEngine';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

interface ForecastQueryParams {
  months?: string;
  scenario?: 'bull' | 'base' | 'bear' | 'all';
  includeBreakdown?: string;
}

interface CustomForecastBody {
  monthlyGrowthRate?: number;       // 0-1, e.g. 0.08 = 8% monthly growth
  annualChurnRate?: number;          // 0-1, e.g. 0.12 = 12% annual churn
  expansionRate?: number;            // 0-1, monthly expansion MRR rate
  currentMrr?: number;               // current MRR in USD
  newCustomersPerMonth?: number;     // expected new customers/month
  avgArpuUsd?: number;               // average revenue per user USD
  months?: number;                   // forecast horizon (1-24)
  scenario?: 'bull' | 'base' | 'bear';
}

interface ForecastResponse {
  success: boolean;
  forecastId: string;
  generatedAt: string;
  horizonMonths: number;
  scenario: string;
  summary: {
    currentMrrUsd: number;
    projectedMrrUsd: number;
    projectedArrUsd: number;
    mrrGrowthPercent: number;
    confidenceLevel: number;
  };
  monthly: MonthlyForecastPoint[];
  scenarios?: ScenarioSummary[];
  metadata: {
    modelVersion: string;
    inputParameters: Record<string, number | string | undefined>;
    cachedAt?: string;
  };
}

interface MonthlyForecastPoint {
  month: string;           // YYYY-MM
  mrr: number;
  arr: number;
  lowerBound: number;
  upperBound: number;
  confidenceLevel: number;
  newMrr: number;
  churnMrr: number;
  expansionMrr: number;
  netNewMrr: number;
  activeSubscribers: number;
}

interface ScenarioSummary {
  scenario: 'bull' | 'base' | 'bear';
  label: string;
  description: string;
  finalMrrUsd: number;
  finalArrUsd: number;
  mrrGrowthPercent: number;
  assumptions: {
    monthlyGrowthRate: number;
    churnRate: number;
    expansionRate: number;
  };
}

// ── GET /api/v2/forecast ──────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const params: ForecastQueryParams = {
      months: searchParams.get('months') ?? '12',
      scenario: (searchParams.get('scenario') ?? 'all') as ForecastQueryParams['scenario'],
      includeBreakdown: searchParams.get('includeBreakdown') ?? 'true',
    };

    const horizonMonths = Math.min(24, Math.max(1, parseInt(params.months ?? '12', 10) || 12));
    const cacheKey = `api:v2:forecast:get:${horizonMonths}:${params.scenario}`;

    const cached = await cache.get<ForecastResponse>(cacheKey);
    if (cached) {
      logger.debug({ horizonMonths, scenario: params.scenario }, 'Returning cached forecast');
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'X-Response-Time': `${Date.now() - startMs}ms`,
        },
      });
    }

    const engine = getRevenueForecastingEngine();
    const forecastResult = await engine.generateForecast();

    const monthly: MonthlyForecastPoint[] = forecastResult.baseForecast
      .slice(0, horizonMonths)
      .map(point => ({
        month: point.date.toISOString().substring(0, 7),
        mrr: Math.round(point.mrr),
        arr: Math.round(point.arr),
        lowerBound: Math.round(point.lowerBound),
        upperBound: Math.round(point.upperBound),
        confidenceLevel: Math.round(point.confidenceLevel * 100) / 100,
        newMrr: Math.round(point.newMrr),
        churnMrr: Math.round(point.churnMrr),
        expansionMrr: Math.round(point.expansionMrr),
        netNewMrr: Math.round(point.netNewMrr),
        activeSubscribers: point.activeSubscribers,
      }));

    const lastPoint = monthly[monthly.length - 1];
    const firstPoint = monthly[0];
    const mrrGrowthPercent = firstPoint
      ? Math.round(((lastPoint.mrr - firstPoint.mrr) / Math.max(firstPoint.mrr, 1)) * 10000) / 100
      : 0;

    const scenarios: ScenarioSummary[] = [
      buildScenarioSummary(forecastResult.scenarios.bull, horizonMonths),
      buildScenarioSummary(forecastResult.scenarios.base, horizonMonths),
      buildScenarioSummary(forecastResult.scenarios.bear, horizonMonths),
    ];

    const response: ForecastResponse = {
      success: true,
      forecastId: `fcast_${Date.now()}`,
      generatedAt: new Date().toISOString(),
      horizonMonths,
      scenario: params.scenario ?? 'all',
      summary: {
        currentMrrUsd: Math.round(forecastResult.currentMetrics.mrr),
        projectedMrrUsd: lastPoint?.mrr ?? 0,
        projectedArrUsd: lastPoint?.arr ?? 0,
        mrrGrowthPercent,
        confidenceLevel: forecastResult.baseForecast[0]?.confidenceLevel ?? 0.8,
      },
      monthly: params.includeBreakdown !== 'false' ? monthly : [],
      scenarios: params.scenario === 'all' ? scenarios : scenarios.filter(s => s.scenario === params.scenario),
      metadata: {
        modelVersion: '2.0.0',
        inputParameters: {
          horizonMonths,
          scenario: params.scenario,
        },
      },
    };

    await cache.set(cacheKey, response, 3600); // cache for 1 hour
    logger.info({ horizonMonths, scenario: params.scenario, durationMs: Date.now() - startMs }, 'Forecast GET complete');

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'X-Response-Time': `${Date.now() - startMs}ms`,
      },
    });
  } catch (error) {
    logger.error({ error, durationMs: Date.now() - startMs }, 'Forecast GET error');
    return NextResponse.json(
      { success: false, error: 'Failed to generate revenue forecast', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── POST /api/v2/forecast ─────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    let body: CustomForecastBody = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    // Validate inputs
    const validationError = validateForecastBody(body);
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError },
        { status: 400 },
      );
    }

    const horizonMonths = Math.min(24, Math.max(1, body.months ?? 12));
    const scenario = body.scenario ?? 'base';

    const engine = getRevenueForecastingEngine();

    // Override engine config with custom parameters
    const customConfig = {
      monthlyGrowthRate: body.monthlyGrowthRate ?? 0.07,
      annualChurnRate: body.annualChurnRate ?? 0.12,
      expansionRate: body.expansionRate ?? 0.03,
      currentMrr: body.currentMrr,
      newCustomersPerMonth: body.newCustomersPerMonth,
      avgArpuUsd: body.avgArpuUsd,
    };

    const forecastResult = await engine.generateForecast(customConfig);

    const scenarioData = scenario === 'bull' ? forecastResult.scenarios.bull
      : scenario === 'bear' ? forecastResult.scenarios.bear
      : forecastResult.scenarios.base;

    const monthly: MonthlyForecastPoint[] = (scenarioData.forecast ?? forecastResult.baseForecast)
      .slice(0, horizonMonths)
      .map(point => ({
        month: point.date.toISOString().substring(0, 7),
        mrr: Math.round(point.mrr),
        arr: Math.round(point.arr),
        lowerBound: Math.round(point.lowerBound),
        upperBound: Math.round(point.upperBound),
        confidenceLevel: Math.round(point.confidenceLevel * 100) / 100,
        newMrr: Math.round(point.newMrr),
        churnMrr: Math.round(point.churnMrr),
        expansionMrr: Math.round(point.expansionMrr),
        netNewMrr: Math.round(point.netNewMrr),
        activeSubscribers: point.activeSubscribers,
      }));

    const lastPoint = monthly[monthly.length - 1];
    const firstPoint = monthly[0];
    const mrrGrowthPercent = firstPoint
      ? Math.round(((lastPoint.mrr - firstPoint.mrr) / Math.max(firstPoint.mrr, 1)) * 10000) / 100
      : 0;

    const response: ForecastResponse = {
      success: true,
      forecastId: `fcast_custom_${Date.now()}`,
      generatedAt: new Date().toISOString(),
      horizonMonths,
      scenario,
      summary: {
        currentMrrUsd: Math.round(customConfig.currentMrr ?? forecastResult.currentMetrics.mrr),
        projectedMrrUsd: lastPoint?.mrr ?? 0,
        projectedArrUsd: lastPoint?.arr ?? 0,
        mrrGrowthPercent,
        confidenceLevel: monthly[0]?.confidenceLevel ?? 0.8,
      },
      monthly,
      metadata: {
        modelVersion: '2.0.0',
        inputParameters: {
          monthlyGrowthRate: customConfig.monthlyGrowthRate,
          annualChurnRate: customConfig.annualChurnRate,
          expansionRate: customConfig.expansionRate,
          currentMrr: customConfig.currentMrr,
          horizonMonths,
          scenario,
        },
      },
    };

    logger.info({ scenario, horizonMonths, mrrGrowthPercent, durationMs: Date.now() - startMs }, 'Custom forecast POST complete');

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error({ error, durationMs: Date.now() - startMs }, 'Forecast POST error');
    return NextResponse.json(
      { success: false, error: 'Failed to generate custom forecast', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildScenarioSummary(
  scenario: { scenario: 'bull' | 'base' | 'bear'; forecast: Array<{ mrr: number; arr: number }>; assumptions: { monthlyGrowthRate: number; churnRate: number; expansionRate: number } },
  horizonMonths: number,
): ScenarioSummary {
  const points = scenario.forecast.slice(0, horizonMonths);
  const first = points[0];
  const last = points[points.length - 1];
  const growth = first ? Math.round(((last.mrr - first.mrr) / Math.max(first.mrr, 1)) * 10000) / 100 : 0;

  const labels: Record<'bull' | 'base' | 'bear', { label: string; description: string }> = {
    bull: { label: 'Optimistic', description: 'Accelerated growth with strong acquisition and low churn' },
    base: { label: 'Base Case', description: 'Expected trajectory based on current trends' },
    bear: { label: 'Conservative', description: 'Slower growth with elevated churn assumptions' },
  };

  return {
    scenario: scenario.scenario,
    label: labels[scenario.scenario].label,
    description: labels[scenario.scenario].description,
    finalMrrUsd: Math.round(last?.mrr ?? 0),
    finalArrUsd: Math.round(last?.arr ?? 0),
    mrrGrowthPercent: growth,
    assumptions: scenario.assumptions,
  };
}

function validateForecastBody(body: CustomForecastBody): string | null {
  if (body.monthlyGrowthRate !== undefined && (body.monthlyGrowthRate < 0 || body.monthlyGrowthRate > 2)) {
    return 'monthlyGrowthRate must be between 0 and 2';
  }
  if (body.annualChurnRate !== undefined && (body.annualChurnRate < 0 || body.annualChurnRate > 1)) {
    return 'annualChurnRate must be between 0 and 1';
  }
  if (body.expansionRate !== undefined && (body.expansionRate < 0 || body.expansionRate > 1)) {
    return 'expansionRate must be between 0 and 1';
  }
  if (body.currentMrr !== undefined && body.currentMrr < 0) {
    return 'currentMrr must be a non-negative number';
  }
  if (body.months !== undefined && (body.months < 1 || body.months > 24)) {
    return 'months must be between 1 and 24';
  }
  if (body.scenario !== undefined && !['bull', 'base', 'bear'].includes(body.scenario)) {
    return 'scenario must be one of: bull, base, bear';
  }
  return null;
}
