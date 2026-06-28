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
      <div className="mx-auto max-w-md px-4 py-20 animate-fade-in-up">
        <div className="glass-strong p-8" style={{ borderRadius: 'var(--radius-xl)' }}>
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🔑</div>
            <h1 className="text-2xl font-bold gradient-text mb-1">Developer Dashboard</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Enter your API key to manage your keys and subscription.
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label htmlFor="dashboard-api-key" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                API Key
              </label>
              <input
                id="dashboard-api-key"
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="aian_..."
                className="w-full px-3 py-2 text-sm font-mono"
                style={{
                  background: 'var(--bg-glass)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
                required
              />
            </div>
            {authError && <p className="text-sm" style={{ color: '#f87171' }}>{authError}</p>}
            <button type="submit" className="btn-primary w-full justify-center" style={{ padding: '12px' }}>
              Access Dashboard
            </button>
          </form>

          <div className="mt-6 p-4 text-sm" style={{ background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)' }}>
            <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Don&apos;t have an API key?</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Register a user account: <code style={{ background: 'var(--bg-glass-strong)', padding: '1px 4px', borderRadius: '4px' }}>POST /api/users</code></li>
              <li>Create an API key: <code style={{ background: 'var(--bg-glass-strong)', padding: '1px 4px', borderRadius: '4px' }}>POST /api/apikeys</code></li>
              <li>Come back here with your key.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  const tier = subscription?.tier || 'free';
  const tierLimits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 animate-fade-in-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold gradient-text">Developer Dashboard</h1>
        <span className="badge" style={{
          background: tier === 'enterprise' ? 'rgba(168, 85, 247, 0.15)' : tier === 'pro' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.15)',
          color: tier === 'enterprise' ? '#c084fc' : tier === 'pro' ? '#60a5fa' : '#94a3b8',
        }}>
          {tier} plan
        </span>
      </div>

      {message && (
        <div role="status" aria-live="polite" className="mb-6 rounded-lg p-4 text-sm glass animate-fade-in" style={{ color: 'var(--text-primary)' }}>
          {message}
          {createdKey && (
            <div className="mt-2 font-mono text-xs p-2 break-all select-all" style={{ background: 'var(--bg-glass-strong)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
              {createdKey}
            </div>
          )}
        </div>
      )}

      {/* Subscription info */}
      {subscription && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          <div className="stat-card">
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Current Plan</p>
            <p className="text-xl font-bold capitalize" style={{ color: 'var(--text-primary)' }}>{subscription.tier}</p>
            <p className="text-xs mt-1 capitalize" style={{ color: 'var(--text-muted)' }}>{subscription.status}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Period End</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
            {subscription.cancelAtPeriodEnd && (
              <p className="text-xs mt-1" style={{ color: '#f87171' }}>Cancels at period end</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>API Keys</p>
            <p className="stat-value">
              {apiKeys.filter((k) => k.isActive).length} / {tierLimits.maxApiKeys}
            </p>
          </div>
        </div>
      )}

      {/* Usage meters */}
      <div className="card p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Plan Limits</h2>
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
          <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
            <span className="font-medium">Upgrade to Pro</span> for 100× more API calls, content generation, webhooks, and analytics.{' '}
            <Link href="/pricing" className="underline font-medium">View plans →</Link>
          </div>
        )}
      </div>

      {/* API Keys management */}
      <div className="card mb-8" style={{ overflow: 'hidden' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>API Keys</h2>
        </div>

        <div className="p-6">
          <form onSubmit={handleCreateKey} className="flex gap-3 mb-6">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production, My App)"
              className="flex-1 px-3 py-2 text-sm"
              style={{
                background: 'var(--bg-glass)',
                border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
              maxLength={64}
            />
            <button
              type="submit"
              disabled={loading || !newKeyName.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Key'}
            </button>
          </form>

          <div>
            {apiKeys.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>No API keys yet. Create one above.</p>
            ) : (
              apiKeys.map((key) => (
                <div key={key.id} className="py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{key.name}</p>
                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{key.keyPrefix}••••</p>
                    <div className="flex gap-2 mt-1">
                      {key.scopes.map((s) => (
                        <span key={s} className="badge" style={{ background: 'var(--bg-glass)', color: 'var(--text-secondary)' }}>
                          {s}
                        </span>
                      ))}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {key.callCount.toLocaleString()} calls
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeKey(key.id)}
                    className="ml-4 text-xs hover:opacity-80"
                    style={{ color: '#f87171' }}
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
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Quick API Reference</h2>
        <div className="space-y-3 text-sm font-mono">
          {[
            { method: 'GET', path: '/api/v1/posts', desc: 'List published posts' },
            { method: 'GET', path: '/api/v1/posts?category=blog', desc: 'Filter by category' },
            { method: 'POST', path: '/api/v1/generate', desc: 'Generate content (Pro+)' },
            { method: 'GET', path: '/api/recommendations?slug=...', desc: 'Related post recommendations' },
            { method: 'GET', path: '/api/recommendations?view=trending', desc: 'Trending topics' },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 p-3" style={{ background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)' }}>
              <span className="flex-shrink-0 badge" style={{
                background: method === 'GET' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                color: method === 'GET' ? '#34d399' : '#60a5fa',
              }}>
                {method}
              </span>
              <div>
                <code style={{ color: 'var(--text-primary)' }}>{path}</code>
                <p className="text-xs mt-0.5 font-sans" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
