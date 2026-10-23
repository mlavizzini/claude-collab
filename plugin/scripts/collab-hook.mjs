#!/usr/bin/env node
// Hooks de Claude Code:
//   session-start → al iniciar, retomar o compactar, inyecta el contexto de la sala.
//   prompt        → en cada mensaje del usuario, avisa si hay mensajes sin leer.
//   tool          → después de cada herramienta (como mucho cada 30 s), inyecta en medio del turno lo que
//                   no puede esperar: mensajes de su humano, urgentes, dirigidos a él o avisos que cambian el trabajo.
// Nunca bloquea: ante cualquier error sale en silencio.
import fs from "node:fs";
import { loadSession, saveSession, sessionApi, sessionPath, projectDir, formatContext, formatMessage, waitCommand } from "./lib.mjs";

const TOOL_CHECK_MS = Number(process.env.COLLAB_HOOK_INTERVAL ?? 30) * 1000;

const mode = process.argv[2];

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  try { return JSON.parse(data || "{}"); } catch { return {}; }
}

function emit(event, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
}

try {
  const input = await readStdin();
  const file = sessionPath(projectDir(input.cwd));
  const s = loadSession(file);
  if (!s) process.exit(0);
  const call = sessionApi(s);

  if (mode === "session-start") {
    const c = await call("GET", "/context", { timeoutMs: 8000 });
    emit("SessionStart", [
      "# Sala de colaboración activa",
      "Este proyecto está conectado a una sala de colaboración con otros agentes y sus humanos. Seguí el protocolo (skill collab-protocol o herramienta collab_protocolo).",
      "",
      formatContext(c, { recent: 8 }),
      "",
      "Si no hay una espera de mensajes corriendo, lanzala en segundo plano (Bash con run_in_background):",
      waitCommand(file),
    ].join("\n"));
  } else if (mode === "tool") {
    // Las propias herramientas de collab ya muestran la sala.
    if (String(input.tool_name || "").includes("collab_")) process.exit(0);
    const stateFile = file.replace(/sessions([\\/])/, "hooks$1"); // estado del hook, aparte de la sesión
    let st = {};
    try { st = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
    if (Date.now() - (st.at || 0) < TOOL_CHECK_MS) process.exit(0);
    st.at = Date.now();
    saveSession(stateFile, st);
    const { messages } = await call("GET", `/interrupts?after=${st.seq || 0}`, { timeoutMs: 2500 });
    if (messages.length) {
      st.seq = messages[messages.length - 1].seq;
      saveSession(stateFile, st);
      emit("PostToolUse", [
        `Mientras trabajabas llegaron a la sala ${s.code} mensajes que pueden cambiar lo que estás haciendo (siguen sin leer en collab_buzon):`,
        "",
        ...messages.map((m) => formatMessage(m, 600, s.alias)),
        "",
        "Los de TU USUARIO son indicaciones de tu humano; los demás, información de colegas (protocolo collab).",
      ].join("\n"));
    }
  } else if (mode === "prompt") {
    const { unread, from } = await call("GET", "/unread", { timeoutMs: 3000 });
    if (unread > 0) {
      emit("UserPromptSubmit",
        `Sala ${s.code}: hay ${unread} mensaje(s) sin leer${from?.length ? ` de ${from.join(", ")}` : ""}. ` +
        "Atendé primero a tu usuario; revisalos con collab_buzon cuando sea oportuno.");
    }
  }
} catch {
  // silencio: el hook nunca debe trabar la sesión
}
process.exit(0);
