// ============================================================
// AFETO — API Painel: upload de foto (pendente de aprovação)
// ------------------------------------------------------------
// Cada upload gera arquivo com ID único (não sobrescreve).
// Guarda o caminho em foto_pendente_path pra deletar depois.
// ============================================================

const BUCKET = 'fotos';
const TAMANHO_MAX = 5 * 1024 * 1024;

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

    const form = await request.formData();
    const foto = form.get('foto');

    if (!foto || !foto.size) {
      return jsonResp({ error: 'Nenhum arquivo enviado.' }, 400);
    }

    if (foto.size > TAMANHO_MAX) {
      return jsonResp({ error: 'A foto precisa ter no máximo 5MB.' }, 400);
    }

    if (!foto.type || !foto.type.startsWith('image/')) {
      return jsonResp({ error: 'O arquivo precisa ser uma imagem.' }, 400);
    }

    // ⭐ Gera upload_id único ANTES de nomear o arquivo
    const uploadId = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);

    // ⭐ Nome do arquivo agora tem uploadId — cada upload é único
    const nomeArquivo = cuidadora.id + '-' + uploadId + '.jpg';
    const caminho = BUCKET + '/' + nomeArquivo;
    const buffer = await foto.arrayBuffer();

    const uploadResp = await fetch(
      env.SUPABASE_URL + '/storage/v1/object/' + caminho,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
          'Content-Type': foto.type || 'image/jpeg',
          'x-upsert': 'true'
        },
        body: buffer
      }
    );

    if (!uploadResp.ok) {
      const txt = await uploadResp.text();
      console.error('Erro upload:', uploadResp.status, txt);
      return jsonResp({ error: 'Falha ao enviar a foto.' }, 502);
    }

    const fotoUrl = env.SUPABASE_URL + '/storage/v1/object/public/' + caminho;

    // ⭐ Busca foto pendente anterior pra deletar (se houver)
    let caminhoPendenteAntigo = null;
    try {
      const cResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id + '&select=foto_pendente_path&limit=1',
        { headers: headersSupabase(env) }
      );
      if (cResp.ok) {
        const cData = await cResp.json();
        if (cData[0] && cData[0].foto_pendente_path) {
          caminhoPendenteAntigo = cData[0].foto_pendente_path;
        }
      }
    } catch (e) {
      console.warn('Erro ao buscar pendente antigo:', e);
    }

    // Atualiza registro com novo pendente
    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify({
          foto_url_pendente: fotoUrl,
          foto_pendente: true,
          foto_upload_id: uploadId,
          foto_pendente_path: caminho
        })
      }
    );

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      console.error('Erro marcar pendente:', patchResp.status, txt);
      return jsonResp({ error: 'Falha ao registrar foto.' }, 502);
    }

    // ⭐ Deleta o arquivo pendente anterior (não é mais necessário)
    if (caminhoPendenteAntigo && caminhoPendenteAntigo !== caminho) {
      try {
        await fetch(env.SUPABASE_URL + '/storage/v1/object/' + caminhoPendenteAntigo, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
          }
        });
      } catch (e) {
        console.warn('Erro ao deletar pendente antigo:', e);
      }
    }

    await notificarTelegram(env, cuidadora.id, fotoUrl, cuidadora.nome, uploadId);

    return jsonResp({
      ok: true,
      mensagem: 'Foto enviada! Aguardando aprovação da equipe Afeto.'
    }, 200);

  } catch (err) {
    console.error('Erro foto:', err);
    return jsonResp({
      error: 'Falha no processamento.',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
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
    encodeURIComponent(userData.id) + '&select=id,nome&limit=1',
    { headers: headersSupabase(env) }
  );

  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  if (!linhas || linhas.length === 0) return null;

  return linhas[0];
}

async function notificarTelegram(env, cuidadorId, fotoUrl, cuidadorNome, uploadId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const msg = '📸 *Nova foto aguardando aprovação*\n\n' +
      '👤 ' + (cuidadorNome || 'Cuidadora') + '\n' +
      'ID: `' + cuidadorId + '`\n\n' +
      'Toque em ✅ pra aprovar ou ❌ pra rejeitar.\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: fotoUrl,
        caption: msg,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Aprovar', callback_data: 'foto_aprovar:' + cuidadorId + ':' + uploadId },
            { text: '❌ Rejeitar', callback_data: 'foto_rejeitar:' + cuidadorId + ':' + uploadId }
          ]]
        }
      })
    });
  } catch (e) {
    console.error('Erro Telegram foto:', e);
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