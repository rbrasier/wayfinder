import { describe, expect, it } from "vitest";
import { EMBEDDINGS_MODELS } from "@wayfinder/shared";
import {
  isProviderSelectable,
  missingKeyWarning,
  modelAfterProviderChange,
  modelOptionsFor,
  providerSelectionBlockedReason,
  staleDocumentsMessage,
  storedProviderWarning,
} from "./embeddings-provider-state";

const both = [
  { provider: "local" as const, available: true, unavailableReason: null },
  { provider: "openai" as const, available: true, unavailableReason: null },
];

const hostedOnly = [
  { provider: "local" as const, available: false, unavailableReason: "No local runtime here." },
  { provider: "openai" as const, available: true, unavailableReason: null },
];

describe("isProviderSelectable", () => {
  it("allows a provider the deployment can load", () => {
    expect(isProviderSelectable(hostedOnly, "openai")).toBe(true);
  });

  it("blocks a provider the deployment cannot load", () => {
    expect(isProviderSelectable(hostedOnly, "local")).toBe(false);
  });

  it("allows everything before the options have loaded, so the control is not dead on first paint", () => {
    expect(isProviderSelectable(undefined, "local")).toBe(true);
  });
});

describe("providerSelectionBlockedReason", () => {
  it("returns the deployment's own reason for the blocked provider", () => {
    expect(providerSelectionBlockedReason(hostedOnly, "local")).toBe("No local runtime here.");
  });

  it("returns null when the selection is allowed", () => {
    expect(providerSelectionBlockedReason(hostedOnly, "openai")).toBeNull();
    expect(providerSelectionBlockedReason(both, "local")).toBeNull();
  });

  it("returns null when the options have not loaded", () => {
    expect(providerSelectionBlockedReason(undefined, "local")).toBeNull();
  });
});

describe("storedProviderWarning", () => {
  it("warns when the saved provider is one this deployment can no longer load", () => {
    expect(storedProviderWarning(hostedOnly, "local")).toBe("No local runtime here.");
  });

  it("stays quiet when the saved provider is loadable", () => {
    expect(storedProviderWarning(hostedOnly, "openai")).toBeNull();
    expect(storedProviderWarning(both, "local")).toBeNull();
  });

  it("stays quiet for a provider the deployment does not know about", () => {
    expect(storedProviderWarning(hostedOnly, "cohere")).toBeNull();
  });
});

describe("modelOptionsFor", () => {
  it("lists the selected provider's catalogue models", () => {
    expect(modelOptionsFor(EMBEDDINGS_MODELS, "openai").map((model) => model.id)).toEqual([
      "text-embedding-3-small",
      "text-embedding-3-large",
    ]);
  });

  it("is empty before the catalogue has loaded", () => {
    expect(modelOptionsFor(undefined, "openai")).toEqual([]);
  });
});

describe("modelAfterProviderChange", () => {
  it("keeps the chosen model when the provider still offers it", () => {
    expect(modelAfterProviderChange(EMBEDDINGS_MODELS, "openai", "text-embedding-3-large")).toBe(
      "text-embedding-3-large",
    );
  });

  it("moves to the new provider's first model when the old one does not belong to it", () => {
    expect(modelAfterProviderChange(EMBEDDINGS_MODELS, "mistral", "text-embedding-3-large")).toBe(
      "mistral-embed",
    );
  });
});

describe("staleDocumentsMessage", () => {
  it("says nothing when every document matches the configured model", () => {
    expect(staleDocumentsMessage(0)).toBeNull();
  });

  it("names a single document in the singular", () => {
    expect(staleDocumentsMessage(1)).toBe(
      "1 document was embedded with a different model — re-index to search it.",
    );
  });

  it("counts several documents", () => {
    expect(staleDocumentsMessage(12)).toBe(
      "12 documents were embedded with a different model — re-index to search them.",
    );
  });
});

describe("missingKeyWarning", () => {
  it("says nothing when the key is configured or not needed", () => {
    expect(missingKeyWarning("openai", "configured")).toBeNull();
    expect(missingKeyWarning("local", "not-needed")).toBeNull();
  });

  it("points at the AI provider settings when the key is missing", () => {
    expect(missingKeyWarning("mistral", "missing")).toBe(
      "No Mistral API key is saved under AI provider, so embedding will fail.",
    );
  });

  it("allows for the server's own AWS environment when Bedrock has no saved credentials", () => {
    expect(missingKeyWarning("bedrock", "missing")).toBe(
      "No AWS Bedrock credentials are saved under AI provider; embedding will use the server's AWS environment if it has any.",
    );
  });
});
