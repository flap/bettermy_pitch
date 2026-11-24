// Buying committee: pure helpers shared by the API, the agents and the UI.
import { PERSONAS } from "./catalog";
import type { BuyerAction } from "./schemas";

/** Max colleagues who can join the primary persona (committee of up to 3 buyers). */
export const MAX_COLLEAGUES = 2;

/** What a buyer remembers about this seller from earlier scored sessions. */
export type Memory = {
  sessions: number;
  lastInterest: number;
  lastTrust: number;
  lastReason: string;
  lastVote: string | null;
  weakSpot: string | null;
};

export type Member = {
  id: string;
  name: string;
  title: string;
  brief: string;
  emoji: string;
  /** Built-in persona id, used to recall memories across sessions. */
  personaId?: string;
  memory?: Memory | null;
};

/** How the committee adapts to the seller's performance in a round. */
export const ADAPTATIONS = ["steady", "raise_bar", "interrupt", "ease_off"] as const;
export type Adaptation = (typeof ADAPTATIONS)[number];

/** A member's latest visible state, as shown in the meeting room. */
export type MemberState = {
  memberId: string;
  interest: number;
  trust: number;
  action: BuyerAction;
  addressedTo: string;
  reasoning: string;
  /** Private note to colleagues. */
  whisper: string;
  adaptation: Adaptation;
};

/** One entry of the decision log (a member's move in one round). */
export type DecisionEntry = MemberState & {
  id: string;
  round: number;
  messageId: string | null;
  createdAt: string;
};

