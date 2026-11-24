"use client";

import { ACTION_ICON, type DealOutcome, type Member, type MemberState } from "@/lib/committee";
import { useI18n } from "@/lib/i18n/client";
import { intlLocale, type Dictionary } from "@/lib/i18n/dictionaries";
import { CATEGORY_KEYS, type ScorecardReport } from "@/lib/schemas";
import { cn, scoreTone } from "@/lib/utils";
import { Check, CircleAlert, CircleCheck, Lightbulb, RotateCcw, ThumbsUp, TriangleAlert, Users, X } from "lucide-react";
import Link from "next/link";
import { Badge, Card, ScoreBar, SectionTitle } from "./ui";

type Meta = {
  sessionTitle: string;
  personaName: string;
  difficulty: string;
  framework: string;
  createdAt: string;
  model: string;
  turns: number;
};

type Verdict = {
  outcome: DealOutcome;
  votes: {
    memberId: string;
    member: Member | null;
    vote: "advance" | "needs_more" | "reject";
    headline: string;
    objections: { objection: string; handled: boolean; quote: string; lineId: string | null }[];
  }[];
} | null;

const OUTCOME_STYLE: Record<DealOutcome, { icon: string; tone: string }> = {
  advanced: { icon: "🤝", tone: "border-good/40 bg-good/5 text-good" },
  stalled: { icon: "⏸️", tone: "border-warn/40 bg-warn/5 text-warn" },
  lost: { icon: "🚪", tone: "border-bad/40 bg-bad/5 text-bad" },
};

const VOTE_TONE = { advance: "bg-good/15 text-good", needs_more: "bg-warn/15 text-warn", reject: "bg-bad/15 text-bad" };

type CommitteeOutcome = { member: Member; start: MemberState; end: MemberState }[];

/** Message ids each quote was found in (null = not found in the transcript). */
type Evidence = { moments: (string | null)[]; rewrites: (string | null)[] };

/** Open the transcript and jump to a quoted line. */
function showLine(id: string) {
  const details = document.getElementById("transcript") as HTMLDetailsElement | null;
  if (details) details.open = true;
  const line = document.getElementById(`msg-${id}`);
  line?.scrollIntoView({ behavior: "smooth", block: "center" });
  line?.classList.add("bg-accent-soft");
  setTimeout(() => line?.classList.remove("bg-accent-soft"), 2000);
}

function readinessLabel(score: number, t: Dictionary) {
  if (score >= 90) return t.scorecard.readiness.exceptional;
  if (score >= 75) return t.scorecard.readiness.ready;
  if (score >= 60) return t.scorecard.readiness.polish;
  return t.scorecard.readiness.notReady;
}

