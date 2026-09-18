// API pública da vitrine + perfil por link.
// GET sem id → lista (só Profissional/Destaque)
// GET ?id= → um perfil (inclui Cadastro Básico, se pago e aprovado)

import { jsonResp, metodoNaoPermitido } from '../_lib/http.js';
import { headersSupabase, supabaseOk } from '../_lib/supabase.js';
import { idSeguro } from '../_lib/auth.js';

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
  item.whatsapp = item.whatsapp || item.whatsapp_agencia || null;

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
  let resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?' + filtros.concat(['select=' + CAMPOS_PUBLICOS.join(',')]).join('&'),
    { headers: headersSupabase(env) }
  );

  if (!resp.ok) {
    const semFlags = CAMPOS_PUBLICOS.filter(function (c) { return c.indexOf('mostrar_') !== 0; });
    resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?' + filtros.concat(['select=' + semFlags.join(',')]).join('&'),
      { headers: headersSupabase(env) }
    );
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
    const rawId = url.searchParams.get('id');
    const hoje = new Date().toISOString();

    // Perfil por link exclusivo (Cadastro Básico, Profissional ou Destaque)
    if (rawId !== null && String(rawId).trim() !== '') {
      const id = idSeguro(rawId);
      const isUuid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (!isUuid) {
        return jsonResp({ error: 'ID inválido' }, 400);
      }

      const filtrosId = [
        'id=eq.' + encodeURIComponent(id),
        'aprovada=eq.true',
        'status_pagamento=eq.Pago',
        'plano_valido_ate=gte.' + hoje,
        'or=(plano_cadastro.eq.true,plano_profissional.eq.true,plano_destaque.eq.true)',
        'limit=1'
      ];

      const resp = await buscarSupabase(env, filtrosId);
      if (!resp.ok) {
        console.error('Erro buscar perfil:', await resp.text());
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
      'order=criado_em.desc'
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
