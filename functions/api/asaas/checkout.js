// ============================================================
// AFETO — API: cria cliente + cobrança PIX no Asaas
// ------------------------------------------------------------
// Cadastro = só Pix. Cartão só no painel, em página hospedada do Asaas.
//
// 🌍 AMBIENTE: controlado por env.ASAAS_AMBIENTE
//
// 🛡️ BLINDAGENS:
//   • Só cobra se o cadastro existir, o CPF bater e a senha já tiver sido criada
//   • Evita duplicação de cobranças (reutiliza PIX pendente e devolve QR)
// ============================================================

import { idSeguro } from '../../_lib/auth.js';

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

function nomeDoPlanoBonito(plano) {
  if (plano === 'cadastro') return 'Cadastro Básico';
  if (plano === 'destaque') return 'Destaque';
  return 'Profissional';
}

function diasDoPlano(plano) {
  return 30;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);
  const ASAAS_API_KEY = asaas.apiKey;
  const ASAAS_URL = asaas.url;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do Supabase ausente' }, 500);
  }

  console.log('🌍 Checkout em modo:', asaas.isSandbox ? 'SANDBOX' : 'PRODUÇÃO');

  try {
    const body = await request.json();
    const {
      nome, cpf, whatsapp, email,
      plano, formaPagamento,
      cupomCodigo
    } = body;

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

    // ---------- MODO "SÓ VALIDAR CUPOM" ----------
    if (body.validarApenas && cupomCodigo) {
      const valorBaseCheck = await lerPrecoPlano(env, plano);
      if (!valorBaseCheck) return jsonResp({ error: 'Preço não configurado' }, 500);

      const resultado = await validarCupom(env, cupomCodigo, plano, valorBaseCheck, cpfLimpo);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);

      return jsonResp({
        ok: true,
        modo: 'validar',
        desconto: resultado.desconto,
        valorBase: valorBaseCheck,
        valorFinal: Math.max(0, Math.round((valorBaseCheck - resultado.desconto) * 100) / 100),
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
      '&select=id,cpf,auth_user_id,whatsapp&limit=1',
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

    // ---------- 1. LÊ PREÇO BASE ----------
    const valorBase = await lerPrecoPlano(env, plano);
    if (!valorBase || valorBase <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado' }, 500);
    }

    // ---------- 2. VALIDA CUPOM ----------
    let desconto = 0;
    let cupomObj = null;

    if (cupomCodigo) {
      const resultado = await validarCupom(env, cupomCodigo, plano, valorBase, cpfLimpo);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);
      desconto = resultado.desconto;
      cupomObj = resultado.cupom;
    }

    const valorFinal = Math.max(0, Math.round((valorBase - desconto) * 100) / 100);

    // ============================================================
    // 🎁 CUPOM 100% → LIBERA SEM COBRANÇA (conta já criada no cadastro)
    // ============================================================
    if (valorFinal === 0) {
      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(plano));

      if (cuidadorId) {
        const patchBody = {
          status_pagamento: 'Pago',
          cupom_usado: cupomObj ? cupomObj.codigo : null,
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString(),
          proxima_cobranca: vence.toISOString()
        };

        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify(patchBody)
        });

        if (cupomObj) {
          await registrarUsoCupom(env, cupomObj, cuidadorId, plano, valorBase, desconto, valorFinal, null);
        }
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

    // ---------- 3. FLUXO NORMAL ----------
    if (!formaPagamento) {
      return jsonResp({ error: 'Forma de pagamento obrigatória' }, 400);
    }
    if (formaPagamento === 'CREDIT_CARD') {
      return jsonResp({
        error: 'O pagamento com cartão no cadastro foi desativado. Conclua pelo Pix. Depois, se quiser, cadastre o cartão no painel — em página hospedada do Asaas, nunca no site da Afeto.',
        codigo: 'CARTAO_DESATIVADO_NO_CADASTRO'
      }, 400);
    }
    if (formaPagamento !== 'PIX') {
      return jsonResp({ error: 'O cadastro aceita apenas Pix.' }, 400);
    }
    if (!ASAAS_API_KEY) {
      return jsonResp({ error: 'Chave do Asaas não configurada' }, 500);
    }

    // 🛡️ ANTES DE CRIAR NOVA COBRANÇA, VERIFICA SE JÁ TEM UMA ATIVA COM MESMO VALOR
    if (cuidadorId) {
      const cobrancaExistente = await verificarCobrancaAtiva(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId, valorFinal);
      if (cobrancaExistente) {
        console.log('♻️ Reutilizando cobrança existente:', cobrancaExistente.id);

        let pixData = null;
        const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaExistente.id + '/pixQrCode', {
          headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
        });
        if (pixResp.ok) pixData = await pixResp.json();

        return jsonResp({
          ok: true,
          gratis: false,
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

      await limparCobrancasAntigas(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId);
    }

    const customerId = await criarOuBuscarCliente(ASAAS_API_KEY, ASAAS_URL, {
      name: nome,
      cpfCnpj: cpfLimpo,
      mobilePhone: telefoneAsaas,
      email: email || undefined,
      externalReference: cuidadorId || undefined
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao criar cliente no Asaas' }, 502);
    }

    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    const descricaoCobranca = 'Afeto — Plano ' + nomeDoPlanoBonito(plano);

    const cobrancaBody = {
      customer: customerId,
      billingType: 'PIX',
      value: valorFinal,
      dueDate: dataVencimento,
      description: descricaoCobranca,
      externalReference: cuidadorId || undefined
    };

    const cobrancaResp = await fetch(ASAAS_URL + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY },
      body: JSON.stringify(cobrancaBody)
    });
    const cobrancaData = await cobrancaResp.json();

    if (!cobrancaResp.ok) {
      console.error('Falha cobrança Asaas:', cobrancaData);
      return jsonResp({ error: 'Não foi possível criar a cobrança. Tente novamente.' }, 502);
    }

    if (cuidadorId) {
      const updatePayload = {
        asaas_customer_id: customerId,
        asaas_cobranca_id: cobrancaData.id,
        cupom_usado: cupomObj ? cupomObj.codigo : null
      };

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId), {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(updatePayload)
      });
    }

    let pixData = null;
    const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaData.id + '/pixQrCode', {
      headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
    });
    if (pixResp.ok) pixData = await pixResp.json();

    return jsonResp({
      ok: true,
      gratis: false,
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

// ============================================================
// HELPERS
// ============================================================

async function lerPrecoPlano(env, plano) {
  const chave = plano === 'destaque' ? 'preco_destaque'
              : plano === 'profissional' ? 'preco_profissional'
              : plano === 'cadastro' ? 'preco_cadastro'
              : null;
  if (!chave) return null;

  try {
    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + encodeURIComponent(chave) + '&select=valor&limit=1', {
      headers: headersSupabase(env)
    });
    if (!resp.ok) return null;
    const linhas = await resp.json();
    if (!linhas || linhas.length === 0) return null;
    const valor = parseFloat(linhas[0].valor);
    return isNaN(valor) ? null : valor;
  } catch (err) {
    return null;
  }
}

// 🛡️ Valida cupom + verifica se o mesmo CPF já usou (evita fraude)
async function validarCupom(env, codigo, plano, valorBase, cpfLimpo) {
  const codigoLimpo = codigo.trim().toUpperCase();
  const url = env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(codigoLimpo) + '&select=*&limit=1';
  const resp = await fetch(url, { headers: headersSupabase(env) });

  if (!resp.ok) return { ok: false, erro: 'Erro ao consultar cupom' };
  const linhas = await resp.json();
  if (!linhas || linhas.length === 0) return { ok: false, erro: 'Cupom não encontrado' };

  const cupom = linhas[0];
  if (!cupom.ativo) return { ok: false, erro: 'Cupom inativo' };
  if (cupom.valido_ate && new Date(cupom.valido_ate) < new Date()) return { ok: false, erro: 'Cupom expirado' };
  if (cupom.usos_maximos && cupom.usos_atuais >= cupom.usos_maximos) return { ok: false, erro: 'Cupom esgotado' };

  if (cupom.plano_aplicavel && cupom.plano_aplicavel !== plano) {
    const nomes = { cadastro: 'Cadastro Básico', profissional: 'Profissional', destaque: 'Destaque' };
    return { ok: false, erro: 'Este cupom só vale pro plano ' + (nomes[cupom.plano_aplicavel] || cupom.plano_aplicavel) };
  }

  // 🛡️ Verifica se esse CPF já usou esse cupom (evita uso duplicado)
  if (cpfLimpo && cupom.id) {
    try {
      // Busca cuidadores com esse CPF
      const cpfComFormato = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      const buscaCpf = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?or=(cpf.eq.' + encodeURIComponent(cpfLimpo) + ',cpf.eq.' + encodeURIComponent(cpfComFormato) + ')&select=id&limit=1',
        { headers: headersSupabase(env) }
      );
      if (buscaCpf.ok) {
        const linhasCpf = await buscaCpf.json();
        if (linhasCpf && linhasCpf[0]) {
          const cuidadorId = linhasCpf[0].id;
          const jaUsouResp = await fetch(
            env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + encodeURIComponent(cupom.id) + '&cuidador_id=eq.' + encodeURIComponent(cuidadorId) + '&limit=1',
            { headers: headersSupabase(env) }
          );
          if (jaUsouResp.ok) {
            const usos = await jaUsouResp.json();
            if (usos && usos.length > 0) {
              return { ok: false, erro: 'Você já usou esse cupom' };
            }
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao verificar uso de cupom:', e);
    }
  }

  let desconto;
  if (cupom.tipo === 'percentual') {
    desconto = valorBase * (parseFloat(cupom.valor) / 100);
  } else {
    desconto = parseFloat(cupom.valor);
  }
  desconto = Math.min(desconto, valorBase);
  return { ok: true, cupom: cupom, desconto: Math.round(desconto * 100) / 100 };
}

async function registrarUsoCupom(env, cupom, cuidadorId, plano, valorBase, desconto, valorFinal, asaasPagamentoId) {
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/cupons_usos', {
      method: 'POST',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        cupom_id: cupom.id,
        cupom_codigo: cupom.codigo,
        cuidador_id: cuidadorId,
        plano: plano,
        valor_original: valorBase,
        valor_desconto: desconto,
        valor_final: valorFinal,
        asaas_pagamento_id: asaasPagamentoId || null
      })
    });
    await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + encodeURIComponent(cupom.id), {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({ usos_atuais: (cupom.usos_atuais || 0) + 1 })
    });
  } catch (err) { console.warn('Erro uso cupom:', err); }
}

// 🛡️ Deleta todas as cobranças antigas NÃO PAGAS do Asaas (evita duplicação)
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

// 🛡️ Verifica se já existe cobrança pendente com mesmo valor (evita duplicação)
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

    // Só reutiliza se ainda está pendente E tem o mesmo valor
    const statusValidos = ['PENDING', 'AWAITING_RISK_ANALYSIS'];
    if (statusValidos.indexOf(cobranca.status) === -1) return null;
    if (Math.abs(cobranca.value - valorEsperado) > 0.01) return null;

    return cobranca;
  } catch (e) {
    console.warn('Erro ao verificar cobrança ativa:', e);
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
  if (dados.email) criarBody.email = dados.email;
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