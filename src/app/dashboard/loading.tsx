export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page Title & Action Strip Skeleton (Sidebar & Top Header remain static) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded-xl bg-zinc-900 border border-zinc-800/80" />
          <div className="h-3.5 w-80 max-w-full rounded-lg bg-zinc-900/70" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-28 rounded-xl bg-zinc-900 border border-zinc-800/80" />
          <div className="h-8 w-28 rounded-xl bg-zinc-900 border border-zinc-800/80" />
        </div>
      </div>

      {/* KPI Row Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-2xl bg-zinc-900/75 border border-zinc-800/80 p-4 space-y-2"
          >
            <div className="h-3 w-20 rounded bg-zinc-800" />
            <div className="h-7 w-16 rounded-lg bg-zinc-800/90" />
          </div>
        ))}
      </div>

      {/* Content Cards Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-64 rounded-2xl bg-zinc-900/60 border border-zinc-800/80"
          />
        ))}
      </div>
    </div>
  );
}
