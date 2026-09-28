-- =====================================================================
-- Fotos y archivos adjuntos a cada tarea
-- Ejecutar UNA vez en Supabase > SQL Editor (es seguro repetirlo)
-- =====================================================================

-- ---------- Lista de adjuntos en cada tarea ----------
alter table public.tareas                                             -- Modifica la tabla de tareas
  add column if not exists adjuntos jsonb not null default '[]'::jsonb; -- Lista: [{ "ruta", "nombre", "tipo", "tamano", "subido_por", "fecha" }]
alter table public.tareas drop constraint if exists tareas_adjuntos_es_lista; -- Borra la regla si ya existía
alter table public.tareas                                             -- Vuelve a modificar la tabla
  add constraint tareas_adjuntos_es_lista check (jsonb_typeof(adjuntos) = 'array'); -- Siempre debe ser una lista

-- ---------- Carpeta privada de archivos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) -- Crea la carpeta "adjuntos"
values ('adjuntos', 'adjuntos', false, 10485760,                     -- Privada; máximo 10 MB por archivo
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']) -- Solo fotos y PDF
on conflict (id) do update set public = false,                       -- Si ya existe, la deja privada…
  file_size_limit = excluded.file_size_limit,                         -- …con el mismo límite de tamaño…
  allowed_mime_types = excluded.allowed_mime_types;                   -- …y los mismos tipos permitidos

-- ---------- Seguridad: solo Ana y Juan (tabla miembros) ----------
drop policy if exists adjuntos_leer on storage.objects;              -- Borra la política si ya existía
create policy adjuntos_leer on storage.objects                       -- Ver y descargar archivos
  for select to authenticated using (bucket_id = 'adjuntos' and public.es_miembro()); -- Solo miembros, solo esta carpeta

drop policy if exists adjuntos_subir on storage.objects;             -- Borra la política si ya existía
create policy adjuntos_subir on storage.objects                      -- Subir archivos
  for insert to authenticated with check (bucket_id = 'adjuntos' and public.es_miembro()); -- Solo miembros, solo esta carpeta

drop policy if exists adjuntos_borrar on storage.objects;            -- Borra la política si ya existía
create policy adjuntos_borrar on storage.objects                     -- Borrar archivos
  for delete to authenticated using (bucket_id = 'adjuntos' and public.es_miembro()); -- Solo miembros, solo esta carpeta

-- ---------- Verificación ----------
select (select count(*) from public.tareas where adjuntos = '[]'::jsonb) as tareas_sin_adjuntos, -- Debe dar el total de tareas
       (select public from storage.buckets where id = 'adjuntos') as carpeta_publica; -- Debe dar false
