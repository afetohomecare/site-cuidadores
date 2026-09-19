-- IDs do Mercado Pago na cuidadora. Rode uma vez no SQL Editor do Supabase.
-- O checkout funciona mesmo sem essas colunas (usa external_reference no webhook).

alter table cuidadores add column if not exists mp_preference_id text;
alter table cuidadores add column if not exists mp_payment_id text;
alter table cuidadores add column if not exists mp_preapproval_id text;
alter table cuidadores add column if not exists mp_plano_payment_id text;
alter table cuidadores add column if not exists mp_destaque_payment_id text;

-- Ordens calculadas no servidor. O navegador nunca define o valor final
-- e um mesmo pagamento não pode liberar o plano mais de uma vez.
create table if not exists pagamentos_mp (
  id uuid primary key default gen_random_uuid(),
  cuidador_id text not null,
  plano text not null,
  produto text not null default '',
  forma text not null check (forma in ('PIX', 'CREDIT_CARD')),
  tipo text not null default 'avulso',
  valor_base_centavos integer not null check (valor_base_centavos >= 0),
  desconto_centavos integer not null default 0 check (desconto_centavos >= 0),
  valor_final_centavos integer not null check (valor_final_centavos >= 0),
  cupom_codigo text,
  ambiente text not null check (ambiente in ('sandbox', 'producao')),
  status text not null default 'created',
  idempotency_key uuid not null unique,
  mp_payment_id text unique,
  mp_preapproval_id text,
  checkout_url text,
  expira_em timestamptz,
  processado_em timestamptz,
  recorrencia_ajustada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table pagamentos_mp
  add column if not exists recorrencia_ajustada_em timestamptz;
alter table pagamentos_mp
  add column if not exists checkout_url text;

create index if not exists pagamentos_mp_cuidador_idx
  on pagamentos_mp (cuidador_id, criado_em desc);

alter table pagamentos_mp enable row level security;

-- Nenhuma policy pública: somente a service role das Cloudflare Functions
-- acessa esta tabela.

create table if not exists pagamentos_mp_processados (
  mp_payment_id text primary key,
  ordem_id uuid references pagamentos_mp(id) on delete set null,
  status text not null,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz
);

alter table pagamentos_mp_processados enable row level security;
alter table pagamentos_mp_processados
  add column if not exists iniciado_em timestamptz not null default now();
alter table pagamentos_mp_processados
  add column if not exists concluido_em timestamptz;

-- Registros de uma versão anterior já foram processados; não devem ser
-- retomados pelo mecanismo de lease.
update pagamentos_mp_processados
set concluido_em = coalesce(concluido_em, iniciado_em, now()),
    status = 'complete'
where concluido_em is null
  and status not like 'processing:%';

create unique index if not exists cupons_usos_gateway_payment_unique
  on cupons_usos (asaas_pagamento_id)
  where asaas_pagamento_id is not null;
