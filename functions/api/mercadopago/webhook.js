import { dataValidadePlano } from '../../_lib/planos.js';
import { jsonResp } from '../../_lib/http.js';
import { headersSupabase, supabaseOk } from '../../_lib/supabase.js';
import { patchCuidador } from '../../_lib/pagamento.js';
import { registrarUsoCupom } from '../../_lib/cupom.js';
import {
  atualizarOrdemMp,
  buscarOrdemMp,
  concluirEventoPagamentoMp,
  desfazerReservaEventoMp,
  emCentavos,
  reservarEventoPagamentoMp
} from '../../_lib/ordens-pagamento.js';
import {
  atualizarValorPreapprovalMp,
  buscarPagamentoAutorizadoMp,
  buscarPagamentoMp,
  buscarPreapprovalMp,
  buscarMerchantOrderMp,
  getMpConfig,
  validarAssinaturaMp
} from '../../_lib/mercadopago.js';

export async function onRequestGet() {
  return jsonResp({ ok: true, message: 'Webhook Mercado Pago ativo. Notificações somente por POST.' }, 200);
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

    if (!tipo || !id) return jsonResp({ error: 'Notificação incompleta' }, 400);

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

  if (tipoNorm === 'subscription_authorized_payment') {
    const fatura = await buscarPagamentoAutorizadoMp(env, id);
    if (!fatura) throw new Error('Não foi possível consultar a fatura da assinatura.');
    const paymentId = fatura && fatura.payment && fatura.payment.id;
    if (paymentId) await processarPagamento(env, paymentId);
    return true;
  }

  if (tipoNorm === 'payment' || tipoNorm === 'topic_payment_wh') {
    await processarPagamento(env, id);
    return true;
  }

  if (tipoNorm === 'merchant_order' || tipoNorm === 'topic_merchant_order_wh') {
    const order = await buscarMerchantOrderMp(env, id);
    if (!order) throw new Error('Não foi possível consultar a ordem do Mercado Pago.');
    const pagamentos = order.payments || [];
    for (let i = 0; i < pagamentos.length; i++) {
      const pid = pagamentos[i] && (pagamentos[i].id || pagamentos[i].payment_id);
      if (pid) await processarPagamento(env, pid);
    }
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
  if (!payment) throw new Error('Não foi possível consultar o pagamento no Mercado Pago.');

  const ordem = await buscarOrdemMp(env, String(payment.external_reference || ''));
  if (!ordem || !supabaseOk(env)) {
    if (payment.metadata && payment.metadata.ordem_id) {
      throw new Error('Não foi possível consultar a ordem interna do pagamento.');
    }
    console.warn('Pagamento MP sem ordem interna válida:', String(payment.id || ''));
    return;
  }

  const mp = getMpConfig(env);
  const ambienteCorreto = mp.isSandbox ? payment.live_mode !== true : payment.live_mode === true;
  const valorCentavos = emCentavos(payment.transaction_amount);
  const valorPermitido = ordem.tipo === 'assinatura'
    ? (valorCentavos === ordem.valor_final_centavos || valorCentavos === ordem.valor_base_centavos)
    : valorCentavos === ordem.valor_final_centavos;
  const metadataCuidador = payment.metadata &&
    (payment.metadata.cuidador_id || payment.metadata.cuidadorId);
  const pagamentoCompativel = ambienteCorreto &&
    String(payment.currency_id || 'BRL') === 'BRL' &&
    valorPermitido &&
    (!metadataCuidador || String(metadataCuidador) === String(ordem.cuidador_id)) &&
    (ordem.tipo === 'assinatura' ||
      !ordem.mp_payment_id ||
      String(ordem.mp_payment_id) === String(payment.id));
  if (!pagamentoCompativel) {
    console.warn('Pagamento MP rejeitado por divergência da ordem:', String(payment.id || ''));
    return;
  }

  const cuidadorId = String(ordem.cuidador_id);
  const extraDestaque = ordem.produto === 'destaque_extra' || ordem.plano === 'destaque';
  const status = String(payment.status || '').toLowerCase();
  const ordemAtualizada = await atualizarOrdemMp(env, ordem.id, {
    mp_payment_id: String(payment.id),
    status: status || 'unknown'
  });
  if (!ordemAtualizada) {
    throw new Error('Falha ao atualizar a ordem interna do pagamento.');
  }

  if (status === 'refunded' || status === 'charged_back') {
    const atual = await lerCuidador(env, cuidadorId);
    const pagamentoAtualProduto = extraDestaque
      ? atual && atual.mp_destaque_payment_id
      : atual && atual.mp_plano_payment_id;
    if (!atual || String(pagamentoAtualProduto || '') !== String(payment.id)) {
      return;
    }
    if (extraDestaque) {
      const estornou = await patchCuidador(env, cuidadorId, {
        plano_destaque: false,
        mp_payment_id: String(payment.id),
        mp_destaque_payment_id: null
      });
      if (!estornou) throw new Error('Falha ao refletir o estorno do Destaque.');
      await notificarTelegram(env, '🔄 *Estorno Mercado Pago*\n\nDestaque extra da cuidadora `' + cuidadorId + '`');
    } else {
      const estornou = await patchCuidador(env, cuidadorId, {
        status_pagamento: 'Estornado',
        plano_valido_ate: new Date().toISOString(),
        mp_payment_id: String(payment.id),
        mp_plano_payment_id: null
      });
      if (!estornou) throw new Error('Falha ao refletir o estorno do plano.');
      await notificarTelegram(env, '🔄 *Estorno Mercado Pago*\n\nCuidadora ID `' + cuidadorId + '`');
    }
    return;
  }

  if (status !== 'approved') return;

  const cuidador = await lerCuidador(env, cuidadorId);
  if (!cuidador) {
    throw new Error('Cuidadora não encontrada para liberar o pagamento.');
  }

  if (ordem.tipo === 'assinatura' && !ordem.recorrencia_ajustada_em &&
      ordem.desconto_centavos > 0) {
    if (!cuidador.mp_preapproval_id) {
      throw new Error('Assinatura ainda não vinculada para retirar o desconto recorrente.');
    }
    const valorCheio = Number(ordem.valor_base_centavos) / 100;
    const ajustou = await atualizarValorPreapprovalMp(env, cuidador.mp_preapproval_id, valorCheio);
    if (!ajustou) {
      throw new Error('Falha ao retirar desconto da recorrência MP.');
    }
    const salvouAjuste = await atualizarOrdemMp(env, ordem.id, {
      recorrencia_ajustada_em: new Date().toISOString()
    });
    if (!salvouAjuste) {
      throw new Error('Falha ao registrar o ajuste da recorrência MP.');
    }
  }

  const pagamentoJaAplicado = extraDestaque
    ? cuidador.mp_destaque_payment_id
    : cuidador.mp_plano_payment_id;
  if (String(pagamentoJaAplicado || '') === String(payment.id)) {
    await concluirEventoPagamentoMp(env, payment.id);
    return;
  }

  const primeiroProcessamento = await reservarEventoPagamentoMp(
    env,
    ordem.id,
    payment.id,
    status
  );
  if (!primeiroProcessamento) return;

  if (extraDestaque) {
    if (!ordem.processado_em && ordem.cupom_codigo) {
      const cupomOk = await registrarCupomDaOrdem(env, ordem, payment.id);
      if (!cupomOk) {
        await desfazerReservaEventoMp(env, payment.id);
        throw new Error('Falha ao registrar o cupom do pagamento.');
      }
    }
    const patchOk = await patchCuidador(env, cuidadorId, {
      plano_destaque: true,
      mp_payment_id: String(payment.id),
      mp_destaque_payment_id: String(payment.id)
    });
    if (!patchOk) {
      await desfazerReservaEventoMp(env, payment.id);
      throw new Error('Falha ao liberar o Destaque após o pagamento.');
    }
    const ordemConcluida = await atualizarOrdemMp(env, ordem.id, {
      processado_em: ordem.processado_em || new Date().toISOString()
    });
    const eventoConcluido = await concluirEventoPagamentoMp(env, payment.id);
    if (!ordemConcluida || !eventoConcluido) {
      throw new Error('Falha ao concluir o processamento do Destaque.');
    }
    await notificarTelegram(env, '[Mercado Pago] 💎 *Destaque extra* aprovado\n\nID: `' + cuidadorId + '`');
    return;
  }

  const plano = String(ordem.plano || 'cadastro');
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
    mp_payment_id: String(payment.id),
    mp_plano_payment_id: String(payment.id)
  };
  if (!ordem.processado_em && ordem.cupom_codigo) {
    const cupomOk = await registrarCupomDaOrdem(env, ordem, payment.id);
    if (!cupomOk) {
      await desfazerReservaEventoMp(env, payment.id);
      throw new Error('Falha ao registrar o cupom do pagamento.');
    }
  }
  const patchOk = await patchCuidador(env, cuidadorId, patchBody);
  if (!patchOk) {
    await desfazerReservaEventoMp(env, payment.id);
    throw new Error('Falha ao liberar o plano após o pagamento.');
  }
  const ordemConcluida = await atualizarOrdemMp(env, ordem.id, {
    processado_em: ordem.processado_em || agora.toISOString()
  });
  const eventoConcluido = await concluirEventoPagamentoMp(env, payment.id);
  if (!ordemConcluida || !eventoConcluido) {
    throw new Error('Falha ao concluir o processamento do plano.');
  }

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
  if (!sub) throw new Error('Não foi possível consultar a assinatura no Mercado Pago.');
  const ordem = await buscarOrdemMp(env, String(sub.external_reference || ''));
  if (!ordem || ordem.tipo !== 'assinatura' || !supabaseOk(env)) {
    throw new Error('Não foi possível consultar a ordem interna da assinatura.');
  }

  const cuidadorId = String(ordem.cuidador_id);
  const status = String(sub.status || '').toLowerCase();
  const ordemAtualizada = await atualizarOrdemMp(env, ordem.id, {
    mp_preapproval_id: String(sub.id),
    status: status || 'unknown'
  });
  if (!ordemAtualizada) throw new Error('Falha ao atualizar a ordem da assinatura.');

  if (status === 'cancelled' || status === 'paused') {
    const cancelou = await patchCuidador(env, cuidadorId, { mp_preapproval_id: null });
    if (!cancelou) throw new Error('Falha ao refletir o cancelamento da assinatura.');
    return;
  }
  if (status !== 'authorized' && status !== 'active') return;

  // Autorizar a assinatura não confirma pagamento. O plano só é liberado
  // quando chegar um pagamento "approved".
  const vinculou = await patchCuidador(env, cuidadorId, {
    mp_preapproval_id: String(sub.id)
  });
  if (!vinculou) throw new Error('Falha ao vincular a assinatura à cuidadora.');
}

async function lerCuidador(env, cuidadorId) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=cupom_usado,plano_cadastro,plano_profissional,plano_destaque,plano_valido_ate,status_pagamento,mp_preapproval_id,mp_payment_id,mp_plano_payment_id,mp_destaque_payment_id&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return null;
    const linhas = await resp.json();
    return linhas && linhas[0] ? linhas[0] : null;
  } catch (e) {
    return null;
  }
}

async function registrarCupomDaOrdem(env, ordem, paymentId) {
  try {
    const cupomResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(ordem.cupom_codigo) + '&limit=1',
      { headers: headersSupabase(env) }
    );
    const cupons = await cupomResp.json();
    const cupom = cupons && cupons[0];
    if (!cupom) return false;

    return await registrarUsoCupom(
      env,
      cupom,
      ordem.cuidador_id,
      ordem.plano,
      Number(ordem.valor_base_centavos) / 100,
      Number(ordem.desconto_centavos) / 100,
      Number(ordem.valor_final_centavos) / 100,
      String(paymentId)
    );
  } catch (err) {
    console.warn('Erro cupom webhook MP:', err);
    return false;
  }
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
