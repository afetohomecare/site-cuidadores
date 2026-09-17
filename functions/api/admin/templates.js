import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API Admin: templates de mensagem WhatsApp
// ⭐ SEGURANÇA: só aceita user com role === 'admin'
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
  if (!token) return false;

  const resp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });
  if (!resp.ok) return false;

  const user = await resp.json();

  if (!ehAdmin(user)) return false;

  return true;
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

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/templates_mensagem?select=*&order=ordem.asc,criado_em.asc',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return jsonResp({ error: 'Falha ao listar' }, 502);
    const templates = await resp.json();
    return jsonResp({ templates: templates }, 200);
  } catch (err) {
    console.error('Erro GET templates:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const body = await request.json();
    const titulo = (body.titulo || '').trim();
    const mensagem = (body.mensagem || '').trim();

    if (!titulo || !mensagem) {
      return jsonResp({ error: 'Título e mensagem são obrigatórios' }, 400);
    }

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/templates_mensagem', {
      method: 'POST',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify({
        titulo: titulo,
        mensagem: mensagem,
        ativo: body.ativo !== false,
        ordem: body.ordem || 99
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Erro criar template:', txt);
      return jsonResp({ error: 'Falha ao criar' }, 502);
    }

    const criado = await resp.json();
    return jsonResp({ ok: true, template: criado[0] }, 200);

  } catch (err) {
    console.error('Erro POST templates:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'ID obrigatório' }, 400);

    const body = await request.json();
    const campos = {};
    ['titulo', 'mensagem', 'ativo', 'ordem'].forEach(function(chave) {
      if (chave in body) campos[chave] = body[chave];
    });

    if (Object.keys(campos).length === 0) {
      return jsonResp({ error: 'Nada pra atualizar' }, 400);
    }

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/templates_mensagem?id=eq.' + id, {
      method: 'PATCH',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) return jsonResp({ error: 'Falha ao atualizar' }, 502);
    const atualizado = await resp.json();
    return jsonResp({ ok: true, template: atualizado[0] }, 200);

  } catch (err) {
    console.error('Erro PATCH templates:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'ID obrigatório' }, 400);

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/templates_mensagem?id=eq.' + id, {
      method: 'DELETE',
      headers: headersSupabase(env)
    });

    if (!resp.ok) return jsonResp({ error: 'Falha ao apagar' }, 502);
    return jsonResp({ ok: true }, 200);

  } catch (err) {
    console.error('Erro DELETE templates:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}