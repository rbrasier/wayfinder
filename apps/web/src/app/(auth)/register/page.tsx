import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "@/lib/container";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

  if (sessionCookie?.value) {
    const session = await getContainer().resolveSession(sessionCookie.value);
    if (session) {
      redirect("/chats");
    }
  }

  return <RegisterForm />;
}
