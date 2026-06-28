'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-24 text-center">
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Admin panel error
      </h2>
      <p className="mb-6" style={{ color: 'var(--text-muted)' }}>
        {error.message || 'Something went wrong in the admin dashboard.'}
      </p>
      <button onClick={reset} className="btn-primary">
        Try again
      </button>
    </div>
  );
}
