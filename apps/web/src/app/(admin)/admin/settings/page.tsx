"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SetupWizard } from "@/components/onboarding/setup-wizard";
import { AiProviderCard } from "@/components/settings/ai-provider-card";
import { AboutLinksCard } from "@/components/settings/about-links-card";
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
import { OrganisationsCard } from "@/components/settings/organisations-card";
import { RagEmbeddingsCard } from "@/components/settings/rag-embeddings-card";
import { RegistrationToggleCard } from "@/components/settings/registration-toggle-card";
import { SessionPolicyCard } from "@/components/settings/session-policy-card";
import { SessionUploadsCard } from "@/components/settings/session-uploads-card";
import { ExtractionConfigCard } from "@/components/settings/extraction-config-card";
import { SiemStreamingCard } from "@/components/settings/siem-streaming-card";
import { SiteBannerCard } from "@/components/settings/site-banner-card";
import { StorageCard } from "@/components/settings/storage-card";

export default function AppSettingsPage() {
  const connectivity = useConnectivity();
  const [rerunSetup, setRerunSetup] = useState(false);

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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                data-testid="rerun-setup"
                onClick={() => setRerunSetup(true)}
              >
                Re-run setup
              </Button>
              <Button
                variant="outline"
                data-testid="test-all-connectivity"
                onClick={() => void connectivity.runAll(ALL_CONNECTIVITY_TARGETS)}
                disabled={connectivity.isBusy}
              >
                {connectivity.isBusy ? "Testing…" : "Test all"}
              </Button>
            </div>
          </div>

          {rerunSetup && <SetupWizard forceOpen onClose={() => setRerunSetup(false)} />}

          <div className="space-y-4">
            <CollapsibleSection title="General" description="Identity, access and organisations.">
              <OrganisationsCard />
              <RegistrationToggleCard />
              <AuthMethodsCard connectivity={connectivity} />
              <SessionPolicyCard />
              <AboutLinksCard />
            </CollapsibleSection>

            <CollapsibleSection
              title="AI"
              description="Model provider, instructions and document generation."
              testId="settings-section-ai"
            >
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
              <ExtractionConfigCard />
            </CollapsibleSection>

            <CollapsibleSection title="Notifications" description="How and when Wayfinder notifies people.">
              <NotificationSettingsCard />
              <SiteBannerCard />
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
