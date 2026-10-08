import type { EvalCategoryView } from "@/lib/contracts/admin-insights-view";

export function CategoryBars({ categories }: { categories: EvalCategoryView[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3.5 p-0 pt-4">
      {categories.map((c) => (
        <li className="grid grid-cols-[96px_minmax(0,1fr)_48px] items-center gap-x-3" key={c.id}>
          <span className="text-[13px] text-ink">{c.name}</span>
          <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-ink"
              style={{ width: `${c.total ? (c.passed / c.total) * 100 : 0}%` }}
            />
          </span>
          <span
            className={`text-right text-[13px] ${c.passed === c.total ? "text-ink-muted" : "text-ink"}`}
          >{`${c.passed}/${c.total}`}</span>
        </li>
      ))}
    </ul>
  );
}
