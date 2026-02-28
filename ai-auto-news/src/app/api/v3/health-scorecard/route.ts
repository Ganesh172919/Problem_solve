import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getPlatformHealthScorecard, type SLATarget, type AlertThreshold, type HealthDimension } from '@/lib/platformHealthScorecard';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dimension = searchParams.get('dimension');

  try {
    const scorecard = getPlatformHealthScorecard();

    const fullScorecard = scorecard.generateScorecard();
    const recentEvents = scorecard.getRecentEvents(20);

    // Filter dimensions if requested
    const dimensions = dimension
      ? fullScorecard.dimensions.filter(d => d.dimension === dimension)
      : fullScorecard.dimensions;

    logger.info('Health scorecard retrieved', {
      dimension,
      overallScore: fullScorecard.overallScore,
      dimensionCount: dimensions.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        scorecard: {
          overallScore: fullScorecard.overallScore,
          grade: fullScorecard.grade,
          dimensions,
          slaCompliant: fullScorecard.slaCompliant,
          generatedAt: fullScorecard.generatedAt,
        },
        recentEvents: recentEvents.map(event => ({
          id: event.id,
          dimension: event.dimension,
          type: event.type,
          score: event.score,
          description: event.description,
          timestamp: event.timestamp,
        })),
        ...(dimension ? { filter: { dimension } } : {}),
      },
    });
  } catch (error) {
    logger.error('Failed to retrieve health scorecard', undefined, { dimension, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action: 'record_metric' | 'register_sla' | 'set_threshold' | 'get_trend';
    dimension?: string;
    value?: number;
    target?: number;
    threshold?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, dimension, value, target, threshold } = body;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  try {
    const scorecard = getPlatformHealthScorecard();

    if (action === 'record_metric') {
      if (!dimension) {
        return NextResponse.json({ error: 'dimension is required for action=record_metric' }, { status: 400 });
      }
      if (value === undefined || value === null) {
        return NextResponse.json({ error: 'value is required for action=record_metric' }, { status: 400 });
      }
      scorecard.recordMetric(dimension as HealthDimension, value);
      logger.info('Health metric recorded', { dimension, value });
      return NextResponse.json({ success: true, data: { dimension, value, recordedAt: Date.now() } });
    }

    if (action === 'register_sla') {
      if (!dimension || target === undefined) {
        return NextResponse.json(
          { error: 'dimension and target are required for action=register_sla' },
          { status: 400 },
        );
      }
      const slaTarget: SLATarget = {
        metric: dimension,
        target,
        unit: '%',
        measurementWindow: '30m',
        severity: 'major',
      };
      const slaId = scorecard.registerSLA(slaTarget);
      logger.info('SLA registered', { dimension, target, slaId });
      return NextResponse.json({ success: true, data: { slaId, slaTarget } });
    }

    if (action === 'set_threshold') {
      if (!dimension || threshold === undefined) {
        return NextResponse.json(
          { error: 'dimension and threshold are required for action=set_threshold' },
          { status: 400 },
        );
      }
      const alertThreshold: AlertThreshold = {
        dimension: dimension as HealthDimension,
        warning: threshold,
        critical: threshold * 0.9,
        notifyChannels: ['slack', 'email'],
      };
      scorecard.setAlertThreshold(alertThreshold);
      logger.info('Alert threshold configured', { dimension, threshold });
      return NextResponse.json({ success: true, data: { dimension, alertThreshold } });
    }

    if (action === 'get_trend') {
      if (!dimension) {
        return NextResponse.json({ error: 'dimension is required for action=get_trend' }, { status: 400 });
      }
      const trend = scorecard.getHealthTrend(dimension as HealthDimension, 60);
      logger.info('Trend retrieved', { dimension, changeRate: trend.changeRate });
      return NextResponse.json({ success: true, data: { trend } });
    }

    return NextResponse.json(
      { error: `Unknown action '${action}'. Valid actions: record_metric, register_sla, set_threshold, get_trend` },
      { status: 400 },
    );
  } catch (error) {
    logger.error('Health scorecard API error', undefined, { action, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
