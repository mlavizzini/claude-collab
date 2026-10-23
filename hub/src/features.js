// Funciones de la sala agregadas en v0.5: consultas a humanos, acta, papeles,
// silencio y presupuesto, y archivos compartidos (temporales: en la base de la sala, o en R2 si está).
// Cada handler recibe la sala (`room`) y devuelve una Response, o null si la ruta no es suya.

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB por archivo
export const MAX_ROOM_BYTES = 100 * 1024 * 1024; // 100 MB por sala
const ONE_TIME_TTL_MS = 5 * 60 * 1000;
export const FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // los archivos vencen a los 7 días
const CHUNK_BYTES = 1_500_000; // una fila de SQLite en Durable Objects admite hasta 2 MB

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const err = (status, message) => json({ error: message }, status);

function token(bytes = 18) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---------------------------------------------------------------- estado

export function migrate(s) {
  s.polls ||= [];
  s.files ||= [];
  for (const f of s.files) { f.store ||= "r2"; f.expiresAt ||= new Date(Date.parse(f.at) + FILE_TTL_MS).toISOString(); }
  s.oneTime ||= {};
  s.conclusion ??= null;
  s.settings ||= { silence: false, silenceBy: null, silenced: [], budgetPerHour: null };
  s.counters.poll ||= 0;
  s.counters.file ||= 0;
}

export function settingsView(s) {
  return {
    silence: s.settings.silence,
    silenceBy: s.settings.silenceBy,
    silenced: s.settings.silenced,
    budgetPerHour: s.settings.budgetPerHour,
  };
}

function eligibleVoters(room, poll) {
  const s = room.state;
  if (poll.to !== "*") return s.members[poll.to]?.active ? [poll.to] : [];
  return Object.values(s.members).filter((m) => m.active).map((m) => m.alias);
}

export function pollView(room, p) {
  const counts = p.options.map(() => 0);
  for (const v of Object.values(p.votes)) counts[v] += 1;
  return { ...p, counts, eligible: eligibleVoters(room, p) };
}

function resolvePoll(room, p, by) {
  const counts = p.options.map(() => 0);
  for (const v of Object.values(p.votes)) counts[v] += 1;
  const max = Math.max(...counts);
  const winners = max > 0 ? p.options.filter((_, i) => counts[i] === max) : [];
  p.status = "cerrada";
  p.result = winners.length === 1 ? winners[0] : winners.length ? `empate: ${winners.join(" / ")}` : "sin respuestas";
  p.closedAt = new Date().toISOString();
  p.closedBy = by;
  const detail = p.options.map((o, i) => `${o}: ${counts[i]}`).join(", ");
  room.addMessage({
    from: "sala", to: "*", type: "acuerdo", agent: "sala", topic: p.id,
    body: `Consulta ${p.id} cerrada (${by}): «${p.question}» → ${p.result}. Votos: ${detail}.`,
  });
}

// ---------------------------------------------------------------- mensajes: silencio y presupuesto

// Devuelve null si el agente puede escribir, o una Response con el motivo.
export function gateAgentMessage(room, me, to) {
  const s = room.state;
  if (to === me.alias) return null; // mensajes a su propio humano: siempre
  if (s.settings.silence) {
    return err(423, `La sala está en silencio (lo activó ${s.settings.silenceBy || "el admin"}). Seguí trabajando sin escribir en la sala; ` +
      "si necesitás avisarle algo a tu humano, mandale un mensaje con para = tu propio alias.");
  }
  if (s.settings.silenced.includes(me.alias)) {
    return err(423, "Tu humano te silenció en esta sala. Seguí con tu trabajo sin escribir en el chat; " +
      "para hablar con él, mandá el mensaje con para = tu propio alias.");
  }
  const limit = s.settings.budgetPerHour;
  if (limit) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const used = room.sql.exec(
      "SELECT COUNT(*) AS n FROM messages WHERE from_alias = ? AND human = 0 AND to_alias != ? AND at > ?",
      me.alias, me.alias, since,
    ).one().n;
    if (used >= limit) {
      return err(429, `Llegaste al presupuesto de la sala: ${limit} mensajes por hora. Agrupá lo que tengas en un solo mensaje más tarde, ` +
        "o pedile al admin (por medio de tu humano) que lo amplíe.");
    }
  }
  return null;
}

