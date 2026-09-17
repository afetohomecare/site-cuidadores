-- Rode no SQL Editor do Supabase (uma vez).
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

create table if not exists public.solicitacoes_visiveis (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes_atendimento(id) on delete cascade,
  cuidador_id uuid not null,
  via text not null default 'perfil',
  criado_em timestamptz not null default now(),
  unique (solicitacao_id, cuidador_id)
);

create index if not exists idx_solicitacoes_ip_criado
  on public.solicitacoes_atendimento (ip_hash, criado_em desc);

create index if not exists idx_solicitacoes_visiveis_cuidador
  on public.solicitacoes_visiveis (cuidador_id, criado_em desc);

alter table public.solicitacoes_atendimento enable row level security;
alter table public.solicitacoes_visiveis enable row level security;
