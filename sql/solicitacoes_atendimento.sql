-- OBRIGATÓRIO para o formulário "Solicitar atendimento" no perfil.
-- Rode no SQL Editor do Supabase (pode rodar de novo: IF NOT EXISTS).
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
