// Memory across runs: a buyer persona remembers how earlier scored meetings
// with this seller ended, and that changes how it starts the next one.
// (The app has no accounts, so "this seller" is whoever uses this instance.)
import { PERSONAS } from "./catalog";
import { sessionMembers, type Member, type Memory } from "./committee";
import { db } from "./db";
import { CATEGORY_KEYS, CATEGORY_LABELS, ScorecardReport } from "./schemas";

const LOOKBACK = 40;

/** Persona id of a stored member, including sessions saved before members had one. */
export function memberPersonaId(member: Member, session: { personaId: string }) {
  if (member.personaId) return member.personaId;
  if (member.id === "primary") return session.personaId;
  return PERSONAS.find((p) => p.name === member.name)?.id ?? null;
}

type StoredVote = { memberId: string; vote: string };

/** Memories for each requested persona id that has met this seller before. */
export async function recallMemories(personaIds: string[]): Promise<Record<string, Memory>> {
  const wanted = new Set(personaIds.filter((id) => id && id !== "custom"));
  if (wanted.size === 0) return {};

  const sessions = await db.session.findMany({
    where: { status: "scored" },
    orderBy: { createdAt: "desc" },
    take: LOOKBACK,
    include: { scorecard: true, decisions: { orderBy: [{ round: "desc" }, { createdAt: "desc" }] } },
  });

  const memories: Record<string, Memory> = {};
  for (const session of sessions) {
    for (const member of sessionMembers(session)) {
      const personaId = memberPersonaId(member, session);
      if (!personaId || !wanted.has(personaId)) continue;
      const known = memories[personaId];
      if (known) {
        known.sessions += 1;
        continue;
      }
      // Most recent meeting with this persona: where it ended and why.
      const last = session.decisions.find((d) => d.memberId === member.id);
      let lastVote: string | null = null;
      let weakSpot: string | null = null;
      try {
        const votes = JSON.parse(session.scorecard?.verdict ?? "[]") as StoredVote[];
        lastVote = votes.find((v) => v.memberId === member.id)?.vote ?? null;
      } catch {
        // older scorecards have no verdict
      }
      const report = session.scorecard ? ScorecardReport.safeParse(JSON.parse(session.scorecard.report)) : null;
      if (report?.success) {
        const key = [...CATEGORY_KEYS].sort((a, b) => report.data.categories[a].score - report.data.categories[b].score)[0];
        const c = report.data.categories[key];
        weakSpot = `${CATEGORY_LABELS[key]} (${c.score}/100): ${c.rationale}`;
      }
      memories[personaId] = {
        sessions: 1,
        lastInterest: last?.interest ?? 50,
        lastTrust: last?.trust ?? 50,
        lastReason: last?.reasoning ?? "",
        lastVote,
        weakSpot,
      };
    }
  }
  return memories;
}
