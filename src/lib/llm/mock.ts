import { MUST_SPEAK } from "../prompts";
import type { BuyerAction, BuyerDecision, CoachHint, CommitteeVote, ScorecardReport } from "../schemas";
import type { LLMProvider } from "./types";

// Offline provider (LLM_PROVIDER="mock"): deterministic canned replies so the
// full UI flow can be explored and tested without an API key. Buyer state
// reacts to simple features of the seller's last line (questions, numbers,
// length) so the meeting room visibly changes.

const BUYER_LINES = [
  "Thanks for making time. I've got about twenty minutes — what problem do you think you solve for us?",
  "We've looked at a couple of tools like this already. What makes yours different, concretely?",
  "That sounds expensive. How would I justify this to my CFO this quarter?",
  "Who else is using this at our scale, and can I talk to them?",
  "How long until my team actually sees value — weeks or months?",
  "Okay. What would a sensible next step look like from your side?",
];

const COLLEAGUE_LINES = [
  "Let me jump in on that: what does the rollout cost us in people's time, not just licences?",
  "I'm not convinced yet. Can you show me a number from a customer like us?",
  "That answers part of it. Who on our side would have to own this day to day?",
];

function mockDecision(system: string, prompt: string): BuyerDecision {
  const name = system.match(/You are (.+?), a real buyer/)?.[1] ?? "Buyer";
  const mustSpeak = prompt.includes(MUST_SPEAK);
  const prior = prompt.match(/interest (\d+)\/100, trust (\d+)\/100/);
  const [interest0, trust0] = prior ? [Number(prior[1]), Number(prior[2])] : [45, 40];
  const sellerLines = [...prompt.matchAll(/^SELLER: (.*)$/gm)].map((m) => m[1]);
  const last = sellerLines[sellerLines.length - 1] ?? "";
  const round = sellerLines.length;

  let dInterest = -3;
  let dTrust = 0;
  const reasons: string[] = [];
  if (!last) reasons.push("Opening the call; waiting to see what the seller brings.");
  if (last.includes("?")) {
    dInterest += 10;
    reasons.push("The seller asked about our situation instead of pitching.");
  }
  if (/\d/.test(last)) {
    dTrust += 8;
    reasons.push("A concrete number made the claim more credible.");
  }
  if (last.length > 350) {
    dInterest -= 12;
    dTrust -= 5;
    reasons.push("Long monologue; I lost the thread.");
  }
  if (last && reasons.length === 0) reasons.push("Generic answer, nothing specific to us.");

  const interest = Math.min(100, Math.max(0, interest0 + (last ? dInterest : 0)));
  const trust = Math.min(100, Math.max(0, trust0 + (last ? dTrust : 0)));
  const action: BuyerAction = !last
    ? "neutral"
    : interest < 12 ? "leaves_meeting" : interest >= 80 ? "ready_to_buy" : interest >= 60 ? "leans_in"
      : dTrust > 0 ? "takes_notes" : interest < 30 ? "checks_phone" : dInterest < 0 ? "crosses_arms" : "nods";
  // Colleagues chime in on alternating rounds so the room feels alive.
  const speaks = mustSpeak || (round + name.length) % 2 === 0;
  const say = !speaks
    ? ""
    : action === "leaves_meeting"
      ? "I'm going to drop off, this isn't a fit for us right now."
      : mustSpeak
        ? BUYER_LINES[round % BUYER_LINES.length]
        : COLLEAGUE_LINES[round % COLLEAGUE_LINES.length];
  const whisper =
    last && !last.includes("?") ? "No discovery questions yet. Let's make them earn the demo." : /\d/.test(last) ? "That number is checkable. Ask for a reference." : "";
  return { say, addressedTo: "seller", action, interest, trust, reasoning: reasons.join(" "), whisper };
}

function mockVote(prompt: string): CommitteeVote {
  const ended = prompt.match(/interest (\d+)\/100 and trust (\d+)\/100/);
  const interest = ended ? Number(ended[1]) : 50;
  const sellerLine = prompt.match(/^SELLER: (.*)$/m)?.[1] ?? "";
  const vote = interest >= 60 ? "advance" : interest >= 35 ? "needs_more" : "reject";
  return {
    vote,
    headline:
      vote === "advance"
        ? "They earned a follow-up: let's book the technical deep dive."
        : vote === "needs_more"
          ? "Interesting, but I still need proof before I take this to the team."
          : "Not for us. I never heard how this solves our problem.",
    objections: [
      { objection: "What makes this different from tools we tried?", handled: Boolean(sellerLine), quote: sellerLine.slice(0, 80) },
      { objection: "How do we justify the cost this quarter?", handled: false, quote: "" },
    ],
  };
}

export function mockProvider(): LLMProvider {
  return {
    name: "mock",
    model: () => "mock",
    async chat({ messages }) {
      const buyerTurns = messages.filter((m) => m.role === "assistant").length;
      return BUYER_LINES[buyerTurns % BUYER_LINES.length];
    },
    async json({ schemaName, prompt, system }) {
      if (schemaName === "buyer_decision") return JSON.stringify(mockDecision(system, prompt));
      if (schemaName === "committee_vote") return JSON.stringify(mockVote(prompt));
      if (schemaName === "coach_hint") {
        const hint: CoachHint = {
          signal: "Testing differentiation and ROI before committing time",
          tips: [
            "Ask what they evaluated before and why it failed before pitching features.",
            "Anchor on time-to-value with one quantified customer outcome.",
          ],
        };
        return JSON.stringify(hint);
      }
      const sellerQuote =
        prompt.match(/SELLER: (.+)/)?.[1]?.slice(0, 160) ?? "(no seller turns yet)";
      const report: ScorecardReport = {
        overallScore: 68,
        verdict: "Solid opener, but discovery was shallow and value stayed generic (mock evaluation).",
        categories: {
          discoveryDepth: { score: 55, rationale: "Few open questions about pain, impact or decision process." },
          objectionHandling: { score: 70, rationale: "Acknowledged objections but rarely confirmed they were resolved." },
          valueArticulation: { score: 65, rationale: "Talked features more than quantified outcomes." },
          concisenessPacing: { score: 80, rationale: "Answers were short and the buyer had room to talk." },
        },
        frameworkCoverage: [
          { element: "Metrics", covered: false, note: "No success metric agreed." },
          { element: "Identify pain", covered: true, note: "Main pain surfaced briefly." },
        ],
        keyMoments: [
          { type: "strength", quote: sellerQuote, speaker: "seller", insight: "Clear, confident opening." },
          {
            type: "missed_opportunity",
            quote: BUYER_LINES[2],
            speaker: "buyer",
            insight: "Price objection was a chance to quantify the cost of doing nothing.",
          },
        ],
        rewrites: [
          {
            original: sellerQuote,
            improved:
              "Before I show anything — what's this costing you today, in hours or revenue? That tells me which 5 minutes of the demo matter.",
            why: "Leads with discovery and earns the right to demo.",
          },
        ],
        nextDrills: [
          "Run the same persona and ask three implication questions before demoing.",
          "Practice a 30-second ROI answer with one customer number.",
        ],
      };
      return JSON.stringify(report);
    },
  };
}
