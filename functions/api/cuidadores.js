// ============================================================
// AFETO — API: lista de cuidadoras para a vitrine
// ⚠️ VERSÃO DE DEBUG — substituir pela versão final depois
// ============================================================

const CAMPOS_PUBLICOS = [
  'id', 'nome', 'whatsapp', 'whatsapp_agencia', 'foto_url',
  'apresentacao', 'motivacao', 'especialidade', 'experiencia',
  'bairro', 'bairros', 'preco', 'turno', 'cursos',
  'subespecialidades', 'categoria', 'nota', 'horas', 'verificada',
  'disponivel', 'plano_profissional', 'plano_destaque', 'coren',
  'comentarios', 'criado_em'
];

export async function onRequestGet(context) {
  const { env } = context;

  // Diagnóstico 1: as variáveis chegaram?
  const diagnostico = {
    tem_url: !!env.SUPABASE_URL,
    tem_key: !!env.SUPABASE_SERVICE_KEY,
    url_primeiros_chars: env.SUPABASE_URL ? env.SUPABASE_URL.substring(0, 40) : null,
    url_ultimos_chars: env.SUPABASE_URL ? env.SUPABASE_URL.substring(env.SUPABASE_URL.length - 20) : null,
    url_tem_espaco: env.SUPABASE_URL ? (env.SUPABASE_URL.trim() !== env.SUPABASE_URL) : null,
    key_primeiros_chars: env.SUPABASE_SERVICE_KEY ? env.SUPABASE_SERVICE_KEY.substring(0, 20) : null,
    key_tem_espaco: env.SUPABASE_SERVICE_KEY ? (env.SUPABASE_SERVICE_KEY.trim() !== env.SUPABASE_SERVICE_KEY) : null,
    key_tamanho: env.SUPABASE_SERVICE_KEY ? env.SUPABASE_SERVICE_KEY.length : 0
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({
      erro: 'Variável faltando',
      diagnostico: diagnostico
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // Diagnóstico 2: montar a URL
  const parametros = [
    'aprovada=eq.true',
    'status_pagamento=eq.Pago',
    'or=(plano_profissional.eq.true,plano_destaque.eq.true)',
    'select=' + CAMPOS_PUBLICOS.join(','),
    'order=criado_em.desc'
  ].join('&');

  const url = env.SUPABASE_URL + '/rest/v1/cuidadores?' + parametros;

  // Diagnóstico 3: chamar o Supabase e mostrar a resposta REAL
  let resposta;
  let corpoResposta = '';
  let erroRede = null;

  try {
    resposta = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    });

    corpoResposta = await resposta.text();

  } catch (e) {
    erroRede = e.message;
  }

  // Monta o retorno de diagnóstico completo
  return new Response(JSON.stringify({
    diagnostico: diagnostico,
    url_chamada: url.replace(env.SUPABASE_SERVICE_KEY, '***'),
    resposta_status: resposta ? resposta.status : null,
    resposta_status_texto: resposta ? resposta.statusText : null,
    resposta_corpo: corpoResposta.substring(0, 500),
    erro_rede: erroRede
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}