// Notifica contato só a partir de um perfil existente na vitrine.

import { jsonResp } from './_lib/http.js';
import { headersSupabase, supabaseOk } from './_lib/supabase.js';
import { ehUuid, filtroPerfilPorRef, refPerfilSegura } from './_lib/slug.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResp({ error: 'Método não permitido' }, 405);
  }

  const env = context.env;
  if (!supabaseOk(env)) {
    return jsonResp({ ok: false }, 200);
  }

  try {
    const dados = await context.request.json();
    const ref = refPerfilSegura(dados.ref || dados.id);
    if (!ref) {
      return jsonResp({ ok: false, motivo: 'ref_invalida' }, 400);
    }

    const hoje = new Date().toISOString();
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + filtroPerfilPorRef(ref) +
      '&aprovada=eq.true&status_pagamento=eq.Pago&plano_valido_ate=gte.' + hoje +
      '&select=id,nome,bairro,especialidade&limit=1',
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) {
      if (!ehUuid(ref)) return jsonResp({ ok: false, motivo: 'nao_encontrada' }, 404);
      return jsonResp({ ok: false }, 200);
    }
    const linhas = await resp.json();
    const c = linhas && linhas[0];
    if (!c) return jsonResp({ ok: false, motivo: 'nao_encontrada' }, 404);

    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return jsonResp({ ok: true }, 200);
    }

    const agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const mensagem =
      '*Novo contato na Afeto*\n\n' +
      'Cuidadora: ' + (c.nome || '') + '\n' +
      'Bairro: ' + (c.bairro || 'Curitiba') + '\n' +
      'Especialidade: ' + (c.especialidade || '—') + '\n' +
      'Ref: #' + c.id + '\n' +
      'Quando: ' + agora;

    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensagem,
        disable_web_page_preview: true
      })
    });

    return jsonResp({ ok: true }, 200);
  } catch (err) {
    console.error('Erro notificar-contato:', err);
    return jsonResp({ ok: false }, 200);
  }
}
