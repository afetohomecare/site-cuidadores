// functions/api/asaas/status.js
// Consulta o status de uma cobrança no Asaas (usado no polling da tela de checkout)

const ASAAS_URL = 'https://api.asaas.com/v3';  // ✅ PRODUÇÃO

export async function onRequestGet(context) {
  const { request, env } = context;
  const ASAAS_API_KEY = env.ASAAS_API_KEY;

  if (!ASAAS_API_KEY) {
    return jsonResp({ error: 'ASAAS_API_KEY não configurada' }, 500);
  }

  try {
    const url = new URL(request.url);
    const cobrancaId = url.searchParams.get('id');

    if (!cobrancaId) {
      return jsonResp({ error: 'Parâmetro ?id= obrigatório' }, 400);
    }

    const resp = await fetch(`${ASAAS_URL}/payments/${cobrancaId}`, {
      headers: {
        'User-Agent': 'Afeto/1.0',
        'access_token': ASAAS_API_KEY
      }
    });

    // Lê como texto primeiro pra não quebrar se vier vazio
    const texto = await resp.text();

    let data = null;
    try {
      data = JSON.parse(texto);
    } catch (e) {
      // Asaas respondeu algo que não é JSON — devolve o que veio pra debug
      return jsonResp({
        ok: false,
        debug: 'Asaas respondeu em formato inesperado',
        status_asaas: resp.status,
        corpo_recebido: texto.substring(0, 500),
        dica: 'Se o corpo estiver vazio (status 401), a chave API está errada ou tem caractere extra.'
      }, 502);
    }

    if (!resp.ok) {
      console.error('Asaas status erro:', JSON.stringify(data));
      return jsonResp({
        ok: false,
        status_asaas: resp.status,
        resposta_asaas: data
      }, 502);
    }

    const pago = data.status === 'RECEIVED' || data.status === 'CONFIRMED';

    return jsonResp({
      ok: true,
      cobrancaId: data.id,
      status: data.status,
      pago: pago,
      valor: data.value,
      formaPagamento: data.billingType
    }, 200);

  } catch (err) {
    console.error('Erro status:', err);
    return jsonResp({
      ok: false,
      error: 'Falha no processamento',
      detalhe: String(err.message)
    }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}