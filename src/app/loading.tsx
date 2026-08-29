export default function Loading() {
  return (
    <div className="flex h-screen bg-canvas" role="status">
      <aside className="hidden w-[264px] border-r border-border bg-surface p-5 lg:block">
        <div className="skeleton h-8 w-36" />
        <div className="mt-8 space-y-3">
          <div className="skeleton h-10" />
          <div className="skeleton h-10" />
          <div className="skeleton h-10" />
          <div className="skeleton h-10" />
        </div>
      </aside>
      <main className="flex flex-1 flex-col">
        <div className="h-14 border-b border-border bg-surface" />
        <div className="mx-auto w-full max-w-3xl space-y-4 px-5 py-10">
          <div className="skeleton h-7 w-48" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
      </main>
      <span className="sr-only">Loading workspace</span>
    </div>
  );
}
