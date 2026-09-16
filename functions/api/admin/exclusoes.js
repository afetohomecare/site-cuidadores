// ============================================================
// AFETO — API Admin: gerenciar solicitações de exclusão
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

  // ⭐ VALIDA ROLE — só admin passa
  const role = user && user.user_metadata && user.user_metadata.role;
  if (role !== 'admin') return false;

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

  if (!(await validarToken(env, request))) {
    return jsonResp({ error: 'Não autorizado' }, 401);
  }

  try {
    const url = new URL(request.url);
    const filtro = url.searchParams.get('filtro') || 'pendentes';

    let query = '/rest/v1/solicitacoes_exclusao?select=*&order=criado_em.desc';
    if (filtro === 'pendentes') {
      query = '/rest/v1/solicitacoes_exclusao?status=eq.pendente&select=*&order=criado_em.desc';
    }

    const resp = await fetch(env.SUPABASE_URL + query, {
      headers: headersSupabase(env)
    });

    if (!resp.ok) {
      return jsonResp({ error: 'Falha ao listar' }, 502);
    }

    const solicitacoes = await resp.json();

    if (solicitacoes.length > 0) {
      const ids = solicitacoes.map(function(s) { return s.cuidador_id; });
      const idList = ids.map(function(i) { return '"' + i + '"'; }).join(',');

      const cuidResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=in.(' + idList + ')&select=id,nome,whatsapp,cpf,foto_url,plano_profissional,plano_destaque',
        { headers: headersSupabase(env) }
      );

      if (cuidResp.ok) {
        const cuidadores = await cuidResp.json();
        const mapa = {};
        cuidadores.forEach(function(c) { mapa[c.id] = c; });
        solicitacoes.forEach(function(s) {
          s.cuidador = mapa[s.cuidador_id] || null;
        });
      }
    }

    return jsonResp({ solicitacoes: solicitacoes }, 200);

  } catch (err) {
    console.error('Erro GET exclusões:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  if (!(await validarToken(env, request))) {
    return jsonResp({ error: 'Não autorizado' }, 401);
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Parâmetro ?id= obrigatório' }, 400);

    const body = await request.json();
    const acao = body.acao;
    const observacao = (body.observacao || '').substring(0, 500);

    if (acao !== 'aprovar' && acao !== 'rejeitar') {
      return jsonResp({ error: 'Ação inválida.' }, 400);
    }

    const solResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_exclusao?id=eq.' + id + '&select=*&limit=1',
      { headers: headersSupabase(env) }
    );

    if (!solResp.ok) return jsonResp({ error: 'Falha ao buscar solicitação' }, 502);

    const solicitacoes = await solResp.json();
    if (!solicitacoes || solicitacoes.length === 0) {
      return jsonResp({ error: 'Solicitação não encontrada' }, 404);
    }

    const solicitacao = solicitacoes[0];
    if (solicitacao.status !== 'pendente') {
      return jsonResp({ error: 'Essa solicitação já foi resolvida' }, 409);
    }

    const cuidadorId = solicitacao.cuidador_id;
    const agora = new Date().toISOString();

    if (acao === 'aprovar') {
      const cResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId + '&select=foto_url,auth_user_id&limit=1',
        { headers: headersSupabase(env) }
      );
      let fotoAntiga = null;
      let authUserId = null;
      if (cResp.ok) {
        const cData = await cResp.json();
        if (cData[0]) {
          fotoAntiga = cData[0].foto_url;
          authUserId = cData[0].auth_user_id;
        }
      }

      const anonBody = {
        nome: 'Conta removida',
        whatsapp: null,
        whatsapp_agencia: null,
        apresentacao: null,
        motivacao: null,
        foto_url: null,
        foto_url_pendente: null,
        foto_pendente: false,
        cursos: [],
        subespecialidades: [],
        bairros: [],
        bairro: null,
        coren: null,
        indicado_por: null,
        disponivel: false,
        aprovada: false,
        excluido: true,
        excluido_em: agora,
        plano_cadastro: false,
        plano_profissional: false,
        plano_destaque: false,
        status_pagamento: 'Excluido',
        cpf: null,
        auth_user_id: null,
        token_criar_senha: null,
        token_criar_senha_expira_em: null
      };

      const patchResp = await fetch(
        env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadorId,
        {
          method: 'PATCH',
          headers: headersSupabase(env, true, false),
          body: JSON.stringify(anonBody)
        }
      );

      if (!patchResp.ok) {
        console.error('Erro anonimizar:', await patchResp.text());
        return jsonResp({ error: 'Falha ao anonimizar dados' }, 502);
      }

      if (fotoAntiga) {
        try {
          const caminho = fotoAntiga.split('/storage/v1/object/public/')[1];
          if (caminho) {
            await fetch(env.SUPABASE_URL + '/storage/v1/object/' + caminho, {
              method: 'DELETE',
              headers: {
                'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
              }
            });
          }
        } catch (e) {
          console.warn('Erro ao deletar foto:', e);
        }
      }

      if (authUserId) {
        try {
          await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + authUserId, {
            method: 'DELETE',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
            }
          });
        } catch (e) {
          console.warn('Erro ao deletar auth user:', e);
        }
      }
    }

    const updateResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/solicitacoes_exclusao?id=eq.' + id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, true),
        body: JSON.stringify({
          status: acao === 'aprovar' ? 'aprovada' : 'rejeitada',
          resolvido_em: agora,
          resolvido_por: 'admin',
          observacao: observacao || null
        })
      }
    );

    if (!updateResp.ok) {
      return jsonResp({ error: 'Falha ao atualizar solicitação' }, 502);
    }

    return jsonResp({
      ok: true,
      acao: acao,
      mensagem: acao === 'aprovar'
        ? 'Dados anonimizados com sucesso.'
        : 'Solicitação rejeitada.'
    }, 200);

  } catch (err) {
    console.error('Erro PATCH exclusões:', err);
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