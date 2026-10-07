"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { InviteInput, InviteState, PeopleTab, PersonRowView } from "@/lib/contracts/admin-manage-view";
import {
  NORTHWIND_DEPARTMENTS,
  type CreateInviteRequest,
  type CreateInviteResult,
  type GroupsResponse,
  type PeopleResponse,
} from "@/lib/contracts/people";

import { InviteDialog } from "./invite-dialog";
import {
  absoluteInviteLink,
  expiresLabel,
  filterGroups,
  filterPeople,
  inviteFailure,
  mapGroups,
  mapPeople,
} from "./people-mappers";
import { PeopleView } from "./people-view";

const DEPARTMENT_LABELS = NORTHWIND_DEPARTMENTS.map((name) =>
  name === "hr" ? "HR" : name.charAt(0).toUpperCase() + name.slice(1),
);

export function PeopleWorkspace({
  people,
  groups,
  createInvite,
}: {
  people: PeopleResponse;
  groups: GroupsResponse;
  createInvite: (input: CreateInviteRequest) => Promise<CreateInviteResult>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PeopleTab>("people");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<InviteState>({ status: "form" });

  const peopleRows = useMemo(() => mapPeople(people.people), [people.people]);
  const groupRows = useMemo(() => mapGroups(groups.groups), [groups.groups]);

  async function submit(input: InviteInput) {
    setInvite({ status: "submitting" });
    const result = await createInvite({
      email: input.email,
      role: "standard",
      department: input.department.toLowerCase(),
    });
    if (result.ok) {
      setInvite({
        status: "done",
        link: absoluteInviteLink(window.location.origin, result.data.url),
        expiresLabel: expiresLabel(result.data.expiresAt),
      });
    } else {
      setInvite(inviteFailure(result.error.reason));
    }
  }

  function close() {
    setInviteOpen(false);
    setInvite({ status: "form" });
  }

  return (
    <>
      <PeopleView
        groupCount={groupRows.length}
        groups={filterGroups(groupRows, query)}
        onInvite={() => setInviteOpen(true)}
        onQueryChange={setQuery}
        onTabChange={(next) => {
          setTab(next);
          setQuery("");
        }}
        onViewAs={(person: PersonRowView) =>
          router.push(`/chat?viewAs=${encodeURIComponent(person.id)}`)
        }
        people={filterPeople(peopleRows, query)}
        peopleCount={people.total}
        query={query}
        readableTotal={people.activeDocuments > 0 ? people.activeDocuments : undefined}
        tab={tab}
      />
      {inviteOpen ? (
        <InviteDialog departments={DEPARTMENT_LABELS} onClose={close} onSubmit={submit} state={invite} />
      ) : null}
    </>
  );
}
