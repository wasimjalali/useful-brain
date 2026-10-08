import { createInviteAction } from "@/app/admin-people-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PeopleWorkspace } from "@/components/admin/people/people-workspace";
import { PageBody } from "@/components/shell/page-body";
import { brainJson } from "@/lib/cf/brain-client";
import type { GroupsResponse, PeopleResponse } from "@/lib/contracts/people";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  let data: { people: PeopleResponse; groups: GroupsResponse } | null = null;
  try {
    const [people, groups] = await Promise.all([
      brainJson<PeopleResponse>("/admin/people"),
      brainJson<GroupsResponse>("/admin/groups"),
    ]);
    data = { people, groups };
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <PageBody>
        <InlineAlert>Couldn&apos;t load people. Try again.</InlineAlert>
      </PageBody>
    );
  }
  return (
    <div className="uv-scroll min-h-0 flex-1 overflow-y-auto">
      <PeopleWorkspace createInvite={createInviteAction} groups={data.groups} people={data.people} />
    </div>
  );
}
