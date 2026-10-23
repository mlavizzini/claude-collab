// MCP remoto (Streamable HTTP, respuestas JSON): un chat web (claude.ai, ChatGPT, …) se conecta a la sala
// con una URL personal /mcp/<sala>/<clave>, sin instalar nada. Usa las mismas herramientas que el MCP
// local (plugin/scripts/tools.mjs); quedan afuera las que necesitan disco o sesión local.
import { TOOLS, roomTool } from "../../plugin/scripts/tools.mjs";
import { HubError } from "../../plugin/scripts/format.mjs";
import PROTOCOL from "../../plugin/skills/collab-protocol/SKILL.md";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LOCAL_ONLY = new Set(["collab_crear", "collab_unirse", "collab_recuperar", "collab_salas_publicas", "collab_memoria"]);

const REMOTE_NOTE = [
  "Estás conectado desde un chat web, con el MCP remoto de collab:",
  "- Ya estás dentro de la sala (la URL del conector te identifica). No uses collab_crear ni collab_unirse: no existen acá.",
  "- No tenés espera en segundo plano: solo actuás cuando tu humano te escribe. Al empezar cada respuesta, revisá collab_buzon;",
  "  si tu humano te pide \"fijate qué hay\", leé collab_buzon y collab_contexto.",
  "- No tenés disco: collab_documento(guardar) y collab_acta devuelven el texto; subir y bajar archivos no está disponible.",
  "- No hay memoria entre salas en este modo.",
].join("\n");

function remoteTools() {
  return TOOLS.filter((t) => !LOCAL_ONLY.has(t.name)).map((t) => {
    if (t.name === "collab_documento") return { ...t, description: `${t.description} Desde un chat web, 'guardar' devuelve el documento completo en Markdown.` };
    if (t.name === "collab_acta") return { ...t, description: `${t.description} Desde un chat web, devuelve el acta en Markdown.` };
    if (t.name === "collab_archivo") return { ...t, description: `${t.description} Desde un chat web solo se puede listar y borrar.` };
    return t;
  });
}

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
};
const reply = (data, status = 200) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...CORS } });

export async function handleMcp(room, req, version) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Sin stream del servidor (no hay notificaciones que empujar): solo POST.
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", ...CORS } });

  const s = await room.load();
  if (!s) return reply(rpcError(null, -32001, "La sala no existe"), 404);
  const key = req.headers.get("x-collab-key") || "";
  const alias = s.tokens[key] || s.mcpKeys?.[key];
  if (!alias || !s.members[alias]?.active) {
    return reply(rpcError(null, -32001, "URL de conector inválida o vencida. Pedí una nueva desde el visor o la página de invitación."), 401);
  }
  const origin = req.headers.get("x-collab-origin") || "";

  let msg;
  try { msg = await req.json(); } catch { return reply(rpcError(null, -32700, "JSON inválido"), 400); }
  const batch = Array.isArray(msg);
  const out = [];
  for (const m of batch ? msg : [msg]) {
    const r = await handleOne(room, m, { key, alias, origin, code: s.code, version, shared: !s.tokens[key] });
    if (r) out.push(r);
  }
  if (!out.length) return reply(null, 202); // solo notificaciones
  return reply(batch ? out : out[0]);
}

async function handleOne(room, msg, ctx) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notificación
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return rpc(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "collab", version: ctx.version },
      instructions:
        `Herramientas collab_* para colaborar en la sala ${ctx.code} como ${ctx.alias}, con otros agentes y sus humanos.\n\n` +
        `${REMOTE_NOTE}\n\nSeguí este protocolo:\n\n${String(PROTOCOL).replace(/^---[\s\S]*?---\s*/, "")}`,
    });
  }
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: remoteTools() });
  if (method === "tools/call") {
    const name = params?.name;
    try {
      if (LOCAL_ONLY.has(name)) throw new HubError(400, `${name} no está disponible desde un chat web: ya estás en la sala ${ctx.code}.`);
      // Una URL sacada del visor comparte el alias con el agente local: salir lo sacaría a él también.
      if (name === "collab_salir" && ctx.shared) {
        throw new HubError(400, "Este chat comparte tu lugar en la sala con tu otro agente: para desconectarlo, quitá el conector (o generá otra URL desde el visor y la anterior deja de servir).");
      }
      const call = async (verb, route, { body } = {}) => {
        const res = await room.fetch(new Request(`https://room${route}`, {
          method: verb,
          headers: { authorization: `Bearer ${ctx.key}`, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new HubError(res.status, data.error || `HTTP ${res.status}`);
        return data;
      };
      const text = await roomTool(name, params?.arguments || {}, { s: { hub: ctx.origin, code: ctx.code, alias: ctx.alias }, call });
      return rpc(id, { content: [{ type: "text", text }] });
    } catch (e) {
      let text = e.message || String(e);
      if (e.status === 410) text += ". La sala está cerrada: podés leer el acta y el documento (collab_acta, collab_documento).";
      return rpc(id, { content: [{ type: "text", text: `Error: ${text}` }], isError: true });
    }
  }
  return rpcError(id, -32601, `Método no soportado: ${method}`);
}
