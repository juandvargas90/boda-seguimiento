-- =====================================================================
-- Invitados, confirmación de asistencia y canciones sugeridas
-- Ejecutar UNA vez en Supabase > SQL Editor > New query > Run
-- (después, cargar los invitados con 08_invitados_datos.sql, que NO está
--  en GitHub porque tiene celulares; vive solo en la carpeta local)
-- =====================================================================

-- ---------- Grupos: un grupo = un mensaje de WhatsApp ----------
create table if not exists public.inv_grupos (           -- Crea la tabla de grupos si no existe
  codigo        text primary key                         -- Código personal del enlace (?i=xxxxxx)
                check (codigo ~ '^[a-z0-9]{6}$'),        -- Exactamente 6 letras minúsculas o números
  para          text not null,                           -- Lo que aparece después de "Para" en la carta
  envia         text not null check (envia in ('Ana','Juan')), -- Quién envía el mensaje
  celular       text,                                    -- Celular con indicativo, solo dígitos (para WhatsApp)
  orden         int not null default 0,                  -- Orden en la lista (como en el Excel)
  es_prueba     boolean not null default false,          -- Grupo de prueba (no cuenta en los totales)
  enviado_en    timestamptz,                             -- Cuándo se marcó como enviado (vacío = pendiente)
  enviado_por   text,                                    -- Correo de quien lo marcó
  respondido_en timestamptz,                             -- Última vez que el grupo confirmó o cambió su respuesta
  creado_en     timestamptz not null default now()       -- Fecha de creación
);                                                       -- Fin de la tabla de grupos

-- ---------- Personas de cada grupo ----------
create table if not exists public.inv_personas (         -- Crea la tabla de personas si no existe
  id      bigint generated always as identity primary key, -- Identificador interno automático
  codigo  text not null references public.inv_grupos (codigo) on delete cascade, -- Grupo al que pertenece
  nombre  text not null,                                 -- Nombre que ve el invitado al confirmar
  orden   int not null default 0,                        -- Orden dentro del grupo
  asiste  boolean                                        -- true = asiste, false = no asiste, vacío = sin responder
);                                                       -- Fin de la tabla de personas
create index if not exists inv_personas_codigo_idx on public.inv_personas (codigo); -- Búsqueda rápida por grupo

-- ---------- Canciones sugeridas ----------
create table if not exists public.inv_canciones (        -- Crea la tabla de canciones si no existe
  id        bigint generated always as identity primary key, -- Identificador interno automático
  codigo    text references public.inv_grupos (codigo) on delete set null, -- Grupo que la sugirió (si llegó con enlace personal)
  nombre    text,                                        -- Nombre escrito a mano (si llegó sin enlace personal)
  cancion   text not null check (char_length(cancion) between 1 and 120), -- Nombre de la canción
  artista   text check (char_length(artista) <= 120),    -- Artista (opcional)
  creado_en timestamptz not null default now()           -- Cuándo se sugirió
);                                                       -- Fin de la tabla de canciones
create index if not exists inv_canciones_fecha_idx on public.inv_canciones (creado_en desc); -- Lo más reciente primero

-- ---------- Seguridad: solo Ana y Juan ven y editan las tablas ----------
alter table public.inv_grupos    enable row level security; -- Activa RLS en grupos
alter table public.inv_personas  enable row level security; -- Activa RLS en personas
alter table public.inv_canciones enable row level security; -- Activa RLS en canciones

drop policy if exists miembros_gestionan_inv_grupos on public.inv_grupos;       -- Borra la política si ya existía
create policy miembros_gestionan_inv_grupos on public.inv_grupos                -- Política de grupos
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro()); -- Solo miembros
drop policy if exists miembros_gestionan_inv_personas on public.inv_personas;   -- Borra la política si ya existía
create policy miembros_gestionan_inv_personas on public.inv_personas            -- Política de personas
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro()); -- Solo miembros
drop policy if exists miembros_gestionan_inv_canciones on public.inv_canciones; -- Borra la política si ya existía
create policy miembros_gestionan_inv_canciones on public.inv_canciones          -- Política de canciones
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro()); -- Solo miembros

revoke all on public.inv_grupos, public.inv_personas, public.inv_canciones from anon; -- Visitantes: nada directo
grant select, insert, update, delete on public.inv_grupos, public.inv_personas, public.inv_canciones to authenticated; -- Con sesión (RLS filtra)

-- ---------- Fecha límite para confirmar (4 de diciembre, 11:59 p. m. de Bogotá) ----------
create or replace function public.inv_limite()            -- Devuelve la fecha límite
returns timestamptz language sql immutable as $$
  select timestamptz '2026-12-04 23:59:59-05';             -- Bogotá es UTC-5 todo el año
$$;                                                        -- Fin de la función

-- ---------- Invitación: lo que ve un invitado con su código ----------
-- Devuelve SOLO su "Para", los nombres de su grupo, lo que ya respondieron y sus canciones.
create or replace function public.inv_ver(p_codigo text)  -- Recibe el código del enlace
returns jsonb language sql stable security definer        -- Lee las tablas con permisos del dueño (el invitado no puede)
set search_path = public as $$
  select jsonb_build_object(                              -- Arma la respuesta
    'para', g.para,                                       -- "Para …"
    'cerrado', now() > inv_limite(),                      -- ¿ya pasó la fecha límite?
    'respondido_en', g.respondido_en,                     -- última respuesta (vacío = nunca)
    'personas', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'asiste', p.asiste) order by p.orden, p.id), '[]') -- personas
                   from inv_personas p where p.codigo = g.codigo),
    'canciones', (select coalesce(jsonb_agg(jsonb_build_object('cancion', c.cancion, 'artista', c.artista) order by c.creado_en), '[]') -- canciones del grupo
                    from inv_canciones c where c.codigo = g.codigo)
  )
  from inv_grupos g                                       -- desde los grupos…
  where g.codigo = lower(trim(p_codigo));                 -- …el del código (vacío si no existe)
