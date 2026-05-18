import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getContainer } from "@/lib/container";
import { schema } from "@rbrasier/adapters";

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email } = (await req.json()) as { email: string };
  const container = getContainer();
  const { env, db, repos } = container;

  if (!env.ADMIN_SEED_EMAIL || email !== env.ADMIN_SEED_EMAIL) {
    return NextResponse.json({ error: "Email not recognised" }, { status: 401 });
  }

  const userResult = await repos.users.findByEmail(email);
  if ("error" in userResult) {
    return NextResponse.json({ error: "Database error looking up user." }, { status: 500 });
  }

  let user = userResult.data;
  if (!user) {
    const createResult = await repos.users.create({ email, isAdmin: true });
    if ("error" in createResult) {
      return NextResponse.json({ error: "Failed to create admin user." }, { status: 500 });
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

  const response = NextResponse.json({ ok: true });
  response.cookies.set("better-auth.session_token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return response;
}
