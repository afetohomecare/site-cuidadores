// ============================================================
// AFETO — API: esqueci minha senha
// ------------------------------------------------------------
// Recebe CPF ou WhatsApp e notifica você no Telegram.
// Você reseta manualmente no Supabase e manda por WhatsApp.
//
// Retorna SEMPRE "ok" pra não vazar informação (não diz se
// o CPF existe ou não).
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const identificador = (body.identificador || '').trim();

    if (!identificador) {
      return jsonResp({ error: 'Informe seu CPF ou WhatsApp.' }, 400);
    }

    const idLimpo = identificador.replace(/\D/g, '');

    if (idLimpo.length < 10 || idLimpo.length > 11) {
      return jsonResp({ error: 'CPF ou WhatsApp inválido.' }, 400);
    }

    // ---------- BUSCA CUIDADORA ----------
    const filtro = 'or=(' +
      'cpf.eq.' + encodeURIComponent(idLimpo) + ',' +
      'whatsapp.eq.' + encodeURIComponent(idLimpo) + ',' +
      'whatsapp.eq.' + encodeURIComponent(identificador) +
    ')';

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,nome,whatsapp,cpf&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, {
      headers: headersSupabase(env)
    });

    if (buscaResp.ok) {
      const linhas = await buscaResp.json();

      if (linhas && linhas.length > 0) {
        const cuidadora = linhas[0];
        await notificarTelegram(env, {
          nome: cuidadora.nome,
          whatsapp: cuidadora.whatsapp,
          cpf: cuidadora.cpf,
          cuidador_id: cuidadora.id
        });
      }
    }

    // Sempre retorna OK pra não vazar informação
    return jsonResp({
      ok: true,
      mensagem: 'Pedido registrado. Você receberá uma nova senha em breve pelo WhatsApp.'
    }, 200);

  } catch (err) {
    console.error('Erro esqueci-senha:', err);
    return jsonResp({
      error: 'Falha no processamento.',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
  }
}

async function notificarTelegram(env, dados) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const msg = '🔐 *Pedido de reset de senha*\n\n' +
      '👤 *Nome:* ' + (dados.nome || '—') + '\n' +
      '📱 *WhatsApp:* ' + (dados.whatsapp || '—') + '\n' +
      '🆔 *CPF:* ' + (dados.cpf || '—') + '\n\n' +
      '*Como resolver:*\n' +
      '1. Supabase → Authentication → Users\n' +
      '2. Acha o email `' + (dados.cpf || '').replace(/\D/g, '') + '@afeto.app`\n' +
      '3. Reset password\n' +
      '4. Manda a nova senha por WhatsApp pra ela\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('Erro Telegram esqueci-senha:', e);
  }
}

function headersSupabase(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}