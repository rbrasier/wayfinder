import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "@/lib/container";

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

  if (!sessionCookie?.value) {
    redirect("/admin/login");
  }

  const session = await getContainer().resolveSession(sessionCookie.value);

  if (!session) {
    redirect("/admin/login");
  }

  if (session.isAdmin) {
    redirect("/admin/flows");
  }

  redirect("/chats");
}
