import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminIndexPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Configure AI provider, email, and global application behaviour.
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
