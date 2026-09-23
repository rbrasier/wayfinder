"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectivity } from "@/components/settings/connectivity";
import { StorageCard } from "@/components/settings/storage-card";
import { AiProviderCard } from "@/components/settings/ai-provider-card";
import { AUTH_METHOD_LABELS, AuthMethodsCard } from "@/components/settings/auth-methods-card";
import { trpc } from "@/trpc/client";
import { WizardDeploymentStep, type DeploymentMode } from "./wizard-deployment-step";
import { WizardRequirement } from "./wizard-requirement";
import { isRequirementSatisfied, resolveRequirement } from "./wizard-requirements";
import { WizardSkipDialog } from "./wizard-skip-dialog";

type Props = {
  // When true, the wizard opens from the admin Settings "Re-run setup" control
  // and ignores onboarding_state (re-running never clears the flag).
  forceOpen?: boolean;
  onClose?: () => void;
};

type StepIndex = 0 | 1 | 2;

const STEP_TITLES = ["Deployment", "Required setup", "Done"] as const;

// A short explainer shown above each step's reused settings cards.
function StepIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

// Same badge vocabulary as the chat step rail — complete ticks, current is
// outlined and numbered, pending is muted — so "where am I in a sequence" reads
// identically wherever it appears in the product.
function WizardStepRail({ current }: { current: StepIndex }) {
  return (
    <div className="flex items-center gap-[10px] pt-[2px]">
      {STEP_TITLES.map((title, index) => {
        const isComplete = index < current;
        const isCurrent = index === current;
        return (
          <div key={title} className="flex items-center gap-[10px]">
            <span className="flex items-center gap-[6px]">
              <span
                className={`flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] text-[9px] font-bold ${
                  isComplete
                    ? "bg-[#1f6b4d] text-white"
                    : isCurrent
                      ? "border-[1.5px] border-wf-primary text-wf-primary"
                      : "border-[1.5px] border-[#dedad2] text-[#736d5f]"
                }`}
              >
                {isComplete ? "✓" : index + 1}
              </span>
              <span
                className={`text-[11.5px] ${
                  isCurrent ? "font-semibold text-wf-primary" : "text-[#736d5f]"
                }`}
              >
                {title}
              </span>
            </span>
            {index < STEP_TITLES.length - 1 && (
              <span
                className={`h-px w-[22px] shrink-0 ${isComplete ? "bg-[#bcd0c2]" : "bg-[#e7e3db]"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SetupWizard({ forceOpen = false, onClose }: Props) {
  const utils = trpc.useUtils();
  const onboardingQuery = trpc.settings.getOnboardingState.useQuery(undefined, {
    enabled: !forceOpen,
  });
  const setupStatusQuery = trpc.settings.getSetupStatus.useQuery();

  const setDeployment = trpc.settings.setDeploymentConfig.useMutation();
  const setOrganisationsEnabled = trpc.organisation.setEnabled.useMutation();
  const setSetting = trpc.settings.set.useMutation();
  const createOrganisation = trpc.organisation.createForSelf.useMutation();
  const completeOnboarding = trpc.settings.completeOnboarding.useMutation();

  // One shared connectivity controller so every reused card's Test button
  // behaves exactly as it does on the admin Settings page.
  const connectivity = useConnectivity();

  const [step, setStep] = useState<StepIndex>(0);
  const [manuallyClosed, setManuallyClosed] = useState(false);
  const [mode, setMode] = useState<DeploymentMode | null>(null);
  const [singleOrganisationName, setSingleOrganisationName] = useState("");
  const [multiOrganisationName, setMultiOrganisationName] = useState("");
  const [organisationCreated, setOrganisationCreated] = useState(false);
  const [skipWarningOpen, setSkipWarningOpen] = useState(false);
  const [committing, setCommitting] = useState(false);

  const shouldOpen = forceOpen || (!onboardingQuery.data?.completed && !onboardingQuery.isLoading);
  const open = shouldOpen && !manuallyClosed;

  // "Configured" alone cannot gate this step: every storage field has an env
  // default, so a fresh install reads as configured with nothing set up. The
  // live Test is the only signal those defaults cannot fake (ADR-041 §2).
  const storageState = resolveRequirement(
    setupStatusQuery.data?.storage.configured ?? false,
    connectivity.states.storage?.status,
  );
  const aiState = resolveRequirement(
    setupStatusQuery.data?.ai.configured ?? false,
    connectivity.states.ai?.status,
  );

  // Authentication was rendered here but gated by nothing, so setup could finish
  // with an enabled, broken sign-in method (ADR-042 §5). Only enabled methods
  // are tested and gate — turning one off is the escape hatch when its probe
  // fails for a transient reason.
  const enabledMethods = setupStatusQuery.data?.auth.enabledMethods;
  const authRequirements = (
    [
      ["emailPassword", "auth-email-password"],
      ["entra", "auth-entra"],
      ["pki", "auth-pki"],
    ] as const
  )
    .filter(([method]) => enabledMethods?.[method] === true)
    .map(([method, target]) => ({
      method,
      target,
      label: AUTH_METHOD_LABELS[method],
      // Enabled is what "configured" means for a sign-in method: there is no
      // env default that could make an unconfigured one read as ready.
      state: resolveRequirement(true, connectivity.states[target]?.status),
    }));

  const requiredReady =
    isRequirementSatisfied(storageState) &&
    isRequirementSatisfied(aiState) &&
    authRequirements.every((requirement) => isRequirementSatisfied(requirement.state));

  const close = (): void => {
    setManuallyClosed(true);
    onClose?.();
  };

  const finish = async (): Promise<void> => {
    await completeOnboarding.mutateAsync();
    await utils.settings.getOnboardingState.invalidate();
    close();
  };

  // Step 1's Continue persists the deployment choice, so the admin never has to
  // press Save separately. Returns false when the choice is incomplete.
  const commitDeployment = async (): Promise<boolean> => {
    if (mode === null) return false;

    const multiOrganisation = mode === "multi";
    await setDeployment.mutateAsync({ multiOrganisation });
    await setOrganisationsEnabled.mutateAsync({ enabled: multiOrganisation });

    if (mode === "single") {
      const name = singleOrganisationName.trim();
      if (name.length > 0) {
        await setSetting.mutateAsync({ key: "organisation_name", value: name });
      }
    }

    if (mode === "multi" && !organisationCreated) {
      const name = multiOrganisationName.trim();
      if (name.length === 0) {
        toast.error("Enter the organisation you belong to");
        return false;
      }
      await createOrganisation.mutateAsync({ name });
      setOrganisationCreated(true);
    }

    await Promise.all([
      utils.settings.getDeploymentConfig.invalidate(),
      utils.organisation.isEnabled.invalidate(),
      utils.settings.getSetupStatus.invalidate(),
    ]);
    return true;
  };

  const advance = async (): Promise<void> => {
    if (step === 0) {
      setCommitting(true);
      try {
        if (!(await commitDeployment())) return;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save your choice");
        return;
      } finally {
        setCommitting(false);
      }
    }
    setStep((current) => (current + 1) as StepIndex);
  };

  const continueDisabled =
    committing || (step === 0 ? mode === null : step === 1 ? !requiredReady : false);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
        {/* The wizard reuses settings cards that the page behind it also
            renders, so specs need a stable container to scope queries to. */}
        <DialogContent className="max-w-2xl" data-testid="setup-wizard">
          <DialogHeader>
            <DialogTitle data-testid="setup-wizard-title">
              Set up Wayfinder — Step {step + 1} of 3: {STEP_TITLES[step]}
            </DialogTitle>
            <WizardStepRail current={step} />
          </DialogHeader>

          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            {step === 0 && (
              <WizardDeploymentStep
                mode={mode}
                onModeChange={setMode}
                onSingleNameChange={setSingleOrganisationName}
                multiOrganisationName={multiOrganisationName}
                onMultiOrganisationNameChange={setMultiOrganisationName}
                organisationCreated={organisationCreated}
              />
            )}

            {step === 1 && (
              <div className="space-y-4">
                <StepIntro>
                  Wayfinder needs object storage and an AI provider before it can run anything.
                  Configure each below and use its Test connectivity button to confirm it works —
                  the settings carry defaults that may not match your environment. Or skip and
                  configure them later.
                </StepIntro>
                <div className="space-y-2">
                  <WizardRequirement
                    label="Object storage"
                    state={storageState}
                    testId="wizard-requirement-storage"
                  />
                  <StorageCard connectivity={connectivity} />
                </div>
                <div className="space-y-2">
                  <WizardRequirement
                    label="AI provider"
                    state={aiState}
                    testId="wizard-requirement-ai"
                  />
                  <AiProviderCard connectivity={connectivity} />
                </div>
                <div className="space-y-2">
                  {authRequirements.map((requirement) => (
                    <WizardRequirement
                      key={requirement.target}
                      label={requirement.label}
                      state={requirement.state}
                      testId={`wizard-requirement-${requirement.target}`}
                    />
                  ))}
                  <AuthMethodsCard connectivity={connectivity} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3" data-testid="wizard-complete">
                <p className="text-sm font-medium">Setup complete.</p>
                <StepIntro>
                  Wayfinder is ready to use. Advanced options — including Skills, MCP, n8n and email
                  integration — can be configured at any time from the Configuration pages.
                </StepIntro>
              </div>
            )}
          </DialogBody>

          <DialogFooter className="flex items-center justify-between gap-2">
            <div>
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((current) => (current - 1) as StepIndex)}
                >
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step === 1 && (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="wizard-skip"
                  onClick={() => setSkipWarningOpen(true)}
                >
                  Skip
                </Button>
              )}
              {step < 2 && (
                <Button
                  type="button"
                  data-testid="wizard-continue"
                  onClick={() => void advance()}
                  disabled={continueDisabled}
                >
                  Continue
                </Button>
              )}
              {step === 2 && (
                <Button
                  type="button"
                  data-testid="wizard-finish"
                  onClick={() => void finish()}
                  disabled={completeOnboarding.isPending}
                >
                  Finish
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WizardSkipDialog
        open={skipWarningOpen}
        onOpenChange={setSkipWarningOpen}
        onConfirm={() => void finish()}
        confirming={completeOnboarding.isPending}
      />
    </>
  );
}
