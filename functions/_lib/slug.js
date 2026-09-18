// Slug público do perfil (parte do nome no link).
// O UUID interno continua sendo a chave no banco / Asaas / auth.

const RESERVADOS = {
  api: 1, admin: 1, painel: 1, login: 1, cadastro: 1, planos: 1,
  perfil: 1, termos: 1, privacidade: 1, index: 1, www: 1, afeto: 1
};

export function slugValido(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) return null;
  if (v.length < 2 || v.length > 80) return null;
  return v;
}

export function gerarSlugBase(nome) {
  const limpo = String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const partes = limpo.split('-').filter(Boolean);
  if (partes.length === 0) return 'perfil';

  let base = partes.length === 1
    ? partes[0]
    : partes[0] + '-' + partes[1];

  base = base.slice(0, 60).replace(/-$/g, '');
  if (base.length < 2) base = 'perfil';
  if (RESERVADOS[base]) base = base + '-perfil';
  return base;
}

export function refPerfilSegura(valor) {
  const v = String(valor || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return { tipo: 'uuid', valor: v };
  }
  const slug = slugValido(v);
  if (slug) return { tipo: 'slug', valor: slug };
  return null;
}

export function linkPublicoPerfil(slugOuId) {
  const ref = String(slugOuId || '').trim();
  return 'https://afetocuidadores.pages.dev/perfil.html?id=' + encodeURIComponent(ref);
}

async function slugJaExiste(env, headersSupabase, slug, excluirId) {
  let url = env.SUPABASE_URL + '/rest/v1/cuidadores?slug=eq.' + encodeURIComponent(slug) + '&select=id&limit=1';
  if (excluirId) {
    url += '&id=neq.' + encodeURIComponent(excluirId);
  }
  const resp = await fetch(url, { headers: headersSupabase(env) });
  if (!resp.ok) {
    // Coluna slug ainda não existe no banco
    const txt = await resp.text();
    if (/slug|column|schema/i.test(txt)) return { erroColuna: true };
    console.error('Erro checar slug:', resp.status, txt);
    return { erro: true };
  }
  const linhas = await resp.json();
  return { existe: !!(linhas && linhas.length > 0) };
}

export async function garantirSlugUnico(env, headersSupabase, nome, excluirId) {
  const base = gerarSlugBase(nome);
  let candidato = base;

  for (let i = 0; i < 30; i++) {
    if (i > 0) candidato = base + '-' + (i + 1);
    const checagem = await slugJaExiste(env, headersSupabase, candidato, excluirId || null);
    if (checagem.erroColuna) return { slug: null, semColuna: true };
    if (checagem.erro) return { slug: null, erro: true };
    if (!checagem.existe) return { slug: candidato };
  }

  const sufixo = String(Date.now()).slice(-4);
  return { slug: (base + '-' + sufixo).slice(0, 80) };
}
