-- IDs do Mercado Pago na cuidadora. Rode uma vez no SQL Editor do Supabase.
-- O checkout funciona mesmo sem essas colunas (usa external_reference no webhook).

alter table cuidadores add column if not exists mp_preference_id text;
alter table cuidadores add column if not exists mp_payment_id text;
alter table cuidadores add column if not exists mp_preapproval_id text;
