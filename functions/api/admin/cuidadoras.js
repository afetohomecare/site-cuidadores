// ============================================================
// AFETO — API Admin: gerenciar cuidadoras
// ------------------------------------------------------------
// Requer token de admin (JWT do Supabase Auth no header Authorization)
//
// GET  /api/admin/cuidadoras         → lista todas
// GET  /api/admin/cuidadoras?id=xxx  → busca uma
// PATCH /api/admin/cuidadoras?id=xxx → atualiza campos
//
// Campos atualizáveis via PATCH:
//   aprovada, status_pagamento, disponivel, verificada,
//   categoria, nota, horas, comentarios
// ============================================================

const CAMPOS_PERMITIDOS = [
  'aprovada',
  'status_pagamento',
  'disponivel',
  'verificada',
  'categoria',
  'nota',
  'horas',
  'comentarios',
  'plano_profissional',
  'plano_destaque'
];

// Campos que devolvemos na listagem (pro painel)
const CAMPOS_LISTA = [
  'id', 'nome', 'whatsapp', 'whatsapp_agencia', 'email', 'cpf', 'coren',
  'foto_url', 'apresentacao', 'especialidade', 'experiencia',
  'bairro', 'bairros', 'preco', 'turno', 'cursos', 'subespecialidades',
  'categoria', 'nota', 'horas', 'verificada', 'disponivel',
  'plano_profissional', 'plano_destaque', 'plano_cadastro',
  'status_pagamento', 'aprovada', 'comentarios', 'indicado_por',
  'asaas_customer_id', 'asaas_cobranca_id', 'cupom_usado',
  'criado_em', 'atualizado_em'
];

// ============================================================
// HELPERS
// ============================================================
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

  // Valida chamando o endpoint /auth/v1/user do Supabase
  const resp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });

  if (!resp.ok) return { ok: false, motivo: 'Token inválido ou expirado' };

  const user = await resp.json();
  return { ok: true, user: user };
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
    const id = url.searchParams.get('id');

    if (id) {
      // Busca uma
      const resp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=' + CAMPOS_LISTA.join(','),
        { headers: headersSupabase(env) }
      );
      const linhas = await resp.json();
      if (!resp.ok) return jsonResp({ error: 'Falha ao buscar' }, 502);
      if (linhas.length === 0) return jsonResp({ error: 'Não encontrada' }, 404);
      return jsonResp({ cuidadora: linhas[0] }, 200);
    }

    // Lista todas
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?select=' + CAMPOS_LISTA.join(',') + '&order=criado_em.desc',
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
// PATCH — ATUALIZAR
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

    // Filtra só campos permitidos
    const campos = {};
    for (const chave of CAMPOS_PERMITIDOS) {
      if (chave in body) campos[chave] = body[chave];
    }

    if (Object.keys(campos).length === 0) {
      return jsonResp({ error: 'Nenhum campo válido pra atualizar' }, 400);
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
      return jsonResp({ error: 'Falha ao atualizar', detalhe: txt.substring(0, 300) }, 502);
    }

    const atualizados = await resp.json();
    return jsonResp({ ok: true, cuidadora: atualizados[0] }, 200);

  } catch (err) {
    console.error('Erro PATCH admin:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

// ============================================================
// SUPORTE A OPTIONS (CORS)
// ============================================================
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
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