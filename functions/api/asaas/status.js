// functions/api/asaas/status.js
// Consulta o status de uma cobrança no Asaas (usado no polling)
//
// Quando o pagamento está confirmado:
//   • Se a cuidadora ainda não tem senha, GARANTE que existe um
//     token válido — gera na hora se o webhook não tiver chegado.
//   • Devolve o token pro frontend criar a senha.
//
// 🌍 AMBIENTE: controlado por env.ASAAS_AMBIENTE

function getAsaasConfig(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox';

  return {
    url: isSandbox
      ? 'https://sandbox.asaas.com/api/v3'
      : 'https://api.asaas.com/v3',
    apiKey: isSandbox
      ? (env.ASAAS_API_KEY_SANDBOX || env.ASAAS_API_KEY)
      : (env.ASAAS_API_KEY_PRODUCAO || env.ASAAS_API_KEY),
    isSandbox: isSandbox
  };
}

// Gera token aleatório (mesmo formato do webhook.js)
function gerarToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);
  const ASAAS_API_KEY = asaas.apiKey;
  const ASAAS_URL = asaas.url;

  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'Chave Asaas não configurada no ambiente: ' + (asaas.isSandbox ? 'SANDBOX' : 'PRODUCAO') }, 500);
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
        status_asaas: resp.status,
        corpo_recebido: texto.substring(0, 500)
      }, 502);
    }

    if (!resp.ok) {
      console.error('Asaas status erro:', JSON.stringify(data));
      return jsonResp({
        ok: false,
        status_asaas: resp.status,
        resposta_asaas: data
      }, 502);
    }

    const pago = data.status === 'RECEIVED' || data.status === 'CONFIRMED';

    const resposta = {
      ok: true,
      ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
      cobrancaId: data.id,
      status: data.status,
      pago: pago,
      valor: data.value,
      formaPagamento: data.billingType
    };

    // ⭐ Se pagou, garante que a cuidadora terá um token pra criar senha
    if (pago && cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
          '&select=token_criar_senha,token_criar_senha_expira_em,auth_user_id,status_pagamento,plano_cadastro,plano_profissional,plano_destaque&limit=1',
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

          // Se já tem senha criada, não precisa de token
          if (c && c.auth_user_id) {
            // nada a fazer
          }
          else if (c) {
            // ⭐ GARANTE: se a cuidadora já está "Pago" no banco mas ainda
            //    não tem token válido (webhook pode ter falhado), gera agora.
            let tokenAtual = c.token_criar_senha;
            const expiraAtual = c.token_criar_senha_expira_em ? new Date(c.token_criar_senha_expira_em) : null;
            const agora = new Date();

            const tokenEhValido = tokenAtual && expiraAtual && expiraAtual > agora;

            // Marca como Pago no banco, caso ainda não esteja (fallback do webhook)
            const patchBody = {};

            if (c.status_pagamento !== 'Pago') {
              patchBody.status_pagamento = 'Pago';

              // Aproveita e ajusta datas do plano se ainda não tiver
              let planoDetectado = 'profissional';
              if (c.plano_cadastro) planoDetectado = 'cadastro';
              else if (c.plano_destaque) planoDetectado = 'destaque';
              else if (c.plano_profissional) planoDetectado = 'profissional';

              const vence = new Date(agora);
              vence.setDate(vence.getDate() + 30);

              patchBody.plano_inicio = agora.toISOString();
              patchBody.plano_valido_ate = vence.toISOString();
              patchBody.proxima_cobranca = vence.toISOString();
            }

            // Gera token se não tiver um válido
            if (!tokenEhValido) {
              tokenAtual = gerarToken();
              const expiraNovo = new Date(agora);
              expiraNovo.setHours(expiraNovo.getHours() + 1);

              patchBody.token_criar_senha = tokenAtual;
              patchBody.token_criar_senha_expira_em = expiraNovo.toISOString();
            }

            // Só faz PATCH se tiver algo pra atualizar
            if (Object.keys(patchBody).length > 0) {
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
              console.log('🔐 Token de criar senha gerado/renovado via polling:', cuidadorId);
            }

            // Devolve o token pro frontend
            resposta.token_criar_senha = tokenAtual;
          }
        }
      } catch (e) {
        console.warn('Erro ao garantir token de criar senha:', e);
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