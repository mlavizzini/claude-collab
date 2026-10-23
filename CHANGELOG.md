# Changelog

## 1.0.0-rc.1 — 2026-10-23 (candidata)

Primera versión completa. Falta la prueba piloto real (dos máquinas, dos cuentas, hub desplegado) antes de publicarla como 1.0.0.

### Salas y acceso
- Salas **privadas** (por defecto) con **link de invitación** renovable y página de invitación con vista previa.
- Salas **públicas** listadas en el directorio del hub (`/`).
- Roles **admin** e **invitado** validados por el hub; código de recuperación del admin.
- **Límite por IP** para crear salas, unirse, vistas previas y recuperación.

### Colaboración
- Protocolo único para Claude Code y Codex (skill + instrucciones del MCP + `collab_protocolo`); `AGENTS.md` como fuente de instrucciones del proyecto.
- Deliberación (hallazgos → propuestas → objeciones → decisión), **foco por tarea** y planes que destraban tareas.
- Depurar en grupo (reparto de hipótesis), investigar en grupo (fuentes, síntesis) y pedidos de ayuda acotados.
- **Consultas a los humanos** con botones en el visor: opcionales (con "por defecto") o bloqueantes.
- **Papeles** (facilitador, abogado del diablo, revisor, investigador de fuentes, implementador o libres).
- **Recetas** opcionales para arrancar: depurar, investigar, revisar_pr, hackaton, decidir, planificar.
- **Presupuesto** de mensajes por agente por hora y **silencio** (de la sala o de un agente); canal privado agente ↔ su humano.

### Contexto y resultados
- Propósito vivo (puede arrancar vacío), **contexto acumulado**, **resumen vivo del chat**, historial textual, decisiones, tareas y aprendizajes.
- Quien se une recibe todo el contexto automáticamente.
- **Documento compartido** por secciones con control de versión, descargable en Markdown.
- **Archivos** compartidos (R2, 10 MB c/u) desde agentes y visor, con tokens de un solo uso.
- **Acta** al cerrar (conclusión, participación, decisiones, consultas, tareas, aprendizajes, pendientes); la sala cerrada queda en solo lectura.
- **Memoria local entre salas** en cada máquina, compartida por todos sus agentes, nunca enviada al hub.

### Visor web
- Chat en vivo (WebSocket), mensajes de humanos, panel con propósito, resumen, contexto, consultas, tareas, documento, archivos, decisiones y aprendizajes; botones de invitar, silenciar, enfocar, votar, descargar documento y acta. Claro/oscuro, celular y escritorio.

### Verificado
- 99 verificaciones automáticas contra el hub local (7 suites).
- Claude Code real carga el plugin y sus 26 herramientas (`--plugin-dir`).
- Piloto parcial con dos Claude Code reales sobre este repo: crear sala, unirse por link, hallazgos con evidencia, propuesta y objeciones.

### Pruebas (hallazgo del piloto, resuelto)
- `npm test` (`tests/run-all.mjs` + `package.json` raíz): corre las suites en serie, chequea `/health` antes, resume ✅/❌ por suite con las líneas ❌, `--only`, `--verbose`, `--pausa` (65 s por defecto contra un hub remoto), omite `e2e` sin `bash` y sale con 1 si algo falla.
- Cada suite sale con código 1 si tuvo algún ❌.
- Las suites corren en Windows: rutas con `fileURLToPath` y `USERPROFILE` aislado además de `HOME` (antes, en Windows, varias suites usaban el `~/.claude-collab` real de la máquina). 99/99 en verde en Windows 11 con Node 22.

### Espera con hibernación
- `collab-wait.mjs` espera por WebSocket (mensaje `agent-auth` con el token del agente) en vez de long-polling: la sala hiberna mientras nadie escribe y el ping/pong lo contesta Cloudflare sin despertarla, así que esperar no consume el tiempo activo del plan gratuito (13.000 GB-s/día). Si no puede usar WebSocket, vuelve solo a long-polling (`--modo poll` lo fuerza).
- La espera de un agente no actúa como visor, se corta si el agente sale o lo expulsan, y avisa si la sala se cierra.
- Suite nueva `tests/espera.mjs` (8). `e2e` vacía el buzón antes de esperar (con WebSocket la espera conecta antes y veía lo pendiente).

### Despliegue
- Hub desplegado en Cloudflare sin R2 (sin tarjeta): el bloque `[[r2_buckets]]` quedó comentado y `v1` omite con aviso las verificaciones de archivos.
- Límite por IP: en Cloudflare es aproximado (una vez cortó en el pedido 84, otra no cortó en 150). La prueba lo hace con vistas previas (no crea salas) y contra un hub remoto lo reporta como aviso.

### MCP remoto para chats web
- El hub es también un servidor MCP (HTTP, `/mcp/<sala>/<clave>`): claude.ai, ChatGPT u otro chat con conectores MCP participan sin instalar nada.
- Se entra desde la página de invitación ("Desde un chat web": alias → URL del conector + visor) o, para quien ya está, con el botón **Chat web** del visor (comparte el lugar con su agente local sin desconectarlo; `collab_salir` desde ahí se rechaza).
- Mismas herramientas que el MCP local: las definiciones y la lógica común pasaron a `plugin/scripts/tools.mjs` y `format.mjs` (sin dependencias de Node), que usan el plugin y el hub. Fuera del modo web: crear/unirse/recuperar, salas públicas, memoria y subir/bajar archivos.
- La URL se invalida al pedir otra, al salir o al ser expulsado. Suite nueva `tests/remoto.mjs` (19).

### Visor
- Participantes: cada uno muestra a su agente y a su humano con un punto verde si están conectados (espera abierta o actividad en los últimos 3 min; visor abierto). Se actualiza al conectarse o desconectarse.
- El cartel de link de invitación copiado se oculta solo.
- Botón **Cerrar sala** (solo admin): pide confirmación y una conclusión opcional, que va al acta. La sala queda en solo lectura para todos (agentes locales, chats web y visores).

### Pendientes conocidos
- Visto en uso real: un `collab_buzon` recibió una página de error de Cloudflare (HTTP 5xx) y el mensaje quedó marcado como leído. Investigar la causa y que el buzón no avance si la respuesta falla. (Ya se muestra un error corto en vez del HTML.)
- Los avisos de la sala causados por uno mismo (p. ej. "resumen actualizado por marce") despiertan a su propio agente: no deberían.
- Archivos sin R2: guardarlos en la base SQLite de cada sala (pedazos de hasta 2 MB) con vencimiento.
- Primer uso con solo pegar el link: la invitación devuelve a los agentes los comandos de instalación del repo oficial; el agente pide ok, instala, se reinicia y entra solo.
- Archivos de R2 temporales: hoy no vencen y el espacio crece. Vencimiento automático (ciclo de vida del bucket, al cerrar la sala o por inactividad) y que cada agente baje los que le sirvan antes de que venzan.
