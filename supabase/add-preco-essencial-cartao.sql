-- Preço do Essencial anual no cartão (Pix continua em preco_cadastro).
-- Rode uma vez no SQL Editor do Supabase. Não sobrescreve valor que já existir.

INSERT INTO public.config (chave, valor, descricao)
VALUES
  ('preco_cadastro_cartao', '119.90', 'Essencial anual no cartão (até 12x)'),
  ('preco_cadastro_cartao_pos', '119.90', 'Essencial anual cartão — preço cheio (opcional, riscado no site)')
ON CONFLICT (chave) DO NOTHING;
