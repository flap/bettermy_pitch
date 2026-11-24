import { committeeRound } from "@/lib/agents";
import { errorResponse, HttpError, loadSession, readJson } from "@/lib/api";
import { hasLeft, roomAdaptation, type DecisionEntry } from "@/lib/committee";
import { db } from "@/lib/db";
import { RoleplayInput } from "@/lib/schemas";

// POST /api/roleplay — run one meeting round: every committee member still in
// the room decides what to say (or stays silent) and how they react.
// With no `message` and an empty transcript, the committee opens the meeting.
export async function POST(req: Request) {
  try {
    const { sessionId, message } = RoleplayInput.parse(await readJson(req));
    const { session, ctx, turns, members, states, round } = await loadSession(sessionId);
    if (session.status !== "active") throw new HttpError(409, "This session has already been scored");
    if (members.every((m) => hasLeft(states[m.id]))) {
      throw new HttpError(409, "Everyone has left the meeting. End and score the session.");
    }
    if (!message && turns.length > 0) {
      throw new HttpError(400, "message is required once the conversation has started");
    }

    const priorTurns = message ? [...turns, { role: "seller" as const, content: message }] : turns;
    // The committee adapts to how the seller is doing before anyone answers.
    const adaptation = roomAdaptation(members, states, message);
    const results = await committeeRound({ ctx, members, states, turns: priorTurns, sellerText: message, adaptation });

    // Persist only after every agent has answered, so a failed LLM call never
    // leaves a half-finished round (or an orphan seller turn) in the transcript.
    // Explicit, strictly increasing timestamps keep the transcript order stable.
    const base = Date.now();
    let tick = 0;
    const at = () => new Date(base + tick++);
    const saved = await db.$transaction(async (tx) => {
      const seller = message
        ? await tx.message.create({ data: { sessionId, role: "seller", content: message, createdAt: at() } })
        : null;
      const buyerMessages = [];
      const decisions: DecisionEntry[] = [];
      for (const { member, decision } of results) {
        const msg = decision.say
          ? await tx.message.create({
              data: { sessionId, role: "buyer", speaker: member.id, content: decision.say, createdAt: at() },
            })
          : null;
        if (msg) buyerMessages.push(msg);
        const d = await tx.decision.create({
          data: {
            sessionId,
            round,
            memberId: member.id,
            messageId: msg?.id ?? null,
            action: decision.action,
            addressedTo: decision.addressedTo,
            interest: decision.interest,
            trust: decision.trust,
            reasoning: decision.reasoning,
            whisper: decision.whisper,
            adaptation,
            createdAt: at(),
          },
        });
        decisions.push({
          id: d.id,
          round,
          memberId: member.id,
          messageId: d.messageId,
          action: decision.action,
          addressedTo: decision.addressedTo,
          interest: decision.interest,
          trust: decision.trust,
          reasoning: decision.reasoning,
          whisper: decision.whisper,
          adaptation,
          createdAt: d.createdAt.toISOString(),
        });
      }
      return { seller, buyerMessages, decisions };
    });

    const dto = (m: { id: string; role: string; speaker: string | null; content: string; createdAt: Date }) => ({
      id: m.id,
      role: m.role,
      speaker: m.speaker,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    });
    return Response.json({
      seller: saved.seller ? dto(saved.seller) : null,
      messages: saved.buyerMessages.map(dto),
      decisions: saved.decisions,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
