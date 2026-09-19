-- Preferência de aparência da profissão no perfil público.
-- Não é gênero: só conjuga o rótulo (cuidadora / cuidador / cuidado).
-- Rode uma vez no SQL Editor do Supabase. Não altera especialidade existente.
--
-- Valores: 'feminino' | 'masculino' | 'neutro'
-- NULL = cadastro antigo: tratar como neutro, com inferência só na EXIBIÇÃO
-- se o texto gravado em especialidade já for claramente feminino ou masculino.

ALTER TABLE public.cuidadores
  ADD COLUMN IF NOT EXISTS como_aparecer text;
