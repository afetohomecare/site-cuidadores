// ============================================================
// AFETO — API Painel: salvar edições do perfil
// ============================================================

// Campos que a cuidadora pode editar livremente
const CAMPOS_PERMITIDOS = [
  'apresentacao',
  'subespecialidades',
  'cursos',
  'bairros',
  'bairro',
  'preco'
];

// Limites de tamanho
const LIMITES = {
  apresentacao: 2000,
  preco: 10
};

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const cuidadora = await validarToken(env, request);
    if (!cuidadora) {
      return jsonResp({ error: 'Não autenticado.' }, 401);
    }

    const body = await request.json();
    const campos = {};

    // ---------- VALIDA E SANITIZA ----------
    for (var i = 0; i < CAMPOS_PERMITIDOS.length; i++) {
      var chave = CAMPOS_PERMITIDOS[i];
      if (!(chave in body)) continue;

      var valor = body[chave];

      // Validação por tipo
      if (chave === 'apresentacao') {
        if (typeof valor !== 'string') continue;
        valor = valor.trim();
        if (valor.length > LIMITES.apresentacao) {
          return jsonResp({ error: 'A apresentação está muito longa (máximo ' + LIMITES.apresentacao + ' caracteres).' }, 400);
        }
        campos.apresentacao = valor;
      }

      else if (chave === 'subespecialidades' || chave === 'cursos' || chave === 'bairros') {
        if (!Array.isArray(valor)) continue;
        var arr = valor
          .map(function(v) { return String(v).trim(); })
          .filter(function(v) { return v; });

        // Limites específicos
        if (chave === 'subespecialidades' && arr.length > 10) arr = arr.slice(0, 10);
        if (chave === 'bairros' && arr.length > 10) arr = arr.slice(0, 10);
        if (chave === 'cursos' && arr.length > 30) arr = arr.slice(0, 30);

        // Limita tamanho de cada item
        arr = arr.map(function(v) { return v.substring(0, 200); });

        campos[chave] = arr;
      }

      else if (chave === 'bairro') {
        if (typeof valor !== 'string') continue;
        campos.bairro = valor.trim().substring(0, 100);
      }

      else if (chave === 'preco') {
        var precoStr = String(valor).trim();
        var precoNum = parseFloat(precoStr);
        if (isNaN(precoNum) || precoNum < 50 || precoNum > 5000) {
          return jsonResp({ error: 'O valor do plantão precisa estar entre R$ 50 e R$ 5.000.' }, 400);
        }
        campos.preco = String(precoNum);
      }
    }

    if (Object.keys(campos).length === 0) {
      return jsonResp({ error: 'Nenhum campo válido pra atualizar.' }, 400);
    }

    // ---------- PATCH ----------
    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, true),
        body: JSON.stringify(campos)
      }
    );

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      console.error('Erro PATCH perfil:', patchResp.status, txt);
      return jsonResp({ error: 'Falha ao salvar.' }, 502);
    }

    const atualizado = await patchResp.json();

    return jsonResp({
      ok: true,
      cuidadora: atualizado && atualizado[0] ? atualizado[0] : null
    }, 200);

  } catch (err) {
    console.error('Erro perfil:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

async function validarToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });

  if (!userResp.ok) return null;

  const userData = await userResp.json();

  const buscaResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' +
    encodeURIComponent(userData.id) + '&select=id&limit=1',
    { headers: headersSupabase(env) }
  );

  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  if (!linhas || linhas.length === 0) return null;

  return linhas[0];
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

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}