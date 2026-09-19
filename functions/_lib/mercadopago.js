import { origemPublica } from './asaas.js';
import {
  emailPagador,
  getMpAccessToken,
  getMpWebhookSecret,
  patchCuidador
} from './pagamento.js';
import { parcelasDoCartao, planoEhEssencial } from './planos.js';
import { atualizarOrdemMp, criarOrdemMp } from './ordens-pagamento.js';

const MP_API = 'https://api.mercadopago.com';

export function getMpConfig(env) {
  const ambiente = String(env.MP_AMBIENTE || env.MERCADOPAGO_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox' || ambiente === 'test' || ambiente === 'teste';
  const accessToken = getMpAccessToken(env);
  const tokenSandbox = String(accessToken || '').indexOf('TEST-') === 0;
  return {
    accessToken: accessToken,
    isSandbox: isSandbox || tokenSandbox,
    webhookSecret: getMpWebhookSecret(env)
  };
}

function splitNome(nome) {
  const partes = String(nome || 'Cuidadora Afeto').trim().split(/\s+/);
  return {
    name: partes[0] || 'Cuidadora',
    surname: partes.slice(1).join(' ') || 'Afeto'
  };
}

function telefoneMp(whats) {
  const d = String(whats || '').replace(/\D/g, '');
  if (d.length < 10) return undefined;
  return { area_code: d.slice(0, 2), number: d.slice(2) };
}

function emailMp(dados, cpf, cuidadorId) {
  const payer = dados && dados.payer && typeof dados.payer === 'object' ? dados.payer : {};
  const candidato = String(payer.email || dados.email || '').trim().toLowerCase();
  if (candidato.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidato)) {
    return candidato;
  }
  return emailPagador(cpf, cuidadorId);
}

