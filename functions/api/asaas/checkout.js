// ============================================================
// AFETO — API: cria cliente + cobrança no Asaas
// ------------------------------------------------------------
// Fluxo:
//   1. Lê preços da tabela config do Supabase (editável sem código)
//   2. Cria (ou reaproveita) cliente no Asaas
//   3. Cria a cobrança (Pix ou Cartão)
//   4. Grava asaas_customer_id e asaas_cobranca_id no Supabase
//   5. Se for Pix, busca o QR Code
// ============================================================

const ASAAS_URL = 'https://api-sandbox.asaas.com/v3'; // ⚠️ SANDBOX
// const ASAAS_URL = 'https://api.asaas.com/v3';       // PRODUÇÃO

export async function onRequestPost(context) {
  const { request, env } = context;
  const ASAAS_API_KEY = env.ASAAS_API_KEY;

  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'ASAAS_API_KEY não configurada no Cloudflare' }, 500);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do Supabase ausente' }, 500);
  }

  try {
    const body = await request.json();
    const {
      nome, cpf, whatsapp, email,
      plano, formaPagamento,
      creditCard, creditCardHolderInfo
    } = body;

    const cuidadorId = body.cuidadorId || body.recordIdAirtable;

    if (!nome || !cpf || !plano || !formaPagamento) {
      return jsonResp({ error: 'Campos obrigatórios: nome, cpf, plano, formaPagamento' }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp ? whatsapp.replace(/\D/g, '') : '';

    // ---------- 0. LÊ PREÇOS DA TABELA CONFIG ----------
    const valor = await lerPrecoPlano(env, plano);

    if (!valor || valor <= 0) {
      return jsonResp({ error: 'Preço do plano não configurado' }, 500);
    }

    // ---------- 1. CRIA CLIENTE NO ASAAS ----------
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

    // ---------- 2. CRIA COBRANÇA ----------
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 1);
    const dataVencimento = vencimento.toISOString().split('T')[0];

    const cobrancaBody = {
      customer: customerId,
      billingType: formaPagamento,
      value: valor,
      dueDate: dataVencimento,
      description: 'Plano ' + (plano === 'destaque' ? 'Destaque' : 'Profissional') + ' Afeto',
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
      return jsonResp({
        error: 'Falha ao criar cobrança',
        detalhe: cobrancaData
      }, 502);
    }

    // ---------- 3. GRAVA IDs DO ASAAS NO SUPABASE ----------
    if (cuidadorId) {
      try {
        const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId;
        const patchResp = await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            asaas_customer_id: customerId,
            asaas_cobranca_id: cobrancaData.id
          })
        });

        if (!patchResp.ok) {
          const txt = await patchResp.text();
          console.warn('Erro ao gravar IDs Asaas no Supabase:', patchResp.status, txt);
        }
      } catch (err) {
        console.warn('Erro PATCH Supabase:', err);
      }
    }

    // ---------- 4. SE FOR PIX, BUSCA O QR CODE ----------
    let pixData = null;
    if (formaPagamento === 'PIX') {
      const pixResp = await fetch(ASAAS_URL + '/payments/' + cobrancaData.id + '/pixQrCode', {
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

// ============================================================
// LÊ PREÇO DA TABELA CONFIG
// ============================================================
async function lerPrecoPlano(env, plano) {
  // Mapeia o nome do plano pro nome da chave na tabela config
  const chave = plano === 'destaque' ? 'preco_destaque'
              : plano === 'profissional' ? 'preco_profissional'
              : plano === 'cadastro' ? 'preco_cadastro'
              : null;

  if (!chave) return null;

  try {
    const url = env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + chave + '&select=valor&limit=1';
    const resp = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      console.error('Erro ao ler config:', resp.status);
      return null;
    }

    const linhas = await resp.json();
    if (!linhas || linhas.length === 0) return null;

    const valor = parseFloat(linhas[0].valor);
    return isNaN(valor) ? null : valor;

  } catch (err) {
    console.error('Erro ao buscar preço:', err);
    return null;
  }
}

// ============================================================
// HELPERS
// ============================================================
async function criarOuBuscarCliente(apiKey, dados) {
  const buscaResp = await fetch(ASAAS_URL + '/customers?cpfCnpj=' + dados.cpfCnpj, {
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

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}