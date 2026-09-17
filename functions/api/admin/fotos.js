import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API Admin: fotos pendentes de aprovação
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

  if (!(await validarToken(env, request))) {
    return jsonResp({ error: 'Não autorizado' }, 401);
  }

  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?foto_pendente=eq.true&select=id,nome,whatsapp,foto_url,foto_url_pendente,criado_em,atualizado_em&order=atualizado_em.desc',
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) return jsonResp({ error: 'Falha ao listar' }, 502);

    const fotos = await resp.json();
    return jsonResp({ fotos: fotos }, 200);

  } catch (err) {
    console.error('Erro GET fotos:', err);
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

    if (acao !== 'aprovar' && acao !== 'rejeitar') {
      return jsonResp({ error: 'Ação inválida' }, 400);
    }

    const buscaResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(id) +
      '&select=id,foto_url,foto_url_pendente,foto_pendente,foto_pendente_path,nome&limit=1',
      { headers: headersSupabase(env) }
    );

    if (!buscaResp.ok) return jsonResp({ error: 'Falha ao buscar' }, 502);

    const linhas = await buscaResp.json();
    if (!linhas || linhas.length === 0) return jsonResp({ error: 'Cuidadora não encontrada' }, 404);

    const cuidadora = linhas[0];

    if (!cuidadora.foto_pendente || !cuidadora.foto_url_pendente) {
      return jsonResp({ error: 'Essa foto já foi processada' }, 409);
    }

    let patchBody = {};

    if (acao === 'aprovar') {
      // ⭐ Deleta foto oficial antiga (se houver e for diferente do pendente)
      if (cuidadora.foto_url) {
        try {
          const antigaPath = cuidadora.foto_url.split('/storage/v1/object/public/')[1];
          if (antigaPath && antigaPath !== cuidadora.foto_pendente_path) {
            await fetch(env.SUPABASE_URL + '/storage/v1/object/' + antigaPath, {
              method: 'DELETE',
              headers: {
                'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
              }
            });
          }
        } catch (e) {
          console.warn('Erro ao deletar foto antiga:', e);
        }
      }

      patchBody = {
        foto_url: cuidadora.foto_url_pendente,
        foto_url_pendente: null,
        foto_pendente: false,
        foto_upload_id: null,
        foto_pendente_path: null
      };
    } else {
      // ⭐ Rejeitar — deleta arquivo pendente
      if (cuidadora.foto_pendente_path) {
        try {
          await fetch(env.SUPABASE_URL + '/storage/v1/object/' + cuidadora.foto_pendente_path, {
            method: 'DELETE',
            headers: {
              'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
            }
          });
        } catch (e) {
          console.warn('Erro ao deletar foto rejeitada:', e);
        }
      }

      patchBody = {
        foto_url_pendente: null,
        foto_pendente: false,
        foto_upload_id: null,
        foto_pendente_path: null
      };
    }

    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(id),
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify(patchBody)
      }
    );

    if (!patchResp.ok) {
      const txt = await patchResp.text();
      console.error('Erro PATCH foto:', txt);
      return jsonResp({ error: 'Falha ao atualizar' }, 502);
    }

    return jsonResp({
      ok: true,
      acao: acao,
      mensagem: acao === 'aprovar' ? 'Foto aprovada!' : 'Foto rejeitada.'
    }, 200);

  } catch (err) {
    console.error('Erro PATCH foto:', err);
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