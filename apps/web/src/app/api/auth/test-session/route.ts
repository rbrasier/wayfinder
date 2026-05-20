import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getContainer } from "@/lib/container";
import { schema } from "@rbrasier/adapters";

// This endpoint only exists when TEST_AUTH_BYPASS=true.
// It creates a real DB session for the given email and returns the token
// so Playwright can inject it as a cookie without going through magic-link flow.
export async function POST(req: Request): Promise<Response> {
  if (process.env.TEST_AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json()) as { email?: string };
  const email = body.email?.trim();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const container = getContainer();
  const { db, repos } = container;

  const userResult = await repos.users.findByEmail(email);
  if ("error" in userResult) {
    return NextResponse.json({ error: "Database error looking up user." }, { status: 500 });
  }

  let user = userResult.data;
  if (!user) {
    const createResult = await repos.users.create({ email, isAdmin: true });
    if ("error" in createResult) {
      return NextResponse.json({ error: "Failed to create test user." }, { status: 500 });
    }
    user = createResult.data;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    await db.insert(schema.core_sessions).values({
      user_id: user.id,
      token,
      expires_at: expiresAt,
    });
  } catch {
    return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
  }

  return NextResponse.json({ token });
}
