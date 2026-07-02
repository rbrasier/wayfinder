"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

const EXAMPLE_SKILL = `---
name: Contract Reviewer
description: Reviews procurement contracts for risk
---

# Contract review

Read the contract carefully and flag unusual indemnity, liability, or
termination clauses. Ask the user about anything ambiguous.`;

export function AdminSkillsContent() {
  const utils = trpc.useUtils();
  const featureQuery = trpc.featureFlag.isEnabledForMe.useQuery({ key: "skills" });
  const skillsQuery = trpc.skill.list.useQuery({ includeArchived: true });

  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.skill.create.useMutation({
    onSuccess: () => {
      setRaw("");
      setError(null);
      void utils.skill.list.invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const archive = trpc.skill.archive.useMutation({
    onSuccess: () => void utils.skill.list.invalidate(),
  });
  const restore = trpc.skill.restore.useMutation({
    onSuccess: () => void utils.skill.list.invalidate(),
  });

  const submit = () => {
    if (!raw.trim()) return;
    create.mutate({ raw });
  };

  if (featureQuery.data === false) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8">
          <Card>
            <CardHeader>
              <CardTitle>Skills unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The Skills feature is turned off for your account. An administrator can
                enable the <span className="font-mono">skills</span> feature flag to
                manage skills here.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload a skill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a <span className="font-mono">SKILL.md</span> (YAML frontmatter +
              markdown body). Uploaded skills can be attached to any conversational
              step to steer the AI&apos;s behaviour.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="skill-raw">SKILL.md</Label>
              <Textarea
                id="skill-raw"
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
                placeholder={EXAMPLE_SKILL}
                rows={12}
                className="font-mono text-xs"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button onClick={submit} disabled={create.isPending || !raw.trim()}>
              {create.isPending ? "Uploading…" : "Upload skill"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skill library</CardTitle>
          </CardHeader>
          <CardContent>
            {skillsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : skillsQuery.data && skillsQuery.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skillsQuery.data.map((skill) => (
                    <TableRow key={skill.id}>
                      <TableCell className="font-medium">{skill.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {skill.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {skill.allowedTools.length > 0 ? skill.allowedTools.join(", ") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={skill.status === "active" ? "default" : "outline"}>
                          {skill.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(skill.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {skill.status === "active" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => archive.mutate({ id: skill.id })}
                            disabled={archive.isPending}
                          >
                            Archive
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restore.mutate({ id: skill.id })}
                            disabled={restore.isPending}
                          >
                            Restore
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                No skills yet. Upload a SKILL.md above to get started.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
