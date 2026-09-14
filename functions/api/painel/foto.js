// ============================================================
// AFETO — API Painel: upload de foto (pendente de aprovação)
// ------------------------------------------------------------
// A foto NÃO substitui a atual. Fica salva em foto_url_pendente
// e marcada com foto_pendente = true. Você aprova pelo painel
// admin, aí sim vira a foto oficial.
// ============================================================

const BUCKET = 'fotos';
const TAMANHO_MAX = 5 * 1024 * 1024; // 5MB

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

    // ---------- UPLOAD ----------
    const nomeArquivo = cuidadora.id + '-pendente.jpg';
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

    const fotoUrl = env.SUPABASE_URL + '/storage/v1/object/public/' + caminho + '?v=' + Date.now();

    // ---------- MARCA PENDENTE ----------
    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify({
          foto_url_pendente: fotoUrl,
          foto_pendente: true
        })
      }
    );

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      console.error('Erro marcar pendente:', patchResp.status, txt);
      return jsonResp({ error: 'Falha ao registrar foto.' }, 502);
    }

    // ---------- TELEGRAM ----------
    await notificarTelegram(env, cuidadora.id, fotoUrl);

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

async function notificarTelegram(env, cuidadorId, fotoUrl) {
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
      'ID: `' + cuidadorId + '`\n\n' +
      '[Ver no painel admin](https://afetocuidadores.pages.dev/admin)\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: fotoUrl,
        caption: msg,
        parse_mode: 'Markdown'
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