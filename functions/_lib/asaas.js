import { parcelasDoCartao, cicloAssinatura } from './planos.js';

function headersAsaas(apiKey, json) {
  const h = { 'User-Agent': 'Afeto/1.0', 'access_token': apiKey };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export function getAsaasConfig(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox';
  return {
    url: isSandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3',
    apiKey: isSandbox
      ? (env.ASAAS_API_KEY_SANDBOX || env.ASAAS_API_KEY)
      : (env.ASAAS_API_KEY_PRODUCAO || env.ASAAS_API_KEY),
    isSandbox: isSandbox
  };
}

export function origemPublica(request) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return 'https://afetocuidadores.pages.dev';
    }
    return url.origin;
  } catch (e) {
    return 'https://afetocuidadores.pages.dev';
  }
}

export function ymd(d) {
  return d.toISOString().split('T')[0];
}

export async function criarOuBuscarCliente(apiKey, baseUrl, dados) {
  const buscaResp = await fetch(baseUrl + '/customers?cpfCnpj=' + dados.cpfCnpj, {
    headers: { 'User-Agent': 'Afeto/1.0', 'access_token': apiKey }
  });
  if (buscaResp.ok) {
    const buscaData = await buscaResp.json();
    if (buscaData.data && buscaData.data.length > 0) return buscaData.data[0].id;
  }

  const criarBody = { name: dados.name, cpfCnpj: dados.cpfCnpj };
  if (dados.mobilePhone) criarBody.mobilePhone = dados.mobilePhone;
  if (dados.email) criarBody.email = dados.email;
  if (dados.externalReference) criarBody.externalReference = dados.externalReference;

  const criarResp = await fetch(baseUrl + '/customers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': apiKey
    },
    body: JSON.stringify(criarBody)
  });
  const criarData = await criarResp.json();
  if (!criarResp.ok) return null;
  return criarData.id;
}

export async function criarCheckoutCartao(opts) {
  const asaas = opts.asaas;
  const origem = opts.origem;
  const pagina = opts.paginaRetorno || 'cadastro.html';
  const n = parcelasDoCartao(opts.parcelas);
  const cupomObj = opts.cupomObj;
  const nomePlano = opts.nomePlano || 'Essencial';
  const recorrente = !!opts.recorrente;
  const extra = !!opts.extra;
  const ciclo = opts.ciclo || (recorrente ? cicloAssinatura(opts.plano, extra) : null);
  const rotuloPeriodo = extra || ciclo === 'MONTHLY' ? ' mensal' : ' anual';
  const descricao = cupomObj
    ? (extra ? 'Destaque extra' : 'Plano ' + nomePlano) + rotuloPeriodo + ' (cupom ' + cupomObj.codigo + ')'
    : (extra ? 'Destaque extra mensal Afeto' : 'Plano ' + nomePlano + rotuloPeriodo + ' Afeto');
  const nomeItem = opts.itemNome || (extra
    ? 'Destaque extra Afeto — mensal'
    : 'Plano ' + nomePlano + ' Afeto — ' + (ciclo === 'YEARLY' ? 'anual' : 'mensal'));
  const checkoutBody = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: recorrente ? ['RECURRENT'] : (n <= 1 ? ['DETACHED'] : ['INSTALLMENT']),
    minutesToExpire: 60,
    externalReference: opts.cuidadorId,
    callback: {
      successUrl: origem + '/' + pagina + '?pagamento=cartao_ok',
      cancelUrl: origem + '/' + pagina + '?pagamento=cartao_cancelado',
      expiredUrl: origem + '/' + pagina + '?pagamento=cartao_expirado'
    },
    items: [{
      name: nomeItem,
      description: descricao + (recorrente ? ' · recorrente' : (n > 1 ? ' · até ' + n + 'x' : ' · à vista')),
      quantity: 1,
      value: opts.valor
    }],
    customerData: {
      name: opts.nome,
      cpfCnpj: opts.cpfLimpo,
      phone: opts.whatsLimpo || undefined
    }
  };

  if (recorrente) {
    checkoutBody.subscription = {
      cycle: ciclo || 'MONTHLY',
      nextDueDate: opts.nextDueDate || ymd(new Date())
    };
  } else if (n > 1) {
    checkoutBody.installment = { maxInstallmentCount: n };
  }

  const resp = await fetch(asaas.url + '/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': asaas.apiKey
    },
    body: JSON.stringify(checkoutBody)
  });
  const data = await resp.json();
  if (!resp.ok || !data.link) {
    console.error('Falha checkout Asaas:', data);
    return null;
  }
  return {
    link: data.link,
    checkoutId: data.id || null,
    parcelas: recorrente ? 1 : n,
    recorrente: recorrente
  };
}

export async function criarCheckoutCartaoAnual(opts) {
  return criarCheckoutCartao(opts);
}

export async function buscarPixQr(asaas, cobrancaId) {
  const pixResp = await fetch(asaas.url + '/payments/' + encodeURIComponent(cobrancaId) + '/pixQrCode', {
    headers: headersAsaas(asaas.apiKey)
  });
  if (!pixResp.ok) return null;
  const pixData = await pixResp.json();
  if (!pixData.encodedImage || !pixData.payload) return null;
  return {
    qrCodeImage: pixData.encodedImage,
    copiaECola: pixData.payload
  };
}

