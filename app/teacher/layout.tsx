import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionInfo } from "@/lib/auth";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.profile.role !== "teacher")
    redirect(`/${session.profile.role}`);

  return (
    <AppShell
      profile={{
        full_name: session.profile.full_name,
        email: session.user.email ?? null,
        role: "teacher",
      }}
    >
      {children}
    </AppShell>
  );
}