export function personaEmoji(id: string) {
  return PERSONAS.find((p) => p.id === id)?.emoji ?? "🙂";
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Committee members of a session. Sessions created before committees existed
 * have an empty `members` column; they get a single member from the persona fields.
 */
export function sessionMembers(session: {
  members: string;
  personaId: string;
  personaName: string;
  personaBrief: string;
  title: string;
}): Member[] {
  try {
    const parsed = JSON.parse(session.members) as Member[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through to the legacy single-buyer shape
  }
  return [
    {
      id: session.personaId,
      name: session.personaName,
      title: session.title.split(" · ")[0],
      brief: session.personaBrief,
      emoji: personaEmoji(session.personaId),
    },
  ];
}

/**
 * Starting interest/trust, before the seller has said anything. A buyer who
 * met this seller before starts with trust nudged towards how the last
 * meeting ended (at most ±10).
 */
export function initialState(memberId: string, difficulty: string, memory?: Memory | null): MemberState {
  const [interest, trust] =
    difficulty === "cooperative" ? [60, 55] : difficulty === "hostile" ? [30, 25] : [45, 40];
  const nudge = memory ? Math.max(-10, Math.min(10, Math.round((memory.lastTrust - 50) / 3))) : 0;
  return {
    memberId,
    interest,
    trust: Math.max(0, Math.min(100, trust + nudge)),
    action: "neutral",
    addressedTo: "seller",
    reasoning: "",
    whisper: "",
    adaptation: "steady",
  };
}

/** Words above which a seller turn counts as rambling. */
export const RAMBLE_WORDS = 120;

/**
 * Decide how the committee adapts this round, from the seller's last line and
 * the members' current state:
 * - interrupt: the seller is rambling;
 * - raise_bar: the seller is doing well, so ask harder questions;
 * - ease_off: the seller is struggling, so give one clear opening to recover;
 * - steady: otherwise.
 */
export function roomAdaptation(
  members: Member[],
  states: Record<string, MemberState>,
  sellerText?: string,
): Adaptation {
  if (!sellerText) return "steady";
  if (sellerText.trim().split(/\s+/).length > RAMBLE_WORDS) return "interrupt";
  const present = members.filter((m) => !hasLeft(states[m.id]));
  if (present.length === 0) return "steady";
  const avg = (k: "interest" | "trust") => present.reduce((sum, m) => sum + states[m.id][k], 0) / present.length;
  if (avg("interest") >= 62 && avg("trust") >= 55) return "raise_bar";
  if (avg("interest") < 30 || avg("trust") < 25) return "ease_off";
  return "steady";
}

/** Largest interest/trust change allowed in a single round, to keep meters believable. */
export const MAX_SWING = 25;

export function clampSwing(previous: number, next: number) {
  const bounded = Math.min(100, Math.max(0, Math.round(next)));
  return Math.min(previous + MAX_SWING, Math.max(previous - MAX_SWING, bounded));
}

/** Latest state per member, starting from the difficulty defaults. */
export function currentStates(
  members: Member[],
  difficulty: string,
  decisions: MemberState[],
): Record<string, MemberState> {
  const states: Record<string, MemberState> = {};
  for (const m of members) states[m.id] = initialState(m.id, difficulty, m.memory);
  for (const d of decisions) {
    if (!states[d.memberId]) continue;
    const { memberId, interest, trust, action, addressedTo, reasoning, whisper, adaptation } = d;
    states[d.memberId] = { memberId, interest, trust, action, addressedTo, reasoning, whisper, adaptation };
  }
  return states;
}

export function hasLeft(state: MemberState | undefined) {
  return state?.action === "leaves_meeting";
}

/**
 * Speaking order for a round: whoever the seller addressed by first name goes
 * first; everyone else keeps the committee order. Members who left are skipped.
 */
export function speakingOrder(members: Member[], states: Record<string, MemberState>, sellerText?: string) {
  const present = members.filter((m) => !hasLeft(states[m.id]));
  if (!sellerText) return present;
  const text = sellerText.toLowerCase();
  // Letter-aware word boundaries, so accented names like "Tomás" match too.
  const mentions = (name: string) =>
    new RegExp(`(^|[^\\p{L}])${escapeRegExp(name.toLowerCase())}($|[^\\p{L}])`, "u").test(text);
  const addressed = present.find((m) => mentions(firstName(m.name)));
  return addressed ? [addressed, ...present.filter((m) => m !== addressed)] : present;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decisions in order, each with the member's interest/trust before it. */
export function withDeltas<D extends Pick<MemberState, "memberId" | "interest" | "trust">>(
  members: Member[],
  difficulty: string,
  decisions: D[],
): (D & { prevInterest: number; prevTrust: number })[] {
  const last: Record<string, { interest: number; trust: number }> = {};
  for (const m of members) last[m.id] = initialState(m.id, difficulty, m.memory);
  return decisions.map((d) => {
    const prev = last[d.memberId] ?? initialState(d.memberId, difficulty);
    last[d.memberId] = { interest: d.interest, trust: d.trust };
    return { ...d, prevInterest: prev.interest, prevTrust: prev.trust };
  });
}

/** Emoji shown next to an avatar for each visible action. */
export const ACTION_ICON: Record<BuyerAction, string> = {
  leans_in: "👀",
  takes_notes: "📝",
  nods: "👍",
  neutral: "👂",
  checks_phone: "📱",
  crosses_arms: "🙅",
  pushes_back: "✋",
  whispers_to_colleague: "🤫",
  ready_to_buy: "🤝",
  leaves_meeting: "🚪",
};

export const ADAPTATION_ICON: Record<Adaptation, string> = {
  steady: "⚖️",
  raise_bar: "📈",
  interrupt: "✋",
  ease_off: "🤲",
};

// ── Committee vote (the session's clear result) ──────────────────

export type Vote = "advance" | "needs_more" | "reject";
export type DealOutcome = "advanced" | "stalled" | "lost";

/** Majority to advance wins the deal, majority to reject loses it, anything else stalls. */
export function dealOutcome(votes: Vote[]): DealOutcome {
  const n = votes.length;
  if (n === 0) return "stalled";
  const advance = votes.filter((v) => v === "advance").length;
  const reject = votes.filter((v) => v === "reject").length;
  if (advance * 2 > n) return "advanced";
  if (reject * 2 > n) return "lost";
  return "stalled";
}
