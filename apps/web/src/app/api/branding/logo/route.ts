import { NextResponse } from "next/server";
import { BRANDING_LOGO_MAX_BYTES, type DomainError } from "@rbrasier/domain";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { toPublicBranding } from "@/lib/public-branding";

// The install logo (ADR-060 §4). GET is public because the sign-in page shows
// it to people who are not signed in yet. It serves the one key the branding
// config names and never takes a key from the request.

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export async function GET(request: Request): Promise<Response> {
  const container = getContainer();
  const branding = await container.runtimeConfig.getBrandingConfig();
  if (!branding.logo) return new NextResponse(null, { status: 404 });

  const stored = await container.objectStorage.get(branding.logo.key);
  if (stored.error) return new NextResponse(null, { status: 404 });

  // Only a URL naming the current version may be cached forever; any other
  // request could be answered with a logo that is later replaced.
  const requestedVersion = new URL(request.url).searchParams.get("v");
  const isCurrentVersion = requestedVersion === String(branding.logo.version);

  return new NextResponse(new Uint8Array(stored.data), {
    status: 200,
    headers: {
      "Content-Type": branding.logo.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": isCurrentVersion ? IMMUTABLE_CACHE : "no-cache",
    },
  });
}

type AdminCheck = { userId: string } | { response: NextResponse };

const requireAdmin = async (request: Request): Promise<AdminCheck> => {
  const token = getSessionTokenFromRequest(request);
  if (!token) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const session = await getContainer().resolveSession(token);
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.isAdmin) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: session.userId };
};

const errorResponse = (error: DomainError): NextResponse =>
  NextResponse.json(
    { error: error.message },
    { status: error.code === "VALIDATION_FAILED" ? 400 : 500 },
  );

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
  }
  if (file.size > BRANDING_LOGO_MAX_BYTES) {
    return NextResponse.json({ error: "The logo must be 512 KB or smaller." }, { status: 400 });
  }

  const container = getContainer();
  const content = Buffer.from(await file.arrayBuffer());
  const result = await container.useCases.uploadBrandingLogo.execute(content, admin.userId);
  if (result.error) return errorResponse(result.error);

  container.runtimeConfig.invalidateBranding();
  return NextResponse.json(toPublicBranding(result.data));
}

export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const container = getContainer();
  const result = await container.useCases.removeBrandingLogo.execute(admin.userId);
  if (result.error) return errorResponse(result.error);

  container.runtimeConfig.invalidateBranding();
  return NextResponse.json(toPublicBranding(result.data));
}
