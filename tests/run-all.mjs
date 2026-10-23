// Corre todas las suites en serie contra un hub, resume ✅/❌ y sale con 1 si algo falla.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/run-all.mjs [--only e2e,v1] [--verbose] [--pausa 60]
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// v1 va última: su prueba del límite por IP agota el cupo de la IP local durante un minuto.
const SUITES = ["e2e", "focus", "doc", "minimo", "chat", "salas", "espera", "remoto", "archivos", "v1"];
const HUB = (process.env.COLLAB_HUB_URL || "http://localhost:8787").replace(/\/+$/, "");
const TIMEOUT_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Uso: node tests/run-all.mjs [--only <suite,...>] [--verbose] [--pausa <segundos>]
Suites: ${SUITES.join(", ")}
Hub: COLLAB_HUB_URL (por defecto http://localhost:8787)
--pausa: espera entre suites; por defecto 0 en local y 65 contra un hub remoto (límite por IP).`);
  process.exit(0);
}
const verbose = args.includes("--verbose");
let selected = SUITES;
if (opt("--only")) {
  selected = opt("--only").split(",").map((s) => s.trim().replace(/\.mjs$/, "")).filter(Boolean);
  const unknown = selected.filter((s) => !SUITES.includes(s));
  if (unknown.length) { console.error(`Suite desconocida: ${unknown.join(", ")}. Disponibles: ${SUITES.join(", ")}`); process.exit(2); }
}
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(HUB);
const pause = Number(opt("--pausa") ?? (local ? 0 : 65));

// 1. El hub tiene que responder antes de empezar.
try {
  const r = await fetch(`${HUB}/health`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.error(`❌ El hub no responde en ${HUB}/health (${e.cause?.code || e.message}).`);
  console.error(local ? "   Levantalo con: cd hub && npx wrangler dev" : "   Revisá COLLAB_HUB_URL, la red o el proxy.");
  process.exit(1);
}
console.log(`Hub: ${HUB}\n`);

// 2. e2e necesita bash para la espera en segundo plano.
const hasBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(suite) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(DIR, `${suite}.mjs`)], { env: { ...process.env, COLLAB_HUB_URL: HUB } });
    let out = "";
    const onData = (d) => { out += d; if (verbose) process.stdout.write(d); };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    const timer = setTimeout(() => { out += `\n❌ Tiempo agotado (${TIMEOUT_MS / 1000} s)\n`; p.kill(); }, TIMEOUT_MS);
    p.on("close", (code) => { clearTimeout(timer); resolve({ out, code, secs: (Date.now() - t0) / 1000 }); });
  });
}

const results = [];
for (const [i, suite] of selected.entries()) {
  if (suite === "e2e" && !hasBash) { console.log(`⚠️  ${suite}: omitida (no hay bash)`); results.push({ suite, skipped: true }); continue; }
  if (i > 0 && pause > 0) { console.log(`   (pausa de ${pause} s por el límite por IP)`); await sleep(pause * 1000); }
  if (verbose) console.log(`\n===== ${suite} =====`);
  const { out, code, secs } = await run(suite);
  const lines = out.split(/\r?\n/);
  const ok = lines.filter((l) => l.startsWith("✅")).length;
  const bad = lines.filter((l) => l.startsWith("❌"));
  const warns = lines.filter((l) => l.startsWith("⚠️"));
  // Sin verificaciones o con código distinto de 0 también es falla (la suite se cortó).
  const failed = bad.length > 0 || code !== 0 || ok === 0;
  results.push({ suite, ok, bad, code, failed, tail: lines.filter(Boolean).slice(-8) });
  console.log(`${failed ? "❌" : "✅"} ${suite.padEnd(7)} ${String(ok).padStart(3)} ✅ ${String(bad.length).padStart(3)} ❌  (${secs.toFixed(1)} s${code !== 0 ? `, código ${code}` : ""})`);
  warns.forEach((l) => console.log(`     ${l}`));
}

// 3. Resumen
const failedSuites = results.filter((r) => r.failed);
const total = results.reduce((n, r) => n + (r.ok || 0), 0);
const totalBad = results.reduce((n, r) => n + (r.bad?.length || 0), 0);
console.log(`\nTotal: ${total} ✅, ${totalBad} ❌${results.some((r) => r.skipped) ? ", con suites omitidas" : ""}`);
for (const r of failedSuites) {
  console.log(`\n--- ${r.suite} ---`);
  if (r.bad.length) r.bad.forEach((l) => console.log(`  ${l}`));
  else { console.log(`  La suite terminó sin completar (código ${r.code}). Últimas líneas:`); r.tail.forEach((l) => console.log(`    ${l}`)); }
}
if (failedSuites.some((r) => r.tail.some((l) => l.includes("429") || l.includes("Demasiados pedidos")))) {
  console.log("\nAparecen 429: es el límite por IP (v1 lo agota a propósito al final). Esperá un minuto o probá con --pausa 90.");
}
process.exit(failedSuites.length ? 1 : 0);
