import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API Admin: configurações (tabela config)
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

var CHAVES_PERMITIDAS = [
  'preco_cadastro', 'preco_cadastro_cartao', 'preco_profissional', 'preco_destaque',
  'preco_cadastro_pos', 'preco_cadastro_cartao_pos', 'preco_prof_pos', 'preco_destaque_pos',
  'vagas_fundadora', 'texto_banner_home', 'whatsapp_afeto'
];

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/config?select=chave,valor,descricao,atualizado_em&order=chave.asc',
      { headers: headersSupabase(env) }
    );
    if (!resp.ok) return jsonResp({ error: 'Falha ao listar' }, 502);
    const config = await resp.json();
    return jsonResp({ config: config }, 200);
  } catch (err) {
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!(await validarToken(env, request))) return jsonResp({ error: 'Não autorizado' }, 401);

  try {
    const body = await request.json();
    const valores = body.valores || {};

    const chaves = Object.keys(valores).filter(function(k) {
      return CHAVES_PERMITIDAS.indexOf(k) !== -1;
    });

    if (chaves.length === 0) return jsonResp({ error: 'Nenhuma chave válida' }, 400);

    const resultados = [];
    for (var i = 0; i < chaves.length; i++) {
      var chave = chaves[i];
      var valor = String(valores[chave]);
      var resp = await fetch(
        env.SUPABASE_URL + '/rest/v1/config?chave=eq.' + encodeURIComponent(chave),
        {
          method: 'PATCH',
          headers: Object.assign({}, headersSupabase(env, true, true), {
            'Prefer': 'return=representation'
          }),
          body: JSON.stringify({ valor: valor })
        }
      );
      var atualizados = [];
      try { atualizados = await resp.json(); } catch (e) { atualizados = []; }
      if (!resp.ok || !atualizados || atualizados.length === 0) {
        resp = await fetch(
          env.SUPABASE_URL + '/rest/v1/config',
          {
            method: 'POST',
            headers: headersSupabase(env, true, false),
            body: JSON.stringify({ chave: chave, valor: valor })
          }
        );
      }
      resultados.push({ chave: chave, ok: resp.ok });
    }

    var todasOk = resultados.every(function(r) { return r.ok; });
    return jsonResp({ ok: todasOk, resultados: resultados }, todasOk ? 200 : 502);

  } catch (err) {
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

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