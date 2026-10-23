// Prueba de los archivos temporales: guardados en la base de la sala (en pedazos), con vencimiento.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/archivos.mjs
import crypto from "node:crypto";
import { purgeExpiredFiles, FILE_TTL_MS } from "../hub/src/features.js";

const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sha = (b) => crypto.createHash("sha256").update(Buffer.from(b)).digest("hex");

const post = async (p, b, t) => {
  const r = await fetch(HUB + p, { method: "POST", headers: t ? { authorization: `Bearer ${t}` } : {}, body: JSON.stringify(b) });
  return { s: r.status, ...(await r.json().catch(() => ({}))) };
};
const a = await post("/rooms", { name: "archivos", alias: "marce", agent: "claude" });
const R = `/rooms/${a.code}`;
const b = await post(`${R}/join`, { alias: "socio", agent: "codex", invite: a.invite_path.split("#i=")[1] });
const auth = (t) => ({ authorization: `Bearer ${t}` });

// Un archivo de 4 MB se guarda en varios pedazos y se baja idéntico
const big = crypto.randomBytes(4 * 1024 * 1024);
const up = await fetch(`${HUB}${R}/files?name=${encodeURIComponent("captura grande.png")}`, { method: "POST", headers: { ...auth(a.token), "content-type": "application/octet-stream" }, body: big });
const upj = await up.json();
check(up.status === 201 && upj.file?.size === big.length, "Sube un archivo de 4 MB sin R2");
const exp = Date.parse(upj.file?.expiresAt) - Date.parse(upj.file?.at);
check(Math.abs(exp - FILE_TTL_MS) < 5000, "Vence a los 7 días");
const down = await fetch(`${HUB}${R}/files/${upj.file.id}`, { headers: auth(b.token) });
const got = new Uint8Array(await down.arrayBuffer());
check(down.ok && sha(got) === sha(big), "Otro participante lo baja idéntico (varios pedazos reunidos)");

// Lo ven en el contexto con su vencimiento
const ctx = await (await fetch(`${HUB}${R}/context`, { headers: auth(b.token) })).json();
check(ctx.files?.some((f) => f.id === upj.file.id && f.expiresAt), "El contexto lista el archivo con su vencimiento");

// Más de 10 MB se rechaza
const huge = await fetch(`${HUB}${R}/files?name=enorme.bin`, { method: "POST", headers: auth(a.token), body: new Uint8Array(10 * 1024 * 1024 + 1) });
check(huge.status === 413, "Más de 10 MB se rechaza");

// Borrar libera el contenido
const del = await post(`${R}/files/${upj.file.id}/delete`, {}, a.token);
const gone = await fetch(`${HUB}${R}/files/${upj.file.id}`, { headers: auth(b.token) });
check(del.s === 200 && gone.status === 404, "Al borrarlo deja de estar disponible");

// Vencimiento (lógica de borrado, sin esperar 7 días): sala simulada en memoria
const blobs = new Map([["sala/f1", "x"], ["sala/f2", "y"]]);
let alarm = null;
const msgs = [];
const room = {
  state: {
    code: "sala",
    files: [
      { id: "f1", name: "viejo.log", store: "r2", at: "2026-01-01T00:00:00Z", expiresAt: new Date(Date.now() - 1000).toISOString() },
      { id: "f2", name: "nuevo.log", store: "r2", at: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    ],
  },
  env: { FILES: { delete: async (k) => blobs.delete(k) } },
  ctx: { storage: { setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; } } },
  system: (m) => msgs.push(m),
};
const n = await purgeExpiredFiles(room);
check(n === 1 && room.state.files.map((f) => f.id).join() === "f2" && !blobs.has("sala/f1") && blobs.has("sala/f2"), "Borra solo los vencidos (metadatos y contenido)");
check(msgs[0]?.includes("viejo.log"), "Avisa en la sala qué venció");
check(alarm && Math.abs(alarm - Date.parse(room.state.files[0].expiresAt)) < 5000, "Programa la alarma para el próximo vencimiento");

process.exit(fails ? 1 : 0);