$$;                                                       -- Fin de la función

-- ---------- Confirmar asistencia ----------
-- p_respuestas: {"<id persona>": true|false, …} con TODAS las personas del grupo.
create or replace function public.inv_confirmar(p_codigo text, p_respuestas jsonb) -- Código y respuestas
returns jsonb language plpgsql security definer           -- Escribe con permisos del dueño
set search_path = public as $$
declare
  v_codigo text := lower(trim(p_codigo));                 -- Código normalizado
  v_faltan int;                                           -- Personas del grupo sin respuesta válida
begin
  if not exists (select 1 from inv_grupos where codigo = v_codigo) then -- ¿existe el grupo?
    raise exception 'codigo_invalido';                    -- No: error controlado
  end if;
  if now() > inv_limite() then                            -- ¿ya cerró?
    raise exception 'confirmacion_cerrada';               -- Sí: no se aceptan cambios
  end if;
  if jsonb_typeof(p_respuestas) <> 'object' then          -- Las respuestas deben ser un objeto
    raise exception 'respuestas_invalidas';               -- Si no, error controlado
  end if;
  select count(*) into v_faltan                           -- Cuenta personas del grupo…
    from inv_personas p
   where p.codigo = v_codigo
     and jsonb_typeof(p_respuestas -> p.id::text) is distinct from 'boolean'; -- …sin un sí/no válido
  if v_faltan > 0 then                                    -- Todas deben tener respuesta
    raise exception 'respuestas_incompletas';             -- Si no, error controlado
  end if;
  update inv_personas p                                   -- Guarda la respuesta de cada persona…
     set asiste = (p_respuestas ->> p.id::text)::boolean  -- …sí o no
   where p.codigo = v_codigo;                             -- …solo de ESTE grupo (ids de otros grupos se ignoran)
  update inv_grupos set respondido_en = now() where codigo = v_codigo; -- Sello de la respuesta
  return inv_ver(v_codigo);                               -- Devuelve el estado actualizado
end;
$$;                                                       -- Fin de la función

-- ---------- Sugerir una canción ----------
-- Con código: se asocia al grupo (máx. 20 por grupo). Sin código: exige nombre (máx. 300 en total sin código).
create or replace function public.inv_cancion(p_codigo text, p_nombre text, p_cancion text, p_artista text) -- Datos del formulario
returns jsonb language plpgsql security definer           -- Escribe con permisos del dueño
set search_path = public as $$
declare
  v_codigo  text := nullif(lower(trim(coalesce(p_codigo, ''))), ''); -- Código (o vacío)
  v_nombre  text := nullif(left(trim(coalesce(p_nombre, '')), 80), ''); -- Nombre libre (máx. 80)
  v_cancion text := left(regexp_replace(trim(coalesce(p_cancion, '')), '\s+', ' ', 'g'), 120); -- Canción limpia (máx. 120)
  v_artista text := nullif(left(regexp_replace(trim(coalesce(p_artista, '')), '\s+', ' ', 'g'), 120), ''); -- Artista limpio
begin
  if v_cancion = '' then raise exception 'cancion_vacia'; end if;          -- La canción es obligatoria
  if v_codigo is not null then                                             -- Llegó con enlace personal
    if not exists (select 1 from inv_grupos where codigo = v_codigo) then  -- ¿existe el grupo?
      raise exception 'codigo_invalido';                                   -- No: error controlado
    end if;
    if (select count(*) from inv_canciones where codigo = v_codigo) >= 20 then -- Tope por grupo
      raise exception 'limite_canciones';                                  -- Error controlado
    end if;
    insert into inv_canciones (codigo, cancion, artista) values (v_codigo, v_cancion, v_artista); -- Guarda
    return inv_ver(v_codigo);                                              -- Devuelve sus canciones actualizadas
  end if;
  if v_nombre is null then raise exception 'nombre_vacio'; end if;         -- Sin enlace, el nombre es obligatorio
  if (select count(*) from inv_canciones where codigo is null) >= 300 then -- Tope general sin enlace
    raise exception 'limite_canciones';                                    -- Error controlado
  end if;
  insert into inv_canciones (nombre, cancion, artista) values (v_nombre, v_cancion, v_artista); -- Guarda
  return jsonb_build_object('ok', true);                                   -- Confirma
end;
$$;                                                       -- Fin de la función

revoke all on function public.inv_ver(text), public.inv_confirmar(text, jsonb), public.inv_cancion(text, text, text, text) from public; -- Quita permisos por defecto
grant execute on function public.inv_ver(text), public.inv_confirmar(text, jsonb), public.inv_cancion(text, text, text, text) to anon, authenticated; -- La invitación puede llamarlas
grant execute on function public.inv_limite() to anon, authenticated; -- Fecha límite (la usan las funciones)

-- ---------- Tiempo real: la página de seguimiento ve las respuestas al instante ----------
alter table public.inv_grupos    replica identity full;  -- Envía la fila completa en los eventos
alter table public.inv_personas  replica identity full;  -- Ídem personas
alter table public.inv_canciones replica identity full;  -- Ídem canciones
do $$
begin
  begin alter publication supabase_realtime add table public.inv_grupos;    exception when duplicate_object then null; end; -- Publica grupos
  begin alter publication supabase_realtime add table public.inv_personas;  exception when duplicate_object then null; end; -- Publica personas
  begin alter publication supabase_realtime add table public.inv_canciones; exception when duplicate_object then null; end; -- Publica canciones
end $$;
