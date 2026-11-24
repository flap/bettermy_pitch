// Copies the app's SQLite data into Postgres (schema "app") for analytics
// tools such as Bruin. Full refresh inside one transaction, so readers never
// see empty tables. Runs once, or every SYNC_INTERVAL_SECONDS when > 0.
//
// Env: DATABASE_URL (SQLite, read by Prisma), PGHOST/PGPORT/PGUSER/PGPASSWORD/
// PGDATABASE (target), SYNC_INTERVAL_SECONDS (default 300).
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const prisma = new PrismaClient();
const interval = Number(process.env.SYNC_INTERVAL_SECONDS ?? 300);

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), service: "bmp-sync", msg, ...extra }));

const json = (text) => {
  if (text == null) return null;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
};

const DDL = `
create schema if not exists app;
create table if not exists app.sessions (
  id text primary key, created_at timestamptz not null, ended_at timestamptz, status text not null,
  title text not null, product text not null, persona_id text not null, persona_name text not null,
  persona_brief text not null, difficulty text not null, framework text not null, custom_flow text,
  language text not null, members jsonb);
create table if not exists app.messages (
  id text primary key, created_at timestamptz not null, session_id text not null, role text not null,
  speaker text, content text not null, coach_hint jsonb);
create table if not exists app.decisions (
  id text primary key, created_at timestamptz not null, session_id text not null, round int not null,
  member_id text not null, message_id text, action text not null, addressed_to text not null,
  interest int not null, trust int not null, reasoning text not null);
alter table app.decisions add column if not exists whisper text not null default '';
alter table app.decisions add column if not exists adaptation text not null default 'steady';
create table if not exists app.scorecards (
  id text primary key, created_at timestamptz not null, session_id text not null unique,
  overall int not null, report jsonb, model text not null);
alter table app.scorecards add column if not exists verdict jsonb;
create table if not exists app.persona_templates (
  id text primary key, created_at timestamptz not null, name text not null, title text not null, brief text not null);
create table if not exists app.sync_status (id int primary key, synced_at timestamptz not null, row_counts jsonb not null);
`;

async function insert(client, table, columns, rows) {
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = [];
    const tuples = part.map((row, r) => {
      values.push(...row);
      return `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(",")})`;
    });
    await client.query(`insert into app.${table} (${columns.join(",")}) values ${tuples.join(",")}`, values);
  }
}

async function syncOnce() {
  const started = Date.now();
  const [sessions, messages, decisions, scorecards, templates] = await Promise.all([
    prisma.session.findMany(),
    prisma.message.findMany(),
    prisma.decision.findMany(),
    prisma.scorecard.findMany(),
    prisma.personaTemplate.findMany(),
  ]);

  const client = new pg.Client();
  await client.connect();
  try {
    await client.query(DDL);
    await client.query("begin");
    await client.query("truncate app.sessions, app.messages, app.decisions, app.scorecards, app.persona_templates");
    await insert(
      client,
      "sessions",
      ["id", "created_at", "ended_at", "status", "title", "product", "persona_id", "persona_name", "persona_brief", "difficulty", "framework", "custom_flow", "language", "members"],
      sessions.map((s) => [s.id, s.createdAt, s.endedAt, s.status, s.title, s.product, s.personaId, s.personaName, s.personaBrief, s.difficulty, s.framework, s.customFlow, s.language, json(s.members)]),
    );
    await insert(
      client,
      "messages",
      ["id", "created_at", "session_id", "role", "speaker", "content", "coach_hint"],
      messages.map((m) => [m.id, m.createdAt, m.sessionId, m.role, m.speaker, m.content, json(m.coachHint)]),
    );
    await insert(
      client,
      "decisions",
      ["id", "created_at", "session_id", "round", "member_id", "message_id", "action", "addressed_to", "interest", "trust", "reasoning", "whisper", "adaptation"],
      decisions.map((d) => [d.id, d.createdAt, d.sessionId, d.round, d.memberId, d.messageId, d.action, d.addressedTo, d.interest, d.trust, d.reasoning, d.whisper, d.adaptation]),
    );
    await insert(
      client,
      "scorecards",
      ["id", "created_at", "session_id", "overall", "report", "verdict", "model"],
      scorecards.map((s) => [s.id, s.createdAt, s.sessionId, s.overall, json(s.report), json(s.verdict), s.model]),
    );
    await insert(
      client,
      "persona_templates",
      ["id", "created_at", "name", "title", "brief"],
      templates.map((t) => [t.id, t.createdAt, t.name, t.title, t.brief]),
    );
    const counts = {
      sessions: sessions.length,
      messages: messages.length,
      decisions: decisions.length,
      scorecards: scorecards.length,
      persona_templates: templates.length,
    };
    await client.query(
      "insert into app.sync_status (id, synced_at, row_counts) values (1, now(), $1) on conflict (id) do update set synced_at = excluded.synced_at, row_counts = excluded.row_counts",
      [JSON.stringify(counts)],
    );
    await client.query("commit");
    log("info", "analytics sync complete", { ...counts, duration_ms: Date.now() - started });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function main() {
  do {
    try {
      await syncOnce();
    } catch (err) {
      log("error", "analytics sync failed", { error: String(err?.message ?? err) });
      if (interval <= 0) process.exitCode = 1;
    }
    if (interval > 0) await new Promise((r) => setTimeout(r, interval * 1000));
  } while (interval > 0);
  await prisma.$disconnect();
}

main();
