import { SessionArena } from "@/components/SessionArena";
import type { HintEntry } from "@/components/LiveCoachSidebar";
import { toDecisionEntry } from "@/lib/api";
import { speechLang } from "@/lib/catalog";
import { sessionMembers } from "@/lib/committee";
import { db } from "@/lib/db";
import { CoachHint } from "@/lib/schemas";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

export default function SessionPage({ params }: PageProps<"/session/[id]">) {
  return (
    <Suspense fallback={<div className="h-[70vh] animate-pulse rounded-2xl border border-border bg-card" />}>
      <Arena params={params} />
    </Suspense>
  );
}

function parseHint(raw: string) {
  try {
    const parsed = CoachHint.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function Arena({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const session = await db.session.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      decisions: { orderBy: [{ round: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!session) notFound();
  if (session.status === "scored") redirect(`/scorecard/${id}`);

  const members = sessionMembers(session);
  const hints: HintEntry[] = session.messages.flatMap((m) => {
    const hint = m.coachHint ? parseHint(m.coachHint) : null;
    return hint ? [{ messageId: m.id, hint }] : [];
  });

  return (
    <SessionArena
      session={{
        id: session.id,
        title: session.title,
        difficulty: session.difficulty,
        framework: session.framework,
        speechLang: speechLang(session.language),
        members,
      }}
      initialMessages={session.messages.map((m) => ({
        id: m.id,
        role: m.role === "buyer" ? "buyer" : "seller",
        speaker: m.role === "buyer" ? (m.speaker ?? members[0].id) : null,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      }))}
      initialHints={hints}
      initialDecisions={session.decisions.map(toDecisionEntry)}
    />
  );
}
