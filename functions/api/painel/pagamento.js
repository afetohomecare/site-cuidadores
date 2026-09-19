// Painel: Pix de regularização + cartão só em Checkout hospedado do Asaas.
// Cartão NUNCA é digitado no domínio da Afeto.

import { jsonResp, metodoNaoPermitido } from '../../_lib/http.js';
import { headersSupabase, supabaseOk } from '../../_lib/supabase.js';
import { validarCuidadora } from '../../_lib/auth.js';
import { validarCupom, registrarUsoCupom } from '../../_lib/cupom.js';

const CAMPOS = [
  'id', 'nome', 'cpf', 'whatsapp',
  'status_pagamento', 'plano_valido_ate',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'asaas_customer_id', 'asaas_cobranca_id', 'asaas_subscription_id'
].join(',');

function getAsaasConfig(env) {
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

function planoDaCuidadora(c) {
  if (c.plano_destaque) return 'destaque';
  if (c.plano_profissional) return 'profissional';
  return 'cadastro';
}

function nomeDoPlanoBonito(plano) {
  if (plano === 'cadastro') return 'Cadastro Básico';
  if (plano === 'destaque') return 'Destaque';
  return 'Profissional';
}

function planoIrregular(c) {
  const st = c && c.status_pagamento;
  if (st === 'Inadimplente' || st === 'Estornado') return true;
  if (st !== 'Pago') return true;
  if (!c.plano_valido_ate) return true;
  return new Date(c.plano_valido_ate).getTime() < Date.now();
}

function origemPublica(request) {
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

function ymd(d) {
  return d.toISOString().split('T')[0];
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);

  if (!supabaseOk(env)) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const c = await validarCuidadora(env, request, CAMPOS);
    if (!c) return jsonResp({ error: 'Não autenticado.' }, 401);

    const body = await request.json().catch(function () { return {}; });
    const acao = String(body.acao || '').trim().toLowerCase();
    if (acao !== 'pix' && acao !== 'cartao') {
      return jsonResp({ error: 'Ação inválida. Use pix ou cartao.' }, 400);
    }

    const plano = planoDaCuidadora(c);
    const valorBase = await lerPrecoPlano(env, plano);
    if (!valorBase || valorBase <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado.' }, 500);
    }

    const cpfLimpo = String(c.cpf || '').replace(/\D/g, '');
    const whatsLimpo = String(c.whatsapp || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF do cadastro inválido. Fale com a Afeto.' }, 400);
    }

    let desconto = 0;
    let cupomObj = null;
    const cupomCodigo = String(body.cupomCodigo || '').trim();
    if (cupomCodigo) {
      const resultado = await validarCupom(env, cupomCodigo, plano, valorBase, cpfLimpo);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);
      desconto = resultado.desconto;
      cupomObj = resultado.cupom;
    }
    const valor = Math.max(0, Math.round((valorBase - desconto) * 100) / 100);

    if (valor === 0) {
      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + 30);
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify({
          status_pagamento: 'Pago',
          cupom_usado: cupomObj ? cupomObj.codigo : null,
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString(),
          proxima_cobranca: vence.toISOString()
        })
      });
      if (cupomObj) {
        await registrarUsoCupom(env, cupomObj, c.id, plano, valorBase, desconto, 0, null);
      }
      return jsonResp({
        ok: true,
        gratis: true,
        acao: acao,
        valorBase: valorBase,
        valorFinal: 0,
        cupom: cupomObj ? cupomObj.codigo : null
      }, 200);
    }

    if (!asaas.apiKey) {
      return jsonResp({ error: 'Pagamento temporariamente indisponível.' }, 500);
    }

    const customerId = c.asaas_customer_id || await criarOuBuscarCliente(asaas.apiKey, asaas.url, {
      name: c.nome,
      cpfCnpj: cpfLimpo,
      mobilePhone: whatsLimpo,
      externalReference: c.id
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao localizar o cliente no Asaas.' }, 502);
    }

    if (customerId !== c.asaas_customer_id) {
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify({ asaas_customer_id: customerId })
      });
    }

    if (acao === 'pix') {
      return await criarPixRegularizacao(env, asaas, c, customerId, plano, valor, cupomObj);
    }
    return await criarCheckoutCartao(request, env, asaas, c, customerId, plano, valor, cpfLimpo, whatsLimpo, cupomObj);
  } catch (err) {
    console.error('Erro painel/pagamento:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function criarPixRegularizacao(env, asaas, c, customerId, plano, valor, cupomObj) {
  const existente = await verificarCobrancaAtiva(env, asaas.url, asaas.apiKey, c.id, valor);
  if (existente) {
    const pix = await buscarPix(asaas.url, asaas.apiKey, existente.id);
    if (!pix) return jsonResp({ error: 'Não foi possível gerar o QR Code Pix.' }, 502);
    return jsonResp({
      ok: true,
      acao: 'pix',
      reutilizada: true,
      cobrancaId: existente.id,
      pix: pix
    }, 200);
  }

  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 1);

  const cobrancaResp = await fetch(asaas.url + '/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': asaas.apiKey
    },
    body: JSON.stringify({
      customer: customerId,
      billingType: 'PIX',
      value: valor,
      dueDate: ymd(vencimento),
      description: 'Afeto — Regularização Plano ' + nomeDoPlanoBonito(plano) + (cupomObj ? ' (cupom ' + cupomObj.codigo + ')' : ''),
      externalReference: c.id
    })
  });
  const cobrancaData = await cobrancaResp.json();
  if (!cobrancaResp.ok) {
    console.error('Falha PIX painel:', cobrancaData);
    return jsonResp({ error: 'Não foi possível criar a cobrança Pix.' }, 502);
  }

  const patchPix = { asaas_cobranca_id: cobrancaData.id };
  if (cupomObj) patchPix.cupom_usado = cupomObj.codigo;
  await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
    method: 'PATCH',
    headers: headersSupabase(env, true),
    body: JSON.stringify(patchPix)
  });

  const pix = await buscarPix(asaas.url, asaas.apiKey, cobrancaData.id);
  if (!pix) return jsonResp({ error: 'Não foi possível gerar o QR Code Pix.' }, 502);

  return jsonResp({
    ok: true,
    acao: 'pix',
    cobrancaId: cobrancaData.id,
    valorFinal: valor,
    pix: pix
  }, 200);
}

