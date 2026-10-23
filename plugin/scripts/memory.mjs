// Memoria entre salas: queda SOLO en esta máquina (~/.claude-collab/memoria/).
// La comparten todos los agentes de la máquina (Claude Code, Codex...), nunca sale sola al hub.
import fs from "node:fs";
import path from "node:path";
import { HOME_DIR } from "./lib.mjs";

export const MEMORY_DIR = path.join(HOME_DIR, "memoria");

const STOP = new Set(("para como esta este estos estas pero porque cuando donde entre sobre desde hasta todo toda todos " +
  "tiene tienen hacer hace sala salas nuestro nuestra the and with from that this have will para que los las del una uno unos unas " +
  "con sin por mas más muy ser son fue era hay").split(" "));

export function tokens(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
}

export function saveRoomMemory(session, { context, acta }) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true, mode: 0o700 });
  const entry = {
    code: session.code,
    name: context.room?.name || session.name,
    hub: session.hub,
    alias: session.alias,
    savedAt: new Date().toISOString(),
    closed: !!context.room?.closed,
    brief: context.brief || "",
    conclusion: context.conclusion?.text || "",
    summary: context.summary?.text || "",
    learnings: (context.learnings || []).map((l) => ({ id: l.id, text: l.text, scope: l.scope, verify: l.verify })),
    decisions: (context.decisions || []).map((d) => ({ id: d.id, text: d.text, why: d.why })),
    notes: (context.notes || []).map((n) => ({ id: n.id, text: n.text })),
    polls: (context.recentPolls || []).map((p) => ({ question: p.question, result: p.result })),
  };
  const base = path.join(MEMORY_DIR, session.code);
  fs.writeFileSync(`${base}.json`, JSON.stringify(entry, null, 2), { mode: 0o600 });
  if (acta) fs.writeFileSync(`${base}.acta.md`, acta, { mode: 0o600 });
  return { file: `${base}.json`, acta: acta ? `${base}.acta.md` : null, entry };
}

export function listMemory() {
  try {
    return fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, f), "utf8")); } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

// Busca aprendizajes, decisiones, notas y conclusiones de salas anteriores relacionados con la consulta.
export function searchMemory(query, { exclude = null, limit = 8 } = {}) {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  const hits = [];
  for (const room of listMemory()) {
    if (room.code === exclude) continue;
    const roomBoost = tokens(`${room.name} ${room.brief}`).filter((w) => q.has(w)).length;
    const items = [
      ...room.learnings.map((l) => ({ kind: "aprendizaje", text: l.text + (l.verify ? ` (verificar: ${l.verify})` : ""), scope: l.scope })),
      ...room.decisions.map((d) => ({ kind: "decisión", text: d.text + (d.why ? ` — ${d.why}` : "") })),
      ...room.notes.map((n) => ({ kind: "contexto", text: n.text })),
      ...(room.conclusion ? [{ kind: "conclusión", text: room.conclusion.slice(0, 600) }] : []),
    ];
    for (const it of items) {
      const overlap = tokens(it.text).filter((w) => q.has(w)).length;
      if (!overlap && !roomBoost) continue;
      const score = overlap * 2 + roomBoost + (it.kind === "aprendizaje" ? 1 : 0);
      if (overlap || roomBoost >= 2) hits.push({ ...it, score, room: room.name, code: room.code, date: room.savedAt.slice(0, 10) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatHits(hits) {
  return hits.map((h) => `- [${h.kind}${h.scope ? `/${h.scope}` : ""}] ${h.text}  ← sala «${h.room}» (${h.date})`).join("\n");
}
