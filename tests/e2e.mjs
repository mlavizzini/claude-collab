// Prueba de punta a punta: un agente "Claude" y uno "Codex" simulados, visor, humanos, export.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/e2e.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-e2e");
fs.rmSync(BASE, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };

function machine(name, clientName, extraEnv = {}) {
  const home = path.join(BASE, name, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  if (clientName === "claude-code") env.CLAUDE_PROJECT_DIR = proj;
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env, cwd: proj });
  let buf = ""; const pending = new Map(); let id = 0;
  p.stdout.on("data", (d) => {
    buf += d; let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); pending.delete(m.id); }
  });
  p.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  const rpc = (method, params) => new Promise((res) => { const k = ++id; pending.set(k, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, args = {}, show = true) => {
    const r = await rpc("tools/call", { name: n, arguments: args });
    const t = r.result.content[0].text;
    if (show) console.log(`\n### ${name} · ${n}${r.result.isError ? " (ERROR)" : ""}\n${t}`);
    return t;
  };
  const wait = (cmd) => new Promise((res) => {
    const t0 = Date.now(); const w = spawn("bash", ["-c", cmd], { env, cwd: proj }); let out = "";
    w.stdout.on("data", (d) => (out += d)); w.on("exit", () => res({ out, secs: (Date.now() - t0) / 1000 }));
  });
  const hook = (mode) => {
    const out = execFileSync("node", [`${PLUGIN}/collab-hook.mjs`, mode], { env, input: JSON.stringify({ cwd: proj }) }).toString();
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
  };
  return { name, rpc, tool, wait, hook, kill: () => p.kill(), init: (v) => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: clientName, version: v } }) };
}

