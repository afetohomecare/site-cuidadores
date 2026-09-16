// ============================================================
// AFETO — API: cria cliente + cobrança no Asaas
// ------------------------------------------------------------
// Aceita cupom de desconto. Se o valor final for R$ 0,
// NÃO chama o Asaas — marca direto como Pago no Supabase.
//
// Planos (TODOS MENSAIS): 30 dias
//
// IMPORTANTE: quando uma nova cobrança é gerada pra um cuidador
// que já tinha uma cobrança ativa (ex: aplicar cupom depois),
// a cobrança antiga é DELETADA no Asaas — senão ficam 2 válidas.
// ============================================================

const ASAAS_URL = 'https://api.asaas.com/v3';

function diasDoPlano(plano) {
  return 30;
}

function nomeDoPlano(plano) {
  if (plano === 'cadastro') return 'Cadastro Básico';
  if (plano === 'destaque') return 'Destaque';
  return 'Profissional';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ASAAS_API_KEY = env.ASAAS_API_KEY;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do Supabase ausente' }, 500);
  }

  try {
    const body = await request.json();
    const {
      nome, cpf, whatsapp, email,
      plano, formaPagamento,
      creditCard, creditCardHolderInfo,
      cupomCodigo
    } = body;

    const cuidadorId = body.cuidadorId || body.recordIdAirtable;

    if (!nome || !cpf || !plano) {
      return jsonResp({ error: 'Campos obrigatórios: nome, cpf, plano' }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp ? whatsapp.replace(/\D/g, '') : '';

    // ---------- MODO "SÓ VALIDAR CUPOM" ----------
    if (body.validarApenas && cupomCodigo) {
      const valorBaseCheck = await lerPrecoPlano(env, plano);
      if (!valorBaseCheck) return jsonResp({ error: 'Preço não configurado' }, 500);

      const resultado = await validarCupom(env, cupomCodigo, plano, valorBaseCheck);
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

    // ---------- 1. LÊ PREÇO BASE ----------
    const valorBase = await lerPrecoPlano(env, plano);
    if (!valorBase || valorBase <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado' }, 500);
    }

    // ---------- 2. VALIDA CUPOM ----------
    let desconto = 0;
    let cupomObj = null;

    if (cupomCodigo) {
      const resultado = await validarCupom(env, cupomCodigo, plano, valorBase);
      if (!resultado.ok) return jsonResp({ error: resultado.erro }, 400);
      desconto = resultado.desconto;
      cupomObj = resultado.cupom;
    }

    const valorFinal = Math.max(0, Math.round((valorBase - desconto) * 100) / 100);

    // ---------- 3. SE 100% DESCONTO ----------
    if (valorFinal === 0) {
      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(plano));

      if (cuidadorId) {
        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify({
            status_pagamento: 'Pago',
            cupom_usado: cupomObj ? cupomObj.codigo : null,
            plano_inicio: agora.toISOString(),
            plano_valido_ate: vence.toISOString()
          })
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
        cuidadorId: cuidadorId
      }, 200);
    }

    // ---------- 4. FLUXO NORMAL ----------
    if (!formaPagamento) {
      return jsonResp({ error: 'Forma de pagamento obrigatória' }, 400);
    }
    if (!ASAAS_API_KEY) {
      return jsonResp({ error: 'ASAAS_API_KEY não configurada' }, 500);
    }

    // ⭐ DELETA COBRANÇA ANTIGA (se existir e não estiver paga)
    if (cuidadorId) {
      try {
        const cResp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=asaas_cobranca_id,status_pagamento&limit=1',
          { headers: headersSupabase(env) }
        );
        if (cResp.ok) {
          const cData = await cResp.json();
          const antigaCobrancaId = cData[0] && cData[0].asaas_cobranca_id;
          const statusAtual = cData[0] && cData[0].status_pagamento;

          if (antigaCobrancaId && statusAtual !== 'Pago') {
            const delResp = await fetch(ASAAS_URL + '/payments/' + antigaCobrancaId, {
              method: 'DELETE',
              headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
            });
            if (delResp.ok) {
              console.log('✅ Cobrança antiga deletada:', antigaCobrancaId);
            } else {
              console.warn('⚠️ Não foi possível deletar cobrança antiga:', antigaCobrancaId, delResp.status);
            }
          }
        }
      } catch (e) {
        console.warn('Erro ao deletar cobrança antiga:', e);
      }
    }

    const customerId = await criarOuBuscarCliente(ASAAS_API_KEY, {
      name: nome,
      cpfCnpj: cpfLimpo,
      mobilePhone: whatsLimpo,
      email: email || undefined,
      externalReference: cuidadorId || undefined
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao criar cliente no Asaas' }, 502);
    }

    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    // ============================================================
    // ⭐ DESCRIÇÃO DA COBRANÇA (o que aparece no app do banco)
    // ------------------------------------------------------------
    // Esse texto vira a "mensagem" que a cliente vê ao pagar o PIX.
    // Deixei curto pra caber em todos os bancos.
    //
    // Se o emoji 💜 der problema, tira e deixa só:
    //   'Plano Afeto - Wagner Frankowski'
    // ============================================================
    const descricaoCobranca = '💜 Plano Afeto - Wagner Frankowski';

    const cobrancaBody = {
      customer: customerId,
      billingType: formaPagamento,
      value: valorFinal,
      dueDate: dataVencimento,
      description: descricaoCobranca,
      externalReference: cuidadorId || undefined
    };

    if (formaPagamento === 'CREDIT_CARD') {
      if (!creditCard || !creditCardHolderInfo) {
        return jsonResp({ error: 'Dados do cartão obrigatórios' }, 400);
      }
      cobrancaBody.creditCard = creditCard;
      cobrancaBody.creditCardHolderInfo = creditCardHolderInfo;
    }

    const cobrancaResp = await fetch(ASAAS_URL + '/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Afeto/1.0',
        'access_token': ASAAS_API_KEY
      },
      body: JSON.stringify(cobrancaBody)
    });

    const cobrancaData = await cobrancaResp.json();

    if (!cobrancaResp.ok) {
      console.error('Asaas cobrança erro:', JSON.stringify(cobrancaData));
      return jsonResp({ error: 'Falha ao criar cobrança', detalhe: cobrancaData }, 502);
    }

    if (cuidadorId) {
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          asaas_customer_id: customerId,
          asaas_cobranca_id: cobrancaData.id,
          cupom_usado: cupomObj ? cupomObj.codigo : null
        })
      });
    }

    let pixData = null;
    if (formaPagamento === 'PIX') {
      const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaData.id + '/pixQrCode', {
        headers: {
          'User-Agent': 'Afeto/1.0',
          'access_token': ASAAS_API_KEY
        }
      });
      if (pixResp.ok) pixData = await pixResp.json();
    }

    const pagoNaHora = formaPagamento === 'CREDIT_CARD'
      && (cobrancaData.status === 'CONFIRMED' || cobrancaData.status === 'RECEIVED');

    if (pagoNaHora && cuidadorId) {
      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(plano));

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          status_pagamento: 'Pago',
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString()
        })
      });

      if (cupomObj) {
        await registrarUsoCupom(env, cupomObj, cuidadorId, plano, valorBase, desconto, valorFinal, cobrancaData.id);
      }
    }

    return jsonResp({
      ok: true,
      gratis: false,
      cobrancaId: cobrancaData.id,
      invoiceUrl: cobrancaData.invoiceUrl,
      status: cobrancaData.status,
      valorBase: valorBase,
      valorFinal: valorFinal,
      desconto: desconto,
      pagoNaHora: pagoNaHora,
      pix: pixData ? {
        qrCodeImage: pixData.encodedImage,
        copiaECola: pixData.payload
      } : null
    }, 200);

  } catch (err) {
    console.error('Erro checkout:', err);
    return jsonResp({ error: 'Falha no processamento', detalhe: String(err.message) }, 500);
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
    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + chave + '&select=valor&limit=1', {
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

async function validarCupom(env, codigo, plano, valorBase) {
  const codigoLimpo = codigo.trim().toUpperCase();

  const url = env.SUPABASE_URL + '/rest/v1/cupons?codigo=eq.' + encodeURIComponent(codigoLimpo) + '&select=*&limit=1';
  const resp = await fetch(url, { headers: headersSupabase(env) });

  if (!resp.ok) return { ok: false, erro: 'Erro ao consultar cupom' };
  const linhas = await resp.json();
  if (!linhas || linhas.length === 0) return { ok: false, erro: 'Cupom não encontrado' };

  const cupom = linhas[0];

  if (!cupom.ativo) return { ok: false, erro: 'Cupom inativo' };

  if (cupom.valido_ate && new Date(cupom.valido_ate) < new Date()) {
    return { ok: false, erro: 'Cupom expirado' };
  }

  if (cupom.usos_maximos && cupom.usos_atuais >= cupom.usos_maximos) {
    return { ok: false, erro: 'Cupom esgotado' };
  }

  if (cupom.plano_aplicavel && cupom.plano_aplicavel !== plano) {
    const nomes = { cadastro: 'Cadastro Básico', profissional: 'Profissional', destaque: 'Destaque' };
    return { ok: false, erro: 'Este cupom só vale pro plano ' + (nomes[cupom.plano_aplicavel] || cupom.plano_aplicavel) };
  }

  let desconto;
  if (cupom.tipo === 'percentual') {
    desconto = valorBase * (parseFloat(cupom.valor) / 100);
  } else {
    desconto = parseFloat(cupom.valor);
  }
  desconto = Math.min(desconto, valorBase);
  desconto = Math.round(desconto * 100) / 100;

  return { ok: true, cupom: cupom, desconto: desconto };
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

    await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + cupom.id, {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        usos_atuais: (cupom.usos_atuais || 0) + 1
      })
    });
  } catch (err) {
    console.warn('Erro ao registrar uso do cupom:', err);
  }
}

async function criarOuBuscarCliente(apiKey, dados) {
  const buscaResp = await fetch(ASAAS_URL + '/customers?cpfCnpj=' + dados.cpfCnpj, {
    headers: { 'User-Agent': 'Afeto/1.0', 'access_token': apiKey }
  });

  if (buscaResp.ok) {
    const buscaData = await buscaResp.json();
    if (buscaData.data && buscaData.data.length > 0) {
      return buscaData.data[0].id;
    }
  }

  const criarBody = { name: dados.name, cpfCnpj: dados.cpfCnpj };
  if (dados.mobilePhone) criarBody.mobilePhone = dados.mobilePhone;
  if (dados.email) criarBody.email = dados.email;
  if (dados.externalReference) criarBody.externalReference = dados.externalReference;

  const criarResp = await fetch(ASAAS_URL + '/customers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': apiKey
    },
    body: JSON.stringify(criarBody)
  });

  const criarData = await criarResp.json();
  if (!criarResp.ok) {
    console.error('Erro criar cliente:', JSON.stringify(criarData));
    return null;
  }
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
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}