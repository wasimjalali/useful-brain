import { FilterChip } from "@/components/ui/filter-chip";
import type { ActivityFilterValue, ActivityFilterView } from "@/lib/contracts/admin-insights-view";

export function ActivityFilters({
  filters,
  value,
  onChange,
}: {
  filters: ActivityFilterView[];
  value: ActivityFilterValue;
  onChange: (value: ActivityFilterValue) => void;
}) {
  return (
    <div aria-label="Filter by outcome" className="flex flex-wrap gap-1.5" role="group">
      {filters.map((f) => (
        <FilterChip count={f.count} key={f.value} onClick={() => onChange(f.value)} pressed={f.value === value}>
          {f.label}
        </FilterChip>
      ))}
    </div>
  );
}
