import type { Container } from "./container";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Every storage path any fixture file references, across e2e-fixtures.ts,
// e2e-fixtures-approval.ts and e2e-fixtures-structured.ts.
//
// The fixtures write these paths into node config and flow context docs but
// never wrote the objects themselves, so anything that actually reads one —
// flow export does — got NOT_FOUND against a seeded flow. Must stay in step
// with the fixture files; a path named there but missing here produces a flow
// that cannot be exported, and the failure surfaces far from its cause:
//   rg -o '"(templates|context)/[^"]+"' apps/web/src/lib/e2e-fixtures*.ts | sort -u
const SEEDED_STORAGE_PATHS = [
  "templates/e2e-seed-purchase.docx",
  "templates/e2e-seed-onboarding.docx",
  "templates/e2e-seed-instrument.docx",
  "templates/e2e-seed-annexe.docx",
  "context/e2e-seed/purchase-request.docx",
  "context/e2e-seed/onboarding-plan.docx",
  "context/e2e-seed/delegation-instrument-r2.docx",
] as const;

// The bytes only have to exist and be stable — no spec reads their content, but
// export bundles them and verifies each one's sha256.
export const seedStorageObjects = async (container: Container): Promise<void> => {
  for (const path of SEEDED_STORAGE_PATHS) {
    const placeholder = Buffer.from(`e2e seed placeholder for ${path}`, "utf8");
    const stored = await container.objectStorage.put(path, placeholder, DOCX_MIME);
    if (stored.error) {
      throw new Error(`seed storage object ${path}: ${stored.error.message}`);
    }
  }
};
