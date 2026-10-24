import { NextResponse } from "next/server";

// A stand-in external API for the Event Watch e2e spec. Only exists when
// TEST_AUTH_BYPASS=true, like the seed endpoint.
export async function GET(): Promise<Response> {
  if (process.env.TEST_AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    hearings: [
      { id: "H-1", status: "finished", committee: { name: "Finance" } },
      { id: "H-2", status: "live", committee: { name: "Economics" } },
    ],
  });
}
