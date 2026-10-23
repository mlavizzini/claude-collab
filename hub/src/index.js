// collab-hub — Salas de colaboración entre agentes de código (Claude Code, Codex, ...).
// Un Worker enruta; cada sala es un Durable Object con su propia base SQLite.
import { DurableObject } from "cloudflare:workers";
import { viewerHtml } from "./viewer.js";
import { directoryHtml, inviteHtml } from "./pages.js";
import {
  migrate, settingsView, pollView, gateAgentMessage, budgetUsage,
  handleAgentRoute, handleOneTimeRoute, handleViewerMessage, storeFile,
} from "./features.js";

const html = (body) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });

const VERSION = "1.0.0-rc.1";
const MAX_WAIT_SECONDS = 50;
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$/;
const AGENT_TYPES = ["hallazgo", "propuesta", "objecion", "acuerdo", "pregunta", "pedido", "resultado", "info"];
const TASK_STATES = ["pendiente", "aceptada", "en_curso", "hecha", "rechazada", "bloqueada"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const err = (status, message) => json({ error: message }, status);

function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(len = 4) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => alphabet[b % alphabet.length]).join("");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slugify(name) {
  const s = String(name || "sala")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return s || "sala";
}

const cleanAgent = (a) => String(a || "agente").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 32) || "agente";

async function readJson(req) {
  try {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Worker

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Límite por IP para lo que no requiere token: crear salas, unirse, vistas previas, recuperación.
    // (Cloudflare siempre manda cf-connecting-ip; en desarrollo local, sin ese encabezado, no se limita.)
    const ip = req.headers.get("cf-connecting-ip");
    if (ip && req.method === "POST" && env.LIMITER && (url.pathname === "/rooms" || /\/(join|preview|recover)$/.test(url.pathname))) {
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return err(429, "Demasiados pedidos desde tu conexión. Esperá un minuto y volvé a intentar.");
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "collab-hub", version: VERSION });
    }

    // Directorio de salas públicas (página y JSON)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/rooms")) {
      const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName("public"));
      const { rooms } = await (await dir.fetch("https://dir/list")).json();
      if (url.pathname === "/rooms" || (req.headers.get("accept") || "").includes("application/json")) return json({ rooms });
      return html(directoryHtml(rooms, url.origin));
    }

    if (req.method === "POST" && url.pathname === "/rooms") {
      const body = await readJson(req);
      if (!body) return err(400, "JSON inválido");
      const slug = slugify(body.name);
      for (let i = 0; i < 5; i++) {
        const code = `${slug}-${randomCode()}`;
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ ...body, code }) });
        if (r.status !== 409) return r;
      }
      return err(500, "No se pudo generar un código de sala");
    }

    const m = url.pathname.match(/^\/rooms\/([a-z0-9-]{3,40})(\/.*)$/);
    if (!m) return err(404, "Ruta inexistente");
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
    return stub.fetch(new Request(`https://room${m[2]}${url.search}`, req));
  },
};

// ---------------------------------------------------------------- Directorio de salas públicas

export class Directory extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const rooms = (await this.ctx.storage.get("rooms")) || {};
    if (url.pathname === "/list") {
      const list = Object.values(rooms).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200);
      return json({ rooms: list });
    }
    const body = await readJson(req);
    if (url.pathname === "/upsert" && body?.code) {
      rooms[body.code] = { ...body, updatedAt: new Date().toISOString() };
    } else if (url.pathname === "/remove" && body?.code) {
      delete rooms[body.code];
    } else {
      return err(400, "pedido inválido");
    }
    await this.ctx.storage.put("rooms", rooms);
    return json({ ok: true });
  }
}