export function budgetUsage(room, alias) {
  const limit = room.state.settings.budgetPerHour;
  if (!limit) return null;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const used = room.sql.exec(
    "SELECT COUNT(*) AS n FROM messages WHERE from_alias = ? AND human = 0 AND to_alias != ? AND at > ?",
    alias, alias, since,
  ).one().n;
  return { used, limit };
}

// ---------------------------------------------------------------- acta

export function actaMarkdown(room) {
  const s = room.state;
  const lines = [];
  const date = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
  lines.push(`# Acta · ${s.name}`, "");
  lines.push(`_Sala ${s.code} (${s.visibility}) · creada ${date(s.createdAt)} UTC · ${s.closed ? "cerrada" : "abierta"} · acta generada ${date(new Date().toISOString())} UTC_`, "");

  lines.push("## Propósito", "", s.brief || "(sin propósito definido)", "");
  if (s.conclusion) lines.push("## Conclusión", "", s.conclusion.text, "", `_Escrita por ${s.conclusion.by}_`, "");

  // Participación
  const rows = room.sql.exec(
    "SELECT from_alias AS a, human AS h, COUNT(*) AS n FROM messages WHERE from_alias != 'sala' GROUP BY from_alias, human",
  ).toArray();
  const by = {};
  for (const r of rows) {
    by[r.a] ||= { agent: 0, human: 0 };
    by[r.a][r.h ? "human" : "agent"] += r.n;
  }
  lines.push("## Participantes", "");
  for (const m of Object.values(s.members)) {
    const c = by[m.alias] || { agent: 0, human: 0 };
    const extra = [m.role === "admin" ? "admin" : null, m.papel ? `papel: ${m.papel}` : null, m.active ? null : "salió"].filter(Boolean).join(", ");
    lines.push(`- **${m.alias}** (${m.agent}${extra ? `; ${extra}` : ""}): ${c.agent} mensajes del agente, ${c.human} del humano`);
  }
  lines.push("");

  if (s.summary) lines.push("## Resumen de la conversación", "", s.summary.text, "");

  if (s.decisions.length) {
    lines.push("## Decisiones", "");
    for (const d of s.decisions) lines.push(`- **${d.id}** ${d.text}${d.why ? ` — ${d.why}` : ""} _(${d.by}, ${date(d.at)}${d.task ? `, plan de ${d.task}` : ""})_`);
    lines.push("");
  }
  if (s.polls.length) {
    lines.push("## Consultas a los humanos", "");
    for (const p of s.polls) {
      const v = Object.entries(p.votes).map(([a, i]) => `${a}: ${p.options[i]}`).join("; ");
      lines.push(`- **${p.id}** «${p.question}» → ${p.status === "cerrada" ? p.result : "abierta"}${v ? ` (${v})` : ""}${p.required ? " · bloqueante" : ""}`);
    }
    lines.push("");
  }
  if (s.tasks.length) {
    lines.push("## Tareas", "");
    for (const t of s.tasks) lines.push(`- **${t.id}** [${t.status}] ${t.title} — ${t.owner || "sin dueño"}${t.plan ? ` · plan: ${t.plan.text}` : ""}`);
    lines.push("");
  }
  if (s.learnings.length) {
    lines.push("## Aprendizajes", "");
    for (const l of s.learnings) lines.push(`- [${l.scope}] ${l.text}${l.verify ? ` — verificar: ${l.verify}` : ""} _(${l.by})_`);
    lines.push("");
  }
  if (s.notes.length) {
    lines.push("## Contexto acumulado", "");
    for (const n of s.notes) lines.push(`- ${n.text} _(${n.by})_`);
    lines.push("");
  }
  if (s.doc.sections.length) {
    lines.push("## Documento", "", ...s.doc.sections.map((x) => `- ${x.title} (v${x.version}, ${x.authors.join(", ")})`), "");
  }
  if (s.files.length) {
    lines.push("## Archivos", "", ...s.files.map((f) => `- ${f.name} (${fmtBytes(f.size)}, ${f.by}; vence ${String(f.expiresAt || "").slice(0, 10)})`), "");
  }

  const pending = [
    ...s.tasks.filter((t) => !["hecha", "rechazada"].includes(t.status)).map((t) => `Tarea ${t.id}: ${t.title} (${t.owner || "sin dueño"}, ${t.status})`),
    ...s.proposals.filter((p) => p.status === "pendiente").map((p) => `Propuesta ${p.id} de ${p.by} sin resolver`),
    ...s.polls.filter((p) => p.status === "abierta").map((p) => `Consulta ${p.id} abierta: «${p.question}»`),
  ];
  lines.push("## Pendientes", "", ...(pending.length ? pending.map((x) => `- ${x}`) : ["- Nada pendiente."]), "");
  return lines.join("\n");
}

