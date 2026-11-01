import { NextResponse, type NextRequest } from "next/server";
import { schema } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";

// This endpoint only exists when TEST_AUTH_BYPASS=true. It exposes the
// app_notification_log outbox so the E2E suite can assert that triggers wrote
// (and deduplicated) the expected rows without direct database access.
export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.TEST_AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const { db } = getContainer();

  try {
    // Filtered in JS rather than SQL: apps must not import drizzle-orm, and
    // the E2E database holds only a handful of rows.
    const rows = await db.select().from(schema.app_notification_log);
    const notifications = resourceId
      ? rows.filter((row) => row.resource_id === resourceId)
      : rows;
    return NextResponse.json({ notifications });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