function viewer(url) {
  const u = new URL(url);
  const key = new URLSearchParams(u.hash.slice(1)).get("k");
  const ws = new WebSocket(`${u.origin.replace("http", "ws")}${u.pathname.replace(/\/ver$/, "/ws")}`);
  const events = [];
  ws.onmessage = (e) => events.push(JSON.parse(e.data));
  const ready = new Promise((r) => { ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", key })); r(); }; });
  return { ws, events, ready, say: (body, to = "*") => ws.send(JSON.stringify({ type: "say", body, to })) };
}

const A = machine("marce", "claude-code");
const B = machine("juan", "codex-mcp-client", { COLLAB_PROJECT_DIR: path.join(BASE, "juan", "proyecto") });
const initA = await A.init("2.1.308"); await B.init("0.50");
check(initA.result.instructions.includes("Deliberación"), "Instrucciones MCP incluyen el protocolo completo");
const tools = (await A.rpc("tools/list", {})).result.tools.map((t) => t.name);
check(tools.includes("collab_visor") && tools.includes("collab_protocolo"), `Herramientas: ${tools.length}`);

const created = await A.tool("collab_crear", { nombre: "App Nutrición", alias: "marce", proposito: "Hacer andar la app en ambas máquinas", descripcion: "Linux, red corporativa", hub_url: HUB });
const code = created.match(/código (\S+)\)/)[1];
const link = created.match(/Link de invitación: (\S+)/)[1];
check(created.includes("claude)"), "Admin detectado como claude");
const joined = await B.tool("collab_unirse", { codigo: link, alias: "juan", descripcion: "macOS", hub_url: HUB });
check(joined.includes("codex)"), "Invitado detectado como codex");
const waitA = created.split("\n").find((l) => l.trim().startsWith("node ")).trim();

// Visores
const linkA = (await A.tool("collab_visor")).match(/https?:\/\/\S+/)[0];
const linkB = (await B.tool("collab_visor", {}, false)).match(/https?:\/\/\S+/)[0];
const html = await (await fetch(linkA.split("#")[0])).text();
check(html.includes("<title>") && html.includes("collab_visor"), "El hub sirve la página del visor");
const vA = viewer(linkA), vB = viewer(linkB);
await vA.ready; await vB.ready; await sleep(500);
check(vA.events[0]?.type === "hello" && vA.events[0].me.admin, "Visor de marce conectado (admin)");
check(vB.events[0]?.type === "hello" && !vB.events[0].me.admin, "Visor de juan conectado (invitado)");

// Mensaje privado entre agentes: el admin lo ve en su visor, juan también (es destinatario)
await B.tool("collab_enviar", { para: "marce", tipo: "hallazgo", cuerpo: "En mac `npm run build` anda con Node 20.", tema: "build" }, false);
await sleep(500);
const upd = (v) => v.events.filter((e) => e.type === "update").flatMap((e) => e.messages);
check(upd(vA).some((m) => m.type === "hallazgo"), "Visor de marce recibe el hallazgo en vivo");

// Modo remoto: el humano de marce escribe desde el visor y despierta a su agente
await A.tool("collab_buzon", {}, false); // limpia lo pendiente para que la espera bloquee
const waiting = A.wait(waitA);
await sleep(1000);
vA.say("Claude, revisá por qué falla el build en mi máquina y contame", "marce");
const w = await waiting;
check(w.out.includes("marce (humano)"), `La espera de marce despertó por su humano (${w.secs.toFixed(1)}s)`);
const inboxA = await A.tool("collab_buzon");
check(inboxA.includes("TU USUARIO"), "El agente ve el mensaje como de TU USUARIO");
await sleep(300);
check(!upd(vB).some((m) => m.human && m.to === "marce"), "Juan no ve el mensaje privado de marce a su agente");

// El humano de juan escribe a todos: para marce es información, no orden
vB.say("Ojo, no toquen la base hoy");
await sleep(500);
const inboxA2 = await A.tool("collab_buzon");
check(inboxA2.includes("juan (humano)") && !inboxA2.includes("TU USUARIO (juan"), "Mensaje del humano de juan llega como humano de otro participante");
const inboxB = await B.tool("collab_buzon", {}, false);
check(inboxB.includes("TU USUARIO (juan"), "Para el agente de juan es TU USUARIO");

// Aprendizajes y decisiones reflejados en el panel del visor
await B.tool("collab_registrar", { que: "aprendizaje", texto: "Con Node 18 falla el build", alcance: "general", como_verificar: "node -v" }, false);
await sleep(400);
const lastSb = vA.events.filter((e) => e.sidebar).at(-1).sidebar;
check(lastSb.learnings.length === 1 && lastSb.peers.find((p) => p.alias === "juan").agent === "codex", "Panel del visor: aprendizaje y agente codex");

// Hook con contexto y link regenerado invalida el anterior
check(A.hook("session-start").includes("[codex]"), "Hook SessionStart muestra el tipo de agente");
await A.tool("collab_visor", {}, false);
await sleep(400);
check(vA.events.some((e) => e.type === "error"), "El link viejo del visor queda revocado");

// Export (admin) y rol
const s = JSON.parse(fs.readFileSync(fs.readdirSync(path.join(BASE, "marce/home/.claude-collab/sessions")).map((f) => path.join(BASE, "marce/home/.claude-collab/sessions", f))[0]));
const exp = await (await fetch(`${HUB}/rooms/${code}/export`, { headers: { authorization: `Bearer ${s.token}` } })).json();
check(exp.messages.length >= 6 && !exp.room.tokens && !exp.room.viewers && !exp.room.recoveryHash, `Export completo sin credenciales (${exp.messages.length} mensajes)`);

// Persistencia en SQL: mensajes largos sin tope
for (let i = 0; i < 5; i++) await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: "x".repeat(15000) }, false);
const ctx = await A.tool("collab_contexto", {}, false);
check((console.log(ctx.match(/Mensajes sin leer: \d+/)[0]), /Mensajes sin leer: [56]/.test(ctx)), "Mensajes largos guardados en SQL");

await A.tool("collab_admin", { accion: "cerrar" }, false);
await B.tool("collab_salir", {}, false);
vB.ws.close(); vA.ws.close(); A.kill(); B.kill();
console.log("\nfin");
process.exit(fails ? 1 : 0);
