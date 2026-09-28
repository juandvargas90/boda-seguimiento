# Seguimiento de la boda · Ana & Juan

Página privada para que Ana y Juan lleven juntos las tareas de la boda (30 de enero de 2027): no iniciadas, en proceso y terminadas, por grupo y categoría, con cronograma y control de pagos.

- **Página:** GitHub Pages (este repositorio).
- **Datos:** Supabase (base de datos PostgreSQL con inicio de sesión por correo).
- **Acceso:** solo los correos registrados en la tabla `miembros`. Nadie más ve los datos, aunque tenga el enlace.

## Vistas

| Vista | Qué muestra |
|---|---|
| Inicio | Cuenta regresiva, avance general, avance por grupo, vencidas, próximas 15 días y actividad reciente (quién cambió qué) |
| Tablero | Columnas por estado; se arrastran tarjetas (en celular, con el selector de cada tarjeta) |
| Lista | Tabla por grupo con filtros y descarga a CSV para Excel |
| Cronograma | Tareas por mes hasta la boda |
| Pagos | Valor total, abonado y saldo por proveedor |

Los cambios de una persona le aparecen a la otra en segundos, sin recargar.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (misma paleta del Save the Date) |
| `app.js` | Lógica: vistas, edición, conexión a Supabase |
| `config.js` | **Lo único que se edita:** URL y llave de Supabase, fecha, grupos |
| `datos-iniciales.js` | Las 47 tareas, solo para el modo demostración |
| `supabase/01_esquema.sql` | Crea tablas, seguridad e historial |
| `supabase/02_datos_iniciales.sql` | Carga las 47 tareas |
| `supabase/03_miembros.sql` | Autoriza los correos de Ana y Juan |
| `supabase/04_checklist.sql` | Agrega el checklist de subactividades a cada tarea |
| `supabase/05_adjuntos.sql` | Fotos y archivos por tarea: columna, carpeta privada y seguridad |
| `supabase/06_pagos.sql` | Registro de pagos (quién, cuándo, cuánto, medio, comprobante); el abonado se calcula solo |

## Puesta en marcha (una sola vez)

1. **Crear el proyecto en Supabase** (supabase.com → New project).
2. En **SQL Editor**, ejecutar en orden: `01_esquema.sql`, `02_datos_iniciales.sql` y `03_miembros.sql` (con los correos reales).
3. En **Authentication → URL Configuration**:
   - *Site URL*: `https://juandvargas90.github.io/boda-seguimiento/`
   - *Redirect URLs*: agregar la misma dirección.
4. En **Project Settings → API**, copiar *Project URL* y la llave *anon public* en `config.js`.
5. En GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.

Sin datos de Supabase en `config.js`, la página abre en **modo demostración** (los cambios se guardan solo en ese navegador).

## Uso diario

- Entrar: escribir el correo → abrir el enlace que llega (en el mismo dispositivo).
- Crear tarea: botón **＋ Nueva tarea**. El código (A-08, B-05…) se asigna solo según el grupo.
- Cambiar estado: arrastrar la tarjeta en el Tablero o abrir la tarea.
- Registrar un pago: en la tarea, sección **Pagos de esta tarea → ＋ Registrar pago**, o desde la pestaña **Pagos**. Se indica monto, fecha, quién pagó (Juan, Ana, Ambos, familias u otra persona), medio, nota y comprobante opcional. El **Valor abonado** se calcula solo con la suma de los pagos.
- Balance: pestaña **Pagos** → total comprometido, pagado, saldo, quién ha pagado, próximos pagos, detalle por proveedor y movimientos (filtros por persona y mes, descarga a Excel).
- Checklist: dentro de cada tarea, después de Observaciones, se agregan ítems (Enter), se marcan y se quitan; se guardan con **Guardar**. El avance aparece como "☑ 2/5" en el tablero y la lista.
- Fotos: dentro de cada tarea ya guardada, **＋ Agregar foto o PDF** (en celular permite tomar la foto). Se suben al instante (las fotos se reducen a 1600 px); tocar una miniatura la abre en grande; la ✕ la quita (pide confirmación). Máximo 10 MB por archivo.
- Respaldo: en **Lista → Descargar CSV (Excel)**.

## Cambiar grupos o fechas

Editar `config.js`: `GRUPOS` (letra = prefijo del código), `FECHA_BODA` y `DIAS_ALERTA` (días para marcar una tarea como "Próxima").
