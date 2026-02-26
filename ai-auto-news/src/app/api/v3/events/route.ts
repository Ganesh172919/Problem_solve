import { NextRequest, NextResponse } from 'next/server';
import { getEventDrivenArchitecture } from '@/lib/eventDrivenArchitecture';

export async function GET(request: NextRequest) {
  const eda = getEventDrivenArchitecture();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'stats';

  switch (action) {
    case 'stats':
      return NextResponse.json(eda.getStats());

    case 'events': {
      const aggregateId = searchParams.get('aggregateId');
      if (!aggregateId) return NextResponse.json({ error: 'aggregateId required' }, { status: 400 });
      return NextResponse.json(eda.getEventsForAggregate(aggregateId));
    }

    case 'events_by_type': {
      const eventType = searchParams.get('type');
      if (!eventType) return NextResponse.json({ error: 'type required' }, { status: 400 });
      return NextResponse.json(eda.getEventsByType(eventType, Number(searchParams.get('limit') || '50')));
    }

    case 'projection': {
      const projectionId = searchParams.get('id');
      if (!projectionId) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const state = eda.getProjectionState(projectionId);
      if (!state) return NextResponse.json({ error: 'Projection not found' }, { status: 404 });
      return NextResponse.json(state);
    }

    case 'saga': {
      const sagaId = searchParams.get('id');
      if (!sagaId) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const saga = eda.getSaga(sagaId);
      if (!saga) return NextResponse.json({ error: 'Saga not found' }, { status: 404 });
      return NextResponse.json(saga);
    }

    case 'dead_letter':
      return NextResponse.json(eda.getDeadLetterQueue());

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const eda = getEventDrivenArchitecture();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'publish': {
      const event = await eda.publish(body.data);
      return NextResponse.json(event, { status: 201 });
    }

    case 'rebuild_projection': {
      const success = await eda.rebuildProjection(body.projectionId);
      return NextResponse.json({ success });
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
