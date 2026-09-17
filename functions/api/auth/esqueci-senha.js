// ============================================================
// AFETO — API: esqueci minha senha (SÓ CPF)
// ------------------------------------------------------------
// 🛡️ Segurança:
//   • Token aleatório (32 bytes) com expiração de 24h
//   • Nunca revela se CPF existe ou não
//   • Envia link pro WhatsApp via botão no Telegram
//   • Aceita CPF COM e SEM formatação
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

// Retorna as duas variantes de CPF: com pontos/traço e sem
function variantesCPF(cpfLimpo) {
  if (cpfLimpo.length !== 11) return [cpfLimpo];
  var formatado = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return [cpfLimpo, formatado];
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const cpfDigitado = (body.identificador || '').trim();

    if (!cpfDigitado) {
      return jsonResp({ error: 'Informe seu CPF.' }, 400);
    }

    const cpfLimpo = cpfDigitado.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF precisa ter 11 dígitos.' }, 400);
    }

    // ---------- MONTA VARIANTES ----------
    var valores = variantesCPF(cpfLimpo);
    var filtros = [];
    valores.forEach(function(v) {
      var enc = encodeURIComponent(v);
      filtros.push('cpf.eq.' + enc);
    });
    var filtro = 'or=(' + filtros.join(',') + ')';

    // ---------- BUSCA CUIDADORA ----------
    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,nome,whatsapp,cpf,auth_user_id&' + filtro + '&limit=1';
    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });

    const respostaPadrao = {
      ok: true,
      mensagem: 'Se esse CPF estiver cadastrado, você vai receber o link de recuperação no WhatsApp em alguns instantes.'
    };

    if (!buscaResp.ok) {
      console.error('Erro busca esqueci-senha:', await buscaResp.text());
      return jsonResp(respostaPadrao, 200);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      return jsonResp(respostaPadrao, 200);
    }

    const cuidadora = linhas[0];

    if (!cuidadora.auth_user_id) {
      await notificarTelegramSemConta(env, cuidadora);
      return jsonResp(respostaPadrao, 200);
    }

    // ---------- GERA TOKEN (24h) ----------
    const token = gerarToken();
    const expiraEm = new Date();
    expiraEm.setHours(expiraEm.getHours() + 24);

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

    // ---------- TELEGRAM ----------
    await notificarTelegramComBotao(env, cuidadora, token, expiraEm);

    return jsonResp(respostaPadrao, 200);

  } catch (err) {
    console.error('Erro esqueci-senha:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

// ============================================================
// TELEGRAM — com botão de WhatsApp
// ============================================================
async function notificarTelegramComBotao(env, cuidadora, token, expiraEm) {
  try {
    const tgToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!tgToken || !chatId) {
      console.error('❌ Telegram não configurado');
      return;
    }

    const linkReset = 'https://afetocuidadores.pages.dev/painel-reset.html?token=' + token;

    const primeiroNome = (cuidadora.nome || '').trim().split(/\s+/)[0] || '';
    const saudacao = primeiroNome ? 'Oi, ' + primeiroNome + '! 💜' : 'Oi! 💜';

    const mensagemWpp =
      saudacao + '\n\n' +
      'Recebi seu pedido de recuperação de senha da Afeto.\n\n' +
      'Clique neste link pra criar uma nova senha (válido por 24 horas):\n\n' +
      linkReset + '\n\n' +
      'Se você não pediu isso, é só ignorar esta mensagem.';

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
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    const msgHtml =
      '🔐 <b>Pedido de recuperação de senha</b>\n\n' +
      '👤 <b>Nome:</b> ' + escaparHTML(cuidadora.nome || '—') + '\n' +
      '📱 <b>WhatsApp:</b> ' + escaparHTML(cuidadora.whatsapp || '—') + '\n' +
      '🆔 <b>CPF:</b> ' + escaparHTML(cuidadora.cpf || '—') + '\n\n' +
      '⏰ Link válido até <b>' + expiraFmt + '</b>\n\n' +
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
// TELEGRAM — cadastro sem conta
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