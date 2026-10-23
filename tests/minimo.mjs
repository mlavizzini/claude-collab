// Prueba: crear una sala con lo mínimo ("investigar") y que el propósito crezca después.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/minimo.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-minimo-test");
fs.rmSync(BASE, { recursive: true, force: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };

function agent(name) {
  const home = path.join(BASE, name, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env: { ...process.env, HOME: home, USERPROFILE: home, COLLAB_PROJECT_DIR: proj, COLLAB_HUB_URL: HUB } });
  let buf = "", id = 0; const pending = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
  return { rpc, tool, kill: () => p.kill() };
}

const A = agent("a"), B = agent("b");
await A.rpc("initialize", { clientInfo: { name: "claude-code" } });
await B.rpc("initialize", { clientInfo: { name: "codex" } });
const list = (await A.rpc("tools/list", {})).result.tools.find((t) => t.name === "collab_crear");
check(!list.inputSchema.required?.length, "collab_crear no exige ningún dato");

const c = await A.tool("collab_crear", { proposito: "investigar" });
check(!c.error && /código investigar-/.test(c.text), "Se crea con solo 'investigar' (nombre derivado)");
check(c.text.includes("se va a ir armando"), "Le indica al agente que el propósito se va armando");
const link = c.text.match(/Link de invitación: (\S+)/)[1];

// El admin trabaja solo un rato y la sala va sumando contexto
await A.tool("collab_registrar", { que: "brief", texto: "Investigar paneles solares para una casa en Buenos Aires. Resultado: informe con recomendación." });
await A.tool("collab_registrar", { que: "contexto", texto: "Techo a dos aguas orientado al norte, sin sombras." });
await A.tool("collab_registrar", { que: "contexto", texto: "Descartamos baterías por costo." });
await A.tool("collab_documento", { accion: "escribir", titulo: "Costos", contenido: "Borrador de costos." });
for (let i = 0; i < 20; i++) await A.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: `nota de trabajo ${i}` });

// Un colaborador que llega tarde, sin alias (y con el mismo usuario del sistema que el admin)
const j = await B.tool("collab_unirse", { codigo: link });
check(!j.error, "Se une sin alias (resuelve el choque de nombre solo)");
check(j.text.includes("Contexto completo de la sala"), "Al unirse recibe el contexto completo sin pedirlo");
check(j.text.includes("paneles solares") && j.text.includes("dos aguas") && j.text.includes("baterías"), "...con propósito actualizado y contexto acumulado");
check(j.text.includes("«Costos»") && j.text.includes("nota de trabajo 19"), "...con índice del documento y mensajes recientes");
const ctx = (await B.tool("collab_contexto", { mensajes: 100 })).text;
check(ctx.includes("nota de trabajo 0"), "Puede pedir más historial");

// El invitado también suma contexto, y nada se pisa
await B.tool("collab_registrar", { que: "contexto", texto: "La distribuidora es Edenor." });
const ctxA = (await A.tool("collab_contexto")).text;
check(ctxA.includes("Contexto acumulado (3)") && ctxA.includes("Edenor") && ctxA.includes("dos aguas"), "El contexto se suma (3 notas, ninguna pisada)");
const doc = await A.tool("collab_documento", { accion: "guardar" });
const md = fs.readFileSync(doc.text.match(/en (\S+\.md)/)[1], "utf8");
check(md.includes("## Contexto acumulado") && md.includes("Edenor"), "El documento descargado incluye el contexto acumulado");

A.kill(); B.kill();
process.exit(fails ? 1 : 0);
