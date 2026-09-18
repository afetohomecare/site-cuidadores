// ============================================================
// AFETO — API Painel: PIX de regularização + cartão via Asaas Checkout
// ------------------------------------------------------------
// Ações (body.acao):
//   • "pix"    → gera cobrança PIX no Asaas (sem cartão no nosso domínio)
//   • "cartao" → cria Checkout hospedado do Asaas (CREDIT_CARD + RECURRENT)
// ============================================================

function getAsaasConfig(env) {
  const ambiente = (env.ASAAS_AMBIENTE || 'producao').toLowerCase();
  const isSandbox = ambiente === 'sandbox';
  return {
    url: isSandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3',
    apiKey: isSandbox
      ? (env.ASAAS_API_KEY_SANDBOX || env.ASAAS_API_KEY)
      : (env.ASAAS_API_KEY_PRODUCAO || env.ASAAS_API_KEY),
    isSandbox: isSandbox,
    siteBase: 'https://afetocuidadores.pages.dev'
  };
}

function nomeDoPlanoBonito(plano) {
  if (plano === 'cadastro') return 'Cadastro Básico';
  if (plano === 'destaque') return 'Destaque';
  return 'Profissional';
}

function detectarPlano(c) {
  if (c.plano_destaque) return 'destaque';
  if (c.plano_profissional) return 'profissional';
  return 'cadastro';
}

function precisaRegularizar(c) {
  if (c.status_pagamento === 'Inadimplente' || c.status_pagamento === 'Estornado') return true;
  if (c.status_pagamento !== 'Pago') return true;
  if (!c.plano_valido_ate) return true;
  return new Date(c.plano_valido_ate).getTime() <= Date.now();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const asaas = getAsaasConfig(env);
  const ASAAS_URL = asaas.url;
  const ASAAS_API_KEY = asaas.apiKey;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }
  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'Asaas não configurado.' }, 500);
  }

  try {
    const cuidadoraAuth = await validarToken(env, request);
    if (!cuidadoraAuth) return jsonResp({ error: 'Não autenticado.' }, 401);

    const body = await request.json().catch(function () { return {}; });
    const acao = String(body.acao || '').toLowerCase();
    if (acao !== 'pix' && acao !== 'cartao') {
      return jsonResp({ error: 'Ação inválida. Use "pix" ou "cartao".' }, 400);
    }

    const respBd = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadoraAuth.id) +
      '&select=id,nome,cpf,whatsapp,status_pagamento,plano_valido_ate,plano_cadastro,plano_profissional,plano_destaque,asaas_customer_id,asaas_subscription_id,asaas_cobranca_id&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!respBd.ok) return jsonResp({ error: 'Falha ao buscar cadastro.' }, 502);
    const linhas = await respBd.json();
    const c = linhas && linhas[0];
    if (!c) return jsonResp({ error: 'Cadastro não encontrado.' }, 404);

    const plano = detectarPlano(c);
    const valor = await lerPrecoPlano(env, plano);
    if (!valor || valor <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado.' }, 500);
    }

    const cpfLimpo = String(c.cpf || '').replace(/\D/g, '');
    const whatsLimpo = String(c.whatsapp || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF inválido no cadastro. Fale com o suporte.' }, 400);
    }

    let customerId = c.asaas_customer_id || null;
    if (!customerId) {
      customerId = await criarOuBuscarCliente(ASAAS_API_KEY, ASAAS_URL, {
        name: c.nome,
        cpfCnpj: cpfLimpo,
        mobilePhone: whatsLimpo || undefined,
        externalReference: c.id
      });
      if (!customerId) return jsonResp({ error: 'Falha ao preparar cliente no Asaas.' }, 502);
      await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify({ asaas_customer_id: customerId })
      });
    }

    if (acao === 'pix') {
      return await criarPixRegularizacao(env, asaas, c, customerId, plano, valor);
    }

    return await criarCheckoutCartao(env, asaas, c, customerId, plano, valor, cpfLimpo, whatsLimpo);
  } catch (err) {
    console.error('Erro painel/pagamento:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function criarPixRegularizacao(env, asaas, c, customerId, plano, valor) {
  const ASAAS_URL = asaas.url;
  const ASAAS_API_KEY = asaas.apiKey;

  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 1);
  const dataVencimento = vencimento.toISOString().split('T')[0];

  const cobrancaResp = await fetch(ASAAS_URL + '/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': ASAAS_API_KEY
    },
    body: JSON.stringify({
      customer: customerId,
      billingType: 'PIX',
      value: valor,
      dueDate: dataVencimento,
      description: 'Afeto — Regularização Plano ' + nomeDoPlanoBonito(plano),
      externalReference: c.id
    })
  });
  const cobrancaData = await cobrancaResp.json();
  if (!cobrancaResp.ok) {
    console.error('Falha PIX painel:', cobrancaData);
    return jsonResp({ error: 'Não foi possível gerar o Pix agora. Tente de novo.' }, 502);
  }

  await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
    method: 'PATCH',
    headers: headersSupabase(env, true),
    body: JSON.stringify({ asaas_cobranca_id: cobrancaData.id })
  });

  let pixData = null;
  const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaData.id + '/pixQrCode', {
    headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
  });
  if (pixResp.ok) pixData = await pixResp.json();

  return jsonResp({
    ok: true,
    acao: 'pix',
    cobrancaId: cobrancaData.id,
    valor: valor,
    plano: plano,
    pix: pixData ? {
      qrCodeImage: pixData.encodedImage,
      copiaECola: pixData.payload
    } : null
  }, 200);
}

