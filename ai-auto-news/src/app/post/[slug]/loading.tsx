export default function PostLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="animate-pulse space-y-6">
        {/* Breadcrumb */}
        <div className="h-3 rounded w-48" style={{ background: 'var(--bg-glass)' }} />

        {/* Category badge */}
        <div className="h-6 rounded-full w-20" style={{ background: 'var(--bg-glass)' }} />

        {/* Title */}
        <div className="h-10 rounded w-full" style={{ background: 'var(--bg-glass)' }} />
        <div className="h-10 rounded w-2/3" style={{ background: 'var(--bg-glass)' }} />

        {/* Meta */}
        <div className="h-4 rounded w-64" style={{ background: 'var(--bg-glass)' }} />

        {/* Trust panel */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-[var(--radius-md)]"
              style={{ background: 'var(--bg-glass)' }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="space-y-3 pt-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="h-4 rounded"
              style={{
                background: 'var(--bg-glass)',
                width: `${70 + Math.sin(i * 1.5) * 25}%`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
