#!/usr/bin/env node
// Espera mensajes nuevos de la sala y termina cuando llegan.
// Pensado para correr en segundo plano: al terminar, Claude Code despierta a Claude.
// Espera por WebSocket (la sala hiberna mientras tanto y no consume tiempo activo); si no se puede,
// vuelve a long-polling.
// Agrupa ráfagas: al llegar un mensaje espera unos segundos más (--debounce) por si llegan otros,
// salvo que sea de su propio humano o urgente.
//   node collab-wait.mjs --session <archivo> [--max-minutes 55] [--modo ws|poll] [--debounce 15]
import { loadSession, sessionApi, sessionPath } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const sessionFile = opt("session", sessionPath());
const maxMinutes = Number(opt("max-minutes", 55));
const mode = opt("modo", process.env.COLLAB_WAIT_MODE || "ws");
const deadline = Date.now() + maxMinutes * 60_000;
const PING_MS = 30_000;
const DEBOUNCE_MS = Math.max(0, Number(opt("debounce", process.env.COLLAB_WAIT_DEBOUNCE ?? 15))) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function session() {
  const s = loadSession(sessionFile);
  if (!s) {
    console.log("La sesión de la sala ya no existe (saliste o se cerró). No hace falta relanzar la espera.");
    process.exit(0);
  }
  return s;
}

function arrived(s, unread, from) {
  console.log(
    `📬 ${unread} mensaje(s) nuevo(s) en la sala ${s.code}${from?.length ? ` de: ${from.join(", ")}` : ""}.\n` +
    `Leelos con collab_buzon, actuá según el protocolo y después relanzá esta espera en segundo plano.`,
  );
  process.exit(0);
}

// Ya hay algo para el agente: si no es urgente, esperar un poco por si llegan más, y avisar.
async function settle(s, first) {
  if (!first.now && DEBOUNCE_MS) {
    await sleep(DEBOUNCE_MS);
    try { first = await sessionApi(s)("GET", "/unread"); } catch {}
    if (!first.unread) return; // ya los leyó con collab_buzon mientras tanto: seguir esperando
  }
  arrived(s, first.unread, first.from);
}

function refused(message) {
  console.log(`La sala respondió: ${message}. No relances la espera; avisale a tu usuario.`);
  process.exit(0);
}

// Una conexión WebSocket. Resuelve "fallo" si no se pudo usar (para reintentar o pasar a long-polling)
// y "fin" si se cerró después de funcionar un rato.
function waitWs(s) {
  return new Promise((resolve) => {
    let ready = false, settling = false, pinger, timer, readyTimer;
    const done = (r) => { clearInterval(pinger); clearTimeout(timer); clearTimeout(readyTimer); try { ws.close(); } catch {} resolve(r); };
    const ws = new WebSocket(`${s.hub.replace(/^http/, "ws")}/rooms/${s.code}/ws`);
    timer = setTimeout(() => done(ready ? "fin" : "fallo"), Math.max(0, deadline - Date.now()));
    // Un hub viejo no conoce "agent-auth" y nunca confirma: en ese caso, long-polling.
    readyTimer = setTimeout(() => { if (!ready) done("fallo"); }, 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "agent-auth", token: s.token }));
      pinger = setInterval(() => { try { ws.send("ping"); } catch {} }, PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "ready") ready = true;
      else if (m.type === "unread" && m.unread > 0 && !settling) {
        settling = true;
        clearInterval(pinger); clearTimeout(timer); clearTimeout(readyTimer);
        settle(s, m).then(() => { settling = false; done("fin"); });
      }
      else if (m.type === "error" && m.status) refused(m.error);
    };
    ws.onerror = () => { if (!settling) done(ready ? "fin" : "fallo"); };
    ws.onclose = () => { if (!settling) done(ready ? "fin" : "fallo"); };
  });
}

async function waitPoll(s) {
  const call = sessionApi(s);
  const { unread } = await call("GET", "/wait?timeout=45", { timeoutMs: 60_000 });
  if (unread > 0) await settle(s, await call("GET", "/unread"));
}

let failures = 0;
let useWs = mode === "ws" && typeof WebSocket === "function";
while (Date.now() < deadline) {
  const s = session();
  if (useWs) {
    const r = await waitWs(s);
    if (r === "fin") { failures = 0; continue; } // se cortó la conexión: reconectar
    // No se pudo conectar (proxy, red): después de 3 intentos, seguir con long-polling.
    if (++failures >= 3) { useWs = false; failures = 0; continue; }
    await sleep(2000 * failures);
    continue;
  }
  try {
    await waitPoll(s);
    failures = 0;
  } catch (e) {
    if ([401, 403, 404, 410].includes(e.status)) refused(e.message);
    failures += 1;
    if (failures >= 8) {
      console.log(`No se pudo contactar al hub después de varios intentos: ${e.message}`);
      process.exit(1);
    }
    await sleep(Math.min(30_000, 2000 * 2 ** failures));
  }
}

console.log(`Sin mensajes nuevos en ${maxMinutes} min. Relanzá la espera en segundo plano si seguís en la sala.`);
