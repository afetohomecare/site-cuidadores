import { headersSupabase } from './supabase.js';

export const PRECO_ESSENCIAL_PIX = 79.9;
export const PRECO_ESSENCIAL_CARTAO = 119.9;
export const PARCELAS_CARTAO_MAX = 12;

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

export function planoEhEssencial(plano) {
  return normalizarPlano(plano) === 'cadastro';
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

export function chavePreco(plano, forma) {
  const p = normalizarPlano(plano);
  if (p === 'destaque') return 'preco_destaque';
  if (p === 'profissional') return 'preco_profissional';
  return formaEhCartao(forma) ? 'preco_cadastro_cartao' : 'preco_cadastro';
}

export function parcelasDoCartao(n) {
  const x = parseInt(n, 10);
  if (!x || x < 1) return 1;
  if (x > PARCELAS_CARTAO_MAX) return PARCELAS_CARTAO_MAX;
  return x;
}

export function valorParcela(total, parcelas) {
  const n = parcelasDoCartao(parcelas);
  if (n <= 1) return Math.round(total * 100) / 100;
  return Math.round((total / n) * 100) / 100;
}

export async function lerPrecoPlano(env, plano, forma) {
  const chave = chavePreco(plano, forma);
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + encodeURIComponent(chave) + '&select=valor&limit=1',
      { headers: headersSupabase(env) }
    );
    if (resp.ok) {
      const linhas = await resp.json();
      if (linhas && linhas[0]) {
        const valor = parseFloat(linhas[0].valor);
        if (!isNaN(valor) && valor > 0) return valor;
      }
    }
  } catch (err) {}

  if (planoEhEssencial(plano)) {
    return formaEhCartao(forma) ? PRECO_ESSENCIAL_CARTAO : PRECO_ESSENCIAL_PIX;
  }
  return null;
}
