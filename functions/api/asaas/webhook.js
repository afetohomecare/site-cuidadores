// ============================================================
// AFETO — Webhook do Asaas
// ------------------------------------------------------------
// 🛡️ BLINDAGENS:
//   • Sem gerenciamento de token (conta já foi criada no cadastro)
//   • Trata inadimplência, estorno e chargeback
// ============================================================

import { idSeguro } from '../../_lib/auth.js';
import { dataValidadePlano } from '../../_lib/planos.js';

function getWebhookToken(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  if (ambiente === 'sandbox') {
    return env.ASAAS_WEBHOOK_TOKEN_SANDBOX || env.ASAAS_WEBHOOK_TOKEN;
  }
  return env.ASAAS_WEBHOOK_TOKEN_PRODUCAO || env.ASAAS_WEBHOOK_TOKEN;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const tokenEsperado = getWebhookToken(env);
    const tokenRecebido = request.headers.get('asaas-access-token');

    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
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
      const cuidadorId = idSeguro(payment.externalReference);
      if (cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify({ status_pagamento: 'Inadimplente' })
        });

        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          await notificarTelegram(env, '⚠️ *Assinatura Vencida/Atrasada!*\n\nCuidadora ID `' + cuidadorId + '` não pagou.');
        }
      }
      return jsonResp({ received: true }, 200);
    }

    // ============================================================
    // ESTORNO / CHARGEBACK
    // ============================================================
    if (evento === 'PAYMENT_REFUNDED' || evento === 'PAYMENT_CHARGEBACK_REQUESTED' || evento === 'PAYMENT_CHARGEBACK_DISPUTE') {
      const cuidadorId = idSeguro(payment.externalReference);
      if (cuidadorId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify({
            status_pagamento: 'Estornado',
            plano_valido_ate: new Date().toISOString()
          })
        });

        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          await notificarTelegram(env, '🔄 *' + evento + '*\n\nCuidadora ID `' + cuidadorId + '` teve pagamento estornado.');
        }
      }
      return jsonResp({ received: true }, 200);
    }

    // ============================================================
    // PAGAMENTO CONFIRMADO
    // ============================================================
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      const cuidadorId = idSeguro(payment.externalReference);

      if (!cuidadorId || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
        return jsonResp({ received: true }, 200);
      }

      let cuidador = null;
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
          '&select=cupom_usado,plano_cadastro,plano_profissional,plano_destaque,plano_valido_ate&limit=1',
          { headers: headersSupabase(env) }
        );
        if (cResp.ok) {
          const linhas = await cResp.json();
          cuidador = linhas && linhas[0];
        }
      } catch (err) {
        console.warn('Erro ao ler cuidador:', err);
      }

      let planoDetectado = 'cadastro';
      if (cuidador) {
        if (cuidador.plano_cadastro) planoDetectado = 'cadastro';
        else if (cuidador.plano_destaque) planoDetectado = 'destaque';
        else if (cuidador.plano_profissional) planoDetectado = 'profissional';
      }

      const agora = new Date();
      const nParcela = parseInt(payment.installmentNumber, 10);
      const ehParcelaSeguinte = !!(payment.installment && nParcela > 1);

      const patchBody = {
        status_pagamento: 'Pago'
      };

      if (!ehParcelaSeguinte) {
        const vence = dataValidadePlano(planoDetectado, agora);
        patchBody.plano_inicio = agora.toISOString();
        patchBody.plano_valido_ate = vence.toISOString();
        patchBody.proxima_cobranca = vence.toISOString();
      }

      if (payment.subscription) {
        patchBody.asaas_subscription_id = String(payment.subscription);
      }

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(patchBody)
      });

      // Registra cupom
      try {
        if (cuidador && cuidador.cupom_usado) {
          const cupomResp = await fetch(
            env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(cuidador.cupom_usado) + '&limit=1',
            { headers: headersSupabase(env) }
          );
          const cupons = await cupomResp.json();
          const cupom = cupons && cupons[0];

          if (cupom) {
            const jaUsado = await fetch(
              env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + encodeURIComponent(cupom.id) + '&cuidador_id=eq.' + encodeURIComponent(cuidadorId) + '&limit=1',
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

              await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + encodeURIComponent(cupom.id), {
                method: 'PATCH',
                headers: headersSupabase(env, true, false),
                body: JSON.stringify({ usos_atuais: (cupom.usos_atuais || 0) + 1 })
              });
            }
          }
        }
      } catch (err) { console.warn('Erro cupom webhook:', err); }

      // Telegram
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const ambienteLabel = (env.ASAAS_AMBIENTE || 'producao').toLowerCase() === 'sandbox'
          ? '🧪 SANDBOX' : '💰 PRODUÇÃO';
        const isSubscription = payment.subscription ? '♻️ Assinatura' : '💰 Pagamento';
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? 'R$ ' + payment.value.toFixed(2).replace('.', ',') : '';

        const mensagem = '[' + ambienteLabel + '] ' + isSubscription + ' *recebida!*\n\n' + forma + ' — ' + valor + '\n\n' +
          'Plano: *' + planoDetectado + '*\n' +
          'ID: `' + cuidadorId + '`\n\n' +
          '✅ Pago\n' +
          '✅ Válido até ' + vence.toLocaleDateString('pt-BR');

        await notificarTelegram(env, mensagem);
      }
    }

    return jsonResp({ received: true }, 200);

  } catch (err) {
    console.error('❌ Erro webhook:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestGet() {
  return jsonResp({ ok: true, message: 'Webhook ativo.' }, 200);
}

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