-- =====================================================================
-- Agrega el checklist de subactividades a cada tarea
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirlo)
-- =====================================================================
alter table public.tareas                              -- Modifica la tabla de tareas
  add column if not exists checklist jsonb             -- Nueva columna: lista de ítems [{ "texto": "...", "hecho": true/false }]
  not null default '[]'::jsonb;                         -- Nunca vacía: por defecto una lista sin ítems

alter table public.tareas                              -- Modifica la tabla de tareas
  drop constraint if exists tareas_checklist_es_lista; -- Borra la regla si ya existía (para poder repetir el script)
alter table public.tareas                              -- Modifica la tabla de tareas
  add constraint tareas_checklist_es_lista             -- Regla de calidad del dato…
  check (jsonb_typeof(checklist) = 'array');           -- …el checklist siempre debe ser una lista

select count(*) as tareas_con_checklist_vacio          -- Verificación: cuántas tareas quedaron…
from public.tareas where checklist = '[]'::jsonb;      -- …con el checklist vacío (deberían ser todas)
