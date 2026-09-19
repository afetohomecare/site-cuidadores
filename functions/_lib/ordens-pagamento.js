import { headersSupabase, supabaseOk } from './supabase.js';

export function emCentavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

export async function criarOrdemMp(env, dados) {
  if (!supabaseOk(env)) return null;

  const clientId = String(dados.clientRequestId || '').trim();
  if (!clientId) {
    const pendente = await buscarOrdemPendenteGenerica(env, dados);
    if (pendente) return pendente;
  }
  const clientIdValido = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
  const ordemId = clientIdValido
    ? clientId
    : await uuidDeterministico([
        dados.cuidadorId,
        dados.plano,
        dados.produto || '',
        dados.forma,
        dados.tipo || 'avulso',
        emCentavos(dados.valorFinal),
        Math.floor(Date.now() / (15 * 60 * 1000))
      ].join('|'));
  const ordem = {
    id: ordemId,
    idempotency_key: crypto.randomUUID(),
    cuidador_id: String(dados.cuidadorId),
    plano: String(dados.plano || 'cadastro'),
    produto: String(dados.produto || ''),
    forma: String(dados.forma || '').toUpperCase(),
    tipo: String(dados.tipo || 'avulso'),
    valor_base_centavos: emCentavos(dados.valorBase),
    desconto_centavos: emCentavos(dados.desconto),
    valor_final_centavos: emCentavos(dados.valorFinal),
    cupom_codigo: dados.cupomCodigo || null,
    ambiente: dados.isSandbox ? 'sandbox' : 'producao',
    status: 'created',
    expira_em: dados.expiraEm || new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };

  const resp = await fetch(env.SUPABASE_URL + '/rest/v1/pagamentos_mp', {
    method: 'POST',
    headers: headersSupabase(env, true, true),
    body: JSON.stringify(ordem)
  });
  if (!resp.ok) {
    if (resp.status === 409) {
      const existente = await buscarOrdemMp(env, ordemId);
      const compativel = existente &&
        String(existente.cuidador_id) === String(ordem.cuidador_id) &&
        String(existente.plano) === String(ordem.plano) &&
        String(existente.forma) === String(ordem.forma) &&
        Number(existente.valor_final_centavos) === Number(ordem.valor_final_centavos);
      if (compativel) return existente;
    }
    console.error('Falha ao criar ordem Mercado Pago:', resp.status);
    return null;
  }
  const linhas = await resp.json();
  return linhas && linhas[0] ? linhas[0] : ordem;
}

async function uuidDeterministico(texto) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(texto))
  );
  const bytes = new Uint8Array(hash).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
    '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

async function buscarOrdemPendenteGenerica(env, dados) {
  const agora = new Date().toISOString();
  const produto = String(dados.produto || '');
  const url = env.SUPABASE_URL + '/rest/v1/pagamentos_mp' +
    '?cuidador_id=eq.' + encodeURIComponent(dados.cuidadorId) +
    '&plano=eq.' + encodeURIComponent(dados.plano || 'cadastro') +
    '&produto=eq.' + encodeURIComponent(produto) +
    '&forma=eq.' + encodeURIComponent(String(dados.forma || '').toUpperCase()) +
    '&tipo=eq.' + encodeURIComponent(String(dados.tipo || 'avulso')) +
    '&valor_final_centavos=eq.' + emCentavos(dados.valorFinal) +
    '&status=in.(created,pending)' +
    '&expira_em=gt.' + encodeURIComponent(agora) +
    '&select=*&order=criado_em.desc&limit=1';
  const resp = await fetch(url, { headers: headersSupabase(env) });
  if (!resp.ok) return null;
  const linhas = await resp.json();
  return linhas && linhas[0] ? linhas[0] : null;
}

export async function atualizarOrdemMp(env, ordemId, alteracoes) {
  if (!supabaseOk(env) || !ordemId) return false;
  const body = Object.assign({}, alteracoes, { atualizado_em: new Date().toISOString() });
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp?id=eq.' + encodeURIComponent(ordemId),
    {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify(body)
    }
  );
  return resp.ok;
}

export async function buscarOrdemMp(env, ordemId) {
  if (!supabaseOk(env) || !ordemId) return null;
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp?id=eq.' + encodeURIComponent(ordemId) + '&select=*&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!resp.ok) return null;
  const linhas = await resp.json();
  return linhas && linhas[0] ? linhas[0] : null;
}

