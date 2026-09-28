// ===== Lógica de la página de seguimiento de la boda =====
(function () {                                                        // Encapsula todo para no ensuciar el ámbito global
  "use strict";                                                       // Modo estricto: detecta errores comunes

  // ---------- Configuración y estado ----------
  const C = window.CONFIG;                                            // Configuración definida en config.js
  const LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname); // ¿Se abrió en el computador (pruebas) y no en internet?
  const SIN_CONFIG = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;         // ¿Falta la conexión a Supabase?
  const DEMO = SIN_CONFIG && LOCAL;                                   // Modo demostración solo en pruebas locales, nunca en la página publicada
  const $ = (s) => document.querySelector(s);                         // Atajo para buscar un elemento
  const S = {                                                         // Estado de la aplicación
    tareas: [],                                                       // Lista de tareas cargadas
    historial: [],                                                    // Últimos cambios registrados
    miembros: [],                                                     // Personas autorizadas (correo y nombre)
    vista: "inicio",                                                  // Vista activa
    filtros: { texto: "", grupo: "", responsable: "", estado: "", semaforo: "" }, // Filtros activos
    editando: null,                                                   // Tarea abierta en el modal (null = nueva)
    api: null,                                                        // Capa de datos (demo o Supabase)
    cli: null,                                                        // Cliente de Supabase
    usuario: null                                                     // Usuario con sesión iniciada
  };                                                                  // Fin del estado
  const CAMPOS = ["codigo", "grupo", "categoria", "tarea", "responsable", "lider", "prioridad", "fecha_limite", "estado", // Campos editables…
    "proveedor", "valor_total", "valor_abonado", "fecha_proximo_pago", "proximo_paso", "depende_de", "observaciones", "checklist"]; // …que se envían a la base de datos
  const ETIQUETAS = { tarea: "nombre", grupo: "grupo", categoria: "categoría", responsable: "responsable", lider: "líder", // Nombres legibles de campos…
    prioridad: "prioridad", fecha_limite: "fecha límite", estado: "estado", proveedor: "proveedor", valor_total: "valor total", // …para describir…
    valor_abonado: "abono", fecha_proximo_pago: "próximo pago", proximo_paso: "próximo paso", depende_de: "dependencias",     // …los cambios…
    observaciones: "observaciones", codigo: "código", checklist: "checklist" };                                                                        // …en el historial
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]; // Meses abreviados

  // ---------- Utilidades ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); // Escapa texto para HTML
  const hoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };               // Fecha de hoy a medianoche
  const aFecha = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }; // "AAAA-MM-DD" → fecha local
  const dias = (s) => Math.round((aFecha(s) - hoy()) / 86400000);                              // Días entre hoy y una fecha
  const fmtFecha = (s) => { const f = aFecha(s); return f ? `${f.getDate()} ${MESES[f.getMonth()]} ${f.getFullYear()}` : "Sin fecha"; }; // Fecha legible
  const fmtCOP = (n) => (n === null || n === undefined || n === "") ? "–" : "$" + Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 }); // Pesos colombianos
  const clase = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-"); // Texto → clase CSS ("En proceso" → "en-proceso")
  const vacioANulo = (v) => (v === "" || v === undefined ? null : v);                           // Convierte vacío en null
  const aPesos = (txt) => { const d = String(txt ?? "").replace(/[.,]\d{1,2}$/, "").replace(/\D/g, ""); return d ? Number(d) : null; }; // "32.636.217" o "$ 1,450,000" → 32636217 (quita puntos, comas, $ y centavos)
  const lista = (t) => (Array.isArray(t && t.checklist) ? t.checklist : []); // Checklist de una tarea (siempre una lista)
  const progreso = (t) => { const l = lista(t); return { hechos: l.filter((i) => i.hecho).length, total: l.length }; }; // Ítems hechos y total
  const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null); // Compara valores, incluidas listas
  const conPuntos = (n) => (n === null || n === undefined || n === "") ? "" : Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 }); // 32636217 → "32.636.217"

  function semaforo(t) {                                              // Calcula el semáforo de una tarea
    if (t.estado === "Terminado") return "Terminado";                 // Las terminadas no se evalúan
    if (!t.fecha_limite) return "Sin fecha";                          // Sin fecha límite
    const d = dias(t.fecha_limite);                                   // Días que faltan
    if (d < 0) return "Vencida";                                      // Fecha pasada
    if (d <= C.DIAS_ALERTA) return "Próxima";                         // Vence pronto
    return "A tiempo";                                                // Todo bien
  }                                                                   // Fin de semaforo

  const saldo = (t) => (t.valor_total === null || t.valor_total === undefined) ? null : Math.max(0, Number(t.valor_total) - Number(t.valor_abonado || 0)); // Saldo pendiente

  function bloqueadaPor(t) {                                          // Devuelve las dependencias que aún no están listas
    if (!t.depende_de || t.estado === "Terminado") return [];         // Sin dependencias o ya terminada: nada
    return t.depende_de.split(/[,\s]+/).filter(Boolean)               // Separa los códigos
      .map((c) => c.toUpperCase())                                    // Los pasa a mayúsculas
      .filter((c) => { const p = S.tareas.find((x) => x.codigo === c); return p && p.estado !== "Terminado"; }); // Deja solo las pendientes
  }                                                                   // Fin de bloqueadaPor

  function nombreDe(email) {                                          // Nombre de una persona a partir de su correo
    if (!email) return "Alguien";                                     // Sin correo
    const m = S.miembros.find((x) => x.email.toLowerCase() === String(email).toLowerCase()); // Busca en miembros
    return m ? m.nombre : (email === "demo" ? "Tú (demo)" : email);   // Nombre o el mismo correo
  }                                                                   // Fin de nombreDe

  function hace(iso) {                                                // Tiempo relativo ("hace 2 h")
    const min = Math.round((Date.now() - new Date(iso)) / 60000);     // Minutos transcurridos
    if (min < 1) return "ahora";                                      // Menos de un minuto
    if (min < 60) return `hace ${min} min`;                           // Minutos
    if (min < 1440) return `hace ${Math.round(min / 60)} h`;          // Horas
    return `hace ${Math.round(min / 1440)} d`;                        // Días
  }                                                                   // Fin de hace

  let temporizadorAviso;                                              // Temporizador del aviso
  function aviso(msg) {                                               // Muestra un aviso breve abajo
    const a = $("#aviso");                                            // Elemento del aviso
    a.textContent = msg;                                              // Pone el texto
    a.classList.add("visible");                                       // Lo muestra
    clearTimeout(temporizadorAviso);                                  // Cancela el ocultado anterior
    temporizadorAviso = setTimeout(() => a.classList.remove("visible"), 2600); // Lo oculta en 2,6 s
  }                                                                   // Fin de aviso

  // ---------- Capa de datos: modo demostración ----------
  function apiDemo() {                                                // Guarda en memoria y en el navegador
    const CLAVE = "boda-seguimiento-demo";                            // Clave de almacenamiento local
    let datos = null;                                                 // Tareas en memoria
    try { datos = JSON.parse(localStorage.getItem(CLAVE)); } catch (e) { datos = null; } // Intenta leer lo guardado
    if (!Array.isArray(datos)) datos = window.DATOS_INICIALES.map((t, i) => ({ id: i + 1, ...t })); // Si no hay, usa los datos iniciales
    const hist = [];                                                  // Historial en memoria
    const persistir = () => { try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* sin almacenamiento */ } }; // Guarda si se puede
    return {                                                          // Métodos de la capa
      async listar() { return datos.map((t) => ({ ...t })); },        // Devuelve copia de las tareas
      async historial() { return hist.slice(0, 30); },                // Devuelve los últimos 30 cambios
      async guardar(t) {                                              // Crea o edita
        const ahora = new Date().toISOString();                       // Momento actual
        if (t.id) {                                                   // Si ya existe
          const i = datos.findIndex((x) => x.id === t.id);            // Busca su posición
          const cambios = {};                                         // Diferencias
          CAMPOS.forEach((k) => { if (!igual(datos[i][k], t[k])) cambios[k] = { antes: datos[i][k] ?? null, despues: t[k] ?? null }; }); // Compara campo por campo
          datos[i] = { ...datos[i], ...t, actualizado_en: ahora, actualizado_por: "demo" }; // Actualiza
          if (Object.keys(cambios).length) hist.unshift({ tarea_codigo: t.codigo, tarea_titulo: t.tarea, accion: "editó", cambios, usuario: "demo", fecha: ahora }); // Anota
        } else {                                                      // Si es nueva
          t.id = Math.max(0, ...datos.map((x) => x.id)) + 1;          // Le asigna un id
          datos.push({ ...t, actualizado_en: ahora, actualizado_por: "demo" }); // La agrega
          hist.unshift({ tarea_codigo: t.codigo, tarea_titulo: t.tarea, accion: "creó", usuario: "demo", fecha: ahora }); // Anota
        }                                                             // Fin del if
        persistir();                                                  // Guarda en el navegador
        return t;                                                     // Devuelve la tarea
      },                                                              // Fin de guardar
      async eliminar(t) {                                             // Elimina una tarea
        datos = datos.filter((x) => x.id !== t.id);                   // La quita de la lista
        hist.unshift({ tarea_codigo: t.codigo, tarea_titulo: t.tarea, accion: "eliminó", usuario: "demo", fecha: new Date().toISOString() }); // Anota
        persistir();                                                  // Guarda en el navegador
      },                                                              // Fin de eliminar
      escuchar() { /* en demo no hay otros usuarios */ }              // Sin tiempo real
    };                                                                // Fin de métodos
  }                                                                   // Fin de apiDemo

  // ---------- Capa de datos: Supabase ----------
  function apiSupabase(cli) {                                         // Lee y escribe en la base de datos
    const fila = (t) => { const f = {}; CAMPOS.forEach((k) => { f[k] = k === "checklist" ? lista(t) : vacioANulo(t[k]); }); return f; }; // Solo campos editables (checklist nunca vacío)
    return {                                                          // Métodos de la capa
      async listar() {                                                // Trae todas las tareas
        const { data, error } = await cli.from("tareas").select("*").order("codigo"); // Consulta ordenada por código
        if (error) throw error;                                       // Propaga el error
        return data;                                                  // Devuelve las filas
      },                                                              // Fin de listar
      async historial() {                                             // Trae los últimos cambios
        const { data, error } = await cli.from("historial").select("*").order("fecha", { ascending: false }).limit(30); // 30 más recientes
        if (error) throw error;                                       // Propaga el error
        return data;                                                  // Devuelve las filas
      },                                                              // Fin de historial
      async guardar(t, original) {                                    // Crea o edita (original = cómo estaba antes de editar)
        let datos = fila(t);                                          // Por defecto, todos los campos editables
        if (t.id && original) {                                       // Si es edición y se conoce la versión anterior…
          const antes = fila(original);                               // …campos como estaban al abrir la tarea
          const nuevo = fila(t);                                      // Campos como quedaron al guardar
          datos = {};                                                 // Solo se enviarán los campos cambiados
          CAMPOS.forEach((k) => { const cambio = k === "checklist" ? !igual(nuevo[k], antes[k]) : String(nuevo[k] ?? "") !== String(antes[k] ?? ""); if (cambio) datos[k] = nuevo[k]; }); // Compara campo por campo
          if (!Object.keys(datos).length) return t;                   // Nada cambió: no se escribe
        }                                                             // Así no se pisan cambios que hizo la otra persona en otros campos
        const consulta = t.id                                         // Si tiene id…
          ? cli.from("tareas").update(datos).eq("id", t.id)           // …actualiza solo esos campos
          : cli.from("tareas").insert(datos);                         // …si no, inserta una nueva
        const { data, error } = await consulta.select().single();     // Ejecuta y devuelve la fila guardada
        if (error) throw error;                                       // Propaga el error
        return data;                                                  // Devuelve la fila
      },                                                              // Fin de guardar
      async eliminar(t) {                                             // Elimina una tarea
        const { error } = await cli.from("tareas").delete().eq("id", t.id); // Borra por id
        if (error) throw error;                                       // Propaga el error
      },                                                              // Fin de eliminar
      escuchar(alCambiar) {                                           // Se suscribe a cambios en tiempo real
        cli.channel("cambios-boda")                                   // Canal propio
          .on("postgres_changes", { event: "*", schema: "public", table: "tareas" }, alCambiar) // Cualquier cambio en tareas
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "historial" }, alCambiar) // Nuevas entradas de historial
          .subscribe();                                               // Activa la suscripción
      }                                                               // Fin de escuchar
    };                                                                // Fin de métodos
  }                                                                   // Fin de apiSupabase

  // ---------- Carga de datos ----------
  async function cargar() {                                           // Trae tareas e historial y redibuja
    try {                                                             // Intenta
      const [tareas, historial] = await Promise.all([S.api.listar(), S.api.historial()]); // Ambas consultas en paralelo
      S.tareas = tareas;                                              // Guarda las tareas
      S.historial = historial;                                        // Guarda el historial
    } catch (e) {                                                     // Si falla
      aviso("No se pudo cargar: " + (e.message || e));                // Avisa
    }                                                                 // Fin del try
    render();                                                         // Redibuja
  }                                                                   // Fin de cargar

  let temporizadorRecarga;                                            // Temporizador para agrupar recargas
  const programarRecarga = () => { clearTimeout(temporizadorRecarga); temporizadorRecarga = setTimeout(cargar, 400); }; // Recarga una vez tras varios eventos

  // ---------- Filtros ----------
  function filtradas() {                                              // Aplica los filtros a las tareas
    const f = S.filtros;                                              // Filtros activos
    const q = f.texto.trim().toLowerCase();                           // Texto buscado
    return S.tareas.filter((t) =>                                     // Filtra
      (!f.grupo || t.grupo === f.grupo) &&                            // Por grupo
      (!f.responsable || t.responsable === f.responsable) &&          // Por responsable
      (!f.estado || t.estado === f.estado) &&                         // Por estado
      (!f.semaforo || semaforo(t) === f.semaforo) &&                  // Por semáforo
      (!q || [t.codigo, t.tarea, t.categoria, t.proveedor, t.proximo_paso, t.observaciones, t.grupo] // Campos donde buscar
        .some((v) => String(v || "").toLowerCase().includes(q)))      // Coincide en alguno
    );                                                                // Fin del filtro
  }                                                                   // Fin de filtradas

  function gruposOrdenados(lista) {                                   // Grupos en el orden de config, más los que aparezcan
    const base = Object.values(C.GRUPOS);                             // Grupos configurados
    const extra = [...new Set(lista.map((t) => t.grupo))].filter((g) => !base.includes(g)); // Grupos no configurados
    return [...base, ...extra];                                       // Unión ordenada
  }                                                                   // Fin de gruposOrdenados

  // ---------- Piezas visuales reutilizables ----------
  const chipEstado = (e) => `<span class="chip estado-${clase(e)}">${esc(e)}</span>`;        // Etiqueta de estado
  function chipFecha(t) {                                             // Etiqueta de fecha con color de semáforo
    const s = semaforo(t);                                            // Semáforo
    if (s === "Terminado") return `<span class="chip terminado">✓ ${esc(fmtFecha(t.fecha_limite))}</span>`; // Terminada
    if (s === "Sin fecha") return `<span class="chip">Sin fecha</span>`;                          // Sin fecha
    const d = dias(t.fecha_limite);                                   // Días restantes
    const extra = s === "Vencida" ? ` · hace ${-d} d` : (d === 0 ? " · hoy" : ` · en ${d} d`);  // Texto complementario
    return `<span class="chip ${clase(s)}">${esc(fmtFecha(t.fecha_limite))}${extra}</span>`;   // Etiqueta final
  }                                                                   // Fin de chipFecha
  function chipChecklist(t) {                                         // Etiqueta "☑ 2/5" con el avance del checklist
    const p = progreso(t);                                            // Ítems hechos y total
    if (!p.total) return "";                                          // Sin checklist, sin etiqueta
    return `<span class="chip${p.hechos === p.total ? " terminado" : ""}" title="Checklist">☑ ${p.hechos}/${p.total}</span>`; // Verde si está completo
  }                                                                   // Fin de chipChecklist
  function chipBloqueo(t) {                                           // Etiqueta "espera a…"
    const b = bloqueadaPor(t);                                        // Dependencias pendientes
    return b.length ? `<span class="chip bloqueada" title="Depende de tareas no terminadas">⏳ ${esc(b.join(", "))}</span>` : ""; // Solo si hay
  }                                                                   // Fin de chipBloqueo
  function filaTarea(t, derecha) {                                    // Fila compacta clicable
    return `<div class="fila" data-id="${t.id}"><span class="codigo">${esc(t.codigo)}</span>` + // Código
      `<span class="texto">${esc(t.tarea)} <span class="sub">${esc(t.responsable)}${t.lider ? " · lidera " + esc(t.lider) : ""}</span></span>` + // Nombre y responsable
      `${derecha || chipFecha(t)}</div>`;                             // Parte derecha
  }                                                                   // Fin de filaTarea

  // ---------- Vista: Inicio ----------
  function vistaInicio() {                                            // Resumen general
    const T = S.tareas;                                               // Todas las tareas
    const n = (e) => T.filter((t) => t.estado === e).length;          // Conteo por estado
    const listos = n("Terminado");                                    // Tareas terminadas
    const venc = T.filter((t) => semaforo(t) === "Vencida").sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite)); // Vencidas, más antiguas primero
    const prox = T.filter((t) => semaforo(t) === "Próxima").sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite)); // Próximas, más cercanas primero
    const saldoTotal = T.reduce((s, t) => s + (saldo(t) || 0), 0);    // Saldo pendiente total
    const avance = T.length ? Math.round((listos / T.length) * 100) : 0; // Porcentaje de avance
    let h = `<div class="kpis">` +                                    // Indicadores
      `<div class="kpi ok"><b>${avance}%</b><span>Avance (${listos} de ${T.length})</span></div>` + // Avance
      `<div class="kpi"><b>${n("En proceso")}</b><span>En proceso</span></div>` +                  // En proceso
      `<div class="kpi alerta"><b>${venc.length}</b><span>Vencidas</span></div>` +                 // Vencidas
      `<div class="kpi proximo"><b>${prox.length}</b><span>Vencen en ≤${C.DIAS_ALERTA} días</span></div>` + // Próximas
      `<div class="kpi"><b style="font-size:26px">${fmtCOP(saldoTotal)}</b><span>Saldo por pagar</span></div>` + // Saldo
      `</div>`;                                                       // Fin de indicadores
    h += `<div class="dos-columnas"><div>`;                           // Columna izquierda
    h += `<h2 class="seccion-titulo">Avance por grupo</h2>`;          // Título
    h += `<div class="leyenda"><span><i style="background:var(--salvia)"></i>Terminado</span><span><i style="background:var(--azul);opacity:.7"></i>En proceso</span></div>`; // Leyenda
    gruposOrdenados(T).forEach((g) => {                               // Por cada grupo
      const G = T.filter((t) => t.grupo === g);                       // Tareas del grupo
      if (!G.length) return;                                          // Omite grupos vacíos
      const pct = (e) => (G.filter((t) => t.estado === e).length / G.length) * 100; // Porcentaje por estado
      const v = G.filter((t) => semaforo(t) === "Vencida").length;    // Vencidas del grupo
      h += `<div class="grupo-avance" data-grupo="${esc(g)}" title="Ver en la lista">` + // Fila clicable
        `<span class="nombre">${esc(g)}${v ? ` <span class="chip vencida">${v} vencida${v > 1 ? "s" : ""}</span>` : ""}</span>` + // Nombre y vencidas
        `<span class="cifra">${G.filter((t) => t.estado === "Terminado").length}/${G.length}</span>` + // Listas/total
        `<div class="barra"><i class="b-listo" style="width:${pct("Terminado")}%"></i><i class="b-proceso" style="width:${pct("En proceso")}%"></i></div></div>`; // Barra
    });                                                               // Fin de grupos
    h += `</div><div>`;                                               // Columna derecha
    h += `<h2 class="seccion-titulo">Vencidas</h2>`;                  // Título
    h += venc.length ? venc.map((t) => filaTarea(t)).join("") : `<p class="vacio">Nada vencido. 🎉</p>`; // Lista o mensaje
    h += `<h2 class="seccion-titulo">Próximos ${C.DIAS_ALERTA} días</h2>`; // Título
    h += prox.length ? prox.map((t) => filaTarea(t)).join("") : `<p class="vacio">Nada vence en los próximos ${C.DIAS_ALERTA} días.</p>`; // Lista o mensaje
    h += `<h2 class="seccion-titulo">Actividad reciente</h2>`;        // Título
    h += S.historial.length ? S.historial.slice(0, 12).map(describir).join("") : `<p class="vacio">Aún no hay cambios registrados.</p>`; // Historial
    h += `</div></div>`;                                              // Cierra columnas
    return h;                                                         // Devuelve el HTML
  }                                                                   // Fin de vistaInicio

  function describir(ev) {                                            // Texto de un evento del historial
    let detalle = "";                                                 // Detalle del cambio
    if (ev.accion === "editó" && ev.cambios) {                        // Si fue edición
      detalle = Object.entries(ev.cambios).slice(0, 3).map(([k, v]) => // Hasta 3 campos
        k === "estado" ? `estado: ${esc(v.antes)} → <b>${esc(v.despues)}</b>` : esc(ETIQUETAS[k] || k) // Estado con detalle; otros solo el nombre
      ).join(", ");                                                   // Separados por coma
      detalle = detalle ? ` (${detalle})` : "";                       // Entre paréntesis
    }                                                                 // Fin del if
    return `<div class="actividad"><b>${esc(nombreDe(ev.usuario))}</b> ${esc(ev.accion)} <span class="codigo">${esc(ev.tarea_codigo)}</span> ${esc(ev.tarea_titulo)}${detalle} <small>· ${hace(ev.fecha)}</small></div>`; // Línea final
  }                                                                   // Fin de describir

  // ---------- Vista: Tablero ----------
  function vistaTablero() {                                           // Columnas por estado
    const lista = filtradas();                                        // Tareas filtradas
    const orden = { "Vencida": 0, "Próxima": 1, "A tiempo": 2, "Sin fecha": 3, "Terminado": 4 }; // Prioridad visual del semáforo
    return `<div class="tablero">` + C.ESTADOS.map((e) => {           // Una columna por estado
      const col = lista.filter((t) => t.estado === e)                 // Tareas de ese estado
        .sort((a, b) => orden[semaforo(a)] - orden[semaforo(b)] || String(a.fecha_limite || "9").localeCompare(String(b.fecha_limite || "9"))); // Urgentes primero
      return `<section class="columna" data-estado="${esc(e)}"><h3><span>${esc(e)}</span><span>${col.length}</span></h3>` + // Encabezado
        `<div class="columna-tarjetas">` + (col.map(tarjeta).join("") || `<p class="vacio">—</p>`) + `</div></section>`; // Tarjetas con desplazamiento propio
    }).join("") + `</div>`;                                           // Cierra el tablero
  }                                                                   // Fin de vistaTablero

  function tarjeta(t) {                                               // Tarjeta del tablero
    return `<article class="tarjeta sem-${clase(semaforo(t))}" draggable="true" data-id="${t.id}">` + // Contenedor arrastrable
      `<span class="codigo">${esc(t.codigo)} · ${esc(t.categoria || t.grupo)}</span>` + // Código y categoría
      `<div class="titulo">${esc(t.tarea)}</div>` +                   // Nombre
      `<div class="meta"><span class="chip">${esc(t.responsable)}</span>${chipFecha(t)}` + // Responsable y fecha
      `${t.prioridad === "Alta" ? `<span class="chip alta">Alta</span>` : ""}${chipChecklist(t)}${chipBloqueo(t)}</div>` + // Prioridad y bloqueo
      `${t.proximo_paso ? `<div class="paso">→ ${esc(t.proximo_paso)}</div>` : ""}` + // Próximo paso
      `<div class="mover"><select data-mover="${t.id}" aria-label="Cambiar estado">${C.ESTADOS.map((e) => `<option${e === t.estado ? " selected" : ""}>${esc(e)}</option>`).join("")}</select></div>` + // Selector (celular)
      `</article>`;                                                   // Cierra la tarjeta
  }                                                                   // Fin de tarjeta

  // ---------- Vista: Lista ----------
  function vistaLista() {                                             // Tabla agrupada
    const lista = filtradas();                                        // Tareas filtradas
    let h = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><span class="sub">${lista.length} de ${S.tareas.length} tareas</span><button class="btn" id="btn-csv">Descargar CSV (Excel)</button></div>`; // Conteo y exportar
    gruposOrdenados(lista).forEach((g) => {                           // Por grupo
      const G = lista.filter((t) => t.grupo === g).sort((a, b) => a.codigo.localeCompare(b.codigo)); // Tareas del grupo ordenadas
      if (!G.length) return;                                          // Omite vacíos
      h += `<div class="grupo-bloque"><h3>${esc(g)}<small>${G.filter((t) => t.estado === "Terminado").length}/${G.length} terminadas</small></h3>`; // Título del grupo
      h += `<table class="tabla"><thead><tr><th>Código</th><th>Tarea</th><th>Responsable</th><th>Fecha límite</th><th>Estado</th><th>Prioridad</th></tr></thead><tbody>`; // Encabezados
      h += G.map((t) => `<tr data-id="${t.id}">` +                    // Fila clicable
        `<td class="codigo">${esc(t.codigo)}</td>` +                  // Código
        `<td><b>${esc(t.tarea)}</b><span class="sub">${esc(t.categoria || "")}${t.proximo_paso ? " · → " + esc(t.proximo_paso) : ""}</span>${chipChecklist(t)}${chipBloqueo(t)}</td>` + // Nombre, categoría, próximo paso y checklist
        `<td data-l="Responsable">${esc(t.responsable)}${t.lider ? `<span class="sub">lidera ${esc(t.lider)}</span>` : ""}</td>` + // Responsable y líder
        `<td data-l="Fecha">${chipFecha(t)}</td>` +                   // Fecha con semáforo
        `<td data-l="Estado">${chipEstado(t.estado)}</td>` +          // Estado
        `<td data-l="Prioridad">${esc(t.prioridad)}</td></tr>`).join(""); // Prioridad
      h += `</tbody></table></div>`;                                  // Cierra la tabla
    });                                                               // Fin de grupos
    if (!lista.length) h += `<p class="vacio">Ninguna tarea coincide con los filtros.</p>`; // Sin resultados
    return h;                                                         // Devuelve el HTML
  }                                                                   // Fin de vistaLista

  // ---------- Vista: Cronograma ----------
  function vistaCronograma() {                                        // Tareas agrupadas por mes
    const lista = filtradas();                                        // Tareas filtradas
    const boda = aFecha(C.FECHA_BODA);                                // Fecha de la boda
    const claveMes = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`; // "2026-10"
    const meses = {};                                                 // Mapa mes → tareas
    lista.filter((t) => t.fecha_limite).forEach((t) => { const k = claveMes(aFecha(t.fecha_limite)); (meses[k] = meses[k] || []).push(t); }); // Agrupa por mes
    const kBoda = claveMes(boda);                                     // Mes de la boda
    meses[kBoda] = meses[kBoda] || [];                                // Asegura que aparezca el mes de la boda
    const kHoy = claveMes(hoy());                                     // Mes actual
    let h = "";                                                       // HTML acumulado
    Object.keys(meses).sort().forEach((k) => {                        // Meses en orden
      const [y, m] = k.split("-").map(Number);                        // Año y mes
      const nombre = new Date(y, m - 1, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" }); // "octubre de 2026"
      const items = meses[k].sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite)); // Ordena por fecha
      h += `<div class="mes${k === kHoy ? " actual" : ""}"><h3>${esc(nombre)}<small>${items.length} tarea${items.length === 1 ? "" : "s"}${k === kHoy ? " · mes actual" : ""}</small></h3><div>`; // Encabezado del mes
      let puesta = k !== kBoda;                                       // Si es el mes de la boda, falta poner el hito
      items.forEach((t) => {                                          // Por cada tarea
        if (!puesta && aFecha(t.fecha_limite) > boda) { h += hitoBoda(); puesta = true; } // Inserta el hito en su lugar
        h += `<div class="fila" data-id="${t.id}"><span class="dia">${aFecha(t.fecha_limite).getDate()}</span><span class="texto">${esc(t.tarea)} <span class="sub">${esc(t.codigo)} · ${esc(t.responsable)}</span></span>${chipEstado(t.estado)} ${chipFecha(t)}</div>`; // Fila
      });                                                             // Fin de tareas
      if (!puesta) h += hitoBoda();                                   // Hito al final si no se puso
      h += `</div></div>`;                                            // Cierra el mes
    });                                                               // Fin de meses
    const sinFecha = lista.filter((t) => !t.fecha_limite);            // Tareas sin fecha
    if (sinFecha.length) h += `<div class="mes"><h3>Sin fecha<small>${sinFecha.length} tarea${sinFecha.length === 1 ? "" : "s"}</small></h3><div>${sinFecha.map((t) => filaTarea(t, chipEstado(t.estado))).join("")}</div></div>`; // Bloque sin fecha
    return h;                                                         // Devuelve el HTML
  }                                                                   // Fin de vistaCronograma
  const hitoBoda = () => `<div class="hito">💍 ${esc(aFecha(C.FECHA_BODA).getDate())} · ¡Nos casamos!</div>`; // Marca del día de la boda

  // ---------- Vista: Pagos ----------
  function vistaPagos() {                                             // Resumen de dinero
    const P = S.tareas.filter((t) => Number(t.valor_total) > 0 || Number(t.valor_abonado) > 0 || t.fecha_proximo_pago) // Tareas con plata
      .sort((a, b) => (saldo(b) || 0) - (saldo(a) || 0));             // Mayor saldo primero
    const tot = P.reduce((s, t) => s + Number(t.valor_total || 0), 0); // Total comprometido
    const abo = P.reduce((s, t) => s + Number(t.valor_abonado || 0), 0); // Total abonado
    const sal = P.reduce((s, t) => s + (saldo(t) || 0), 0);           // Saldo total
    let h = `<div class="kpis">` +                                    // Indicadores
      `<div class="kpi"><b style="font-size:26px">${fmtCOP(tot)}</b><span>Total comprometido</span></div>` + // Total
      `<div class="kpi ok"><b style="font-size:26px">${fmtCOP(abo)}</b><span>Abonado</span></div>` +       // Abonado
      `<div class="kpi alerta"><b style="font-size:26px">${fmtCOP(sal)}</b><span>Saldo pendiente</span></div>` + // Saldo
      `<div class="kpi"><b>${tot ? Math.round((abo / tot) * 100) : 0}%</b><span>Pagado</span></div></div>`; // Porcentaje
    h += `<p class="sub" style="margin:14px 0">Para registrar un pago, abre la tarea y actualiza "Valor abonado". Para agregar un gasto, llena "Valor total" en la tarea correspondiente.</p>`; // Instrucción
    h += `<table class="tabla"><thead><tr><th>Código</th><th>Proveedor / tarea</th><th class="num">Valor total</th><th class="num">Abonado</th><th class="num">Saldo</th><th>Próximo pago</th><th>Estado</th></tr></thead><tbody>`; // Encabezados
    h += P.map((t) => `<tr data-id="${t.id}"><td class="codigo">${esc(t.codigo)}</td>` + // Fila clicable
      `<td><b>${esc(t.proveedor || "Sin proveedor")}</b><span class="sub">${esc(t.tarea)}</span></td>` + // Proveedor y tarea
      `<td data-l="Total" class="num">${fmtCOP(t.valor_total)}</td><td data-l="Abonado" class="num">${fmtCOP(t.valor_abonado)}</td>` + // Total y abonado
      `<td data-l="Saldo" class="num"><b>${fmtCOP(saldo(t))}</b></td>` + // Saldo
      `<td data-l="Próximo pago">${t.fecha_proximo_pago ? esc(fmtFecha(t.fecha_proximo_pago)) : `<span class="sub">Por definir</span>`}</td>` + // Próximo pago
      `<td data-l="Estado">${chipEstado(t.estado)}</td></tr>`).join(""); // Estado
    h += `</tbody><tfoot><tr><td></td><td>Total</td><td class="num" data-l="Total">${fmtCOP(tot)}</td><td class="num" data-l="Abonado">${fmtCOP(abo)}</td><td class="num" data-l="Saldo">${fmtCOP(sal)}</td><td></td><td></td></tr></tfoot></table>`; // Totales
    return h;                                                         // Devuelve el HTML
  }                                                                   // Fin de vistaPagos

  // ---------- Dibujo general ----------
  const VISTAS = { inicio: vistaInicio, tablero: vistaTablero, lista: vistaLista, cronograma: vistaCronograma, pagos: vistaPagos }; // Mapa vista → función
  function render() {                                                 // Redibuja la vista activa
    const d = dias(C.FECHA_BODA);                                     // Días a la boda
    $("#dias-faltan").textContent = d > 0 ? d : (d === 0 ? "¡Hoy!" : "💍"); // Contador
    $("#filtros").hidden = !["tablero", "lista", "cronograma"].includes(S.vista); // Filtros solo en estas vistas
    $("#lista-categorias").innerHTML = [...new Set(S.tareas.map((t) => t.categoria).filter(Boolean))].sort().map((c) => `<option value="${esc(c)}">`).join(""); // Sugerencias de categoría
    $("#vista").innerHTML = VISTAS[S.vista]();                        // Dibuja la vista
    document.querySelectorAll(".pestana").forEach((b) => b.classList.toggle("activa", b.dataset.vista === S.vista)); // Marca la pestaña activa
  }                                                                   // Fin de render

  function irA(vista) {                                               // Cambia de vista
    S.vista = vista;                                                  // Guarda la vista
    try { localStorage.setItem("boda-vista", vista); } catch (e) { /* sin almacenamiento */ } // Recuerda la vista
    render();                                                         // Redibuja
    window.scrollTo(0, 0);                                            // Sube al inicio
  }                                                                   // Fin de irA

  // ---------- Cambios de estado rápidos ----------
  async function cambiarEstado(id, estado) {                          // Mueve una tarea a otro estado
    const t = S.tareas.find((x) => String(x.id) === String(id));      // Busca la tarea
    if (!t || t.estado === estado) return;                            // Nada que hacer
    const anterior = t.estado;                                        // Guarda el estado anterior
    t.estado = estado;                                                // Cambio optimista en pantalla
    render();                                                         // Redibuja de inmediato
    try {                                                             // Intenta guardar
      await S.api.guardar({ ...t }, { ...t, estado: anterior });      // Guarda solo el cambio de estado
      aviso(`${t.codigo} → ${estado}`);                               // Confirma
      await cargar();                                                 // Recarga datos
    } catch (e) {                                                     // Si falla
      t.estado = anterior;                                            // Revierte
      render();                                                       // Redibuja
      aviso("No se pudo guardar: " + (e.message || e));               // Avisa
    }                                                                 // Fin del try
  }                                                                   // Fin de cambiarEstado

  // ---------- Modal de edición ----------
  const form = $("#form-tarea");                                      // Formulario del modal
  form.addEventListener("input", (ev) => {                            // Mientras se escribe en el formulario
    if (!ev.target.classList.contains("campo-dinero")) return;        // Solo en los campos de dinero
    const n = aPesos(ev.target.value);                                // Lee el número escrito
    ev.target.value = conPuntos(n);                                   // Lo muestra con puntos de miles
  });                                                                 // Fin del formateo en vivo
  function abrirModal(t) {                                            // Abre el modal para editar o crear
    S.editando = t || null;                                           // Guarda la tarea en edición
    form.reset();                                                     // Limpia el formulario
    const base = t || { estado: "No iniciado", prioridad: "Media", responsable: "Ambos", grupo: S.filtros.grupo || Object.values(C.GRUPOS)[0] }; // Valores por defecto
    CAMPOS.forEach((k) => { if (form.elements[k]) form.elements[k].value = base[k] ?? ""; }); // Llena cada campo
    ["valor_total", "valor_abonado"].forEach((k) => { form.elements[k].value = conPuntos(base[k]); }); // Muestra montos con puntos de miles
    S.checklist = lista(base).map((i) => ({ texto: i.texto, hecho: !!i.hecho })); // Copia editable del checklist
    $("#checklist-texto").value = "";                                 // Limpia el campo de nuevo ítem
    dibujarChecklist();                                               // Dibuja los ítems
    $("#modal-titulo").textContent = t ? `${t.codigo} · Editar tarea` : "Nueva tarea"; // Título
    $("#btn-eliminar").hidden = !t;                                   // Eliminar solo al editar
    $("#confirmar-eliminar").hidden = true;                           // Oculta la confirmación
    $("#modal-meta").textContent = t && t.actualizado_en ? `Última modificación: ${nombreDe(t.actualizado_por)} · ${new Date(t.actualizado_en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}` : ""; // Última modificación
    $("#modal").showModal();                                          // Muestra el modal
  }                                                                   // Fin de abrirModal

  // ---------- Checklist dentro del modal ----------
  function dibujarChecklist() {                                       // Dibuja los ítems del checklist en el modal
    const p = { hechos: S.checklist.filter((i) => i.hecho).length, total: S.checklist.length }; // Avance actual
    $("#checklist-progreso").textContent = p.total ? `${p.hechos} de ${p.total}` : "sin ítems"; // Texto de avance
    $("#checklist-lista").innerHTML = S.checklist.map((i, n) =>       // Un renglón por ítem
      `<li class="${i.hecho ? "hecho" : ""}">` +                      // Tachado si está hecho
      `<input type="checkbox" data-item="${n}" ${i.hecho ? "checked" : ""} aria-label="Marcar ítem">` + // Casilla
      `<input type="text" data-texto="${n}" value="${esc(i.texto)}" aria-label="Texto del ítem">` + // Texto editable
      `<button type="button" class="btn-link" data-quitar="${n}" aria-label="Quitar ítem">✕</button></li>` // Botón quitar
    ).join("");                                                       // Une los renglones
  }                                                                   // Fin de dibujarChecklist

  function agregarItem() {                                            // Agrega el ítem escrito en el campo de nuevo ítem
    const campo = $("#checklist-texto");                              // Campo de texto
    const texto = campo.value.trim();                                 // Texto sin espacios sobrantes
    if (!texto) return;                                               // Si está vacío, no hace nada
    S.checklist.push({ texto, hecho: false });                        // Agrega el ítem sin marcar
    campo.value = "";                                                 // Limpia el campo
    dibujarChecklist();                                               // Redibuja
  }                                                                   // Fin de agregarItem

  $("#checklist-agregar").addEventListener("click", () => { agregarItem(); $("#checklist-texto").focus(); }); // Botón Agregar
  $("#checklist-texto").addEventListener("keydown", (ev) => {         // Enter en el campo de nuevo ítem
    if (ev.key !== "Enter") return;                                   // Solo la tecla Enter
    ev.preventDefault();                                              // Evita que Enter guarde todo el formulario
    agregarItem();                                                    // Agrega el ítem
  });                                                                 // Fin de Enter
  $("#checklist-lista").addEventListener("change", (ev) => {          // Marcar o desmarcar un ítem
    const n = ev.target.dataset.item;                                 // Posición del ítem
    if (n === undefined) return;                                      // Solo casillas
    S.checklist[n].hecho = ev.target.checked;                         // Guarda la marca
    dibujarChecklist();                                               // Redibuja (tachado y avance)
  });                                                                 // Fin de marcar
  $("#checklist-lista").addEventListener("input", (ev) => {           // Editar el texto de un ítem
    const n = ev.target.dataset.texto;                                // Posición del ítem
    if (n !== undefined) S.checklist[n].texto = ev.target.value;      // Guarda el texto nuevo
  });                                                                 // Fin de editar
  $("#checklist-lista").addEventListener("keydown", (ev) => {         // Enter dentro de un ítem
    if (ev.key === "Enter" && ev.target.dataset.texto !== undefined) ev.preventDefault(); // No guarda todo el formulario
  });                                                                 // Fin de Enter en ítems
  $("#checklist-lista").addEventListener("click", (ev) => {           // Quitar un ítem
    const n = ev.target.dataset.quitar;                               // Posición del ítem
    if (n === undefined) return;                                      // Solo botones de quitar
    S.checklist.splice(Number(n), 1);                                 // Lo quita de la lista
    dibujarChecklist();                                               // Redibuja
  });                                                                 // Fin de quitar

  function siguienteCodigo(grupo) {                                   // Siguiente código libre del grupo
    const letra = Object.keys(C.GRUPOS).find((k) => C.GRUPOS[k] === grupo) || "X"; // Letra del grupo
    const max = S.tareas.filter((t) => t.codigo.startsWith(letra + "-")) // Códigos de ese grupo
      .reduce((m, t) => Math.max(m, parseInt(t.codigo.split("-")[1], 10) || 0), 0); // Número más alto
    return `${letra}-${String(max + 1).padStart(2, "0")}`;            // Siguiente, con dos dígitos
  }                                                                   // Fin de siguienteCodigo

  form.addEventListener("submit", async (ev) => {                     // Al guardar el formulario
    ev.preventDefault();                                              // Evita el cierre automático
    const boton = form.querySelector("[type=submit]");                // Botón Guardar
    if (boton.disabled) return;                                       // Evita doble envío
    const t = { ...(S.editando || {}) };                              // Parte de la tarea original (o vacía)
    CAMPOS.forEach((k) => { if (form.elements[k]) t[k] = vacioANulo(form.elements[k].value.trim()); }); // Lee cada campo
    ["valor_total", "valor_abonado"].forEach((k) => { t[k] = aPesos(form.elements[k].value); }); // Convierte montos a número entero de pesos
    agregarItem();                                                    // Si quedó un ítem escrito sin agregar, lo agrega
    t.checklist = S.checklist.filter((i) => i.texto.trim()).map((i) => ({ texto: i.texto.trim(), hecho: !!i.hecho })); // Checklist limpio (sin ítems vacíos)
    if (t.depende_de) t.depende_de = t.depende_de.toUpperCase().split(/[,\s]+/).filter(Boolean).join(", "); // Normaliza dependencias
    if (!S.editando) t.codigo = siguienteCodigo(t.grupo);             // Código para tareas nuevas
    boton.disabled = true;                                            // Bloquea el botón
    try {                                                             // Intenta guardar
      await S.api.guardar(t, S.editando);                             // Guarda solo los campos que cambiaron
      $("#modal").close();                                            // Cierra el modal
      aviso(S.editando ? "Cambios guardados" : `Tarea ${t.codigo} creada`); // Confirma
      await cargar();                                                 // Recarga
    } catch (e) {                                                     // Si falla
      aviso("No se pudo guardar: " + (e.message || e));               // Avisa
    } finally {                                                       // Siempre
      boton.disabled = false;                                         // Libera el botón
    }                                                                 // Fin del try
  });                                                                 // Fin de submit

  $("#btn-eliminar").addEventListener("click", () => { $("#confirmar-eliminar").hidden = false; }); // Pide confirmación
  $("#btn-eliminar-si").addEventListener("click", async () => {       // Confirma la eliminación
    try {                                                             // Intenta eliminar
      await S.api.eliminar(S.editando);                               // Elimina
      $("#modal").close();                                            // Cierra el modal
      aviso(`Tarea ${S.editando.codigo} eliminada`);                  // Confirma
      await cargar();                                                 // Recarga
    } catch (e) { aviso("No se pudo eliminar: " + (e.message || e)); } // Avisa si falla
  });                                                                 // Fin de eliminar
  document.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => $("#modal").close())); // Botones de cerrar

  // ---------- Exportar CSV ----------
  function descargarCSV() {                                           // Descarga las tareas filtradas para Excel
    const cols = ["codigo", "grupo", "categoria", "tarea", "responsable", "lider", "prioridad", "fecha_limite", "estado", "proveedor", "valor_total", "valor_abonado", "fecha_proximo_pago", "proximo_paso", "depende_de", "observaciones"]; // Columnas
    const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;  // Encierra en comillas y escapa comillas
    const filas = [cols.concat("semaforo", "saldo", "checklist").join(";")]        // Encabezado (punto y coma para Excel en español)
      .concat(filtradas().map((t) => cols.map((c) => celda(t[c])).concat(celda(semaforo(t)), celda(saldo(t)), celda(progreso(t).total ? `${progreso(t).hechos}/${progreso(t).total}` : "")).join(";"))); // Filas
    const blob = new Blob(["﻿" + filas.join("\r\n")], { type: "text/csv;charset=utf-8" }); // BOM para que Excel lea tildes
    const a = document.createElement("a");                            // Enlace temporal
    a.href = URL.createObjectURL(blob);                               // Apunta al archivo
    a.download = `boda_tareas_${new Date().toISOString().slice(0, 10)}.csv`; // Nombre con fecha
    a.click();                                                        // Descarga
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);              // Libera memoria
  }                                                                   // Fin de descargarCSV

  // ---------- Eventos de la vista (delegados) ----------
  const vista = $("#vista");                                          // Contenedor de vistas
  vista.addEventListener("click", (ev) => {                           // Clics dentro de la vista
    if (ev.target.closest("select")) return;                          // Ignora clics en selectores
    if (ev.target.closest("#btn-csv")) return descargarCSV();         // Botón de CSV
    const g = ev.target.closest("[data-grupo]");                      // Fila de avance por grupo
    if (g) { S.filtros.grupo = g.dataset.grupo; $("#f-grupo").value = g.dataset.grupo; return irA("lista"); } // Abre la lista filtrada
    const el = ev.target.closest("[data-id]");                        // Elemento de tarea
    if (el) abrirModal(S.tareas.find((t) => String(t.id) === el.dataset.id)); // Abre el modal
  });                                                                 // Fin de clics
  vista.addEventListener("change", (ev) => {                          // Cambios en selectores de la vista
    if (ev.target.dataset.mover) cambiarEstado(ev.target.dataset.mover, ev.target.value); // Selector de estado (celular)
  });                                                                 // Fin de cambios
  vista.addEventListener("dragstart", (ev) => {                       // Empieza a arrastrar una tarjeta
    const t = ev.target.closest(".tarjeta");                          // Tarjeta arrastrada
    if (!t) return;                                                   // Solo tarjetas
    ev.dataTransfer.setData("text/plain", t.dataset.id);              // Guarda su id
    t.classList.add("arrastrando");                                   // Estilo de arrastre
  });                                                                 // Fin de dragstart
  vista.addEventListener("dragend", (ev) => { ev.target.classList && ev.target.classList.remove("arrastrando"); }); // Termina el arrastre
  vista.addEventListener("dragover", (ev) => {                        // Pasa sobre una columna
    const c = ev.target.closest(".columna");                          // Columna destino
    if (!c) return;                                                   // Solo columnas
    ev.preventDefault();                                              // Permite soltar
    document.querySelectorAll(".columna.sobre").forEach((x) => x !== c && x.classList.remove("sobre")); // Quita resaltado a otras
    c.classList.add("sobre");                                         // Resalta esta
  });                                                                 // Fin de dragover
  vista.addEventListener("drop", (ev) => {                            // Suelta la tarjeta
    const c = ev.target.closest(".columna");                          // Columna destino
    if (!c) return;                                                   // Solo columnas
    ev.preventDefault();                                              // Evita comportamiento por defecto
    c.classList.remove("sobre");                                      // Quita resaltado
    cambiarEstado(ev.dataTransfer.getData("text/plain"), c.dataset.estado); // Cambia el estado
  });                                                                 // Fin de drop

  // ---------- Pestañas y filtros ----------
  document.querySelectorAll(".pestana").forEach((b) => b.addEventListener("click", () => irA(b.dataset.vista))); // Cambia de vista
  [["#f-texto", "texto", "input"], ["#f-grupo", "grupo", "change"], ["#f-responsable", "responsable", "change"], ["#f-estado", "estado", "change"], ["#f-semaforo", "semaforo", "change"]] // Filtro, clave y evento
    .forEach(([sel, clave, evento]) => $(sel).addEventListener(evento, (ev) => { S.filtros[clave] = ev.target.value; render(); })); // Actualiza y redibuja
  $("#f-limpiar").addEventListener("click", () => {                   // Limpia filtros
    Object.keys(S.filtros).forEach((k) => { S.filtros[k] = ""; });    // Vacía cada filtro
    ["#f-texto", "#f-grupo", "#f-responsable", "#f-estado", "#f-semaforo"].forEach((s) => { $(s).value = ""; }); // Vacía los controles
    render();                                                         // Redibuja
  });                                                                 // Fin de limpiar
  $("#btn-nueva").addEventListener("click", () => abrirModal(null));  // Botón de nueva tarea

  function llenarSelects() {                                          // Llena listas desplegables con la configuración
    const grupos = Object.values(C.GRUPOS);                           // Nombres de grupos
    $("#f-grupo").innerHTML += grupos.map((g) => `<option>${esc(g)}</option>`).join(""); // Filtro de grupo
    $("#f-estado").innerHTML += C.ESTADOS.map((e) => `<option>${esc(e)}</option>`).join(""); // Filtro de estado
    form.elements.grupo.innerHTML = grupos.map((g) => `<option>${esc(g)}</option>`).join(""); // Grupo en el modal
    form.elements.estado.innerHTML = C.ESTADOS.map((e) => `<option>${esc(e)}</option>`).join(""); // Estado en el modal
    $("#fecha-boda-texto").textContent = aFecha(C.FECHA_BODA).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" }); // Fecha en el encabezado
  }                                                                   // Fin de llenarSelects

  // ---------- Ingreso y arranque ----------
  function mostrar(id) {                                              // Muestra una sola pantalla
    ["#pantalla-login", "#pantalla-denegado", "#app"].forEach((s) => { $(s).hidden = s !== id; }); // Oculta las demás
  }                                                                   // Fin de mostrar

  async function mostrarApp() {                                       // Entra a la aplicación
    mostrar("#app");                                                  // Muestra la app
    $("#usuario-email").textContent = S.usuario ? (nombreDe(S.usuario.email) || S.usuario.email) : ""; // Nombre del usuario
    try { const v = localStorage.getItem("boda-vista"); if (v && VISTAS[v]) S.vista = v; } catch (e) { /* sin almacenamiento */ } // Recupera la última vista
    await cargar();                                                   // Carga datos
  }                                                                   // Fin de mostrarApp

  let entrando = false;                                               // Evita entrar dos veces
  async function entrar(sesion) {                                     // Valida la sesión y entra
    if (entrando || !sesion) return;                                  // Ya entrando o sin sesión
    entrando = true;                                                  // Marca
    S.usuario = sesion.user;                                          // Guarda el usuario
    const { data, error } = await S.cli.from("miembros").select("email, nombre"); // Lee miembros (solo visible para miembros)
    if (error || !data || !data.length) {                             // Si no es miembro
      $("#denegado-email").textContent = sesion.user.email;           // Muestra el correo
      mostrar("#pantalla-denegado");                                  // Pantalla de acceso denegado
      entrando = false;                                               // Permite reintentar
      return;                                                         // Termina
    }                                                                 // Fin del if
    S.miembros = data;                                                // Guarda miembros
    await mostrarApp();                                               // Entra
    S.api.escuchar(programarRecarga);                                 // Escucha cambios en tiempo real
    setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 60000); // Respaldo: recarga cada minuto
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cargar(); }); // Al volver a la página (p. ej. desbloquear el celular), recarga al instante
  }                                                                   // Fin de entrar

  function pasoCodigo(mostrar) {                                      // Cambia entre el paso del correo y el del código
    $("#form-login").hidden = mostrar;                                // Oculta o muestra el formulario de correo
    $("#form-codigo").hidden = !mostrar;                              // Muestra u oculta el formulario del código
    $("#login-instruccion").textContent = mostrar                     // Instrucción según el paso
      ? `Te enviamos un código de 6 dígitos a ${$("#login-email").value.trim() || "tu correo"}. Escríbelo aquí (revisa también correo no deseado).` // Paso 2
      : "Escribe tu correo y te enviamos un código para entrar.";     // Paso 1
    if (mostrar) $("#login-codigo").focus();                          // Pone el cursor en el código
  }                                                                   // Fin de pasoCodigo

  $("#form-login").addEventListener("submit", async (ev) => {         // Pide el código de ingreso
    ev.preventDefault();                                              // Evita recargar la página
    const email = $("#login-email").value.trim();                     // Correo escrito
    const msg = $("#login-mensaje");                                  // Mensaje de resultado
    msg.textContent = "Enviando…";                                    // Estado intermedio
    const { error } = await S.cli.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); // Envía el correo con el código
    const limite = error && /rate limit/i.test(error.message);          // ¿Se superó el límite de correos por hora?
    if (limite) {                                                     // Si se superó el límite
      msg.textContent = "Se enviaron muchos correos en poco tiempo. Si ya tienes un código reciente, úsalo; si no, espera una hora."; // Explica
      return;                                                         // No avanza
    }                                                                 // Fin del if
    if (error) { msg.textContent = "No se pudo enviar: " + error.message; return; } // Otro error
    msg.textContent = "";                                             // Limpia el mensaje
    pasoCodigo(true);                                                 // Pasa al paso del código
  });                                                                 // Fin del formulario de correo

  $("#form-codigo").addEventListener("submit", async (ev) => {        // Valida el código
    ev.preventDefault();                                              // Evita recargar la página
    const email = $("#login-email").value.trim();                     // Correo del paso 1
    const token = $("#login-codigo").value.replace(/\D/g, "");        // Código, solo números
    const msg = $("#login-mensaje");                                  // Mensaje de resultado
    if (!email) { msg.textContent = "Primero escribe tu correo."; pasoCodigo(false); return; } // Falta el correo
    msg.textContent = "Validando…";                                   // Estado intermedio
    const { error } = await S.cli.auth.verifyOtp({ email, token, type: "email" }); // Valida el código con Supabase
    if (error) {                                                      // Si el código no sirve
      msg.textContent = /expired|invalid/i.test(error.message)        // Mensaje según el error
        ? "El código no es válido o ya venció. Usa el más reciente o pide uno nuevo." // Código vencido o incorrecto
        : "No se pudo validar: " + error.message;                     // Otro error
      return;                                                         // No avanza
    }                                                                 // Fin del if
    msg.textContent = "";                                             // Limpia el mensaje; onAuthStateChange hace el ingreso
  });                                                                 // Fin del formulario del código

  $("#btn-ya-tengo").addEventListener("click", () => {                // Ya tiene un código
    if (!$("#login-email").reportValidity()) return;                  // Pide primero un correo válido
    pasoCodigo(true);                                                 // Pasa al paso del código
  });                                                                 // Fin de "ya tengo un código"
  $("#btn-otro-correo").addEventListener("click", () => pasoCodigo(false)); // Vuelve al paso del correo

  const salir = async () => { if (S.cli) await S.cli.auth.signOut(); location.reload(); }; // Cierra sesión
  $("#btn-salir").addEventListener("click", salir);                   // Botón Salir
  $("#btn-salir-denegado").addEventListener("click", salir);          // Botón en pantalla denegada

  async function iniciar() {                                          // Punto de arranque
    llenarSelects();                                                  // Prepara listas
    if (DEMO) {                                                       // Sin Supabase configurado
      S.api = apiDemo();                                              // Datos locales
      S.usuario = null;                                               // Sin usuario real
      $("#banner-demo").hidden = false;                               // Muestra el aviso de demo
      $("#btn-salir").hidden = true;                                  // Oculta Salir
      return mostrarApp();                                            // Entra directo
    }                                                                 // Fin del modo demo
    try { localStorage.removeItem("boda-seguimiento-demo"); } catch (e) { /* sin almacenamiento */ } // Borra datos de prueba viejos de este navegador
    if (SIN_CONFIG || !window.supabase) {                             // Publicada pero sin conexión (versión vieja en caché o fallo de red)
      document.body.innerHTML = `<div class="login"><div class="login-card"><h1>Actualiza la página</h1><p class="login-texto">Tu navegador cargó una versión vieja o no pudo conectarse. Presiona <b>Ctrl + F5</b> (en celular, cierra y vuelve a abrir la página).</p></div></div>`; // Mensaje claro en vez de modo demostración
      return;                                                         // No continúa
    }                                                                 // Fin de la verificación
    S.cli = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); // Crea el cliente de Supabase
    S.api = apiSupabase(S.cli);                                       // Capa de datos real
    S.cli.auth.onAuthStateChange((evento, sesion) => { if (evento === "SIGNED_IN") entrar(sesion); }); // Entra al abrir el enlace
    const { data } = await S.cli.auth.getSession();                   // Revisa si ya hay sesión guardada
    if (data.session) entrar(data.session); else mostrar("#pantalla-login"); // Entra o pide correo
  }                                                                   // Fin de iniciar

  iniciar();                                                          // Arranca la aplicación
})();                                                                 // Fin del encapsulado
