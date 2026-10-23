// Prueba del MCP remoto: un chat web se conecta a la sala con una URL /mcp/<sala>/<clave>, sin instalar nada.
// Uso: COLLAB_HUB_URL=http://localhost:8787 node tests/remoto.mjs
const HUB = process.env.COLLAB_HUB_URL || "http://localhost:8787";
let fails = 0;
const check = (c, label) => { if (!c) fails++; console.log(`${c ? "✅" : "❌"} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (p, b, t) => {
  const r = await fetch(HUB + p, { method: "POST", headers: t ? { authorization: `Bearer ${t}` } : {}, body: JSON.stringify(b) });
  return { s: r.status, ...(await r.json().catch(() => ({}))) };
};
let rid = 0;
const mcp = async (url, method, params, raw) => {
  const body = raw ?? { jsonrpc: "2.0", id: ++rid, method, params };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  return { status: r.status, data: r.status === 202 ? null : await r.json() };
};
const tool = async (url, name, args = {}) => (await mcp(url, "tools/call", { name, arguments: args })).data.result;

// Admin con su agente local (por HTTP) y un invitado que entra desde la página como "chat web"
const a = await post("/rooms", { name: "remoto", alias: "marce", agent: "claude", brief: "probar el MCP remoto" });
const R = `/rooms/${a.code}`;
const w = await post(`${R}/join`, { alias: "socio", agent: "web", invite: a.invite_path.split("#i=")[1] });
check(w.s === 201, "Un invitado entra desde la página como chat web");
const url = `${HUB}/mcp/${a.code}/${w.token}`;

// Protocolo MCP
const init = await mcp(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai" } });
const ins = init.data.result?.instructions || "";
check(init.data.result?.protocolVersion === "2025-06-18" && ins.includes("chat web") && ins.includes("Reglas que no se negocian"), "initialize: versión, aviso de chat web y protocolo completo");
const note = await mcp(url, null, null, { jsonrpc: "2.0", method: "notifications/initialized" });
check(note.status === 202, "Las notificaciones responden 202");
const list = (await mcp(url, "tools/list", {})).data.result.tools.map((t) => t.name);
check(list.includes("collab_enviar") && list.includes("collab_buzon") && !list.includes("collab_crear") && !list.includes("collab_memoria"), `tools/list: ${list.length} herramientas, sin las que necesitan la máquina local`);
const get = await fetch(url);
check(get.status === 405, "GET responde 405 (no hay stream del servidor)");

// Uso
const ctx = await tool(url, "collab_contexto");
check(ctx.content[0].text.includes("Sos socio") && ctx.content[0].text.includes("probar el MCP remoto"), "collab_contexto trae la sala");
await post(`${R}/messages`, { to: "socio", type: "pregunta", body: "¿me ves desde el chat web?" }, a.token);
const box = await tool(url, "collab_buzon");
check(box.content[0].text.includes("¿me ves desde el chat web?") && box.content[0].text.includes("marce [claude]"), "collab_buzon recibe el mensaje del otro agente");
const sent = await tool(url, "collab_enviar", { para: "marce", tipo: "acuerdo", cuerpo: "Sí, te leo desde el chat web" });
check(sent.content[0].text.startsWith("Enviado"), "collab_enviar responde");
const inboxA = await (await fetch(`${HUB}${R}/inbox`, { headers: { authorization: `Bearer ${a.token}` } })).json();
check(inboxA.messages.some((m) => m.body === "Sí, te leo desde el chat web" && m.agent === "web"), "El otro agente recibe la respuesta, marcada como chat web");
const doc = await tool(url, "collab_documento", { accion: "guardar" });
check(!doc.isError && doc.content[0].text.includes("# remoto"), "collab_documento(guardar) devuelve el Markdown");
const up = await tool(url, "collab_archivo", { accion: "subir", ruta: "x.txt" });
check(up.isError && up.content[0].text.includes("MCP local"), "Subir archivos explica que necesita el MCP local");
const crear = await tool(url, "collab_crear", {});
check(crear.isError && crear.content[0].text.includes("no está disponible"), "Las herramientas locales se rechazan con explicación");

// URL inválida
const bad = await mcp(`${HUB}/mcp/${a.code}/${"0".repeat(48)}`, "tools/list", {});
check(bad.status === 401, "Una URL con clave inválida responde 401");

// Desde el visor: URL de conector para el mismo participante (no desconecta a su agente local)
const v = await post(`${R}/viewer-link`, {}, a.token);
const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}${R}/ws`);
const ev = [];
ws.onmessage = (e) => ev.push(JSON.parse(e.data));
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ type: "auth", key: v.key }));
await sleep(300);
ws.send(JSON.stringify({ type: "mcplink" }));
for (let i = 0; i < 30 && !ev.some((e) => e.type === "mcplink"); i++) await sleep(100);
const link = ev.find((e) => e.type === "mcplink");
check(link && /^\/mcp\/[a-z0-9-]+\/[a-f0-9]+$/.test(link.path), "El visor entrega una URL de conector");
const url2 = HUB + link.path;
const ctx2 = await tool(url2, "collab_contexto");
check(ctx2.content[0].text.includes("Sos marce"), "Con esa URL, el chat web actúa como el mismo participante");
const still = await fetch(`${HUB}${R}/context`, { headers: { authorization: `Bearer ${a.token}` } });
check(still.ok, "...y el agente local sigue conectado");
const salir = await tool(url2, "collab_salir");
check(salir.isError && still.ok, "collab_salir desde una URL compartida se rechaza (no saca al agente local)");
ws.send(JSON.stringify({ type: "mcplink" }));
await sleep(500);
check((await mcp(url2, "tools/list", {})).status === 401, "Pedir otra URL invalida la anterior");

// Expulsado: su URL deja de servir
await post(`${R}/kick`, { alias: "socio" }, a.token);
check((await mcp(url, "tools/list", {})).status === 401, "Si lo expulsan, su URL deja de servir");

ws.close();
process.exit(fails ? 1 : 0);
