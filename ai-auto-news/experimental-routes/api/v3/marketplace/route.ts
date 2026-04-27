import { NextRequest, NextResponse } from 'next/server';
import { getAPIMarketplace } from '@/lib/apiMarketplace';

export async function GET(request: NextRequest) {
  const marketplace = getAPIMarketplace();
  const { searchParams } = new URL(request.url);

  const action = searchParams.get('action') || 'overview';

  switch (action) {
    case 'overview':
      return NextResponse.json(marketplace.getMarketplaceOverview());

    case 'search': {
      const result = marketplace.search({
        query: searchParams.get('q') || undefined,
        category: searchParams.get('category') as Parameters<typeof marketplace.search>[0]['category'],
        minRating: searchParams.get('minRating') ? Number(searchParams.get('minRating')) : undefined,
        sortBy: (searchParams.get('sortBy') as 'rating' | 'popularity' | 'newest') || 'popularity',
        page: Number(searchParams.get('page') || '1'),
        pageSize: Number(searchParams.get('pageSize') || '20'),
      });
      return NextResponse.json(result);
    }

    case 'featured':
      return NextResponse.json(marketplace.getFeaturedAPIs(10));

    case 'categories':
      return NextResponse.json(marketplace.getCategoryStats());

    case 'details': {
      const apiId = searchParams.get('apiId');
      if (!apiId) return NextResponse.json({ error: 'apiId required' }, { status: 400 });
      const details = marketplace.getAPIDetails(apiId);
      if (!details) return NextResponse.json({ error: 'API not found' }, { status: 404 });
      return NextResponse.json(details);
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const marketplace = getAPIMarketplace();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'publish': {
      const listing = marketplace.publishAPI(body.data);
      return NextResponse.json(listing, { status: 201 });
    }

    case 'subscribe': {
      const subscription = marketplace.subscribe(body.data);
      if (!subscription) return NextResponse.json({ error: 'Subscription failed' }, { status: 400 });
      return NextResponse.json(subscription, { status: 201 });
    }

    case 'review': {
      const review = marketplace.addReview(body.data);
      if (!review) return NextResponse.json({ error: 'Review failed' }, { status: 400 });
      return NextResponse.json(review, { status: 201 });
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
