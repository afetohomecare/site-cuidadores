-- Link público do perfil: slug a partir do nome (ex.: maria-silva)
-- O id UUID continua sendo a chave interna.

ALTER TABLE cuidadores
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS cuidadores_slug_unique
  ON cuidadores (slug)
  WHERE slug IS NOT NULL;
