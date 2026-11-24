import { describe, expect, it } from "vitest";
import { committeeRound } from "@/lib/agents";
import { initialState, MAX_SWING } from "@/lib/committee";
import type { LLMProvider } from "@/lib/llm/types";
import { buyerSystemPrompt, evaluatorSystemPrompt, formatTranscript, MUST_SPEAK } from "@/lib/prompts";

const ctx = {
  product: "Acme Observability",
  personaName: "Dana Reyes",
  personaBrief: "Skeptical VP of Engineering.",
  difficulty: "hostile",
  framework: "custom",
  customFlow: "1. Agenda 2. Live demo 3. Pricing",
  language: "pt",
};

describe("prompts", () => {
  it("buyer prompt keeps the persona in character and in the chosen language", () => {
    const p = buyerSystemPrompt(ctx);
    expect(p).toContain("Never break character");
    expect(p).toContain("Dana Reyes");
    expect(p).toContain("Português");
    expect(p).toContain("competitor");
  });

  it("evaluator prompt includes the custom demo flow", () => {
    expect(evaluatorSystemPrompt(ctx)).toContain("2. Live demo");
  });

  it("formats the transcript with speaker labels", () => {
    expect(formatTranscript([{ role: "seller", content: "Hi" }, { role: "buyer", content: "Hello" }], ctx)).toBe(
      "SELLER: Hi\nBUYER (Dana Reyes): Hello",
    );
  });
});

describe("committeeRound", () => {
  const members = [
    { id: "primary", name: "Dana Reyes", title: "VP Eng", brief: "Skeptical.", emoji: "🛠" },
    { id: "colleague-1", name: "Tomás Alvarez", title: "Security", brief: "Blocks hand-wavy answers.", emoji: "🔐" },
  ];
  const states = {
    primary: initialState("primary", "skeptical"),
    "colleague-1": initialState("colleague-1", "skeptical"),
  };

  function fakeProvider(replies: object[]): LLMProvider & { prompts: string[] } {
    const prompts: string[] = [];
    return {
      name: "fake",
      prompts,
      model: () => "fake",
      chat: async () => "",
      json: async ({ prompt }) => {
        prompts.push(prompt);
        return JSON.stringify(replies.shift());
      },
    };
  }

  it("lets the addressed member answer first, shares the round and clamps state swings", async () => {
    const p = fakeProvider([
      { say: "SOC 2 first, please.", addressedTo: "seller", action: "pushes_back", interest: 0, trust: 40, reasoning: "Vague.", whisper: "Push on pricing." },
      { say: "", addressedTo: "Tomás", action: "nods", interest: 50, trust: 45, reasoning: "Fair point.", whisper: "" },
    ]);
    const results = await committeeRound({
      ctx,
      members,
      states,
      turns: [{ role: "seller", content: "Tomás, how do you review vendors?" }],
      sellerText: "Tomás, how do you review vendors?",
      provider: p,
    });
    expect(results.map((r) => r.member.id)).toEqual(["colleague-1", "primary"]);
    expect(p.prompts[0]).toContain(MUST_SPEAK);
    expect(p.prompts[1]).not.toContain(MUST_SPEAK);
    // The second member sees what the first one said in the same round.
    expect(p.prompts[1]).toContain("SOC 2 first, please.");
    // ...and the private note they whispered.
    expect(p.prompts[1]).toContain("Push on pricing.");
    // 45 → 0 is clamped to the maximum swing.
    expect(results[0].decision.interest).toBe(45 - MAX_SWING);
    expect(results[1].decision.say).toBe("");
    expect(results[1].decision.addressedTo).toBe("Tomás");
  });
});
