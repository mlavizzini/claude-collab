// Prueba de lo agregado en 1.0: consultas a humanos, acta, memoria local, papeles,
// recetas, silencio y presupuesto, archivos y límite por IP.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/v1.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-v1-test");
fs.rmSync(BASE, { recursive: true, force: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Espera hasta que se cumpla la condición (los eventos del visor tardan más contra un hub remoto).
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(100); return fn(); };

function agent(name, client, home = name) {
  const homeDir = path.join(BASE, home, "home"), proj = path.join(BASE, name, "proyecto");
  fs.mkdirSync(homeDir, { recursive: true }); fs.mkdirSync(proj, { recursive: true });
  const p = spawn("node", [`${PLUGIN}/collab-mcp.mjs`], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, COLLAB_PROJECT_DIR: proj, COLLAB_HUB_URL: HUB } });
  let buf = "", id = 0; const pending = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const k = ++id; pending.set(k, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n"); });
  const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
  rpc("initialize", { clientInfo: { name: client } });
  return { tool, proj, kill: () => p.kill() };
}

function viewer(url) {
  const u = new URL(url); const key = new URLSearchParams(u.hash.slice(1)).get("k");
  const ws = new WebSocket(`${u.origin.replace("http", "ws")}${u.pathname.replace(/\/ver$/, "/ws")}`);
  const events = [];
  ws.onmessage = (e) => events.push(JSON.parse(e.data));
  const ready = new Promise((r) => { ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", key })); setTimeout(r, 300); }; });
  const send = (x) => ws.send(JSON.stringify(x));
  const last = (type) => events.filter((e) => e.type === type).at(-1);
  const sidebar = () => events.filter((e) => e.sidebar).at(-1).sidebar;
  return { ready, send, last, sidebar, events, close: () => ws.close() };
}

// Marce (Claude) y socio (Codex) en máquinas distintas
const A = agent("marce", "claude-code"), B = agent("socio", "codex");
const created = (await A.tool("collab_crear", { proposito: "investigar paneles solares para casa en Buenos Aires", alias: "marce", receta: "decidir" })).text;
const link = created.match(/Link de invitación: (\S+)/)[1];
check(created.includes("Receta «Decidir entre opciones»") && created.includes("Se sembraron 3 secciones"), "Receta aplicada al crear (secciones y pasos)");
await B.tool("collab_unirse", { codigo: link, alias: "socio" });
const vA = viewer((await A.tool("collab_visor")).text.match(/https?:\/\/\S+/)[0]);
const vB = viewer((await B.tool("collab_visor")).text.match(/https?:\/\/\S+/)[0]);
await vA.ready; await vB.ready;
check(vA.sidebar().doc.length === 3, "El documento trae las secciones de la receta");

// Papeles
const pap = await B.tool("collab_papel", { papel: "abogado del diablo" });
check(!pap.error && pap.text.includes("Busca"), "Un agente se asigna un papel (con descripción)");
const papX = await B.tool("collab_papel", { papel: "revisor", alias: "marce" });
check(papX.error, "Un invitado no puede asignar papeles a otros");
await A.tool("collab_papel", { papel: "facilitador", alias: "socio" });
const ctxB = (await B.tool("collab_contexto")).text;
check(ctxB.includes("Tu papel en la sala: facilitador"), "El admin asigna un papel y el agente lo ve en su contexto");

// Consultas: opcional y bloqueante
await B.tool("collab_buzon");
const q1 = await A.tool("collab_consulta", { accion: "crear", pregunta: "¿Incluimos baterías en el análisis?", opciones: ["Sí", "No"], por_defecto: "No" });
check(q1.text.includes("opcional"), "Consulta opcional creada");
const q2 = await A.tool("collab_consulta", { accion: "crear", pregunta: "¿Presupuesto máximo?", opciones: ["USD 3000", "USD 5000", "Sin tope"], bloqueante: true, para: "marce" });
check(q2.text.includes("BLOQUEANTE"), "Consulta bloqueante para un humano puntual");
await sleep(300);
vB.send({ type: "vote", poll: "q2", option: 0 });
await sleep(300);
check(vB.last("error")?.error.includes("no es para vos"), "Un humano no puede votar una consulta dirigida a otro");
vA.send({ type: "vote", poll: "q2", option: 1 });
await sleep(400);
const p2 = vA.sidebar().polls.find((p) => p.id === "q2");
check(p2.status === "cerrada" && p2.result === "USD 5000", "Con el único voto requerido, la bloqueante se cierra sola con el resultado");
vA.send({ type: "vote", poll: "q1", option: 1 });
await sleep(300);
const inboxB = (await B.tool("collab_buzon")).text;
check(inboxB.includes("Votó en q1") && inboxB.includes("USD 5000"), "Los votos y resultados les llegan a los agentes");
const ver = (await A.tool("collab_consulta", { accion: "ver", id: "q1" })).text;
check(ver.includes("faltan: socio"), "Se puede ver quién falta responder");
const cerr = await A.tool("collab_consulta", { accion: "cerrar", id: "q1" });
check(cerr.text.includes("No"), "Quien la creó la cierra con el resultado actual");

// Canal privado agente → su humano
await B.tool("collab_enviar", { para: "socio", tipo: "info", cuerpo: "Solo para mi humano: terminé la parte de normativa" });
await sleep(300);
const seenA = vA.events.flatMap((e) => e.messages || []).some((m) => m.body.includes("Solo para mi humano"));
const seenB = vB.events.flatMap((e) => e.messages || []).some((m) => m.body.includes("Solo para mi humano"));
check(seenB && !seenA, "Canal privado: el humano del agente lo ve; el admin no");

// Silencio y presupuesto
vA.send({ type: "silence", scope: "room", on: true });
await sleep(300);
const sil = await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: "hola" });
check(sil.error && sil.text.includes("silencio"), "Con la sala en silencio, los agentes no pueden escribir en el chat");
const priv = await B.tool("collab_enviar", { para: "socio", tipo: "info", cuerpo: "aviso privado durante el silencio" });
check(!priv.error, "...pero sí pueden hablarle a su propio humano");
vB.send({ type: "say", body: "Los humanos sí pueden escribir" });
check(await until(() => vA.events.flatMap((e) => e.messages || []).some((m) => m.body === "Los humanos sí pueden escribir")), "...y los humanos siguen escribiendo");
vB.send({ type: "silence", scope: "room", on: false });
check(await until(() => vB.last("error")?.error.includes("Solo el admin")), "Un invitado no puede levantar el silencio de la sala");
vA.send({ type: "silence", scope: "room", on: false });
vB.send({ type: "silence", scope: "me", on: true });
await sleep(300);
const selfSil = await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: "hola" });
check(selfSil.error && selfSil.text.includes("Tu humano te silenció"), "Cada humano puede silenciar a su propio agente");
vB.send({ type: "silence", scope: "me", on: false });
await sleep(200);
await A.tool("collab_ajustes", { presupuesto_por_hora: 3 });
let blocked = null;
for (let i = 0; i < 5; i++) { const r = await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: `mensaje ${i}` }); if (r.error) { blocked = { i, r }; break; } }
check(blocked && blocked.r.text.includes("presupuesto"), `Presupuesto: corta al superar el límite (en el mensaje ${blocked?.i})`);
const bctx = (await B.tool("collab_contexto")).text;
check(/usaste \d+ de 3 mensajes/.test(bctx), "El agente ve cuánto presupuesto usó");
await A.tool("collab_ajustes", { presupuesto_por_hora: 0 });

