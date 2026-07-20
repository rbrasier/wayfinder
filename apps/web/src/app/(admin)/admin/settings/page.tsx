"use client";

import { Button } from "@/components/ui/button";
import { AiProviderCard } from "@/components/settings/ai-provider-card";
import { AuthMethodsCard } from "@/components/settings/auth-methods-card";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import {
  ALL_CONNECTIVITY_TARGETS,
  useConnectivity,
} from "@/components/settings/connectivity";
import { DocumentGenerationCard } from "@/components/settings/document-generation-card";
import { EmailCard } from "@/components/settings/email-card";
import { EntraDirectoryCard } from "@/components/settings/entra-directory-card";
import { GlobalInstructionsCard } from "@/components/settings/global-instructions-card";
import { HrDataCard } from "@/components/settings/hr-data-card";
import { N8nIntegrationCard } from "@/components/settings/n8n-integration-card";
import { NotificationSettingsCard } from "@/components/settings/notification-settings-card";
import { OrganisationNameCard } from "@/components/settings/organisation-name-card";
import { OrganisationsToggleCard } from "@/components/settings/organisations-toggle-card";
import { RagEmbeddingsCard } from "@/components/settings/rag-embeddings-card";
import { RegistrationToggleCard } from "@/components/settings/registration-toggle-card";
import { SessionUploadsCard } from "@/components/settings/session-uploads-card";
import { SiemStreamingCard } from "@/components/settings/siem-streaming-card";
import { StorageCard } from "@/components/settings/storage-card";
import { trpc } from "@/trpc/client";

export default function AppSettingsPage() {
  const connectivity = useConnectivity();
  const organisationsEnabledQuery = trpc.organisation.isEnabled.useQuery();

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
              <p className="text-sm text-muted-foreground">
                Configure global behaviour for this application.
              </p>
            </div>
            <Button
              variant="outline"
              data-testid="test-all-connectivity"
              onClick={() => void connectivity.runAll(ALL_CONNECTIVITY_TARGETS)}
              disabled={connectivity.isBusy}
            >
              {connectivity.isBusy ? "Testing…" : "Test all"}
            </Button>
          </div>

          <div className="space-y-4">
            <CollapsibleSection title="General" description="Identity, access and organisations.">
              <OrganisationsToggleCard />
              {/* When organisations are enabled each member's own organisation is
                  used, so the single global name is only relevant when off. */}
              {organisationsEnabledQuery.data !== true && <OrganisationNameCard />}
              <RegistrationToggleCard />
              <AuthMethodsCard />
            </CollapsibleSection>

            <CollapsibleSection title="AI" description="Model provider, instructions and document generation.">
              <GlobalInstructionsCard />
              <AiProviderCard connectivity={connectivity} />
              <DocumentGenerationCard />
            </CollapsibleSection>

            <CollapsibleSection
              title="Integrations"
              description="External services Wayfinder connects to."
            >
              <N8nIntegrationCard connectivity={connectivity} />
              <RagEmbeddingsCard connectivity={connectivity} />
              <EmailCard connectivity={connectivity} />
            </CollapsibleSection>

            <CollapsibleSection title="Storage & uploads" description="Where files live and upload limits.">
              <StorageCard connectivity={connectivity} />
              <SessionUploadsCard />
            </CollapsibleSection>

            <CollapsibleSection title="Notifications" description="How and when Wayfinder notifies people.">
              <NotificationSettingsCard />
            </CollapsibleSection>

            <CollapsibleSection
              title="Directory & security"
              description="HR data, directory sync and audit streaming."
            >
              <HrDataCard />
              <EntraDirectoryCard connectivity={connectivity} />
              <SiemStreamingCard />
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}
