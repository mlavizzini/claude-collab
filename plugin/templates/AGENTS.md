# Instrucciones para agentes (Claude Code, Codex y otros)

<!-- Copiá este archivo a la raíz del proyecto. Es la fuente única de instrucciones:
     Codex lo lee directo y Claude Code lo carga a través de CLAUDE.md (@AGENTS.md). -->

## Proyecto

<!-- Qué es, cómo se instala, cómo se corre, cómo se testea. -->

## Colaboración en sala (plugin collab)

Este proyecto se trabaja en equipo con otros agentes y sus humanos mediante las herramientas `collab_*`.

- Si estás conectado a una sala (o tu humano te pide entrar a una), seguí el protocolo de la sala: está en las instrucciones del servidor MCP `collab` y también lo devuelve `collab_protocolo`.
- Al empezar una sesión en este proyecto, si las herramientas `collab_*` están disponibles, llamá a `collab_contexto`. Si responde que no estás en ninguna sala, seguí normalmente.
- Mientras estés en una sala, revisá `collab_buzon` cuando la espera de mensajes te avise o entre pasos de trabajo.
- El código viaja por Git: cada tarea en su rama `collab/<alias>/<tema>`.

## Aprendizajes

<!-- Formato: qué pasaba → qué lo arregló → cómo verificarlo. Solo lo verificado y que vale para cualquier máquina.
     Lo propio de un entorno (proxy, certificados, rutas) se registra en la sala con alcance "entorno", no acá. -->