// Archivos
const logPath = path.join(B.proj, "build.log");
fs.writeFileSync(logPath, "ERROR: fetch failed\n".repeat(50));
const up = await B.tool("collab_archivo", { accion: "subir", ruta: "build.log" });
check(!up.error && up.text.includes("f1"), "Un agente sube un archivo");
fs.writeFileSync(path.join(B.proj, ".env"), "API_KEY=secreto");
const env = await B.tool("collab_archivo", { accion: "subir", ruta: ".env" });
check(env.error && env.text.includes("credenciales"), "No deja subir archivos de credenciales");
const down = await A.tool("collab_archivo", { accion: "bajar", id: "f1" });
const got = down.text.match(/guardado en (\S+)\./)?.[1];
check(got && fs.readFileSync(got, "utf8").startsWith("ERROR: fetch failed"), "Otro agente lo baja");
vA.send({ type: "filelink", id: "f1" });
await until(() => vA.last("filelink"));
const dl = vA.last("filelink");
const r1 = await fetch(HUB + dl.path);
const r2 = await fetch(HUB + dl.path);
check(r1.ok && (await r1.text()).startsWith("ERROR") && r2.status === 403, "El visor baja con un link de un solo uso");
vA.send({ type: "uploadlink" });
await until(() => vA.last("uploadlink"));
const ul = vA.last("uploadlink");
const upH = await fetch(`${HUB}${ul.path}?name=captura.txt`, { method: "POST", body: "captura de pantalla (simulada)" });
check(upH.ok && vA.sidebar().files.length >= 1, "Un humano sube un archivo desde el visor");
check(await until(() => vA.sidebar().files.some((f) => f.name === "captura.txt")), "El panel del visor muestra los archivos");

