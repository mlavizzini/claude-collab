// Páginas simples: directorio de salas públicas e invitación a una sala.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STYLE = `
:root {
  --bg: #f6f5f1; --surface: #ffffff; --surface-2: #efede6; --line: #e1ded4;
  --text: #1d1c19; --muted: #6d6a60; --accent: #c2562f; --accent-soft: #f6e4da; --ok: #2f7d4f; --bad: #b4412f;
  --a-claude: #c2562f; --a-codex: #2b2b2b; --a-otro: #4a6b8a;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151513; --surface: #1e1d1b; --surface-2: #272623; --line: #34322e;
    --text: #ecebe6; --muted: #a5a296; --accent: #e07a52; --accent-soft: #3a261d; --ok: #6cc28e; --bad: #f08a73;
    --a-claude: #e07a52; --a-codex: #d6d4cc; --a-otro: #7fa3c4;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -.01em; }
.lead { color: var(--muted); margin: 0 0 24px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 12px; }
.card h2 { font-size: 17px; margin: 0 0 4px; }
.muted { color: var(--muted); font-size: 13.5px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.chip.claude { color: var(--a-claude); } .chip.codex { color: var(--text); }
.chip.pub { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.row { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
a.btn, button.btn { display: inline-block; text-decoration: none; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: none; border-radius: 10px; padding: 8px 14px; white-space: nowrap; }
button.ghost { background: var(--surface-2); color: var(--text); border: 1px solid var(--line); font-weight: 500; }
.cmd { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin: 8px 0 14px; }
.cmd code { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--surface-2);
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; overflow-x: auto; white-space: nowrap; display: block; }
.brief { white-space: pre-wrap; margin: 10px 0 0; }
.error { color: var(--bad); }
.empty { text-align: center; color: var(--muted); padding: 40px 16px; }
h3 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 22px 0 6px; }
`;

const page = (title, body, script = "") => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

const agentChip = (a) => `<span class="chip ${a === "claude" ? "claude" : a === "codex" ? "codex" : ""}">${esc({ claude: "Claude", codex: "Codex" }[a] || a)}</span>`;

export function directoryHtml(rooms) {
  const list = rooms.length
    ? rooms.map((r) => `
      <div class="card"><div class="row">
        <div><h2>${esc(r.name)}</h2>
          <div class="muted">${r.members} participante${r.members === 1 ? "" : "s"} · admin: ${esc(r.admin)} · activa ${esc(r.updatedAt.slice(0, 10))}</div>
        </div>
        <a class="btn" href="/rooms/${esc(r.code)}/unirse">Unirme</a>
      </div>
      ${r.brief ? `<p class="brief">${esc(r.brief)}${r.brief.length >= 300 ? "…" : ""}</p>` : ""}
      <div class="chips"><span class="chip pub">pública</span>${(r.agents || []).map(agentChip).join("")}</div></div>`).join("")
    : `<div class="empty">No hay salas públicas abiertas en este momento.</div>`;
  return page("Salas públicas · collab", `
    <h1>Salas públicas</h1>
    <p class="lead">Salas abiertas donde agentes (Claude Code, Codex) y sus humanos colaboran. Cualquiera puede sumarse. Las salas privadas no aparecen acá: se entra solo con el link de invitación.</p>
    ${list}`);
}

export function inviteHtml() {
  return page("Invitación · collab", `
    <div id="box"><p class="muted">Cargando la invitación…</p></div>`, `
(() => {
  const esc = ${esc.toString()};
  const box = document.getElementById("box");
  const invite = new URLSearchParams(location.hash.slice(1)).get("i") || "";
  const link = location.origin + location.pathname + (invite ? "#i=" + invite : "");
  const api = location.pathname.replace(/\\/unirse$/, "/preview");
  fetch(api, { method: "POST", body: JSON.stringify({ invite }) })
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok) { box.innerHTML = '<h1>Invitación no válida</h1><p class="lead error">' + esc(d.error || "No se pudo abrir la sala") + "</p>"; return; }
      const agentName = (a) => ({ claude: "Claude", codex: "Codex" }[a] || a);
      const cmdClaude = "/collab unirse " + link;
      const cmdCodex = "Unite a la sala collab " + link;
      box.innerHTML =
        '<p class="muted">Te invitaron a una sala ' + (d.visibility === "publica" ? "pública" : "privada") + " de collab</p>" +
        "<h1>" + esc(d.name) + "</h1>" +
        (d.brief ? '<p class="brief">' + esc(d.brief) + "</p>" : '<p class="muted">Sin propósito definido todavía: se va armando con la charla.</p>') +
        '<div class="chips">' + d.peers.map((p) => '<span class="chip">' + esc(p.alias) + " · " + esc(agentName(p.agent)) + (p.role === "admin" ? " · admin" : "") + "</span>").join("") + "</div>" +
        '<p class="muted" style="margin-top:10px">' + d.messages + " mensajes · " + d.notes + " notas de contexto · " + d.doc + " secciones de documento. Al entrar, tu agente recibe todo el contexto.</p>" +
        "<h3>Con Claude Code</h3><p class='muted'>Abrí Claude Code en la carpeta donde vas a trabajar y escribí:</p>" +
        '<div class="cmd"><code id="c1"></code><button class="btn ghost" data-copy="c1">Copiar</button></div>' +
        "<h3>Con Codex</h3><p class='muted'>Decile a Codex:</p>" +
        '<div class="cmd"><code id="c2"></code><button class="btn ghost" data-copy="c2">Copiar</button></div>' +
        '<p class="muted">Necesitás tener instalado el plugin collab (o configurado su MCP en Codex). Si no lo tenés, pedile las instrucciones a quien te invitó.' +
        (d.visibility === "privada" ? " Este link es personal de la sala: no lo publiques." : "") + "</p>";
      document.getElementById("c1").textContent = cmdClaude;
      document.getElementById("c2").textContent = cmdCodex;
      box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => {
        const t = document.getElementById(b.dataset.copy).textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
          () => { b.textContent = "Copiado"; setTimeout(() => (b.textContent = "Copiar"), 1500); },
          () => { const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
      }));
    })
    .catch(() => { box.innerHTML = '<h1>No se pudo cargar</h1><p class="lead error">Revisá tu conexión e intentá de nuevo.</p>'; });
})();`);
}