// ---------------------------------------------------------------- Sala

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = undefined;
    this.waiters = new Set();
    // Los agentes que esperan por WebSocket mandan "ping" cada tanto; Cloudflare contesta "pong"
    // sin despertar la sala, así que la espera no consume tiempo activo.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      from_alias TEXT NOT NULL,
      to_alias TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      topic TEXT,
      reply_to TEXT,
      human INTEGER NOT NULL DEFAULT 0,
      agent TEXT
    )`);
  }

  // ---------- estado (lo chico va en un JSON; los mensajes en SQL)

  async load() {
    if (this.state === undefined) {
      this.state = (await this.ctx.storage.get("state")) || null;
      // Salas creadas con versiones anteriores
      if (this.state) {
        this.state.doc ||= { sections: [], seq: 0 };
        this.state.focus ??= null;
        this.state.notes ||= [];
        this.state.summary ??= null;
        this.state.visibility ||= "privada";
        this.state.invite ||= randomToken(12);
        migrate(this.state);
      }
    }
    return this.state;
  }

  // ---------- visibilidad e invitaciones

  invitePath() {
    const s = this.state;
    return s.visibility === "publica" ? `/rooms/${s.code}/unirse` : `/rooms/${s.code}/unirse#i=${s.invite}`;
  }

  async syncDirectory() {
    const s = this.state;
    if (!this.env.DIRECTORY) return;
    const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("public"));
    const listed = s.visibility === "publica" && !s.closed;
    const body = listed
      ? {
        code: s.code, name: s.name, brief: (s.brief || "").slice(0, 300), admin: s.admin,
        members: Object.values(s.members).filter((m) => m.active).length,
        agents: [...new Set(Object.values(s.members).filter((m) => m.active).map((m) => m.agent))],
      }
      : { code: s.code };
    try {
      await dir.fetch(`https://dir/${listed ? "upsert" : "remove"}`, { method: "POST", body: JSON.stringify(body) });
    } catch {}
  }

  // ---------- documento de la sala

  docOutline() {
    return this.state.doc.sections.map((x) => ({
      id: x.id, title: x.title, by: x.by, version: x.version, updatedAt: x.updatedAt, chars: x.body.length,
    }));
  }

  docMarkdown() {
    const s = this.state;
    const out = [`# ${s.name}`, "", `_Sala ${s.code} · exportado ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC_`, ""];
    if (s.brief) out.push("## Propósito", "", s.brief, "");
    if (s.summary) out.push("## Resumen de la conversación", "", s.summary.text, "", `_Cubre hasta m${s.summary.upTo} · ${s.summary.by}_`, "");
    if (s.notes.length) {
      out.push("## Contexto acumulado", "");
      for (const n of s.notes) out.push(`- ${n.text} _(${n.by}, ${n.at.slice(0, 10)})_`);
      out.push("");
    }
    for (const x of s.doc.sections) {
      out.push(`## ${x.title}`, "", x.body, "", `_Autor/es: ${[...new Set(x.authors)].join(", ")} · v${x.version}_`, "");
    }
    if (s.decisions.length) {
      out.push("## Anexo: decisiones", "");
      for (const d of s.decisions) out.push(`- **${d.id}** ${d.text}${d.why ? ` — ${d.why}` : ""} (${d.by})`);
      out.push("");
    }
    if (s.learnings.length) {
      out.push("## Anexo: aprendizajes", "");
      for (const l of s.learnings) out.push(`- **${l.id}** [${l.scope}] ${l.text}${l.verify ? ` — verificar: ${l.verify}` : ""} (${l.by})`);
      out.push("");
    }
    return out.join("\n");
  }

  async save() {
    this.state.lastActivity = Date.now();
    await this.ctx.storage.put("state", this.state);
  }

  // ---------- mensajes

  row(r) {
    return {
      seq: r.seq, id: `m${r.seq}`, at: r.at, from: r.from_alias, to: r.to_alias, type: r.type,
      body: r.body, topic: r.topic, reply_to: r.reply_to, human: !!r.human, agent: r.agent,
    };
  }

  lastSeq() {
    return this.sql.exec("SELECT COALESCE(MAX(seq), 0) AS s FROM messages").one().s;
  }

  addMessage({ from, to, type, body, topic, reply_to, human = false, agent = null }) {
    const at = new Date().toISOString();
    const r = this.sql.exec(
      `INSERT INTO messages (at, from_alias, to_alias, type, body, topic, reply_to, human, agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      at, from, to, type, body, topic || null, reply_to || null, human ? 1 : 0, agent,
    ).one();
    return this.row(r);
  }

  system(body) {
    return this.addMessage({ from: "sala", to: "*", type: "info", body, agent: "sala" });
  }

  // No leídos para el agente `alias`: dirigidos a él o a todos, que no haya escrito él mismo
  // (salvo los que escribió su propio humano desde el visor).
  unreadFor(alias) {
    const cursor = this.state.cursors[alias] || 0;
    return this.sql.exec(
      `SELECT * FROM messages WHERE seq > ? AND (to_alias = '*' OR to_alias = ?)
       AND (from_alias != ? OR human = 1) ORDER BY seq`,
      cursor, alias, alias,
    ).toArray().map((r) => this.row(r));
  }

  // Mensajes visibles para un alias, anteriores a `before` (para leer el historial hacia atrás).
  visibleBefore(alias, before, limit) {
    return this.sql.exec(
      `SELECT * FROM messages WHERE seq < ? AND (to_alias = '*' OR to_alias = ? OR from_alias = ?)
       ORDER BY seq DESC LIMIT ?`,
      before, alias, alias, limit,
    ).toArray().reverse().map((r) => this.row(r));
  }

  countVisibleSince(alias, since) {
    return this.sql.exec(
      `SELECT COUNT(*) AS n FROM messages WHERE seq > ? AND (to_alias = '*' OR to_alias = ? OR from_alias = ?)`,
      since, alias, alias,
    ).one().n;
  }

  publicSince(since) {
    return this.sql.exec("SELECT COUNT(*) AS n FROM messages WHERE seq > ? AND to_alias = '*' AND from_alias != 'sala'", since).one().n;
  }

  // Mensajes visibles para un alias (o todos si `all`), posteriores a `since`.
  visibleSince(alias, since, { all = false, limit = 500 } = {}) {
    const rows = all
      // El admin ve todo, salvo el canal privado de cada participante con su propio agente (from = to).
      ? this.sql.exec(
        "SELECT * FROM messages WHERE seq > ? AND NOT (from_alias = to_alias AND from_alias != ?) ORDER BY seq DESC LIMIT ?",
        since, alias, limit,
      )
      : this.sql.exec(
        `SELECT * FROM messages WHERE seq > ? AND (to_alias = '*' OR to_alias = ? OR from_alias = ?)
         ORDER BY seq DESC LIMIT ?`,
        since, alias, alias, limit,
      );
    return rows.toArray().reverse().map((r) => this.row(r));
  }

  // ---------- notificaciones

  changed() {
    for (const w of [...this.waiters]) w();
    this.broadcast();
  }

  sidebar() {
    const s = this.state;
    return {
      room: { code: s.code, name: s.name, admin: s.admin, createdAt: s.createdAt, closed: s.closed, visibility: s.visibility },
      focus: s.focus || null,
      brief: s.brief,
      doc: s.doc.sections,
      notes: s.notes,
      summary: s.summary,
      polls: s.polls.map((p) => pollView(this, p)),
      files: s.files,
      settings: settingsView(s),
      hasConclusion: !!s.conclusion,
      decisions: s.decisions,
      learnings: s.learnings,
      tasks: s.tasks,
      proposals: s.proposals.filter((p) => p.status === "pendiente"),
      peers: Object.values(s.members).map((m) => this.publicMember(m)),
      online: this.presence(),
    };
  }

  // Quién está conectado ahora: el agente (espera abierta, o actividad en los últimos 3 min)
  // y su humano (visor abierto). `closing` es un socket que se está cerrando y no cuenta.
  presence(closing = null) {
    const online = {};
    const of = (a) => (online[a] ||= { agent: false, human: false });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue;
      const att = ws.deserializeAttachment();
      if (!att?.alias) continue;
      of(att.alias)[att.kind === "agent" ? "agent" : "human"] = true;
    }
    for (const m of Object.values(this.state.members)) {
      if (m.active && m.lastSeen && Date.now() - Date.parse(m.lastSeen) < 3 * 60_000) of(m.alias).agent = true;
    }
    return online;
  }

  broadcast(closing = null) {
    if (!this.state) return;
    const sidebar = this.sidebar();
    if (closing) sidebar.online = this.presence(closing);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue;
      const att = ws.deserializeAttachment();
      if (!att?.alias) continue;
      if (att.kind === "agent") { this.notifyAgent(ws, att); continue; }
      try {
        const messages = this.visibleSince(att.alias, att.last || 0, { all: att.alias === this.state.admin });
        if (messages.length) att.last = messages[messages.length - 1].seq;
        ws.serializeAttachment(att);
        ws.send(JSON.stringify({ type: "update", messages, sidebar, me: this.viewerMe(att.alias) }));
      } catch {}
    }
  }

  // Espera de un agente por WebSocket: solo recibe el aviso de que tiene mensajes sin leer.
  notifyAgent(ws, att) {
    const s = this.state;
    try {
      if (s.tokens[att.token] !== att.alias || !s.members[att.alias]?.active) {
        ws.send(JSON.stringify({ type: "error", status: 401, error: "Token inválido o fuiste removido de la sala" }));
        return ws.close(4001, "no autorizado");
      }
      if (s.closed) {
        ws.send(JSON.stringify({ type: "error", status: 410, error: "La sala fue cerrada por el admin" }));
        return ws.close(4010, "sala cerrada");
      }
      const unread = this.unreadFor(att.alias);
      if (unread.length) ws.send(JSON.stringify({ type: "unread", unread: unread.length, from: [...new Set(unread.map((m) => (m.human ? `${m.from} (humano)` : m.from)))] }));
    } catch {}
  }

  // Cierra los visores de un alias (no la espera de su agente).
  closeSockets(alias, reason) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att?.alias === alias && att.kind !== "agent") {
        try { ws.send(JSON.stringify({ type: "error", error: reason })); ws.close(4001, "revocado"); } catch {}
      }
    }
  }

  // ---------- miembros y credenciales

  publicMember(m) {
    return {
      alias: m.alias, role: m.role, agent: m.agent, description: m.description, papel: m.papel || null,
      active: m.active, joinedAt: m.joinedAt, lastSeen: m.lastSeen,
    };
  }

  auth(req) {
    const h = req.headers.get("authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    const alias = token && this.state.tokens[token];
    if (!alias) return null;
    const member = this.state.members[alias];
    if (!member || !member.active) return null;
    member.lastSeen = new Date().toISOString();
    return member;
  }

  issueToken(alias) {
    const s = this.state;
    for (const [t, a] of Object.entries(s.tokens)) if (a === alias) delete s.tokens[t];
    const token = randomToken();
    s.tokens[token] = alias;
    return token;
  }

  revoke(alias) {
    const s = this.state;
    for (const [t, a] of Object.entries(s.tokens)) if (a === alias) delete s.tokens[t];
    for (const [k, a] of Object.entries(s.viewers)) if (a === alias) delete s.viewers[k];
  }

  viewerMe(alias) {
    return { alias, admin: alias === this.state.admin };
  }

  contextFor(me, { messages = 15, catchup = false } = {}) {
    const s = this.state;
    const upTo = s.summary?.upTo || 0;
    // Ponerse al día: todo lo posterior al resumen (hasta 300); si no, los últimos N.
    const limit = catchup ? 300 : Math.min(Math.max(Number(messages) || 15, 1), 300);
    const recent = this.visibleSince(me.alias, catchup ? upTo : 0, { limit });
    return {
      summary: s.summary || null,
      sinceSummary: this.publicSince(upTo),
      afterSummaryTotal: this.countVisibleSince(me.alias, upTo),
      catchup,
      room: { code: s.code, name: s.name, admin: s.admin, createdAt: s.createdAt, closed: s.closed, visibility: s.visibility },
      me: { alias: me.alias, role: me.role, agent: me.agent },
      focus: s.focus || null,
      brief: s.brief,
      notes: s.notes,
      doc: this.docOutline(),
      polls: s.polls.filter((p) => p.status === "abierta").map((p) => pollView(this, p)),
      recentPolls: s.polls.filter((p) => p.status === "cerrada").slice(-5).map((p) => ({ id: p.id, question: p.question, result: p.result })),
      files: s.files,
      settings: settingsView(s),
      budget: budgetUsage(this, me.alias),
      conclusion: s.conclusion,
      decisions: s.decisions,
      learnings: s.learnings,
      totalMessages: this.lastSeq(),
      proposals: s.proposals.filter((p) => p.status === "pendiente"),
      tasks: s.tasks.filter((t) => !["hecha", "rechazada"].includes(t.status)),
      peers: Object.values(s.members).filter((m) => m.active).map((m) => this.publicMember(m)),
      recent,
      unread: this.unreadFor(me.alias).length,
    };
  }

  newMember(alias, role, body) {
    const now = new Date().toISOString();
    return {
      alias, role,
      agent: cleanAgent(body.agent),
      description: String(body.description || "").slice(0, 300),
      active: true, joinedAt: now, lastSeen: now,
    };
  }

  // ---------- WebSocket del visor (API de hibernación)

  async webSocketMessage(ws, data) {
    const s = await this.load();
    if (!s) return ws.close(4004, "sala inexistente");
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === "agent-auth") {
      const token = String(msg.token || "");
      const alias = s.tokens[token];
      if (!alias || !s.members[alias]?.active) {
        ws.send(JSON.stringify({ type: "error", status: 401, error: "Token inválido o fuiste removido de la sala" }));
        return ws.close(4001, "no autorizado");
      }
      s.members[alias].lastSeen = new Date().toISOString();
      const att = { alias, kind: "agent", token };
      ws.serializeAttachment(att);
      ws.send(JSON.stringify({ type: "ready" }));
      this.notifyAgent(ws, att);
      return this.broadcast(); // presencia: el agente quedó conectado
    }

    if (msg.type === "auth") {
      const alias = s.viewers[await sha256(String(msg.key || ""))];
      if (!alias || !s.members[alias]?.active) {
        ws.send(JSON.stringify({ type: "error", error: "Link inválido o vencido. Pedile a tu agente uno nuevo (collab_visor)." }));
        return ws.close(4001, "no autorizado");
      }
      const all = alias === s.admin;
      const messages = this.visibleSince(alias, 0, { all, limit: 300 });
      ws.serializeAttachment({ alias, last: messages.length ? messages[messages.length - 1].seq : 0 });
      ws.send(JSON.stringify({ type: "hello", messages, sidebar: this.sidebar(), me: this.viewerMe(alias) }));
      return this.broadcast(); // presencia: el humano abrió el visor
    }

    const att = ws.deserializeAttachment();
    if (!att?.alias) return ws.send(JSON.stringify({ type: "error", error: "Falta autenticar" }));
    if (att.kind === "agent") return; // la espera de un agente no actúa como visor

    if (await handleViewerMessage(this, ws, att, msg)) return;

    if (msg.type === "invite") {
      if (att.alias !== s.admin) return ws.send(JSON.stringify({ type: "error", error: "Solo el admin invita" }));
      return ws.send(JSON.stringify({ type: "invite", path: this.invitePath(), visibility: s.visibility }));
    }

    if (msg.type === "doc") {
      return ws.send(JSON.stringify({ type: "doc", markdown: this.docMarkdown(), filename: `${s.code}.md` }));
    }

    if (msg.type === "focus") {
      if (att.alias !== s.admin) return ws.send(JSON.stringify({ type: "error", error: "Solo el admin cambia el foco" }));
      const r = this.setFocus(msg.task || null, `${att.alias} (humano)`);
      if (r) return ws.send(JSON.stringify({ type: "error", error: r }));
      await this.save();
      return this.changed();
    }

    if (msg.type === "say") {
      if (s.closed) return ws.send(JSON.stringify({ type: "error", error: "La sala está cerrada" }));
      const text = String(msg.body || "").trim().slice(0, 5000);
      if (!text) return;
      const to = String(msg.to || "*");
      if (to !== "*" && !s.members[to]?.active) return ws.send(JSON.stringify({ type: "error", error: `${to} no está activo` }));
      this.addMessage({ from: att.alias, to, type: "humano", body: text, human: true, agent: "humano" });
      await this.save();
      this.changed();
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "chau"); } catch {}
    const att = ws.deserializeAttachment();
    if (att?.alias && (await this.load())) this.broadcast(ws); // presencia: alguien se desconectó
  }

  // ---------- HTTP

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Página del visor (pública; la credencial va en el fragmento #k=... y se manda por WebSocket)
    if (path === "/ver" && method === "GET") return html(viewerHtml());

    // Página de invitación (la credencial de invitación va en el fragmento #i=...)
    if (path === "/unirse" && method === "GET") return html(inviteHtml());

    if (path === "/ws") {
      if (req.headers.get("upgrade") !== "websocket") return err(426, "Se esperaba WebSocket");
      if (!(await this.load())) return err(404, "La sala no existe");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Archivos: rutas con token de un solo uso (visor) y subida de agentes (cuerpo binario)
    if (path.startsWith("/files")) {
      const st = await this.load();
      if (!st) return err(404, "La sala no existe");
      const r = await handleOneTimeRoute(this, req, path, url);
      if (r) return r;
      if (path === "/files" && method === "POST") {
        if (st.closed) return err(410, "La sala fue cerrada por el admin");
        const who = this.auth(req);
        if (!who) return err(401, "Token inválido o fuiste removido de la sala");
        return storeFile(this, req, who.alias, who.agent, url);
      }
    }

    const body = method === "POST" ? await readJson(req) : {};
    if (body === null) return err(400, "JSON inválido");

    // ---- Crear sala (interno)
    if (path === "/init" && method === "POST") {
      if (await this.load()) return err(409, "Código en uso");
      const alias = String(body.alias || "");
      if (!ALIAS_RE.test(alias)) return err(400, "Alias inválido (letras, números, . _ -; máx 32)");
      const recovery = randomToken(12);
      this.state = {
        code: body.code,
        name: String(body.name || body.code).slice(0, 80),
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
        closed: false,
        admin: alias,
        recoveryHash: await sha256(recovery),
        members: { [alias]: this.newMember(alias, "admin", body) },
        banned: [],
        tokens: {},
        viewers: {},
        cursors: {},
        brief: String(body.brief || "").trim().slice(0, 20000),
        doc: { sections: [], seq: 0 },
        notes: [],
        summary: null,
        decisions: [],
        learnings: [],
        proposals: [],
        tasks: [],
        focus: null,
        visibility: body.visibility === "publica" ? "publica" : "privada",
        invite: randomToken(12),
        counters: { task: 0, decision: 0, proposal: 0, learning: 0 },
      };
      migrate(this.state);
      const token = this.issueToken(alias);
      this.system(`Sala ${this.state.visibility} creada por ${alias} (${this.state.members[alias].agent}, admin).${this.state.brief ? `\nPropósito: ${this.state.brief.slice(0, 500)}` : ""}`);
      this.state.cursors[alias] = this.lastSeq();
      await this.save();
      await this.syncDirectory();
      return json({
        code: this.state.code, name: this.state.name, alias, role: "admin", token, recovery,
        visibility: this.state.visibility, invite_path: this.invitePath(),
      }, 201);
    }

    const s = await this.load();
    if (!s) return err(404, "La sala no existe");

    // ---- Recuperar admin
    if (path === "/recover" && method === "POST") {
      if ((await sha256(String(body.recovery || ""))) !== s.recoveryHash) return err(403, "Código de recuperación incorrecto");
      s.members[s.admin].active = true;
      if (body.agent) s.members[s.admin].agent = cleanAgent(body.agent);
      const token = this.issueToken(s.admin);
      this.system(`${s.admin} recuperó el acceso de admin.`);
      await this.save();
      this.changed();
      return json({ code: s.code, name: s.name, alias: s.admin, role: "admin", token });
    }

    // Sala cerrada: solo lectura (acta, contexto, documento, historial, archivos)
    const readOnly = method === "GET" && ["/export", "/acta", "/context", "/doc", "/history", "/learnings", "/files", "/polls", "/peers"].includes(path);
    if (s.closed && !readOnly && !/^\/files\/f\d+$/.test(path)) return err(410, "La sala fue cerrada por el admin");

    // ---- Vista previa para la página de invitación (sin token de agente)
    if (path === "/preview" && method === "POST") {
      const allowed = s.visibility === "publica" || String(body.invite || "") === s.invite;
      if (!allowed) return err(403, "Invitación inválida o vencida. Pedile al admin un link nuevo.");
      const active = Object.values(s.members).filter((m) => m.active);
      return json({
        code: s.code, name: s.name, brief: s.brief, visibility: s.visibility, admin: s.admin,
        peers: active.map((m) => ({ alias: m.alias, agent: m.agent, role: m.role })),
        notes: s.notes.length, messages: this.lastSeq(), doc: s.doc.sections.length,
      });
    }

    // ---- Unirse
    if (path === "/join" && method === "POST") {
      const alias = String(body.alias || "");
      if (!ALIAS_RE.test(alias)) return err(400, "Alias inválido (letras, números, . _ -; máx 32)");
      if (["sala", "humano"].includes(alias.toLowerCase())) return err(400, "Alias reservado");
      if (s.banned.includes(alias)) return err(403, "Ese alias fue expulsado de la sala");
      if (s.visibility === "privada" && String(body.invite || "") !== s.invite) {
        return err(403, "Sala privada: hace falta el link de invitación vigente. Pedíselo al admin.");
      }
      const existing = s.members[alias];
      if (existing?.active) return err(409, "Ese alias ya está en la sala; elegí otro");
      if (existing?.role === "admin") return err(409, "Ese alias es del admin; usá recuperación");
      s.members[alias] = { ...this.newMember(alias, "invitado", body), joinedAt: existing?.joinedAt || new Date().toISOString() };
      const token = this.issueToken(alias);
      const m = s.members[alias];
      this.system(`${alias} se unió (${m.agent})${m.description ? ` — ${m.description.slice(0, 120)}` : ""}.`);
      s.cursors[alias] = this.lastSeq();
      await this.save();
      this.changed();
      await this.syncDirectory();
      return json({ code: s.code, name: s.name, alias, role: "invitado", token, visibility: s.visibility }, 201);
    }

    // ---- A partir de acá, todo requiere token de agente
    const me = this.auth(req);
    if (!me) return err(401, "Token inválido o fuiste removido de la sala");
    const isAdmin = me.role === "admin";

    const featureResponse = await handleAgentRoute(this, { path, method, body, me, isAdmin, url });
    if (featureResponse) return featureResponse;

    if (path === "/peers" && method === "GET") {
      return json({ peers: Object.values(s.members).filter((m) => m.active).map((m) => this.publicMember(m)) });
    }

    if (path === "/context" && method === "GET") {
      await this.save();
      return json(this.contextFor(me, { messages: url.searchParams.get("messages"), catchup: url.searchParams.get("catchup") === "1" }));
    }

    // Historial hacia atrás: GET /history?before=<seq>&limit=N
    if (path === "/history" && method === "GET") {
      const before = Number(url.searchParams.get("before")) || this.lastSeq() + 1;
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      const messages = this.visibleBefore(me.alias, before, limit);
      return json({ messages, more: messages.length ? messages[0].seq > 1 : false });
    }

    // Resumen vivo del chat (cualquiera lo actualiza; lo normal es el agente del admin)
    if (path === "/summary" && method === "POST") {
      const text = String(body.text || "").trim();
      if (!text) return err(400, "Falta el texto del resumen");
      const last = this.lastSeq();
      const upTo = body.up_to ? Math.min(Number(String(body.up_to).replace(/^m/, "")) || last, last) : last;
      if (s.summary && upTo < s.summary.upTo) return err(409, `Ya hay un resumen hasta m${s.summary.upTo}; resumí desde ahí en adelante`);
      s.summary = { text: text.slice(0, 30000), upTo, by: me.alias, at: new Date().toISOString(), version: (s.summary?.version || 0) + 1 };
      this.system(`Resumen del chat actualizado por ${me.alias} (cubre hasta m${upTo}, v${s.summary.version}).`);
      await this.save();
      this.changed();
      return json({ ok: true, summary: s.summary });
    }

    // Contexto acumulado: cualquiera suma notas; nada se pisa
    if (path === "/notes" && method === "POST") {
      const text = String(body.text || "").trim();
      if (!text) return err(400, "Falta el texto");
      if (s.notes.length >= 500) return err(400, "Se llegó al máximo de 500 notas de contexto");
      s.counters.note = (s.counters.note || 0) + 1;
      const n = { id: `c${s.counters.note}`, text: text.slice(0, 4000), by: me.alias, at: new Date().toISOString() };
      s.notes.push(n);
      this.addMessage({ from: me.alias, to: "*", type: "info", agent: me.agent, topic: n.id, body: `Contexto agregado ${n.id}: ${n.text}` });
      await this.save();
      this.changed();
      return json({ ok: true, note: n }, 201);
    }

    if (path === "/messages" && method === "POST") {
      const to = String(body.to || "*");
      const type = String(body.type || "info");
      const text = String(body.body || "").trim();
      if (!text) return err(400, "El mensaje está vacío");
      if (text.length > 20000) return err(400, "Mensaje demasiado largo (máx 20000 caracteres)");
      if (!AGENT_TYPES.includes(type)) return err(400, `Tipo inválido. Usá: ${AGENT_TYPES.join(", ")}`);
      if (to !== "*" && !s.members[to]?.active) return err(404, `No hay nadie activo con alias ${to}`);
      const gate = gateAgentMessage(this, me, to);
      if (gate) return gate;
      const msg = this.addMessage({ from: me.alias, to, type, body: text, topic: body.topic, reply_to: body.reply_to, agent: me.agent });
      await this.save();
      this.changed();
      return json({ ok: true, message: msg }, 201);
    }

    if (path === "/unread" && method === "GET") {
      const unread = this.unreadFor(me.alias);
      return json({
        unread: unread.length,
        from: [...new Set(unread.map((m) => (m.human ? `${m.from} (humano)` : m.from)))],
      });
    }

    if (path === "/inbox" && method === "GET") {
      const unread = this.unreadFor(me.alias);
      if (unread.length) s.cursors[me.alias] = unread[unread.length - 1].seq;
      await this.save();
      return json({ messages: unread });
    }

    if (path === "/wait" && method === "GET") {
      const timeout = Math.min(Math.max(Number(url.searchParams.get("timeout")) || 25, 1), MAX_WAIT_SECONDS);
      const check = () => this.unreadFor(me.alias).length;
      if (check() > 0) return json({ unread: check() });
      const n = await new Promise((resolve) => {
        let timer;
        const waiter = () => {
          const c = check();
          if (c > 0) { clearTimeout(timer); this.waiters.delete(waiter); resolve(c); }
        };
        timer = setTimeout(() => { this.waiters.delete(waiter); resolve(0); }, timeout * 1000);
        this.waiters.add(waiter);
      });
      return json({ unread: n });
    }

    // Link del visor para el humano de este agente (invalida el anterior)
    if (path === "/viewer-link" && method === "POST") {
      for (const [k, a] of Object.entries(s.viewers)) if (a === me.alias) delete s.viewers[k];
      this.closeSockets(me.alias, "Se generó un link nuevo; este quedó vencido.");
      const key = randomToken(18);
      s.viewers[await sha256(key)] = me.alias;
      await this.save();
      return json({ key, path: `/rooms/${s.code}/ver#k=${key}` });
    }

    if (path === "/tasks" && method === "POST") {
      const title = String(body.title || "").trim();
      if (!title) return err(400, "Falta el título");
      const owner = body.owner ? String(body.owner) : null;
      if (owner && !s.members[owner]?.active) return err(404, `No hay nadie activo con alias ${owner}`);
      s.counters.task += 1;
      const task = {
        id: `t${s.counters.task}`, title: title.slice(0, 200), detail: String(body.detail || "").slice(0, 5000),
        owner, createdBy: me.alias, status: "pendiente", notes: [], createdAt: new Date().toISOString(),
      };
      s.tasks.push(task);
      this.addMessage({
        from: me.alias, to: owner && owner !== me.alias ? owner : "*", type: "pedido", agent: me.agent, topic: task.id,
        body: `Nueva tarea ${task.id}: ${task.title}${owner ? ` (para ${owner})` : " (sin dueño)"}${task.detail ? `\n${task.detail}` : ""}`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, task }, 201);
    }

    const tm = path.match(/^\/tasks\/(t\d+)$/);
    if (tm && method === "POST") {
      const task = s.tasks.find((t) => t.id === tm[1]);
      if (!task) return err(404, "Tarea inexistente");
      if (body.status && !TASK_STATES.includes(body.status)) return err(400, `Estado inválido. Usá: ${TASK_STATES.join(", ")}`);
      if (task.owner && task.owner !== me.alias && task.createdBy !== me.alias && !isAdmin) {
        return err(403, "Solo el dueño, quien la creó o el admin pueden cambiarla");
      }
      if (body.owner !== undefined) {
        const owner = body.owner ? String(body.owner) : null;
        if (owner && !s.members[owner]?.active) return err(404, `No hay nadie activo con alias ${owner}`);
        task.owner = owner;
      }
      if (!task.owner && body.status === "aceptada") task.owner = me.alias;
      if (body.status) task.status = body.status;
      if (body.note) task.notes.push({ by: me.alias, at: new Date().toISOString(), text: String(body.note).slice(0, 3000) });
      this.addMessage({
        from: me.alias, to: "*", type: body.status === "hecha" ? "resultado" : "info", agent: me.agent, topic: task.id,
        body: `Tarea ${task.id} → ${task.status}${task.owner ? ` (dueño: ${task.owner})` : ""}${body.note ? `\n${body.note}` : ""}`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, task });
    }

    // ---- Documento de la sala (todos leen, todos escriben; secciones con control de versión)
    if (path === "/doc" && method === "GET") {
      return json({ sections: s.doc.sections, markdown: this.docMarkdown(), filename: `${s.code}.md` });
    }

    if (path === "/doc/sections" && method === "POST") {
      const title = String(body.title || "").trim().slice(0, 120);
      const text = String(body.body ?? "").slice(0, 60000);
      const now = new Date().toISOString();
      let sec = body.id ? s.doc.sections.find((x) => x.id === body.id) : null;
      if (body.id && !sec) return err(404, `Sección inexistente: ${body.id}`);
      if (!sec && !body.id) {
        if (!title) return err(400, "Falta el título de la sección");
        sec = s.doc.sections.find((x) => x.title.toLowerCase() === title.toLowerCase()) || null;
      }
      if (sec) {
        if (body.base_version !== undefined && Number(body.base_version) !== sec.version) {
          return json({
            error: `Conflicto: la sección cambió (está en v${sec.version}, partiste de v${body.base_version}). Integrá los cambios y reintentá con base_version=${sec.version}.`,
            section: sec,
          }, 409);
        }
        if (title) sec.title = title;
        sec.body = text;
        sec.version += 1;
        sec.by = me.alias;
        sec.authors.push(me.alias);
        sec.updatedAt = now;
      } else {
        if (s.doc.sections.length >= 100) return err(400, "El documento llegó al máximo de 100 secciones");
        s.doc.seq += 1;
        sec = { id: `s${s.doc.seq}`, title, body: text, version: 1, by: me.alias, authors: [me.alias], updatedAt: now };
        s.doc.sections.push(sec);
      }
      sec.authors = [...new Set(sec.authors)];
      this.addMessage({
        from: me.alias, to: "*", type: "info", agent: me.agent, topic: sec.id,
        body: `Documento: ${sec.version === 1 ? "nueva sección" : "actualizó la sección"} ${sec.id} «${sec.title}» (v${sec.version}, ${sec.body.length} caracteres).`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, section: sec }, sec.version === 1 ? 201 : 200);
    }

    const dm = path.match(/^\/doc\/sections\/(s\d+)\/delete$/);
    if (dm && method === "POST") {
      const i = s.doc.sections.findIndex((x) => x.id === dm[1]);
      if (i < 0) return err(404, "Sección inexistente");
      const sec = s.doc.sections[i];
      if (!isAdmin && !(sec.authors.length === 1 && sec.authors[0] === me.alias)) {
        return err(403, "Solo el admin o el único autor de la sección pueden borrarla");
      }
      s.doc.sections.splice(i, 1);
      this.addMessage({ from: me.alias, to: "*", type: "info", agent: me.agent, topic: sec.id, body: `Documento: borró la sección ${sec.id} «${sec.title}».` });
      await this.save();
      this.changed();
      return json({ ok: true });
    }

    if (path === "/focus" && method === "POST") {
      if (!isAdmin) return err(403, "Solo el admin cambia el foco (los demás pueden pedirlo por mensaje)");
      const r = this.setFocus(body.task || null, me.alias);
      if (r) return err(404, r);
      await this.save();
      this.changed();
      return json({ ok: true, focus: s.focus });
    }

    if ((path === "/brief" || path === "/decisions") && method === "POST") {
      const kind = path === "/brief" ? "brief" : "decision";
      const text = String(body.text || "").trim();
      if (!text) return err(400, "Falta el texto");
      const why = String(body.why || "").slice(0, 2000);
      const taskId = kind === "decision" && body.task ? String(body.task) : null;
      if (taskId && !s.tasks.some((t) => t.id === taskId)) return err(404, `Tarea inexistente: ${taskId}`);
      if (isAdmin) {
        this.applyChange(kind, text, why, me.alias, taskId);
        await this.save();
        this.changed();
        return json({ ok: true, applied: true });
      }
      s.counters.proposal += 1;
      const p = { id: `p${s.counters.proposal}`, kind, text: text.slice(0, 20000), why, task: taskId, by: me.alias, status: "pendiente", at: new Date().toISOString() };
      s.proposals.push(p);
      this.addMessage({
        from: me.alias, to: s.admin, type: "propuesta", agent: me.agent, topic: taskId || p.id,
        body: `Propuesta ${p.id} (${kind === "brief" ? "cambio de brief" : taskId ? `plan para ${taskId}` : "decisión"}) para aprobar:\n${text}${why ? `\nMotivo: ${why}` : ""}`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, applied: false, proposal: p }, 202);
    }

    if (path === "/learnings" && method === "POST") {
      const text = String(body.text || "").trim();
      if (!text) return err(400, "Falta el texto");
      const scope = body.scope === "entorno" ? "entorno" : "general";
      s.counters.learning += 1;
      const l = {
        id: `a${s.counters.learning}`, text: text.slice(0, 3000), scope,
        verify: String(body.how_to_verify || "").slice(0, 1000), by: me.alias, agent: me.agent, at: new Date().toISOString(),
      };
      s.learnings.push(l);
      this.addMessage({
        from: me.alias, to: "*", type: "info", agent: me.agent, topic: l.id,
        body: `Aprendizaje ${l.id} (${scope}): ${l.text}${l.verify ? `\nCómo verificar: ${l.verify}` : ""}`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, learning: l }, 201);
    }

    if (path === "/learnings" && method === "GET") return json({ learnings: s.learnings });

    const pm = path.match(/^\/proposals\/(p\d+)$/);
    if (pm && method === "POST") {
      if (!isAdmin) return err(403, "Solo el admin resuelve propuestas");
      const p = s.proposals.find((x) => x.id === pm[1]);
      if (!p) return err(404, "Propuesta inexistente");
      if (p.status !== "pendiente") return err(409, `La propuesta ya está ${p.status}`);
      if (!["aprobar", "rechazar"].includes(body.action)) return err(400, "action debe ser aprobar o rechazar");
      p.status = body.action === "aprobar" ? "aprobada" : "rechazada";
      if (p.status === "aprobada") this.applyChange(p.kind, p.text, p.why, p.by, p.task);
      this.addMessage({
        from: me.alias, to: "*", type: "acuerdo", agent: me.agent, topic: p.id,
        body: `Propuesta ${p.id} de ${p.by}: ${p.status}.${body.note ? ` ${body.note}` : ""}`,
      });
      await this.save();
      this.changed();
      return json({ ok: true, proposal: p });
    }

    if (path === "/leave" && method === "POST") {
      me.active = false;
      this.revoke(me.alias);
      this.closeSockets(me.alias, "Tu agente salió de la sala.");
      this.system(`${me.alias} salió de la sala.${isAdmin ? " (Es el admin: puede volver con su código de recuperación.)" : ""}`);
      this.syncDirectory();
      await this.save();
      this.changed();
      return json({ ok: true });
    }

    // ---- Solo admin
    if (["/kick", "/close", "/transfer", "/export", "/invite", "/visibility"].includes(path) && !isAdmin) {
      return err(403, "Solo el admin puede hacer eso");
    }

    // Link de invitación: actual o renovado (renovar invalida el anterior)
    if (path === "/invite" && method === "POST") {
      if (body.rotate) {
        s.invite = randomToken(12);
        this.system("El admin renovó el link de invitación; el anterior ya no sirve.");
        await this.save();
        this.changed();
      }
      return json({ visibility: s.visibility, invite_path: this.invitePath() });
    }

    if (path === "/visibility" && method === "POST") {
      const v = body.visibility === "publica" ? "publica" : body.visibility === "privada" ? "privada" : null;
      if (!v) return err(400, "visibility debe ser publica o privada");
      if (v !== s.visibility) {
        s.visibility = v;
        if (v === "privada") s.invite = randomToken(12); // los links viejos dejan de servir
        this.system(v === "publica"
          ? "La sala ahora es pública: aparece en el directorio y cualquiera puede unirse."
          : "La sala ahora es privada: solo se entra con el link de invitación vigente.");
        await this.save();
        this.changed();
        await this.syncDirectory();
      }
      return json({ visibility: s.visibility, invite_path: this.invitePath() });
    }

    if (path === "/export" && method === "GET") {
      const { tokens, viewers, recoveryHash, cursors, invite, oneTime, ...rest } = s;
      const messages = this.sql.exec("SELECT * FROM messages ORDER BY seq").toArray().map((r) => this.row(r));
      return json({ exportedAt: new Date().toISOString(), version: VERSION, room: rest, messages });
    }

    if (path === "/kick" && method === "POST") {
      const target = s.members[String(body.alias || "")];
      if (!target?.active) return err(404, "No hay nadie activo con ese alias");
      if (target.alias === me.alias) return err(400, "No podés expulsarte a vos mismo");
      target.active = false;
      s.banned.push(target.alias);
      this.revoke(target.alias);
      this.closeSockets(target.alias, "Fuiste expulsado de la sala.");
      this.system(`${target.alias} fue expulsado por el admin.`);
      this.syncDirectory();
      await this.save();
      this.changed();
      return json({ ok: true });
    }

    if (path === "/transfer" && method === "POST") {
      const target = s.members[String(body.alias || "")];
      if (!target?.active) return err(404, "No hay nadie activo con ese alias");
      me.role = "invitado";
      target.role = "admin";
      s.admin = target.alias;
      const recovery = randomToken(12);
      s.recoveryHash = await sha256(recovery);
      this.addMessage({
        from: "sala", to: target.alias, type: "info", agent: "sala",
        body: `Ahora sos admin de la sala. Tu código de recuperación es: ${recovery} — mostráselo a tu usuario para que lo guarde.`,
      });
      this.system(`${me.alias} transfirió el rol de admin a ${target.alias}.`);
      await this.save();
      this.changed();
      return json({ ok: true });
    }

    if (path === "/close" && method === "POST") {
      s.closed = true;
      this.system("El admin cerró la sala.");
      this.syncDirectory();
      await this.save();
      this.changed();
      return json({ ok: true });
    }

    return err(404, "Ruta inexistente");
  }

  setFocus(taskId, by) {
    const s = this.state;
    if (!taskId) {
      s.focus = null;
      this.system(`${by} quitó el foco: cada uno sigue con lo suyo.`);
      return null;
    }
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) return `Tarea inexistente: ${taskId}`;
    s.focus = { task: task.id, title: task.title, by, at: new Date().toISOString() };
    this.system(`Foco de la sala: ${task.id} — ${task.title} (lo puso ${by}). Todos colaboran en destrabarla.`);
    return null;
  }

  applyChange(kind, text, why, by, taskId = null) {
    const s = this.state;
    if (kind === "brief") {
      s.brief = text;
      this.system(`Propósito actualizado (por ${by}):\n${text.slice(0, 1500)}${text.length > 1500 ? "…" : ""}`);
      this.syncDirectory();
      return;
    }
    s.counters.decision += 1;
    const id = `d${s.counters.decision}`;
    s.decisions.push({ id, text, why, by, task: taskId, at: new Date().toISOString() });
    const task = taskId && s.tasks.find((t) => t.id === taskId);
    if (task) {
      task.plan = { decision: id, text };
      task.unlocked = true;
    }
    this.addMessage({
      from: "sala", to: "*", type: "acuerdo", agent: "sala", topic: taskId,
      body: task
        ? `Plan acordado para ${task.id} (${task.title}) — decisión ${id}: ${text}${why ? ` — Motivo: ${why}` : ""}. La tarea quedó destrabada; su dueño (${task.owner || "sin asignar"}) puede seguir solo.`
        : `Decisión ${id} registrada: ${text}${why ? ` — Motivo: ${why}` : ""}`,
    });
  }
}
