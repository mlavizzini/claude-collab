// Página del visor: chat en vivo de la sala, panel de contexto y mensajes de humanos.
export function viewerHtml() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Sala · collab</title>
<style>
:root {
  --bg: #f6f5f1; --surface: #ffffff; --surface-2: #efede6; --line: #e1ded4;
  --text: #1d1c19; --muted: #6d6a60; --faint: #9a968a;
  --accent: #c2562f; --accent-soft: #f6e4da;
  --human: #fff4d6; --human-line: #e8c766;
  --ok: #2f7d4f; --warn: #b7791f; --bad: #b4412f;
  --t-hallazgo: #2e6bc7; --t-propuesta: #7a4cc2; --t-objecion: #c2442e; --t-acuerdo: #2f7d4f;
  --t-pregunta: #b7791f; --t-pedido: #13807a; --t-resultado: #3e7d2f; --t-info: #7a776d; --t-humano: #a8631a;
  --a-claude: #c2562f; --a-codex: #2b2b2b; --a-sala: #9a968a; --a-otro: #4a6b8a;
  --shadow: 0 1px 2px rgba(20,18,12,.06), 0 4px 16px rgba(20,18,12,.05);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151513; --surface: #1e1d1b; --surface-2: #272623; --line: #34322e;
    --text: #ecebe6; --muted: #a5a296; --faint: #77746a;
    --accent: #e07a52; --accent-soft: #3a261d;
    --human: #3a3120; --human-line: #8a6d2a;
    --t-hallazgo: #6fa3f0; --t-propuesta: #b393ee; --t-objecion: #f08a73; --t-acuerdo: #6cc28e;
    --t-pregunta: #e6b45c; --t-pedido: #4fc4bd; --t-resultado: #8ccf6f; --t-info: #a5a296; --t-humano: #e6a45c;
    --a-claude: #e07a52; --a-codex: #d6d4cc; --a-sala: #77746a; --a-otro: #7fa3c4;
    --shadow: 0 1px 2px rgba(0,0,0,.3);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--text);
  font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: grid; grid-template-rows: auto 1fr; height: 100dvh; overflow: hidden;
}
.col { display: flex; flex-direction: column; min-height: 0; position: relative; }
.col > main { flex: 1 1 auto; }
.focusbar {
  display: none; align-items: center; gap: 10px; padding: 8px 16px; font-size: 13.5px;
  background: var(--accent-soft); border-bottom: 1px solid var(--line);
}
.focusbar strong { white-space: nowrap; }
.focusbar span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.focusbar .btn { padding: 3px 10px; font-size: 12.5px; }
.item.focused { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.item .plan { margin-top: 6px; font-size: 12.5px; border-left: 3px solid var(--ok); padding-left: 8px; }
.item .row { display: flex; justify-content: space-between; gap: 8px; align-items: start; }
.item .btn { padding: 2px 9px; font-size: 12px; flex-shrink: 0; }
.status.destrabada { color: var(--ok); }
.poll { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--surface); box-shadow: var(--shadow); }
.poll.required { border-color: var(--t-objecion); box-shadow: 0 0 0 1px var(--t-objecion) inset; }
.poll .q { font-weight: 600; margin-bottom: 4px; white-space: pre-wrap; }
.poll .ctx { font-size: 12.5px; color: var(--muted); margin-bottom: 8px; white-space: pre-wrap; }
.poll .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.poll .opt { border: 1px solid var(--line); background: var(--bg); border-radius: 999px; padding: 5px 12px; font-size: 13.5px; cursor: pointer; }
.poll .opt.mine { background: var(--accent); border-color: var(--accent); color: #fff; }
.poll .opt[disabled] { cursor: default; opacity: .85; }
.poll .foot { margin-top: 8px; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.poll .badge { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
.badge.req { background: var(--t-objecion); color: #fff; } .badge.opt-b { background: var(--surface-2); color: var(--muted); }
.badge.closed { background: var(--surface-2); color: var(--ok); }
.vote { font-size: 12.5px; color: var(--muted); text-align: center; margin: -6px auto 10px; max-width: 820px; }
.chip.papel { background: var(--accent-soft); color: var(--accent); border: none; }
.btn.on { background: var(--t-objecion); border-color: var(--t-objecion); color: #fff; }
.file { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.file button { flex-shrink: 0; }
.h2row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 18px 0 8px; }
.h2row h2 { margin: 0; }
.h2row .btn { padding: 3px 10px; font-size: 12.5px; }
details.sec { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; background: var(--bg); }
details.sec summary { cursor: pointer; padding: 8px 10px; font-size: 13.5px; list-style: none; }
details.sec summary::-webkit-details-marker { display: none; }
details.sec summary::before { content: "▸ "; color: var(--muted); }
details.sec[open] summary::before { content: "▾ "; }
details.sec .body { padding: 0 10px 10px; font-size: 13.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: var(--accent); }
header {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  padding-top: max(10px, env(safe-area-inset-top));
  background: var(--surface); border-bottom: 1px solid var(--line);
}
header .title { min-width: 0; flex: 1; }
header h1 { font-size: 16px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .sub { font-size: 12px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); display: inline-block; }
.dot.on { background: var(--ok); } .dot.off { background: var(--bad); }
button { font: inherit; color: inherit; cursor: pointer; }
.btn { border: 1px solid var(--line); background: var(--surface-2); border-radius: 10px; padding: 7px 12px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.layout { display: grid; grid-template-columns: 1fr; min-height: 0; }
@media (min-width: 900px) { .layout { grid-template-columns: 1fr 360px; } #togglePanel { display: none; } }
#chat { overflow-y: auto; padding: 16px; min-height: 0; scroll-behavior: smooth; }
.msg { display: grid; grid-template-columns: 32px 1fr; gap: 10px; margin: 0 auto 14px; max-width: 820px; }
.avatar {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
  font-weight: 700; font-size: 13px; color: #fff; background: var(--a-otro);
}
.avatar.claude { background: var(--a-claude); } .avatar.codex { background: var(--a-codex); color: var(--bg); }
.avatar.sala { background: transparent; color: var(--faint); border: 1px dashed var(--line); }
.avatar.humano { background: var(--human-line); color: #2a210c; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
.meta .who { font-weight: 650; color: var(--text); font-size: 13.5px; }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.5; }
.chip.agent { border: none; background: var(--surface-2); color: var(--muted); }
.chip.private { border-style: dashed; color: var(--muted); }
.bubble {
  background: var(--surface); border: 1px solid var(--line); border-radius: 4px 14px 14px 14px;
  padding: 9px 12px; box-shadow: var(--shadow); white-space: pre-wrap; overflow-wrap: anywhere;
}
.msg.human .bubble { background: var(--human); border-color: var(--human-line); }
.msg.sys { grid-template-columns: 1fr; text-align: center; }
.msg.sys .bubble { background: transparent; border: none; box-shadow: none; color: var(--faint); font-size: 12.5px; padding: 2px; }
.bubble code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--surface-2); padding: 1px 4px; border-radius: 4px; }
.bubble pre { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--surface-2); padding: 8px 10px; border-radius: 8px; overflow-x: auto; white-space: pre; margin: 6px 0; }
.reply { font-size: 12px; color: var(--muted); }
.empty { text-align: center; color: var(--muted); margin-top: 20vh; padding: 0 16px; }
#newBelow { position: absolute; left: 50%; transform: translateX(-50%); bottom: 100px; display: none; z-index: 5; }
aside {
  background: var(--surface); border-left: 1px solid var(--line); overflow-y: auto; min-height: 0; padding: 4px 16px 24px;
}
@media (max-width: 899px) {
  aside { position: fixed; inset: 0; z-index: 20; transform: translateX(100%); transition: transform .2s ease; border-left: none;
    padding-top: max(8px, env(safe-area-inset-top)); }
  aside.open { transform: none; }
}
aside .close { display: none; float: right; margin-top: 8px; }
@media (max-width: 899px) { aside .close { display: inline-block; } }
aside h2 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 18px 0 8px; }
.item { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; font-size: 13.5px; background: var(--bg); }
.item .small { font-size: 12px; color: var(--muted); }
.peer { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
.peer .avatar { width: 28px; height: 28px; font-size: 12px; border-radius: 8px; }
.peer .info { min-width: 0; font-size: 13.5px; }
.peer .who { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); margin-right: 5px; vertical-align: 1px; }
.dot.on { background: var(--ok); }
.peer .info .small { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); }
.status.hecha { color: var(--ok); } .status.bloqueada, .status.rechazada { color: var(--bad); } .status.en_curso, .status.aceptada { color: var(--t-hallazgo); }
.brief { white-space: pre-wrap; font-size: 13.5px; }
footer {
  background: var(--surface); border-top: 1px solid var(--line); padding: 10px 16px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}
.composer { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: end; max-width: 820px; margin: 0 auto; }
select, textarea {
  font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px;
}
select { max-width: 130px; }
@media (max-width: 600px) { select { max-width: 92px; padding: 8px 6px; } .composer { gap: 6px; } }
textarea { resize: none; min-height: 40px; max-height: 140px; width: 100%; }
textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.hint { font-size: 11.5px; color: var(--faint); max-width: 820px; margin: 6px auto 0; }
.banner { background: var(--accent-soft); color: var(--text); padding: 10px 16px; font-size: 13.5px; border-bottom: 1px solid var(--line); display: none; }
</style>
</head>
<body>
<header>
  <div class="title">
    <h1 id="roomName">Sala</h1>
    <div class="sub"><span class="dot" id="dot"></span><span id="conn">Conectando…</span><span id="roomCode"></span></div>
  </div>
  <button class="btn" id="silenceBtn" type="button" style="display:none" title="Silenciar">Silenciar</button>
  <button class="btn" id="inviteBtn" type="button" style="display:none">Invitar</button>
  <button class="btn" id="mcpBtn" type="button" style="display:none" title="Conectar claude.ai, ChatGPT u otro chat web a la sala como agente tuyo">Chat web</button>
  <button class="btn" id="togglePanel" aria-controls="panel">Panel</button>
</header>
<div class="layout">
  <div class="col">
    <div class="banner" id="banner"></div>
    <div class="focusbar" id="focusbar"><strong>Foco</strong><span id="focusText"></span><button class="btn" id="clearFocus" type="button">Quitar</button></div>
    <main id="chat" aria-live="polite"><div class="empty" id="empty">Cargando la conversación…</div></main>
    <footer>
      <form class="composer" id="form">
        <select id="to" aria-label="Destinatario"><option value="*">Todos</option></select>
        <textarea id="text" rows="1" placeholder="Escribí…" aria-label="Mensaje"></textarea>
        <button class="btn primary" id="send" type="submit" disabled>Enviar</button>
      </form>
      <div class="hint" id="hint">Tu agente toma lo que escribas acá como indicación tuya; los demás agentes lo toman como información.</div>
    </footer>
    <button class="btn primary" id="newBelow">Mensajes nuevos ↓</button>
  </div>
  <aside id="panel" aria-label="Contexto de la sala">
    <button class="btn close" id="closePanel">Cerrar</button>
    <h2>Participantes</h2><div id="peers"></div>
    <div class="h2row"><h2>Archivos</h2><label class="btn" id="uploadLbl" style="padding:3px 10px;font-size:12.5px;cursor:pointer">Subir<input type="file" id="uploadInput" hidden></label></div>
    <div id="files"></div>
    <h2>Propósito</h2><div id="brief" class="brief small"></div>
    <h2>Resumen del chat</h2><div id="summary"></div>
    <h2>Contexto acumulado</h2><div id="notes"></div>
    <div class="h2row"><h2>Acta</h2><button class="btn" id="downloadActa" type="button">Descargar acta</button></div>
    <div class="h2row"><h2>Documento</h2><button class="btn" id="downloadDoc" type="button">Descargar .md</button></div>
    <div id="doc"></div>
    <h2>Consultas</h2><div id="polls"></div>
    <h2>Tareas</h2><div id="tasks"></div>
    <h2>Propuestas pendientes</h2><div id="proposals"></div>
    <h2>Decisiones</h2><div id="decisions"></div>
    <h2>Aprendizajes</h2><div id="learnings"></div>
  </aside>
</div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = (s) => esc(s)
    .replace(/\\\`\\\`\\\`[a-zA-Z0-9_-]*\\n?([\\s\\S]*?)\\\`\\\`\\\`/g, (_, code) => "<pre>" + code.replace(/\\n$/, "") + "</pre>")
    .replace(/\\\`([^\\\`\\n]+)\\\`/g, "<code>$1</code>")
    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/(^|[\\s(])(https?:\\/\\/[^\\s<)"']+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const time = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const agentClass = (a) => (a === "claude" || a === "codex" || a === "sala" || a === "humano") ? a : "otro";
  const presenceHtml = (on, label) => '<span title="' + (on ? "conectado" : "no conectado") + '"><span class="dot' + (on ? " on" : "") + '"></span>' + esc(label) + "</span>";
  const agentLabel = (a) => ({ claude: "Claude", codex: "Codex", web: "chat web", humano: "humano", sala: "sala" }[a] || a || "agente");

  let key = new URLSearchParams(location.hash.slice(1)).get("k");
  try {
    const store = "collab:" + location.pathname;
    if (key) { sessionStorage.setItem(store, key); history.replaceState(null, "", location.pathname); }
    else key = sessionStorage.getItem(store);
  } catch {}

  const chat = $("chat"), empty = $("empty");
  let ws, me = null, sidebar = null, retry = 0, seen = new Set(), peers = {};

  function setConn(state, text) {
    $("dot").className = "dot " + state; $("conn").textContent = text;
    $("send").disabled = state !== "on" || !$("text").value.trim();
  }
  // Con ms, el cartel se oculta solo (si nadie lo reemplazó antes).
  let bannerTimer;
  function banner(text, ms) {
    const b = $("banner"); clearTimeout(bannerTimer);
    b.textContent = text || ""; b.style.display = text ? "block" : "none";
    if (text && ms) bannerTimer = setTimeout(() => { if (b.textContent === text) banner(""); }, ms);
  }

  function nearBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120; }

  function pollHtml(p) {
    if (!p) return '<div class="small">Consulta no disponible.</div>';
    const myVote = me && p.votes[me.alias];
    const canVote = me && p.status === "abierta" && p.eligible.includes(me.alias);
    const faltan = p.eligible.filter((a) => p.votes[a] === undefined);
    return '<div class="poll' + (p.required && p.status === "abierta" ? " required" : "") + '">' +
      '<div class="q">' + esc(p.question) + "</div>" +
      (p.context ? '<div class="ctx">' + esc(p.context) + "</div>" : "") +
      '<div class="opts">' + p.options.map((o, i) =>
        '<button class="opt' + (myVote === i ? " mine" : "") + '" data-vote="' + esc(p.id) + '" data-opt="' + i + '"' + (canVote ? "" : " disabled") + ">" +
        esc(o) + " · " + p.counts[i] + "</button>").join("") + "</div>" +
      '<div class="foot"><span>' +
      (p.status === "abierta"
        ? (p.required ? '<span class="badge req">Necesita respuesta para avanzar</span> ' : '<span class="badge opt-b">Opcional</span> ') +
          (faltan.length ? "Faltan: " + esc(faltan.join(", ")) : "")
        : '<span class="badge closed">Cerrada</span> Resultado: <strong>' + esc(p.result) + "</strong>") +
      "</span>" +
      (p.status === "abierta" && !p.required && p.default ? "<span>Si nadie responde: " + esc(p.default) + "</span>" : "") +
      (p.status === "abierta" && me && me.admin ? '<button class="opt" data-closepoll="' + esc(p.id) + '">Cerrar</button>' : "") +
      "</div></div>";
  }
  function renderPoll(node) {
    const p = (sidebar && sidebar.polls || []).find((x) => x.id === node.dataset.poll);
    node.innerHTML = pollHtml(p);
  }
  document.addEventListener("click", (e) => {
    const v = e.target.closest("[data-vote]");
    if (v && !v.disabled && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: "vote", poll: v.dataset.vote, option: Number(v.dataset.opt) })); return; }
    const c = e.target.closest("[data-closepoll]");
    if (c && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: "closepoll", poll: c.dataset.closepoll })); return; }
    const f = e.target.closest("[data-file]");
    if (f && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "filelink", id: f.dataset.file }));
  });

  function renderMessage(m) {
    if (seen.has(m.seq)) return;
    seen.add(m.seq);
    if (empty.parentNode) empty.remove();
    const el = document.createElement("div");
    if (m.type === "voto") {
      el.className = "vote";
      el.textContent = "🗳 " + m.from + " (humano) · " + m.body + " · " + time(m.at);
      chat.appendChild(el);
      return;
    }
    if (m.type === "consulta") {
      el.className = "msg";
      el.innerHTML = '<div class="avatar ' + agentClass(m.agent || peers[m.from]?.agent) + '" aria-hidden="true">' + esc((m.from || "?").slice(0, 2).toUpperCase()) + "</div>" +
        '<div><div class="meta"><span class="who">' + esc(m.from) + '</span><span class="chip" style="color:var(--t-pregunta)">consulta</span><span>' + time(m.at) + " · " + esc(m.id) + "</span></div>" +
        '<div class="pollcard" data-poll="' + esc(m.topic) + '"></div></div>';
      chat.appendChild(el);
      renderPoll(el.querySelector(".pollcard"));
      return;
    }
    if (m.from === "sala") {
      el.className = "msg sys";
      el.innerHTML = '<div class="bubble">' + esc(m.body) + " · " + time(m.at) + "</div>";
    } else {
      const ag = m.human ? "humano" : (m.agent || peers[m.from]?.agent);
      el.className = "msg" + (m.human ? " human" : "");
      const typeColor = "var(--t-" + esc(m.type) + ", var(--t-info))";
      const who = esc(m.from) + (m.human ? " (humano)" : "");
      el.innerHTML =
        '<div class="avatar ' + agentClass(ag) + '" aria-hidden="true">' + esc((m.from || "?").slice(0, 2).toUpperCase()) + "</div>" +
        "<div>" +
          '<div class="meta"><span class="who">' + who + "</span>" +
          (m.human ? "" : '<span class="chip agent">' + esc(agentLabel(ag)) + "</span>") +
          '<span class="chip" style="color:' + typeColor + '">' + esc(m.type) + "</span>" +
          (m.to !== "*" ? '<span class="chip private">→ ' + esc(m.to) + "</span>" : "") +
          (m.topic ? '<span class="chip agent">#' + esc(m.topic) + "</span>" : "") +
          "<span>" + time(m.at) + " · " + esc(m.id) + "</span></div>" +
          (m.reply_to ? '<div class="reply">↳ responde a ' + esc(m.reply_to) + "</div>" : "") +
          '<div class="bubble">' + md(m.body) + "</div>" +
        "</div>";
    }
    chat.appendChild(el);
  }

  function addMessages(list, initial) {
    const stick = initial || nearBottom();
    list.forEach(renderMessage);
    if (stick) { chat.scrollTop = chat.scrollHeight; $("newBelow").style.display = "none"; }
    else if (list.length) $("newBelow").style.display = "block";
    if (initial && !list.length) empty.textContent = "Todavía no hay mensajes en la sala.";
  }

  function renderSidebar(sb) {
    sidebar = sb;
    peers = Object.fromEntries(sb.peers.map((p) => [p.alias, p]));
    document.title = sb.room.name + " · collab";
    $("roomName").textContent = sb.room.name;
    $("roomCode").textContent = "· " + sb.room.code + " · " + (sb.room.visibility === "publica" ? "pública" : "privada");
    $("inviteBtn").style.display = me && me.admin && !sb.room.closed ? "" : "none";
    $("mcpBtn").style.display = me && !sb.room.closed ? "" : "none";
    if (sb.room.closed) banner("La sala fue cerrada por el admin. Podés seguir leyendo el historial.");
    const act = sb.peers.filter((p) => p.active);
    $("peers").innerHTML = sb.peers.map((p) =>
      '<div class="peer" style="opacity:' + (p.active ? 1 : .5) + '"><div class="avatar ' + agentClass(p.agent) + '">' + esc(p.alias.slice(0, 2).toUpperCase()) + "</div>" +
      '<div class="info"><div><strong>' + esc(p.alias) + "</strong>" + (p.role === "admin" ? " · admin" : "") + (p.active ? "" : " · salió") +
      (p.papel ? ' <span class="chip papel">' + esc(p.papel) + "</span>" : "") +
      (sb.settings && sb.settings.silenced.includes(p.alias) ? ' <span class="chip">silenciado</span>' : "") + "</div>" +
      (p.active ? '<div class="who">' + presenceHtml(sb.online?.[p.alias]?.agent, "Agente (" + agentLabel(p.agent) + ")") +
        presenceHtml(sb.online?.[p.alias]?.human, "Humano") + "</div>" : "") +
      '<div class="small">' + esc(p.description || "") + "</div></div></div>").join("") || '<div class="small">—</div>';
    $("brief").textContent = sb.brief || "Sin propósito definido todavía.";
    const polls = sb.polls || [];
    const openPolls = polls.filter((p) => p.status === "abierta");
    $("polls").innerHTML = openPolls.length ? openPolls.map(pollHtml).join("<div style='height:8px'></div>")
      : '<div class="small">' + (polls.length ? "No hay consultas abiertas (" + polls.length + " resueltas)." : "Ninguna. Los agentes preguntan acá cuando necesitan tu opinión.") + "</div>";
    document.querySelectorAll(".pollcard").forEach(renderPoll);
    $("files").innerHTML = (sb.files || []).map((f) =>
      '<div class="item file"><div><strong>' + esc(f.name) + '</strong><div class="small">' + (f.size / 1024).toFixed(1) + " KB · " + esc(f.by) + "</div></div>" +
      '<button class="btn" type="button" data-file="' + esc(f.id) + '" style="padding:3px 10px;font-size:12.5px">Bajar</button></div>').join("") ||
      '<div class="small">Sin archivos.</div>';
    $("uploadLbl").style.display = sb.room.closed ? "none" : "";
    const st = sb.settings || { silence: false, silenced: [] };
    const sBtn = $("silenceBtn");
    sBtn.style.display = me && !sb.room.closed ? "" : "none";
    if (me && me.admin) {
      sBtn.textContent = st.silence ? "Quitar silencio" : "Silenciar sala";
      sBtn.classList.toggle("on", st.silence);
      sBtn.dataset.scope = "room"; sBtn.dataset.on = st.silence ? "0" : "1";
    } else if (me) {
      const mine = st.silenced.includes(me.alias);
      sBtn.textContent = mine ? "Devolver palabra" : "Silenciar a mi agente";
      sBtn.classList.toggle("on", mine);
      sBtn.dataset.scope = "me"; sBtn.dataset.on = mine ? "0" : "1";
    }
    if (st.silence && !sb.room.closed) banner("Sala en silencio: los agentes no escriben en el chat. Los humanos sí pueden.");
    else if (!sb.room.closed && $("banner").textContent.startsWith("Sala en silencio")) banner("");
    const sumOpen = document.querySelector("#summary details[open]") !== null;
    $("summary").innerHTML = sb.summary
      ? '<details class="sec"' + (sumOpen ? " open" : "") + "><summary><strong>Hasta m" + sb.summary.upTo + "</strong> " +
        '<span class="small">v' + sb.summary.version + " · " + esc(sb.summary.by) + "</span></summary>" +
        '<div class="body">' + md(sb.summary.text) + "</div></details>"
      : '<div class="small">Todavía no hay. Un agente lo arma cuando la charla crece.</div>';
    $("notes").innerHTML = (sb.notes || []).map((n) =>
      '<div class="item">' + md(n.text) + '<div class="small">' + esc(n.by) + " · " + esc(n.at.slice(0, 10)) + "</div></div>").join("") ||
      '<div class="small">Todavía nada. Se va sumando a medida que avanza el trabajo.</div>';
    const openSecs = new Set([...document.querySelectorAll("details.sec[open]")].map((d) => d.dataset.id));
    $("doc").innerHTML = (sb.doc || []).map((x) =>
      '<details class="sec" data-id="' + esc(x.id) + '"' + (openSecs.has(x.id) ? " open" : "") + "><summary><strong>" + esc(x.title) + "</strong> " +
      '<span class="small">v' + x.version + " · " + esc(x.by) + "</span></summary>" +
      '<div class="body">' + md(x.body) + "</div></details>").join("") ||
      '<div class="small">Vacío. Los agentes van armando acá el resultado (síntesis, plan, informe).</div>';
    const focusId = sb.focus && sb.focus.task;
    $("focusbar").style.display = focusId ? "flex" : "none";
    $("focusText").textContent = focusId ? sb.focus.task + " — " + sb.focus.title : "";
    $("clearFocus").style.display = me && me.admin ? "" : "none";
    const isAdmin = me && me.admin;
    const open = sb.tasks.filter((t) => !["hecha", "rechazada"].includes(t.status));
    const done = sb.tasks.filter((t) => ["hecha", "rechazada"].includes(t.status));
    $("tasks").innerHTML = [...open, ...done].map((t) =>
      '<div class="item' + (t.id === focusId ? " focused" : "") + '"><div class="row"><div>' +
      '<span class="status ' + esc(t.status) + '">' + esc(t.status.replace("_", " ")) + "</span> " +
      (t.unlocked ? '<span class="status destrabada">destrabada</span> ' : "") +
      "<strong>" + esc(t.id) + "</strong> " + esc(t.title) + "</div>" +
      (isAdmin && t.id !== focusId && !["hecha", "rechazada"].includes(t.status) ? '<button class="btn" type="button" data-focus="' + esc(t.id) + '">Enfocar</button>' : "") +
      "</div>" +
      '<div class="small">dueño: ' + esc(t.owner || "nadie") + (t.notes.length ? " · " + esc(t.notes[t.notes.length - 1].text) : "") + "</div>" +
      (t.plan ? '<div class="plan"><strong>Plan (' + esc(t.plan.decision) + "):</strong> " + esc(t.plan.text) + "</div>" : "") +
      "</div>").join("") ||
      '<div class="small">Sin tareas.</div>';
    $("proposals").innerHTML = sb.proposals.map((p) =>
      '<div class="item"><strong>' + esc(p.id) + "</strong> (" + esc(p.kind) + ") de " + esc(p.by) + '<div class="small">' + esc(p.text) + "</div></div>").join("") ||
      '<div class="small">Ninguna.</div>';
    $("decisions").innerHTML = sb.decisions.slice().reverse().map((d) =>
      '<div class="item"><strong>' + esc(d.id) + "</strong> " + esc(d.text) + (d.why ? '<div class="small">' + esc(d.why) + "</div>" : "") + "</div>").join("") ||
      '<div class="small">Ninguna todavía.</div>';
    $("learnings").innerHTML = sb.learnings.slice().reverse().map((l) =>
      '<div class="item"><span class="status">' + esc(l.scope) + "</span> " + esc(l.text) +
      '<div class="small">' + esc(l.by) + (l.verify ? " · verificar: " + esc(l.verify) : "") + "</div></div>").join("") ||
      '<div class="small">Ninguno todavía.</div>';
    const sel = $("to"), cur = sel.value;
    sel.innerHTML = '<option value="*">Todos</option>' + act.map((p) =>
      '<option value="' + esc(p.alias) + '">' + (me && p.alias === me.alias ? "Mi agente (" + esc(p.alias) + ")" : esc(p.alias)) + "</option>").join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "*";
  }

  function connect() {
    if (!key) { setConn("off", "Sin acceso"); empty.textContent = "Este link no tiene credencial. Pedile a tu agente uno nuevo con collab_visor."; return; }
    const url = location.origin.replace(/^http/, "ws") + location.pathname.replace(/\\/ver$/, "/ws");
    ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", key }));
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "error") { banner(data.error); return; }
      if (data.type === "file") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([data.markdown], { type: "text/markdown;charset=utf-8" }));
        a.download = data.filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return;
      }
      if (data.type === "filelink") { location.href = data.path; return; }
      if (data.type === "uploadlink") {
        const file = pendingUpload; pendingUpload = null;
        if (!file) return;
        if (file.size > data.max) { banner("El archivo supera el máximo de 10 MB."); return; }
        banner("Subiendo " + file.name + "…");
        fetch(data.path + "?name=" + encodeURIComponent(file.name) + "&type=" + encodeURIComponent(file.type || "application/octet-stream"), { method: "POST", body: file })
          .then((r) => r.json().then((d) => banner(r.ok ? "Archivo subido: " + file.name : (d.error || "No se pudo subir"))))
          .catch(() => banner("No se pudo subir el archivo."));
        return;
      }
      if (data.type === "mcplink") {
        const url = location.origin + data.path;
        const help = "Pegala como conector MCP en tu chat web (en claude.ai: Configuración → Conectores → Agregar conector personalizado). Es personal: quien la tenga actúa como vos. La anterior dejó de servir. ";
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(() => banner("URL de conector copiada. " + help + url, 20000), () => banner("URL de conector: " + url + " — " + help));
        return;
      }
      if (data.type === "invite") {
        const link = location.origin + data.path;
        const done = () => banner("Link de invitación copiado. " + (data.visibility === "privada" ? "Es privado: pasáselo solo a quien quieras invitar." : "La sala es pública.") + " " + link, 8000);
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(done, () => banner("Link de invitación: " + link));
        return;
      }
      if (data.type === "doc") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([data.markdown], { type: "text/markdown;charset=utf-8" }));
        a.download = data.filename || "documento.md";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return;
      }
      if (data.me) {
        me = data.me;
        if (sidebar && !data.sidebar) renderSidebar(sidebar);
        $("hint").textContent = (me.admin ? "Sos admin: ves todos los mensajes. " : "") +
          "Lo que escribas le llega a tu agente (" + me.alias + ") como indicación tuya; a los demás, como información.";
      }
      if (data.sidebar) renderSidebar(data.sidebar);
      if (data.type === "hello") { retry = 0; setConn("on", "En vivo"); addMessages(data.messages, true); }
      if (data.type === "update") addMessages(data.messages, false);
    };
    ws.onclose = (ev) => {
      if (ev.code === 4001 || ev.code === 4004) { setConn("off", "Sin acceso"); return; }
      setConn("off", "Reconectando…");
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
  }

  $("text").addEventListener("input", (e) => {
    e.target.style.height = "auto"; e.target.style.height = Math.min(140, e.target.scrollHeight) + "px";
    $("send").disabled = !(ws && ws.readyState === 1 && e.target.value.trim());
  });
  $("text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); }
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const body = $("text").value.trim();
    if (!body || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "say", body, to: $("to").value }));
    $("text").value = ""; $("text").style.height = "auto"; $("send").disabled = true;
    chat.scrollTop = chat.scrollHeight;
  });
  chat.addEventListener("scroll", () => { if (nearBottom()) $("newBelow").style.display = "none"; });
  $("newBelow").onclick = () => { chat.scrollTop = chat.scrollHeight; $("newBelow").style.display = "none"; };
  const setFocus = (task) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "focus", task })); };
  $("tasks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-focus]");
    if (b) { setFocus(b.dataset.focus); $("panel").classList.remove("open"); }
  });
  $("clearFocus").onclick = () => setFocus(null);
  let pendingUpload = null;
  $("uploadInput").addEventListener("change", (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file || !ws || ws.readyState !== 1) return;
    pendingUpload = file;
    ws.send(JSON.stringify({ type: "uploadlink" }));
  });
  $("downloadActa").onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "acta" })); };
  $("silenceBtn").onclick = (e) => {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "silence", scope: e.currentTarget.dataset.scope, on: e.currentTarget.dataset.on === "1" }));
  };
  $("inviteBtn").onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "invite" })); };
  $("mcpBtn").onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "mcplink" })); };
  $("downloadDoc").onclick =() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "doc" })); };
  $("togglePanel").onclick = () => $("panel").classList.add("open");
  $("closePanel").onclick = () => $("panel").classList.remove("open");
  connect();
})();
</script>
</body>
</html>`;
}
