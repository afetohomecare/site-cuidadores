/**
 * Rótulo conjugado da profissão (vitrine, perfil, painel, cadastro).
 * como_aparecer: feminino | masculino | neutro
 * Null/vazio: neutro, com inferência só na EXIBIÇÃO se o texto legado for
 * claramente feminino ou masculino (Enfermeira, Cuidadora, Técnico de Enfermagem).
 * Não reescreve especialidade no banco.
 */
(function (root) {
  'use strict';

  var PREFS = { feminino: 1, masculino: 1, neutro: 1 };

  var ROTULOS = {
    cuidador_idosos: {
      feminino: 'Cuidadora de Idosos',
      masculino: 'Cuidador de Idosos',
      neutro: 'Cuidado de idosos'
    },
    tecnico_enfermagem: {
      feminino: 'Técnica de Enfermagem',
      masculino: 'Técnico de Enfermagem',
      neutro: 'Técnica(o) de Enfermagem'
    },
    enfermeiro: {
      feminino: 'Enfermeira',
      masculino: 'Enfermeiro',
      neutro: 'Enfermagem'
    },
    acompanhante: {
      feminino: 'Acompanhante Hospitalar',
      masculino: 'Acompanhante Hospitalar',
      neutro: 'Acompanhante Hospitalar'
    },
    estudante: {
      feminino: 'Estudante da área da saúde',
      masculino: 'Estudante da área da saúde',
      neutro: 'Estudante da área da saúde'
    }
  };

  var VAZIO = {
    vitrine: { feminino: 'Cuidadora', masculino: 'Cuidador', neutro: 'Cuidador(a)' },
    perfil: { feminino: 'Cuidadora', masculino: 'Cuidador', neutro: 'Cuidador(a)' },
    painel: { feminino: 'Cuidadora', masculino: 'Cuidador', neutro: 'Cuidado' }
  };

  function compacto(especialidade) {
    var t = String(especialidade || '').toLowerCase().replace(/\(a\)/gi, '');
    try {
      t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {}
    return t.replace(/[^a-z0-9]+/g, '');
  }

  function chaveEspecialidade(especialidade) {
    var c = compacto(especialidade);
    if (!c) return '';
    if ((c.indexOf('cuidador') !== -1 && c.indexOf('idosos') !== -1) || c.indexOf('cuidadora') !== -1) {
      return 'cuidador_idosos';
    }
    if ((c.indexOf('tecnico') !== -1 || c.indexOf('tecnica') !== -1) && c.indexOf('enfermagem') !== -1) {
      return 'tecnico_enfermagem';
    }
    if (c.indexOf('enfermeir') !== -1) return 'enfermeiro';
    if (c.indexOf('acompanhante') !== -1) return 'acompanhante';
    if (c.indexOf('estudante') !== -1) return 'estudante';
    return 'outro';
  }

  function inferirDoLegado(especialidade) {
    if (/\(a\)/i.test(String(especialidade || ''))) return 'neutro';
    var c = compacto(especialidade);
    if (!c) return 'neutro';
    if (c.indexOf('enfermeira') !== -1) return 'feminino';
    if (c.indexOf('cuidadora') !== -1) return 'feminino';
    if (c.indexOf('tecnica') !== -1 && c.indexOf('enfermagem') !== -1) return 'feminino';
    if (c.indexOf('enfermeiro') !== -1) return 'masculino';
    if (c.indexOf('cuidador') !== -1) return 'masculino';
    if (c.indexOf('tecnico') !== -1 && c.indexOf('enfermagem') !== -1) return 'masculino';
    return 'neutro';
  }

  function preferenciaEfetiva(comoAparecer, especialidade) {
    var p = String(comoAparecer || '').trim().toLowerCase();
    if (PREFS[p]) return p;
    return inferirDoLegado(especialidade);
  }

  function fallbackVazio(contexto, pref) {
    var mapa = VAZIO[contexto] || VAZIO.vitrine;
    return mapa[pref] || mapa.neutro;
  }

  function rotuloEspecialidade(especialidade, comoAparecer, contexto) {
    var pref = preferenciaEfetiva(comoAparecer, especialidade);
    var ctx = contexto === 'painel' ? 'painel' : (contexto === 'perfil' ? 'perfil' : 'vitrine');
    var chave = chaveEspecialidade(especialidade);
    if (!chave) return fallbackVazio(ctx, pref);
    if (chave === 'outro') {
      var original = String(especialidade || '').trim();
      return original || fallbackVazio(ctx, pref);
    }
    return ROTULOS[chave][pref];
  }

  root.chaveEspecialidade = chaveEspecialidade;
  root.preferenciaEfetiva = preferenciaEfetiva;
  root.rotuloEspecialidade = rotuloEspecialidade;
})(typeof window !== 'undefined' ? window : this);
