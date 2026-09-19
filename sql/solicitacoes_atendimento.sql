-- OBRIGATÓRIO para o formulário "Solicitar atendimento" no perfil.
-- Rode no SQL Editor do Supabase (pode rodar de novo: IF NOT EXISTS).
-- Se as tabelas JÁ existem e o pedido ainda falha, rode pelo menos o bloco
-- GRANT + POLICY no final deste arquivo (RLS sem policy bloqueia o INSERT).
-- Pedidos de atendimento da família → cuidadora + Afeto.

create table if not exists public.solicitacoes_atendimento (
  id uuid primary key default gen_random_uuid(),
  cuidador_id uuid not null,
  nome_solicitante text not null,
  whatsapp text not null,
  email text,
  bairro text not null,
  necessidades text[] not null default '{}',
  complemento text,
  paciente_primeiro_nome text not null,
  paciente_idade integer,
  paciente_sexo text,
  info_paciente text,
  periodos jsonb not null default '[]',
  encaminhar_outras boolean not null default false,
  ip_hash text,
  status text not null default 'nova',
  criado_em timestamptz not null default now()
);

-- Se a tabela já existia incompleta, completa as colunas:
alter table public.solicitacoes_atendimento add column if not exists cuidador_id uuid;
alter table public.solicitacoes_atendimento add column if not exists nome_solicitante text;
alter table public.solicitacoes_atendimento add column if not exists whatsapp text;
alter table public.solicitacoes_atendimento add column if not exists email text;
alter table public.solicitacoes_atendimento add column if not exists bairro text;
alter table public.solicitacoes_atendimento add column if not exists necessidades text[];
alter table public.solicitacoes_atendimento add column if not exists complemento text;
alter table public.solicitacoes_atendimento add column if not exists paciente_primeiro_nome text;
alter table public.solicitacoes_atendimento add column if not exists paciente_idade integer;
alter table public.solicitacoes_atendimento add column if not exists paciente_sexo text;
alter table public.solicitacoes_atendimento add column if not exists info_paciente text;
alter table public.solicitacoes_atendimento add column if not exists periodos jsonb;
alter table public.solicitacoes_atendimento add column if not exists encaminhar_outras boolean;
alter table public.solicitacoes_atendimento add column if not exists ip_hash text;
alter table public.solicitacoes_atendimento add column if not exists status text;
alter table public.solicitacoes_atendimento add column if not exists criado_em timestamptz;

create table if not exists public.solicitacoes_visiveis (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_atendimento(id) on delete cascade,
  cuidador_id uuid not null,
  via text not null default 'perfil',
  criado_em timestamptz not null default now(),
  unique (solicitacao_id, cuidador_id)
);

alter table public.solicitacoes_visiveis add column if not exists solicitacao_id uuid;
alter table public.solicitacoes_visiveis add column if not exists cuidador_id uuid;
alter table public.solicitacoes_visiveis add column if not exists via text;
alter table public.solicitacoes_visiveis add column if not exists criado_em timestamptz;

create index if not exists idx_solicitacoes_ip_criado
  on public.solicitacoes_atendimento (ip_hash, criado_em desc);

create index if not exists idx_solicitacoes_visiveis_cuidador
  on public.solicitacoes_visiveis (cuidador_id, criado_em desc);

alter table public.solicitacoes_atendimento enable row level security;
alter table public.solicitacoes_visiveis enable row level security;

-- A API das Cloudflare Functions usa SUPABASE_SERVICE_KEY.
-- Sem GRANT + policy, o INSERT falha (403/42501) mesmo com a tabela criada.
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.solicitacoes_atendimento to anon, authenticated, service_role;
grant all on table public.solicitacoes_visiveis to anon, authenticated, service_role;

drop policy if exists solicitacoes_atendimento_api on public.solicitacoes_atendimento;
create policy solicitacoes_atendimento_api
  on public.solicitacoes_atendimento
  for all
  to anon, authenticated, service_role
  using (true)
  with check (true);

drop policy if exists solicitacoes_visiveis_api on public.solicitacoes_visiveis;
create policy solicitacoes_visiveis_api
  on public.solicitacoes_visiveis
  for all
  to anon, authenticated, service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
