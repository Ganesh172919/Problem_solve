'use client';

export default function PostError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-24 text-center">
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Failed to load article
      </h2>
      <p className="mb-6" style={{ color: 'var(--text-muted)' }}>
        {error.message || 'Something went wrong while loading this article.'}
      </p>
      <div className="flex items-center justify-center gap-4">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <a href="/" className="btn-ghost">
          ← Back to Home
        </a>
      </div>
    </div>
  );
}
