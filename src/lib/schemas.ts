import { z } from "zod";
import { DIFFICULTY_IDS, FRAMEWORK_IDS, LANGUAGE_IDS } from "./catalog";
import { MAX_COLLEAGUES } from "./committee";

// ── API inputs ───────────────────────────────────────────────────

const ColleagueInput = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  brief: z.string().trim().min(10).max(2000),
});

export const CreateSessionInput = z
  .object({
    product: z.string().trim().min(10, "Describe your product in at least 10 characters").max(6000),
    personaId: z.string().min(1),
    personaName: z.string().trim().min(1).max(80),
    personaTitle: z.string().trim().min(1).max(120),
    personaBrief: z.string().trim().min(10).max(2000),
    colleagues: z.array(ColleagueInput).max(MAX_COLLEAGUES).default([]),
    difficulty: z.enum(DIFFICULTY_IDS),
    framework: z.enum(FRAMEWORK_IDS),
    customFlow: z.string().trim().max(3000).optional(),
    language: z.enum(LANGUAGE_IDS).default("en"),
    saveAsTemplate: z.boolean().optional(),
  })
  .refine((v) => v.framework !== "custom" || (v.customFlow?.length ?? 0) >= 10, {
    message: "Describe your custom demo flow",
    path: ["customFlow"],
  })
  .refine(
    (v) => {
      const names = [v.personaName, ...v.colleagues.map((c) => c.name)].map((n) => n.toLowerCase());
      return new Set(names).size === names.length;
    },
    { message: "Each buyer in the meeting needs a different name", path: ["colleagues"] },
  );
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const RoleplayInput = z.object({
  sessionId: z.string().min(1),
  /** Omit to let the buyer open the meeting. */
  message: z.string().trim().min(1).max(4000).optional(),
});

export const SessionIdInput = z.object({ sessionId: z.string().min(1) });

// ── LLM outputs ──────────────────────────────────────────────────

export const CoachHint = z.object({
  signal: z
    .string()
    .describe("What the buyer is really signalling in their latest turn, max 12 words."),
  tips: z
    .array(z.string())
    .min(1)
    .max(2)
    .describe("1–2 punchy tactical tips for the seller's next reply, max 25 words each."),
});
export type CoachHint = z.infer<typeof CoachHint>;

const score = z.number().int().min(0).max(100);

/** Visible body language. Every decision is rendered as one of these on screen. */
export const BUYER_ACTIONS = [
  "leans_in",
  "takes_notes",
  "nods",
  "neutral",
  "checks_phone",
  "crosses_arms",
  "pushes_back",
  "whispers_to_colleague",
  "ready_to_buy",
  "leaves_meeting",
] as const;
export type BuyerAction = (typeof BUYER_ACTIONS)[number];

/** One committee member's move in a round, produced by the buyer agent. */
export const BuyerDecision = z.object({
  say: z
    .string()
    .describe("What you say out loud now: 1–4 spoken sentences. Use an empty string to stay silent this round."),
  addressedTo: z
    .string()
    .describe('Who you are talking to: "seller", or the first name of the colleague you address.'),
  action: z
    .enum(BUYER_ACTIONS)
    .describe(
      "Your visible body language this round. Use leaves_meeting only if you are done with this vendor; ready_to_buy only if you would agree to a concrete next step now.",
    ),
  interest: score.describe("Your interest in buying after this round, 0–100."),
  trust: score.describe("How much you trust this seller after this round, 0–100."),
  reasoning: z
    .string()
    .describe(
      "Private, one sentence: why you reacted this way, citing what the seller or a colleague just said. Never shown to the seller during the call.",
    ),
  whisper: z
    .string()
    .describe(
      "Private note to your colleagues, max 20 words: a tactic to test the seller, a concern, or a heads-up (e.g. \"He dodged pricing twice, push on it\"). Empty string if nothing to coordinate.",
    ),
});
export type BuyerDecision = z.infer<typeof BuyerDecision>;

/** A committee member's final vote when the meeting ends. */
export const CommitteeVote = z.object({
  vote: z
    .enum(["advance", "needs_more", "reject"])
    .describe("advance = agree to a concrete next step; needs_more = not yet, needs more proof; reject = not buying."),
  headline: z.string().describe("One sentence, in your voice, explaining your vote to your colleagues."),
  objections: z
    .array(
      z.object({
        objection: z.string().describe("A concern you or a colleague raised during the meeting."),
        handled: z.boolean().describe("Did the seller resolve it to your satisfaction?"),
        quote: z
          .string()
          .describe("Exact words from ONE seller line that addressed it (copied verbatim), or empty string if they never did."),
      }),
    )
    .describe("1–4 objections that drove your vote."),
});
export type CommitteeVote = z.infer<typeof CommitteeVote>;

export const CATEGORY_KEYS = [
  "discoveryDepth",
  "objectionHandling",
  "valueArticulation",
  "concisenessPacing",
] as const;

export const CATEGORY_LABELS: Record<(typeof CATEGORY_KEYS)[number], string> = {
  discoveryDepth: "Discovery Depth",
  objectionHandling: "Objection Handling",
  valueArticulation: "Value Articulation",
  concisenessPacing: "Conciseness & Pacing",
};

const Category = z.object({
  score,
  rationale: z.string().describe("One or two sentences grounded in the transcript."),
});

export const ScorecardReport = z.object({
  overallScore: score.describe("Overall readiness score 0–100."),
  verdict: z.string().describe("One-sentence headline verdict on readiness."),
  categories: z.object({
    discoveryDepth: Category,
    objectionHandling: Category,
    valueArticulation: Category,
    concisenessPacing: Category,
  }),
  frameworkCoverage: z
    .array(
      z.object({
        element: z.string().describe("Framework element, e.g. 'Economic buyer' or 'Implication'."),
        covered: z.boolean(),
        note: z.string(),
      }),
    )
    .describe("How well each element of the chosen sales framework was covered."),
  keyMoments: z
    .array(
      z.object({
        type: z.enum(["strength", "missed_opportunity"]),
        quote: z.string().describe("Exact quote from the transcript."),
        speaker: z.enum(["seller", "buyer"]),
        insight: z.string(),
      }),
    )
    .describe("3–6 highlighted moments."),
  rewrites: z
    .array(
      z.object({
        original: z.string().describe("Exact weak seller response from the transcript."),
        improved: z.string().describe("Stronger, executive-ready alternative."),
        why: z.string(),
      }),
    )
    .describe("2–4 side-by-side rewrites of the seller's weakest replies."),
  nextDrills: z.array(z.string()).describe("2–3 concrete drills for the next practice session."),
});
export type ScorecardReport = z.infer<typeof ScorecardReport>;