export async function buscarPixPendenteMp(env, cuidadorId, plano, produto, valorFinal) {
  if (!supabaseOk(env)) return null;
  const agora = new Date().toISOString();
  const url = env.SUPABASE_URL + '/rest/v1/pagamentos_mp' +
    '?cuidador_id=eq.' + encodeURIComponent(cuidadorId) +
    '&plano=eq.' + encodeURIComponent(plano) +
    '&produto=eq.' + encodeURIComponent(produto || '') +
    '&forma=eq.PIX' +
    '&status=in.(pending,in_process)' +
    '&valor_final_centavos=eq.' + emCentavos(valorFinal) +
    '&expira_em=gt.' + encodeURIComponent(agora) +
    '&select=*&order=criado_em.desc&limit=1';
  const resp = await fetch(url, { headers: headersSupabase(env) });
  if (!resp.ok) return null;
  const linhas = await resp.json();
  return linhas && linhas[0] ? linhas[0] : null;
}

export async function reservarProcessamentoMp(env, ordemId, paymentId, status) {
  if (!supabaseOk(env) || !ordemId || !paymentId) return false;
  const agora = new Date().toISOString();
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp?id=eq.' + encodeURIComponent(ordemId) +
      '&processado_em=is.null&select=id',
    {
      method: 'PATCH',
      headers: Object.assign({}, headersSupabase(env, true, true), {
        'Prefer': 'return=representation'
      }),
      body: JSON.stringify({
        mp_payment_id: String(paymentId),
        status: String(status || 'approved'),
        processado_em: agora,
        atualizado_em: agora
      })
    }
  );
  if (!resp.ok) return false;
  const linhas = await resp.json();
  return !!(linhas && linhas[0]);
}

export async function reservarEventoPagamentoMp(env, ordemId, paymentId, status) {
  if (!supabaseOk(env) || !paymentId) return false;
  const agora = new Date().toISOString();
  const resp = await fetch(env.SUPABASE_URL + '/rest/v1/pagamentos_mp_processados', {
    method: 'POST',
    headers: Object.assign({}, headersSupabase(env, true, true), {
      'Prefer': 'resolution=ignore-duplicates,return=representation'
    }),
    body: JSON.stringify({
      mp_payment_id: String(paymentId),
      ordem_id: ordemId || null,
      status: 'processing:' + String(status || 'approved'),
      iniciado_em: agora
    })
  });
  if (!resp.ok) {
    console.error('Falha ao reservar evento Mercado Pago:', resp.status);
    throw new Error('Falha temporária ao reservar evento Mercado Pago.');
  }
  const linhas = await resp.json();
  if (linhas && linhas[0]) return true;

  const existenteResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp_processados?mp_payment_id=eq.' +
      encodeURIComponent(paymentId) + '&select=*&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!existenteResp.ok) {
    throw new Error('Falha temporária ao consultar evento Mercado Pago.');
  }
  const existentes = await existenteResp.json();
  const existente = existentes && existentes[0];
  if (!existente || existente.concluido_em) return false;
  const iniciou = new Date(existente.iniciado_em || 0).getTime();
  if (Date.now() - iniciou < 2 * 60 * 1000) return false;

  const takeoverResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp_processados?mp_payment_id=eq.' +
      encodeURIComponent(paymentId) +
      '&iniciado_em=eq.' + encodeURIComponent(existente.iniciado_em) +
      '&concluido_em=is.null&select=mp_payment_id',
    {
      method: 'PATCH',
      headers: Object.assign({}, headersSupabase(env, true, true), {
        'Prefer': 'return=representation'
      }),
      body: JSON.stringify({ iniciado_em: agora })
    }
  );
  if (!takeoverResp.ok) {
    throw new Error('Falha temporária ao retomar evento Mercado Pago.');
  }
  const retomadas = await takeoverResp.json();
  return !!(retomadas && retomadas[0]);
}

export async function concluirEventoPagamentoMp(env, paymentId) {
  if (!supabaseOk(env) || !paymentId) return false;
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp_processados?mp_payment_id=eq.' +
      encodeURIComponent(paymentId),
    {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        status: 'complete',
        concluido_em: new Date().toISOString()
      })
    }
  );
  return resp.ok;
}

export async function desfazerReservaEventoMp(env, paymentId) {
  if (!supabaseOk(env) || !paymentId) return false;
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/pagamentos_mp_processados?mp_payment_id=eq.' +
      encodeURIComponent(paymentId),
    {
      method: 'DELETE',
      headers: headersSupabase(env)
    }
  );
  return resp.ok;
}
