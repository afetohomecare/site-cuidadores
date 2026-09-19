// Painel: Pix/cartão no Mercado Pago (Checkout Pro). Asaas só como fallback.
// Cartão NUNCA é digitado no domínio da Afeto.

import { jsonResp, metodoNaoPermitido } from '../../_lib/http.js';
import { headersSupabase, supabaseOk } from '../../_lib/supabase.js';
import { validarCuidadora } from '../../_lib/auth.js';
import { validarCupom, registrarUsoCupom } from '../../_lib/cupom.js';
import {
  lerPrecoPlano,
  nomeDoPlanoBonito,
  dataValidadePlano,
  parcelasDoCartao,
  valorParcela,
  planoDaCuidadora,
  planoEhEssencial
} from '../../_lib/planos.js';
import {
  getAsaasConfig,
  origemPublica,
  ymd,
  criarOuBuscarCliente,
  criarCheckoutCartao
} from '../../_lib/asaas.js';
import {
  asaasDesativado,
  fallbackAsaasAtivo,
  gatewayAtivo
} from '../../_lib/pagamento.js';
import { criarCheckoutMp } from '../../_lib/mercadopago.js';

const CAMPOS = [
  'id', 'nome', 'cpf', 'whatsapp',
  'status_pagamento', 'plano_valido_ate',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'asaas_customer_id', 'asaas_cobranca_id', 'asaas_subscription_id'
].join(',');

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

    const extraDestaque = String(body.produto || '').trim().toLowerCase() === 'destaque';
    const plano = extraDestaque ? 'destaque' : planoDaCuidadora(c);
    const forma = acao === 'cartao' ? 'CREDIT_CARD' : 'PIX';
    const parcelas = extraDestaque ? 1 : parcelasDoCartao(body.parcelas);
    const valorBase = await lerPrecoPlano(env, plano, forma);
    if (!valorBase || valorBase <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado.' }, 500);
    }

    if (extraDestaque) {
      const taPago = c.status_pagamento === 'Pago';
      const vence = c.plano_valido_ate ? new Date(c.plano_valido_ate).getTime() : 0;
      if (!taPago || vence <= Date.now()) {
        return jsonResp({ error: 'Regularize seu plano antes de ativar o Destaque extra.' }, 400);
      }
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
      if (extraDestaque) {
        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
          method: 'PATCH',
          headers: headersSupabase(env, true),
          body: JSON.stringify({
            plano_destaque: true,
            cupom_usado: cupomObj ? cupomObj.codigo : null
          })
        });
      } else {
        const vence = dataValidadePlano(plano, agora);
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
      }
      if (cupomObj) {
        await registrarUsoCupom(env, cupomObj, c.id, plano, valorBase, desconto, 0, null);
      }
      return jsonResp({
        ok: true,
        gratis: true,
        acao: acao,
        produto: extraDestaque ? 'destaque' : plano,
        valorBase: valorBase,
        valorFinal: 0,
        cupom: cupomObj ? cupomObj.codigo : null
      }, 200);
    }

    const gateway = gatewayAtivo(env);
    if (gateway === 'mercadopago') {
      const checkoutMp = await criarCheckoutMp({
        env: env,
        request: request,
        origem: origemPublica(request),
        paginaRetorno: 'painel.html',
        cuidadorId: c.id,
        nome: c.nome,
        cpfLimpo: cpfLimpo,
        whatsLimpo: whatsLimpo,
        valor: valor,
        parcelas: extraDestaque ? 1 : (planoEhEssencial(plano) ? parcelas : 1),
        cupomObj: cupomObj,
        nomePlano: extraDestaque ? 'Destaque extra' : nomeDoPlanoBonito(plano),
        plano: plano,
        forma: forma,
        extra: extraDestaque,
        recorrente: extraDestaque ? acao === 'cartao' : (!planoEhEssencial(plano) && acao === 'cartao')
      });
      if (checkoutMp && checkoutMp.link) {
        return jsonResp({
          ok: true,
          acao: acao,
          gateway: 'mercadopago',
          link: checkoutMp.link,
          checkoutId: checkoutMp.preferenceId || checkoutMp.preapprovalId || null,
          valorFinal: valor,
          parcelas: checkoutMp.parcelas,
          valorParcela: valorParcela(valor, checkoutMp.parcelas),
          cupom: cupomObj ? cupomObj.codigo : null
        }, 200);
      }
      if (!fallbackAsaasAtivo(env)) {
        return jsonResp({ error: 'Não foi possível abrir o pagamento no Mercado Pago.' }, 502);
      }
    }

    if (!asaas.apiKey || asaasDesativado(env)) {
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
      return await criarPixRegularizacao(env, asaas, c, customerId, plano, valor, cupomObj, extraDestaque);
    }
    return await criarCheckoutCartaoPainel(request, env, asaas, c, customerId, valor, cpfLimpo, whatsLimpo, cupomObj, parcelas, plano, extraDestaque);
  } catch (err) {
    console.error('Erro painel/pagamento:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function criarPixRegularizacao(env, asaas, c, customerId, plano, valor, cupomObj, extraDestaque) {
  const existente = await verificarCobrancaAtiva(env, asaas.url, asaas.apiKey, c.id, valor);
  if (existente) {
    const pix = await buscarPix(asaas.url, asaas.apiKey, existente.id);
    if (!pix) return jsonResp({ error: 'Não foi possível gerar o QR Code Pix.' }, 502);
    return jsonResp({
      ok: true,
      acao: 'pix',
      produto: extraDestaque ? 'destaque' : plano,
      gateway: 'asaas',
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
      description: extraDestaque
        ? 'Afeto — Destaque extra mensal' + (cupomObj ? ' (cupom ' + cupomObj.codigo + ')' : '')
        : 'Afeto — Regularização Plano ' + nomeDoPlanoBonito(plano) + (planoEhEssencial(plano) ? ' anual' : ' mensal') + (cupomObj ? ' (cupom ' + cupomObj.codigo + ')' : ''),
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
    produto: extraDestaque ? 'destaque' : plano,
    gateway: 'asaas',
    cobrancaId: cobrancaData.id,
    valorFinal: valor,
    pix: pix
  }, 200);
}

async function criarCheckoutCartaoPainel(request, env, asaas, c, customerId, valor, cpfLimpo, whatsLimpo, cupomObj, parcelas, plano, extraDestaque) {
  let nextDue = ymd(new Date());
  if (!extraDestaque && !planoEhEssencial(plano) && c.plano_valido_ate) {
    const vence = new Date(c.plano_valido_ate);
    if (vence.getTime() > Date.now()) nextDue = ymd(vence);
  }
  const checkout = await criarCheckoutCartao({
    asaas: asaas,
    origem: origemPublica(request),
    paginaRetorno: 'painel.html',
    cuidadorId: c.id,
    nome: c.nome,
    cpfLimpo: cpfLimpo,
    whatsLimpo: whatsLimpo,
    valor: valor,
    parcelas: extraDestaque ? 1 : (planoEhEssencial(plano) ? parcelas : 1),
    cupomObj: cupomObj,
    nomePlano: extraDestaque ? 'Destaque extra' : nomeDoPlanoBonito(plano),
    recorrente: extraDestaque ? true : !planoEhEssencial(plano),
    extra: extraDestaque,
    nextDueDate: nextDue
  });
  if (!checkout) {
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
    produto: extraDestaque ? 'destaque' : plano,
    gateway: 'asaas',
    link: checkout.link,
    checkoutId: checkout.checkoutId,
    valorFinal: valor,
    parcelas: checkout.parcelas,
    valorParcela: valorParcela(valor, checkout.parcelas),
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

export async function onRequestGet() {
  return metodoNaoPermitido();
}