// Acta, conclusión, cierre y memoria local
await A.tool("collab_registrar", { que: "aprendizaje", texto: "Con techo al norte conviene inclinación de 30 grados para paneles solares", alcance: "general" });
await A.tool("collab_registrar", { que: "decision", texto: "Analizar solo sistemas on-grid sin baterías", motivo: "Consulta q1" });
const close = await A.tool("collab_admin", { accion: "cerrar", conclusion: "Conviene instalar 3 kW on-grid; falta pedir dos presupuestos." });
check(close.text.includes("Sala cerrada") && close.text.includes("memoria local"), "Al cerrar se guarda la conclusión y la memoria local");
const actaB = await B.tool("collab_acta", { accion: "guardar" });
const actaFile = actaB.text.match(/guardada en (\S+)\./)?.[1];
const acta = actaFile && fs.readFileSync(actaFile, "utf8");
check(acta && acta.includes("## Conclusión") && acta.includes("3 kW on-grid") && acta.includes("## Consultas a los humanos") && acta.includes("USD 5000"), "Un invitado baja el acta con conclusión y consultas, con la sala cerrada");
check(acta.includes("papel: facilitador") && acta.includes("mensajes del agente") && acta.includes("## Pendientes"), "El acta muestra participación, papeles y pendientes");
const sent = await B.tool("collab_enviar", { para: "*", tipo: "info", cuerpo: "¿sigue abierta?" });
check(sent.error && sent.text.includes("cerrada") && sent.text.includes("memoria local"), "Con la sala cerrada no se escribe, y el invitado guarda su memoria");
await B.tool("collab_salir");

// Nueva sala días después: la memoria local aparece sola (misma máquina, otro agente: Codex)
const A2 = agent("marce-codex", "codex", "marce");
const c2 = (await A2.tool("collab_crear", { proposito: "paneles solares para la casa de mi hermana", alias: "marce2" })).text;
check(c2.includes("Memoria de salas anteriores") && c2.includes("inclinación de 30 grados"), "En una sala nueva, la memoria local ofrece lo aprendido (aunque sea otro agente)");
const mem = (await A2.tool("collab_memoria", { accion: "buscar", consulta: "baterías on-grid" })).text;
check(mem.includes("on-grid"), "Se puede buscar en la memoria");
const C = agent("ajeno", "claude-code");
const memC = (await C.tool("collab_memoria", { accion: "listar" })).text;
check(memC.includes("vacía"), "La memoria es por máquina: otra máquina no la ve");

// Límite por IP (en local se simula la IP que agrega Cloudflare). Usa vistas previas, que pasan por
// el mismo límite que crear salas y no dejan nada guardado. En Cloudflare el límite es aproximado
// (por ubicación y eventualmente consistente), así que se dan hasta 150 intentos para un tope de 40 (medido: corta cerca del pedido 85).
let limited = 0;
for (let i = 1; i <= 150 && !limited; i++) {
  const r = await fetch(`${HUB}/rooms/limite-prueba/preview`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" }, body: "{}" });
  if (r.status === 429) limited = i;
}
// En Cloudflare el corte no es determinista (medido: a veces en el pedido ~85, a veces ni en 150):
// contra un hub remoto, si no corta, es un aviso y no una falla.
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(HUB);
if (!limited && !local) console.log("⚠️  Límite por IP: no cortó en 150 pedidos (en Cloudflare es aproximado); revisalo a mano si hace falta");
else check(limited, `Límite por IP: corta los pedidos masivos (en el pedido ${limited || "—"})`);

vA.close(); vB.close();
for (const x of [A, B, A2, C]) x.kill();
process.exit(fails ? 1 : 0);
