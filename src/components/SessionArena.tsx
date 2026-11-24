"use client";

import { datadogRum } from "@datadog/browser-rum";
import { currentStates, hasLeft, type DecisionEntry, type Member } from "@/lib/committee";
import { useI18n } from "@/lib/i18n/client";
import type { CoachHint } from "@/lib/schemas";
import { speakLines } from "@/lib/speech";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArena, type ChatMessage } from "./ChatArena";
import { DecisionLog } from "./DecisionLog";
import { LiveCoachSidebar, type HintEntry } from "./LiveCoachSidebar";
import { MeetingRoom } from "./MeetingRoom";

export type ArenaSession = {
  id: string;
  title: string;
  difficulty: string;
  framework: string;
  speechLang: string;
  members: Member[];
};

type RoundResponse = { seller: ChatMessage | null; messages: ChatMessage[]; decisions: DecisionEntry[] };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * The live meeting: the room with the buying committee and the chat on the
 * left; the coach and the decision log on the right.
 */
export function SessionArena({
  session,
  initialMessages,
  initialHints,
  initialDecisions,
}: {
  session: ArenaSession;
  initialMessages: ChatMessage[];
  initialHints: HintEntry[];
  initialDecisions: DecisionEntry[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [messages, setMessages] = useState(initialMessages);
  const [hints, setHints] = useState(initialHints);
  const [decisions, setDecisions] = useState(initialDecisions);
  const [buyerTyping, setBuyerTyping] = useState(false);
  const [coachThinking, setCoachThinking] = useState(false);
  const [coachOn, setCoachOn] = useState(true);
  const [voiceOut, setVoiceOut] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"coach" | "log">("coach");
  const [revealReasons, setRevealReasons] = useState(true);
  const opened = useRef(false);
  const coachOnRef = useRef(coachOn);
  const voiceOutRef = useRef(voiceOut);

  useEffect(() => {
    coachOnRef.current = coachOn;
    voiceOutRef.current = voiceOut;
  }, [coachOn, voiceOut]);

  const states = useMemo(
    () => currentStates(session.members, session.difficulty, decisions),
    [session.members, session.difficulty, decisions],
  );
  const meetingOver = decisions.length > 0 && session.members.every((m) => hasLeft(states[m.id]));

  const fetchHint = useCallback(async () => {
    if (!coachOnRef.current) return;
    setCoachThinking(true);
    try {
      const { messageId, hint } = await post<{ messageId: string; hint: CoachHint }>("/api/hint", {
        sessionId: session.id,
      });
      setHints((h) => [...h.filter((x) => x.messageId !== messageId), { messageId, hint }]);
    } catch (err) {
      // Coaching is best-effort; never block the conversation on it.
      console.warn("coach hint failed", err);
    } finally {
      setCoachThinking(false);
    }
  }, [session.id]);

  /** Run one meeting round. Resolves to false if it failed. */
  const runRound = useCallback(
    async (message?: string, optimisticId?: string) => {
      setError(null);
      setBuyerTyping(true);
      try {
        const res = await post<RoundResponse>("/api/roleplay", { sessionId: session.id, message });
        setMessages((m) => [
          ...m.map((x) => (res.seller && x.id === optimisticId ? res.seller : x)),
          ...res.messages,
        ]);
        setDecisions((d) => [...d, ...res.decisions]);
        datadogRum.addAction("committee_round", {
          practice_session_id: session.id,
          speakers: res.messages.length,
          left: res.decisions.filter((d) => d.action === "leaves_meeting").length,
          ready_to_buy: res.decisions.filter((d) => d.action === "ready_to_buy").length,
        });
        if (voiceOutRef.current) {
          speakLines(
            res.messages.map((m) => ({
              text: m.content,
              voice: Math.max(0, session.members.findIndex((x) => x.id === m.speaker)),
            })),
            session.speechLang,
          );
        }
        if (res.messages.length > 0) void fetchHint();
        return true;
      } catch (err) {
        // Nothing was saved server-side: drop the optimistic seller line.
        if (optimisticId) setMessages((m) => m.filter((x) => x.id !== optimisticId));
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBuyerTyping(false);
      }
    },
    [session.id, session.members, session.speechLang, fetchHint],
  );

  // The committee opens the meeting when the transcript is empty.
  useEffect(() => {
    if (opened.current || initialMessages.length > 0) return;
    opened.current = true;
    void runRound();
  }, [runRound, initialMessages.length]);

  function send(text: string) {
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "seller",
      speaker: null,
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    return runRound(text, optimistic.id);
  }

  async function endAndScore() {
    setScoring(true);
    setError(null);
    try {
      await post("/api/evaluate", { sessionId: session.id });
      datadogRum.addAction("practice_session_scored", {
        practice_session_id: session.id,
        framework: session.framework,
        difficulty: session.difficulty,
        turns: messages.length,
      });
      router.push(`/scorecard/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setScoring(false);
    }
  }

  const sellerTurns = messages.filter((m) => m.role === "seller").length;

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-9rem)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-h-0 flex-col gap-4">
        <MeetingRoom
          members={session.members}
          difficulty={session.difficulty}
          decisions={decisions}
          messages={messages}
          reacting={buyerTyping}
          meetingOver={meetingOver}
          reveal={revealReasons}
        />
        <ChatArena
          session={session}
          messages={messages}
          buyerTyping={buyerTyping}
          error={error}
          onSend={send}
          voiceOut={voiceOut}
          onVoiceOutChange={setVoiceOut}
          canScore={sellerTurns > 0 && !buyerTyping}
          scoring={scoring}
          onEndAndScore={endAndScore}
          closed={meetingOver}
        />
      </div>
      <aside className="flex min-h-[50vh] flex-col overflow-hidden rounded-2xl border border-border bg-card lg:min-h-0">
        <div role="tablist" className="flex border-b border-border text-sm">
          {(
            [
              ["coach", t.log.coachTab],
              ["log", `${t.log.tab} (${decisions.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 px-4 py-2.5 font-medium",
                tab === id ? "border-b-2 border-accent text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "coach" ? (
          <LiveCoachSidebar
            hints={hints}
            thinking={coachThinking}
            enabled={coachOn}
            onToggle={setCoachOn}
            framework={session.framework}
          />
        ) : (
          <DecisionLog
            members={session.members}
            difficulty={session.difficulty}
            decisions={decisions}
            reveal={revealReasons}
            onRevealChange={setRevealReasons}
          />
        )}
      </aside>
    </div>
  );
}
