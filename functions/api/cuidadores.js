// ============================================================
// AFETO — API: lista de cuidadoras para a vitrine
// ------------------------------------------------------------
// Lê do Supabase (PostgreSQL) somente as cuidadoras que estão:
//   • aprovada = true
//   • status_pagamento = 'Pago'
//   • tem plano_profissional OU plano_destaque ativo
//
// A filtragem é feita NO BANCO (não no navegador), para não
// trafegar dados de perfis não aprovados pela rede.
//
// Também devolve apenas campos públicos — nunca CPF, e-mail,
// IDs do Asaas ou qualquer dado que não seja de vitrine.
// ============================================================

// Campos que podem ir para o navegador (público)
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

// Resposta JSON de erro padronizada
function respostaErro(mensagem, status) {
  return new Response(JSON.stringify({ erro: mensagem }), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  // 1) Confere se as variáveis de ambiente existem
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return respostaErro('Configuração do servidor ausente.', 500);
  }

  // 2) Monta a query do Supabase (PostgREST)
  //    Filtra tudo no banco — não no JavaScript.
  const parametros = [
    'aprovada=eq.true',
    'status_pagamento=eq.Pago',
    'or=(plano_profissional.eq.true,plano_destaque.eq.true)',
    'select=' + CAMPOS_PUBLICOS.join(','),
    'order=criado_em.desc'
  ].join('&');

  const url = env.SUPABASE_URL + '/rest/v1/cuidadores?' + parametros;

  // 3) Consulta o Supabase
  let resposta;
  try {
    resposta = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    });
  } catch (erroRede) {
    console.error('Falha de rede ao consultar Supabase:', erroRede);
    return respostaErro('Não foi possível conectar ao banco de dados.', 502);
  }

  // 4) Se o Supabase respondeu com erro, loga e devolve erro genérico
  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(function () { return ''; });
    console.error('Supabase respondeu', resposta.status, detalhe);
    return respostaErro('Erro ao buscar cuidadoras.', 500);
  }

  // 5) Sucesso
  const cuidadores = await resposta.json();

  return new Response(JSON.stringify({ cuidadores: cuidadores }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Cache curto: 60 segundos. Reduz carga no banco sem deixar
      // o perfil desatualizado por muito tempo.
      'Cache-Control': 'public, max-age=60, s-maxage=60'
    }
  });
}