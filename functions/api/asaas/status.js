// functions/api/asaas/status.js
// Consulta o status de uma cobrança no Asaas (usado no polling da tela de checkout)

const ASAAS_URL = 'https://api-sandbox.asaas.com/v3'; // ⚠️ SANDBOX
// const ASAAS_URL = 'https://api.asaas.com/v3';      // PRODUÇÃO (trocar depois)

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

    const data = await resp.json();

    if (!resp.ok) {
      console.error('Asaas status erro:', JSON.stringify(data));
      return jsonResp({ error: 'Falha ao consultar status', detalhe: data }, 502);
    }

    // Status possíveis do Asaas:
    // PENDING, AWAITING_RISK_ANALYSIS, APPROVED_BY_RISK_ANALYSIS,
    // RECEIVED (pago), CONFIRMED (pago), OVERDUE, REFUNDED, etc.
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
    return jsonResp({ error: 'Falha no processamento', detalhe: String(err.message) }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}