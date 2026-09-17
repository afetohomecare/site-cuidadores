// functions/api/asaas/status.js
// Consulta o status de uma cobrança no Asaas (polling)
//
// 🛡️ BLINDAGENS:
//   • Marca como Pago no banco se o webhook falhar
//   • Trata estorno/chargeback
//   • Sem token (a conta já foi criada no cadastro)
//
// 🌍 AMBIENTE: controlado por env.ASAAS_AMBIENTE

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
    return jsonResp({ error: 'Chave Asaas não configurada' }, 500);
  }

  try {
    const url = new URL(request.url);
    const cobrancaId = url.searchParams.get('id');
    const cuidadorId = url.searchParams.get('cuidadorId');

    if (!cobrancaId) {
      return jsonResp({ error: 'Parâmetro ?id= obrigatório' }, 400);
    }

    const resp = await fetch(`${ASAAS_URL}/payments/${cobrancaId}`, {
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
      return jsonResp({
        ok: false,
        debug: 'Asaas respondeu em formato inesperado',
        status_asaas: resp.status
      }, 502);
    }

    if (!resp.ok) {
      return jsonResp({
        ok: false,
        status_asaas: resp.status,
        resposta_asaas: data
      }, 502);
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

    // 🛡️ Se pagou, marca como Pago no banco (redundância do webhook)
    if (pago && cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
          '&select=status_pagamento,plano_cadastro,plano_profissional,plano_destaque,plano_valido_ate&limit=1',
          {
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
              'Accept': 'application/json'
            }
          }
        );

        if (cResp.ok) {
          const linhas = await cResp.json();
          const c = linhas && linhas[0];

          if (c && c.status_pagamento !== 'Pago') {
            const agora = new Date();
            const patchBody = { status_pagamento: 'Pago' };

            let planoDetectado = 'profissional';
            if (c.plano_cadastro) planoDetectado = 'cadastro';
            else if (c.plano_destaque) planoDetectado = 'destaque';
            else if (c.plano_profissional) planoDetectado = 'profissional';

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
                headers: {
                  'apikey': env.SUPABASE_SERVICE_KEY,
                  'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(patchBody)
              }
            );

            console.log('🛡️ Status marcou como Pago:', cuidadorId);
          }
        }
      } catch (e) {
        console.warn('Erro ao marcar Pago via status:', e);
      }
    }

    // 🛡️ Se estornou, remove acesso
    if (estornado && cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      try {
        await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
          {
            method: 'PATCH',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json'
            },
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

    return jsonResp(resposta, 200);

  } catch (err) {
    console.error('Erro status:', err);
    return jsonResp({
      ok: false,
      error: 'Falha no processamento',
      detalhe: String(err.message)
    }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}