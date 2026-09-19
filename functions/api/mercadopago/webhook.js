import { idSeguro } from '../../_lib/auth.js';
import { dataValidadePlano, planoDaCuidadora, pagamentoEhDestaqueExtra } from '../../_lib/planos.js';
import { jsonResp } from '../../_lib/http.js';
import { headersSupabase, supabaseOk } from '../../_lib/supabase.js';
import { patchCuidador } from '../../_lib/pagamento.js';
import {
  buscarPagamentoMp,
  buscarPreapprovalMp,
  buscarMerchantOrderMp,
  validarAssinaturaMp
} from '../../_lib/mercadopago.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const id = url.searchParams.get('data.id') || url.searchParams.get('id') || '';
  if (tipo && id) {
    await processarNotificacao(env, request, tipo, id);
  }
  return jsonResp({ ok: true, message: 'Webhook Mercado Pago ativo.' }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    let tipo = url.searchParams.get('type') || url.searchParams.get('topic') || '';
    let id = url.searchParams.get('data.id') || url.searchParams.get('id') || '';

    const body = await request.json().catch(function () { return {}; });
    if (!tipo) tipo = body.type || body.topic || '';
    if (!id) {
      id = (body.data && (body.data.id || body.data.ID)) || body.id || '';
    }
    id = String(id || '');

    if (!tipo || !id) {
      return jsonResp({ received: true }, 200);
    }

    const ok = await processarNotificacao(env, request, tipo, id);
    if (ok === false) {
      return jsonResp({ error: 'Assinatura inválida' }, 401);
    }
    return jsonResp({ received: true }, 200);
  } catch (err) {
    console.error('Erro webhook Mercado Pago:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

async function processarNotificacao(env, request, tipo, id) {
  const tipoNorm = String(tipo || '').toLowerCase();
  const valido = await validarAssinaturaMp(request, env, id);
  if (!valido) {
    console.warn('Webhook MP com assinatura inválida');
    return false;
  }

  if (tipoNorm === 'payment' || tipoNorm.indexOf('payment') !== -1) {
    await processarPagamento(env, id);
    return true;
  }

  if (tipoNorm === 'merchant_order' || tipoNorm === 'topic_merchant_order_wh') {
    const order = await buscarMerchantOrderMp(env, id);
    const pagamentos = (order && order.payments) || [];
    for (let i = 0; i < pagamentos.length; i++) {
      const pid = pagamentos[i] && (pagamentos[i].id || pagamentos[i].payment_id);
      if (pid) await processarPagamento(env, pid);
    }
    return true;
  }

  if (tipoNorm === 'subscription_authorized_payment') {
    await processarPagamento(env, id);
    return true;
  }

  if (tipoNorm === 'subscription_preapproval' || tipoNorm === 'preapproval') {
    await processarPreapproval(env, id);
    return true;
  }

  return true;
}

async function processarPagamento(env, paymentId) {
  const payment = await buscarPagamentoMp(env, paymentId);
  if (!payment) return;

  const cuidadorId = idSeguro(
    payment.external_reference ||
    (payment.metadata && (payment.metadata.cuidador_id || payment.metadata.cuidadorId))
  );
  if (!cuidadorId || !supabaseOk(env)) return;

  const extraDestaque = mpEhDestaqueExtra(payment);
  const status = String(payment.status || '').toLowerCase();
  if (status === 'refunded' || status === 'charged_back') {
    if (extraDestaque) {
      await patchCuidador(env, cuidadorId, { plano_destaque: false, mp_payment_id: String(payment.id) });
      await notificarTelegram(env, '🔄 *Estorno Mercado Pago*\n\nDestaque extra da cuidadora `' + cuidadorId + '`');
    } else {
      await patchCuidador(env, cuidadorId, {
        status_pagamento: 'Estornado',
        plano_valido_ate: new Date().toISOString(),
        mp_payment_id: String(payment.id)
      });
      await notificarTelegram(env, '🔄 *Estorno Mercado Pago*\n\nCuidadora ID `' + cuidadorId + '`');
    }
    return;
  }

  if (status !== 'approved') return;

  if (extraDestaque) {
    await patchCuidador(env, cuidadorId, { plano_destaque: true, mp_payment_id: String(payment.id) });
    await notificarTelegram(env, '[Mercado Pago] 💎 *Destaque extra* aprovado\n\nID: `' + cuidadorId + '`');
    return;
  }

  const cuidador = await lerCuidador(env, cuidadorId);
  const plano = planoDaCuidadora(cuidador);
  const agora = new Date();
  const jaAtivo = cuidador && cuidador.status_pagamento === 'Pago' && cuidador.plano_valido_ate &&
    new Date(cuidador.plano_valido_ate).getTime() > Date.now();
  const base = jaAtivo ? new Date(cuidador.plano_valido_ate) : agora;
  const vence = dataValidadePlano(plano, base);

  const patchBody = {
    status_pagamento: 'Pago',
    plano_inicio: agora.toISOString(),
    plano_valido_ate: vence.toISOString(),
    proxima_cobranca: vence.toISOString(),
    mp_payment_id: String(payment.id)
  };
  if (cuidador && cuidador.cupom_usado) {
    await registrarCupomSePreciso(env, cuidador, cuidadorId, plano, payment);
  }
  await patchCuidador(env, cuidadorId, patchBody);

  const forma = String(payment.payment_method_id || '').toLowerCase() === 'pix' ? '💠 Pix' : '💳 Cartão';
  const valor = payment.transaction_amount
    ? 'R$ ' + Number(payment.transaction_amount).toFixed(2).replace('.', ',')
    : '';
  await notificarTelegram(
    env,
    '[Mercado Pago] 💰 Pagamento *aprovado!*\n\n' + forma + ' — ' + valor +
    '\nPlano: *' + plano + '*\nID: `' + cuidadorId +
    '`\n✅ Válido até ' + vence.toLocaleDateString('pt-BR')
  );
}

async function processarPreapproval(env, preapprovalId) {
  const sub = await buscarPreapprovalMp(env, preapprovalId);
  if (!sub) return;
  const cuidadorId = idSeguro(sub.external_reference || (sub.metadata && sub.metadata.cuidador_id));
  if (!cuidadorId || !supabaseOk(env)) return;

  const extraDestaque = mpEhDestaqueExtra(sub);
  const status = String(sub.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'paused') {
    if (extraDestaque) {
      await patchCuidador(env, cuidadorId, { plano_destaque: false });
    } else {
      await patchCuidador(env, cuidadorId, { mp_preapproval_id: null });
    }
    return;
  }
  if (status !== 'authorized' && status !== 'active') return;

  if (extraDestaque) {
    await patchCuidador(env, cuidadorId, { plano_destaque: true });
    return;
  }

  const cuidador = await lerCuidador(env, cuidadorId);
  const plano = planoDaCuidadora(cuidador);
  const agora = new Date();
  const vence = dataValidadePlano(plano, agora);
  await patchCuidador(env, cuidadorId, {
    status_pagamento: 'Pago',
    plano_inicio: agora.toISOString(),
    plano_valido_ate: vence.toISOString(),
    proxima_cobranca: vence.toISOString(),
    mp_preapproval_id: String(sub.id)
  });
}

async function lerCuidador(env, cuidadorId) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=cupom_usado,plano_cadastro,plano_profissional,plano_destaque,plano_valido_ate,status_pagamento&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return null;
    const linhas = await resp.json();
    return linhas && linhas[0] ? linhas[0] : null;
  } catch (e) {
    return null;
  }
}

