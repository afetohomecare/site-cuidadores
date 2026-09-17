// ============================================================
// AFETO — API: resetar senha com token
// ------------------------------------------------------------
// Recebe { token, nova_senha }. Valida token + expiração,
// troca a senha no Supabase Auth, invalida o token.
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const token = (body.token || '').trim();
    const novaSenha = body.nova_senha || '';

    if (!token || token.length !== 64) {
      return jsonResp({ error: 'Token inválido ou expirado. Solicite um novo link.' }, 400);
    }

    if (!novaSenha || novaSenha.length < 8) {
      return jsonResp({ error: 'A senha precisa ter no mínimo 8 caracteres.' }, 400);
    }

    if (novaSenha.length > 100) {
      return jsonResp({ error: 'Senha muito longa.' }, 400);
    }

    // ---------- BUSCA CUIDADORA PELO TOKEN ----------
    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?token_reset_senha=eq.' +
      encodeURIComponent(token) +
      '&select=id,nome,cpf,auth_user_id,token_reset_senha_expira_em&limit=1';

    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });

    if (!buscaResp.ok) {
      console.error('Erro busca token:', await buscaResp.text());
      return jsonResp({ error: 'Falha ao validar token. Tente novamente.' }, 502);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      return jsonResp({ error: 'Token inválido ou expirado. Solicite um novo link.' }, 400);
    }

    const cuidadora = linhas[0];

    // ---------- VALIDA EXPIRAÇÃO ----------
    if (!cuidadora.token_reset_senha_expira_em) {
      return jsonResp({ error: 'Token inválido ou expirado. Solicite um novo link.' }, 400);
    }

    const expira = new Date(cuidadora.token_reset_senha_expira_em);
    if (expira < new Date()) {
      return jsonResp({ error: 'Este link expirou. Solicite um novo.' }, 400);
    }

    if (!cuidadora.auth_user_id) {
      return jsonResp({ error: 'Conta não encontrada. Fale com a gente pelo WhatsApp.' }, 404);
    }

    // ---------- ATUALIZA SENHA NO AUTH ----------
    const authResp = await fetch(
      env.SUPABASE_URL + '/auth/v1/admin/users/' + cuidadora.auth_user_id,
      {
        method: 'PUT',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: novaSenha })
      }
    );

    if (!authResp.ok) {
      const txt = await authResp.text();
      console.error('Erro ao trocar senha no Auth:', authResp.status, txt);
      return jsonResp({ error: 'Falha ao atualizar senha. Tente novamente.' }, 502);
    }

    // ---------- INVALIDA TOKEN ----------
    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id, {
      method: 'PATCH',
      headers: headersSupabase(env, true),
      body: JSON.stringify({
        token_reset_senha: null,
        token_reset_senha_expira_em: null
      })
    });

    // ---------- AVISA NO TELEGRAM ----------
    await notificarTelegramSucesso(env, cuidadora);

    return jsonResp({
      ok: true,
      mensagem: 'Senha atualizada com sucesso!'
    }, 200);

  } catch (err) {
    console.error('Erro resetar-senha:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function notificarTelegramSucesso(env, cuidadora) {
  try {
    const tgToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!tgToken || !chatId) return;

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const msg =
      '✅ <b>Senha redefinida com sucesso</b>\n\n' +
      '👤 ' + (cuidadora.nome || '—') + '\n' +
      '🆔 ' + (cuidadora.cpf || '—') + '\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Erro Telegram sucesso:', e);
  }
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
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}