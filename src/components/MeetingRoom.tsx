"use client";

import {
  ACTION_ICON,
  ADAPTATION_ICON,
  currentStates,
  firstName,
  hasLeft,
  withDeltas,
  type DecisionEntry,
  type Member,
  type MemberState,
} from "@/lib/committee";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Brain, DoorOpen, Handshake, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { ChatMessage } from "./ChatArena";

// three.js is only loaded in the browser, and only when the 3D view is shown.
const Room3D = dynamic(() => import("./Room3D").then((m) => m.Room3D), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-accent-soft/40" />,
});

// 2D/3D preference, persisted in localStorage. 3D is the default; the room
// falls back to 2D for good if WebGL can't start.
const VIEW_KEY = "bmp-room-view";
type View = "2d" | "3d";
const viewListeners = new Set<() => void>();
function subscribeView(cb: () => void) {
  viewListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    viewListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const readView = (): View => (localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d");
function writeView(view: View) {
  localStorage.setItem(VIEW_KEY, view);
  viewListeners.forEach((l) => l());
}

/**
 * The meeting room: every committee member sits at the table and every
 * decision they make becomes visible: posture, interest and trust meters,
 * who they are talking to, and leaving the room.
 */
export function MeetingRoom({
  members,
  difficulty,
  decisions,
  messages,
  reacting,
  meetingOver,
  reveal,
}: {
  members: Member[];
  difficulty: string;
  decisions: DecisionEntry[];
  messages: ChatMessage[];
  reacting: boolean;
  meetingOver: boolean;
  /** Show private whispers (follows the decision log's reveal toggle). */
  reveal: boolean;
}) {
  const { t } = useI18n();
  const view = useSyncExternalStore(subscribeView, readView, () => "2d" as View);
  const states = currentStates(members, difficulty, decisions);
  const deltas = withDeltas(members, difficulty, decisions);
  const lastDelta = new Map(deltas.map((d) => [d.memberId, d]));
  const latestRound = decisions.length ? decisions[decisions.length - 1].round : -1;
  const lastBuyer = [...messages].reverse().find((m) => m.role === "buyer");
  const ready = members.filter((m) => states[m.id].action === "ready_to_buy");
  const adaptation = decisions.length ? decisions[decisions.length - 1].adaptation : "steady";

  return (
    <section
      aria-label={t.room.title}
      className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="text-xs uppercase tracking-wide text-muted">{t.room.title}</div>
          <div role="group" aria-label={t.room.view} className="flex rounded-md border border-border text-[11px]">
            {(["3d", "2d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => writeView(v)}
                className={cn(
                  "px-2 py-0.5 font-medium uppercase",
                  view === v ? "bg-accent text-white" : "text-muted hover:text-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {reacting ? (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" /> {t.room.reacting}
          </div>
        ) : (
          members.length > 1 && <div className="hidden text-xs text-muted sm:block">{t.room.addressHint}</div>
        )}
      </div>

      {view === "3d" ? (
        <Room3D
          members={members}
          states={states}
          deltas={Object.fromEntries(
            members.map((m) => {
              const d = lastDelta.get(m.id);
              const changed = decisions.some((x) => x.memberId === m.id && x.round === latestRound);
              return [m.id, changed && d ? { interest: d.interest - d.prevInterest, trust: d.trust - d.prevTrust } : null];
            }),
          )}
          speakingId={!reacting ? (lastBuyer?.speaker ?? null) : null}
          lastLines={Object.fromEntries(
            members.flatMap((m) => {
              const line = [...messages].reverse().find((x) => x.role === "buyer" && x.speaker === m.id);
              return line ? [[m.id, line.content]] : [];
            }),
          )}
          reveal={reveal}
          t={t}
          onError={() => writeView("2d")}
        />
      ) : (
      <div className="relative">
        {/* The table */}
        <div className="absolute inset-x-6 top-1/2 h-10 -translate-y-1/2 rounded-full bg-accent-soft" aria-hidden />
        <div
          className={cn(
            "relative grid gap-3",
            members.length === 1 ? "grid-cols-1" : members.length === 2 ? "grid-cols-2" : "grid-cols-3",
          )}
        >
          {members.map((m) => {
            const d = lastDelta.get(m.id);
            const changedThisRound = decisions.some((x) => x.memberId === m.id && x.round === latestRound);
            return (
              <Seat
                key={m.id}
                member={m}
                members={members}
                state={states[m.id]}
                delta={changedThisRound && d ? { interest: d.interest - d.prevInterest, trust: d.trust - d.prevTrust } : null}
                speaking={!reacting && lastBuyer?.speaker === m.id}
                reveal={reveal}
                lastLine={[...messages].reverse().find((x) => x.role === "buyer" && x.speaker === m.id) ?? null}
              />
            );
          })}
        </div>
      </div>
      )}

      {!meetingOver && adaptation !== "steady" && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-accent-soft p-2.5 text-sm text-accent" aria-live="polite">
          <span aria-hidden>{ADAPTATION_ICON[adaptation]}</span> {t.adapt[adaptation]}
        </p>
      )}
      {meetingOver ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-bad/10 p-2.5 text-sm text-bad">
          <DoorOpen className="size-4 shrink-0" /> {t.room.meetingOver}
        </p>
      ) : (
        ready.length > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-good/10 p-2.5 text-sm text-good">
            <Handshake className="size-4 shrink-0" />
            {ready.map((m) => firstName(m.name)).join(", ")} {t.room.dealSignal}
          </p>
        )
      )}
    </section>
  );
}

const POSTURE: Record<string, string> = {
  leans_in: "translate-y-2 scale-110",
  takes_notes: "translate-y-1",
  nods: "animate-nod",
  neutral: "",
  checks_phone: "-rotate-12 -translate-y-1",
  crosses_arms: "-translate-y-2 scale-95",
  pushes_back: "animate-shake",
  whispers_to_colleague: "rotate-12",
  ready_to_buy: "translate-y-2 scale-110",
  leaves_meeting: "-translate-y-3 scale-90",
};

function Seat({
  member,
  members,
  state,
  delta,
  speaking,
  lastLine,
  reveal,
}: {
  member: Member;
  members: Member[];
  state: MemberState;
  delta: { interest: number; trust: number } | null;
  speaking: boolean;
  lastLine: ChatMessage | null;
  reveal: boolean;
}) {
  const { t } = useI18n();
  const left = hasLeft(state);
  const target =
    state.addressedTo && state.addressedTo !== "seller"
      ? members.find((x) => firstName(x.name).toLowerCase() === state.addressedTo.toLowerCase())
      : null;
  const mood = state.interest >= 60 ? "ring-good" : state.interest >= 35 ? "ring-warn" : "ring-bad";

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 text-center transition-all duration-700",
        left && "grayscale opacity-40",
      )}
    >
      {/* Speech bubble with the member's latest line */}
      <div className="flex h-12 w-full items-end justify-center">
        {lastLine && !left && (
          <div
            className={cn(
              "line-clamp-2 max-w-full rounded-xl bg-background px-2.5 py-1 text-[11px] leading-snug text-muted transition-opacity",
              speaking ? "opacity-100 ring-1 ring-accent/40" : "opacity-50",
            )}
          >
            {target && <span className="font-medium text-accent">→ {firstName(target.name)}: </span>}
            {lastLine.content}
          </div>
        )}
      </div>

      <div className="relative">
        <div
          // Remount on every new line so the talking animation replays.
          key={speaking ? lastLine?.id : "idle"}
          className={cn(
            "flex size-16 items-center justify-center rounded-full bg-card text-3xl ring-4 transition-all duration-700",
            mood,
            POSTURE[state.action],
            speaking && "animate-talk",
          )}
          aria-hidden
        >
          {member.emoji}
        </div>
        <span
          className="absolute -right-2 -top-1 rounded-full bg-card px-1 text-base shadow-sm transition-all duration-500"
          title={t.actions[state.action]}
          aria-hidden
        >
          {ACTION_ICON[state.action]}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex items-center justify-center gap-1 truncate text-sm font-semibold">
          {member.name}
          {member.memory && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-coach-soft px-1.5 text-[10px] font-medium text-coach"
              title={`${member.memory.sessions} ${t.room.remembersTitle}${member.memory.lastReason ? `: “${member.memory.lastReason}”` : ""}`}
            >
              <Brain className="size-3" aria-hidden /> {t.room.remembers}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted">{member.title}</div>
        <div className="text-[11px] font-medium" aria-live="polite">
          {left ? t.room.left : t.actions[state.action]}
        </div>
      </div>

      {reveal && state.whisper && !left && (
        <div
          className="max-w-full rounded-lg border border-dashed border-coach/50 px-2 py-0.5 text-[10px] italic leading-snug text-coach"
          title={t.room.whisper}
        >
          🤫 {state.whisper}
        </div>
      )}

      <div className="w-full max-w-40 space-y-1">
        <Meter label={t.room.interest} value={state.interest} delta={delta?.interest} />
        <Meter label={t.room.trust} value={state.trust} delta={delta?.trust} />
      </div>
    </div>
  );
}

function Meter({ label, value, delta }: { label: string; value: number; delta?: number }) {
  const color = value >= 60 ? "bg-good" : value >= 35 ? "bg-warn" : "bg-bad";
  return (
    <div className="text-[10px]">
      <div className="flex justify-between text-muted">
        <span>{label}</span>
        <span className="tabular-nums">
          {value}
          {delta ? (
            <span className={cn("ml-1 font-semibold", delta > 0 ? "text-good" : "text-bad")}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          ) : null}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