async function criarCheckoutCartao(request, env, asaas, c, customerId, plano, valor, cpfLimpo, whatsLimpo, cupomObj) {
  const origem = origemPublica(request);
  const hoje = new Date();
  let nextDue = ymd(hoje);
  if (!planoIrregular(c) && c.plano_valido_ate) {
    const vence = new Date(c.plano_valido_ate);
    if (vence.getTime() > Date.now()) nextDue = ymd(vence);
  }

  const checkoutBody = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: 60,
    externalReference: c.id,
    callback: {
      successUrl: origem + '/painel.html?pagamento=cartao_ok',
      cancelUrl: origem + '/painel.html?pagamento=cartao_cancelado',
      expiredUrl: origem + '/painel.html?pagamento=cartao_expirado'
    },
    items: [{
      name: 'Plano ' + nomeDoPlanoBonito(plano) + ' Afeto',
      description: cupomObj
        ? 'Assinatura mensal Afeto (cupom ' + cupomObj.codigo + ')'
        : 'Assinatura mensal Afeto Cuidadores',
      quantity: 1,
      value: valor
    }],
    customerData: {
      name: c.nome,
      cpfCnpj: cpfLimpo,
      phone: whatsLimpo || undefined
    },
    subscription: {
      cycle: 'MONTHLY',
      nextDueDate: nextDue
    }
  };

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
    return jsonResp({ error: 'Não foi possível abrir o cadastro de cartão no Asaas.' }, 502);
  }

  if (cupomObj) {
    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
      method: 'PATCH',
      headers: headersSupabase(env, true),
      body: JSON.stringify({ cupom_usado: cupomObj.codigo })
    });
  }

  return jsonResp({
    ok: true,
    acao: 'cartao',
    link: data.link,
    checkoutId: data.id || null,
    valorFinal: valor,
    cupom: cupomObj ? cupomObj.codigo : null
  }, 200);
}

async function buscarPix(baseUrl, apiKey, cobrancaId) {
  const pixResp = await fetch(baseUrl + '/payments/' + cobrancaId + '/pixQrCode', {
    headers: { 'User-Agent': 'Afeto/1.0', 'access_token': apiKey }
  });
  if (!pixResp.ok) return null;
  const pixData = await pixResp.json();
  if (!pixData.encodedImage || !pixData.payload) return null;
  return {
    qrCodeImage: pixData.encodedImage,
    copiaECola: pixData.payload
  };
}

async function verificarCobrancaAtiva(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId, valorEsperado) {
  try {
    const cResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) + '&select=asaas_cobranca_id&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!cResp.ok) return null;
    const cData = await cResp.json();
    const cobrancaId = cData[0] && cData[0].asaas_cobranca_id;
    if (!cobrancaId) return null;

    const asaasResp = await fetch(ASAAS_URL + '/payments/' + cobrancaId, {
      headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
    });
    if (!asaasResp.ok) return null;
    const cobranca = await asaasResp.json();
    const statusValidos = ['PENDING', 'AWAITING_RISK_ANALYSIS'];
    if (statusValidos.indexOf(cobranca.status) === -1) return null;
    if (cobranca.billingType && cobranca.billingType !== 'PIX') return null;
    if (Math.abs(cobranca.value - valorEsperado) > 0.01) return null;
    return cobranca;
  } catch (e) {
    return null;
  }
}

async function lerPrecoPlano(env, plano) {
  const chave = plano === 'destaque' ? 'preco_destaque'
              : plano === 'profissional' ? 'preco_profissional'
              : plano === 'cadastro' ? 'preco_cadastro'
              : null;
  if (!chave) return null;
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + encodeURIComponent(chave) + '&select=valor&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return null;
    const linhas = await resp.json();
    if (!linhas || linhas.length === 0) return null;
    const valor = parseFloat(linhas[0].valor);
    return isNaN(valor) ? null : valor;
  } catch (err) {
    return null;
  }
}

async function criarOuBuscarCliente(apiKey, baseUrl, dados) {
  const buscaResp = await fetch(baseUrl + '/customers?cpfCnpj=' + dados.cpfCnpj, {
    headers: { 'User-Agent': 'Afeto/1.0', 'access_token': apiKey }
  });
  if (buscaResp.ok) {
    const buscaData = await buscaResp.json();
    if (buscaData.data && buscaData.data.length > 0) return buscaData.data[0].id;
  }

  const criarBody = { name: dados.name, cpfCnpj: dados.cpfCnpj };
  if (dados.mobilePhone) criarBody.mobilePhone = dados.mobilePhone;
  if (dados.externalReference) criarBody.externalReference = dados.externalReference;

  const criarResp = await fetch(baseUrl + '/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Afeto/1.0', 'access_token': apiKey },
    body: JSON.stringify(criarBody)
  });
  const criarData = await criarResp.json();
  if (!criarResp.ok) return null;
  return criarData.id;
}

export async function onRequestGet() {
  return metodoNaoPermitido();
}
