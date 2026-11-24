// Records the BetterMy Pitch demo video (docs/demo/bettermy-pitch-demo.mp4).
//
//   npm i --no-save playwright && npx playwright install chromium
//   npm run build && npm start            # in another terminal; any LLM_PROVIDER
//   node scripts/record-demo.mjs http://localhost:3000 ./demo-out
//
// Playwright writes a .webm into <outDir>; convert it with
//   ffmpeg -i demo-out/*.webm -c:v libx264 -crf 26 -pix_fmt yuv420p -movflags +faststart -an demo.mp4
// It first scores one quick session through the API, so the recorded buyers
// show the "Remembers you" badge, then records the walkthrough. Both sessions
// land in whatever database the server uses. Each step waits for the round's
// decisions to arrive, so a real model works as well as the mock provider.
import { chromium } from "playwright";

const [base, out] = process.argv.slice(2);
const W = 1280;
const H = 800;
const J = { "Content-Type": "application/json" };
const post = (u, b) => fetch(base + u, { method: "POST", headers: J, body: JSON.stringify(b) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRODUCT =
  "Acme Observability: one place for logs, metrics and traces. Cuts incident time in half for SRE teams. SOC 2 Type II, SSO/SCIM, EU data residency. $40k/year for 100 engineers.";
const COMMITTEE = {
  personaId: "vp-engineering",
  personaName: "Dana Reyes",
  personaTitle: "Skeptical VP of Engineering",
  personaBrief: "Runs a 120-person engineering org. Burned by tools that created migration work.",
  colleagues: [
    { id: "cfo", name: "Marcus Chen", title: "Budget-Conscious CFO", brief: "Budget was cut 15 percent." },
    { id: "security-lead", name: "Tomás Alvarez", title: "Enterprise Security Lead", brief: "Blocks vague security answers." },
  ],
  difficulty: "skeptical",
  framework: "meddic",
  language: "en",
};

// 1. An earlier practice session, so the committee remembers this seller.
{
  const s = await post("/api/sessions", { product: PRODUCT, ...COMMITTEE });
  await post("/api/roleplay", { sessionId: s.id });
  await post("/api/roleplay", { sessionId: s.id, message: "We have dashboards, alerts and lots of integrations." });
  await post("/api/evaluate", { sessionId: s.id });
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: out, size: { width: W, height: H } },
});
await ctx.addInitScript(() => localStorage.setItem("bmp-room-view", "3d"));
const page = await ctx.newPage();

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:900px;" +
        "background:rgba(20,20,31,.88);color:#fff;font:600 20px/1.35 system-ui,sans-serif;padding:12px 22px;" +
        "border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center;transition:opacity .3s";
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.opacity = t ? "1" : "0";
  }, text);
}

