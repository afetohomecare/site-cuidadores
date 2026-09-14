// ============================================================
// AFETO — Webhook do Asaas
// Ao confirmar pagamento: atualiza cuidador + registra cupom
//
// Planos:
//   cadastro     → +365 dias
//   profissional → +30 dias
//   destaque     → +30 dias
// ============================================================

function diasDoPlano(plano) {
  if (plano === 'cadastro') return 365;
  return 30;
}

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

      // Lê dados do cuidador pra saber qual plano ele tem
      let cuidador = null;
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId +
          '&select=cupom_usado,plano_cadastro,plano_profissional,plano_destaque&limit=1',
          { headers: headersSupabase(env) }
        );
        if (cResp.ok) {
          const linhas = await cResp.json();
          cuidador = linhas && linhas[0];
        }
      } catch (err) {
        console.warn('Erro ao ler cuidador no webhook:', err);
      }

      // Decide o plano pra calcular os dias
      let planoDetectado = 'profissional';
      if (cuidador) {
        if (cuidador.plano_cadastro) planoDetectado = 'cadastro';
        else if (cuidador.plano_destaque) planoDetectado = 'destaque';
        else if (cuidador.plano_profissional) planoDetectado = 'profissional';
      }

      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(planoDetectado));

      // 1. Atualiza cuidador
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          status_pagamento: 'Pago',
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString()
        })
      });

      // 2. Registra uso de cupom, se houver e ainda não foi registrado
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

            if (!usos || usos.length === 0) {
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
        const forma = payment.billingType === 'PIX' ? '💠 Pix' : '💳 Cartão';
        const valor = payment.value ? 'R$ ' + payment.value.toFixed(2).replace('.', ',') : '';

        const mensagem = '💰 *Pagamento recebido!*\n\n' + forma + ' — ' + valor + '\n\n' +
          'Plano: *' + planoDetectado + '*\n' +
          'ID Supabase: `' + cuidadorId + '`\n\n' +
          '✅ Status: Pago\n' +
          '✅ Válido até ' + vence.toLocaleDateString('pt-BR') + '\n\n' +
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