async function mpFetch(accessToken, path, opts) {
  const headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (opts && opts.idempotencyKey) headers['X-Idempotency-Key'] = String(opts.idempotencyKey).slice(0, 64);
  const resp = await fetch(MP_API + path, {
    method: (opts && opts.method) || 'GET',
    headers: headers,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  return { ok: resp.ok, status: resp.status, data: data };
}

function linkCheckout(mp, data) {
  if (!data) return null;
  if (mp.isSandbox) return data.sandbox_init_point || data.init_point || null;
  return data.init_point || data.sandbox_init_point || null;
}

export async function criarCheckoutMp(opts) {
  const env = opts.env;
  const mp = getMpConfig(env);
  if (!mp.accessToken) return null;

  if (opts.recorrente) {
    if (opts.existingPreapprovalId) {
      const existente = await buscarPreapprovalMp(opts.env, opts.existingPreapprovalId);
      const linkExistente = linkCheckout(mp, existente);
      if (existente && linkExistente &&
          ['pending', 'authorized', 'active'].indexOf(String(existente.status || '').toLowerCase()) !== -1) {
        return {
          link: linkExistente,
          preapprovalId: existente.id,
          parcelas: 1,
          recorrente: true,
          gateway: 'mercadopago',
          reutilizada: true
        };
      }
    }
    const sub = await criarPreapproval(opts, mp);
    return sub;
  }
  if (opts.existingCheckoutUrl) {
    return {
      link: String(opts.existingCheckoutUrl),
      preferenceId: null,
      parcelas: planoEhEssencial(opts.plano) ? parcelasDoCartao(opts.parcelas) : 1,
      recorrente: false,
      gateway: 'mercadopago',
      reutilizada: true
    };
  }
  return criarPreferencia(opts, mp);
}

export async function criarPagamentoBrick(opts) {
  const mp = getMpConfig(opts.env);
  if (!mp.accessToken) {
    return { ok: false, status: 500, error: 'Mercado Pago não configurado.' };
  }

  const forma = String(opts.forma || '').toUpperCase();
  if (forma !== 'PIX' && forma !== 'CREDIT_CARD') {
    return { ok: false, status: 400, error: 'Forma de pagamento inválida.' };
  }

  const expiraEm = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const ordem = await criarOrdemMp(opts.env, {
    cuidadorId: opts.cuidadorId,
    plano: opts.plano,
    produto: opts.extra ? 'destaque_extra' : '',
    forma: forma,
    tipo: opts.tipo || 'avulso',
    valorBase: opts.valorBase,
    desconto: opts.desconto,
    valorFinal: opts.valor,
    cupomCodigo: opts.cupomObj ? opts.cupomObj.codigo : null,
    isSandbox: mp.isSandbox,
    expiraEm: expiraEm,
    clientRequestId: opts.clientRequestId
  });
  if (!ordem) {
    return {
      ok: false,
      status: 503,
      error: 'Execute a atualização do banco de dados do Mercado Pago antes de receber pagamentos.'
    };
  }

  if (ordem.mp_payment_id) {
    const existente = await buscarPagamentoMp(opts.env, ordem.mp_payment_id);
    if (existente) {
      const statusExistente = String(existente.status || '').toLowerCase();
      if (['rejected', 'cancelled', 'refunded', 'charged_back'].indexOf(statusExistente) !== -1) {
        return {
          ok: false,
          status: 422,
          error: 'Pagamento não aprovado. Revise os dados e tente novamente.'
        };
      }
      const existenteTransaction = existente.point_of_interaction &&
        existente.point_of_interaction.transaction_data;
      return {
        ok: true,
        status: 200,
        paymentId: String(existente.id),
        paymentStatus: String(existente.status || ''),
        statusDetail: String(existente.status_detail || ''),
        ordemId: String(ordem.id),
        reutilizada: true,
        pix: existenteTransaction ? {
          qrCodeImage: existenteTransaction.qr_code_base64 || '',
          copiaECola: existenteTransaction.qr_code || '',
          ticketUrl: existenteTransaction.ticket_url || ''
        } : null
      };
    }
  }

  const dadosBrick = opts.formData && typeof opts.formData === 'object' ? opts.formData : {};
  const pessoa = splitNome(opts.nome);
  const phone = telefoneMp(opts.whatsLimpo);
  const nomeProduto = opts.extra
    ? 'Destaque extra mensal Afeto'
    : 'Plano ' + (opts.nomePlano || 'Afeto') + (planoEhEssencial(opts.plano) ? ' — 12 meses' : ' — mensal');
  const payer = {
    email: emailMp(dadosBrick, opts.cpfLimpo, opts.cuidadorId),
    first_name: pessoa.name,
    last_name: pessoa.surname,
    identification: {
      type: 'CPF',
      number: String(opts.cpfLimpo || '')
    }
  };
  if (phone) payer.phone = phone;
  const body = {
    transaction_amount: Math.round(Number(opts.valor) * 100) / 100,
    description: nomeProduto,
    payment_method_id: forma === 'PIX' ? 'pix' : String(dadosBrick.payment_method_id || ''),
    payer: payer,
    external_reference: String(ordem.id),
    notification_url: (opts.origem || origemPublica(opts.request)) + '/api/mercadopago/webhook',
    statement_descriptor: 'AFETO',
    metadata: {
      ordem_id: String(ordem.id),
      cuidador_id: String(opts.cuidadorId),
      plano: opts.extra ? 'destaque' : String(opts.plano || 'cadastro'),
      produto: opts.extra ? 'destaque_extra' : '',
      forma: forma
    },
    additional_info: {
      items: [{
        id: String(opts.plano || 'cadastro'),
        title: nomeProduto,
        description: nomeProduto,
        category_id: 'services',
        quantity: 1,
        unit_price: Math.round(Number(opts.valor) * 100) / 100
      }],
      payer: {
        first_name: pessoa.name,
        last_name: pessoa.surname,
        phone: phone
      }
    }
  };

  if (forma === 'PIX') {
    body.date_of_expiration = expiraEm;
  } else {
    const token = String(dadosBrick.token || '');
    if (!token || !body.payment_method_id) {
      await atualizarOrdemMp(opts.env, ordem.id, { status: 'invalid' });
      return { ok: false, status: 400, error: 'Dados do cartão incompletos.' };
    }
    body.token = token;
    body.installments = parcelasDoCartao(dadosBrick.installments || opts.parcelas || 1);
    if (dadosBrick.issuer_id) body.issuer_id = String(dadosBrick.issuer_id);
  }

  const resp = await mpFetch(mp.accessToken, '/v1/payments', {
    method: 'POST',
    body: body,
    idempotencyKey: String(ordem.idempotency_key)
  });
  const payment = resp.data || {};
  await atualizarOrdemMp(opts.env, ordem.id, {
    mp_payment_id: payment.id ? String(payment.id) : null,
    status: String(payment.status || (resp.ok ? 'pending' : 'failed'))
  });

  if (!resp.ok || !payment.id) {
    console.error('Falha pagamento Mercado Pago:', resp.status);
    return {
      ok: false,
      status: resp.status >= 400 && resp.status < 500 ? 400 : 502,
      error: 'O Mercado Pago não conseguiu processar o pagamento.'
    };
  }
  if (['rejected', 'cancelled'].indexOf(String(payment.status || '').toLowerCase()) !== -1) {
    return {
      ok: false,
      status: 422,
      error: 'Pagamento não aprovado. Revise os dados e tente novamente.'
    };
  }

  await patchCuidador(opts.env, opts.cuidadorId, {
    mp_payment_id: String(payment.id),
    cupom_usado: opts.cupomObj ? opts.cupomObj.codigo : undefined
  });

  const transactionData = payment.point_of_interaction &&
    payment.point_of_interaction.transaction_data;
  return {
    ok: true,
    status: 200,
    paymentId: String(payment.id),
    paymentStatus: String(payment.status || ''),
    statusDetail: String(payment.status_detail || ''),
    ordemId: String(ordem.id),
    pix: transactionData ? {
      qrCodeImage: transactionData.qr_code_base64 || '',
      copiaECola: transactionData.qr_code || '',
      ticketUrl: transactionData.ticket_url || ''
    } : null
  };
}

async function criarPreferencia(opts, mp) {
  const origem = opts.origem || origemPublica(opts.request);
  const pagina = opts.paginaRetorno || 'cadastro.html';
  const extra = !!opts.extra;
  const n = extra ? 1 : (planoEhEssencial(opts.plano) ? parcelasDoCartao(opts.parcelas) : 1);
  const pix = String(opts.forma || '').toUpperCase() === 'PIX';
  const nomePlano = extra ? 'Destaque extra' : (opts.nomePlano || 'Essencial');
  const recorrenteTxt = extra || opts.recorrente ? ' mensal' : (planoEhEssencial(opts.plano) ? ' anual' : '');
  const descricao = opts.cupomObj
    ? (extra ? 'Destaque extra' : 'Plano ' + nomePlano) + recorrenteTxt + ' (cupom ' + opts.cupomObj.codigo + ')'
    : (extra ? 'Destaque extra mensal Afeto' : 'Plano ' + nomePlano + recorrenteTxt + ' Afeto');
  const pessoa = splitNome(opts.nome);
  const phone = telefoneMp(opts.whatsLimpo);

  const paymentMethods = {
    installments: n > 1 ? n : 12,
    default_installments: n > 1 ? n : 1
  };
  if (pix) {
    paymentMethods.default_payment_method_id = 'pix';
    paymentMethods.excluded_payment_types = [
      { id: 'credit_card' },
      { id: 'debit_card' },
      { id: 'ticket' },
      { id: 'atm' }
    ];
  } else {
    paymentMethods.excluded_payment_types = [
      { id: 'ticket' },
      { id: 'atm' },
      { id: 'bank_transfer' }
    ];
  }

  const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    items: [{
      id: String(opts.plano || 'cadastro'),
      title: extra
        ? 'Destaque extra Afeto — mensal'
        : 'Plano ' + nomePlano + ' Afeto' + (opts.recorrente ? ' — mensal' : (planoEhEssencial(opts.plano) ? ' — 12 meses' : '')),
      description: descricao,
      category_id: 'services',
      quantity: 1,
      currency_id: 'BRL',
      unit_price: Math.round(Number(opts.valor) * 100) / 100
    }],
    payer: {
      name: pessoa.name,
      surname: pessoa.surname,
      email: emailMp({ email: opts.email }, opts.cpfLimpo, opts.cuidadorId),
      identification: { type: 'CPF', number: String(opts.cpfLimpo || '') },
      phone: phone
    },
    payment_methods: paymentMethods,
    statement_descriptor: 'AFETO',
    external_reference: String(opts.externalReference || opts.cuidadorId),
    metadata: {
      ordem_id: String(opts.ordemId || ''),
      cuidador_id: String(opts.cuidadorId),
      plano: extra ? 'destaque' : String(opts.plano || 'cadastro'),
      produto: extra ? 'destaque_extra' : '',
      forma: pix ? 'PIX' : 'CREDIT_CARD'
    },
    back_urls: {
      success: origem + '/' + pagina + '?pagamento=cartao_ok',
      failure: origem + '/' + pagina + '?pagamento=cartao_cancelado',
      pending: origem + '/' + pagina + '?pagamento=pix_pendente'
    },
    auto_return: 'approved',
    notification_url: origem + '/api/mercadopago/webhook',
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: expira
  };

  const resp = await mpFetch(mp.accessToken, '/checkout/preferences', {
    method: 'POST',
    body: body,
    idempotencyKey: opts.ordemId
      ? 'pref-' + String(opts.ordemId)
      : 'pref-' + String(opts.cuidadorId).slice(0, 20) + '-' + Date.now()
  });
  const link = linkCheckout(mp, resp.data);
  if (!resp.ok || !link) {
    console.error('Falha preferência Mercado Pago:', resp.status, resp.data);
    return null;
  }

  await patchCuidador(opts.env, opts.cuidadorId, {
    mp_preference_id: resp.data.id || null,
    cupom_usado: opts.cupomObj ? opts.cupomObj.codigo : undefined
  });
  if (opts.ordemId) {
    await atualizarOrdemMp(opts.env, opts.ordemId, {
      status: String(resp.data.status || 'pending'),
      checkout_url: link
    });
  }

  return {
    link: link,
    preferenceId: resp.data.id || null,
    parcelas: pix ? 1 : n,
    recorrente: false,
    gateway: 'mercadopago'
  };
}

async function criarPreapproval(opts, mp) {
  const origem = opts.origem || origemPublica(opts.request);
  const pagina = opts.paginaRetorno || 'cadastro.html';
  const extra = !!opts.extra;
  const nomePlano = extra ? 'Destaque extra' : (opts.nomePlano || 'Profissional');
  const emailInformado = String(opts.email || '').trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInformado)
    ? emailInformado
    : emailPagador(opts.cpfLimpo, opts.cuidadorId);
  const body = {
    reason: extra ? 'Destaque extra Afeto — mensal' : 'Plano ' + nomePlano + ' Afeto — mensal',
    external_reference: String(opts.externalReference || opts.cuidadorId),
    payer_email: email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Math.round(Number(opts.valor) * 100) / 100,
      currency_id: 'BRL'
    },
    back_url: origem + '/' + pagina + '?pagamento=cartao_ok',
    status: 'pending'
  };

  const resp = await mpFetch(mp.accessToken, '/preapproval', {
    method: 'POST',
    body: body,
    idempotencyKey: opts.ordemId
      ? 'sub-' + String(opts.ordemId)
      : 'sub-' + String(opts.cuidadorId).slice(0, 20) + '-' + Date.now()
  });
  const link = linkCheckout(mp, resp.data);
  if (!resp.ok || !link) {
    console.error('Falha preapproval Mercado Pago:', resp.status, resp.data);
    return null;
  }

  await patchCuidador(opts.env, opts.cuidadorId, {
    mp_preapproval_id: resp.data.id || null,
    cupom_usado: opts.cupomObj ? opts.cupomObj.codigo : undefined
  });
  if (opts.ordemId) {
    await atualizarOrdemMp(opts.env, opts.ordemId, {
      mp_preapproval_id: resp.data.id || null,
      status: String(resp.data.status || 'pending')
    });
  }

  return {
    link: link,
    preapprovalId: resp.data.id || null,
    parcelas: 1,
    recorrente: true,
    gateway: 'mercadopago'
  };
}

