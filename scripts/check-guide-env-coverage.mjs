#!/usr/bin/env node
// Every environment variable the app requires must appear in every deployment
// guide. Adding a required variable to a zod schema is a one-line change that
// silently invalidates five guides at once, and nobody notices until an operator
// hits a startup crash the docs never mentioned.
//
// This is a ratchet, not a bug hunt: it is expected to find nothing most of the
// time. What it buys is that it cannot quietly stop being true.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GUIDES_DIR = "docs/guides";

// Every setup-*.md must be classified. A new guide that is neither listed nor
// excluded fails this check, which is the point — the decision is forced rather
// than defaulted.
const DEPLOYMENT_GUIDES = [
  "setup-local.md",
  "setup-aws.md",
  "setup-aws-lambda.md",
  "setup-azure.md",
  "setup-railway.md",
];
const NOT_DEPLOYMENT_GUIDES = ["setup-admin.md", "setup-end-user.md"];

const SCHEMAS = [
  { file: "apps/web/src/lib/env.ts", declaration: "const serverEnvSchema = z.object({" },
  { file: "apps/api/src/env.ts", declaration: "const envSchema = z.object({" },
];

const failures = [];

// Reads from the schema's opening brace to its matching close, so the file's
// other declarations — the exported Env type in particular — cannot be mistaken
// for schema entries.
const schemaBody = (source, declaration) => {
  const start = source.indexOf(declaration);
  if (start === -1) return null;

  let depth = 0;
  let index = start + declaration.lastIndexOf("{");
  for (let cursor = index; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(index + 1, cursor);
    }
  }
  return null;
};

const requiredVariables = ({ file, declaration }) => {
  const body = schemaBody(readFileSync(file, "utf8"), declaration);
  if (body === null) {
    failures.push(`Could not find "${declaration}" in ${file} — this check has gone stale and must be fixed, not skipped.`);
    return [];
  }

  // The terminator is end-of-input, written as a negative lookahead rather than
  // `$`: under the `m` flag `$` matches end-of-line, which truncates every
  // multi-line entry to its first token and hides the `.optional()` below it.
  const entries = [
    ...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):([\s\S]*?)(?=^ {2}[A-Z][A-Z0-9_]*:|(?![\s\S]))/gm),
  ];
  if (entries.length === 0) {
    failures.push(`Parsed no variables out of ${file} — the schema's shape changed and this check no longer sees it.`);
    return [];
  }

  return entries
    .filter(([, , body]) => !body.includes(".optional()") && !body.includes(".default("))
    .map(([, name]) => name);
};

const required = [...new Set(SCHEMAS.flatMap(requiredVariables))].sort();

const guides = readdirSync(GUIDES_DIR).filter((name) => name.startsWith("setup-"));
const unclassified = guides.filter(
  (name) => !DEPLOYMENT_GUIDES.includes(name) && !NOT_DEPLOYMENT_GUIDES.includes(name),
);
for (const name of unclassified) {
  failures.push(
    `${GUIDES_DIR}/${name} is not classified — add it to DEPLOYMENT_GUIDES or NOT_DEPLOYMENT_GUIDES in this script.`,
  );
}

for (const guide of DEPLOYMENT_GUIDES) {
  const text = readFileSync(join(GUIDES_DIR, guide), "utf8");
  // Bounded on both sides by "not an identifier character": a plain substring
  // match would count SETTINGS_ENCRYPTION_KEY as documented by a guide that only
  // mentions SETTINGS_ENCRYPTION_KEY_FILE, which is how a renamed variable slips
  // through. \b is no help here — underscore is a word character.
  const documents = (name) => new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(text);
  const missing = required.filter((name) => !documents(name));
  if (missing.length > 0) {
    failures.push(`${GUIDES_DIR}/${guide} does not document: ${missing.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error("Deployment guides are out of step with the environment schemas:\n");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `\nRequired variables (no default, not optional): ${required.join(", ") || "(none parsed)"}`,
  );
  process.exit(1);
}

console.log(
  `every deployment guide documents all ${required.length} required variables (${required.join(", ")})`,
);
