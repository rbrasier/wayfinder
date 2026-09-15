// The Express app as a Lambda handler. `buildApp` is already a pure builder
// (`apps/api/src/app.ts`), so this wraps it with no change to any route.
//
// The one route here with outside ingress is the n8n webhook (/v1/webhooks);
// everything else this app serves is internal.

import serverlessExpress from "@codegenie/serverless-express";
import type { Handler } from "aws-lambda";
import { buildApp } from "../../../apps/api/src/app.js";
import { getContainer } from "./container.js";

let cachedHandler: Handler | null = null;

export const handler: Handler = async (event, context, callback) => {
  if (!cachedHandler) {
    cachedHandler = serverlessExpress({ app: buildApp(getContainer()) });
  }
  return cachedHandler(event, context, callback);
};
