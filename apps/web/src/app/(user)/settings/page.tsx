import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto">
    <main className="container max-w-2xl py-12 pb-24 md:pb-12">
      <div className="mb-8 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account preferences.</p>
      </div>

      <div className="space-y-4">
        <ProfileSettingsForm />

        {/* <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Control which emails and alerts you receive.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Manage active sessions and authentication methods.
          </CardContent>
        </Card>*/}
      </div>
    </main>
    </div>
  );
}
