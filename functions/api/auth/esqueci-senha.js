// ============================================================
// VERSÃO DE DEBUG — retorna diagnóstico completo no JSON
// DEPOIS DE RESOLVER, VOLTE PRA VERSÃO DE PRODUÇÃO
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
  const debug = { etapas: [] };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração Supabase ausente.', debug }, 500);
  }

  debug.etapas.push('1. Supabase configurado');

  try {
    const body = await request.json();
    const identificador = (body.identificador || '').trim();
    debug.identificador_recebido = identificador;

    if (!identificador) return jsonResp({ error: 'Informe CPF/WhatsApp.', debug }, 400);

    const idLimpo = identificador.replace(/\D/g, '');
    debug.id_limpo = idLimpo;

    if (idLimpo.length < 10 || idLimpo.length > 11) {
      return jsonResp({ error: 'CPF/WhatsApp inválido.', debug }, 400);
    }

    // ---------- BUSCA CUIDADORA ----------
    const filtro = 'or=(' +
      'cpf.eq.' + encodeURIComponent(idLimpo) + ',' +
      'cpf.eq.' + encodeURIComponent(identificador) + ',' +
      'whatsapp.eq.' + encodeURIComponent(identificador) + ',' +
      'whatsapp.eq.' + encodeURIComponent(idLimpo) +
    ')';

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,nome,whatsapp,cpf,auth_user_id&' + filtro + '&limit=1';
    debug.busca_url = buscaUrl;

    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });
    debug.busca_status = buscaResp.status;

    if (!buscaResp.ok) {
      const txt = await buscaResp.text();
      debug.busca_erro = txt.substring(0, 400);
      return jsonResp({ error: 'Falha ao consultar banco.', debug }, 502);
    }

    const linhas = await buscaResp.json();
    debug.cuidadoras_encontradas = linhas.length;

    if (!linhas || linhas.length === 0) {
      debug.motivo = 'NAO_ENCONTRADA';
      return jsonResp({
        ok: true,
        debug,
        mensagem: 'Se esse CPF estiver cadastrado, vai receber o link.'
      }, 200);
    }

    const cuidadora = linhas[0];
    debug.cuidadora_id = cuidadora.id;
    debug.cuidadora_nome = cuidadora.nome;
    debug.tem_auth_user_id = !!cuidadora.auth_user_id;
    debug.auth_user_id = cuidadora.auth_user_id ? cuidadora.auth_user_id.substring(0, 8) + '...' : null;

    if (!cuidadora.auth_user_id) {
      debug.motivo = 'SEM_CONTA_CRIADA';
      return jsonResp({
        ok: true,
        debug,
        mensagem: 'Se esse CPF estiver cadastrado, vai receber o link.'
      }, 200);
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

    debug.patch_token_status = patchResp.status;

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      debug.patch_token_erro = txt.substring(0, 400);
      debug.motivo = 'FALHA_SALVAR_TOKEN';
      debug.dica = 'Provavelmente as colunas token_reset_senha NAO existem. Rode o SQL.';
      return jsonResp({ ok: true, debug }, 200);
    }

    debug.etapas.push('2. Token salvo no banco');
    debug.token_gerado = token.substring(0, 8) + '...';

    // ---------- TELEGRAM ----------
    debug.tem_telegram_token = !!env.TELEGRAM_BOT_TOKEN;
    debug.tem_telegram_chat = !!env.TELEGRAM_CHAT_ID;
    debug.telegram_token_inicio = env.TELEGRAM_BOT_TOKEN ? env.TELEGRAM_BOT_TOKEN.substring(0, 10) + '...' : null;

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      debug.motivo = 'TELEGRAM_NAO_CONFIGURADO';
      return jsonResp({ ok: true, debug }, 200);
    }

    debug.etapas.push('3. Env vars Telegram OK');

    // Monta mensagem
    const linkReset = 'https://afetocuidadores.pages.dev/painel-reset.html?token=' + token;
    const primeiroNome = (cuidadora.nome || '').trim().split(/\s+/)[0] || '';
    const saudacao = primeiroNome ? 'Oi, ' + primeiroNome + '! 💜' : 'Oi! 💜';

    const mensagemWpp = saudacao + '\n\n' +
      'Recebi seu pedido de recuperação de senha da Afeto.\n\n' +
      'Clique neste link pra criar uma nova senha (válido por 30 minutos):\n\n' +
      linkReset + '\n\n' +
      'Se você não pediu isso, é só ignorar.';

    const numeroLimpo = (cuidadora.whatsapp || '').replace(/\D/g, '');
    let numeroCompleto = numeroLimpo;
    if (numeroLimpo.length === 10 || numeroLimpo.length === 11) {
      numeroCompleto = '55' + numeroLimpo;
    }

    const waUrl = 'https://wa.me/' + numeroCompleto + '?text=' + encodeURIComponent(mensagemWpp);
    debug.whatsapp_numero = numeroCompleto;

    const msgHtml =
      '🔐 <b>Pedido de recuperação de senha</b>\n\n' +
      '👤 <b>Nome:</b> ' + escaparHTML(cuidadora.nome || '—') + '\n' +
      '📱 <b>WhatsApp:</b> ' + escaparHTML(cuidadora.whatsapp || '—') + '\n' +
      '🆔 <b>CPF:</b> ' + escaparHTML(cuidadora.cpf || '—') + '\n\n' +
      '👇 Clique no botão abaixo pra enviar o link no WhatsApp dela:';

    const telegramPayload = {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: msgHtml,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: '📲 Enviar link no WhatsApp', url: waUrl }
        ]]
      }
    };

    debug.telegram_chat_id_usado = String(env.TELEGRAM_CHAT_ID);

    const tgResp = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramPayload)
    });

    debug.telegram_status_http = tgResp.status;
    const tgData = await tgResp.json().catch(function() { return {}; });
    debug.telegram_resposta = tgData;

    if (!tgResp.ok || !tgData.ok) {
      debug.motivo = 'TELEGRAM_ERRO';
      return jsonResp({ ok: true, debug }, 200);
    }

    debug.etapas.push('4. Telegram enviado com sucesso');
    debug.motivo = 'SUCESSO';

    return jsonResp({
      ok: true,
      debug,
      mensagem: 'Se esse CPF estiver cadastrado, você vai receber o link no WhatsApp em alguns instantes.'
    }, 200);

  } catch (err) {
    debug.motivo = 'EXCECAO';
    debug.erro = String(err && err.message ? err.message : err);
    debug.stack = String(err && err.stack ? err.stack : '').substring(0, 500);
    return jsonResp({ error: 'Falha no processamento.', debug }, 500);
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