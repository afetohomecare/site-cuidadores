import { origemPublica } from './asaas.js';
import { emailPagador, getMpAccessToken, patchCuidador } from './pagamento.js';
import { parcelasDoCartao, planoEhEssencial } from './planos.js';

const MP_API = 'https://api.mercadopago.com';

export function getMpConfig(env) {
  const ambiente = String(env.MP_AMBIENTE || env.MERCADOPAGO_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox' || ambiente === 'test' || ambiente === 'teste';
  const accessToken = getMpAccessToken(env);
  const tokenSandbox = String(accessToken || '').indexOf('TEST-') === 0;
  return {
    accessToken: accessToken,
    isSandbox: isSandbox || tokenSandbox,
    webhookSecret: env.MP_WEBHOOK_SECRET || env.MERCADOPAGO_WEBHOOK_SECRET || ''
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
    const sub = await criarPreapproval(opts, mp);
    if (sub) return sub;
    console.warn('Preapproval MP falhou; tentando cobrança avulsa no Checkout Pro.');
  }
  return criarPreferencia(opts, mp);
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
      quantity: 1,
      currency_id: 'BRL',
      unit_price: Math.round(Number(opts.valor) * 100) / 100
    }],
    payer: {
      name: pessoa.name,
      surname: pessoa.surname,
      email: emailPagador(opts.cpfLimpo, opts.cuidadorId),
      identification: { type: 'CPF', number: String(opts.cpfLimpo || '') },
      phone: phone
    },
    payment_methods: paymentMethods,
    statement_descriptor: 'AFETO',
    external_reference: String(opts.cuidadorId),
    metadata: {
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
    idempotencyKey: 'pref-' + String(opts.cuidadorId).slice(0, 20) + '-' + Date.now()
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
  const email = emailPagador(opts.cpfLimpo, opts.cuidadorId);
  const body = {
    reason: extra ? 'Destaque extra Afeto — mensal' : 'Plano ' + nomePlano + ' Afeto — mensal',
    external_reference: String(opts.cuidadorId),
    payer_email: email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Math.round(Number(opts.valor) * 100) / 100,
      currency_id: 'BRL'
    },
    back_url: origem + '/' + pagina + '?pagamento=cartao_ok',
    status: 'pending',
    metadata: {
      cuidador_id: String(opts.cuidadorId),
      plano: extra ? 'destaque' : String(opts.plano || 'profissional'),
      produto: extra ? 'destaque_extra' : ''
    }
  };

  const resp = await mpFetch(mp.accessToken, '/preapproval', {
    method: 'POST',
    body: body,
    idempotencyKey: 'sub-' + String(opts.cuidadorId).slice(0, 20) + '-' + Date.now()
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
  if (!mp.webhookSecret) return true;
  const sig = request.headers.get('x-signature') || '';
  if (!sig) return true;
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

  const manifesto = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + ts + ';';
  const calc = await hmacSha256Hex(mp.webhookSecret, manifesto);
  return calc.toLowerCase() === v1.toLowerCase();
}
