-- =====================================================================
-- Esquema de la base de datos del seguimiento de la boda (Supabase)
-- Ejecutar UNA vez en Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- Tabla de personas autorizadas ----------
create table if not exists public.miembros (          -- Crea la tabla si no existe
  email  text primary key,                            -- Correo autorizado (clave única)
  nombre text not null                                -- Nombre para mostrar (Ana / Juan)
);                                                    -- Fin de la tabla miembros

-- ---------- Tabla principal de tareas ----------
create table if not exists public.tareas (            -- Crea la tabla de tareas
  id                 bigint generated always as identity primary key,  -- Identificador interno automático
  codigo             text not null unique,            -- Código visible (A-01, B-02…), no se repite
  grupo              text not null,                   -- Grupo (nivel 1)
  categoria          text,                            -- Categoría (nivel 2)
  tarea              text not null,                   -- Nombre de la tarea
  responsable        text not null default 'Ambos'    -- Responsable, por defecto Ambos
                     check (responsable in ('Ana','Juan','Ambos')),     -- Solo acepta estos tres valores
  lider              text check (lider in ('Ana','Juan')),              -- Quién empuja la tarea (puede quedar vacío)
  prioridad          text not null default 'Media'    -- Prioridad, por defecto Media
                     check (prioridad in ('Alta','Media','Baja')),      -- Solo acepta estos tres valores
  fecha_limite       date,                            -- Fecha límite (puede quedar vacía)
  estado             text not null default 'No iniciado'                -- Estado, por defecto No iniciado
                     check (estado in ('No iniciado','En proceso','Terminado')), -- Estados válidos
  proveedor          text,                            -- Proveedor asociado
  valor_total        numeric(14,0) check (valor_total >= 0),            -- Valor total en pesos (sin decimales)
  valor_abonado      numeric(14,0) check (valor_abonado >= 0),          -- Valor abonado en pesos
  fecha_proximo_pago date,                            -- Fecha del próximo pago
  proximo_paso       text,                            -- Lo que falta por hacer
  depende_de         text,                            -- Códigos de tareas previas, separados por coma
  observaciones      text,                            -- Notas libres
  checklist          jsonb not null default '[]'::jsonb                -- Subactividades: [{ "texto": "...", "hecho": false }]
                     check (jsonb_typeof(checklist) = 'array'),         -- Siempre debe ser una lista
  creado_en          timestamptz not null default now(),                -- Fecha de creación
  actualizado_en     timestamptz not null default now(),                -- Fecha de la última modificación
  actualizado_por    text                             -- Correo de quien hizo la última modificación
);                                                    -- Fin de la tabla tareas

-- ---------- Tabla de historial de cambios ----------
create table if not exists public.historial (         -- Crea la tabla de historial
  id            bigint generated always as identity primary key,       -- Identificador automático
  tarea_codigo  text,                                 -- Código de la tarea afectada
  tarea_titulo  text,                                 -- Nombre de la tarea en ese momento
  accion        text not null,                        -- 'creó', 'editó' o 'eliminó'
  cambios       jsonb,                                -- Campos cambiados con valor antes/después
  usuario       text,                                 -- Correo de quien hizo el cambio
  fecha         timestamptz not null default now()    -- Momento del cambio
);                                                    -- Fin de la tabla historial

-- Índice para leer rápido la actividad más reciente
create index if not exists historial_fecha_idx on public.historial (fecha desc);

-- ---------- Función: ¿el usuario conectado es miembro? ----------
create or replace function public.es_miembro()        -- Crea o reemplaza la función
returns boolean                                       -- Devuelve verdadero o falso
language sql stable security definer                  -- Corre con permisos del dueño para poder leer miembros
set search_path = public                              -- Fija el esquema para evitar suplantaciones
as $$
  select exists (                                     -- Verdadero si existe al menos una fila…
    select 1 from public.miembros m                   -- …en la tabla de miembros…
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))  -- …con el correo de la sesión
  );
$$;                                                   -- Fin de la función

-- ---------- Seguridad a nivel de fila (RLS) ----------
alter table public.miembros  enable row level security;  -- Activa RLS en miembros
alter table public.tareas    enable row level security;  -- Activa RLS en tareas
alter table public.historial enable row level security;  -- Activa RLS en historial

drop policy if exists miembros_leen_miembros on public.miembros;       -- Borra la política si ya existía
create policy miembros_leen_miembros on public.miembros                -- Política de lectura de miembros
  for select to authenticated using (public.es_miembro());             -- Solo miembros pueden leerla

