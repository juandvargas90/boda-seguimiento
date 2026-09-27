-- Autoriza los correos que pueden entrar a la página
-- Reemplaza los correos de ejemplo y ejecuta en Supabase > SQL Editor
insert into public.miembros (email, nombre) values   -- Inserta las personas autorizadas
  ('correo-de-juan@ejemplo.com', 'Juan'),            -- Correo de Juan (reemplazar)
  ('correo-de-ana@ejemplo.com',  'Ana')              -- Correo de Ana (reemplazar)
on conflict (email) do update set nombre = excluded.nombre; -- Si ya existe, solo actualiza el nombre
