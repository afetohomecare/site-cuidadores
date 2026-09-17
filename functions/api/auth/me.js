// ============================================================
// AFETO — API: dados da cuidadora logada
// ============================================================

const CAMPOS_RETORNO = [
  'id', 'nome', 'whatsapp', 'foto_url', 'foto_url_pendente', 'foto_pendente',
  'apresentacao', 'motivacao',
  'especialidade', 'experiencia', 'bairro', 'bairros', 'preco', 'turno',
  'cursos', 'subespecialidades', 'coren', 'categoria', 'nota', 'horas',
  'verificada', 'disponivel', 'disponivel_atualizado_em',
  'plano_cadastro', 'plano_profissional', 'plano_destaque',
  'plano_inicio', 'plano_valido_ate', 'status_pagamento', 'aprovada',
  'asaas_subscription_id',
  'excluido', 'criado_em', 'atualizado_em',
  'mostrar_bio', 'mostrar_habilidades', 'mostrar_cursos', 'mostrar_bairros',
  'mostrar_preco', 'mostrar_selo_identidade', 'mostrar_selo_coren',
  'mostrar_selo_verificada', 'mostrar_selo_horas', 'mostrar_selo_top'
];

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();

    if (!token) {
      return jsonResp({ error: 'Não autenticado.' }, 401);
    }

    const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + token
      }
    });

    if (!userResp.ok) {
      return jsonResp({ error: 'Sessão expirada. Faça login de novo.' }, 401);
    }

    const userData = await userResp.json();
    const authUserId = userData.id;

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' +
                     encodeURIComponent(authUserId) +
                     '&select=' + CAMPOS_RETORNO.join(',') +
                     '&limit=1';

    const buscaResp = await fetch(buscaUrl, {
      headers: headersSupabase(env)
    });

    if (!buscaResp.ok) {
      return jsonResp({ error: 'Falha ao buscar dados.' }, 502);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      return jsonResp({ error: 'Cadastro não encontrado.' }, 404);
    }

    return jsonResp({
      ok: true,
      cuidadora: linhas[0]
    }, 200);

  } catch (err) {
    console.error('Erro me:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

function headersSupabase(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}