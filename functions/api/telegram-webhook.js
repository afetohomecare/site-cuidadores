// ============================================================
// AFETO — Webhook do Telegram
// Valida upload_id antes de aprovar/rejeitar
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

    const cb = body.callback_query;
    if (!cb) return jsonResp({ ok: true, motivo: 'Não é callback' }, 200);

    const chatId = cb.message && cb.message.chat && cb.message.chat.id;
    if (String(chatId) !== String(env.TELEGRAM_CHAT_ID)) {
      console.warn('Callback de chat não autorizado:', chatId);
      return jsonResp({ ok: false }, 200);
    }

    const data = cb.data || '';
    const parts = data.split(':');
    const acao = parts[0];
    const cuidadorId = parts[1];
    const uploadIdClicado = parts[2];

    if (!cuidadorId || !uploadIdClicado || (acao !== 'foto_aprovar' && acao !== 'foto_rejeitar')) {
      return jsonResp({ ok: false, motivo: 'Callback inválido' }, 200);
    }

    const buscaResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=id,nome,foto_url,foto_url_pendente,foto_pendente,foto_upload_id,foto_pendente_path&limit=1',
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

    // ⭐ Valida upload_id
    if (cuidadora.foto_upload_id !== uploadIdClicado) {
      console.warn('Upload ID não bate. Clicado:', uploadIdClicado, 'Atual:', cuidadora.foto_upload_id);
      await responderCallback(env, cb.id, '⚠️ Essa foto já foi substituída por outra mais nova');
      return jsonResp({ ok: true }, 200);
    }

    let patchBody = {};
    let textoCallback = '';
    let emojiResultado = '';

    if (acao === 'foto_aprovar') {
      // ⭐ Antes de aprovar, deleta a foto oficial antiga (se houver)
      if (cuidadora.foto_url) {
        try {
          const antigaPath = cuidadora.foto_url.split('/storage/v1/object/public/')[1];
          // Só deleta se NÃO for o mesmo arquivo do pendente (evita deletar o que vai ser promovido)
          if (antigaPath && antigaPath !== cuidadora.foto_pendente_path) {
            await fetch(env.SUPABASE_URL + '/storage/v1/object/' + antigaPath, {
              method: 'DELETE',
              headers: {
                'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
              }
            });
          }
        } catch (e) {
          console.warn('Erro ao deletar foto antiga:', e);
        }
      }

      patchBody = {
        foto_url: cuidadora.foto_url_pendente,
        foto_url_pendente: null,
        foto_pendente: false,
        foto_upload_id: null,
        foto_pendente_path: null
      };
      textoCallback = '✅ Foto aprovada!';
      emojiResultado = '✅';
    } else {
      // ⭐ Rejeitar — deleta o arquivo pendente do storage
      if (cuidadora.foto_pendente_path) {
        try {
          await fetch(env.SUPABASE_URL + '/storage/v1/object/' + cuidadora.foto_pendente_path, {
            method: 'DELETE',
            headers: {
              'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
            }
          });
        } catch (e) {
          console.warn('Erro ao deletar foto rejeitada:', e);
        }
      }

      patchBody = {
        foto_url_pendente: null,
        foto_pendente: false,
        foto_upload_id: null,
        foto_pendente_path: null
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
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      })
    });

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