import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Application Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure global behaviour for this application.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Application name, default locale, and timezone settings.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Provider</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Select the default AI provider and model used across the application.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Configure the transactional email provider and sender address.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maintenance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Enable maintenance mode to temporarily suspend access for non-admin users.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
