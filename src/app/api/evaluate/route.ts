import { committeeVotes, evaluateSession } from "@/lib/agents";
import { dealOutcome } from "@/lib/committee";
import { errorResponse, HttpError, loadSession, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SessionIdInput } from "@/lib/schemas";
import { Prisma } from "@prisma/client";

// POST /api/evaluate — end the session and generate the structured scorecard.
export async function POST(req: Request) {
  try {
    const { sessionId } = SessionIdInput.parse(await readJson(req));
    const { session, ctx, turns, members, states } = await loadSession(sessionId);

    const existing = await db.scorecard.findUnique({ where: { sessionId } });
    if (existing) return Response.json({ scorecardId: existing.id, sessionId });

    if (!turns.some((t) => t.role === "seller")) {
      throw new HttpError(400, "Say at least one thing to the buyer before scoring the session");
    }

    // The evaluator scores the seller while every buyer casts a deal vote.
    const [{ report, model }, votes] = await Promise.all([
      evaluateSession(ctx, turns, { members, states }),
      committeeVotes({ ctx, members, states, turns }),
    ]);
    const verdict = votes.map(({ member, vote }) => ({ memberId: member.id, ...vote }));
    const outcome = dealOutcome(verdict.map((v) => v.vote));
    try {
      const scorecard = await db.scorecard.create({
        data: {
          sessionId,
          overall: report.overallScore,
          report: JSON.stringify(report),
          verdict: JSON.stringify(verdict),
          model,
        },
      });
      await db.session.update({
        where: { id: session.id },
        data: { status: "scored", endedAt: new Date() },
      });
      logger.info(
        {
          practice_session_id: sessionId,
          readiness_score: report.overallScore,
          turns: turns.length,
          committee_size: members.length,
          deal_outcome: outcome,
          model,
        },
        "practice session scored",
      );
      return Response.json({ scorecardId: scorecard.id, sessionId });
    } catch (err) {
      // A concurrent request already scored this session: return that scorecard.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await db.scorecard.findUniqueOrThrow({ where: { sessionId } });
        return Response.json({ scorecardId: winner.id, sessionId });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
