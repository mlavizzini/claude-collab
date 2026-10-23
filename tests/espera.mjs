// Prueba de la espera de mensajes (collab-wait.mjs): por WebSocket (la sala hiberna) y por long-polling.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/espera.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WAIT = fileURLToPath(new URL("../plugin/scripts/collab-wait.mjs", import.meta.url));
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
const BASE = path.join(os.tmpdir(), "collab-espera-test");
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(BASE, { recursive: true });
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (p, b, t) => {
  const r = await fetch(HUB + p, { method: "POST", headers: t ? { authorization: `Bearer ${t}` } : {}, body: JSON.stringify(b) });
  return { s: r.status, ...(await r.json()) };
};
const a = await post("/rooms", { name: "espera", alias: "marce", agent: "claude" });
const R = `/rooms/${a.code}`;
const b = await post(`${R}/join`, { alias: "socio", agent: "codex", invite: a.invite_path.split("#i=")[1] });
const sessionFile = (name, token) => {
  const f = path.join(BASE, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify({ hub: HUB, code: a.code, alias: name, token }));
  return f;
};
const fileA = sessionFile("marce", a.token), fileB = sessionFile("socio", b.token);
const inbox = (t) => fetch(`${HUB}${R}/inbox`, { headers: { authorization: `Bearer ${t}` } });
await inbox(a.token); await inbox(b.token);

function wait(file, modo, max = 1) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [WAIT, "--session", file, "--modo", modo, "--max-minutes", String(max), "--debounce", "0"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => res({ out, code, secs: (Date.now() - t0) / 1000 }));
  });
}

// 1. Por WebSocket: espera sin mensajes y despierta cuando le escriben.
let w = wait(fileA, "ws");
await sleep(3000);
await post(`${R}/messages`, { to: "marce", type: "hallazgo", body: "el build falla en mac" }, b.token);
let r = await w;
check(r.out.includes("📬 1 mensaje") && r.out.includes("socio"), `WebSocket: despierta al llegar un mensaje (${r.secs.toFixed(1)} s)`);
check(r.secs < 8, "...enseguida, sin esperar a un ciclo de long-polling");

// 2. Si ya había mensajes sin leer, termina al conectar.
r = await wait(fileA, "ws");
check(r.out.includes("📬") && r.secs < 5, "WebSocket: con mensajes pendientes termina al conectar");
await inbox(a.token);

// 3. Los mensajes que escribe uno mismo no lo despiertan; los de todos, sí.
w = wait(fileA, "ws");
await sleep(2000);
await post(`${R}/messages`, { to: "*", type: "info", body: "propio" }, a.token);
await sleep(1500);
await post(`${R}/messages`, { to: "*", type: "info", body: "para todos" }, b.token);
r = await w;
check(r.out.includes("📬 1 mensaje") && r.out.includes("socio") && !r.out.includes("marce"), "Lo propio no despierta; un mensaje a todos, sí");
await inbox(a.token);

// 4. Long-polling (respaldo) sigue funcionando.
w = wait(fileA, "poll");
await sleep(2000);
await post(`${R}/messages`, { to: "marce", type: "info", body: "por poll" }, b.token);
r = await w;
check(r.out.includes("📬 1 mensaje"), `Long-polling: despierta igual (${r.secs.toFixed(1)} s)`);
await inbox(a.token);

// 5. Token inválido: no reintenta para siempre.
r = await wait(sessionFile("colado", "token-falso"), "ws");
check(r.out.includes("No relances la espera") && r.secs < 5, "Token inválido: termina y avisa que no relance");

// 6. Si el agente sale de la sala mientras espera, la espera termina.
await inbox(b.token);
w = wait(fileB, "ws");
await sleep(2000);
await post(`${R}/leave`, {}, b.token);
r = await w;
check(r.out.includes("No relances la espera"), "Si el agente sale, su espera termina");

// 7. Sala cerrada: la espera del admin termina con aviso.
w = wait(fileA, "ws");
await sleep(2000);
await post(`${R}/close`, { conclusion: "listo" }, a.token);
r = await w;
check(r.out.includes("cerrada") || r.out.includes("📬"), "Al cerrar la sala, la espera termina");

process.exit(fails ? 1 : 0);
