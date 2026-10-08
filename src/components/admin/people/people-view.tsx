"use client";

import { UserPlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type {
  GroupRowView,
  PeopleTab,
  PersonRowView,
} from "@/lib/contracts/admin-manage-view";

import { GroupsTable } from "./groups-table";
import { PeopleTable } from "./people-table";

export function PeopleView({
  tab,
  peopleCount,
  groupCount,
  query,
  people,
  groups,
  readableTotal,
  onTabChange,
  onQueryChange,
  onViewAs,
  onInvite,
}: {
  tab: PeopleTab;
  peopleCount: number;
  groupCount: number;
  query: string;
  /** Rows already filtered by the query. */
  people: PersonRowView[];
  groups: GroupRowView[];
  /** Active document count used as the bar denominator. Omit to hide the bars. */
  readableTotal?: number;
  onTabChange: (tab: PeopleTab) => void;
  onQueryChange: (query: string) => void;
  onViewAs: (person: PersonRowView) => void;
  onInvite: () => void;
}) {
  return (
    <div className="flex flex-col">
      <header className="flex items-end gap-2 px-12 pt-9">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em]">People</h1>
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">
            Access follows department and role. Use View as to check what someone can read.
          </p>
        </div>
        <Button
          icon={<UserPlusIcon className="size-[15px]" />}
          onClick={onInvite}
          size={36}
          variant="primary"
        >
          Invite people
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-3 px-12 pt-6">
        <Segmented
          label="People or groups"
          mode="tablist"
          onChange={(value) => onTabChange(value as PeopleTab)}
          options={[
            { value: "people", label: "People", count: peopleCount },
            { value: "groups", label: "Groups", count: groupCount },
          ]}
          value={tab}
        />
        <SearchField
          label={tab === "people" ? "Search name or email" : "Search groups"}
          onChange={onQueryChange}
          placeholder={tab === "people" ? "Search name or email" : "Search groups"}
          value={query}
          width={300}
        />
      </div>
      <div className="px-9 pt-4 pb-6">
        {tab === "people" ? (
          <PeopleTable onViewAs={onViewAs} people={people} readableTotal={readableTotal} />
        ) : (
          <GroupsTable groups={groups} />
        )}
      </div>
    </div>
  );
}
