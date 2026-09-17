// ============================================================
// AFETO — API Painel: mostrar/esconder bloco do perfil
// ============================================================

// Whitelist — só aceita esses campos
const CAMPOS_PERMITIDOS = [
  'mostrar_bio',
  'mostrar_habilidades',
  'mostrar_cursos',
  'mostrar_bairros',
  'mostrar_preco',
  'mostrar_selo_identidade',
  'mostrar_selo_coren',
  'mostrar_selo_verificada',
  'mostrar_selo_horas',
  'mostrar_selo_top'
];

export async function onRequestPost(context) {
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
    const campo = String(body.campo || '').trim();
    const valor = body.valor === true;

    if (CAMPOS_PERMITIDOS.indexOf(campo) === -1) {
      return jsonResp({ error: 'Campo inválido.' }, 400);
    }

    const patchBody = {};
    patchBody[campo] = valor;

    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true),
        body: JSON.stringify(patchBody)
      }
    );

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      console.error('Erro toggle-visibilidade:', patchResp.status, txt);
      return jsonResp({ error: 'Falha ao salvar.' }, 502);
    }

    return jsonResp({ ok: true, campo: campo, valor: valor }, 200);

  } catch (err) {
    console.error('Erro toggle-visibilidade:', err);
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

function headersSupabase(env, temBody) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}