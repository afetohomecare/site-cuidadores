export function headersSupabase(env, temBody, querRetorno) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  if (querRetorno === 'minimal') h['Prefer'] = 'return=minimal';
  else if (querRetorno) h['Prefer'] = 'return=representation';
  return h;
}

export function supabaseOk(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export function tabelaAusente(texto) {
  const t = String(texto || '').toLowerCase();
  if (t.indexOf('42703') !== -1 || t.indexOf('pgrst204') !== -1) return false;
  if (t.indexOf('42p01') !== -1 || t.indexOf('pgrst205') !== -1) return true;
  if (t.indexOf('could not find the table') !== -1) return true;
  if (t.indexOf('relation') !== -1 && t.indexOf('does not exist') !== -1) {
    if (t.indexOf('column') !== -1) return false;
    return true;
  }
  return false;
}

export function colunaAusente(texto) {
  const t = String(texto || '').toLowerCase();
  if (tabelaAusente(t)) return false;
  return t.indexOf('42703') !== -1
    || t.indexOf('pgrst204') !== -1
    || t.indexOf('schema cache') !== -1
    || (t.indexOf('column') !== -1 && t.indexOf('does not exist') !== -1)
    || (t.indexOf('could not find the') !== -1 && t.indexOf('column') !== -1);
}

export function nomeColunaAusente(texto) {
  const s = String(texto || '');
  const m1 = s.match(/Could not find the '([^']+)' column/i);
  if (m1) return m1[1];
  const m2 = s.match(/column "([^"]+)" of relation/i);
  if (m2) return m2[1];
  const m3 = s.match(/column ([a-z0-9_]+) does not exist/i);
  if (m3) return m3[1];
  return null;
}

export function erroPermissao(status, texto) {
  const t = String(texto || '').toLowerCase();
  return status === 401
    || status === 403
    || t.indexOf('42501') !== -1
    || t.indexOf('permission denied') !== -1
    || t.indexOf('jwt') !== -1
    || t.indexOf('pgrst301') !== -1
    || t.indexOf('not allowed') !== -1
    || t.indexOf('row-level security') !== -1
    || t.indexOf('rls') !== -1;
}

export function erroTipoDados(texto) {
  const t = String(texto || '').toLowerCase();
  return t.indexOf('22p02') !== -1
    || t.indexOf('42804') !== -1
    || t.indexOf('23502') !== -1
    || t.indexOf('23514') !== -1
    || t.indexOf('23503') !== -1
    || t.indexOf('invalid input') !== -1
    || t.indexOf('invalid input syntax') !== -1
    || t.indexOf('datatype mismatch') !== -1
    || t.indexOf('violates') !== -1
    || t.indexOf('malformed') !== -1;
}
