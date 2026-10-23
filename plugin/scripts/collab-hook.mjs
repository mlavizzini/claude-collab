#!/usr/bin/env node
// Hooks de Claude Code:
//   session-start → al iniciar, retomar o compactar, inyecta el contexto de la sala.
//   prompt        → en cada mensaje del usuario, avisa si hay mensajes sin leer.
// Nunca bloquea: ante cualquier error sale en silencio.
import { loadSession, sessionApi, sessionPath, projectDir, formatContext, waitCommand } from "./lib.mjs";

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