export async function buscarPagamentoMp(env, paymentId) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !paymentId) return null;
  const resp = await mpFetch(mp.accessToken, '/v1/payments/' + encodeURIComponent(paymentId));
  if (!resp.ok) return null;
  return resp.data;
}

export async function buscarPreapprovalMp(env, preapprovalId) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !preapprovalId) return null;
  const resp = await mpFetch(mp.accessToken, '/preapproval/' + encodeURIComponent(preapprovalId));
  if (!resp.ok) return null;
  return resp.data;
}

export async function buscarPagamentoAutorizadoMp(env, authorizedPaymentId) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !authorizedPaymentId) return null;
  const resp = await mpFetch(
    mp.accessToken,
    '/authorized_payments/' + encodeURIComponent(authorizedPaymentId)
  );
  if (!resp.ok) return null;
  return resp.data;
}

export async function atualizarValorPreapprovalMp(env, preapprovalId, valor) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !preapprovalId || !valor) return false;
  const resp = await mpFetch(mp.accessToken, '/preapproval/' + encodeURIComponent(preapprovalId), {
    method: 'PUT',
    body: {
      auto_recurring: {
        transaction_amount: Math.round(Number(valor) * 100) / 100,
        currency_id: 'BRL'
      }
    }
  });
  return resp.ok;
}

