export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="animate-pulse space-y-8">
        {/* Hero skeleton */}
        <div className="space-y-4">
          <div className="h-4 rounded w-32" style={{ background: 'var(--bg-glass)' }} />
          <div className="h-12 rounded w-3/4" style={{ background: 'var(--bg-glass)' }} />
          <div className="h-4 rounded w-2/3" style={{ background: 'var(--bg-glass)' }} />
        </div>

        {/* Stats skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-[var(--radius-md)]"
              style={{ background: 'var(--bg-glass)' }}
            />
          ))}
        </div>

        {/* Cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-64 rounded-[var(--radius-lg)]"
              style={{ background: 'var(--bg-glass)' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
