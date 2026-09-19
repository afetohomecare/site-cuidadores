// ============================================================
// AFETO — API Painel: Cancelar Assinatura
// 🛡️ BLINDAGEM: idempotente + fallback se Asaas falhar
// ============================================================

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);
  const ASAAS_URL = asaas.url;
  const ASAAS_API_KEY = asaas.apiKey;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const cuidadora = await validarToken(env, request);
    if (!cuidadora) return jsonResp({ error: 'Não autenticado.' }, 401);

    let respBd = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id +
      '&select=asaas_subscription_id,mp_preapproval_id&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!respBd.ok) {
      respBd = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id +
        '&select=asaas_subscription_id&limit=1',
        { headers: headersSupabase(env) }
      );
    }
    const dadosBd = await respBd.json();
    const subId = dadosBd[0] && dadosBd[0].asaas_subscription_id;
    const mpSubId = dadosBd[0] && dadosBd[0].mp_preapproval_id;

    if (!subId && !mpSubId) {
      return jsonResp({
        ok: true,
        mensagem: 'Nenhuma assinatura ativa (já estava cancelada ou é plano PIX).',
        jaCancelada: true
      }, 200);
    }

    let asaasSucesso = false;
    let mpSucesso = false;

    if (subId && ASAAS_API_KEY) {
      try {
        const asaasResp = await fetch(`${ASAAS_URL}/subscriptions/${subId}`, {
          method: 'DELETE',
          headers: {
            'User-Agent': 'Afeto/1.0',
            'access_token': ASAAS_API_KEY
          }
        });

        if (asaasResp.ok || asaasResp.status === 404) {
          asaasSucesso = true;
        } else {
          const errData = await asaasResp.text();
          console.error('Erro ao cancelar no Asaas:', errData);
        }
      } catch (e) {
        console.error('Erro de rede ao cancelar no Asaas:', e);
      }
    }

    if (mpSubId) {
      try {
        const { cancelarPreapprovalMp } = await import('../../_lib/mercadopago.js');
        mpSucesso = await cancelarPreapprovalMp(env, mpSubId);
      } catch (e) {
        console.error('Erro ao cancelar no Mercado Pago:', e);
      }
    }

    const { patchCuidador } = await import('../../_lib/pagamento.js');
    await patchCuidador(env, cuidadora.id, {
      asaas_subscription_id: null,
      mp_preapproval_id: null,
      proxima_cobranca: null
    });

    const cancelou = (!subId || asaasSucesso) && (!mpSubId || mpSucesso);
    return jsonResp({
      ok: true,
      ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
      asaasCancelou: asaasSucesso,
      mpCancelou: mpSucesso,
      mensagem: cancelou
        ? 'Assinatura cancelada com sucesso.'
        : 'Assinatura removida do painel. Se houver cobrança futura, entre em contato.'
    }, 200);

  } catch (err) {
    console.error('Erro cancelar-assinatura:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
  });

  if (!userResp.ok) return null;
  const userData = await userResp.json();

  const buscaResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' + encodeURIComponent(userData.id) + '&select=id&limit=1',
    { headers: headersSupabase(env) }
  );

  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  return linhas && linhas.length > 0 ? linhas[0] : null;
}

function headersSupabase(env, temBody) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}