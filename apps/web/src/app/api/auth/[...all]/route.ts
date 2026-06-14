import { toNextJsHandler } from "better-auth/next-js";
import { getContainer } from "@/lib/container";

export async function GET(request: Request) {
  const auth = await getContainer().getAuth();
  return toNextJsHandler(auth).GET(request);
}

export async function POST(request: Request) {
  const auth = await getContainer().getAuth();
  return toNextJsHandler(auth).POST(request);
}
