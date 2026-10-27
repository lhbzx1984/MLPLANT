import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionInfo } from "@/lib/auth";

export default async function TrainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  return (
    <AppShell
      profile={{
        full_name: session.profile.full_name,
        email: session.user.email ?? null,
        role: session.profile.role,
      }}
    >
      {children}
    </AppShell>
  );
}
