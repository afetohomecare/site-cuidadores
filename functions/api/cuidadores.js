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

function respostaErro(mensagem, status) {
  return new Response(JSON.stringify({ erro: mensagem }), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return respostaErro('Configuração do servidor ausente.', 500);
  }

  const parametros = [
    'aprovada=eq.true',
    'status_pagamento=eq.Pago',
    'or=(plano_profissional.eq.true,plano_destaque.eq.true)',
    'select=' + CAMPOS_PUBLICOS.join(','),
    'order=criado_em.desc'
  ].join('&');

  const url = env.SUPABASE_URL + '/rest/v1/cuidadores?' + parametros;

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

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(function () { return ''; });
    console.error('Supabase respondeu', resposta.status, detalhe);
    return respostaErro('Erro ao buscar cuidadoras.', 500);
  }

  const cuidadores = await resposta.json();

  return new Response(JSON.stringify({ cuidadores: cuidadores }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60'
    }
  });
}