-- Link público do perfil (slug). UUID interno não muda.
-- Rode uma vez no SQL Editor do Supabase.

ALTER TABLE public.cuidadores ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS cuidadores_slug_unique
  ON public.cuidadores (slug)
  WHERE slug IS NOT NULL;
