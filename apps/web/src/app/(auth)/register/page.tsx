import { redirect } from "next/navigation";
import { resolveServerPrincipal } from "@/lib/server-principal";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const { principal } = await resolveServerPrincipal();
  if (principal) {
    redirect("/chats");
  }

  return <RegisterForm />;
}
