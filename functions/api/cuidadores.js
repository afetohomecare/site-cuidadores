// API pública da vitrine + perfil por link.
// GET sem id → lista (só Profissional/Destaque)
// GET ?id= → um perfil (inclui Essencial, se pago e aprovado)

import { jsonResp, metodoNaoPermitido } from '../_lib/http.js';
import { headersSupabase, supabaseOk } from '../_lib/supabase.js';
import { ehUuid, filtroPerfilPorRef, refPerfilSegura } from '../_lib/slug.js';

const CAMPOS_PUBLICOS = [
  'id',
  'slug',
  'nome',
  'foto_url',
  'apresentacao',
  'motivacao',
  'especialidade',
  'como_aparecer',
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
  'plano_cadastro',
  'plano_profissional',
  'plano_destaque',
  'coren',
  'comentarios',
  'criado_em',
  'mostrar_bio',
  'mostrar_habilidades',
  'mostrar_cursos',
  'mostrar_bairros',
  'mostrar_preco',
  'mostrar_selo_coren',
  'mostrar_selo_verificada',
  'mostrar_selo_horas'
];

function perfilPublico(row) {
  const item = Object.assign({}, row);

  if (item.mostrar_bio === false) item.apresentacao = null;
  if (item.mostrar_habilidades === false) item.subespecialidades = [];
  if (item.mostrar_cursos === false) item.cursos = [];
  if (item.mostrar_bairros === false) {
    item.bairros = [];
    item.bairro = null;
  }
  if (item.mostrar_preco === false) item.preco = null;
  if (item.mostrar_selo_coren === false) item.coren = null;
  if (item.mostrar_selo_verificada === false) item.verificada = false;
  if (item.mostrar_selo_horas === false) item.horas = 0;

  delete item.mostrar_bio;
  delete item.mostrar_habilidades;
  delete item.mostrar_cursos;
  delete item.mostrar_bairros;
  delete item.mostrar_preco;
  delete item.mostrar_selo_coren;
  delete item.mostrar_selo_verificada;
  delete item.mostrar_selo_horas;

  return item;
}

async function buscarSupabase(env, filtros) {
  const tentativas = [
    CAMPOS_PUBLICOS,
    CAMPOS_PUBLICOS.filter(function (c) { return c !== 'como_aparecer'; }),
    CAMPOS_PUBLICOS.filter(function (c) { return c.indexOf('mostrar_') !== 0; }),
    CAMPOS_PUBLICOS.filter(function (c) { return c !== 'como_aparecer' && c.indexOf('mostrar_') !== 0; }),
    CAMPOS_PUBLICOS.filter(function (c) { return c !== 'slug' && c !== 'como_aparecer' && c.indexOf('mostrar_') !== 0; })
  ];

  let resp;
  for (let i = 0; i < tentativas.length; i++) {
    resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + filtros.concat(['select=' + tentativas[i].join(',')]).join('&'),
      { headers: headersSupabase(env) }
    );
    if (resp.ok) return resp;
  }

  return resp;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!supabaseOk(env)) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const url = new URL(request.url);
    const idBruto = url.searchParams.get('id');
    const hoje = new Date().toISOString();

    // Perfil por link exclusivo (slug público ou UUID interno)
    if (idBruto !== null && String(idBruto).trim() !== '') {
      const ref = refPerfilSegura(idBruto);
      if (!ref) {
        return jsonResp({ error: 'ID inválido' }, 400);
      }

      const filtrosId = [
        filtroPerfilPorRef(ref),
        'aprovada=eq.true',
        'status_pagamento=eq.Pago',
        'plano_valido_ate=gte.' + hoje,
        'or=(plano_cadastro.eq.true,plano_profissional.eq.true,plano_destaque.eq.true)',
        'limit=1'
      ];

      const resp = await buscarSupabase(env, filtrosId);
      if (!resp.ok) {
        const txt = await resp.text();
        console.error('Erro buscar perfil:', txt);
        if (!ehUuid(ref)) {
          return jsonResp({ error: 'Perfil não encontrado' }, 404);
        }
        return jsonResp({ error: 'Falha ao buscar perfil' }, 502);
      }

      const linhas = await resp.json();
      if (!linhas || linhas.length === 0) {
        return jsonResp({ error: 'Perfil não encontrado' }, 404);
      }

      return new Response(JSON.stringify({ cuidadora: perfilPublico(linhas[0]) }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60, s-maxage=60'
        }
      });
    }

    // Lista da home: só planos de visibilidade
    const filtrosLista = [
      'aprovada=eq.true',
      'status_pagamento=eq.Pago',
      'plano_valido_ate=gte.' + hoje,
      'or=(plano_profissional.eq.true,plano_destaque.eq.true)',
      'order=plano_destaque.desc,criado_em.desc'
    ];

    const resp = await buscarSupabase(env, filtrosLista);
    if (!resp.ok) {
      console.error('Erro listar vitrine:', await resp.text());
      return jsonResp({ error: 'Falha ao listar' }, 502);
    }

    const linhas = await resp.json();
    const cuidadores = (linhas || []).map(perfilPublico);

    return new Response(JSON.stringify({ cuidadores: cuidadores }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=60'
      }
    });
  } catch (err) {
    console.error('Erro GET cuidadores:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPost() {
  return metodoNaoPermitido();
}

export async function onRequestPatch() {
  return metodoNaoPermitido();
}