export async function buscarMerchantOrderMp(env, orderId) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !orderId) return null;
  const resp = await mpFetch(mp.accessToken, '/merchant_orders/' + encodeURIComponent(orderId));
  if (!resp.ok) return null;
  return resp.data;
}

export async function cancelarPreapprovalMp(env, preapprovalId) {
  const mp = getMpConfig(env);
  if (!mp.accessToken || !preapprovalId) return false;
  const resp = await mpFetch(mp.accessToken, '/preapproval/' + encodeURIComponent(preapprovalId), {
    method: 'PUT',
    body: { status: 'cancelled' }
  });
  return resp.ok || resp.status === 404;
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

export async function validarAssinaturaMp(request, env, dataId) {
  const mp = getMpConfig(env);
  if (!mp.webhookSecret) return false;
  const sig = request.headers.get('x-signature') || '';
  const requestId = request.headers.get('x-request-id') || '';
  if (!sig || !requestId || !dataId) return false;

  let ts = '';
  let v1 = '';
  String(sig).split(',').forEach(function (parte) {
    const kv = parte.split('=');
    if (kv.length < 2) return;
    const k = kv[0].trim();
    const v = kv.slice(1).join('=').trim();
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  });
  if (!ts || !v1) return false;

  const idManifesto = String(dataId).toLowerCase();
  const manifesto = 'id:' + idManifesto + ';request-id:' + requestId + ';ts:' + ts + ';';
  const calc = await hmacSha256Hex(mp.webhookSecret, manifesto);
  return calc.toLowerCase() === v1.toLowerCase();
}
