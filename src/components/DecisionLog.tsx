"use client";

import { ACTION_ICON, ADAPTATION_ICON, firstName, withDeltas, type DecisionEntry, type Member } from "@/lib/committee";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Why each buyer did what they did, newest round first. */
export function DecisionLog({
  members,
  difficulty,
  decisions,
  reveal,
  onRevealChange,
}: {
  members: Member[];
  difficulty: string;
  decisions: DecisionEntry[];
  reveal: boolean;
  onRevealChange: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const byId = new Map(members.map((m) => [m.id, m]));
  const entries = withDeltas(members, difficulty, decisions);
  const rounds = [...new Set(entries.map((e) => e.round))].sort((a, b) => b - a);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-end border-b border-border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reveal} onChange={(e) => onRevealChange(e.target.checked)} />
          {t.log.reveal}
        </label>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {entries.length === 0 && <p className="text-sm text-muted">{t.log.empty}</p>}
        {!reveal && entries.length > 0 && <p className="text-sm text-muted">{t.log.hidden}</p>}
        {rounds.map((round) => {
          const adaptation = entries.find((e) => e.round === round)?.adaptation ?? "steady";
          return (
          <div key={round} className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted">
              {round === 0 ? t.log.opening : `${t.log.round} ${round}`}
            </div>
            {adaptation !== "steady" && (
              <div className="rounded-lg bg-accent-soft px-3 py-1.5 text-xs text-accent">
                {ADAPTATION_ICON[adaptation]} {t.log.adaptation}: {t.adapt[adaptation]}
              </div>
            )}
            {entries
              .filter((e) => e.round === round)
              .map((e) => {
                const m = byId.get(e.memberId);
                const target = e.addressedTo !== "seller" ? e.addressedTo : null;
                return (
                  <div key={e.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">
                        {m?.emoji} {m ? firstName(m.name) : e.memberId}
                      </span>
                      <span className="text-muted">
                        {ACTION_ICON[e.action]} {t.actions[e.action]}
                      </span>
                      <span className="text-xs text-muted">
                        · {e.messageId ? t.log.spoke : t.log.silent}
                        {target && ` ${t.room.to} ${target}`}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs tabular-nums">
                      <Change label={t.room.interest} from={e.prevInterest} to={e.interest} />
                      <Change label={t.room.trust} from={e.prevTrust} to={e.trust} />
                    </div>
                    {reveal && e.reasoning && <p className="mt-1.5 text-sm leading-relaxed">“{e.reasoning}”</p>}
                    {reveal && e.whisper && (
                      <p className="mt-1 text-xs italic text-coach">
                        🤫 {t.room.whisper}: “{e.whisper}”
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function Change({ label, from, to }: { label: string; from: number; to: number }) {
  const d = to - from;
  return (
    <span className="text-muted">
      {label} {from}→{to}{" "}
      <span className={cn("font-semibold", d > 0 ? "text-good" : d < 0 ? "text-bad" : "")}>
        ({d > 0 ? `+${d}` : d})
      </span>
    </span>
  );
}
