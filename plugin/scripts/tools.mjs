// Herramientas collab_*: definiciones y la lógica que no toca la máquina local.
// Las usan el MCP local (collab-mcp.mjs, Node) y el MCP remoto del hub (hub/src/mcp.js, Worker).
// Sin dependencias de Node: no importes nada de node:* acá.
import { formatContext, formatMessage, PEER_NOTICE, HubError } from "./format.mjs";
import { RECIPES, RECIPE_NAMES, PAPELES, recipeText } from "./recipes.mjs";

const str = (description) => ({ type: "string", description });
export const TOOLS = [
  {
    name: "collab_crear",
    description: "Crea una sala de colaboración nueva. Quien la crea queda como admin. Todo es opcional: se puede arrancar con una palabra ('investigar') o sin nada, y el propósito se va afinando después. Devuelve el código para invitar a otros.",
    inputSchema: {
      type: "object",
      properties: {
        proposito: str("Lo que haya dicho tu usuario sobre de qué va, aunque sea vago o una sola palabra. Queda como propósito inicial y se refina después. No inventes más de lo que dijo"),
        nombre: str("Nombre corto de la sala (opcional; si falta, se deriva del propósito)"),
        alias: str("Tu alias en la sala (opcional; si falta, se usa el usuario del sistema)"),
        descripcion: str("Qué aportás: máquina/SO, área, acceso especial (opcional)"),
        receta: {
          type: "string", enum: RECIPE_NAMES,
          description: "Opcional: receta para arrancar (siembra secciones del documento, pasos sugeridos y papeles). Usala solo si tu usuario la pide o encaja claramente",
        },
        visibilidad: {
          type: "string", enum: ["privada", "publica"],
          description: "privada (por defecto): solo se entra con el link de invitación. publica: aparece en el directorio y cualquiera puede unirse",
        },
        hub_url: str("URL del hub (solo la primera vez si no está configurada)"),
      },
    },
  },
  {
    name: "collab_invitacion",
    description: "Solo admin: ver el link de invitación, renovarlo (el anterior deja de servir) o cambiar la sala a pública o privada.",
    inputSchema: {
      type: "object",
      properties: { accion: { type: "string", enum: ["ver", "renovar", "hacer_publica", "hacer_privada"] } },
      required: ["accion"],
    },
  },
  {
    name: "collab_salas_publicas",
    description: "Lista las salas públicas abiertas en el hub (nombre, propósito, participantes) con su link para unirse.",
    inputSchema: { type: "object", properties: { hub_url: str("URL del hub (si no está configurada)") } },
  },
  {
    name: "collab_unirse",
    description: "Se une a una sala existente como invitado, con el link de invitación (o el código, si la sala es pública).",
    inputSchema: {
      type: "object",
      properties: {
        codigo: str("Link de invitación completo (https://.../rooms/<código>/unirse#i=...) o código de una sala pública"),
        alias: str("Tu alias en la sala (opcional; si falta, se usa el usuario del sistema)"),
        descripcion: str("Qué aportás: máquina/SO, área, acceso especial (opcional)"),
        hub_url: str("URL del hub (solo la primera vez si no está configurada)"),
      },
      required: ["codigo"],
    },
  },
  {
    name: "collab_recuperar",
    description: "Recupera el rol de admin con el código de recuperación (por ejemplo, desde otra máquina).",
    inputSchema: {
      type: "object",
      properties: { codigo: str("Código de la sala"), codigo_recuperacion: str("Código de recuperación del admin"), hub_url: str("URL del hub") },
      required: ["codigo", "codigo_recuperacion"],
    },
  },
  {
    name: "collab_protocolo",
    description: "Devuelve el protocolo completo de la sala (reglas, deliberación, aprendizajes, modo remoto). Leelo al entrar a una sala si no lo tenés cargado.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "collab_visor",
    description: "Genera el link personal del visor web (chat en vivo de la sala) para TU usuario. Invalida el link anterior. Es una credencial: dáselo solo a tu usuario.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "collab_contexto",
    description: "Trae el contexto completo de la sala: propósito, contexto acumulado, decisiones, aprendizajes, tareas, propuestas, índice del documento, participantes y últimos mensajes. Para ponerte al día con más historial, pedí más mensajes.",
    inputSchema: {
      type: "object",
      properties: { mensajes: { type: "number", description: "Cuántos mensajes recientes traer (por defecto 15, máximo 300)" } },
    },
  },
  {
    name: "collab_buzon",
    description: "Lee (y marca como leídos) los mensajes nuevos dirigidos a vos o a todos.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "collab_enviar",
    description: "Envía un mensaje a un participante o a todos. Tipos: hallazgo, propuesta, objecion, acuerdo, pregunta, pedido, resultado, info.",
    inputSchema: {
      type: "object",
      properties: {
        para: str("Alias del destinatario, * para todos, o TU PROPIO alias para hablarle solo a tu humano (le llega a su visor; sirve aunque la sala esté en silencio)"),
        tipo: { type: "string", enum: ["hallazgo", "propuesta", "objecion", "acuerdo", "pregunta", "pedido", "resultado", "info"] },
        cuerpo: str("Contenido. Conciso, con evidencia cuando aplique (comando, salida, versión)"),
        tema: str("Tema o hilo corto, p. ej. 'build' o 't3'"),
        responde_a: str("ID del mensaje al que respondés, p. ej. m12"),
      },
      required: ["para", "tipo", "cuerpo"],
    },
  },
  {
    name: "collab_tarea",
    description: "Crea o actualiza una tarea del tablero compartido. Estados: pendiente, aceptada, en_curso, hecha, rechazada, bloqueada.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["crear", "actualizar"] },
        id: str("ID de la tarea (para actualizar), p. ej. t2"),
        titulo: str("Título (para crear)"),
        detalle: str("Detalle (para crear)"),
        dueno: str("Alias del responsable"),
        estado: { type: "string", enum: ["pendiente", "aceptada", "en_curso", "hecha", "rechazada", "bloqueada"] },
        nota: str("Nota: rama, commit, resultado, motivo del bloqueo"),
      },
      required: ["accion"],
    },
  },
  {
    name: "collab_registrar",
    description: "Registra en la sala: 'contexto' (suma un dato al contexto acumulado; cualquiera, directo), 'brief' (reemplaza el propósito-resumen), 'decision' o 'aprendizaje'. Si sos invitado, brief y decisiones quedan como propuesta para el admin; contexto y aprendizajes se registran directo.",
    inputSchema: {
      type: "object",
      properties: {
        que: {
          type: "string", enum: ["contexto", "brief", "decision", "aprendizaje"],
          description: "contexto: suma un dato al contexto acumulado (cualquiera, no pisa nada). brief: reemplaza el propósito-resumen. decision: decisión o plan de una tarea. aprendizaje: algo verificado que ahorra tiempo",
        },
        texto: str("Contenido"),
        motivo: str("Por qué (decisiones)"),
        tarea: str("Decisiones: ID de la tarea cuyo plan se acordó (p. ej. t1). La marca como destrabada"),
        alcance: { type: "string", enum: ["general", "entorno"], description: "Aprendizajes: general (vale para todos) o entorno (propio de tu máquina/red)" },
        como_verificar: str("Aprendizajes: comando o prueba que lo confirma"),
      },
      required: ["que", "texto"],
    },
  },
  {
    name: "collab_historial",
    description: "Lee la conversación de la sala hacia atrás, textual (lo que ves vos: mensajes a todos, a vos y tuyos). Útil para ponerte al día con detalle o para escribir el resumen.",
    inputSchema: {
      type: "object",
      properties: {
        antes_de: str("ID de mensaje (p. ej. m120): trae los anteriores a ese. Vacío = los más recientes"),
        cantidad: { type: "number", description: "Cuántos mensajes (por defecto 50, máximo 200)" },
      },
    },
  },
  {
    name: "collab_resumen",
    description: "Actualiza el resumen vivo del chat, el que leen primero los que se unen. Reescribilo completo (resumen anterior + lo nuevo), destacando los aportes de los humanos, lo decidido, lo descartado y por qué, y lo pendiente.",
    inputSchema: {
      type: "object",
      properties: {
        texto: str("Resumen completo de la conversación hasta el mensaje indicado (Markdown, conciso)"),
        hasta: str("ID del último mensaje que cubre el resumen (p. ej. m140). Vacío = hasta el último"),
      },
      required: ["texto"],
    },
  },
  {
    name: "collab_documento",
    description:
      "Documento compartido de la sala, organizado en secciones (lo pueden leer, escribir y bajar todos). " +
      "Acciones: 'leer' (todas las secciones o una), 'escribir' (crea o actualiza una sección; para editar una existente pasá su id y version_base), " +
      "'borrar' (una sección; solo el admin o su único autor), 'guardar' (baja el documento completo en Markdown a un archivo local).",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["leer", "escribir", "borrar", "guardar"] },
        seccion_id: str("ID de la sección (p. ej. s2) para leer una sola, editarla o borrarla"),
        titulo: str("Título de la sección (para crear, o para renombrar)"),
        contenido: str("Texto completo de la sección en Markdown (reemplaza el anterior). En investigaciones, con fuentes como links"),
        version_base: { type: "number", description: "Versión de la sección que leíste antes de editarla; evita pisar cambios de otro" },
        ruta: str("Para 'guardar': archivo destino. Por defecto, collab-<código>.md en la carpeta del proyecto"),
      },
      required: ["accion"],
    },
  },
  {
    name: "collab_foco",
    description: "Solo admin: pone el foco de la sala en una tarea (todos colaboran en destrabarla) o lo quita (tarea vacía: cada uno sigue con lo suyo).",
    inputSchema: {
      type: "object",
      properties: { tarea: str("ID de la tarea, p. ej. t2. Vacío para quitar el foco") },
    },
  },
  {
    name: "collab_resolver_propuesta",
    description: "Solo admin: aprueba o rechaza una propuesta pendiente de brief o decisión.",
    inputSchema: {
      type: "object",
      properties: { id: str("ID de la propuesta, p. ej. p1"), accion: { type: "string", enum: ["aprobar", "rechazar"] }, nota: str("Comentario opcional") },
      required: ["id", "accion"],
    },
  },
  {
    name: "collab_admin",
    description: "Solo admin: expulsar a alguien (bloquea su alias, revoca sus accesos y, en salas privadas, renueva el link de invitación), readmitir un alias expulsado, transferir el rol de admin o cerrar la sala.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["expulsar", "readmitir", "transferir", "cerrar"] },
        alias: str("Alias afectado (expulsar/readmitir/transferir)"),
        conclusion: str("Para cerrar: conclusión final de la sala (qué se logró, decisiones clave, qué quedó pendiente). Va al acta"),
      },
      required: ["accion"],
    },
  },
  {
    name: "collab_consulta",
    description:
      "Consulta a los humanos con opciones; responden con botones en el visor. Por defecto es OPCIONAL: si nadie responde, seguís con tu mejor criterio (decí cuál en 'por_defecto'). " +
      "Marcala 'bloqueante' SOLO si no se puede avanzar sin esa respuesta. Acciones: crear, ver (estado y votos), cerrar (con el resultado actual).",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["crear", "ver", "cerrar"] },
        pregunta: str("La pregunta, clara y autocontenida"),
        opciones: { type: "array", items: { type: "string" }, description: "Entre 2 y 6 opciones cortas" },
        bloqueante: { type: "boolean", description: "true solo si no se puede avanzar sin la respuesta" },
        para: str("Alias cuyo humano tiene que responder, o * para todos los humanos (por defecto)"),
        contexto: str("Por qué se pregunta y qué cambia según la respuesta (corto)"),
        por_defecto: str("Opcionales: qué vas a hacer si nadie responde"),
        id: str("ID de la consulta para ver o cerrar (p. ej. q2). Vacío en ver = todas"),
      },
      required: ["accion"],
    },
  },
  {
    name: "collab_papel",
    description: `Asigna un papel en la sala: a vos, o (si sos admin) a otro participante. Papeles sugeridos: ${Object.keys(PAPELES).join(", ")}; también se puede usar uno libre. Vacío lo quita.`,
    inputSchema: {
      type: "object",
      properties: { papel: str("Papel, p. ej. 'abogado del diablo'. Vacío para quitarlo"), alias: str("A quién (solo admin para otros). Vacío = vos") },
      required: ["papel"],
    },
  },
  {
    name: "collab_ajustes",
    description: "Solo admin: silencio de la sala (los agentes dejan de escribir en el chat; los humanos siguen pudiendo) y presupuesto de mensajes por agente por hora.",
    inputSchema: {
      type: "object",
      properties: {
        silencio: { type: "boolean", description: "true para silenciar la sala, false para levantar el silencio" },
        presupuesto_por_hora: { type: "number", description: "Máximo de mensajes por agente por hora; 0 para quitar el límite" },
      },
    },
  },
  {
    name: "collab_acta",
    description: "Acta de la sala: decisiones, quién aportó qué, consultas, tareas, aprendizajes y pendientes. 'ver' la devuelve; 'guardar' la baja a un archivo .md.",
    inputSchema: {
      type: "object",
      properties: { accion: { type: "string", enum: ["ver", "guardar"] }, ruta: str("Para guardar: archivo destino (por defecto acta-<código>.md en el proyecto)") },
      required: ["accion"],
    },
  },
  {
    name: "collab_archivo",
    description:
      "Archivos compartidos de la sala (logs, capturas, PDFs; hasta 10 MB). Subir requiere el ok de tu humano y nunca credenciales ni archivos privados. " +
      "Acciones: subir (ruta local), listar, bajar (id y destino), borrar (id; quien lo subió o el admin).",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["subir", "listar", "bajar", "borrar"] },
        ruta: str("Para subir: archivo local"),
        id: str("Para bajar o borrar: ID del archivo (p. ej. f3)"),
        destino: str("Para bajar: ruta local destino (por defecto, la carpeta collab-archivos/ del proyecto)"),
      },
      required: ["accion"],
    },
  },
  {
    name: "collab_receta",
    description: `Aplica una receta de arranque a la sala actual (siembra secciones del documento y pasos sugeridos). Recetas: ${RECIPE_NAMES.map((n) => `${n} (${RECIPES[n].nombre})`).join(", ")}.`,
    inputSchema: { type: "object", properties: { receta: { type: "string", enum: RECIPE_NAMES } }, required: ["receta"] },
  },
  {
    name: "collab_memoria",
    description:
      "Memoria de salas anteriores, guardada SOLO en esta máquina (la comparten Claude Code, Codex y otros agentes de este usuario). " +
      "Acciones: buscar (consulta), listar, guardar (la sala actual). Lo que encuentres puede ser confidencial: compartilo en la sala solo con el ok de tu humano.",
    inputSchema: {
      type: "object",
      properties: { accion: { type: "string", enum: ["buscar", "listar", "guardar"] }, consulta: str("Para buscar: palabras clave del tema") },
      required: ["accion"],
    },
  },
  {
    name: "collab_salir",
    description: "Sale de la sala y borra el token local.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function applyRecipe(call, name) {
  const r = RECIPES[name];
  if (!r) throw new HubError(400, `Receta desconocida: ${name}`);
  for (const [title, body] of r.secciones) {
    await call("POST", "/doc/sections", { body: { title, body } });
  }
  await call("POST", "/notes", { body: { text: `Receta aplicada: ${r.nombre}. Pasos: ${r.pasos.join(" → ")}` } });
  return `${recipeText(name)}\nSe sembraron ${r.secciones.length} secciones en el documento.`;
}

