import { headersSupabase } from './supabase.js';

export const PRECO_ESSENCIAL_PIX = 79.9;
export const PRECO_ESSENCIAL_CARTAO = 119.9;
export const PRECO_PROF_PIX = 49.9;
export const PRECO_PROF_CHEIO = 79.9;
export const PRECO_DEST_PIX = 9.9;
export const PRECO_DEST_CHEIO = 9.9;
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

export function planoPermitidoNoCadastro(plano) {
  return normalizarPlano(plano) === 'profissional' ? 'profissional' : 'cadastro';
}

export function nomeDoPlanoBonito(plano) {
  const p = normalizarPlano(plano);
  if (p === 'cadastro') return 'Essencial';
  if (p === 'destaque') return 'Destaque extra';
  return 'Profissional';
}

export function planoDaCuidadora(c) {
  if (!c) return 'cadastro';
  if (c.plano_profissional) return 'profissional';
  return 'cadastro';
}

export function temDestaqueExtra(c) {
  return !!(c && c.plano_destaque);
}

export function flagsDoPlano(plano) {
  const p = planoPermitidoNoCadastro(plano);
  return {
    plano_cadastro: true,
    plano_profissional: p === 'profissional',
    plano_destaque: false
  };
}

export function pagamentoEhDestaqueExtra(payment) {
  const pedacos = [
    payment && payment.description,
    payment && payment.externalReference
  ];
  const items = payment && payment.items;
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      pedacos.push(items[i] && items[i].name);
      pedacos.push(items[i] && items[i].description);
    }
  }
  const texto = pedacos.filter(Boolean).join(' ').toLowerCase();
  return texto.indexOf('destaque extra') !== -1;
}

export function planoEhEssencial(plano) {
  return normalizarPlano(plano) === 'cadastro';
}

export function planoEhMensal(plano) {
  return !planoEhEssencial(plano);
}

export function cicloAssinatura(plano, extra) {
  if (extra) return 'MONTHLY';
  return planoEhEssencial(plano) ? 'YEARLY' : 'MONTHLY';
}

export function diasDoPlano(plano) {
  return planoEhEssencial(plano) ? 365 : 30;
}

export function dataValidadePlano(plano, aPartir) {
  const d = aPartir ? new Date(aPartir) : new Date();
  if (planoEhEssencial(plano)) {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setDate(d.getDate() + 30);
  }
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

export async function lerPrecoPlano(env, plano, forma) {
  const p = normalizarPlano(plano);
  const cartao = formaEhCartao(forma);

  if (p === 'cadastro') {
    const chave = cartao ? 'preco_cadastro_cartao' : 'preco_cadastro';
    const lido = await lerValorConfig(env, chave);
    if (lido && lido > 0) return arred2(lido);
    return cartao ? PRECO_ESSENCIAL_CARTAO : PRECO_ESSENCIAL_PIX;
  }

  const chave = p === 'destaque' ? 'preco_destaque' : 'preco_profissional';
  const lido = await lerValorConfig(env, chave);
  if (lido && lido > 0) return arred2(lido);
  return p === 'destaque' ? PRECO_DEST_PIX : PRECO_PROF_PIX;
}
