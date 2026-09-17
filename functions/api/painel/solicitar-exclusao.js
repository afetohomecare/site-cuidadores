// ============================================================
// AFETO — API Painel: solicitar exclusão dos dados (LGPD)
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const cuidadora = await validarToken(env, request);
    if (!cuidadora) {
      return jsonResp({ error: 'Não autenticado.' }, 401);
    }

    const body = await request.json();
    const motivo = (body.motivo || '').trim().substring(0, 500);

    const jaTemResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_exclusao?cuidador_id=eq.' +
      cuidadora.id + '&status=eq.pendente&limit=1',
      { headers: headersSupabase(env) }
    );

    if (jaTemResp.ok) {
      const existentes = await jaTemResp.json();
      if (existentes && existentes.length > 0) {
        return jsonResp({
          error: 'Você já tem uma solicitação em análise. Aguarde nosso contato.'
        }, 409);
      }
    }

    const criarResp = await fetch(env.SUPABASE_URL + '/rest/v1/solicitacoes_exclusao', {
      method: 'POST',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify({
        cuidador_id: cuidadora.id,
        motivo: motivo || null,
        status: 'pendente'
      })
    });

    if (!criarResp.ok) {
      const txt = await criarResp.text();
      console.error('Erro criar solicitação:', criarResp.status, txt);
      return jsonResp({ error: 'Falha ao registrar sua solicitação.' }, 502);
    }

    await notificarTelegram(env, cuidadora.id);

    return jsonResp({
      ok: true,
      mensagem: 'Solicitação registrada. Nossa equipe vai analisar em até 7 dias úteis.'
    }, 200);

  } catch (err) {
    console.error('Erro solicitar-exclusao:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });

  if (!userResp.ok) return null;

  const userData = await userResp.json();

  const buscaResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' +
    encodeURIComponent(userData.id) + '&select=id,nome,whatsapp&limit=1',
    { headers: headersSupabase(env) }
  );

  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  if (!linhas || linhas.length === 0) return null;

  return linhas[0];
}

async function notificarTelegram(env, cuidadorId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const msg = '🗑️ *Solicitação de exclusão de dados*\n\n' +
      'ID: `' + cuidadorId + '`\n\n' +
      'Acesse o painel admin → Solicitações para revisar.\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Erro Telegram exclusão:', e);
  }
}

function headersSupabase(env, temBody, querRetorno) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  if (querRetorno) h['Prefer'] = 'return=representation';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}