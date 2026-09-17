// API pública da vitrine. Admin usa /api/admin/cuidadoras.

import { jsonResp, metodoNaoPermitido } from '../_lib/http.js';
import { headersSupabase, supabaseOk } from '../_lib/supabase.js';

const CAMPOS_PUBLICOS = [
  'id',
  'nome',
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

export async function onRequestGet(context) {
  const { env } = context;

  if (!supabaseOk(env)) {
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
    console.error('Erro GET vitrine:', err);
    return jsonResp({ error: 'Falha no processamento' }, 500);
  }
}

export async function onRequestPost() {
  return metodoNaoPermitido();
}

export async function onRequestPatch() {
  return metodoNaoPermitido();
}
