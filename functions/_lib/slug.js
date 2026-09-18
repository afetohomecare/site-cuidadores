const RESERVADAS = {
  api: true, admin: true, painel: true, perfil: true, cadastro: true,
  planos: true, login: true, index: true, termos: true, privacidade: true,
  config: true, checkout: true, asaas: true, auth: true, cuidadores: true,
  solicitacoes: true, www: true, static: true, assets: true, favicon: true
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor) {
  return UUID_RE.test(String(valor || '').trim());
}

function semAcento(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function gerarSlugBase(nome) {
  const tokens = semAcento(nome)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const a = tokens[0] || 'perfil';
  const b = tokens[1] || '';
  let base = b ? (a + '-' + b) : a;
  base = base.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (base.length < 3) base = (base + '-afeto').slice(0, 40);
  if (RESERVADAS[base]) base = base + '-perfil';
  return base.slice(0, 60);
}

export function slugValido(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) return false;
  if (v.length < 3 || v.length > 80) return false;
  if (RESERVADAS[v]) return false;
  if (ehUuid(v)) return false;
  return true;
}

export function refPerfilSegura(valor) {
  const v = String(valor || '').trim();
  if (!v) return null;
  if (ehUuid(v)) return v;
  if (slugValido(v)) return v;
  return null;
}

export function filtroPerfilPorRef(ref) {
  return ehUuid(ref)
    ? 'id=eq.' + encodeURIComponent(ref)
    : 'slug=eq.' + encodeURIComponent(ref);
}

export function linkPerfilPublico(cuidadora) {
  const ref = (cuidadora && (cuidadora.slug || cuidadora.id)) || '';
  return 'https://afetocuidadores.pages.dev/perfil.html?id=' + encodeURIComponent(ref);
}

function colunaSlugAusente(status, texto) {
  const t = String(texto || '').toLowerCase();
  if (t.indexOf('slug') === -1) return false;
  return t.indexOf('does not exist') !== -1
    || t.indexOf('schema cache') !== -1
    || t.indexOf('column') !== -1
    || t.indexOf('42703') !== -1
    || t.indexOf('pgrst204') !== -1;
}

export async function garantirSlugUnico(env, nome, idAtual) {
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const base = gerarSlugBase(nome);
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };

  for (let i = 0; i < 30; i++) {
    const candidato = i === 0 ? base : (base + '-' + (i + 1));
    if (!slugValido(candidato) && i > 0) continue;

    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?slug=eq.' + encodeURIComponent(candidato) + '&select=id&limit=1',
      { headers: headers }
    );
    if (!resp.ok) {
      const txt = await resp.text();
      if (colunaSlugAusente(resp.status, txt)) return null;
      console.warn('Slug consulta falhou:', resp.status, txt.substring(0, 180));
      return null;
    }
    const linhas = await resp.json();
    const dono = linhas && linhas[0] && linhas[0].id;
    if (!dono || String(dono) === String(idAtual)) return candidato;
  }
  return null;
}