// ---------------------------------------------------------------- rutas HTTP con token de agente

export async function handleAgentRoute(room, { path, method, body, me, isAdmin, url }) {
  const s = room.state;
  const now = () => new Date().toISOString();

  // ---- Consultas a los humanos
  if (path === "/polls" && method === "GET") {
    return json({ polls: s.polls.map((p) => pollView(room, p)) });
  }
  if (path === "/polls" && method === "POST") {
    const question = String(body.question || "").trim().slice(0, 500);
    const options = (Array.isArray(body.options) ? body.options : []).map((o) => String(o).trim().slice(0, 100)).filter(Boolean);
    if (!question) return err(400, "Falta la pregunta");
    if (options.length < 2 || options.length > 6) return err(400, "Hacen falta entre 2 y 6 opciones");
    const to = String(body.to || "*");
    if (to !== "*" && !s.members[to]?.active) return err(404, `No hay nadie activo con alias ${to}`);
    s.counters.poll += 1;
    const p = {
      id: `q${s.counters.poll}`, question, options, required: !!body.required, to,
      context: String(body.context || "").slice(0, 1000), default: body.default ? String(body.default).slice(0, 100) : null,
      by: me.alias, votes: {}, status: "abierta", createdAt: now(),
    };
    s.polls.push(p);
    room.addMessage({
      from: me.alias, to: "*", type: "consulta", agent: me.agent, topic: p.id,
      body: `Consulta ${p.id}${p.required ? " (BLOQUEANTE: hace falta respuesta para avanzar)" : " (opcional)"}` +
        `${to !== "*" ? ` para el humano de ${to}` : " para los humanos"}: ${question}\nOpciones: ${options.join(" · ")}` +
        `${p.context ? `\n${p.context}` : ""}${!p.required && p.default ? `\nSi nadie responde, sigo con: ${p.default}` : ""}`,
    });
    await room.save();
    room.changed();
    return json({ ok: true, poll: pollView(room, p) }, 201);
  }
  const pc = path.match(/^\/polls\/(q\d+)\/close$/);
  if (pc && method === "POST") {
    const p = s.polls.find((x) => x.id === pc[1]);
    if (!p) return err(404, "Consulta inexistente");
    if (p.status !== "abierta") return err(409, "La consulta ya está cerrada");
    if (p.by !== me.alias && !isAdmin) return err(403, "Solo quien la creó o el admin pueden cerrarla");
    resolvePoll(room, p, me.alias);
    await room.save();
    room.changed();
    return json({ ok: true, poll: pollView(room, p) });
  }

  // ---- Acta y conclusión
  if (path === "/acta" && method === "GET") {
    return json({ markdown: actaMarkdown(room), filename: `acta-${s.code}.md` });
  }
  if (path === "/conclusion" && method === "POST") {
    if (!isAdmin) return err(403, "La conclusión la escribe el agente del admin");
    const text = String(body.text || "").trim();
    if (!text) return err(400, "Falta el texto");
    s.conclusion = { text: text.slice(0, 20000), by: me.alias, at: now() };
    room.system(`${me.alias} escribió la conclusión de la sala.`);
    await room.save();
    room.changed();
    return json({ ok: true });
  }

  // ---- Papeles
  if (path === "/papel" && method === "POST") {
    const target = body.alias ? String(body.alias) : me.alias;
    const m = s.members[target];
    if (!m?.active) return err(404, `No hay nadie activo con alias ${target}`);
    if (target !== me.alias && !isAdmin) return err(403, "Solo podés cambiar tu papel; el admin puede asignar el de otros");
    const papel = String(body.papel || "").trim().slice(0, 60);
    m.papel = papel || null;
    room.system(papel ? `${target} tiene ahora el papel: ${papel}${target !== me.alias ? ` (asignado por ${me.alias})` : ""}.` : `${target} ya no tiene un papel asignado.`);
    await room.save();
    room.changed();
    return json({ ok: true, papel: m.papel });
  }

  // ---- Ajustes: silencio y presupuesto (admin)
  if (path === "/settings" && method === "POST") {
    if (!isAdmin) return err(403, "Solo el admin cambia los ajustes de la sala");
    const changes = [];
    if (body.silence !== undefined) {
      s.settings.silence = !!body.silence;
      s.settings.silenceBy = s.settings.silence ? me.alias : null;
      changes.push(s.settings.silence ? "sala en silencio: los agentes dejan de escribir en el chat" : "se levantó el silencio");
    }
    if (body.budget_per_hour !== undefined) {
      const n = body.budget_per_hour === null || body.budget_per_hour === 0 ? null : Math.min(Math.max(Math.round(Number(body.budget_per_hour)), 1), 1000);
      if (Number.isNaN(n)) return err(400, "budget_per_hour debe ser un número o null");
      s.settings.budgetPerHour = n;
      changes.push(n ? `presupuesto: ${n} mensajes por agente por hora` : "sin límite de mensajes");
    }
    if (changes.length) room.system(`Ajustes de ${me.alias}: ${changes.join("; ")}.`);
    await room.save();
    room.changed();
    return json({ ok: true, settings: settingsView(s) });
  }

  // ---- Archivos (metadatos y descarga para agentes)
  if (path === "/files" && method === "GET") {
    if (await purgeExpiredFiles(room)) { await room.save(); room.changed(); }
    return json({ files: s.files });
  }
  const fd = path.match(/^\/files\/(f\d+)$/);
  if (fd && method === "GET") return downloadFile(room, fd[1]);
  const fx = path.match(/^\/files\/(f\d+)\/delete$/);
  if (fx && method === "POST") {
    const i = s.files.findIndex((f) => f.id === fx[1]);
    if (i < 0) return err(404, "Archivo inexistente");
    const f = s.files[i];
    if (f.by !== me.alias && !isAdmin) return err(403, "Solo quien lo subió o el admin pueden borrarlo");
    await deleteBlob(room, f);
    s.files.splice(i, 1);
    room.addMessage({ from: me.alias, to: "*", type: "info", agent: me.agent, topic: f.id, body: `Borró el archivo ${f.id} «${f.name}».` });
    await room.save();
    room.changed();
    return json({ ok: true });
  }
  return null;
}

