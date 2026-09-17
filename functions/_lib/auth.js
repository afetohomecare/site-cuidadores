import { headersSupabase } from './supabase.js';

export function roleDoUsuario(user) {
  if (!user) return null;
  const app = user.app_metadata && user.app_metadata.role;
  const meta = user.user_metadata && user.user_metadata.role;
  return app || meta || null;
}

export function ehAdmin(user) {
  return roleDoUsuario(user) === 'admin';
}

function bearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

export async function usuarioDoToken(env, request) {
  const token = bearer(request);
  if (!token) return null;

  const resp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + token
    }
  });
  if (!resp.ok) return null;
  return resp.json();
}

export async function validarAdmin(env, request) {
  const user = await usuarioDoToken(env, request);
  if (!user) return { ok: false, motivo: 'Token ausente ou inválido' };
  if (!ehAdmin(user)) return { ok: false, motivo: 'Acesso restrito a administradores' };
  return { ok: true, user: user };
}

export async function validarCuidadora(env, request, select) {
  const user = await usuarioDoToken(env, request);
  if (!user) return null;

  const campos = select || 'id';
  const buscaResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?auth_user_id=eq.' +
    encodeURIComponent(user.id) + '&select=' + campos + '&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!buscaResp.ok) return null;
  const linhas = await buscaResp.json();
  if (!linhas || linhas.length === 0) return null;
  return linhas[0];
}

export function idSeguro(valor) {
  const v = String(valor || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(v)) return v;
  return null;
}
