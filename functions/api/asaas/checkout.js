// ============================================================
// AFETO — API: cria cliente + cobrança/assinatura no Asaas
// ------------------------------------------------------------
// PIX = Cobrança Avulsa (/payments)
// Cartão = Assinatura Mensal (/subscriptions)
//
// 🌍 AMBIENTE: controlado por env.ASAAS_AMBIENTE
//
// 🛡️ BLINDAGENS:
//   • Gera token de criar senha quando cupom zera valor
//   • Deleta cobrança antiga antes de criar nova
//   • Evita duplicação de cobranças
// ============================================================

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

function gerarToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
    // 🎁 CUPOM 100% → LIBERA SEM COBRANÇA (e gera token de senha!)
    // ============================================================
    if (valorFinal === 0) {
      const agora = new Date();
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(plano));

      if (cuidadorId) {
        // Gera token de criar senha (a cuidadora vai precisar)
        const token = gerarToken();
        const expiraToken = new Date(agora);
        expiraToken.setHours(expiraToken.getHours() + 1);

        // Verifica se já tem senha criada — se sim, não gera token
        const buscaCuidadora = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=auth_user_id&limit=1',
          { headers: headersSupabase(env) }
        );
        let jaTemSenha = false;
        if (buscaCuidadora.ok) {
          const linhas = await buscaCuidadora.json();
          jaTemSenha = !!(linhas[0] && linhas[0].auth_user_id);
        }

        const patchBody = {
          status_pagamento: 'Pago',
          cupom_usado: cupomObj ? cupomObj.codigo : null,
          plano_inicio: agora.toISOString(),
          plano_valido_ate: vence.toISOString(),
          proxima_cobranca: vence.toISOString()
        };

        if (!jaTemSenha) {
          patchBody.token_criar_senha = token;
          patchBody.token_criar_senha_expira_em = expiraToken.toISOString();
        }

        await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
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
        jaTemSenha: false
      }, 200);
    }

    // ---------- 3. FLUXO NORMAL ----------
    if (!formaPagamento) {
      return jsonResp({ error: 'Forma de pagamento obrigatória' }, 400);
    }
    if (!ASAAS_API_KEY) {
      return jsonResp({ error: 'Chave do Asaas não configurada' }, 500);
    }

    // 🛡️ DELETA COBRANÇAS ANTIGAS NÃO PAGAS (evita duplicação)
    if (cuidadorId) {
      await limparCobrancasAntigas(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId);
    }

    // 🛡️ ANTES DE CRIAR NOVA COBRANÇA, VERIFICA SE JÁ TEM UMA ATIVA COM MESMO VALOR
    if (cuidadorId) {
      const cobrancaExistente = await verificarCobrancaAtiva(env, ASAAS_URL, ASAAS_API_KEY, cuidadorId, valorFinal);
      if (cobrancaExistente) {
        console.log('♻️ Reutilizando cobrança existente:', cobrancaExistente.id);

        let pixData = null;
        if (formaPagamento === 'PIX') {
          const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaExistente.id + '/pixQrCode', {
            headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
          });
          if (pixResp.ok) pixData = await pixResp.json();
        }

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
    }

    const customerId = await criarOuBuscarCliente(ASAAS_API_KEY, ASAAS_URL, {
      name: nome,
      cpfCnpj: cpfLimpo,
      mobilePhone: whatsLimpo,
      email: email || undefined,
      externalReference: cuidadorId || undefined
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao criar cliente no Asaas' }, 502);
    }

    const agora = new Date();
    const dataHoje = agora.toISOString().split('T')[0];
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    const descricaoCobranca = 'Afeto — Plano ' + nomeDoPlanoBonito(plano);

    let cobrancaData;
    let isSubscription = false;

    if (formaPagamento === 'CREDIT_CARD') {
      isSubscription = true;
      if (!creditCard) return jsonResp({ error: 'Dados do cartão obrigatórios' }, 400);

      const titularCartao = {
        name: nome,
        email: email || 'contato@afetocuidadores.com.br',
        cpfCnpj: cpfLimpo,
        postalCode: '80020-000',
        addressNumber: '1',
        phone: whatsLimpo || '41999999999'
      };

      const subBody = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: valorFinal,
        nextDueDate: dataHoje,
        cycle: 'MONTHLY',
        description: descricaoCobranca,
        externalReference: cuidadorId || undefined,
        creditCard: creditCard,
        creditCardHolderInfo: titularCartao
      };

      const subResp = await fetch(ASAAS_URL + '/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY },
        body: JSON.stringify(subBody)
      });
      cobrancaData = await subResp.json();

      if (!subResp.ok) {
        return jsonResp({ error: 'Falha ao criar assinatura', detalhe: cobrancaData }, 502);
      }
    } else {
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
      cobrancaData = await cobrancaResp.json();

      if (!cobrancaResp.ok) {
        return jsonResp({ error: 'Falha ao criar cobrança', detalhe: cobrancaData }, 502);
      }
    }

    if (cuidadorId) {
      const updatePayload = {
        asaas_customer_id: customerId,
        cupom_usado: cupomObj ? cupomObj.codigo : null
      };

      if (isSubscription) {
        updatePayload.asaas_subscription_id = cobrancaData.id;
      } else {
        updatePayload.asaas_cobranca_id = cobrancaData.id;
      }

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(updatePayload)
      });
    }

    let pixData = null;
    if (formaPagamento === 'PIX') {
      const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaData.id + '/pixQrCode', {
        headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
      });
      if (pixResp.ok) pixData = await pixResp.json();
    }

    const pagoNaHora = isSubscription && cobrancaData.status === 'ACTIVE';

    if (pagoNaHora && cuidadorId) {
      const vence = new Date(agora);
      vence.setDate(vence.getDate() + diasDoPlano(plano));

      // Verifica se já tem senha
      const buscaCuidadora = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=auth_user_id&limit=1',
        { headers: headersSupabase(env) }
      );
      let jaTemSenha = false;
      if (buscaCuidadora.ok) {
        const linhas = await buscaCuidadora.json();
        jaTemSenha = !!(linhas[0] && linhas[0].auth_user_id);
      }

      const patchBody = {
        status_pagamento: 'Pago',
        plano_inicio: agora.toISOString(),
        plano_valido_ate: vence.toISOString(),
        proxima_cobranca: vence.toISOString()
      };

      if (!jaTemSenha) {
        const token = gerarToken();
        const expiraToken = new Date(agora);
        expiraToken.setHours(expiraToken.getHours() + 1);
        patchBody.token_criar_senha = token;
        patchBody.token_criar_senha_expira_em = expiraToken.toISOString();
      }

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(patchBody)
      });

      if (cupomObj) {
        await registrarUsoCupom(env, cupomObj, cuidadorId, plano, valorBase, desconto, valorFinal, cobrancaData.id);
      }
    }

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
      pagoNaHora: pagoNaHora,
      isSubscription: isSubscription,
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
            env.SUPABASE_URL + '/rest/v1/cupons_usos?cupom_id=eq.' + cupom.id + '&cuidador_id=eq.' + cuidadorId + '&limit=1',
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
    await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + cupom.id, {
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
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=asaas_cobranca_id,status_pagamento&limit=1',
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

      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId, {
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
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=asaas_cobranca_id&limit=1',
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