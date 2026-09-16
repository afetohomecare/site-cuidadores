// ============================================================
// AFETO — Webhook do Asaas
// ------------------------------------------------------------
// Ao confirmar pagamento ou renovar assinatura: atualiza cuidador
// + registra cupom + gera token temporário pra criar senha.
//
// 🌍 AMBIENTE: usa ASAAS_WEBHOOK_TOKEN (único pros dois ambientes)
//    ou, se preferir separar depois, aceita também
//    ASAAS_WEBHOOK_TOKEN_SANDBOX e ASAAS_WEBHOOK_TOKEN_PRODUCAO
// ============================================================

function getWebhookToken(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  if (ambiente === 'sandbox') {
    return env.ASAAS_WEBHOOK_TOKEN_SANDBOX || env.ASAAS_WEBHOOK_TOKEN;
  }
  return env.ASAAS_WEBHOOK_TOKEN_PRODUCAO || env.ASAAS_WEBHOOK_TOKEN;
}

function diasDoPlano(plano) {
  return 30;
}

function gerarToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const tokenEsperado = getWebhookToken(env);
    const tokenRecebido = request.headers.get('asaas-access-token');

    if (tokenEsperado && tokenRecebido !== tokenEsperado) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const evento = body.event;
    const payment = body.payment;

    console.log('📩 Webhook Asaas:', evento, payment && payment.id);

    // ============================================================
    // INADIMPLÊNCIA
    // ============================================================
    if (evento === 'PAYMENT_OVERDUE') {
      const cuidadorId = payment.externalReference;

      if (cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify({
            status_pagamento: 'Inadimplente'
          })
        });

        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          await notificarTelegram(env, '⚠️ *Assinatura Vencida/Atrasada!*\n\nA cuidadora de ID `' + cuidadorId + '` não realizou o pagamento. O perfil dela ficará oculto/pendente até a regularização.');
        }
      }
      return jsonResp({ received: true }, 200);
    }

    // ============================================================
    // PAGAMENTO CONFIRMADO
    // ============================================================
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const cuidadorId = payment.externalReference;

      if (!cuidadorId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return jsonResp({ received: true }, 200);
      }

      let cuidador = null;
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId +
          '&select=cupom_usado,plano_cadastro,plano_profissional,plano_destaque,auth_user_id&limit=1',
          { headers: headersSupabase(env) }
        );
        if (cResp.ok) {
          const linhas = await cResp.json();
          cuidador = linhas && linhas[0];
        }
      } catch (err) {
        console.warn('Erro ao ler cuidador no webhook:', err);
      }

      let planoDetectado = 'profissional';
      if (cuidador) {
        if (cuidador.plano_cadastro) planoDetectado = 'cadastro';
        else if (cuidador.plano_destaque) planoDetectado = 'destaque';
        else if (cuidador.plano_profissional) planoDetectado = 'profissional';
      }

      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(planoDetectado));

      const patchBody = {
        status_pagamento: 'Pago',
        plano_inicio: agora.toISOString(),
        plano_valido_ate: vence.toISOString(),
        proxima_cobranca: vence.toISOString()
      };

      // Se for a primeira compra, gera token de criar senha
      if (!cuidador || !cuidador.auth_user_id) {
        const token = gerarToken();
        const expira = new Date(agora);
        expira.setHours(expira.getHours() + 1);

        patchBody.token_criar_senha = token;
        patchBody.token_criar_senha_expira_em = expira.toISOString();

        console.log('🔐 Token gerado pra cuidadora:', cuidadorId, token);
      } else {
        console.log('♻️ Assinatura/Plano renovado para cuidadora:', cuidadorId);
      }

      // 1. Atualiza cuidador
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(patchBody)
      });

      // 2. Registra uso de cupom
      try {
        if (cuidador && cuidador.cupom_usado) {
          const cupomResp = await fetch(
            env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' +
            encodeURIComponent(cuidador.cupom_usado) + '&limit=1',
            { headers: headersSupabase(env) }
          );
          const cupons = await cupomResp.json();
          const cupom = cupons && cupons[0];

          if (cupom) {
            const jaUsado = await fetch(
              env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + cupom.id +
              '&cuidador_id=eq.' + cuidadorId + '&limit=1',
              { headers: headersSupabase(env) }
            );
            const usos = await jaUsado.json();

            if (!usos || usos.length === 0 || !usos.find(u => u.asaas_pagamento_id === payment.id)) {
              await fetch(env.SUPABASE_URL + '/rest/v1/cupons_usos', {
                method: 'POST',
                headers: headersSupabase(env, true, false),
                body: JSON.stringify({
                  cupom_id: cupom.id,
                  cupom_codigo: cupom.codigo,
                  cuidador_id: cuidadorId,
                  plano: planoDetectado,
                  valor_original: payment.value,
                  valor_desconto: 0,
                  valor_final: payment.value,
                  asaas_pagamento_id: payment.id
                })
              });

              await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + cupom.id, {
                method: 'PATCH',
                headers: headersSupabase(env, true, false),
                body: JSON.stringify({ usos_atuais: (cupom.usos_atuais || 0) + 1 })
              });
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao registrar uso do cupom via webhook:', err);
      }

      // 3. Telegram
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const ambienteLabel = (env.ASAAS_AMBIENTE || 'producao').toLowerCase() === 'sandbox'
          ? '🧪 SANDBOX'
          : '💰 PRODUÇÃO';
        const isSubscription = payment.subscription ? '♻️ Assinatura/Mensalidade' : '💰 Pagamento Avulso';
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? 'R$ ' + payment.value.toFixed(2).replace('.', ',') : '';

        const mensagem = '[' + ambienteLabel + '] ' + isSubscription + ' *recebida!*\n\n' + forma + ' — ' + valor + '\n\n' +
          'Plano: *' + planoDetectado + '*\n' +
          'ID Supabase: `' + cuidadorId + '`\n\n' +
          '✅ Status: Pago\n' +
          '✅ Válido até ' + vence.toLocaleDateString('pt-BR');

        await notificarTelegram(env, mensagem);
      }
    }

    return jsonResp({ received: true }, 200);

  } catch (err) {
    console.error('❌ Erro webhook:', err);
    return jsonResp({ error: String(err.message) }, 500);
  }
}

export async function onRequestGet() {
  return jsonResp({ ok: true, message: 'Webhook ativo.' }, 200);
}

// ============================================================
// HELPERS
// ============================================================

function headersSupabase(env, temBody, querRetorno) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  if (querRetorno) h['Prefer'] = 'return=representation';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function notificarTelegram(env, texto) {
  try {
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) { console.error('Telegram Erro:', err); }
}