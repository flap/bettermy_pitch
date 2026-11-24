import { describe, expect, it } from "vitest";
import { BuyerDecision, CoachHint, CommitteeVote, CreateSessionInput, ScorecardReport } from "@/lib/schemas";
import { mockProvider } from "@/lib/llm/mock";

const validSession = {
  product: "An observability platform that cuts incident time in half",
  personaId: "cfo",
  personaName: "Marcus Chen",
  personaTitle: "Budget-Conscious CFO",
  personaBrief: "Owns a budget that was just cut 15%.",
  difficulty: "skeptical",
  framework: "meddic",
};

describe("CreateSessionInput", () => {
  it("accepts a valid configuration and defaults the language", () => {
    const parsed = CreateSessionInput.parse(validSession);
    expect(parsed.language).toBe("en");
  });

  it("rejects unknown difficulty and framework values", () => {
    expect(CreateSessionInput.safeParse({ ...validSession, difficulty: "nightmare" }).success).toBe(false);
    expect(CreateSessionInput.safeParse({ ...validSession, framework: "bant" }).success).toBe(false);
  });

  it("requires a flow description for the custom framework", () => {
    const res = CreateSessionInput.safeParse({ ...validSession, framework: "custom" });
    expect(res.success).toBe(false);
    expect(
      CreateSessionInput.safeParse({ ...validSession, framework: "custom", customFlow: "1. Agenda 2. Demo 3. Close" })
        .success,
    ).toBe(true);
  });
});

describe("LLM output schemas", () => {
  it("mock provider outputs satisfy the scorecard and coach schemas", async () => {
    const p = mockProvider();
    const card = JSON.parse(await p.json({ system: "", prompt: "SELLER: hi", schema: {}, schemaName: "scorecard", tier: "eval" }));
    expect(ScorecardReport.parse(card).overallScore).toBeGreaterThanOrEqual(0);
    const hint = JSON.parse(await p.json({ system: "", prompt: "", schema: {}, schemaName: "coach_hint", tier: "chat" }));
    expect(CoachHint.parse(hint).tips.length).toBeGreaterThan(0);
    const decision = JSON.parse(
      await p.json({ system: "You are Dana Reyes, a real buyer", prompt: "", schema: {}, schemaName: "buyer_decision", tier: "chat" }),
    );
    expect(BuyerDecision.parse(decision).interest).toBeGreaterThanOrEqual(0);
    const vote = JSON.parse(await p.json({ system: "", prompt: "", schema: {}, schemaName: "committee_vote", tier: "chat" }));
    expect(CommitteeVote.parse(vote).objections.length).toBeGreaterThan(0);
  });

  it("rejects out-of-range scores", () => {
    const res = CoachHint.safeParse({ signal: "x", tips: ["a", "b", "c"] });
    expect(res.success).toBe(false);
  });
});
