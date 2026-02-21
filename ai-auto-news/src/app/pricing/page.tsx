import type { Metadata } from 'next';
import PricingCard from '@/components/PricingCard';
import { TIER_LIMITS } from '@/lib/config';
import { getAllFeaturesForTier } from '@/lib/featureGate';
import { getTierComparison } from '@/lib/billing';

export const metadata: Metadata = {
  title: 'Pricing — AI Auto News',
  description: 'Simple, transparent pricing for every stage of growth. Free, Pro, and Enterprise plans.',
};

export default function PricingPage() {
  const tiers = (['free', 'pro', 'enterprise'] as const).map((tier) => ({
    limits: TIER_LIMITS[tier],
    features: getAllFeaturesForTier(tier),
    isPopular: tier === 'pro',
  }));

  const comparison = getTierComparison();

  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="text-center mb-14">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Simple, Transparent Pricing
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Start free and scale as you grow. All plans include access to our autonomous
          AI publishing API. No hidden fees, no lock-in.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="grid gap-8 md:grid-cols-3 mb-20">
        {tiers.map(({ limits, features, isPopular }) => (
          <PricingCard
            key={limits.tier}
            limits={limits}
            features={features}
            isPopular={isPopular}
          />
        ))}
      </div>

      {/* Feature comparison table */}
      <div className="mb-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
          Full Feature Comparison
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-4 text-left font-semibold text-gray-700">Feature</th>
                <th className="px-6 py-4 text-center font-semibold text-gray-700">Free</th>
                <th className="px-6 py-4 text-center font-semibold text-blue-700 bg-blue-50">Pro</th>
                <th className="px-6 py-4 text-center font-semibold text-gray-700">Enterprise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {comparison.map((row) => (
                <tr key={row.feature} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-700">{row.feature}</td>
                  {(['free', 'pro', 'enterprise'] as const).map((tier) => (
                    <td
                      key={tier}
                      className={`px-6 py-3 text-center ${tier === 'pro' ? 'bg-blue-50' : ''}`}
                    >
                      {typeof row[tier] === 'boolean' ? (
                        row[tier] ? (
                          <span className="text-green-500 font-bold text-base">✓</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )
                      ) : (
                        <span className="text-gray-700">{String(row[tier])}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
          Frequently Asked Questions
        </h2>
        <div className="space-y-6">
          {[
            {
              q: 'Can I upgrade or downgrade at any time?',
              a: 'Yes. You can change your plan at any time via the /api/subscriptions endpoint or your dashboard. Upgrades take effect immediately; downgrades take effect at the end of your billing cycle.',
            },
            {
              q: 'What counts as an API call?',
              a: 'Each request to any /api/v1/* endpoint counts as one API call. Internal page loads and admin requests are not counted.',
            },
            {
              q: 'Is there a free trial for Pro?',
              a: 'Yes — new accounts get a 14-day Pro trial automatically. No credit card required to start.',
            },
            {
              q: 'What happens when I exceed my rate limit?',
              a: 'Requests exceeding your per-minute or per-day limit receive a 429 response with a Retry-After header indicating when you can resume.',
            },
            {
              q: 'Do you offer custom enterprise pricing?',
              a: 'Yes. Contact sales@aiauto.news for volume discounts, dedicated infrastructure, SLA guarantees, and custom integrations.',
            },
          ].map(({ q, a }) => (
            <details key={q} className="rounded-lg border border-gray-200 bg-white p-6">
              <summary className="cursor-pointer font-semibold text-gray-900">{q}</summary>
              <p className="mt-3 text-gray-600 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