async function criarCheckoutCartao(env, asaas, c, customerId, plano, valor, cpfLimpo, whatsLimpo) {
  const ASAAS_URL = asaas.url;
  const ASAAS_API_KEY = asaas.apiKey;
  const siteBase = asaas.siteBase;

  // Se já tem assinatura ativa no Asaas, evita criar outra sem cancelar
  if (c.asaas_subscription_id) {
    try {
      await fetch(ASAAS_URL + '/subscriptions/' + encodeURIComponent(c.asaas_subscription_id), {
        method: 'DELETE',
        headers: { 'User-Agent': 'Afeto/1.0', 'access_token': ASAAS_API_KEY }
      });
    } catch (e) {
      console.warn('Falha ao cancelar assinatura antiga antes do checkout:', e);
    }
    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(c.id), {
      method: 'PATCH',
      headers: headersSupabase(env, true),
      body: JSON.stringify({ asaas_subscription_id: null })
    });
  }

  const regularizar = precisaRegularizar(c);
  let nextDue = new Date();
  if (!regularizar && c.plano_valido_ate) {
    const fim = new Date(c.plano_valido_ate);
    if (fim.getTime() > Date.now()) nextDue = fim;
  }
  const nextDueDate = nextDue.toISOString().slice(0, 19).replace('T', ' ');

  const checkoutBody = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: 60,
    externalReference: c.id,
    callback: {
      successUrl: siteBase + '/painel.html?pagamento=cartao_ok',
      cancelUrl: siteBase + '/painel.html?pagamento=cartao_cancelado',
      expiredUrl: siteBase + '/painel.html?pagamento=cartao_expirado'
    },
    items: [{
      name: 'Afeto — Plano ' + nomeDoPlanoBonito(plano),
      description: regularizar
        ? 'Regularização e cobranças automáticas mensais'
        : 'Cobranças automáticas do plano Afeto',
      quantity: 1,
      value: valor
    }],
    customerData: {
      name: c.nome || 'Cuidadora Afeto',
      cpfCnpj: cpfLimpo,
      email: cpfLimpo + '@afeto.app',
      phone: whatsLimpo || '41999999999',
      postalCode: '80020000',
      address: 'Centro',
      addressNumber: '1',
      province: 'Centro',
      city: 4106902
    },
    subscription: {
      cycle: 'MONTHLY',
      nextDueDate: nextDueDate
    }
  };

  const checkoutResp = await fetch(ASAAS_URL + '/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Afeto/1.0',
      'access_token': ASAAS_API_KEY,
      'accept': 'application/json'
    },
    body: JSON.stringify(checkoutBody)
  });
  const checkoutData = await checkoutResp.json();
  if (!checkoutResp.ok) {
    console.error('Falha checkout Asaas cartão:', checkoutData);
    return jsonResp({
      error: 'Não foi possível abrir o cadastro de cartão no Asaas agora. Tente de novo ou use Pix.'
    }, 502);
  }

  const link = checkoutData.link
    || (asaas.isSandbox
      ? ('https://sandbox.asaas.com/checkoutSession/show/' + checkoutData.id)
      : ('https://asaas.com/checkoutSession/show/' + checkoutData.id));

  return jsonResp({
    ok: true,
    acao: 'cartao',
    checkoutId: checkoutData.id,
    link: link,
    valor: valor,
    plano: plano,
    regularizar: regularizar,
    mensagem: 'Você será redirecionada para o ambiente seguro do Asaas.'
  }, 200);
}

async function lerPrecoPlano(env, plano) {
  const chave = plano === 'destaque' ? 'preco_destaque'
              : plano === 'profissional' ? 'preco_profissional'
              : 'preco_cadastro';
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

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + token }
  });
  if (!userResp.ok) return null;
  const userData = await userResp.json();

  const buscaResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' + encodeURIComponent(userData.id) + '&select=id&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  return linhas && linhas.length > 0 ? linhas[0] : null;
}

function headersSupabase(env, temBody) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
