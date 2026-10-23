// Prueba de los avisos inteligentes: qué despierta a un agente, cómo se agrupan las ráfagas y
// qué le llega en medio de una tarea (hook PostToolUse de Claude Code).
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/avisos.mjs
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../plugin/scripts", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-avisos-test");
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(BASE, { recursive: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (p, b, t) => {
  const r = await fetch(HUB + p, { method: "POST", headers: t ? { authorization: `Bearer ${t}` } : {}, body: JSON.stringify(b) });
  return { s: r.status, ...(await r.json().catch(() => ({}))) };
};
const get = async (p, t) => (await fetch(HUB + p, { headers: { authorization: `Bearer ${t}` } })).json();
const a = await post("/rooms", { name: "avisos", alias: "marce", agent: "claude" });
const R = `/rooms/${a.code}`;
const invite = a.invite_path.split("#i=")[1];
const b = await post(`${R}/join`, { alias: "socio", agent: "codex", invite });
const v = await post(`${R}/viewer-link`, {}, a.token);
const clear = () => get(`${R}/inbox`, a.token);
await clear();

const sessionFile = path.join(BASE, "marce.json");
fs.writeFileSync(sessionFile, JSON.stringify({ hub: HUB, code: a.code, alias: "marce", token: a.token }));
function wait(debounce) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(SCRIPTS, "collab-wait.mjs"), "--session", sessionFile, "--max-minutes", "0.3", "--debounce", String(debounce)]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", () => res({ out, secs: (Date.now() - t0) / 1000 }));
  });
}
const say = async (body) => {
  const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}${R}/ws`);
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "auth", key: v.key }));
  await sleep(300);
  ws.send(JSON.stringify({ type: "say", body, to: "marce" }));
  await sleep(300);
  ws.close();
};

// 1. Los avisos de pura información no despiertan; un mensaje de verdad, sí
let w = wait(0);
await sleep(2000);
await post(`${R}/join`, { alias: "tercero", agent: "codex", invite });       // "tercero se unió" (info)
await post(`${R}/summary`, { text: "resumen de prueba" }, b.token);           // "resumen actualizado" (info)
await sleep(2500);
const before = await get(`${R}/unread`, a.token);
check(before.unread === 0 && before.total >= 2, `Los avisos de información quedan en el buzón pero no cuentan para despertar (${before.total} sin leer, 0 para despertar)`);
await post(`${R}/messages`, { to: "marce", type: "pregunta", body: "¿esto sí?" }, b.token);
let r = await w;
check(r.out.includes("📬 1 mensaje") && r.out.includes("de: socio."),`Despierta con el primer mensaje de verdad (${r.secs.toFixed(1)} s), no con los avisos`);
await clear();

// 2. Un aviso que cambia el trabajo (propósito) sí despierta
w = wait(0);
await sleep(2000);
await post(`${R}/brief`, { text: "Nuevo propósito: probar los avisos" }, a.token);
r = await w;
check(r.out.includes("📬"), "Un cambio de propósito despierta (aviso que cambia el trabajo)");
await clear();

// 3. Ráfagas: espera unos segundos y avisa todo junto
w = wait(3);
await sleep(2000);
for (const n of [1, 2, 3]) { await post(`${R}/messages`, { to: "*", type: "info", body: `ráfaga ${n}` }, b.token); await sleep(400); }
r = await w;
check(r.out.includes("📬 3 mensaje"), `Agrupa una ráfaga de 3 mensajes en un solo despertar (${r.secs.toFixed(1)} s)`);
await clear();

// 4. Su humano no espera el agrupado
w = wait(10);
await sleep(2000);
const t1 = Date.now();
await say("Claude, frená y mirá esto");
r = await w;
check(r.out.includes("marce (humano)") && (Date.now() - t1) / 1000 < 5, "Un mensaje de su humano despierta enseguida, sin agrupar");
await clear();

// 5. Urgente tampoco espera
w = wait(10);
await sleep(2000);
const t2 = Date.now();
await post(`${R}/messages`, { to: "marce", type: "hallazgo", body: "se rompió el build de main", urgent: true }, b.token);
r = await w;
check(r.out.includes("📬") && (Date.now() - t2) / 1000 < 5, "Un mensaje urgente despierta enseguida, sin agrupar");
await clear();

// 6. Hook en medio del turno (PostToolUse)
const home = path.join(BASE, "home"), proj = path.join(BASE, "proyecto");
fs.mkdirSync(proj, { recursive: true });
const hash = crypto.createHash("sha1").update(path.resolve(proj)).digest("hex").slice(0, 12);
fs.mkdirSync(path.join(home, ".claude-collab", "sessions"), { recursive: true });
fs.copyFileSync(sessionFile, path.join(home, ".claude-collab", "sessions", `${hash}.json`));
const hook = (tool = "Bash") => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, "collab-hook.mjs"), "tool"], {
    env: { ...process.env, HOME: home, USERPROFILE: home, COLLAB_PROJECT_DIR: proj, COLLAB_HOOK_INTERVAL: "0" },
    input: JSON.stringify({ cwd: proj, tool_name: tool }),
  }).toString();
  return out ? JSON.parse(out).hookSpecificOutput : null;
};
check(hook() === null, "Sin nada importante, el hook no inyecta nada");
await post(`${R}/messages`, { to: "*", type: "info", body: "charla general para todos" }, b.token);
await post(`${R}/join`, { alias: "cuarto", agent: "codex", invite });
check(hook() === null, "La charla general y los avisos de información esperan al buzón");
await post(`${R}/messages`, { to: "marce", type: "pedido", body: "¿podés revisar el PR 12?" }, b.token);
await say("cuando puedas, contame cómo vas");
const h = hook();
check(h?.hookEventName === "PostToolUse" && h.additionalContext.includes("PR 12") && h.additionalContext.includes("TU USUARIO"), "Inyecta en medio del turno lo dirigido a él y lo de su humano");
check(hook() === null, "No repite lo que ya inyectó");
await post(`${R}/messages`, { to: "marce", type: "pedido", body: "otro pedido directo" }, b.token);
check(hook("mcp__plugin_collab_collab__collab_contexto") === null, "No se dispara después de las propias herramientas de collab");
const unread = await get(`${R}/unread`, a.token);
check(unread.total >= 4, "Lo inyectado sigue sin leer en el buzón");

// Cambiar de sala desde el mismo proyecto: el hook no arrastra el último mensaje visto de la anterior
const a2 = await post("/rooms", { name: "otra", alias: "marce", agent: "claude" });
fs.writeFileSync(path.join(home, ".claude-collab", "sessions", `${hash}.json`), JSON.stringify({ hub: HUB, code: a2.code, alias: "marce", token: a2.token }));
const b2 = await post(`/rooms/${a2.code}/join`, { alias: "socio", agent: "codex", invite: a2.invite_path.split("#i=")[1] });
await post(`/rooms/${a2.code}/messages`, { to: "marce", type: "pedido", body: "primer pedido en la sala nueva" }, b2.token);
check(hook()?.additionalContext.includes("primer pedido en la sala nueva"), "Al cambiar de sala, el hook ve los primeros mensajes de la nueva");

process.exit(fails ? 1 : 0);