// ---------------------------------------------------------------- archivos

export async function storeFile(room, req, by, agent, url) {
  const s = room.state;
  await purgeExpiredFiles(room);
  const name = String(url.searchParams.get("name") || "archivo").replace(/[\\/\0]/g, "_").slice(0, 120);
  const type = String(url.searchParams.get("type") || req.headers.get("content-type") || "application/octet-stream").slice(0, 100);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return err(400, "El archivo está vacío");
  if (buf.byteLength > MAX_FILE_BYTES) return err(413, `El archivo supera el máximo de ${fmtBytes(MAX_FILE_BYTES)}`);
  const total = s.files.reduce((a, f) => a + f.size, 0);
  if (total + buf.byteLength > MAX_ROOM_BYTES) return err(413, `La sala llegó a su máximo de ${fmtBytes(MAX_ROOM_BYTES)} en archivos`);
  s.counters.file += 1;
  const at = new Date();
  const f = {
    id: `f${s.counters.file}`, name, type, size: buf.byteLength, by, at: at.toISOString(),
    expiresAt: new Date(at.getTime() + FILE_TTL_MS).toISOString(), store: room.env.FILES ? "r2" : "sql",
  };
  await putBlob(room, f, buf);
  s.files.push(f);
  room.addMessage({
    from: by, to: "*", type: "info", agent, topic: f.id,
    body: `Subió el archivo ${f.id} «${name}» (${fmtBytes(f.size)}). Vence el ${f.expiresAt.slice(0, 10)}: si te sirve a futuro, bajalo antes.`,
  });
  await scheduleFileExpiry(room);
  await room.save();
  room.changed();
  return json({ ok: true, file: f }, 201);
}