async function registrarCupomSePreciso(env, cuidador, cuidadorId, plano, payment) {
  try {
    const cupomResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(cuidador.cupom_usado) + '&limit=1',
      { headers: headersSupabase(env) }
    );
    const cupons = await cupomResp.json();
    const cupom = cupons && cupons[0];
    if (!cupom) return;

    const jaUsado = await fetch(
      env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + encodeURIComponent(cupom.id) +
      '&cuidador_id=eq.' + encodeURIComponent(cuidadorId) + '&limit=1',
      { headers: headersSupabase(env) }
    );
    const usos = await jaUsado.json();
    const pid = String(payment.id);
    if (usos && usos.length && usos.find(function (u) {
      return String(u.asaas_pagamento_id || '') === pid;
    })) return;

    await fetch(env.SUPABASE_URL + '/rest/v1/cupons_usos', {
      method: 'POST',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        cupom_id: cupom.id,
        cupom_codigo: cupom.codigo,
        cuidador_id: cuidadorId,
        plano: plano,
        valor_original: payment.transaction_amount,
        valor_desconto: 0,
        valor_final: payment.transaction_amount,
        asaas_pagamento_id: pid
      })
    });
    await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + encodeURIComponent(cupom.id), {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({ usos_atuais: (cupom.usos_atuais || 0) + 1 })
    });
  } catch (err) {
    console.warn('Erro cupom webhook MP:', err);
  }
}

function mpEhDestaqueExtra(obj) {
  const meta = (obj && obj.metadata) || {};
  const produto = String(meta.produto || meta.extra || '').toLowerCase();
  if (produto === 'destaque' || produto === 'destaque_extra') return true;
  return pagamentoEhDestaqueExtra({
    description: (obj && (obj.description || obj.reason || obj.title)) || '',
    items: obj && obj.additional_info && obj.additional_info.items
  });
}

async function notificarTelegram(env, texto) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
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
  } catch (err) {
    console.error('Telegram Erro:', err);
  }
}
