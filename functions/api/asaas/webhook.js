// ============================================================
// AFETO — Webhook do Asaas
// Ao confirmar pagamento: status_pagamento='Pago' + vencimento +30d
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const tokenEsperado = env.ASAAS_WEBHOOK_TOKEN;
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

    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const cuidadorId = payment.externalReference;

      if (!cuidadorId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return new Response(JSON.stringify({ received: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }

      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + 30);

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
          status_pagamento: 'Pago',
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString()
        })
      });

      if (updateResp.ok) {
        console.log('✅ Supabase ' + cuidadorId + ' → Pago até ' + vence.toISOString());
      } else {
        console.error('❌ Erro Supabase:', await updateResp.text());
      }

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? 'R$ ' + payment.value.toFixed(2).replace('.', ',') : '';

        const mensagem = '💰 *Pagamento recebido!*\n\n' + forma + ' — ' + valor + '\n\n' +
          'ID Supabase: `' + cuidadorId + '`\n\n' +
          '✅ status_pagamento = Pago\n' +
          '✅ Plano válido até ' + vence.toLocaleDateString('pt-BR') + '\n\n' +
          '👉 Falta marcar *aprovada = true* no painel.';

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
        } catch (errTelegram) { console.error('Telegram:', errTelegram); }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('❌ Erro webhook:', err);
    return new Response(JSON.stringify({ error: String(err.message) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: 'Webhook ativo.' }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}