import { ScorecardView } from "@/components/ScorecardView";
import { toDecisionEntry } from "@/lib/api";
import { currentStates, dealOutcome, initialState, sessionMembers, type Vote } from "@/lib/committee";
import { db } from "@/lib/db";
import { findQuote } from "@/lib/evidence";
import { CommitteeVote, ScorecardReport } from "@/lib/schemas";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

/** `id` is the session id: each session has at most one scorecard. */
export default function ScorecardPage({ params }: PageProps<"/scorecard/[id]">) {
  return (
    <Suspense fallback={<div className="h-[70vh] animate-pulse rounded-2xl border border-border bg-card" />}>
      <Scorecard params={params} />
    </Suspense>
  );
}

async function Scorecard({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const session = await db.session.findUnique({
    where: { id },
    include: {
      scorecard: true,
      messages: { orderBy: { createdAt: "asc" } },
      decisions: { orderBy: [{ round: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!session) notFound();
  if (!session.scorecard) redirect(`/session/${id}`);

  const report = ScorecardReport.parse(JSON.parse(session.scorecard.report));
  const members = sessionMembers(session);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  // Tie every quote the evaluator cites to the transcript line it came from.
  const lines = session.messages.map((m) => ({ id: m.id, content: m.content }));
  const sellerLines = session.messages.filter((m) => m.role === "seller").map((m) => ({ id: m.id, content: m.content }));
  const evidence = {
    moments: report.keyMoments.map((k) => findQuote(k.quote, lines)?.id ?? null),
    rewrites: report.rewrites.map((r) => findQuote(r.original, sellerLines)?.id ?? null),
  };

  const decisions = session.decisions.map(toDecisionEntry);
  const final = currentStates(members, session.difficulty, decisions);
  const committee =
    decisions.length === 0
      ? []
      : members.map((m) => ({
          member: m,
          start: initialState(m.id, session.difficulty, m.memory),
          end: final[m.id],
        }));

  // The committee's deal vote: the session's clear result, with each
  // objection tied to the seller line that addressed it.
  const parsedVotes = z
    .array(CommitteeVote.extend({ memberId: z.string() }))
    .safeParse(JSON.parse(session.scorecard.verdict || "[]"));
  const votes = (parsedVotes.success ? parsedVotes.data : []).map((v) => ({
    ...v,
    member: members.find((m) => m.id === v.memberId) ?? null,
    objections: v.objections.map((o) => ({
      ...o,
      lineId: o.quote.trim() ? (findQuote(o.quote, sellerLines)?.id ?? null) : null,
    })),
  }));
  const verdict = votes.length
    ? { outcome: dealOutcome(votes.map((v) => v.vote as Vote)), votes }
    : null;

  return (
    <ScorecardView
      verdict={verdict}
      report={report}
      meta={{
        sessionTitle: session.title,
        personaName: members.map((m) => m.name).join(", "),
        difficulty: session.difficulty,
        framework: session.framework,
        createdAt: session.createdAt.toISOString(),
        model: session.scorecard.model,
        turns: session.messages.length,
      }}
      transcript={session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        speaker: m.role === "buyer" ? ((m.speaker && nameOf.get(m.speaker)) ?? members[0].name) : null,
        content: m.content,
      }))}
      evidence={evidence}
      committee={committee}
    />
  );
}
