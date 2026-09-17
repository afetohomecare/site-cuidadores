// Consulta status de uma cobrança Asaas (polling após PIX).
// Só marca Pago no banco se a cobrança for daquela cuidadora
// (externalReference ou asaas_cobranca_id).

import { jsonResp } from '../../_lib/http.js';
import { headersSupabase, supabaseOk } from '../../_lib/supabase.js';
import { idSeguro } from '../../_lib/auth.js';

function getAsaasConfig(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox';
  return {
    url: isSandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3',
    apiKey: isSandbox
      ? (env.ASAAS_API_KEY_SANDBOX || env.ASAAS_API_KEY)
      : (env.ASAAS_API_KEY_PRODUCAO || env.ASAAS_API_KEY),
    isSandbox: isSandbox
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);
  const ASAAS_API_KEY = asaas.apiKey;
  const ASAAS_URL = asaas.url;

  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'Pagamento temporariamente indisponível.' }, 500);
  }

  try {
    const url = new URL(request.url);
    const cobrancaId = String(url.searchParams.get('id') || '').trim();
    const cuidadorId = idSeguro(url.searchParams.get('cuidadorId'));

    if (!cobrancaId || cobrancaId.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(cobrancaId)) {
      return jsonResp({ error: 'Cobrança inválida.' }, 400);
    }

    const resp = await fetch(ASAAS_URL + '/payments/' + encodeURIComponent(cobrancaId), {
      headers: {
        'User-Agent': 'Afeto/1.0',
        'access_token': ASAAS_API_KEY
      }
    });

    const texto = await resp.text();
    let data = null;
    try {
      data = JSON.parse(texto);
    } catch (e) {
      return jsonResp({ ok: false, error: 'Falha ao consultar pagamento.' }, 502);
    }

    if (!resp.ok) {
      return jsonResp({ ok: false, error: 'Cobrança não encontrada.' }, 404);
    }

    const pago = data.status === 'RECEIVED' || data.status === 'CONFIRMED';
    const estornado = data.status === 'REFUNDED' || data.status === 'CHARGEBACK_REQUESTED';

    const resposta = {
      ok: true,
      ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
      cobrancaId: data.id,
      status: data.status,
      pago: pago,
      estornado: estornado,
      valor: data.value,
      formaPagamento: data.billingType
    };

    if ((pago || estornado) && cuidadorId && supabaseOk(env)) {
      const pertence = await cobrancaPertenceACuidadora(env, data, cobrancaId, cuidadorId);
      if (pertence) {
        if (pago) await marcarPago(env, cuidadorId);
        if (estornado) await marcarEstornado(env, cuidadorId);
      }
    }

    return jsonResp(resposta, 200);
  } catch (err) {
    console.error('Erro status:', err);
    return jsonResp({ ok: false, error: 'Falha no processamento' }, 500);
  }
}

async function cobrancaPertenceACuidadora(env, payment, cobrancaId, cuidadorId) {
  if (payment.externalReference && String(payment.externalReference) === String(cuidadorId)) {
    return true;
  }

  const cResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
    '&select=id,asaas_cobranca_id&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!cResp.ok) return false;
  const linhas = await cResp.json();
  const c = linhas && linhas[0];
  return !!(c && c.asaas_cobranca_id && String(c.asaas_cobranca_id) === String(cobrancaId));
}

async function marcarPago(env, cuidadorId) {
  try {
    const cResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=status_pagamento,plano_cadastro,plano_profissional,plano_destaque,plano_valido_ate&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!cResp.ok) return;

    const linhas = await cResp.json();
    const c = linhas && linhas[0];
    if (!c || c.status_pagamento === 'Pago') return;

    const agora = new Date();
    const patchBody = { status_pagamento: 'Pago' };

    if (!c.plano_valido_ate) {
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + 30);
      patchBody.plano_inicio = agora.toISOString();
      patchBody.plano_valido_ate = vence.toISOString();
      patchBody.proxima_cobranca = vence.toISOString();
    }

    await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(patchBody)
      }
    );
  } catch (e) {
    console.warn('Erro ao marcar Pago via status:', e);
  }
}

async function marcarEstornado(env, cuidadorId) {
  try {
    await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          status_pagamento: 'Estornado',
          plano_valido_ate: new Date().toISOString()
        })
      }
    );
  } catch (e) {
    console.warn('Erro estorno:', e);
  }
}