export function ScorecardView({
  report,
  meta,
  transcript,
  evidence,
  committee,
  verdict,
}: {
  report: ScorecardReport;
  meta: Meta;
  transcript: { id: string; role: string; speaker: string | null; content: string }[];
  evidence: Evidence;
  committee: CommitteeOutcome;
  verdict: Verdict;
}) {
  const { locale, t } = useI18n();
  const frameworkName = t.frameworks[meta.framework as keyof typeof t.frameworks]?.label ?? meta.framework;
  const moments = report.keyMoments.map((m, i) => ({ ...m, lineId: evidence.moments[i] ?? null }));
  const strengths = moments.filter((m) => m.type === "strength");
  const misses = moments.filter((m) => m.type === "missed_opportunity");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted">
            {t.scorecard.scorecard} · {new Date(meta.createdAt).toLocaleString(intlLocale(locale))} · {meta.turns} {t.scorecard.turns}
          </div>
          <h1 className="text-2xl font-semibold">
            {meta.sessionTitle.split(" · ")[0]} · {frameworkName}
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{meta.personaName}</Badge>
            <Badge>{t.difficulties[meta.difficulty as keyof typeof t.difficulties]?.label ?? meta.difficulty}</Badge>
            <Badge>{frameworkName}</Badge>
          </div>
        </div>
        <Link
          href="/#new"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90"
        >
          <RotateCcw className="size-4" /> {t.scorecard.practiceAgain}
        </Link>
      </div>

      {verdict && (
        <section className={cn("space-y-4 rounded-2xl border p-5", OUTCOME_STYLE[verdict.outcome].tone)}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-bold">
              <span aria-hidden>{OUTCOME_STYLE[verdict.outcome].icon}</span> {t.verdict[verdict.outcome]}
            </h2>
            <div className="text-sm font-medium">
              {verdict.votes.filter((v) => v.vote === "advance").length} {t.verdict.of} {verdict.votes.length}{" "}
              {t.verdict.votedForward}
            </div>
          </div>
          <div className="grid gap-3 text-foreground md:grid-cols-3">
            {verdict.votes.map((v) => (
              <div key={v.memberId} className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {v.member?.emoji} {v.member?.name ?? v.memberId}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", VOTE_TONE[v.vote])}>
                    {t.verdict.votes[v.vote]}
                  </span>
                </div>
                <p className="italic">“{v.headline}”</p>
                <ul className="space-y-2">
                  {v.objections.map((o, i) => (
                    <li key={i} className="text-xs">
                      <div className="flex gap-1.5">
                        {o.handled ? (
                          <Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-label={t.verdict.handled} />
                        ) : (
                          <X className="mt-0.5 size-3.5 shrink-0 text-bad" aria-label={t.verdict.notHandled} />
                        )}
                        <span className="font-medium">{o.objection}</span>
                      </div>
                      {o.quote.trim() ? (
                        <div className="ml-5 text-muted">
                          “{o.quote}” <EvidenceTag lineId={o.lineId} />
                        </div>
                      ) : (
                        <div className="ml-5 text-muted">{t.verdict.neverAddressed}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="flex flex-col items-center justify-center gap-2 text-center">
          <SectionTitle>{t.scorecard.overall}</SectionTitle>
          <div className={cn("text-7xl font-bold tabular-nums", scoreTone(report.overallScore))}>
            {report.overallScore}
          </div>
          <div className="font-medium">{readinessLabel(report.overallScore, t)}</div>
          <p className="text-sm text-muted">{report.verdict}</p>
        </Card>

        <Card className="space-y-4">
          <SectionTitle>{t.scorecard.breakdown}</SectionTitle>
          {CATEGORY_KEYS.map((key) => {
            const c = report.categories[key];
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{t.scorecard.categories[key]}</span>
                  <span className={cn("font-semibold tabular-nums", scoreTone(c.score))}>{c.score}</span>
                </div>
                <ScoreBar score={c.score} />
                <p className="text-xs text-muted">{c.rationale}</p>
              </div>
            );
          })}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <SectionTitle className="flex items-center gap-2">
            <ThumbsUp className="size-4 text-good" /> {t.scorecard.worked}
          </SectionTitle>
          {strengths.length === 0 && <p className="text-sm text-muted">{t.scorecard.noStrengths}</p>}
          {strengths.map((m, i) => (
            <Moment key={i} quote={m.quote} speaker={t.scorecard[m.speaker]} insight={m.insight} tone="good" lineId={m.lineId} />
          ))}
        </Card>
        <Card className="space-y-3">
          <SectionTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-warn" /> {t.scorecard.missed}
          </SectionTitle>
          {misses.length === 0 && <p className="text-sm text-muted">{t.scorecard.noMisses}</p>}
          {misses.map((m, i) => (
            <Moment key={i} quote={m.quote} speaker={t.scorecard[m.speaker]} insight={m.insight} tone="warn" lineId={m.lineId} />
          ))}
        </Card>
      </div>

      {committee.length > 0 && (
        <Card className="space-y-3">
          <SectionTitle className="flex items-center gap-2">
            <Users className="size-4 text-accent" /> {t.scorecard.committee}
          </SectionTitle>
          <p className="text-xs text-muted">{t.scorecard.committeeHint}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {committee.map(({ member, start, end }) => (
              <div key={member.id} className="space-y-1.5 rounded-xl border border-border p-3 text-sm">
                <div className="font-semibold">
                  {member.emoji} {member.name}
                </div>
                <div className="text-xs text-muted">
                  {ACTION_ICON[end.action]} {t.actions[end.action]}
                </div>
                <div className="flex gap-3 text-xs tabular-nums">
                  <span>
                    {t.room.interest} {start.interest}→<b className={scoreTone(end.interest)}>{end.interest}</b>
                  </span>
                  <span>
                    {t.room.trust} {start.trust}→<b className={scoreTone(end.trust)}>{end.trust}</b>
                  </span>
                </div>
                {end.reasoning && <p className="text-xs italic">“{end.reasoning}”</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="space-y-4">
        <SectionTitle>{t.scorecard.rewrites}</SectionTitle>
        {report.rewrites.map((r, i) => (
          <div key={i} className="space-y-2">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-bad/30 bg-bad/5 p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-bad">{t.scorecard.youSaid}</div>
                <p className="text-sm">“{r.original}”</p>
                <EvidenceTag lineId={evidence.rewrites[i] ?? null} />
              </div>
              <div className="rounded-xl border border-good/30 bg-good/5 p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-good">{t.scorecard.executive}</div>
                <p className="text-sm">“{r.improved}”</p>
              </div>
            </div>
            <p className="text-xs text-muted">{t.scorecard.why}: {r.why}</p>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <SectionTitle>
            {frameworkName} · {t.scorecard.coverage}
          </SectionTitle>
          <ul className="space-y-2">
            {report.frameworkCoverage.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                {f.covered ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-good" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-bad" />
                )}
                <span>
                  <span className="font-medium">{f.element}</span>
                  <span className="text-muted"> — {f.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-3">
          <SectionTitle className="flex items-center gap-2">
            <Lightbulb className="size-4 text-accent" /> {t.scorecard.drills}
          </SectionTitle>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {report.nextDrills.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ol>
        </Card>
      </div>

      <details id="transcript" className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">{t.scorecard.transcript}</summary>
        <div className="mt-4 space-y-2 text-sm">
          {transcript.map((m) => (
            <p key={m.id} id={`msg-${m.id}`} className="scroll-mt-24 rounded transition-colors">
              <span className={cn("font-semibold", m.role === "seller" ? "text-accent" : "text-muted")}>
                {m.role === "seller" ? t.scorecard.you : (m.speaker ?? meta.personaName)}:
              </span>{" "}
              {m.content}
            </p>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">{t.scorecard.scoredBy} {meta.model}</p>
      </details>
    </div>
  );
}

function Moment({
  quote,
  speaker,
  insight,
  tone,
  lineId,
}: {
  quote: string;
  speaker: string;
  insight: string;
  tone: "good" | "warn";
  lineId: string | null;
}) {
  return (
    <figure className={cn("border-l-2 pl-3", tone === "good" ? "border-good" : "border-warn")}>
      <blockquote className="text-sm italic">“{quote}”</blockquote>
      <figcaption className="mt-1 text-xs text-muted">
        <span className="font-medium uppercase">{speaker}</span> · {insight}
      </figcaption>
      <EvidenceTag lineId={lineId} />
    </figure>
  );
}

/** Shows whether a cited quote was found in the transcript, and links to it. */
function EvidenceTag({ lineId }: { lineId: string | null }) {
  const { t } = useI18n();
  if (!lineId) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-warn">
        <CircleAlert className="size-3.5" /> {t.scorecard.unverified}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => showLine(lineId)}
      className="mt-1 inline-flex items-center gap-1 text-xs text-good hover:underline"
    >
      <CircleCheck className="size-3.5" /> {t.scorecard.verified}
    </button>
  );
}
