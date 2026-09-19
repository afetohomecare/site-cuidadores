// Cadastro: Pix e cartão no Checkout Pro do Mercado Pago (domínio deles).
// Asaas permanece no código, desativado por flag, como fallback.
// Cartão NUNCA é digitado no domínio da Afeto.

import { idSeguro } from '../../_lib/auth.js';
import { validarCupom, registrarUsoCupom } from '../../_lib/cupom.js';
import {
  lerPrecoPlano,
  nomeDoPlanoBonito,
  dataValidadePlano,
  formaEhCartao,
  parcelasDoCartao,
  valorParcela,
  planoEhEssencial,
  planoPermitidoNoCadastro
} from '../../_lib/planos.js';
import {
  getAsaasConfig,
  origemPublica,
  criarOuBuscarCliente,
  criarCheckoutCartao
} from '../../_lib/asaas.js';
import {
  asaasDesativado,
  fallbackAsaasAtivo,
  gatewayAtivo
} from '../../_lib/pagamento.js';
import { criarCheckoutMp } from '../../_lib/mercadopago.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do Supabase ausente' }, 500);
  }

  try {
    const body = await request.json();
    const {
      nome, cpf, whatsapp, email,
      formaPagamento,
      cupomCodigo
    } = body;

    const plano = planoPermitidoNoCadastro(body.plano || 'cadastro');
    const parcelas = parcelasDoCartao(body.parcelas);
    const forma = formaEhCartao(formaPagamento) ? 'CREDIT_CARD' : (formaPagamento || '');

    const cuidadorIdBruto = body.cuidadorId || body.recordIdAirtable;
    const cuidadorId = idSeguro(cuidadorIdBruto);

    if (!nome || !cpf || !plano) {
      return jsonResp({ error: 'Campos obrigatórios: nome, cpf, plano' }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp ? whatsapp.replace(/\D/g, '') : '';
    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF inválido.' }, 400);
    }

    if (body.validarApenas && cupomCodigo) {
      const valorBaseCheck = await lerPrecoPlano(env, plano, forma || 'PIX');
      if (!valorBaseCheck) return jsonResp({ error: 'Preço não configurado' }, 500);

      const resultado = await validarCupom(env, cupomCodigo, plano, valorBaseCheck, cpfLimpo);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);

      const valorFinalCheck = Math.max(0, Math.round((valorBaseCheck - resultado.desconto) * 100) / 100);
      return jsonResp({
        ok: true,
        modo: 'validar',
        desconto: resultado.desconto,
        valorBase: valorBaseCheck,
        valorFinal: valorFinalCheck,
        valorParcela: valorParcela(valorFinalCheck, parcelas),
        parcelas: parcelas,
        cupom: resultado.cupom.codigo
      }, 200);
    }

    if (!cuidadorId) {
      return jsonResp({
        error: 'Cadastro incompleto. Envie o formulário novamente antes de pagar.',
        codigo: 'CONTA_NAO_CRIADA'
      }, 400);
    }

    const contaResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
      '&select=id,cpf,auth_user_id,whatsapp,nome&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!contaResp.ok) {
      return jsonResp({ error: 'Falha ao validar o cadastro.' }, 502);
    }
    const contas = await contaResp.json();
    const cuidadora = contas && contas[0];
    if (!cuidadora) {
      return jsonResp({ error: 'Cadastro não encontrado.' }, 404);
    }
    const cpfBd = String(cuidadora.cpf || '').replace(/\D/g, '');
    if (cpfBd !== cpfLimpo) {
      return jsonResp({
        error: 'Os dados do pagamento não conferem com o cadastro.',
        codigo: 'DADOS_DIVERGENTES'
      }, 403);
    }
    if (!cuidadora.auth_user_id) {
      return jsonResp({
        error: 'Crie sua senha de acesso no cadastro antes de pagar.',
        codigo: 'CONTA_NAO_CRIADA'
      }, 403);
    }
    const whatsBd = String(cuidadora.whatsapp || '').replace(/\D/g, '');
    const telefoneAsaas = whatsLimpo || whatsBd;
    const nomeAsaas = nome || cuidadora.nome;

    const valorBase = await lerPrecoPlano(env, plano, forma || 'PIX');
    if (!valorBase || valorBase <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado' }, 500);
    }

    let desconto = 0;
    let cupomObj = null;

    if (cupomCodigo) {
      const resultado = await validarCupom(env, cupomCodigo, plano, valorBase, cpfLimpo);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);
      desconto = resultado.desconto;
      cupomObj = resultado.cupom;
    }

    const valorFinal = Math.max(0, Math.round((valorBase - desconto) * 100) / 100);

    if (valorFinal === 0) {
      const agora = new Date();
      const vence = dataValidadePlano(plano, agora);

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          status_pagamento: 'Pago',
          cupom_usado: cupomObj ? cupomObj.codigo : null,
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString(),
          proxima_cobranca: vence.toISOString()
        })
      });

      if (cupomObj) {
        await registrarUsoCupom(env, cupomObj, cuidadorId, plano, valorBase, desconto, valorFinal, null);
      }

      return jsonResp({
        ok: true,
        gratis: true,
        motivo: 'Cupom aplicado — valor zerado',
        cupom: cupomObj ? cupomObj.codigo : null,
        valorBase: valorBase,
        valorFinal: 0,
        cuidadorId: cuidadorId,
        jaTemSenha: true
      }, 200);
    }

    if (!forma) {
      return jsonResp({ error: 'Forma de pagamento obrigatória' }, 400);
    }
    if (forma !== 'PIX' && forma !== 'CREDIT_CARD') {
      return jsonResp({ error: 'Forma de pagamento inválida.' }, 400);
    }

    const gateway = gatewayAtivo(env);
    if (gateway === 'mercadopago') {
      const checkoutMp = await criarCheckoutMp({
        env: env,
        request: request,
        origem: origemPublica(request),
        paginaRetorno: 'cadastro.html',
        cuidadorId: cuidadorId,
        nome: nomeAsaas,
        cpfLimpo: cpfLimpo,
        whatsLimpo: telefoneAsaas,
        valor: valorFinal,
        parcelas: planoEhEssencial(plano) ? parcelas : 1,
        cupomObj: cupomObj,
        nomePlano: nomeDoPlanoBonito(plano),
        plano: plano,
        forma: forma,
        recorrente: !planoEhEssencial(plano) && forma === 'CREDIT_CARD'
      });
      if (checkoutMp && checkoutMp.link) {
        return jsonResp({
          ok: true,
          gratis: false,
          acao: forma === 'CREDIT_CARD' ? 'cartao' : 'pix',
          gateway: 'mercadopago',
          ambiente: checkoutMp.gateway,
          link: checkoutMp.link,
          checkoutId: checkoutMp.preferenceId || checkoutMp.preapprovalId || null,
          valorBase: valorBase,
          valorFinal: valorFinal,
          desconto: desconto,
          parcelas: checkoutMp.parcelas,
          valorParcela: valorParcela(valorFinal, checkoutMp.parcelas),
          cupom: cupomObj ? cupomObj.codigo : null
        }, 200);
      }
      if (!fallbackAsaasAtivo(env)) {
        return jsonResp({
          error: 'Não foi possível abrir o pagamento no Mercado Pago. Tente de novo em instantes.'
        }, 502);
      }
    }

    if (!asaas.apiKey || asaasDesativado(env)) {
      return jsonResp({ error: 'Pagamento temporariamente indisponível.' }, 500);
    }

    const customerId = await criarOuBuscarCliente(asaas.apiKey, asaas.url, {
      name: nomeAsaas,
      cpfCnpj: cpfLimpo,
      mobilePhone: telefoneAsaas,
      email: email || undefined,
      externalReference: cuidadorId
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao criar cliente no Asaas' }, 502);
    }

    if (forma === 'CREDIT_CARD') {
      const checkout = await criarCheckoutCartao({
        asaas: asaas,
        origem: origemPublica(request),
        paginaRetorno: 'cadastro.html',
        cuidadorId: cuidadorId,
        nome: nomeAsaas,
        cpfLimpo: cpfLimpo,
        whatsLimpo: telefoneAsaas,
        valor: valorFinal,
        parcelas: planoEhEssencial(plano) ? parcelas : 1,
        cupomObj: cupomObj,
        nomePlano: nomeDoPlanoBonito(plano),
        recorrente: !planoEhEssencial(plano)
      });
      if (!checkout) {
        return jsonResp({ error: 'Não foi possível abrir o pagamento no cartão. Tente o Pix ou tente de novo.' }, 502);
      }

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          asaas_customer_id: customerId,
          cupom_usado: cupomObj ? cupomObj.codigo : null
        })
      });

      return jsonResp({
        ok: true,
        gratis: false,
        acao: 'cartao',
        gateway: 'asaas',
        ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
        link: checkout.link,
        checkoutId: checkout.checkoutId,
        valorBase: valorBase,
        valorFinal: valorFinal,
        desconto: desconto,
        parcelas: checkout.parcelas,
        valorParcela: valorParcela(valorFinal, checkout.parcelas),
        cupom: cupomObj ? cupomObj.codigo : null
      }, 200);
    }

    if (cuidadorId) {
      const cobrancaExistente = await verificarCobrancaAtiva(env, asaas.url, asaas.apiKey, cuidadorId, valorFinal);
      if (cobrancaExistente) {
        let pixData = null;
        const pixResp = await fetch(asaas.url + '/payments/' + cobrancaExistente.id + '/pixQrCode', {
          headers: { 'User-Agent': 'Afeto/1.0', 'access_token': asaas.apiKey }
        });
        if (pixResp.ok) pixData = await pixResp.json();

        return jsonResp({
          ok: true,
          gratis: false,
          gateway: 'asaas',
          ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
          reutilizada: true,
          cobrancaId: cobrancaExistente.id,
          status: cobrancaExistente.status,
          valorBase: valorBase,
          valorFinal: valorFinal,
          desconto: desconto,
          pagoNaHora: false,
          isSubscription: false,
          pix: pixData ? {
            qrCodeImage: pixData.encodedImage,
            copiaECola: pixData.payload
          } : null
        }, 200);
      }

      await limparCobrancasAntigas(env, asaas.url, asaas.apiKey, cuidadorId);
    }

    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    const cobrancaBody = {
      customer: customerId,
      billingType: 'PIX',
      value: valorFinal,
      dueDate: dataVencimento,
      description: 'Afeto — Plano ' + nomeDoPlanoBonito(plano) + (planoEhEssencial(plano) ? ' anual' : ' mensal'),
      externalReference: cuidadorId
    };

    const cobrancaResp = await fetch(asaas.url + '/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Afeto/1.0',
        'access_token': asaas.apiKey
      },
      body: JSON.stringify(cobrancaBody)
    });
    const cobrancaData = await cobrancaResp.json();

    if (!cobrancaResp.ok) {
      console.error('Falha cobrança Asaas:', cobrancaData);
      return jsonResp({ error: 'Não foi possível criar a cobrança. Tente novamente.' }, 502);
    }

    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        asaas_customer_id: customerId,
        asaas_cobranca_id: cobrancaData.id,
        cupom_usado: cupomObj ? cupomObj.codigo : null
      })
    });

    let pixData = null;
    const pixResp = await fetch(asaas.url + '/payments/' + cobrancaData.id + '/pixQrCode', {
      headers: { 'User-Agent': 'Afeto/1.0', 'access_token': asaas.apiKey }
    });
    if (pixResp.ok) pixData = await pixResp.json();

    return jsonResp({
      ok: true,
      gratis: false,
      gateway: 'asaas',
      ambiente: asaas.isSandbox ? 'sandbox' : 'producao',
      cobrancaId: cobrancaData.id,
      invoiceUrl: cobrancaData.invoiceUrl || '',
      status: cobrancaData.status,
      valorBase: valorBase,
      valorFinal: valorFinal,
      desconto: desconto,
      pagoNaHora: false,
      isSubscription: false,
      pix: pixData ? {
        qrCodeImage: pixData.encodedImage,
        copiaECola: pixData.payload
      } : null
    }, 200);

  } catch (err) {
    console.error('Erro checkout:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

async function limparCobrancasAntigas(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId) {
  try {
    const cResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) + '&select=asaas_cobranca_id,status_pagamento&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!cResp.ok) return;

    const cData = await cResp.json();
    const antigaCobrancaId = cData[0] && cData[0].asaas_cobranca_id;
    const statusAtual = cData[0] && cData[0].status_pagamento;

    if (antigaCobrancaId && statusAtual !== 'Pago') {
      await fetch(ASAAS_URL + '/payments/' + antigaCobrancaId, {
        method: 'DELETE',
        headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
      });

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({ asaas_cobranca_id: null })
      });
    }
  } catch (e) {
    console.warn('Erro ao limpar cobranças antigas:', e);
  }
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
    console.warn('Erro ao verificar cobrança ativa:', e);
    return null;
  }
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
    status: status || 200, headers: { 'Content-Type': 'application/json' }
  });
}