// Herramientas de una sala en la que ya se está. `s` = { hub, code, alias }; `call(method, route, { body })`
// habla con la sala con el token del participante. Lo que toca el disco lo resuelve antes el MCP local.
export async function roomTool(name, args, { s, call }) {
  switch (name) {
    case "collab_contexto": {
      const n = Math.min(Math.max(Number(args.mensajes) || 15, 1), 300);
      const c = await call("GET", `/context?messages=${n}`);
      return formatContext(c, { recent: n });
    }
    case "collab_buzon": {
      const { messages } = await call("GET", "/inbox");
      if (!messages.length) return "No hay mensajes nuevos.";
      return `${PEER_NOTICE}\n\n${messages.map((m) => formatMessage(m, 1500, s.alias)).join("\n\n")}`;
    }
    case "collab_visor": {
      const { path } = await call("POST", "/viewer-link");
      return [
        `Link del visor para tu usuario: ${s.hub}${path}`,
        "Es personal: quien lo tenga puede escribirte como si fuera tu usuario. Dáselo solo a él y avisale que no lo comparta.",
        "Generar uno nuevo invalida el anterior.",
      ].join("\n");
    }
    case "collab_enviar": {
      const { message } = await call("POST", "/messages", {
        body: { to: args.para || "*", type: args.tipo, body: args.cuerpo, topic: args.tema, reply_to: args.responde_a },
      });
      return `Enviado (${message.id}) a ${message.to === "*" ? "todos" : message.to}.`;
    }
    case "collab_tarea": {
      if (args.accion === "crear") {
        const { task } = await call("POST", "/tasks", { body: { title: args.titulo, detail: args.detalle, owner: args.dueno } });
        return `Tarea ${task.id} creada: ${task.title} (dueño: ${task.owner || "nadie"}).`;
      }
      if (!args.id) throw new HubError(400, "Falta el id de la tarea");
      const body = { status: args.estado, note: args.nota };
      if (args.dueno !== undefined) body.owner = args.dueno;
      const { task } = await call("POST", `/tasks/${args.id}`, { body });
      return `Tarea ${task.id} → ${task.status} (dueño: ${task.owner || "nadie"}).`;
    }
    case "collab_registrar": {
      if (args.que === "aprendizaje") {
        const { learning } = await call("POST", "/learnings", {
          body: { text: args.texto, scope: args.alcance, how_to_verify: args.como_verificar },
        });
        return `Aprendizaje ${learning.id} registrado en la sala.${learning.scope === "general" ? " Si hay proyecto con código, anotalo también en su AGENTS.md (sección \"Aprendizajes\"), con el ok de tu usuario." : ""}`;
      }
      if (args.que === "contexto") {
        const { note } = await call("POST", "/notes", { body: { text: args.texto } });
        return `Contexto ${note.id} agregado. Lo van a ver todos, incluidos los que se unan después.`;
      }
      const route = args.que === "brief" ? "/brief" : "/decisions";
      const r = await call("POST", route, { body: { text: args.texto, why: args.motivo, task: args.tarea } });
      if (!r.applied) return `Quedó como propuesta ${r.proposal.id}; el admin tiene que aprobarla.`;
      if (args.que === "brief") return "Brief actualizado.";
      return args.tarea ? `Plan registrado: ${args.tarea} quedó destrabada.` : "Decisión registrada.";
    }
    case "collab_invitacion": {
      const route = { ver: "/invite", renovar: "/invite", hacer_publica: "/visibility", hacer_privada: "/visibility" }[args.accion];
      if (!route) throw new HubError(400, "Acción inválida");
      const body = args.accion === "renovar" ? { rotate: true }
        : args.accion === "hacer_publica" ? { visibility: "publica" }
        : args.accion === "hacer_privada" ? { visibility: "privada" } : {};
      const r = await call("POST", route, { body });
      return [
        `Sala ${r.visibility}. Link de invitación: ${s.hub}${r.invite_path}`,
        args.accion === "renovar" || args.accion === "hacer_privada" ? "Los links anteriores dejaron de servir." : "",
        r.visibility === "privada" ? "Es una credencial: pasáselo a tu usuario para que lo comparta solo con quien quiera invitar." : "",
      ].filter(Boolean).join("\n");
    }
    case "collab_historial": {
      const n = Math.min(Math.max(Number(args.cantidad) || 50, 1), 200);
      const before = args.antes_de ? Number(String(args.antes_de).replace(/^m/, "")) : "";
      const { messages, more } = await call("GET", `/history?limit=${n}${before ? `&before=${before}` : ""}`);
      if (!messages.length) return "No hay mensajes en ese tramo.";
      return [
        ...messages.map((m) => formatMessage(m, 2000, s.alias)),
        more ? `\n(Hay más atrás: collab_historial antes_de=${messages[0].id})` : "\n(Es el comienzo de la sala.)",
      ].join("\n\n");
    }
    case "collab_resumen": {
      const { summary } = await call("POST", "/summary", { body: { text: args.texto, up_to: args.hasta } });
      return `Resumen del chat actualizado (v${summary.version}, cubre hasta m${summary.upTo}).`;
    }
    case "collab_documento": {
      if (args.accion === "leer") {
        const { sections } = await call("GET", "/doc");
        const list = args.seccion_id ? sections.filter((x) => x.id === args.seccion_id) : sections;
        if (!list.length) return args.seccion_id ? `No existe la sección ${args.seccion_id}.` : "El documento está vacío.";
        return list.map((x) => `## ${x.id} · ${x.title} (v${x.version}, por ${x.authors.join(", ")})\n${x.body}`).join("\n\n");
      }
      if (args.accion === "escribir") {
        try {
          const { section } = await call("POST", "/doc/sections", {
            body: { id: args.seccion_id, title: args.titulo, body: args.contenido ?? "", base_version: args.version_base },
          });
          return `Sección ${section.id} «${section.title}» guardada (v${section.version}).`;
        } catch (e) {
          if (e.status === 409) throw new HubError(409, `${e.message} Leela con collab_documento(leer, seccion_id) antes de reintentar.`);
          throw e;
        }
      }
      if (args.accion === "borrar") {
        if (!args.seccion_id) throw new HubError(400, "Falta seccion_id");
        await call("POST", `/doc/sections/${args.seccion_id}/delete`);
        return `Sección ${args.seccion_id} borrada.`;
      }
      if (args.accion === "guardar") return (await call("GET", "/doc")).markdown;
      throw new HubError(400, "Acción inválida");
    }
    case "collab_foco": {
      const { focus } = await call("POST", "/focus", { body: { task: args.tarea || null } });
      return focus ? `Foco de la sala: ${focus.task} — ${focus.title}.` : "Foco quitado: cada uno sigue con lo suyo.";
    }
    case "collab_resolver_propuesta": {
      const { proposal } = await call("POST", `/proposals/${args.id}`, { body: { action: args.accion, note: args.nota } });
      return `Propuesta ${proposal.id}: ${proposal.status}.`;
    }
    case "collab_consulta": {
      if (args.accion === "crear") {
        const { poll } = await call("POST", "/polls", {
          body: {
            question: args.pregunta, options: args.opciones, required: !!args.bloqueante, to: args.para || "*",
            context: args.contexto, default: args.por_defecto,
          },
        });
        return `Consulta ${poll.id} creada (${poll.required ? "BLOQUEANTE: esperá la respuesta antes de avanzar en esto" : "opcional: seguí trabajando; si nadie responde, avanzá con lo que dijiste por defecto"}). ` +
          `Los humanos la ven en el visor con botones. Cada voto te llega como mensaje.`;
      }
      if (args.accion === "ver") {
        const { polls } = await call("GET", "/polls");
        const list = args.id ? polls.filter((p) => p.id === args.id) : polls;
        if (!list.length) return "No hay consultas.";
        return list.map((p) => `${p.id} [${p.status}${p.required ? ", bloqueante" : ""}] «${p.question}» → ` +
          p.options.map((o, i) => `${o}: ${p.counts[i]}`).join(", ") +
          ` · faltan: ${p.eligible.filter((a) => p.votes[a] === undefined).join(", ") || "nadie"}` + (p.result ? ` · resultado: ${p.result}` : "")).join("\n");
      }
      if (args.accion === "cerrar") {
        if (!args.id) throw new HubError(400, "Falta el id de la consulta");
        const { poll } = await call("POST", `/polls/${args.id}/close`);
        return `Consulta ${poll.id} cerrada: ${poll.result}.`;
      }
      throw new HubError(400, "Acción inválida");
    }
    case "collab_papel": {
      const { papel } = await call("POST", "/papel", { body: { papel: args.papel, alias: args.alias } });
      const desc = papel && PAPELES[papel.toLowerCase()];
      return papel ? `Papel asignado: ${papel}.${desc ? ` ${desc}` : ""}` : "Papel quitado.";
    }
    case "collab_ajustes": {
      const body = {};
      if (args.silencio !== undefined) body.silence = !!args.silencio;
      if (args.presupuesto_por_hora !== undefined) body.budget_per_hour = Number(args.presupuesto_por_hora) || null;
      const { settings } = await call("POST", "/settings", { body });
      return `Ajustes: ${settings.silence ? "sala en silencio" : "sin silencio"}; ${settings.budgetPerHour ? `${settings.budgetPerHour} mensajes por agente por hora` : "sin límite de mensajes"}.`;
    }
    case "collab_acta": return (await call("GET", "/acta")).markdown;
    case "collab_archivo": {
      if (args.accion === "listar") {
        const { files } = await call("GET", "/files");
        return files.length ? files.map((f) => `${f.id} «${f.name}» ${(f.size / 1024).toFixed(1)} KB (${f.by}, ${f.at.slice(0, 10)}${f.expiresAt ? `; vence ${f.expiresAt.slice(0, 10)}` : ""})`).join("\n") : "No hay archivos en la sala.";
      }
      if (args.accion === "subir" || args.accion === "bajar") {
        throw new HubError(400, "Subir y bajar archivos necesita el MCP local (acceso al disco). Desde acá podés listarlos y borrarlos.");
      }
      if (args.accion === "borrar") {
        if (!args.id) throw new HubError(400, "Falta el id del archivo");
        await call("POST", `/files/${args.id}/delete`);
        return `Archivo ${args.id} borrado.`;
      }
      throw new HubError(400, "Acción inválida");
    }
    case "collab_receta": return applyRecipe(call, args.receta);
    case "collab_admin": {
      const route = { expulsar: "/kick", readmitir: "/unban", transferir: "/transfer", cerrar: "/close" }[args.accion];
      if (!route) throw new HubError(400, "Acción inválida");
      if (args.accion === "cerrar" && args.conclusion) await call("POST", "/conclusion", { body: { text: args.conclusion } });
      const r = await call("POST", route, { body: { alias: args.alias } });
      if (args.accion === "cerrar") {
        return `Sala cerrada.${args.conclusion ? "" : " (Sin conclusión: la próxima vez escribila al cerrar.)"} Los participantes pueden seguir bajando el acta y el documento.`;
      }
      if (args.accion === "expulsar") {
        return `${args.alias} fue expulsado.${r.invite_renewed ? ` El link de invitación se renovó (el anterior ya no sirve); el nuevo: ${s.hub}${r.invite_path}. Pasáselo a tu usuario solo si hace falta invitar a alguien más.` : ""}`;
      }
      return { readmitir: `${args.alias} fue readmitido: puede volver a entrar con el link de invitación vigente.`, transferir: `Ahora ${args.alias} es admin.` }[args.accion];
    }
    case "collab_salir": {
      try { await call("POST", "/leave"); } catch (e) { if (![401, 404, 410].includes(e.status)) throw e; }
      return `Saliste de la sala ${s.code}.`;
    }
    default:
      throw new HubError(400, `Herramienta desconocida: ${name}`);
  }
}
