// functions/api/asaas/webhook.js
// Recebe eventos do Asaas e atualiza StatusPagamento no Airtable

const AIRTABLE_BASE = 'apphAWeT91l1dMWM5';
const AIRTABLE_TABLE = 'Cuidadores';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const evento = body.event;
    const payment = body.payment;

    console.log('📩 Webhook Asaas:', evento, payment?.id);

    // Só processa pagamento confirmado
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const recordIdAirtable = payment.externalReference;

      if (!recordIdAirtable) {
        console.warn('Webhook sem externalReference');
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }

      // Atualiza StatusPagamento no Airtable
      const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordIdAirtable}`;

      const updateResp = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            StatusPagamento: 'Pago'
          }
        })
      });

      if (updateResp.ok) {
        console.log(`✅ Airtable ${recordIdAirtable} → StatusPagamento: Pago`);
      } else {
        console.error('Erro Airtable:', await updateResp.text());
      }

      // Notifica Telegram
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? `R$ ${payment.value}` : '';

        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `💰 *Pagamento recebido!*\n\n${forma} — ${valor}\n\nID Airtable: \`${recordIdAirtable}\`\n\n✅ StatusPagamento atualizado automaticamente.\n\n👉 Falta marcar *Aprovada* pra liberar o perfil.`,
            parse_mode: 'Markdown'
          })
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Erro webhook:', err);
    return new Response(JSON.stringify({ error: String(err.message) }), { status: 500 });
  }
}

// Responde GET também (pra teste manual)
export async function onRequestGet() {
  return new Response(JSON.stringify({ 
    ok: true, 
    message: 'Webhook Asaas ativo. Use POST pra receber eventos.' 
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}