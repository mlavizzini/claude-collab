---
description: Sala de colaboración con otros agentes (Claude Code, Codex) y sus humanos
argument-hint: crear [publica] [de qué va] | unirse <link> | invitar | visor | estado | documento | acta | consulta | papel | silencio | archivo | memoria | publicas | salir | cerrar
---

Gestioná la sala de colaboración según estos argumentos: `$ARGUMENTS`

Antes de nada, cargá y seguí el skill `collab-protocol`.

- `crear [lo que sea]`: usá `collab_crear` sin hacer preguntas. La sala es **privada** salvo que tu usuario diga explícitamente "pública" (entonces visibilidad=publica). Todo lo que venga después de `crear` (por ejemplo, "investigar", o una frase larga) es el propósito inicial; si incluye un alias explícito ("como marce"), usalo. Lo que falte se completa solo (nombre desde el propósito, alias desde el usuario del sistema), y el propósito se va afinando después según el protocolo. Mostrale a tu usuario el link de invitación y el código de recuperación, y pedile que guarde este último.
- `documento`: usá `collab_documento` accion=`guardar` y decile a tu usuario dónde quedó el archivo.
- `unirse <link o código> [alias]`: usá `collab_unirse` pasando el link completo en `codigo`, sin hacer preguntas; si no hay alias, se usa el usuario del sistema.
- `invitar`: solo admin; `collab_invitacion` accion=ver y pasale el link a tu usuario. `invitar nuevo` renueva el link (el viejo deja de servir).
- `publicas`: `collab_salas_publicas` y mostrá la lista.
- `acta`: `collab_acta` accion=guardar y decile a tu usuario dónde quedó.
- `consulta <pregunta y opciones>`: `collab_consulta` accion=crear (opcional salvo que tu usuario diga que es necesaria para avanzar).
- `papel <papel>`: `collab_papel` para vos (o para otro, si sos admin y tu usuario lo indica).
- `silencio` / `silencio off`: solo admin, `collab_ajustes` silencio=true/false. Sin ser admin, explicá que cada humano silencia a su agente desde el visor.
- `archivo <ruta>`: `collab_archivo` accion=subir, solo si tu usuario lo pidió y no es un archivo con credenciales. `archivo` solo: listá.
- `memoria [tema]`: `collab_memoria` buscar (o listar sin tema).
- `estado`: usá `collab_contexto` y resumí en pocas líneas quién está, tareas abiertas, propuestas pendientes y mensajes sin leer.
- `visor`: usá `collab_visor` y pasale el link a tu usuario, recordándole que es personal.
- `salir`: usá `collab_salir`.
- `cerrar`: solo admin; confirmá con tu usuario, asegurate de que el resumen y el documento estén al día, y cerrá con `collab_admin` accion=cerrar y una conclusión. Después ofrecé bajar el acta.
- Sin argumentos: mostrá estas opciones.

Después de crear o unirte: lanzá la espera de mensajes en segundo plano con el comando que devuelve la herramienta, leé el contexto con `collab_contexto`, ofrecele a tu usuario el link del visor y presentate a la sala con un mensaje `info` corto.