async function card(title, lines, ms) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#5b4cf0,#0f766e);font-family:system-ui,sans-serif;color:#fff">
    <div style="max-width:980px;padding:40px">
      <div style="font-size:54px;font-weight:800;letter-spacing:-1px">${title}</div>
      ${lines.map((l) => `<div style="font-size:26px;margin-top:18px;opacity:.95">${l}</div>`).join("")}
    </div></body></html>`);
  await sleep(ms);
}

async function scroll(total, steps = 20, pause = 60) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, total / steps);
    await sleep(pause);
  }
}

async function say(text, { type = true } = {}) {
  const box = page.getByPlaceholder(/Your reply to the buyer/);
  await box.click();
  if (type) await box.pressSequentially(text, { delay: 18 });
  else await box.fill(text);
  await sleep(500);
  const count = () => Number(document.body.innerText.match(/Decision log \((\d+)\)/)?.[1] ?? 0);
  const before = await page.evaluate(count);
  await box.press("Enter");
  // Wait until the committee's decisions for this round have arrived.
  await page.waitForFunction(
    (n) => Number(document.body.innerText.match(/Decision log \((\d+)\)/)?.[1] ?? 0) > n,
    before,
    { timeout: 30000 },
  );
}

// 2. Title card
await card(
  "🎤 BetterMy Pitch",
  ["Rehearse your pitch against an AI buying committee that thinks, reacts, coordinates and decides.", "Multiplayer AI Hackathon · Track 03: Grow with Agents"],
  4500,
);

// 3. Configure the session
await page.goto(base + "/");
await caption("Describe what you're pitching. Two colleagues join the main buyer by default: a 3-agent committee.");
await sleep(1200);
await page.locator("textarea").first().pressSequentially(PRODUCT, { delay: 8 });
await sleep(600);
await scroll(520, 14, 70);
await sleep(1800);
await scroll(520, 14, 70);
await sleep(1200);
await caption("");
await page.getByRole("button", { name: /Start practice session/ }).click();

// 4. The meeting
await page.waitForURL(/\/session\//);
await page.waitForFunction(() => document.body.innerText.includes("Thanks for making time"), null, { timeout: 30000 });
await caption("Each buyer is its own agent with its own goals. 🧠 = they remember your last meeting.");
await sleep(4500);
await caption("Say a buyer's name and they answer first. Colleagues hear each other and react.");
await say("Thanks all. Before I demo anything: Tomás, how do you review new vendors today, and what slowed the last one down?");
await sleep(1500);
await caption("Every decision is acted out: posture, interest and trust meters, who they're talking to.");
await sleep(4500);
await caption("The live coach reads the buyers' private state and whispers your next move.");
await sleep(4000);

await caption("Ramble, and the committee adapts: they cut in, cross their arms or reach for their phones.");
await say(
  "So let me walk you through everything. We have dashboards, alerting, anomaly detection, log search, trace views, service maps, " +
    "SLO tracking, on-call schedules, runbooks, integrations with Slack, Jira, PagerDuty, GitHub, GitLab, AWS, GCP and Azure, " +
    "a mobile app, custom reports, role-based access, audit logs, a query language, saved views, annotations, and a public API. " +
    "We also have AI summaries for incidents, automatic grouping of alerts, cost dashboards for your cloud spend, synthetic checks, " +
    "real user monitoring, profiling, and a marketplace of community plugins that cover most of the tools your teams already use every day " +
    "across development, staging and production, and we are adding new features every single month based on customer feedback from all over the world.",
  { type: false },
);
await sleep(5500);

await caption("Recover with something concrete: a number and a sharp question.");
await say("Short version: a bank your size cut incident time 40% in 90 days. Marcus, what does an hour of downtime cost you?");
await sleep(5000);

// 5. Decision log
await caption("The decision log: every buyer's move, why they made it, and their private whispers to each other.");
await page.getByRole("tab", { name: /Decision log/ }).click();
await sleep(2500);
await page.mouse.move(1000, 500);
await scroll(700, 20, 90);
await sleep(2500);

await caption("Prefer flat? Switch the room to 2D.");
await page.getByRole("button", { name: "2d" }).click();
await sleep(3000);
await page.getByRole("button", { name: "3d" }).click();
await sleep(1500);

// 6. Verdict and scorecard
await caption("End the meeting: every buyer votes on the deal while the evaluator scores you.");
await page.getByRole("button", { name: /End & Score Session/ }).click();
await page.waitForURL(/\/scorecard\//, { timeout: 60000 });
await sleep(1000);
await caption("A clear result: the majority decides. Each objection is tied to what you actually said.");
await sleep(5000);
await scroll(520, 16, 80);
await caption("Evidence, not vibes: every quote is checked against the transcript.");
await sleep(3500);
await scroll(700, 20, 80);
await sleep(2500);
await page.getByRole("button", { name: /Verified in transcript/ }).last().click();
await sleep(3500);
await caption("");

// 7. End card
await card(
  "Built for the Multiplayer AI Hackathon",
  [
    "✅ 3+ agents with their own goals · ✅ 3D characters that act · ✅ decision log",
    "✅ agents coordinate and adapt to you · ✅ clear verdict with evidence",
    "⭐ 3D · ⭐ memory across runs · ⭐ a voice per buyer",
    "<span style='font-size:20px;opacity:.85'>Recorded with the offline mock provider. Plug in OpenRouter, Anthropic or Gemini for live agents.</span>",
  ],
  6500,
);

const video = page.video();
await ctx.close();
await browser.close();
console.log("video:", await video.path());
