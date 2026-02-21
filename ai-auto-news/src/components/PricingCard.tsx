import { TierLimits } from '@/types/saas';

interface PricingCardProps {
  limits: TierLimits;
  isPopular?: boolean;
  features: { feature: string; description: string; enabled: boolean }[];
}

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const TIER_COLORS: Record<string, string> = {
  free: 'border-gray-200',
  pro: 'border-blue-500 ring-2 ring-blue-500',
  enterprise: 'border-gray-800',
};

const TIER_BADGE: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  pro: 'bg-blue-600 text-white',
  enterprise: 'bg-gray-900 text-white',
};

const TIER_BUTTON: Record<string, string> = {
  free: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
  pro: 'bg-blue-600 text-white hover:bg-blue-500',
  enterprise: 'bg-gray-900 text-white hover:bg-gray-700',
};

const CTA: Record<string, string> = {
  free: 'Get Started Free',
  pro: 'Start Pro Trial',
  enterprise: 'Contact Sales',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return 'Unlimited';
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function PricingCard({ limits, isPopular = false, features }: PricingCardProps) {
  const tier = limits.tier;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-8 shadow-sm ${TIER_COLORS[tier]}`}
    >
      {isPopular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold text-white shadow">
            Most Popular
          </span>
        </div>
      )}

      {/* Tier badge */}
      <div className="mb-4">
        <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${TIER_BADGE[tier]}`}>
          {TIER_LABELS[tier]}
        </span>
      </div>

      {/* Price */}
      <div className="mb-6">
        <span className="text-4xl font-bold text-gray-900">
          ${limits.monthlyPriceUsd}
        </span>
        <span className="text-gray-500">/month</span>
        {tier === 'enterprise' && (
          <p className="mt-1 text-sm text-gray-500">Custom pricing available</p>
        )}
      </div>

      {/* Limits */}
      <ul className="mb-6 space-y-2 text-sm text-gray-600">
        <li className="flex items-center gap-2">
          <span className="text-green-500">✓</span>
          {fmt(limits.apiCallsPerDay)} API calls/day
        </li>
        <li className="flex items-center gap-2">
          <span className="text-green-500">✓</span>
          {fmt(limits.apiCallsPerMinute)} requests/minute
        </li>
        <li className="flex items-center gap-2">
          <span className="text-green-500">✓</span>
          {limits.maxApiKeys} API {limits.maxApiKeys === 1 ? 'key' : 'keys'}
        </li>
      </ul>

      {/* Features */}
      <ul className="mb-8 flex-1 space-y-2 text-sm">
        {features.map(({ feature, description, enabled }) => (
          <li key={feature} className="flex items-start gap-2">
            {enabled ? (
              <span className="mt-0.5 text-green-500 flex-shrink-0">✓</span>
            ) : (
              <span className="mt-0.5 text-gray-300 flex-shrink-0">✗</span>
            )}
            <span className={enabled ? 'text-gray-700' : 'text-gray-400'}>
              {description}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <a
        href={tier === 'enterprise' ? 'mailto:sales@aiauto.news' : '/dashboard'}
        className={`block rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${TIER_BUTTON[tier]}`}
      >
        {CTA[tier]}
      </a>
    </div>
  );
}
