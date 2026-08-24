import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminIndexPage() {
  return (
    <div className="h-full overflow-auto">
    <div className="container py-8">
    <div className="grid gap-4 sm:grid-cols-2">
      <Link href="/admin/dashboards/overview">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Value</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Estimated effort avoided in hours, per flow and overall, with AI cost alongside and
            typical time to complete a case.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/dashboards/insights">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Flow reports</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Reporting on captured template field values across each flow&apos;s sessions.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/dashboards/flows">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Flow health</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Where sessions leave a flow, step by step — abandoned, stalled and median time.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/dashboards/governance">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Cost governance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Spend by user and flow, plus per-user spend caps with warn-then-block
            enforcement and cap utilisation.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/users">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Create, edit, delete users. Toggle the admin flag.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/errors">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Errors</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Browse application errors grouped by message and page.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/settings">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Configure AI provider, email, and global application behaviour.
          </CardContent>
        </Card>
      </Link>
    </div>
    </div>
    </div>
  );
}
