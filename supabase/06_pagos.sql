-- =====================================================================
-- Control de pagos: registro de cada pago (quién, cuándo, cuánto, cómo)
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirlo)
-- =====================================================================

-- ---------- Tabla de pagos ----------
create table if not exists public.pagos (                             -- Crea la tabla si no existe
  id           bigint generated always as identity primary key,      -- Identificador automático
  tarea_id     bigint not null references public.tareas(id) on delete cascade, -- Tarea a la que pertenece (si se borra la tarea, se borran sus pagos)
  fecha        date,                                                  -- Fecha del pago (puede quedar vacía si no se conoce)
  monto        numeric(14,0) not null check (monto > 0),              -- Valor en pesos, sin decimales, mayor que cero
  pagado_por   text not null,                                         -- Quién pagó: Juan, Ana, Ambos, familia u otra persona
  medio        text,                                                  -- Transferencia, efectivo, tarjeta…
  nota         text,                                                  -- Detalle libre
  comprobante  jsonb,                                                 -- Foto o PDF del soporte: { "ruta", "nombre", "tipo" }
  creado_en    timestamptz not null default now(),                    -- Cuándo se registró
  creado_por   text default (auth.jwt() ->> 'email')                  -- Quién lo registró
);                                                                    -- Fin de la tabla
create index if not exists pagos_tarea_idx on public.pagos (tarea_id); -- Búsqueda rápida por tarea

-- ---------- Seguridad: solo Ana y Juan ----------
alter table public.pagos enable row level security;                  -- Activa la seguridad por fila
drop policy if exists miembros_gestionan_pagos on public.pagos;       -- Borra la política si ya existía
create policy miembros_gestionan_pagos on public.pagos                -- Política única
  for all to authenticated                                            -- Leer, crear, editar y borrar
  using (public.es_miembro()) with check (public.es_miembro());       -- Solo miembros
revoke all on public.pagos from anon;                                 -- Visitantes sin sesión: nada
grant select, insert, update, delete on public.pagos to authenticated; -- Con sesión: gestionar (la política filtra)

-- ---------- El historial de tareas ignora cambios hechos por otros disparadores ----------
create or replace function public.registrar_historial()              -- Misma función de antes, con un ajuste
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_usuario text := auth.jwt() ->> 'email';                           -- Correo de quien hace el cambio
  v_cambios jsonb;                                                    -- Diferencias entre antes y después
begin
  if v_usuario is null or pg_trigger_depth() > 1 then                 -- Cambios del SQL Editor o recalculados por los pagos…
    return coalesce(new, old);                                        -- …no se anotan (el pago ya queda anotado)
  end if;
  if tg_op = 'INSERT' then                                            -- Si se creó una tarea
    insert into historial (tarea_codigo, tarea_titulo, accion, usuario)
    values (new.codigo, new.tarea, 'creó', v_usuario);                -- Anota la creación
    return new;                                                       -- Termina
  elsif tg_op = 'UPDATE' then                                         -- Si se editó una tarea
    select jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value))
      into v_cambios
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('actualizado_en', 'actualizado_por', 'creado_en'); -- Ignora los sellos de tiempo
    if v_cambios is not null then                                     -- Si hubo cambios reales
      insert into historial (tarea_codigo, tarea_titulo, accion, cambios, usuario)
      values (new.codigo, new.tarea, 'editó', v_cambios, v_usuario);  -- Anota la edición
    end if;
    return new;                                                       -- Termina
  else                                                                -- Si se eliminó una tarea
    insert into historial (tarea_codigo, tarea_titulo, accion, usuario)
    values (old.codigo, old.tarea, 'eliminó', v_usuario);             -- Anota la eliminación
    return old;                                                       -- Termina
  end if;
end;
$$;

-- ---------- El "valor abonado" de cada tarea se calcula con sus pagos ----------
create or replace function public.recalcular_abonado()               -- Se ejecuta al crear, editar o borrar un pago
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_tareas bigint[] := array_remove(array[                            -- Tareas afectadas (la anterior y la nueva, si cambió)
    case when tg_op <> 'INSERT' then old.tarea_id end,
    case when tg_op <> 'DELETE' then new.tarea_id end], null);
  v_usuario text := auth.jwt() ->> 'email';                           -- Quién hizo el cambio
  v_pago public.pagos := coalesce(new, old);                          -- El pago afectado
