import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/auth";

export default async function Home() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  redirect(`/${session.profile.role}`);
}
