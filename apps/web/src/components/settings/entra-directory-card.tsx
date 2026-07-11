"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";

export function EntraDirectoryCard({ connectivity }: { connectivity: ConnectivityController }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approver Directory (Microsoft Entra)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Approver resolution reuses the email notification Microsoft 365 app registration
          (<code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code>).
        </p>
        <p>
          Grant the application Graph permissions <code>User.Read.All</code> and{" "}
          <code>Directory.Read.All</code> (tenant admin consent) to enable live reporting-line and
          people search. Until then, resolution falls back to the HR upload and manual pick.
        </p>
        <ConnectivityTest target="entra" controller={connectivity} />
      </CardContent>
    </Card>
  );
}
