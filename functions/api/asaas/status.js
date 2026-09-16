// functions/api/asaas/status.js
// Consulta o status de uma cobrança no Asaas (usado no polling)
//
// Quando o pagamento está confirmado, devolve também o token
// de criar senha (se a cuidadora ainda não criou senha).
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

    // ⭐ Se pagou, busca o token de criar senha no Supabase
    if (pago && cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
          '&select=token_criar_senha,token_criar_senha_expira_em,auth_user_id&limit=1',
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

          if (c && !c.auth_user_id && c.token_criar_senha) {
            const expira = c.token_criar_senha_expira_em ? new Date(c.token_criar_senha_expira_em) : null;
            const agora = new Date();

            if (expira && expira > agora) {
              resposta.token_criar_senha = c.token_criar_senha;
            }
          }
        }
      } catch (e) {
        console.warn('Erro ao buscar token criar senha:', e);
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