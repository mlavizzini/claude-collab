// Prueba del propósito al crear y del documento compartido (secciones, conflictos, descarga).
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/doc.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-doc-test");
fs.rmSync(BASE, { recursive: true, force: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };

function agent(name, client) {
  const home = path.join(BASE, name, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env: { ...process.env, HOME: home, USERPROFILE: home, COLLAB_PROJECT_DIR: proj } });
  let buf = "", id = 0; const pending = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
  return { proj, home, rpc, tool, kill: () => p.kill(), init: () => rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }) };
}

const A = agent("marce", "claude-code"), B = agent("socio", "codex");
await A.init(); await B.init();

const c = await A.tool("collab_crear", {
  nombre: "Investigación energía solar", alias: "marce",
  proposito: "Investigar si conviene instalar paneles solares en una casa en Buenos Aires: costos, ahorro, normativa de inyección a red. Resultado: informe con recomendación.",
  hub_url: HUB,
});
const link = c.text.match(/Link de invitación: (\S+)/)[1];
await B.tool("collab_unirse", { codigo: link, alias: "socio", hub_url: HUB });
const ctx = (await B.tool("collab_contexto")).text;
check(ctx.includes("paneles solares"), "El propósito dado al crear llega como brief al invitado");

const s1 = await A.tool("collab_documento", { accion: "escribir", titulo: "Costos", contenido: "- Kit 3 kW: ver https://ejemplo.org/precios" });
const s2 = await B.tool("collab_documento", { accion: "escribir", titulo: "Normativa", contenido: "Ley 27.424 de generación distribuida." });
check(s1.text.includes("s1") && s2.text.includes("s2"), "Ambos participantes escriben secciones");

const ok = await B.tool("collab_documento", { accion: "escribir", seccion_id: "s1", contenido: "- Kit 3 kW (actualizado)", version_base: 1 });
check(!ok.error && ok.text.includes("v2"), "Edición con version_base correcta");
const conflict = await A.tool("collab_documento", { accion: "escribir", seccion_id: "s1", contenido: "pisaría", version_base: 1 });
check(conflict.error && conflict.text.includes("Conflicto"), "Edición sobre versión vieja da conflicto (no pisa)");

const del = await B.tool("collab_documento", { accion: "borrar", seccion_id: "s1" });
check(del.error, "Un invitado no puede borrar una sección con varios autores");

const leer = await B.tool("collab_documento", { accion: "leer" });
check(leer.text.includes("Normativa") && leer.text.includes("actualizado"), "Leer devuelve todas las secciones");

const g = await B.tool("collab_documento", { accion: "guardar" });
const file = g.text.match(/en (\S+\.md)/)?.[1];
const md = file && fs.readFileSync(file, "utf8");
check(md && md.includes("# Investigación energía solar") && md.includes("## Propósito") && md.includes("## Normativa"), `El invitado baja el documento a ${file}`);

const ctx2 = (await A.tool("collab_contexto")).text;
check(ctx2.includes("Documento compartido") && ctx2.includes("«Costos» v2"), "El contexto muestra el índice del documento");

A.kill(); B.kill();
process.exit(fails ? 1 : 0);