drop policy if exists miembros_gestionan_tareas on public.tareas;      -- Borra la política si ya existía
create policy miembros_gestionan_tareas on public.tareas               -- Política de tareas
  for all to authenticated                                             -- Aplica a leer, crear, editar y borrar
  using (public.es_miembro())                                          -- Solo miembros ven filas
  with check (public.es_miembro());                                    -- Solo miembros escriben filas

drop policy if exists miembros_leen_historial on public.historial;     -- Borra la política si ya existía
create policy miembros_leen_historial on public.historial              -- Política de historial
  for select to authenticated using (public.es_miembro());             -- Solo miembros leen el historial

-- ---------- Permisos ----------
revoke all on public.miembros, public.tareas, public.historial from anon;              -- Visitantes sin sesión: nada
grant select on public.miembros, public.historial to authenticated;                    -- Con sesión: leer (RLS filtra)
grant select, insert, update, delete on public.tareas to authenticated;                -- Con sesión: gestionar tareas (RLS filtra)
grant execute on function public.es_miembro() to authenticated;                        -- Permite usar la función

-- ---------- Disparador: sello de modificación ----------
create or replace function public.marcar_actualizacion()  -- Función que se ejecuta antes de guardar
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();                                          -- Guarda la hora del cambio
  new.actualizado_por := coalesce(auth.jwt() ->> 'email', new.actualizado_por); -- Guarda el correo de quien cambia
  return new;                                                           -- Continúa con la fila modificada
end;
$$;                                                                     -- Fin de la función

drop trigger if exists tareas_marcar on public.tareas;                  -- Borra el disparador si existía
create trigger tareas_marcar                                            -- Crea el disparador
  before insert or update on public.tareas                              -- Antes de crear o editar
  for each row execute function public.marcar_actualizacion();          -- Por cada fila, llama la función

-- ---------- Disparador: registro en el historial ----------
create or replace function public.registrar_historial()  -- Función que anota cada cambio
returns trigger language plpgsql security definer         -- Corre con permisos del dueño para escribir historial
set search_path = public as $$
declare
  v_usuario text := auth.jwt() ->> 'email';               -- Correo de quien hace el cambio
  v_cambios jsonb;                                        -- Diferencias entre antes y después
begin
  if v_usuario is null then                               -- Cambios hechos desde el SQL Editor (carga inicial)…
    return coalesce(new, old);                            -- …no se anotan en el historial
  end if;
  if tg_op = 'INSERT' then                                -- Si se creó una tarea
    insert into historial (tarea_codigo, tarea_titulo, accion, usuario)
    values (new.codigo, new.tarea, 'creó', v_usuario);    -- Anota la creación
    return new;                                           -- Termina
  elsif tg_op = 'UPDATE' then                             -- Si se editó una tarea
    select jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value))  -- Arma {campo:{antes,despues}}
      into v_cambios
      from jsonb_each(to_jsonb(new)) n                    -- Recorre los campos nuevos
      join jsonb_each(to_jsonb(old)) o on o.key = n.key   -- Los empareja con los anteriores
     where n.value is distinct from o.value               -- Solo los que cambiaron
       and n.key not in ('actualizado_en', 'actualizado_por', 'creado_en'); -- Ignora los sellos de tiempo
    if v_cambios is not null then                         -- Si hubo cambios reales
      insert into historial (tarea_codigo, tarea_titulo, accion, cambios, usuario)
      values (new.codigo, new.tarea, 'editó', v_cambios, v_usuario); -- Anota la edición
    end if;
    return new;                                           -- Termina
  else                                                    -- Si se eliminó una tarea
    insert into historial (tarea_codigo, tarea_titulo, accion, usuario)
    values (old.codigo, old.tarea, 'eliminó', v_usuario); -- Anota la eliminación
    return old;                                           -- Termina
  end if;
end;
$$;                                                       -- Fin de la función

drop trigger if exists tareas_historial on public.tareas; -- Borra el disparador si existía
create trigger tareas_historial                           -- Crea el disparador
  after insert or update or delete on public.tareas       -- Después de crear, editar o borrar
  for each row execute function public.registrar_historial(); -- Por cada fila, anota en el historial

-- ---------- Tiempo real (ver cambios del otro sin recargar) ----------
alter table public.tareas replica identity full;          -- Envía la fila completa en los eventos
do $$
begin
  begin
    alter publication supabase_realtime add table public.tareas;     -- Publica cambios de tareas
  exception when duplicate_object then null;                        -- Si ya estaba publicada, sigue
  end;
  begin
    alter publication supabase_realtime add table public.historial;  -- Publica cambios del historial
  exception when duplicate_object then null;                        -- Si ya estaba publicada, sigue
  end;
end $$;
