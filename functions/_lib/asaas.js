import { parcelasDoCartao } from './planos.js';

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
  const rotuloPeriodo = extra || recorrente ? ' mensal' : ' anual';
  const descricao = cupomObj
    ? (extra ? 'Destaque extra' : 'Plano ' + nomePlano) + rotuloPeriodo + ' (cupom ' + cupomObj.codigo + ')'
    : (extra ? 'Destaque extra mensal Afeto' : 'Plano ' + nomePlano + rotuloPeriodo + ' Afeto');
  const nomeItem = opts.itemNome || (extra
    ? 'Destaque extra Afeto — mensal'
    : (recorrente
      ? 'Plano ' + nomePlano + ' Afeto — mensal'
      : 'Plano ' + nomePlano + ' Afeto — 12 meses'));

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
      cycle: 'MONTHLY',
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