begin
  update tareas t                                                     -- Recalcula el abonado…
     set valor_abonado = nullif((select coalesce(sum(p.monto), 0) from pagos p where p.tarea_id = t.id), 0) -- …como suma de sus pagos (vacío si no hay)
   where t.id = any(v_tareas);                                        -- …solo en las tareas afectadas
  if v_usuario is not null then                                       -- Si lo hizo una persona desde la página
    insert into historial (tarea_codigo, tarea_titulo, accion, cambios, usuario) -- Anota el movimiento
    select t.codigo, t.tarea,
           case tg_op when 'INSERT' then 'registró un pago en' when 'UPDATE' then 'editó un pago en' else 'eliminó un pago en' end,
           jsonb_build_object('pago', jsonb_build_object('monto', v_pago.monto, 'pagado_por', v_pago.pagado_por)),
           v_usuario
      from tareas t where t.id = v_pago.tarea_id;                     -- Datos de la tarea (si aún existe)
  end if;
  return v_pago;                                                      -- Termina
end;
$$;

drop trigger if exists pagos_recalcular on public.pagos;              -- Borra el disparador si existía
create trigger pagos_recalcular                                       -- Crea el disparador
  after insert or update or delete on public.pagos                    -- Después de cualquier cambio en pagos
  for each row execute function public.recalcular_abonado();          -- Recalcula y anota

-- ---------- Tiempo real para pagos ----------
alter table public.pagos replica identity full;                       -- Envía la fila completa en los eventos
do $$
begin
  alter publication supabase_realtime add table public.pagos;         -- Publica los cambios de pagos
exception when duplicate_object then null;                            -- Si ya estaba, sigue
end $$;

-- ---------- Separar Hacienda (lugar) y Monte Carlo (wedding planner) ----------
insert into public.tareas (codigo, grupo, categoria, tarea, responsable, prioridad, estado, proveedor, observaciones) -- Nueva tarea D-02
values ('D-02', 'Lugar y organización', 'Wedding planner',
        'Seguimiento al contrato y pagos del wedding planner (Monte Carlo)', 'Ambos', 'Alta', 'En proceso',
        'Monte Carlo Bodas & Eventos',
        'Separada de D-01 el 28/09/2026. Falta registrar el valor total del contrato.')
on conflict (codigo) do nothing;                                      -- Si ya existe, no la duplica

update public.tareas                                                  -- Ajusta D-01 para que sea solo la Hacienda
   set tarea = 'Seguimiento al contrato y pagos de la Hacienda La Victoria', -- Nombre nuevo
       categoria = 'Lugar',                                           -- Categoría nueva
       observaciones = replace(observaciones,
         'Validar si Hacienda y wedding planner son el mismo proveedor o van en filas separadas.',
         'El wedding planner (Monte Carlo) quedó en la tarea D-02.'),  -- Actualiza la nota (si no la cambiaron)
       proximo_paso = replace(proximo_paso, 'del saldo de $25.411.217.', 'del saldo.') -- Quita un saldo que ya no aplica
 where codigo = 'D-01';                                               -- Solo D-01

-- ---------- Cargar los abonos que ya existían (solo si la tabla de pagos está vacía) ----------
insert into public.pagos (tarea_id, fecha, monto, pagado_por, medio, nota) -- Abonos previos
select t.id, null, x.monto, x.quien, null, 'Abono registrado antes del control de pagos (fecha por confirmar)'
  from (values ('A-01', 1950000, 'Ana'),                              -- Vestido: pagó Ana
               ('A-05',  700000, 'Ana'),                              -- Maquilladora: pagó Ana
               ('E-05',  435000, 'Ana'),                              -- Música: pagó Ana
               ('D-01', 5225000, 'Juan'),                             -- Hacienda: pagó Juan
               ('D-02', 2000000, 'Juan')) as x(codigo, monto, quien)  -- Monte Carlo: pagó Juan
  join public.tareas t on t.codigo = x.codigo                         -- Busca cada tarea por su código
 where not exists (select 1 from public.pagos);                       -- Solo la primera vez

-- ---------- Verificación ----------
select t.codigo, t.valor_abonado, string_agg(p.pagado_por || ' ' || p.monto, ', ') as pagos -- Abonado calculado y sus pagos
  from public.tareas t join public.pagos p on p.tarea_id = t.id
 group by t.codigo, t.valor_abonado order by t.codigo;
