export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="w-full border-b border-zinc-800/80 bg-zinc-950/70 px-6 py-3.5 flex items-center justify-between">
        <div className="h-8 w-44 rounded-xl bg-zinc-900 animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-xl bg-zinc-900 animate-pulse" />
          <div className="h-8 w-24 rounded-xl bg-zinc-900 animate-pulse" />
          <div className="h-8 w-20 rounded-xl bg-zinc-900 animate-pulse" />
        </div>
      </header>
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-48 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 animate-pulse"
          />
        ))}
      </main>
    </div>
  );
}
