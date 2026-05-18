import { toNextJsHandler } from "better-auth/next-js";
import { getContainer } from "@/lib/container";

export function GET(request: Request) {
  return toNextJsHandler(getContainer().auth).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getContainer().auth).POST(request);
}
