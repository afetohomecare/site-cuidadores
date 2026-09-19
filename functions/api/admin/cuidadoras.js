import { ehAdmin } from '../../_lib/auth.js';
import { dataValidadePlano, planoDaCuidadora } from '../../_lib/planos.js';
import { excluirCuidadoraDefinitivo, validarSenhaExclusao } from '../../_lib/exclusao.js';

// ============================================================
// AFETO — API Admin: gerenciar cuidadoras
// 🛡️ BLINDAGEM: gera token ao marcar Pago manualmente
// 🆕 Busca por CPF + retorna mais campos pro modal de detalhes
// ============================================================

const CAMPOS_PERMITIDOS = [
  'aprovada', 'status_pagamento', 'disponivel', 'verificada',
  'categoria', 'nota', 'horas', 'comentarios',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate'
];

const CAMPOS_LISTA = [
  'id', 'slug', 'nome', 'whatsapp', 'whatsapp_agencia', 'email', 'cpf', 'coren',
  'foto_url', 'foto_url_pendente', 'foto_pendente',
  'apresentacao', 'motivacao', 'especialidade', 'como_aparecer', 'experiencia',
  'bairro', 'bairros', 'preco', 'turno', 'cursos', 'subespecialidades',
  'categoria', 'nota', 'horas', 'verificada', 'disponivel',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate', 'proxima_cobranca',
  'status_pagamento', 'aprovada', 'comentarios', 'indicado_por',
  'asaas_customer_id', 'asaas_cobranca_id', 'asaas_subscription_id', 'cupom_usado',
  'excluido', 'excluido_em', 'auth_user_id',
  'mostrar_bio', 'mostrar_habilidades', 'mostrar_cursos', 'mostrar_bairros', 'mostrar_preco',
  'criado_em', 'atualizado_em'
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

  if (!ehAdmin(user)) {
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

function planoParaValidade(campos) {
  return planoDaCuidadora(campos);
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
    if (!c || c.auth_user_id) return;

    const agora = new Date();
    const expiraAtual = c.token_criar_senha_expira_em ? new Date(c.token_criar_senha_expira_em) : null;
    const tokenEhValido = c.token_criar_senha && expiraAtual && expiraAtual > agora;

    if (tokenEhValido) return;

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
  const { request, env } = context;
  const auth = await validarToken(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const filtro = url.searchParams.get('filtro');
    const busca = url.searchParams.get('busca');
    const bairro = url.searchParams.get('bairro');
    const plano = url.searchParams.get('plano');
    const cpf = url.searchParams.get('cpf');

    if (id) {
      let resp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=' + CAMPOS_LISTA.join(','),
        { headers: headersSupabase(env) }
      );
      if (!resp.ok) {
        const semComo = CAMPOS_LISTA.filter(function (c) { return c !== 'como_aparecer'; });
        resp = await fetch(
          env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=' + semComo.join(','),
          { headers: headersSupabase(env) }
        );
      }
      const linhas = await resp.json();
      if (!resp.ok) return jsonResp({ error: 'Falha ao buscar' }, 502);
      if (linhas.length === 0) return jsonResp({ error: 'Não encontrada' }, 404);
      return jsonResp({ cuidadora: linhas[0] }, 200);
    }

    const params = ['select=' + CAMPOS_LISTA.join(','), 'order=criado_em.desc'];

    if (filtro === 'pendentes') params.push('aprovada=eq.false');
    else if (filtro === 'aprovadas') params.push('aprovada=eq.true');
    else if (filtro === 'vencidas') params.push('plano_valido_ate=lt.' + new Date().toISOString());
    else if (filtro === 'pagas') params.push('status_pagamento=eq.Pago');

    // 🆕 Busca por CPF (com e sem formatação)
    if (cpf) {
      const cpfLimpo = cpf.replace(/\D/g, '');
      const cpfFmt = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      params.push('or=(cpf.eq.' + cpfLimpo + ',cpf.eq.' + encodeURIComponent(cpfFmt) + ')');
    }

    if (busca) {
      params.push('or=(nome.ilike.*' + encodeURIComponent(busca) + '*,whatsapp.ilike.*' + encodeURIComponent(busca) + '*)');
    }

    if (bairro) params.push('bairro=eq.' + encodeURIComponent(bairro));

    if (plano === 'cadastro') params.push('plano_cadastro=eq.true');
    else if (plano === 'profissional') params.push('plano_profissional=eq.true');
    else if (plano === 'destaque') params.push('plano_destaque=eq.true');

    let resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + params.join('&'),
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) {
      const txt = await resp.text();
      const semComo = CAMPOS_LISTA.filter(function (c) { return c !== 'como_aparecer'; });
      const paramsSem = params.slice();
      paramsSem[0] = 'select=' + semComo.join(',');
      resp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?' + paramsSem.join('&'),
        { headers: headersSupabase(env) }
      );
      if (!resp.ok) {
        console.error('Erro listar:', txt);
        return jsonResp({ error: 'Falha ao listar' }, 502);
      }
    }

    const linhas = await resp.json();
    return jsonResp({ cuidadoras: linhas }, 200);

  } catch (err) {
    console.error('Erro GET admin:', err);
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

    if (campos.status_pagamento === 'Pago' && !campos.plano_valido_ate) {
      let flags = {
        plano_cadastro: campos.plano_cadastro,
        plano_profissional: campos.plano_profissional,
        plano_destaque: campos.plano_destaque
      };
      if (flags.plano_cadastro === undefined && flags.plano_profissional === undefined && flags.plano_destaque === undefined) {
        try {
          const r = await fetch(
            env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + id + '&select=plano_cadastro,plano_profissional,plano_destaque&limit=1',
            { headers: headersSupabase(env) }
          );
          if (r.ok) {
            const l = await r.json();
            if (l && l[0]) flags = l[0];
          }
        } catch (e) {}
      }

      const hoje = new Date();
      const vence = dataValidadePlano(planoParaValidade(flags), hoje);
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
      const vence = dataValidadePlano(planoParaValidade(campos), hoje);
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

export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await validarToken(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Parâmetro ?id= obrigatório' }, 400);

    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }

    const senha = validarSenhaExclusao(env, body.senha);
    if (!senha.ok) return jsonResp({ error: senha.error }, senha.status);

    const resultado = await excluirCuidadoraDefinitivo(env, id);
    if (!resultado.ok) return jsonResp({ error: resultado.error }, resultado.status);

    return jsonResp({
      ok: true,
      mensagem: 'Cadastro apagado de vez.'
    }, 200);
  } catch (err) {
    console.error('Erro DELETE admin:', err);
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