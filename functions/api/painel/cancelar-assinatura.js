// ============================================================
// AFETO — API Painel: Cancelar Assinatura (Cartão)
// ============================================================

const ASAAS_URL = 'https://sandbox.asaas.com/api/v3'; // 🔥 MUDAR PRA PROD DEPOIS

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.ASAAS_API_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    // 1. Valida o Token da Cuidadora
    const cuidadora = await validarToken(env, request);
    if (!cuidadora) {
      return jsonResp({ error: 'Não autenticado.' }, 401);
    }

    // 2. Busca o ID da assinatura no Supabase
    const respBd = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id + '&select=asaas_subscription_id&limit=1',
      { headers: headersSupabase(env) }
    );
    const dadosBd = await respBd.json();
    const subId = dadosBd[0] && dadosBd[0].asaas_subscription_id;

    if (!subId) {
      return jsonResp({ error: 'Nenhuma assinatura ativa encontrada.' }, 400);
    }

    // 3. Deleta a assinatura no Asaas
    const asaasResp = await fetch(`${ASAAS_URL}/subscriptions/${subId}`, {
      method: 'DELETE',
      headers: {
        'User-Agent': 'Afeto/1.0',
        'access_token': env.ASAAS_API_KEY
      }
    });

    if (!asaasResp.ok) {
      const errData = await asaasResp.text();
      console.error('Erro ao cancelar no Asaas:', errData);
      return jsonResp({ error: 'Falha ao comunicar com o Asaas.' }, 502);
    }

    // 4. Remove o ID da assinatura do Supabase (para o painel dela atualizar)
    // Nota: Mantemos o status "Pago" e a "plano_valido_ate" para ela usar até o fim do ciclo.
    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id, {
      method: 'PATCH',
      headers: headersSupabase(env, true),
      body: JSON.stringify({
        asaas_subscription_id: null,
        proxima_cobranca: null // Limpa a data da próxima cobrança pois não haverá mais
      })
    });

    return jsonResp({ ok: true, mensagem: 'Assinatura cancelada com sucesso.' }, 200);

  } catch (err) {
    console.error('Erro cancelar-assinatura:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

// ============================================================
// HELPERS
// ============================================================
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
  const h = { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Accept': 'application/json' };
  if (temBody) h['Content-Type'] = 'application/json';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}