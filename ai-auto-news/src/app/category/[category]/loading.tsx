export default function CategoryLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="animate-pulse space-y-6">
        {/* Header */}
        <div className="h-8 rounded w-48" style={{ background: 'var(--bg-glass)' }} />
        <div className="h-4 rounded w-64" style={{ background: 'var(--bg-glass)' }} />

        {/* Cards grid */}
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
