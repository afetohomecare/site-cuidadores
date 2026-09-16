// ============================================================
// AFETO — Webhook do Telegram
// ------------------------------------------------------------
// Recebe os cliques nos botões inline (fotos pra aprovar/rejeitar).
// Quando o admin clica num botão, o Telegram manda um POST aqui.
//
// Callback data:
//   foto_aprovar:<cuidadorId>  → move foto_url_pendente → foto_url
//   foto_rejeitar:<cuidadorId> → limpa foto_url_pendente
// ============================================================

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return jsonResp({ ok: false, motivo: 'Telegram não configurado' }, 200);
  }

  try {
    const body = await request.json();

    // Telegram envia update com callback_query quando alguém clica num botão
    const cb = body.callback_query;
    if (!cb) return jsonResp({ ok: true, motivo: 'Não é callback' }, 200);

    // ⭐ Valida que veio do chat certo (admin)
    const chatId = cb.message && cb.message.chat && cb.message.chat.id;
    if (String(chatId) !== String(env.TELEGRAM_CHAT_ID)) {
      console.warn('Callback de chat não autorizado:', chatId);
      return jsonResp({ ok: false }, 200);
    }

    const data = cb.data || '';
    const parts = data.split(':');
    const acao = parts[0];
    const cuidadorId = parts[1];

    if (!cuidadorId || (acao !== 'foto_aprovar' && acao !== 'foto_rejeitar')) {
      return jsonResp({ ok: false, motivo: 'Callback inválido' }, 200);
    }

    // Busca estado atual
    const buscaResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=id,nome,foto_url,foto_url_pendente,foto_pendente&limit=1',
      { headers: headersSupabase(env) }
    );

    if (!buscaResp.ok) {
      await responderCallback(env, cb.id, 'Erro ao consultar');
      return jsonResp({ ok: false }, 200);
    }

    const linhas = await buscaResp.json();
    if (!linhas || linhas.length === 0) {
      await responderCallback(env, cb.id, 'Cuidadora não encontrada');
      return jsonResp({ ok: false }, 200);
    }

    const cuidadora = linhas[0];

    if (!cuidadora.foto_pendente || !cuidadora.foto_url_pendente) {
      await responderCallback(env, cb.id, 'Essa foto já foi processada');
      return jsonResp({ ok: true }, 200);
    }

    let patchBody = {};
    let textoCallback = '';
    let emojiResultado = '';

    if (acao === 'foto_aprovar') {
      patchBody = {
        foto_url: cuidadora.foto_url_pendente,
        foto_url_pendente: null,
        foto_pendente: false
      };
      textoCallback = '✅ Foto aprovada!';
      emojiResultado = '✅';
    } else {
      patchBody = {
        foto_url_pendente: null,
        foto_pendente: false
      };
      textoCallback = '❌ Foto rejeitada';
      emojiResultado = '❌';
    }

    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId),
      {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify(patchBody)
      }
    );

    if (!patchResp.ok) {
      await responderCallback(env, cb.id, 'Erro ao processar');
      return jsonResp({ ok: false }, 200);
    }

    await responderCallback(env, cb.id, textoCallback);
    await editarMensagem(env, cb.message.chat.id, cb.message.message_id, emojiResultado, cuidadora.nome);

    return jsonResp({ ok: true }, 200);

  } catch (err) {
    console.error('Erro telegram-webhook:', err);
    return jsonResp({ ok: false }, 200);
  }
}

async function responderCallback(env, callbackId, texto) {
  try {
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: texto,
        show_alert: false
      })
    });
  } catch (e) {
    console.warn('Erro responderCallback:', e);
  }
}

async function editarMensagem(env, chatId, messageId, emoji, nomeCuidadora) {
  try {
    // Remove os botões
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      })
    });

    // Atualiza a legenda
    const titulo = emoji === '✅' ? 'Foto aprovada' : 'Foto rejeitada';
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/editMessageCaption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption: emoji + ' *' + titulo + '*\n\n👤 ' + (nomeCuidadora || 'Cuidadora'),
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.warn('Erro editarMensagem:', e);
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

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: 'Telegram webhook ativo.' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}