import { errorResponse, readJson } from "@/lib/api";
import { frameworkLabel } from "@/lib/catalog";
import { personaEmoji, type Member } from "@/lib/committee";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recallMemories } from "@/lib/memory";
import { CreateSessionInput } from "@/lib/schemas";

// POST /api/sessions — create a practice session from the configurator.
export async function POST(req: Request) {
  try {
    const input = CreateSessionInput.parse(await readJson(req));
    if (input.saveAsTemplate) {
      await db.personaTemplate.create({
        data: { name: input.personaName, title: input.personaTitle, brief: input.personaBrief },
      });
    }
    // Each buyer recalls earlier meetings with this seller. The memory is
    // snapshotted into the session so the meeting stays reproducible.
    const memories = await recallMemories([input.personaId, ...input.colleagues.map((c) => c.id)]);
    const members: Member[] = [
      {
        id: "primary",
        name: input.personaName,
        title: input.personaTitle,
        brief: input.personaBrief,
        emoji: personaEmoji(input.personaId),
        personaId: input.personaId,
        memory: memories[input.personaId] ?? null,
      },
      ...input.colleagues.map((c, i) => ({
        id: `colleague-${i + 1}`,
        name: c.name,
        title: c.title,
        brief: c.brief,
        emoji: personaEmoji(c.id),
        personaId: c.id,
        memory: memories[c.id] ?? null,
      })),
    ];
    const extra = input.colleagues.length ? ` +${input.colleagues.length}` : "";
    const session = await db.session.create({
      data: {
        members: JSON.stringify(members),
        title: `${input.personaTitle}${extra} · ${frameworkLabel(input.framework)}`,
        product: input.product,
        personaId: input.personaId,
        personaName: input.personaName,
        personaBrief: `${input.personaTitle}. ${input.personaBrief}`,
        difficulty: input.difficulty,
        framework: input.framework,
        customFlow: input.framework === "custom" ? input.customFlow : null,
        language: input.language,
      },
    });
    logger.info({ practice_session_id: session.id, persona: input.personaId, difficulty: input.difficulty, framework: input.framework, language: input.language, committee_size: members.length, remembered: Object.keys(memories).length }, "practice session created");
    return Response.json({ id: session.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
