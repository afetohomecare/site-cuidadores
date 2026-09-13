// ============================================================
// AFETO — Webhook do Asaas
// ------------------------------------------------------------
// O Asaas chama essa URL quando o pagamento é confirmado.
// Aqui a gente:
//   1. Valida o token (header asaas-access-token)
//   2. Lê o evento (PAYMENT_RECEIVED / PAYMENT_CONFIRMED)
//   3. Atualiza status_pagamento = 'Pago' no Supabase
//   4. Notifica no Telegram
//
// O campo `externalReference` do Asaas carrega o UUID da
// cuidadora no Supabase (passado lá no checkout.js).
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // ---------- 1. VALIDA TOKEN ----------
    const tokenEsperado = env.ASAAS_WEBHOOK_TOKEN;
    const tokenRecebido = request.headers.get('asaas-access-token');

    if (tokenEsperado && tokenRecebido !== tokenEsperado) {
      console.warn('❌ Token inválido recebido:', tokenRecebido);
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ---------- 2. LÊ O PAYLOAD ----------
    const body = await request.json();
    const evento = body.event;
    const payment = body.payment;

    console.log('📩 Webhook Asaas:', evento, payment && payment.id);

    // ---------- 3. PROCESSA PAGAMENTO CONFIRMADO ----------
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const cuidadorId = payment.externalReference;

      if (!cuidadorId) {
        console.warn('⚠️ Webhook sem externalReference');
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        console.error('❌ Configuração do Supabase ausente');
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // ---------- 3a. ATUALIZA SUPABASE ----------
      const updateUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId;

      const updateResp = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          status_pagamento: 'Pago'
        })
      });

      if (updateResp.ok) {
        console.log('✅ Supabase ' + cuidadorId + ' → status_pagamento: Pago');
      } else {
        const erro = await updateResp.text();
        console.error('❌ Erro Supabase:', erro);
      }

      // ---------- 4. NOTIFICA TELEGRAM ----------
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? 'R$ ' + payment.value.toFixed(2).replace('.', ',') : '';

        const mensagem = '💰 *Pagamento recebido!*\n\n' +
          forma + ' — ' + valor + '\n\n' +
          'ID Supabase: `' + cuidadorId + '`\n\n' +
          '✅ status_pagamento atualizado automaticamente.\n\n' +
          '👉 Falta marcar *aprovada = true* pra liberar o perfil.';

        try {
          await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: mensagem,
              parse_mode: 'Markdown'
            })
          });
        } catch (errTelegram) {
          console.error('⚠️ Erro Telegram:', errTelegram);
        }
      }
    }

    // ---------- 5. RETORNA OK (sempre 200 pro Asaas não reenviar) ----------
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('❌ Erro webhook:', err);
    return new Response(JSON.stringify({ error: String(err.message) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Responde GET pra teste manual
export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    message: 'Webhook Asaas ativo. Use POST pra receber eventos.'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}