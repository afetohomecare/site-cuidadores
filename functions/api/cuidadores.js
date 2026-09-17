// ============================================================
// AFETO — API pública da vitrine + PATCH/POST admin (legado)
// ------------------------------------------------------------
// GET: lista só quem está aprovada, paga e com plano ativo.
//      Resposta: { cuidadores: [...] } — o que index.html e
//      perfil.html esperam. Sem CPF, e-mail nem dados Asaas.
// PATCH/POST: continuam exigindo token de admin.
// ============================================================

const CAMPOS_PERMITIDOS = [
  'aprovada', 'status_pagamento', 'disponivel', 'verificada',
  'categoria', 'nota', 'horas', 'comentarios',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate'
];

const CAMPOS_PUBLICOS = [
  'id',
  'nome',
  'whatsapp',
  'whatsapp_agencia',
  'foto_url',
  'apresentacao',
  'motivacao',
  'especialidade',
  'experiencia',
  'bairro',
  'bairros',
  'preco',
  'turno',
  'cursos',
  'subespecialidades',
  'categoria',
  'nota',
  'horas',
  'verificada',
  'disponivel',
  'plano_profissional',
  'plano_destaque',
  'coren',
  'comentarios',
  'criado_em'
];

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function gerarToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

function diasDoPlano(campos) {
  return 30;
}

// 🛡️ Gera token se o admin está marcando como Pago manualmente
async function garantirTokenSePagoManual(env, id, campos) {
  if (campos.status_pagamento !== 'Pago') return;

  try {
    const cResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=auth_user_id,token_criar_senha,token_criar_senha_expira_em&limit=1',
      { headers: headersSupabase(env) }
    );
    if (!cResp.ok) return;

    const linhas = await cResp.json();
    const c = linhas && linhas[0];
    if (!c || c.auth_user_id) return; // Já tem senha, não precisa

    const agora = new Date();
    const expiraAtual = c.token_criar_senha_expira_em ? new Date(c.token_criar_senha_expira_em) : null;
    const tokenEhValido = c.token_criar_senha && expiraAtual && expiraAtual > agora;

    if (tokenEhValido) return; // Já tem token válido

    // Gera novo
    const token = gerarToken();
    const expira = new Date(agora);
    expira.setHours(expira.getHours() + 1);

    await fetch(env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id, {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify({
        token_criar_senha: token,
        token_criar_senha_expira_em: expira.toISOString()
      })
    });

    console.log('🛡️ Token gerado via admin manual:', id);
  } catch (e) {
    console.warn('Erro ao garantir token admin:', e);
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const hoje = new Date().toISOString();
    const parametros = [
      'aprovada=eq.true',
      'status_pagamento=eq.Pago',
      'plano_valido_ate=gte.' + hoje,
      'or=(plano_profissional.eq.true,plano_destaque.eq.true)',
      'select=' + CAMPOS_PUBLICOS.join(','),
      'order=criado_em.desc'
    ].join('&');

    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + parametros,
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) {
      console.error('Erro listar vitrine:', await resp.text());
      return jsonResp({ error: 'Falha ao listar' }, 502);
    }

    const cuidadores = await resp.json();
    return new Response(JSON.stringify({ cuidadores: cuidadores }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=60'
      }
    });
  } catch (err) {
    console.error('Erro GET vitrine:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

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
      return jsonResp({ error: 'Nenhum campo válido' }, 400);
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
      console.error('Erro PATCH:', await resp.text());
      return jsonResp({ error: 'Falha ao atualizar' }, 502);
    }

    // 🛡️ Se marcou como Pago manualmente, garante token
    await garantirTokenSePagoManual(env, id, campos);

    const atualizados = await resp.json();
    return jsonResp({ ok: true, cuidadora: atualizados[0] }, 200);

  } catch (err) {
    console.error('Erro PATCH admin:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

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

    const idList = ids.map(i => '"' + i + '"').join(',');
    const patchUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?id=in.(' + idList + ')';

    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: headersSupabase(env, true, false),
      body: JSON.stringify(campos)
    });

    if (!resp.ok) {
      console.error('Erro bulk PATCH:', await resp.text());
      return jsonResp({ error: 'Falha na atualização em lote' }, 502);
    }

    // 🛡️ Garante token pra cada uma que virou Pago
    if (campos.status_pagamento === 'Pago') {
      for (const id of ids) {
        await garantirTokenSePagoManual(env, id, campos);
      }
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