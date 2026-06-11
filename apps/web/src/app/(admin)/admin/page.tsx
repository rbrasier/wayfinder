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
            <CardTitle>Overview dashboard</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Active sessions, completions and completion rate with period deltas, plus session
            activity and AI confidence trends.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/dashboards/insights">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Flow insights</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Reporting on captured template field values across each flow&apos;s sessions.
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/dashboards/flows">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle>Flow usage</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Node-level breakdown per flow — drop-off, confidence and completion.
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
