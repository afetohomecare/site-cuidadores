import { headersSupabase } from './supabase.js';
import { idSeguro } from './auth.js';

export const MSG_SENHA_ENV = 'Defina ADMIN_SENHA_EXCLUSAO nas variáveis do Cloudflare';

const TABELAS_LIGADAS = [
  'solicitacoes_visiveis',
  'solicitacoes_exclusao',
  'solicitacoes_atendimento',
  'pagamentos_mp',
  'cupons_usos'
];

export function senhaExclusaoConfigurada(env) {
  return !!(env && env.ADMIN_SENHA_EXCLUSAO && String(env.ADMIN_SENHA_EXCLUSAO).length > 0);
}

function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a || ''));
  const bb = enc.encode(String(b || ''));
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

export function validarSenhaExclusao(env, senhaDigitada) {
  if (!senhaExclusaoConfigurada(env)) {
    return { ok: false, status: 503, error: MSG_SENHA_ENV };
  }
  const digitada = String(senhaDigitada || '');
  if (!digitada) {
    return { ok: false, status: 400, error: 'Digite a senha de exclusão.' };
  }
  if (!timingSafeEqualStr(digitada, env.ADMIN_SENHA_EXCLUSAO)) {
    return { ok: false, status: 403, error: 'Senha de exclusão incorreta.' };
  }
  return { ok: true };
}

export function caminhoFotoStorage(urlOuPath) {
  if (!urlOuPath) return null;
  const s = String(urlOuPath);
  const publico = s.split('/storage/v1/object/public/')[1];
  if (publico) return publico;
  const objeto = s.split('/storage/v1/object/')[1];
  if (objeto) return objeto;
  if (s.indexOf('/') !== -1) return s;
  return null;
}

export async function apagarFotoStorage(env, urlOuPath) {
  const caminho = caminhoFotoStorage(urlOuPath);
  if (!caminho) return;
  try {
    await fetch(env.SUPABASE_URL + '/storage/v1/object/' + caminho, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
      }
    });
  } catch (e) {
    console.warn('Erro ao deletar foto:', e);
  }
}

export async function apagarAuthUser(env, authUserId) {
  if (!authUserId) return;
  try {
    await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + authUserId, {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
      }
    });
  } catch (e) {
    console.warn('Erro ao deletar auth user:', e);
  }
}

async function deletarPorCuidador(env, tabela, cuidadorId) {
  try {
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/' + tabela + '?cuidador_id=eq.' + encodeURIComponent(cuidadorId),
      {
        method: 'DELETE',
        headers: headersSupabase(env, false, 'minimal')
      }
    );
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn('Não apagou ' + tabela + ':', resp.status, String(txt).substring(0, 200));
    }
  } catch (e) {
    console.warn('Erro ao apagar ' + tabela + ':', e);
  }
}

export async function buscarCuidadoraParaExclusao(env, cuidadorId) {
  const resp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(cuidadorId) +
    '&select=id,foto_url,foto_url_pendente,foto_pendente_path,auth_user_id,nome&limit=1',
    { headers: headersSupabase(env) }
  );
  if (!resp.ok) return null;
  const linhas = await resp.json();
  return linhas && linhas[0] ? linhas[0] : null;
}

export async function limparArquivosEAuth(env, cuidadora) {
  if (!cuidadora) return;
  const vistos = {};
  const fontes = [cuidadora.foto_url, cuidadora.foto_url_pendente, cuidadora.foto_pendente_path];
  for (let i = 0; i < fontes.length; i++) {
    const caminho = caminhoFotoStorage(fontes[i]);
    if (!caminho || vistos[caminho]) continue;
    vistos[caminho] = true;
    await apagarFotoStorage(env, caminho);
  }
  await apagarAuthUser(env, cuidadora.auth_user_id);
}

export async function excluirCuidadoraDefinitivo(env, cuidadorId) {
  const id = idSeguro(cuidadorId);
  if (!id) return { ok: false, status: 400, error: 'ID inválido' };

  const cuidadora = await buscarCuidadoraParaExclusao(env, id);
  if (!cuidadora) return { ok: false, status: 404, error: 'Cuidadora não encontrada' };

  await limparArquivosEAuth(env, cuidadora);

  for (let i = 0; i < TABELAS_LIGADAS.length; i++) {
    await deletarPorCuidador(env, TABELAS_LIGADAS[i], id);
  }

  const delResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + encodeURIComponent(id),
    {
      method: 'DELETE',
      headers: headersSupabase(env, false, 'minimal')
    }
  );

  if (!delResp.ok) {
    const txt = await delResp.text();
    console.error('Erro DELETE cuidadora:', txt);
    return { ok: false, status: 502, error: 'Falha ao apagar o cadastro no banco' };
  }

  return { ok: true, nome: cuidadora.nome || null };
}
