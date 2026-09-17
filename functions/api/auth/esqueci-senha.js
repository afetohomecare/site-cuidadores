// ============================================================
// AFETO — API: esqueci minha senha (versão com token)
// ------------------------------------------------------------
// 🛡️ Segurança:
//   • Gera token aleatório (32 bytes) com expiração de 30 min
//   • Nunca revela se CPF existe ou não (retorno sempre "ok")
//   • Envia link pro WhatsApp via botão no Telegram
// ============================================================

function gerarToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escaparHTML(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,nome,whatsapp,cpf,auth_user_id&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });

    // Retorno padrão (usado tanto quando achou quanto quando não achou)
    const respostaPadrao = {
      ok: true,
      mensagem: 'Se esse CPF/WhatsApp estiver cadastrado, você vai receber o link de recuperação no WhatsApp em alguns instantes.'
    };

    if (!buscaResp.ok) {
      console.error('Erro busca esqueci-senha:', await buscaResp.text());
      return jsonResp(respostaPadrao, 200);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      // Não achou — retorna OK (não vaza) e não faz nada
      return jsonResp(respostaPadrao, 200);
    }

    const cuidadora = linhas[0];

    if (!cuidadora.auth_user_id) {
      // Cadastro sem conta criada — avisa no Telegram pra você resolver manual
      await notificarTelegramSemConta(env, cuidadora);
      return jsonResp(respostaPadrao, 200);
    }

    // ---------- GERA TOKEN E SALVA ----------
    const token = gerarToken();
    const expiraEm = new Date();
    expiraEm.setMinutes(expiraEm.getMinutes() + 30);

    const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id;
    const patchResp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: headersSupabase(env, true),
      body: JSON.stringify({
        token_reset_senha: token,
        token_reset_senha_expira_em: expiraEm.toISOString()
      })
    });

    if (!patchResp.ok) {
      console.error('Erro ao salvar token:', await patchResp.text());
      return jsonResp(respostaPadrao, 200);
    }

    // ---------- NOTIFICA NO TELEGRAM COM BOTÃO ----------
    await notificarTelegramComBotao(env, cuidadora, token, expiraEm);

    return jsonResp(respostaPadrao, 200);

  } catch (err) {
    console.error('Erro esqueci-senha:', err);
    return jsonResp({
      error: 'Falha no processamento.',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
  }
}

// ============================================================
// TELEGRAM — com botão de WhatsApp
// ============================================================
async function notificarTelegramComBotao(env, cuidadora, token, expiraEm) {
  try {
    const tgToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!tgToken || !chatId) return;

    const linkReset = 'https://afetocuidadores.pages.dev/painel-reset.html?token=' + token;

    const primeiroNome = (cuidadora.nome || '').trim().split(/\s+/)[0] || '';
    const saudacao = primeiroNome ? 'Oi, ' + primeiroNome + '! 💜' : 'Oi! 💜';

    const mensagemWpp =
      saudacao + '\n\n' +
      'Recebi seu pedido de recuperação de senha da Afeto.\n\n' +
      'Clique neste link pra criar uma nova senha (válido por 30 minutos):\n\n' +
      linkReset + '\n\n' +
      'Se você não pediu isso, é só ignorar esta mensagem.';

    // Normaliza número do WhatsApp (precisa começar com 55)
    const numeroLimpo = (cuidadora.whatsapp || '').replace(/\D/g, '');
    let numeroCompleto = numeroLimpo;
    if (numeroLimpo.length === 10 || numeroLimpo.length === 11) {
      numeroCompleto = '55' + numeroLimpo;
    }

    const waUrl = 'https://wa.me/' + numeroCompleto + '?text=' + encodeURIComponent(mensagemWpp);

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const expiraFmt = expiraEm.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit'
    });

    const msgHtml =
      '🔐 <b>Pedido de recuperação de senha</b>\n\n' +
      '👤 <b>Nome:</b> ' + escaparHTML(cuidadora.nome || '—') + '\n' +
      '📱 <b>WhatsApp:</b> ' + escaparHTML(cuidadora.whatsapp || '—') + '\n' +
      '🆔 <b>CPF:</b> ' + escaparHTML(cuidadora.cpf || '—') + '\n\n' +
      '⏰ Token válido até <b>' + expiraFmt + '</b>\n\n' +
      '👇 Clique no botão abaixo pra abrir o WhatsApp com a mensagem pronta. ' +
      'É só apertar enviar.\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msgHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: '📲 Enviar link no WhatsApp', url: waUrl }
          ]]
        }
      })
    });
  } catch (e) {
    console.error('Erro Telegram com botão:', e);
  }
}

// ============================================================
// TELEGRAM — caso especial: cadastro sem conta (auth_user_id null)
// ============================================================
async function notificarTelegramSemConta(env, cuidadora) {
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
      '⚠️ <b>Reset de senha — cadastro sem conta</b>\n\n' +
      '👤 <b>Nome:</b> ' + escaparHTML(cuidadora.nome || '—') + '\n' +
      '📱 <b>WhatsApp:</b> ' + escaparHTML(cuidadora.whatsapp || '—') + '\n' +
      '🆔 <b>CPF:</b> ' + escaparHTML(cuidadora.cpf || '—') + '\n\n' +
      '❗ Essa cuidadora não tem conta criada no Auth. ' +
      'Ela precisa refazer o cadastro.\n\n' +
      '🕒 ' + agora;

    await fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error('Erro Telegram sem conta:', e);
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