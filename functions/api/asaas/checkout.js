// functions/api/asaas/checkout.js
// Cria cliente no Asaas + cobrança Pix ou Cartão

const ASAAS_URL = 'https://api-sandbox.asaas.com/v3'; // ⚠️ SANDBOX (teste)
// const ASAAS_URL = 'https://api.asaas.com/v3';      // PRODUÇÃO (trocar depois)

export async function onRequestPost(context) {
  const { request, env } = context;
  const ASAAS_API_KEY = env.ASAAS_API_KEY;

  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'ASAAS_API_KEY não configurada no Cloudflare' }, 500);
  }

  try {
    const body = await request.json();
    const {
      nome, cpf, whatsapp, email,
      plano, recordIdAirtable,
      formaPagamento,
      creditCard, creditCardHolderInfo
    } = body;

    if (!nome || !cpf || !plano || !formaPagamento) {
      return jsonResp({ error: 'Campos obrigatórios: nome, cpf, plano, formaPagamento' }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp ? whatsapp.replace(/\D/g, '') : '';

    const valor = plano === 'destaque' ? 69.90 : 24.90;

    // ========== 1. CRIA CLIENTE NO ASAAS ==========
    const customerId = await criarOuBuscarCliente(ASAAS_API_KEY, {
      name: nome,
      cpfCnpj: cpfLimpo,
      mobilePhone: whatsLimpo,
      email: email || undefined,
      externalReference: recordIdAirtable || undefined
    });

    if (!customerId) {
      return jsonResp({ error: 'Falha ao criar cliente no Asaas' }, 502);
    }

    // ========== 2. CRIA COBRANÇA ==========
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    const cobrancaBody = {
      customer: customerId,
      billingType: formaPagamento,
      value: valor,
      dueDate: dataVencimento,
      description: `Plano ${plano === 'destaque' ? 'Destaque' : 'Profissional'} Afeto`,
      externalReference: recordIdAirtable || undefined
    };

    if (formaPagamento === 'CREDIT_CARD') {
      if (!creditCard || !creditCardHolderInfo) {
        return jsonResp({ error: 'Dados do cartão obrigatórios' }, 400);
      }
      cobrancaBody.creditCard = creditCard;
      cobrancaBody.creditCardHolderInfo = creditCardHolderInfo;
    }

    const cobrancaResp = await fetch(`${ASAAS_URL}/payments`, {
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
      return jsonResp({
        error: 'Falha ao criar cobrança',
        detalhe: cobrancaData
      }, 502);
    }

    // ========== 3. SE FOR PIX, BUSCA O QR CODE ==========
    let pixData = null;
    if (formaPagamento === 'PIX') {
      const pixResp = await fetch(`${ASAAS_URL}/payments/${cobrancaData.id}/pixQrCode`, {
        headers: {
          'User-Agent': 'Afeto/1.0',
          'access_token': ASAAS_API_KEY
        }
      });

      if (pixResp.ok) {
        pixData = await pixResp.json();
      } else {
        console.warn('Erro ao buscar QR Code:', await pixResp.text());
      }
    }

    return jsonResp({
      ok: true,
      cobrancaId: cobrancaData.id,
      invoiceUrl: cobrancaData.invoiceUrl,
      status: cobrancaData.status,
      valor: valor,
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

async function criarOuBuscarCliente(apiKey, dados) {
  const buscaResp = await fetch(`${ASAAS_URL}/customers?cpfCnpj=${dados.cpfCnpj}`, {
    headers: {
      'User-Agent': 'Afeto/1.0',
      'access_token': apiKey
    }
  });

  if (buscaResp.ok) {
    const buscaData = await buscaResp.json();
    if (buscaData.data && buscaData.data.length > 0) {
      return buscaData.data[0].id;
    }
  }

  const criarBody = {
    name: dados.name,
    cpfCnpj: dados.cpfCnpj
  };
  if (dados.mobilePhone) criarBody.mobilePhone = dados.mobilePhone;
  if (dados.email) criarBody.email = dados.email;
  if (dados.externalReference) criarBody.externalReference = dados.externalReference;

  const criarResp = await fetch(`${ASAAS_URL}/customers`, {
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

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}