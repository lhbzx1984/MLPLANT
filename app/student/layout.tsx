import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionInfo } from "@/lib/auth";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.profile.role !== "student")
    redirect(`/${session.profile.role}`);

  return (
    <AppShell
      profile={{
        full_name: session.profile.full_name,
        email: session.user.email ?? null,
        role: "student",
      }}
    >
      {children}
    </AppShell>
  );
}
