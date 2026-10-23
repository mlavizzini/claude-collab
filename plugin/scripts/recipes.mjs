// Recetas para arrancar una sala. Son OPCIONALES: solo siembran secciones del documento,
// pasos sugeridos y papeles recomendados. La sala después se adapta sola según la charla.

export const RECIPES = {
  depurar: {
    nombre: "Depurar un problema",
    para: "El problema de uno, entre varios",
    pasos: [
      "El dueño del problema publica objetivo, qué probó, evidencia y cómo acceder al código.",
      "Cada agente reclama una hipótesis distinta (dependencias, configuración, entorno, lógica, datos).",
      "Confirmar o descartar con evidencia; reproducir en otras máquinas.",
      "Proponer el arreglo, implementarlo en una rama y que el dueño verifique en su máquina.",
      "Registrar la causa raíz como aprendizaje.",
    ],
    secciones: [
      ["Síntoma", "Qué pasa, dónde, desde cuándo, cómo se reproduce."],
      ["Hipótesis", "| Hipótesis | Quién | Estado | Evidencia |\n|---|---|---|---|"],
      ["Causa raíz y arreglo", "(se completa al cerrar)"],
    ],
    papeles: ["facilitador", "abogado del diablo"],
  },
  investigar: {
    nombre: "Investigar un tema",
    para: "Temas técnicos o no técnicos",
    pasos: [
      "Dividir el tema en subtemas y que cada agente reclame uno.",
      "Hallazgos siempre con fuente (link y qué dice exactamente).",
      "Revisar fuentes cruzadas; marcar contradicciones.",
      "Cada uno escribe su sección; después, síntesis acordada.",
    ],
    secciones: [
      ["Preguntas a responder", "- "],
      ["Hallazgos por subtema", "(una sección por subtema, con fuentes)"],
      ["Síntesis", "(se completa al final: comprobado / probable / opinión)"],
    ],
    papeles: ["investigador de fuentes", "abogado del diablo"],
  },
  revisar_pr: {
    nombre: "Revisar un cambio (PR)",
    para: "Revisión de código entre agentes",
    pasos: [
      "El autor comparte rama o PR, qué cambia y por qué.",
      "Revisores se reparten: corrección, seguridad, rendimiento, legibilidad y tests.",
      "Comentarios con archivo y línea; separar bloqueantes de sugerencias.",
      "El autor responde o corrige; un revisor verifica en su máquina.",
    ],
    secciones: [
      ["Qué cambia", ""],
      ["Comentarios bloqueantes", ""],
      ["Sugerencias", ""],
      ["Veredicto", "(aprobar / pedir cambios)"],
    ],
    papeles: ["revisor", "abogado del diablo"],
  },
  hackaton: {
    nombre: "Hackatón / construir algo rápido",
    para: "Construir en equipo con tiempo acotado",
    pasos: [
      "Definir el objetivo mínimo que tiene que andar al final.",
      "Partir en tareas con dueño, sin superponer archivos.",
      "Destrabar en equipo con foco; después cada uno ejecuta.",
      "Integrar seguido y verificar en todas las máquinas.",
    ],
    secciones: [
      ["Objetivo mínimo", ""],
      ["Arquitectura acordada", ""],
      ["Demo y cómo probarla", ""],
    ],
    papeles: ["facilitador"],
  },
  decidir: {
    nombre: "Decidir entre opciones",
    para: "Comparar alternativas y elegir",
    pasos: [
      "Listar opciones y criterios con los humanos (y su peso).",
      "Cada agente analiza una o dos opciones con evidencia.",
      "Tabla comparativa; objeciones del abogado del diablo.",
      "Consulta a los humanos para la decisión final.",
    ],
    secciones: [
      ["Opciones y criterios", "| Opción | Criterio 1 | Criterio 2 | Criterio 3 |\n|---|---|---|---|"],
      ["Riesgos", ""],
      ["Recomendación", ""],
    ],
    papeles: ["abogado del diablo", "facilitador"],
  },
  planificar: {
    nombre: "Planificar un proyecto",
    para: "Armar un plan con tareas y responsables",
    pasos: [
      "Acordar objetivo, alcance y lo que queda afuera.",
      "Desglosar en tareas con dueño y dependencias.",
      "Identificar riesgos y decisiones pendientes (consultas a humanos).",
      "Plan final en el documento.",
    ],
    secciones: [
      ["Objetivo y alcance", ""],
      ["Plan de tareas", ""],
      ["Riesgos", ""],
    ],
    papeles: ["facilitador"],
  },
};

export const RECIPE_NAMES = Object.keys(RECIPES);

export const PAPELES = {
  "facilitador": "Lleva la agenda: propone el orden, cierra rondas, pide decisiones y mantiene el resumen al día.",
  "abogado del diablo": "Busca activamente fallas, riesgos y alternativas en las propuestas de los demás, con argumentos.",
  "revisor": "Revisa con lupa lo que otros producen (código, planes, textos) y verifica antes de aprobar.",
  "investigador de fuentes": "Busca y contrasta fuentes primarias; chequea que lo citado diga lo que se afirma.",
  "implementador": "Se enfoca en ejecutar y probar; habla poco y reporta resultados.",
};

export function recipeText(name) {
  const r = RECIPES[name];
  return `Receta «${r.nombre}» (${r.para}). Pasos sugeridos:\n${r.pasos.map((p, i) => `${i + 1}. ${p}`).join("\n")}` +
    `\nPapeles recomendados: ${r.papeles.join(", ")}. Es una guía: adaptala a lo que vaya surgiendo.`;
}
