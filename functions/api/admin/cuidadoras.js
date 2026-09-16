// ============================================================
// AFETO — API Admin: gerenciar cuidadoras
// ------------------------------------------------------------
// ⭐ SEGURANÇA: só aceita user com role === 'admin' no metadata
// ============================================================

const CAMPOS_PERMITIDOS = [
  'aprovada', 'status_pagamento', 'disponivel', 'verificada',
  'categoria', 'nota', 'horas', 'comentarios',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate'
];

const CAMPOS_LISTA = [
  'id', 'nome', 'whatsapp', 'whatsapp_agencia', 'email', 'cpf', 'coren',
  'foto_url', 'apresentacao', 'especialidade', 'experiencia',
  'bairro', 'bairros', 'preco', 'turno', 'cursos', 'subespecialidades',
  'categoria', 'nota', 'horas', 'verificada', 'disponivel',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate',
  'status_pagamento', 'aprovada', 'comentarios', 'indicado_por',
  'asaas_customer_id', 'asaas_cobranca_id', 'cupom_usado',
  'criado_em', 'atualizado_em'
];

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { ok: false, motivo: 'Token ausente' };

  const resp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });

  if (!resp.ok) return { ok: false, motivo: 'Token inválido ou expirado' };
  const user = await resp.json();

  // ⭐ VALIDA ROLE — só admin passa
  const role = user && user.user_metadata && user.user_metadata.role;
  if (role !== 'admin') {
    return { ok: false, motivo: 'Acesso restrito a administradores' };
  }

  return { ok: true, user: user };
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

// Decide o vencimento baseado no plano do cuidador
function diasDoPlano(campos) {
  if (campos.plano_cadastro === true) return 30;
  return 30;
}

// ============================================================
// GET — LISTAR
// ============================================================
export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await validarToken(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  try {
    const url = new URL(request.url);
    const id     = url.searchParams.get('id');
    const filtro = url.searchParams.get('filtro');
    const busca  = url.searchParams.get('busca');
    const bairro = url.searchParams.get('bairro');
    const plano  = url.searchParams.get('plano');

    if (id) {
      const resp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=' + CAMPOS_LISTA.join(','),
        { headers: headersSupabase(env) }
      );
      const linhas = await resp.json();
      if (!resp.ok) return jsonResp({ error: 'Falha ao buscar' }, 502);
      if (linhas.length === 0) return jsonResp({ error: 'Não encontrada' }, 404);
      return jsonResp({ cuidadora: linhas[0] }, 200);
    }

    const params = ['select=' + CAMPOS_LISTA.join(','), 'order=criado_em.desc'];

    if (filtro === 'pendentes') {
      params.push('aprovada=eq.false');
    } else if (filtro === 'aprovadas') {
      params.push('aprovada=eq.true');
    } else if (filtro === 'vencidas') {
      params.push('plano_valido_ate=lt.' + new Date().toISOString());
    } else if (filtro === 'pagas') {
      params.push('status_pagamento=eq.Pago');
    }

    if (busca) {
      params.push('or=(nome.ilike.*' + encodeURIComponent(busca) + '*,whatsapp.ilike.*' + encodeURIComponent(busca) + '*)');
    }

    if (bairro) {
      params.push('bairro=eq.' + encodeURIComponent(bairro));
    }

    if (plano === 'cadastro') {
      params.push('plano_cadastro=eq.true');
    } else if (plano === 'profissional') {
      params.push('plano_profissional=eq.true');
    } else if (plano === 'destaque') {
      params.push('plano_destaque=eq.true');
    }

    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + params.join('&'),
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Erro listar:', txt);
      return jsonResp({ error: 'Falha ao listar' }, 502);
    }

    const linhas = await resp.json();
    return jsonResp({ cuidadoras: linhas }, 200);

  } catch (err) {
    console.error('Erro GET admin:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

// ============================================================
// PATCH — ATUALIZAR UMA
// ============================================================
export async function onRequestPatch(context) {
  const { request, env } = context;

  const auth = await validarToken(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Parâmetro ?id= obrigatório' }, 400);

    const body = await request.json();
    const campos = {};
    for (const chave of CAMPOS_PERMITIDOS) {
      if (chave in body) campos[chave] = body[chave];
    }

    if (Object.keys(campos).length === 0) {
      return jsonResp({ error: 'Nenhum campo válido pra atualizar' }, 400);
    }

    // Auto-preenche vencimento quando marca como Pago
    if (campos.status_pagamento === 'Pago' && !campos.plano_valido_ate) {
      let isCadastro = campos.plano_cadastro;
      if (isCadastro === undefined) {
        try {
          const r = await fetch(
            env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=plano_cadastro&limit=1',
            { headers: headersSupabase(env) }
          );
          if (r.ok) {
            const l = await r.json();
            isCadastro = l && l[0] && l[0].plano_cadastro;
          }
        } catch (e) {}
      }

      const hoje = new Date();
      const vence = new Date(hoje);
      vence.setDate(vence.getDate() + diasDoPlano({ plano_cadastro: isCadastro }));
      campos.plano_inicio = hoje.toISOString();
      campos.plano_valido_ate = vence.toISOString();
    }

    const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id;
    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Erro PATCH:', txt);
      return jsonResp({ error: 'Falha ao atualizar' }, 502);
    }

    const atualizados = await resp.json();
    return jsonResp({ ok: true, cuidadora: atualizados[0] }, 200);

  } catch (err) {
    console.error('Erro PATCH admin:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

// ============================================================
// POST — ATUALIZAÇÃO EM MASSA
// ============================================================
export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await validarToken(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  try {
    const body = await request.json();
    const ids = body.ids || [];
    const camposBrutos = body.campos || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return jsonResp({ error: 'Nenhum id informado' }, 400);
    }

    const campos = {};
    for (const chave of CAMPOS_PERMITIDOS) {
      if (chave in camposBrutos) campos[chave] = camposBrutos[chave];
    }

    if (Object.keys(campos).length === 0) {
      return jsonResp({ error: 'Nenhum campo válido' }, 400);
    }

    if (campos.status_pagamento === 'Pago' && !campos.plano_valido_ate) {
      const hoje = new Date();
      const vence = new Date(hoje);
      vence.setDate(vence.getDate() + diasDoPlano({ plano_cadastro: campos.plano_cadastro }));
      campos.plano_inicio = hoje.toISOString();
      campos.plano_valido_ate = vence.toISOString();
    }

    const idList = ids.map(function(i) { return '"' + i + '"'; }).join(',');
    const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=in.(' + idList + ')';

    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Erro bulk PATCH:', txt);
      return jsonResp({ error: 'Falha na atualização em lote' }, 502);
    }

    return jsonResp({ ok: true, atualizadas: ids.length }, 200);

  } catch (err) {
    console.error('Erro POST admin:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}