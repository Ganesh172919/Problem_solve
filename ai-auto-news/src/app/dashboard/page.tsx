'use client';

import { useState, useCallback } from 'react';
import UsageMeter from '@/components/UsageMeter';
import Link from 'next/link';

interface DashboardApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  callCount: number;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface DashboardSubscription {
  id: string;
  tier: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

const TIER_LIMITS: Record<string, { apiCallsPerDay: number; apiCallsPerMinute: number; maxApiKeys: number }> = {
  free: { apiCallsPerDay: 100, apiCallsPerMinute: 10, maxApiKeys: 2 },
  pro: { apiCallsPerDay: 10000, apiCallsPerMinute: 100, maxApiKeys: 10 },
  enterprise: { apiCallsPerDay: 1000000, apiCallsPerMinute: 1000, maxApiKeys: 100 },
};

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState('');
  const [authError, setAuthError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [apiKeys, setApiKeys] = useState<DashboardApiKey[]>([]);
  const [subscription, setSubscription] = useState<DashboardSubscription | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchDashboard = useCallback(async (key: string) => {
    try {
      const headers = { Authorization: `Bearer ${key}` };
      const [keysRes, subRes] = await Promise.all([
        fetch('/api/apikeys', { headers }),
        fetch('/api/subscriptions', { headers }),
      ]);

      if (keysRes.status === 401) {
        setAuthError('Invalid API key');
        setAuthenticated(false);
        return;
      }

      if (keysRes.ok) {
        const data = await keysRes.json();
        setApiKeys(data.apiKeys || []);
      }
      if (subRes.ok) {
        const data = await subRes.json();
        setSubscription(data.subscription);
      }
    } catch {
      setMessage('Failed to load dashboard data');
    }
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!apiKey.startsWith('aian_')) {
      setAuthError('Enter a valid API key (starts with aian_)');
      return;
    }

    try {
      const res = await fetch('/api/apikeys', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setAuthenticated(true);
        fetchDashboard(apiKey);
      } else {
        setAuthError('Invalid or revoked API key');
      }
    } catch {
      setAuthError('Authentication failed');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setLoading(true);
    setCreatedKey('');
    setMessage('');

    try {
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: ['read'] }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedKey(data.rawKey);
        setNewKeyName('');
        setMessage('✅ API key created. Copy it now — it will not be shown again!');
        fetchDashboard(apiKey);
      } else {
        setMessage(`❌ ${data.error || 'Failed to create key'}`);
      }
    } catch {
      setMessage('❌ Failed to create API key');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key? All requests using it will fail.')) return;
    try {
      const res = await fetch(`/api/apikeys?id=${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        setMessage('🗑️ API key revoked');
        fetchDashboard(apiKey);
      } else {
        setMessage('❌ Failed to revoke key');
      }
    } catch {
      setMessage('❌ Failed to revoke key');
    }
  };

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Developer Dashboard</h1>
        <p className="text-gray-500 text-sm text-center mb-8">
          Enter your API key to manage your keys and subscription.
        </p>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="aian_..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900"
              required
            />
          </div>
          {authError && <p className="text-red-600 text-sm">{authError}</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Access Dashboard
          </button>
        </form>

        <div className="mt-6 rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
          <p className="font-medium mb-2">Don&apos;t have an API key?</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Register a user account: <code className="bg-gray-100 px-1 rounded">POST /api/users</code></li>
            <li>Create an API key: <code className="bg-gray-100 px-1 rounded">POST /api/apikeys</code></li>
            <li>Come back here with your key.</li>
          </ol>
        </div>
      </div>
    );
  }

  const tier = subscription?.tier || 'free';
  const tierLimits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Developer Dashboard</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
          tier === 'enterprise' ? 'bg-gray-900 text-white' :
          tier === 'pro' ? 'bg-blue-600 text-white' :
          'bg-gray-100 text-gray-700'
        }`}>
          {tier} plan
        </span>
      </div>

      {message && (
        <div className="mb-6 rounded-md bg-gray-50 border border-gray-200 p-4 text-sm text-gray-800">
          {message}
          {createdKey && (
            <div className="mt-2 font-mono text-xs bg-white border border-gray-300 rounded p-2 break-all select-all">
              {createdKey}
            </div>
          )}
        </div>
      )}

      {/* Subscription info */}
      {subscription && (
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500 mb-1">Current Plan</p>
            <p className="text-xl font-bold text-gray-900 capitalize">{subscription.tier}</p>
            <p className="text-xs text-gray-400 mt-1 capitalize">{subscription.status}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500 mb-1">Period End</p>
            <p className="text-sm font-medium text-gray-900">
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
            {subscription.cancelAtPeriodEnd && (
              <p className="text-xs text-red-500 mt-1">Cancels at period end</p>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-500 mb-1">API Keys</p>
            <p className="text-xl font-bold text-gray-900">
              {apiKeys.filter((k) => k.isActive).length} / {tierLimits.maxApiKeys}
            </p>
          </div>
        </div>
      )}

      {/* Usage meters */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Limits</h2>
        <div className="space-y-4">
          <UsageMeter
            label="API calls / day"
            used={0}
            limit={tierLimits.apiCallsPerDay}
          />
          <UsageMeter
            label="Rate limit (calls / minute)"
            used={0}
            limit={tierLimits.apiCallsPerMinute}
          />
        </div>
        {tier === 'free' && (
          <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
            <span className="font-medium">Upgrade to Pro</span> for 100× more API calls, content generation, webhooks, and analytics.{' '}
            <Link href="/pricing" className="underline font-medium">View plans →</Link>
          </div>
        )}
      </div>

      {/* API Keys management */}
      <div className="rounded-lg border border-gray-200 bg-white mb-8">
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
        </div>

        <div className="p-6">
          <form onSubmit={handleCreateKey} className="flex gap-3 mb-6">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production, My App)"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              maxLength={64}
            />
            <button
              type="submit"
              disabled={loading || !newKeyName.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Key'}
            </button>
          </form>

          <div className="divide-y divide-gray-100">
            {apiKeys.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No API keys yet. Create one above.</p>
            ) : (
              apiKeys.map((key) => (
                <div key={key.id} className="py-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{key.name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{key.keyPrefix}••••</p>
                    <div className="flex gap-2 mt-1">
                      {key.scopes.map((s) => (
                        <span key={s} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {s}
                        </span>
                      ))}
                      <span className="text-xs text-gray-400">
                        {key.callCount.toLocaleString()} calls
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeKey(key.id)}
                    className="ml-4 text-xs text-red-600 hover:text-red-800"
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick API reference */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick API Reference</h2>
        <div className="space-y-3 text-sm font-mono">
          {[
            { method: 'GET', path: '/api/v1/posts', desc: 'List published posts' },
            { method: 'GET', path: '/api/v1/posts?category=blog', desc: 'Filter by category' },
            { method: 'POST', path: '/api/v1/generate', desc: 'Generate content (Pro+)' },
            { method: 'GET', path: '/api/recommendations?slug=...', desc: 'Related post recommendations' },
            { method: 'GET', path: '/api/recommendations?view=trending', desc: 'Trending topics' },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 rounded bg-gray-50 p-3">
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                method === 'GET' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {method}
              </span>
              <div>
                <code className="text-gray-800">{path}</code>
                <p className="text-gray-500 text-xs mt-0.5 font-sans">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
