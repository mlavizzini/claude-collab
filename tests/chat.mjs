// Prueba: el chat como contexto. Humanos aportan desde el visor, resumen vivo,
// y quien llega tarde recibe resumen + toda la conversación posterior.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/chat.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-chat-test");
fs.rmSync(BASE, { recursive: true, force: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function agent(name, client) {
  const home = path.join(BASE, name, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env: { ...process.env, HOME: home, USERPROFILE: home, COLLAB_PROJECT_DIR: proj, COLLAB_HUB_URL: HUB } });
  let buf = "", id = 0; const pending = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
  rpc("initialize", { clientInfo: { name: client } });
  return { tool, kill: () => p.kill() };
}

function viewer(url) {
  const u = new URL(url); const key = new URLSearchParams(u.hash.slice(1)).get("k");
  const ws = new WebSocket(`${u.origin.replace("http", "ws")}${u.pathname.replace(/\/ver$/, "/ws")}`);
  const ready = new Promise((r) => { ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", key })); setTimeout(r, 300); }; });
  return { ready, say: (body, to = "*") => ws.send(JSON.stringify({ type: "say", body, to })), close: () => ws.close() };
}

const A = agent("marce", "claude-code"), B = agent("socio", "codex");
const created = (await A.tool("collab_crear", { proposito: "investigar paneles solares", alias: "marce" })).text;
const link = created.match(/Link de invitación: (\S+)/)[1];
await B.tool("collab_unirse", { codigo: link, alias: "socio" });
const vA = viewer((await A.tool("collab_visor")).text.match(/https?:\/\/\S+/)[0]);
await vA.ready;

// Primera etapa de charla: agentes + aporte del humano dueño
await A.tool("collab_enviar", { para: "*", tipo: "hallazgo", cuerpo: "Primera etapa: precios de kits de 3 kW relevados.", tema: "costos" });
vA.say("Dato mío: el techo da al norte y no quiero baterías");
await sleep(300);
await A.tool("collab_enviar", { para: "socio", tipo: "info", cuerpo: "SECRETO: esto es privado entre marce y socio" });
for (let i = 0; i < 52; i++) await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: `charla etapa 1, mensaje ${i}` });

let ctx = (await A.tool("collab_contexto")).text;
check(ctx.includes("⚠") && ctx.includes("collab_resumen"), "Con 50+ mensajes sin resumir, el contexto pide actualizar el resumen");
const hist = (await A.tool("collab_historial", { cantidad: 200 })).text;
check(hist.includes("marce (humano)") || hist.includes("TU USUARIO"), "El historial incluye lo que escribió el humano desde el visor");
const r = await A.tool("collab_resumen", { texto: "- Marce (humano): techo al norte, no quiere baterías.\n- Se relevaron precios de kits de 3 kW.\n- Pendiente: normativa (socio)." });
check(!r.error && r.text.includes("v1"), "El agente del admin guarda el resumen");

// Segunda etapa, después del resumen
await B.tool("collab_enviar", { para: "*", tipo: "hallazgo", cuerpo: "Etapa 2: la Ley 27.424 permite inyectar a la red.", tema: "normativa" });
vA.say("Prefiero instaladores con garantía de 10 años");
await sleep(300);

// Llega un tercero tarde
const C = agent("tercero", "claude-code");
await sleep(200);
const join = (await C.tool("collab_unirse", { codigo: link, alias: "tercero" })).text;
check(join.includes("Resumen de la conversación") && join.includes("no quiere baterías"), "El que llega recibe el resumen del chat");
check(join.includes("Conversación desde el resumen") && join.includes("Ley 27.424") && join.includes("garantía de 10 años"), "...y toda la charla posterior, textual, incluido el aporte del humano");
check(!join.includes("charla etapa 1, mensaje 3"), "...sin repetir lo que ya cubre el resumen");
check(!join.includes("SECRETO"), "...y sin mensajes privados entre otros");
const old = (await C.tool("collab_historial", { cantidad: 200 })).text;
check(old.includes("charla etapa 1, mensaje 3") && !old.includes("SECRETO"), "Puede leer el detalle anterior con collab_historial (sin privados ajenos)");

const doc = await A.tool("collab_documento", { accion: "guardar" });
const md = fs.readFileSync(doc.text.match(/en (\S+\.md)/)[1], "utf8");
check(md.includes("## Resumen de la conversación"), "El documento descargado incluye el resumen del chat");

vA.close(); A.kill(); B.kill(); C.kill();
process.exit(fails ? 1 : 0);
