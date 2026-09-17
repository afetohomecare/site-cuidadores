import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API Admin: cupons
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
      env.SUPABASE_URL + '/rest/v1/cupons?select=*&order=criado_em.desc',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return jsonResp({ error: 'Falha ao listar' }, 502);
    const cupons = await resp.json();
    return jsonResp({ cupons: cupons }, 200);
  } catch (err) {
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const body = await request.json();
    const codigo = (body.codigo || '').trim().toUpperCase();
    const tipo = body.tipo || 'percentual';
    const valor = parseFloat(body.valor);

    if (!codigo) return jsonResp({ error: 'Código obrigatório' }, 400);
    if (['percentual', 'valor_fixo'].indexOf(tipo) === -1) return jsonResp({ error: 'Tipo inválido' }, 400);
    if (isNaN(valor) || valor <= 0) return jsonResp({ error: 'Valor inválido' }, 400);

    const campos = {
      codigo: codigo,
      tipo: tipo,
      valor: valor,
      plano_aplicavel: body.plano_aplicavel || null,
      usos_maximos: body.usos_maximos ? parseInt(body.usos_maximos) : null,
      valido_ate: body.valido_ate || null,
      ativo: body.ativo !== false
    };

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/cupons', {
      method: 'POST',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (txt.indexOf('duplicate') !== -1 || txt.indexOf('unique') !== -1) {
        return jsonResp({ error: 'Já existe um cupom com esse código' }, 409);
      }
      return jsonResp({ error: 'Falha ao criar' }, 502);
    }

    const criado = await resp.json();
    return jsonResp({ ok: true, cupom: criado[0] }, 200);

  } catch (err) {
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
    ['codigo', 'tipo', 'valor', 'plano_aplicavel', 'usos_maximos', 'valido_ate', 'ativo'].forEach(function(c) {
      if (c in body) campos[c] = body[c];
    });

    if (campos.codigo) campos.codigo = String(campos.codigo).trim().toUpperCase();
    if (campos.valor !== undefined) campos.valor = parseFloat(campos.valor);

    if (Object.keys(campos).length === 0) return jsonResp({ error: 'Nada pra atualizar' }, 400);

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + id, {
      method: 'PATCH',
      headers: headersSupabase(env, true, true),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) return jsonResp({ error: 'Falha ao atualizar' }, 502);
    const atualizado = await resp.json();
    return jsonResp({ ok: true, cupom: atualizado[0] }, 200);

  } catch (err) {
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

    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/cupons?id=eq.' + id, {
      method: 'DELETE',
      headers: headersSupabase(env)
    });

    if (!resp.ok) return jsonResp({ error: 'Falha ao apagar' }, 502);
    return jsonResp({ ok: true }, 200);

  } catch (err) {
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