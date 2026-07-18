"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

export function AdminOrganisationsContent() {
  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-8 py-8">
        <OrganisationsManagementCard />
        <MembershipAssignmentCard />
        <ResolutionStrategyCard />
      </div>
    </div>
  );
}

function OrganisationsManagementCard() {
  const utils = trpc.useUtils();
  const organisationsQuery = trpc.organisation.list.useQuery();
  const [newName, setNewName] = useState("");

  const createOrganisation = trpc.organisation.create.useMutation({
    onSuccess: async () => {
      toast.success("Organisation created");
      setNewName("");
      await utils.organisation.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to create organisation"),
  });
  const deleteOrganisation = trpc.organisation.delete.useMutation({
    onSuccess: async () => {
      toast.success("Organisation deleted");
      await utils.organisation.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to delete organisation"),
  });
  const renameOrganisation = trpc.organisation.update.useMutation({
    onSuccess: async () => {
      toast.success("Organisation renamed");
      await utils.organisation.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to rename organisation"),
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createOrganisation.mutate({ name: newName.trim() });
  };

  const organisations = organisationsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Organisations</CardTitle>
        <div className="flex gap-2">
          <Input
            aria-label="New organisation name"
            placeholder="New organisation name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleCreate()}
            className="max-w-[220px]"
          />
          <Button onClick={handleCreate} disabled={createOrganisation.isPending || !newName.trim()}>
            Add organisation
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          An organisation is an internal sharing scope: a flow published to an organisation is
          discoverable by its members. It carries no data isolation.
        </p>
        {organisationsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : organisations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No organisations yet.</p>
        ) : (
          <ul className="divide-y divide-[#ece9e3]">
            {organisations.map((organisation) => (
              <li key={organisation.id} className="flex items-center justify-between gap-3 py-2">
                <RenameField
                  name={organisation.name}
                  disabled={renameOrganisation.isPending}
                  onRename={(name) => renameOrganisation.mutate({ organisationId: organisation.id, name })}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleteOrganisation.isPending}
                  onClick={() => deleteOrganisation.mutate({ organisationId: organisation.id })}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RenameField({
  name,
  disabled,
  onRename,
}: {
  name: string;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const dirty = value.trim().length > 0 && value.trim() !== name;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        aria-label={`Rename ${name}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && dirty && onRename(value.trim())}
        className="max-w-[280px]"
      />
      {dirty && (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRename(value.trim())}>
          Save
        </Button>
      )}
    </div>
  );
}

function MembershipAssignmentCard() {
  const utils = trpc.useUtils();
  const organisationsQuery = trpc.organisation.list.useQuery();
  const usersQuery = trpc.user.list.useQuery({});

  const assignUser = trpc.organisation.assignUser.useMutation({
    onSuccess: async () => {
      toast.success("Membership updated");
      await utils.user.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to update membership"),
  });

  const organisations = organisationsQuery.data ?? [];
  const users = (usersQuery.data ?? []).filter((user) => !user.isAdmin);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Assign each user to an organisation. Applies under the “Administrator assigns” strategy;
          automatic strategies fill this in on sign-in.
        </p>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <ul className="divide-y divide-[#ece9e3]">
            {users.map((user) => (
              <li key={user.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-[#1a1814]">{user.name ?? user.email}</span>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <select
                  aria-label={`Organisation for ${user.name ?? user.email}`}
                  className="rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                  value={user.organisationId ?? ""}
                  disabled={assignUser.isPending}
                  onChange={(event) =>
                    assignUser.mutate({
                      userId: user.id,
                      organisationId: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">Unaffiliated</option>
                  {organisations.map((organisation) => (
                    <option key={organisation.id} value={organisation.id}>
                      {organisation.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type Strategy = "admin" | "sso_claim" | "email_domain" | "self_nomination";

function ResolutionStrategyCard() {
  const utils = trpc.useUtils();
  const resolutionQuery = trpc.organisation.getResolution.useQuery();
  const organisationsQuery = trpc.organisation.list.useQuery();

  const [strategy, setStrategy] = useState<Strategy>("admin");
  const [claimName, setClaimName] = useState("");
  const [onUnmatched, setOnUnmatched] = useState<"unaffiliated" | "nominate">("unaffiliated");
  const [domainMap, setDomainMap] = useState<Array<{ domain: string; organisationId: string }>>([]);
  const [nominationMode, setNominationMode] = useState<"create_or_join" | "join_existing">("create_or_join");
  const [allowlist, setAllowlist] = useState("");

  useEffect(() => {
    const config = resolutionQuery.data;
    if (!config) return;
    setStrategy(config.strategy);
    if (config.ssoClaim) setClaimName(config.ssoClaim.claimName);
    if (config.emailDomain) {
      setOnUnmatched(config.emailDomain.onUnmatched);
      setDomainMap(config.emailDomain.domainToOrg.map((entry) => ({ ...entry })));
    }
    if (config.selfNomination) {
      setNominationMode(config.selfNomination.mode);
      setAllowlist((config.selfNomination.allowlist ?? []).join(", "));
    }
  }, [resolutionQuery.data]);

  const setResolution = trpc.organisation.setResolution.useMutation({
    onSuccess: async () => {
      toast.success("Resolution strategy saved");
      await utils.organisation.getResolution.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to save strategy"),
  });

  const organisations = organisationsQuery.data ?? [];

  const handleSave = () => {
    if (strategy === "admin") {
      setResolution.mutate({ strategy: "admin" });
      return;
    }
    if (strategy === "sso_claim") {
      setResolution.mutate({ strategy: "sso_claim", ssoClaim: { claimName: claimName.trim() } });
      return;
    }
    if (strategy === "email_domain") {
      setResolution.mutate({
        strategy: "email_domain",
        emailDomain: {
          domainToOrg: domainMap.filter((entry) => entry.domain.trim() && entry.organisationId),
          onUnmatched,
        },
      });
      return;
    }
    const parsedAllowlist = allowlist
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    setResolution.mutate({
      strategy: "self_nomination",
      selfNomination: {
        mode: nominationMode,
        ...(parsedAllowlist.length > 0 ? { allowlist: parsedAllowlist } : {}),
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membership resolution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          How a user’s organisation is decided when they sign in (ADR-038).
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="resolution-strategy" className="text-sm font-medium">
            Strategy
          </label>
          <select
            id="resolution-strategy"
            className="max-w-[320px] rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as Strategy)}
          >
            <option value="admin">Administrator assigns</option>
            <option value="sso_claim">SSO claim</option>
            <option value="email_domain">Email domain</option>
            <option value="self_nomination">Self-nomination</option>
          </select>
        </div>

        {strategy === "sso_claim" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="claim-name" className="text-sm font-medium">
              Claim name
            </label>
            <Input
              id="claim-name"
              placeholder="e.g. organization"
              value={claimName}
              onChange={(event) => setClaimName(event.target.value)}
              className="max-w-[320px]"
            />
          </div>
        )}

        {strategy === "email_domain" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="on-unmatched" className="text-sm font-medium">
                When no domain matches
              </label>
              <select
                id="on-unmatched"
                className="max-w-[320px] rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                value={onUnmatched}
                onChange={(event) => setOnUnmatched(event.target.value as "unaffiliated" | "nominate")}
              >
                <option value="unaffiliated">Leave unaffiliated</option>
                <option value="nominate">Prompt to nominate</option>
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Domain → organisation</legend>
              {domainMap.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Domain ${index + 1}`}
                    placeholder="hr.acme.com"
                    value={entry.domain}
                    onChange={(event) =>
                      setDomainMap((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, domain: event.target.value } : item,
                        ),
                      )
                    }
                    className="max-w-[220px]"
                  />
                  <select
                    aria-label={`Organisation for domain ${index + 1}`}
                    className="rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                    value={entry.organisationId}
                    onChange={(event) =>
                      setDomainMap((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, organisationId: event.target.value } : item,
                        ),
                      )
                    }
                  >
                    <option value="">Select organisation</option>
                    {organisations.map((organisation) => (
                      <option key={organisation.id} value={organisation.id}>
                        {organisation.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDomainMap((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDomainMap((current) => [...current, { domain: "", organisationId: "" }])}
              >
                Add mapping
              </Button>
            </fieldset>
          </div>
        )}

        {strategy === "self_nomination" && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="nomination-mode" className="text-sm font-medium">
                Mode
              </label>
              <select
                id="nomination-mode"
                className="max-w-[320px] rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                value={nominationMode}
                onChange={(event) =>
                  setNominationMode(event.target.value as "create_or_join" | "join_existing")
                }
              >
                <option value="create_or_join">Create or join</option>
                <option value="join_existing">Join existing only</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="allowlist" className="text-sm font-medium">
                Allowlist (comma-separated, optional)
              </label>
              <Input
                id="allowlist"
                placeholder="Procurement, HR, Legal"
                value={allowlist}
                onChange={(event) => setAllowlist(event.target.value)}
                className="max-w-[420px]"
              />
            </div>
          </div>
        )}

        <Button onClick={handleSave} disabled={setResolution.isPending}>
          Save strategy
        </Button>
      </CardContent>
    </Card>
  );
}
