// Prueba: salas privadas (solo con link de invitación) y públicas (directorio).
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/salas.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-salas-test");
fs.rmSync(BASE, { recursive: true, force: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };

// withHub=false simula a alguien que no configuró nada: solo tiene el link.
function agent(name, withHub = true) {
  const home = path.join(BASE, name, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, COLLAB_PROJECT_DIR: proj };
  if (withHub) env.COLLAB_HUB_URL = HUB; else delete env.COLLAB_HUB_URL;
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env });
  let buf = "", id = 0; const pending = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
  rpc("initialize", { clientInfo: { name: "claude-code" } });
  return { tool, kill: () => p.kill() };
}

const A = agent("admin"), B = agent("invitado", false), C = agent("colado"), D = agent("curioso");

// Privada (por defecto)
const priv = (await A.tool("collab_crear", { proposito: "proyecto secreto", alias: "admin" })).text;
const link = priv.match(/Link de invitación: (\S+)/)[1];
const code = priv.match(/código (\S+)\)/)[1];
check(priv.includes("Sala privada") && link.includes("#i="), "La sala es privada por defecto y da un link con invitación");

const colado = await C.tool("collab_unirse", { codigo: code, alias: "colado" });
check(colado.error && colado.text.includes("privada"), "Con solo el código no se puede entrar a una privada");

const page = await (await fetch(link.split("#")[0])).text();
check(page.includes("Invitación") && !page.includes("proyecto secreto"), "La página del link no expone datos sin la invitación");
const prevBad = await fetch(`${HUB}/rooms/${code}/preview`, { method: "POST", body: JSON.stringify({ invite: "nope" }) });
const prevOk = await (await fetch(`${HUB}/rooms/${code}/preview`, { method: "POST", body: JSON.stringify({ invite: link.split("#i=")[1] }) })).json();
check(prevBad.status === 403 && prevOk.brief === "proyecto secreto", "La vista previa solo responde con la invitación válida");

const ok = await B.tool("collab_unirse", { codigo: link, alias: "invitado" });
check(!ok.error && ok.text.includes("Contexto completo"), "Con el link entra (y el link alcanza para saber el hub)");

const ren = (await A.tool("collab_invitacion", { accion: "renovar" })).text;
const link2 = ren.match(/Link de invitación: (\S+)/)[1];
const viejo = await C.tool("collab_unirse", { codigo: link, alias: "colado" });
check(viejo.error && link2 !== link, "Al renovar, el link viejo deja de servir");
const nuevo = await C.tool("collab_unirse", { codigo: link2, alias: "colado" });
check(!nuevo.error, "El link nuevo sí funciona");

const dir1 = await (await fetch(`${HUB}/rooms`)).json();
check(!dir1.rooms.some((r) => r.code === code), "La privada no aparece en el directorio");

// Pública
const pub = (await D.tool("collab_crear", { proposito: "aprender juntos sobre energía solar", alias: "curioso", visibilidad: "publica" })).text;
const pcode = pub.match(/código (\S+)\)/)[1];
check(pub.includes("Sala publica") || pub.includes("Sala pública") || pub.includes("Es pública"), "Se crea una sala pública");
const list = (await A.tool("collab_salas_publicas")).text;
check(list.includes("energía solar") && list.includes(`/rooms/${pcode}/unirse`), "Aparece en el directorio (herramienta)");
const dirHtml = await (await fetch(`${HUB}/`)).text();
check(dirHtml.includes("Salas públicas") && dirHtml.includes("energía solar"), "Aparece en la página del directorio");
const E = agent("cualquiera");
const pj = await E.tool("collab_unirse", { codigo: pcode, alias: "cualquiera" });
check(!pj.error, "Cualquiera entra a la pública con solo el código");

// Cambiar a privada la saca del directorio
await D.tool("collab_invitacion", { accion: "hacer_privada" });
const dir2 = await (await fetch(`${HUB}/rooms`)).json();
check(!dir2.rooms.some((r) => r.code === pcode), "Al hacerla privada, sale del directorio");

const noAdmin = await B.tool("collab_invitacion", { accion: "ver" });
check(noAdmin.error, "Un invitado no puede ver ni renovar la invitación");

for (const x of [A, B, C, D, E]) x.kill();
process.exit(fails ? 1 : 0);
