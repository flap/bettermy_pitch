// The agents: the buying committee (one buyer agent per member), the Live
// Coach (hints) and the Evaluator (scorecard).
import { clampSwing, firstName, hasLeft, speakingOrder, type Adaptation, type Member, type MemberState } from "./committee";
import { generateObject, getProvider, type LLMProvider } from "./llm";
import { submitScores, traceAgent } from "./observability";

// Reasoning models (e.g. free OpenRouter models) spend part of the budget
// "thinking" before answering, so the limits are generous and configurable.
// Reply length is controlled by the prompts, not by these caps.
const CHAT_MAX_TOKENS = Number(process.env.LLM_CHAT_MAX_TOKENS) || 4000;
const EVAL_MAX_TOKENS = Number(process.env.LLM_EVAL_MAX_TOKENS) || 16000;
import {
  buyerRoundPrompt,
  buyerSystemPrompt,
  coachSystemPrompt,
  committeeStateLines,
  evaluatorSystemPrompt,
  formatTranscript,
  votePrompt,
  type SessionContext,
  type Turn,
} from "./prompts";
import { BuyerDecision, CoachHint, CommitteeVote, ScorecardReport } from "./schemas";

export type RoundResult = { member: Member; decision: BuyerDecision };

const FALLBACK_LINE = "Sorry, could you say that again?";

function sessionTags(ctx: SessionContext) {
  return {
    persona: ctx.personaName,
    difficulty: ctx.difficulty,
    framework: ctx.framework,
    language: ctx.language,
  };
}

/**
 * One round of the meeting. Members decide one after another, so each sees
 * what colleagues said earlier in the same round and can react to it. The
 * first member in speaking order must answer; the others may stay silent.
 * Each member's decision is its own `bmp.buyer` LLM Observability span.
 */
export async function committeeRound(args: {
  ctx: SessionContext;
  members: Member[];
  states: Record<string, MemberState>;
  turns: Turn[];
  sellerText?: string;
  adaptation?: Adaptation;
  provider?: LLMProvider;
}): Promise<RoundResult[]> {
  const { ctx, members, sellerText, provider, adaptation = "steady" } = args;
  const states = { ...args.states };
  const turns = [...args.turns];
  const order = speakingOrder(members, states, sellerText);
  const opening = turns.length === 0;
  const results: RoundResult[] = [];

  for (const [i, member] of order.entries()) {
    const colleagues = members.filter((m) => m.id !== member.id);
    const raw = await traceAgent(
      "buyer",
      {
        sessionId: ctx.id ?? "unknown",
        input: sellerText ?? "(opening)",
        tags: { ...sessionTags(ctx), member: member.name, member_title: member.title },
      },
      () =>
        generateObject({
          provider,
          system: buyerSystemPrompt(ctx, member, colleagues),
          prompt: buyerRoundPrompt({
            ctx,
            member,
            turns,
            self: states[member.id],
            colleagues: colleagues.map((c) => ({ member: c, state: states[c.id] })),
            opening,
            mustSpeak: i === 0,
            adaptation,
          }),
          schema: BuyerDecision,
          schemaName: "buyer_decision",
          tier: "chat",
          maxTokens: CHAT_MAX_TOKENS,
        }),
    );

    const previous = states[member.id];
    const colleagueNames = colleagues.map((c) => firstName(c.name).toLowerCase());
    const say = raw.say.trim() || (i === 0 ? FALLBACK_LINE : "");
    const decision: BuyerDecision = {
      ...raw,
      say,
      addressedTo: colleagueNames.includes(raw.addressedTo.trim().toLowerCase()) ? raw.addressedTo.trim() : "seller",
      interest: clampSwing(previous.interest, raw.interest),
      trust: clampSwing(previous.trust, raw.trust),
      whisper: raw.whisper.trim().slice(0, 200),
    };

    states[member.id] = { memberId: member.id, ...decision, adaptation };
    if (say) turns.push({ role: "buyer", content: say, speaker: member.name });
    results.push({ member, decision });
  }
  return results;
}

export async function coachHint(
  ctx: SessionContext,
  turns: Turn[],
  committee?: { members: Member[]; states: Record<string, MemberState> },
  provider?: LLMProvider,
) {
  const lastBuyer = [...turns].reverse().find((t) => t.role === "buyer")?.content ?? "";
  return traceAgent("coach", { sessionId: ctx.id ?? "unknown", input: lastBuyer, tags: sessionTags(ctx) }, () =>
    generateObject({
      provider,
      system: coachSystemPrompt(ctx, committee && committeeStateLines(committee.members, committee.states)),
      prompt: `Conversation so far:\n${formatTranscript(turns.slice(-12), ctx)}\n\nCoach the seller's next reply.`,
      schema: CoachHint,
      schemaName: "coach_hint",
      tier: "chat",
      maxTokens: CHAT_MAX_TOKENS,
    }),
  );
}

export async function evaluateSession(
  ctx: SessionContext,
  turns: Turn[],
  committee?: { members: Member[]; states: Record<string, MemberState> },
  provider?: LLMProvider,
) {
  const p = provider ?? getProvider();
  const tags = sessionTags(ctx);
  const report = await traceAgent(
    "evaluator",
    { sessionId: ctx.id ?? "unknown", input: `${turns.length} turns`, tags },
    () =>
      generateObject({
        provider: p,
        system: evaluatorSystemPrompt(ctx, committee && committeeStateLines(committee.members, committee.states)),
        prompt: `Full transcript:\n${formatTranscript(turns, ctx)}\n\nScore this session.`,
        schema: ScorecardReport,
        schemaName: "scorecard",
        tier: "eval",
        maxTokens: EVAL_MAX_TOKENS,
      }),
    (r, span) =>
      submitScores(
        span,
        {
          readiness_score: r.overallScore,
          discovery_depth: r.categories.discoveryDepth.score,
          objection_handling: r.categories.objectionHandling.score,
          value_articulation: r.categories.valueArticulation.score,
          conciseness_pacing: r.categories.concisenessPacing.score,
        },
        tags,
      ),
  );
  return { report, model: p.model("eval") };
}

export type VoteResult = { member: Member; vote: CommitteeVote };

/**
 * Every committee member votes on the deal when the meeting ends, in parallel.
 * A member who walked out always votes reject.
 */
export async function committeeVotes(args: {
  ctx: SessionContext;
  members: Member[];
  states: Record<string, MemberState>;
  turns: Turn[];
  provider?: LLMProvider;
}): Promise<VoteResult[]> {
  const { ctx, members, states, turns, provider } = args;
  return Promise.all(
    members.map(async (member) => {
      const colleagues = members.filter((m) => m.id !== member.id);
      const raw = await traceAgent(
        "vote",
        { sessionId: ctx.id ?? "unknown", input: `${turns.length} turns`, tags: { ...sessionTags(ctx), member: member.name } },
        () =>
          generateObject({
            provider,
            system: buyerSystemPrompt(ctx, member, colleagues),
            prompt: votePrompt(ctx, member, turns, states[member.id]),
            schema: CommitteeVote,
            schemaName: "committee_vote",
            tier: "chat",
            maxTokens: CHAT_MAX_TOKENS,
          }),
      );
      const vote: CommitteeVote = hasLeft(states[member.id]) ? { ...raw, vote: "reject" } : raw;
      return { member, vote };
    }),
  );
}
