import { headersSupabase } from './supabase.js';

export const PRECO_ESSENCIAL_PIX = 79.9;
export const PRECO_ESSENCIAL_CARTAO = 119.9;
export const PARCELAS_CARTAO_MAX = 12;

function arred2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function normalizarPlano(plano) {
  const p = String(plano || 'cadastro').toLowerCase().trim();
  if (p === 'essencial' || p === 'basico' || p === 'básico' || p === 'gratis' || p === 'grátis') {
    return 'cadastro';
  }
  if (p === 'destaque' || p === 'profissional') return p;
  return 'cadastro';
}

export function nomeDoPlanoBonito(plano) {
  const p = normalizarPlano(plano);
  if (p === 'cadastro') return 'Essencial';
  if (p === 'destaque') return 'Destaque';
  return 'Profissional';
}

export function planoDaCuidadora(c) {
  if (!c) return 'cadastro';
  if (c.plano_destaque) return 'destaque';
  if (c.plano_profissional) return 'profissional';
  return 'cadastro';
}

export function flagsDoPlano(plano) {
  const p = normalizarPlano(plano);
  return {
    plano_cadastro: true,
    plano_profissional: p === 'profissional' || p === 'destaque',
    plano_destaque: p === 'destaque'
  };
}

export function planoEhEssencial(plano) {
  return normalizarPlano(plano) === 'cadastro';
}

export function diasDoPlano() {
  return 365;
}

export function dataValidadePlano(plano, aPartir) {
  const d = aPartir ? new Date(aPartir) : new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

export function formaEhCartao(forma) {
  const f = String(forma || '').toUpperCase();
  return f === 'CREDIT_CARD' || f === 'CARTAO' || f === 'CARTÃO';
}

export function parcelasDoCartao(n) {
  const x = parseInt(n, 10);
  if (!x || x < 1) return 1;
  if (x > PARCELAS_CARTAO_MAX) return PARCELAS_CARTAO_MAX;
  return x;
}

export function valorParcela(total, parcelas) {
  const n = parcelasDoCartao(parcelas);
  if (n <= 1) return arred2(total);
  return arred2(total / n);
}

async function lerValorConfig(env, chave) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + encodeURIComponent(chave) + '&select=valor&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return null;
    const linhas = await resp.json();
    if (!linhas || !linhas[0]) return null;
    const valor = parseFloat(linhas[0].valor);
    return isNaN(valor) || valor < 0 ? null : valor;
  } catch (err) {
    return null;
  }
}

export async function montarPrecoAnual(env, plano, forma) {
  const p = normalizarPlano(plano);
  const cartao = formaEhCartao(forma);
  const chaveEssencial = cartao ? 'preco_cadastro_cartao' : 'preco_cadastro';
  let essencial = await lerValorConfig(env, chaveEssencial);
  if (essencial == null || essencial <= 0) {
    essencial = cartao ? PRECO_ESSENCIAL_CARTAO : PRECO_ESSENCIAL_PIX;
  }

  let extraMensal = 0;
  if (p === 'profissional' || p === 'destaque') {
    const chaveExtra = p === 'destaque' ? 'preco_destaque' : 'preco_profissional';
    const lido = await lerValorConfig(env, chaveExtra);
    extraMensal = lido == null ? 0 : lido;
  }

  const extraAnual = arred2(extraMensal * 12);
  const total = arred2(essencial + extraAnual);
  return {
    plano: p,
    essencial: arred2(essencial),
    extraMensal: arred2(extraMensal),
    extraAnual: extraAnual,
    total: total
  };
}

export async function lerPrecoPlano(env, plano, forma) {
  const montado = await montarPrecoAnual(env, plano, forma);
  if (!montado || !montado.total || montado.total <= 0) return null;
  return montado.total;
}
