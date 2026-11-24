"use client";

import { DIFFICULTIES, FRAMEWORKS, LANGUAGES, PERSONAS } from "@/lib/catalog";
import { MAX_COLLEAGUES } from "@/lib/committee";
import { useI18n } from "@/lib/i18n/client";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";
import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PersonaSelector, type PersonaDraft, type PersonaTemplateDto } from "./PersonaSelector";
import { Button, Card, SectionTitle } from "./ui";

const first = PERSONAS[0];

function builtInPersona(id: string, locale: Locale) {
  const p = PERSONAS.find((x) => x.id === id);
  const tr = dictionaries[locale].personas[id];
  return p && tr ? { id, name: p.name, title: tr.title, brief: tr.brief } : null;
}

export function SessionConfigurator({ templates }: { templates: PersonaTemplateDto[] }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [product, setProduct] = useState("");
  const [persona, setPersona] = useState<PersonaDraft>(() => builtInPersona(first.id, locale)!);
  const [difficulty, setDifficulty] = useState<string>("skeptical");
  const [framework, setFramework] = useState<string>("meddic");
  const [customFlow, setCustomFlow] = useState("");
  const [language, setLanguage] = useState<string>(locale);
  const [shownLocale, setShownLocale] = useState(locale);

  // When the interface language changes, follow it with the practice language
  // and re-translate an unedited built-in persona.
  if (shownLocale !== locale) {
    setShownLocale(locale);
    setLanguage(locale);
    const before = builtInPersona(persona.id, shownLocale);
    if (before && before.title === persona.title && before.brief === persona.brief) {
      setPersona({ ...builtInPersona(persona.id, locale)!, name: persona.name });
    }
  }
  // Default to a full 3-buyer committee; colleagues can be removed.
  const [colleagueIds, setColleagueIds] = useState<string[]>(["cfo", "security-lead"]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustomPersona = persona.id === "custom";
  // The primary persona can't also sit in the room as a colleague.
  const colleagues = colleagueIds.filter((id) => id !== persona.id);

  function toggleColleague(id: string) {
    setColleagueIds((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : colleagues.length < MAX_COLLEAGUES
          ? [...ids.filter((x) => x !== persona.id), id]
          : ids,
    );
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          personaId: persona.id,
          personaName: persona.name,
          personaTitle: persona.title,
          personaBrief: persona.brief,
          colleagues: colleagues.map((id) => builtInPersona(id, locale)!),
          difficulty,
          framework,
          customFlow: framework === "custom" ? customFlow : undefined,
          language,
          saveAsTemplate: isCustomPersona && saveAsTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t.config.createError);
      router.push(`/session/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={start} className="space-y-5">
      <Card className="space-y-3">
        <SectionTitle>{t.config.step1}</SectionTitle>
        <textarea
          required
          minLength={10}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          rows={5}
          placeholder={t.config.productPlaceholder}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm"
        />
      </Card>

      <Card className="space-y-3">
        <SectionTitle>{t.config.step2}</SectionTitle>
        <PersonaSelector value={persona} onChange={setPersona} templates={templates} />
        {isCustomPersona && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
            {t.config.saveTemplate}
          </label>
        )}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-sm font-medium">{t.config.colleagues}</div>
          <p className="text-xs text-muted">{t.config.colleaguesHint}</p>
          <div className="flex flex-wrap gap-2">
            {PERSONAS.filter((p) => p.id !== persona.id).map((p) => {
              const on = colleagues.includes(p.id);
              const full = !on && colleagues.length >= MAX_COLLEAGUES;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleColleague(p.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40",
                    on ? "border-accent bg-accent-soft text-accent" : "border-border hover:border-accent/50",
                  )}
                >
                  <span aria-hidden>{p.emoji}</span> {p.name} · {t.personas[p.id]?.title ?? p.title}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionTitle>{t.config.step3}</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDifficulty(d.id)}
              className={cn(
                "rounded-xl border p-3 text-left",
                difficulty === d.id ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50",
              )}
            >
              <div className="text-sm font-medium">{t.difficulties[d.id].label}</div>
              <div className="mt-0.5 text-xs text-muted">{t.difficulties[d.id].description}</div>
            </button>
          ))}
        </div>

        <SectionTitle>{t.config.step4}</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {FRAMEWORKS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFramework(f.id)}
              className={cn(
                "rounded-xl border p-3 text-left",
                framework === f.id ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50",
              )}
            >
              <div className="text-sm font-medium">{t.frameworks[f.id].label}</div>
              <div className="mt-0.5 text-xs text-muted">{t.frameworks[f.id].description}</div>
            </button>
          ))}
        </div>
        {framework === "custom" && (
          <textarea
            required
            value={customFlow}
            onChange={(e) => setCustomFlow(e.target.value)}
            rows={4}
            placeholder={t.config.customFlowPlaceholder}
            className="w-full rounded-lg border border-border bg-background p-3 text-sm"
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <SectionTitle>{t.config.practiceLanguage}</SectionTitle>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <p className="rounded-lg bg-bad/10 p-3 text-sm text-bad">{error}</p>}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {t.config.start}
      </Button>
    </form>
  );
}
