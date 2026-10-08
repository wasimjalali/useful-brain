import { EyeIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableCell,
  TableHead,
  TableHeaderRow,
  TableRow,
  TableRowActions,
} from "@/components/ui/table";
import type { PersonRowView } from "@/lib/contracts/admin-manage-view";

const COLUMNS = "minmax(0,1fr) 92px 120px 150px 120px 108px";

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function PeopleTable({
  people,
  readableTotal,
  onViewAs,
}: {
  people: PersonRowView[];
  readableTotal?: number;
  onViewAs: (person: PersonRowView) => void;
}) {
  return (
    <Table columns={COLUMNS} label="People">
      <TableHeaderRow>
        <TableHead>Name</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Department</TableHead>
        <TableHead>Documents readable</TableHead>
        <TableHead>Last active</TableHead>
        <TableHead>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableHeaderRow>
      {people.map((person) => (
        <TableRow key={person.id} tall>
          <div className="flex min-w-0 items-center gap-3" role="cell">
            <span
              aria-hidden="true"
              className="grid size-[30px] shrink-0 place-items-center rounded-full bg-border-strong text-[11px] font-semibold tracking-[-0.02em]"
            >
              {initialsOf(person.name)}
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-[13px] leading-[18px] font-medium" title={person.name}>
                {person.name}
              </span>
              <span className="truncate text-xs leading-4 text-ink-faint-text" title={person.email}>
                {person.email}
              </span>
            </span>
          </div>
          <TableCell>{person.role}</TableCell>
          <TableCell>{person.department}</TableCell>
          <div className="flex items-center gap-2.5" role="cell">
            <span className="min-w-[22px] text-[13px]">{person.readableCount}</span>
            {readableTotal ? (
              <span
                aria-label="Documents readable"
                aria-valuemax={readableTotal}
                aria-valuemin={0}
                aria-valuenow={person.readableCount}
                className="h-1 w-[72px] overflow-hidden rounded-full bg-sunken"
                role="meter"
              >
                <span
                  className="block h-full rounded-full bg-ink-muted"
                  style={{
                    width: `${Math.min(100, Math.round((person.readableCount / readableTotal) * 100))}%`,
                  }}
                />
              </span>
            ) : null}
          </div>
          <TableCell>{person.lastActiveLabel}</TableCell>
          <TableRowActions>
            <Button
              aria-label={`View as ${person.name}`}
              icon={<EyeIcon className="size-3.5" />}
              onClick={() => onViewAs(person)}
              size={32}
              variant="secondary"
            >
              View as
            </Button>
          </TableRowActions>
        </TableRow>
      ))}
    </Table>
  );
}
