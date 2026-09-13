// functions/api/asaas/webhook.js
// Recebe eventos do Asaas e atualiza StatusPagamento no Airtable
// Versão: 2026-09-13 com validação de token

const AIRTABLE_BASE = 'apphAWeT91l1dMWM5';
const AIRTABLE_TABLE = 'Cuidadores';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // ========== 1. VALIDA TOKEN DO WEBHOOK ==========
    const tokenEsperado = env.ASAAS_WEBHOOK_TOKEN;
    const tokenRecebido = request.headers.get('asaas-access-token');

    if (tokenEsperado && tokenRecebido !== tokenEsperado) {
      console.warn('❌ Token inválido recebido:', tokenRecebido);
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ========== 2. LÊ O PAYLOAD ==========
    const body = await request.json();
    const evento = body.event;
    const payment = body.payment;

    console.log('📩 Webhook Asaas:', evento, payment?.id);

    // ========== 3. PROCESSA PAGAMENTO CONFIRMADO ==========
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const recordIdAirtable = payment.externalReference;

      if (!recordIdAirtable) {
        console.warn('⚠️ Webhook sem externalReference');
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
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
        const erro = await updateResp.text();
        console.error('❌ Erro Airtable:', erro);
      }

      // ========== 4. NOTIFICA TELEGRAM ==========
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? `R$ ${payment.value.toFixed(2).replace('.', ',')}` : '';

        const mensagem = `💰 *Pagamento recebido!*\n\n` +
          `${forma} — ${valor}\n\n` +
          `ID Airtable: \`${recordIdAirtable}\`\n\n` +
          `✅ StatusPagamento atualizado automaticamente.\n\n` +
          `👉 Falta marcar *Aprovada* pra liberar o perfil.`;

        try {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
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

    // ========== 5. RETORNA OK (sempre 200 pro Asaas não reenviar) ==========
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

// Responde GET também (pra teste manual pelo navegador)
export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    message: 'Webhook Asaas ativo. Use POST pra receber eventos.'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}