export async function downloadFile(room, id) {
  const s = room.state;
  const f = s.files.find((x) => x.id === id);
  if (!f) return err(404, "Archivo inexistente (puede haber vencido)");
  const body = await getBlob(room, f);
  if (!body) return err(404, "El archivo no está en el almacenamiento");
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

// Almacenamiento: R2 si el hub lo tiene; si no, la base SQLite de la sala, en pedazos.
function sqlFiles(room) {
  room.sql.exec("CREATE TABLE IF NOT EXISTS file_chunks (file_id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file_id, idx))");
  return room.sql;
}

async function putBlob(room, f, buf) {
  if (f.store === "r2") return room.env.FILES.put(`${room.state.code}/${f.id}`, buf, { httpMetadata: { contentType: f.type } });
  const sql = sqlFiles(room);
  for (let i = 0, idx = 0; i < buf.byteLength; i += CHUNK_BYTES, idx++) {
    sql.exec("INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)", f.id, idx, buf.slice(i, i + CHUNK_BYTES));
  }
}

async function getBlob(room, f) {
  if (f.store === "r2") {
    if (!room.env.FILES) return null;
    return (await room.env.FILES.get(`${room.state.code}/${f.id}`))?.body || null;
  }
  const rows = sqlFiles(room).exec("SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx", f.id).toArray();
  if (!rows.length) return null;
  const out = new Uint8Array(rows.reduce((n, r) => n + r.data.byteLength, 0));
  let off = 0;
  for (const r of rows) { out.set(new Uint8Array(r.data), off); off += r.data.byteLength; }
  return out;
}

async function deleteBlob(room, f) {
  if (f.store === "r2") { if (room.env.FILES) await room.env.FILES.delete(`${room.state.code}/${f.id}`); return; }
  sqlFiles(room).exec("DELETE FROM file_chunks WHERE file_id = ?", f.id);
}

// Borra los archivos vencidos. Devuelve cuántos borró (el que llama guarda y avisa).
export async function purgeExpiredFiles(room) {
  const s = room.state;
  const now = Date.now();
  const expired = s.files.filter((f) => f.expiresAt && Date.parse(f.expiresAt) <= now);
  if (!expired.length) return 0;
  for (const f of expired) await deleteBlob(room, f);
  s.files = s.files.filter((f) => !expired.includes(f));
  room.system(`Vencieron ${expired.length === 1 ? "el archivo" : `${expired.length} archivos`}: ${expired.map((f) => `${f.id} «${f.name}»`).join(", ")}.`);
  await scheduleFileExpiry(room);
  return expired.length;
}

// Alarma de la sala para el próximo vencimiento (así se borran aunque nadie entre).
export async function scheduleFileExpiry(room) {
  const next = room.state.files.map((f) => Date.parse(f.expiresAt)).filter(Boolean).sort((a, b) => a - b)[0];
  if (next) await room.ctx.storage.setAlarm(next + 1000);
  else await room.ctx.storage.deleteAlarm();
}

// Tokens de un solo uso para que el visor suba o baje archivos sin exponer credenciales.
export function issueOneTime(room, kind, alias, id = null) {
  const s = room.state;
  const t = Date.now();
  for (const [k, v] of Object.entries(s.oneTime)) if (v.exp < t) delete s.oneTime[k];
  const k = token();
  s.oneTime[k] = { kind, alias, id, exp: t + ONE_TIME_TTL_MS };
  return k;
}

export function takeOneTime(room, k, kind) {
  const s = room.state;
  const v = s.oneTime[k];
  if (!v) return null;
  delete s.oneTime[k];
  if (v.kind !== kind || v.exp < Date.now() || !s.members[v.alias]?.active) return null;
  return v;
}

// Rutas públicas con token de un solo uso (antes de leer el cuerpo como JSON).
export async function handleOneTimeRoute(room, req, path, url) {
  const dl = path.match(/^\/files\/(f\d+)\/d\/([a-f0-9]+)$/);
  if (dl && req.method === "GET") {
    const v = takeOneTime(room, dl[2], "download");
    await room.save();
    if (!v || v.id !== dl[1]) return err(403, "Link de descarga vencido; volvé a pedirlo desde el visor");
    return downloadFile(room, dl[1]);
  }
  const up = path.match(/^\/files\/up\/([a-f0-9]+)$/);
  if (up && req.method === "POST") {
    const v = takeOneTime(room, up[1], "upload");
    if (!v) { await room.save(); return err(403, "Link de subida vencido; volvé a intentarlo"); }
    return storeFile(room, req, v.alias, "humano", url);
  }
  return null;
}

// ---------------------------------------------------------------- WebSocket del visor

export async function handleViewerMessage(room, ws, att, msg) {
  const s = room.state;
  const send = (x) => ws.send(JSON.stringify(x));
  const isAdmin = att.alias === s.admin;

  if (msg.type === "vote") {
    const p = s.polls.find((x) => x.id === msg.poll);
    if (!p) return send({ type: "error", error: "Consulta inexistente" }), true;
    if (p.status !== "abierta") return send({ type: "error", error: "Esa consulta ya se cerró" }), true;
    if (!eligibleVoters(room, p).includes(att.alias)) return send({ type: "error", error: "Esta consulta no es para vos" }), true;
    const i = Number(msg.option);
    if (!(i >= 0 && i < p.options.length)) return send({ type: "error", error: "Opción inválida" }), true;
    const changed = p.votes[att.alias] !== undefined;
    p.votes[att.alias] = i;
    room.addMessage({
      from: att.alias, to: "*", type: "voto", human: true, agent: "humano", topic: p.id,
      body: `${changed ? "Cambió su voto" : "Votó"} en ${p.id} («${p.question}»): ${p.options[i]}`,
    });
    if (eligibleVoters(room, p).every((a) => p.votes[a] !== undefined)) resolvePoll(room, p, "todos respondieron");
    await room.save();
    room.changed();
    return true;
  }
  if (msg.type === "closepoll") {
    const p = s.polls.find((x) => x.id === msg.poll);
    if (!p || p.status !== "abierta") return send({ type: "error", error: "Esa consulta no está abierta" }), true;
    if (!isAdmin) return send({ type: "error", error: "Solo el admin cierra consultas desde el visor" }), true;
    resolvePoll(room, p, `${att.alias} (humano)`);
    await room.save();
    room.changed();
    return true;
  }
  if (msg.type === "silence") {
    const on = !!msg.on;
    if (msg.scope === "room") {
      if (!isAdmin) return send({ type: "error", error: "Solo el admin silencia la sala; vos podés silenciar a tu agente" }), true;
      s.settings.silence = on;
      s.settings.silenceBy = on ? `${att.alias} (humano)` : null;
      room.system(on ? `${att.alias} silenció la sala: los agentes dejan de escribir en el chat hasta nuevo aviso.` : `${att.alias} levantó el silencio de la sala.`, "aviso");
    } else {
      const set = new Set(s.settings.silenced);
      on ? set.add(att.alias) : set.delete(att.alias);
      s.settings.silenced = [...set];
      room.system(on ? `${att.alias} silenció a su agente en la sala.` : `${att.alias} le devolvió la palabra a su agente.`);
    }
    await room.save();
    room.changed();
    return true;
  }
  if (msg.type === "acta") {
    send({ type: "file", markdown: actaMarkdown(room), filename: `acta-${s.code}.md` });
    return true;
  }
  if (msg.type === "filelink") {
    const f = s.files.find((x) => x.id === msg.id);
    if (!f) return send({ type: "error", error: "Archivo inexistente" }), true;
    const k = issueOneTime(room, "download", att.alias, f.id);
    await room.save();
    send({ type: "filelink", path: `/rooms/${s.code}/files/${f.id}/d/${k}` });
    return true;
  }
  if (msg.type === "uploadlink") {
    if (s.closed) return send({ type: "error", error: "La sala está cerrada" }), true;
    const k = issueOneTime(room, "upload", att.alias);
    await room.save();
    send({ type: "uploadlink", path: `/rooms/${s.code}/files/up/${k}`, max: MAX_FILE_BYTES, ref: msg.ref });
    return true;
  }
  return false;
}
