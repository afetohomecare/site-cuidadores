import { headersSupabase } from './supabase.js';

export async function validarCupom(env, codigo, plano, valorBase, cpfLimpo) {
  const codigoLimpo = String(codigo || '').trim().toUpperCase();
  if (!codigoLimpo) return { ok: false, erro: 'Digite o cupom.' };

  const url = env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(codigoLimpo) + '&select=*&limit=1';
  const resp = await fetch(url, { headers: headersSupabase(env) });
  if (!resp.ok) return { ok: false, erro: 'Erro ao consultar cupom' };

  const linhas = await resp.json();
  if (!linhas || linhas.length === 0) return { ok: false, erro: 'Cupom não encontrado' };

  const cupom = linhas[0];
  if (!cupom.ativo) return { ok: false, erro: 'Cupom inativo' };
  if (cupom.valido_ate && new Date(cupom.valido_ate) < new Date()) return { ok: false, erro: 'Cupom expirado' };
  if (cupom.usos_maximos && cupom.usos_atuais >= cupom.usos_maximos) return { ok: false, erro: 'Cupom esgotado' };

  if (cupom.plano_aplicavel && cupom.plano_aplicavel !== plano) {
    const nomes = { cadastro: 'Essencial', profissional: 'Profissional', destaque: 'Destaque' };
    return { ok: false, erro: 'Este cupom só vale pro plano ' + (nomes[cupom.plano_aplicavel] || cupom.plano_aplicavel) };
  }

  if (cpfLimpo && cupom.id) {
    try {
      const cpfComFormato = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const buscaCpf = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?or=(cpf.eq.' + encodeURIComponent(cpfLimpo) + ',cpf.eq.' + encodeURIComponent(cpfComFormato) + ')&select=id&limit=1',
        { headers: headersSupabase(env) }
      );
      if (buscaCpf.ok) {
        const linhasCpf = await buscaCpf.json();
        if (linhasCpf && linhasCpf[0]) {
          const cuidadorId = linhasCpf[0].id;
          const jaUsouResp = await fetch(
            env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + encodeURIComponent(cupom.id) + '&cuidador_id=eq.' + encodeURIComponent(cuidadorId) + '&limit=1',
            { headers: headersSupabase(env) }
          );
          if (jaUsouResp.ok) {
            const usos = await jaUsouResp.json();
            if (usos && usos.length > 0) {
              return { ok: false, erro: 'Você já usou esse cupom' };
            }
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao verificar uso de cupom:', e);
    }
  }

  let desconto;
  if (cupom.tipo === 'percentual') {
    desconto = valorBase * (parseFloat(cupom.valor) / 100);
  } else {
    desconto = parseFloat(cupom.valor);
  }
  desconto = Math.min(desconto, valorBase);
  return { ok: true, cupom: cupom, desconto: Math.round(desconto * 100) / 100 };
}

export async function registrarUsoCupom(env, cupom, cuidadorId, plano, valorBase, desconto, valorFinal, asaasPagamentoId) {
  try {
    const usoResp = await fetch(env.SUPABASE_URL + '/rest/v1/cupons_usos', {
      method: 'POST',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        cupom_id: cupom.id,
        cupom_codigo: cupom.codigo,
        cuidador_id: cuidadorId,
        plano: plano,
        valor_original: valorBase,
        valor_desconto: desconto,
        valor_final: valorFinal,
        asaas_pagamento_id: asaasPagamentoId || null
      })
    });
    if (!usoResp.ok && usoResp.status !== 409) return false;
    if (usoResp.status === 409) return true;
    const cupomResp = await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + encodeURIComponent(cupom.id), {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({ usos_atuais: (cupom.usos_atuais || 0) + 1 })
    });
    if (!cupomResp.ok) return false;
    return true;
  } catch (err) {
    console.warn('Erro uso cupom:', err);
    return false;
  }
}