export async function buscarAssinatura(asaas, subscriptionId) {
  if (!subscriptionId) return null;
  const resp = await fetch(asaas.url + '/subscriptions/' + encodeURIComponent(subscriptionId), {
    headers: headersAsaas(asaas.apiKey)
  });
  if (!resp.ok) return null;
  return resp.json();
}

function esperar(ms) {
  return new Promise(function (ok) { setTimeout(ok, ms); });
}

function assinaturaPixCompativel(atual, ciclo) {
  if (!atual) return false;
  const status = String(atual.status || '').toUpperCase();
  if (status !== 'ACTIVE' && status !== 'PENDING') return false;
  const tipo = String(atual.billingType || '').toUpperCase();
  if (tipo && tipo !== 'PIX' && tipo !== 'UNDEFINED') return false;
  const cicloAtual = String(atual.cycle || '').toUpperCase();
  if (cicloAtual && cicloAtual !== String(ciclo || '').toUpperCase()) return false;
  return true;
}

export async function buscarCobrancaPixDaAssinatura(asaas, subscriptionId, valorEsperado) {
  const resp = await fetch(
    asaas.url + '/payments?subscription=' + encodeURIComponent(subscriptionId) + '&limit=10',
    { headers: headersAsaas(asaas.apiKey) }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const lista = Array.isArray(data.data) ? data.data : [];
  const statusValidos = ['PENDING', 'AWAITING_RISK_ANALYSIS', 'OVERDUE'];
  let candidata = null;
  for (let i = 0; i < lista.length; i++) {
    const cobranca = lista[i];
    if (statusValidos.indexOf(cobranca.status) === -1) continue;
    const tipo = String(cobranca.billingType || '').toUpperCase();
    if (tipo && tipo !== 'PIX' && tipo !== 'UNDEFINED') continue;
    if (valorEsperado != null && Math.abs(Number(cobranca.value) - Number(valorEsperado)) > 0.01) {
      if (!candidata) candidata = cobranca;
      continue;
    }
    return cobranca;
  }
  return candidata;
}

async function cobrancaPixComEspera(asaas, subscriptionId, valor) {
  let cobranca = await buscarCobrancaPixDaAssinatura(asaas, subscriptionId, valor);
  if (cobranca) return cobranca;
  await esperar(400);
  cobranca = await buscarCobrancaPixDaAssinatura(asaas, subscriptionId, valor);
  if (cobranca) return cobranca;
  await esperar(700);
  cobranca = await buscarCobrancaPixDaAssinatura(asaas, subscriptionId, valor);
  if (cobranca) return cobranca;
  await esperar(1000);
  return buscarCobrancaPixDaAssinatura(asaas, subscriptionId, valor);
}

export async function criarAssinaturaPix(opts) {
  const asaas = opts.asaas;
  const extra = !!opts.extra;
  const ciclo = opts.ciclo || cicloAssinatura(opts.plano, extra);
  const descricao = opts.descricao || (
    extra
      ? 'Afeto — Destaque extra mensal'
      : 'Afeto — Plano ' + (opts.nomePlano || 'Afeto') + (ciclo === 'YEARLY' ? ' anual' : ' mensal')
  );

  if (opts.existingSubscriptionId) {
    const atual = await buscarAssinatura(asaas, opts.existingSubscriptionId);
    if (assinaturaPixCompativel(atual, ciclo)) {
      const cobranca = await cobrancaPixComEspera(asaas, opts.existingSubscriptionId, opts.valor);
      if (cobranca) {
        const pix = await buscarPixQr(asaas, cobranca.id);
        if (pix) {
          return {
            subscriptionId: opts.existingSubscriptionId,
            cobrancaId: cobranca.id,
            pix: pix,
            reutilizada: true,
            ciclo: ciclo
          };
        }
      }
      return {
        subscriptionId: opts.existingSubscriptionId,
        cobrancaId: null,
        pix: null,
        reutilizada: true,
        jaAtiva: true,
        ciclo: ciclo
      };
    }
  }

  const resp = await fetch(asaas.url + '/subscriptions', {
    method: 'POST',
    headers: headersAsaas(asaas.apiKey, true),
    body: JSON.stringify({
      customer: opts.customerId,
      billingType: 'PIX',
      value: opts.valor,
      nextDueDate: opts.nextDueDate || ymd(new Date()),
      cycle: ciclo,
      description: descricao + (opts.cupomObj ? ' (cupom ' + opts.cupomObj.codigo + ')' : ''),
      externalReference: opts.cuidadorId
    })
  });
  const data = await resp.json();
  if (!resp.ok || !data.id) {
    console.error('Falha assinatura Pix Asaas:', data);
    return null;
  }

  const cobranca = await cobrancaPixComEspera(asaas, data.id, opts.valor);
  const pix = cobranca ? await buscarPixQr(asaas, cobranca.id) : null;
  return {
    subscriptionId: data.id,
    cobrancaId: cobranca && cobranca.id || null,
    pix: pix,
    reutilizada: false,
    ciclo: ciclo
  };
}
