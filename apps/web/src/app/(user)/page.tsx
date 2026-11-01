import { redirect } from "next/navigation";
import { resolveServerPrincipal } from "@/lib/server-principal";

export default async function HomePage() {
  const { principal } = await resolveServerPrincipal();

  if (!principal) {
    redirect("/login");
  }

  redirect("/chats");
}
