import { describe, expect, it } from 'vitest';
import { duplicateKey, normalizeForSearch, triageComment } from './normalize';

describe('normalização para busca (§7.2)', () => {
  it('remove acento e baixa a caixa', () => {
    expect(normalizeForSearch('Não chegou o PEDIDO')).toBe('nao chegou o pedido');
    expect(normalizeForSearch('AÇÃO ÚNICA')).toBe('acao unica');
  });

  it('colapsa espaços', () => {
    expect(normalizeForSearch('  muito    atraso  ')).toBe('muito atraso');
  });

  it('troca emoji por espaço em vez de removê-lo', () => {
    // Remover colaria as palavras e criaria trigramas que não existem no texto.
    expect(normalizeForSearch('produto😡péssimo')).toBe('produto pessimo');
  });

  it('devolve null para texto sem conteúdo', () => {
    expect(normalizeForSearch(null)).toBeNull();
    expect(normalizeForSearch('')).toBeNull();
    expect(normalizeForSearch('   ')).toBeNull();
  });
});

describe('triagem determinística (§9.2)', () => {
  it('aprova comentário com conteúdo real', () => {
    expect(triageComment('meu pedido não chegou').worthAnalyzing).toBe(true);
    expect(triageComment('quanto custa?').worthAnalyzing).toBe(true);
  });

  it('descarta vazio', () => {
    expect(triageComment(null)).toMatchObject({ worthAnalyzing: false, reason: 'empty' });
    expect(triageComment('   ')).toMatchObject({ worthAnalyzing: false, reason: 'empty' });
  });

  it('descarta apenas emoji', () => {
    expect(triageComment('😍😍😍')).toMatchObject({ worthAnalyzing: false, reason: 'only_emoji' });
    expect(triageComment('❤️')).toMatchObject({ worthAnalyzing: false, reason: 'only_emoji' });
  });

  it('descarta apenas menções, que o §9.4 classifica como off_topic', () => {
    expect(triageComment('@joao')).toMatchObject({
      worthAnalyzing: false,
      reason: 'only_mentions',
    });
    expect(triageComment('@joao @maria.silva')).toMatchObject({
      worthAnalyzing: false,
      reason: 'only_mentions',
    });
  });

  it('APROVA menção acompanhada de texto — "@joao olha isso" tem conteúdo', () => {
    // A regra 4 do §9.4 trata isso como off_topic, mas essa é decisão do classificador.
    // A triagem só descarta o que não tem nada para classificar.
    expect(triageComment('@joao olha isso').worthAnalyzing).toBe(true);
  });

  it('descarta texto com menos de três caracteres', () => {
    expect(triageComment('ok')).toMatchObject({ worthAnalyzing: false, reason: 'too_short' });
    expect(triageComment('sim').worthAnalyzing).toBe(true);
  });

  it('descarta pontuação isolada', () => {
    expect(triageComment('!!!')).toMatchObject({
      worthAnalyzing: false,
      reason: 'only_punctuation',
    });
    expect(triageComment('...')).toMatchObject({
      worthAnalyzing: false,
      reason: 'only_punctuation',
    });
  });

  it('aprova "kkkk", que carrega sinal — pode ser deboche (§9.4, regra 5)', () => {
    expect(triageComment('kkkkkk').worthAnalyzing).toBe(true);
  });
});

describe('chave de duplicata (§9.2)', () => {
  it('trata variações de acento e pontuação do mesmo autor como duplicata', () => {
    expect(duplicateKey('psid-1', 'Cadê meu pedido???')).toBe(
      duplicateKey('psid-1', 'cade meu pedido'),
    );
  });

  it('distingue autores diferentes com o mesmo texto', () => {
    expect(duplicateKey('psid-1', 'cade meu pedido')).not.toBe(
      duplicateKey('psid-2', 'cade meu pedido'),
    );
  });

  it('devolve null quando não há texto', () => {
    expect(duplicateKey('psid-1', null)).toBeNull();
  });
});
