/**
 * Taxonomia inicial de motivos — Apêndice A do PRD.
 *
 * Inserida em `ai_topics` na criação de cada organização, com `is_managed = false` para
 * permitir refinamento automático. A razão de existir está no próprio Apêndice A: a
 * descoberta automática de tópicos precisa de um ponto de partida para não gerar centenas
 * de temas fragmentados nas primeiras semanas.
 *
 * `description` não é texto de interface: é a instrução que vai ao classificador dentro do
 * bloco TAXONOMIA DE MOTIVOS DISPONÍVEL do prompt do §9.4. Escrita para desambiguar, não
 * para explicar ao usuário.
 *
 * `keywords` alimenta o casamento determinístico anterior à chamada de LLM e a exibição de
 * "termos característicos" no §8.4.
 */

import type { Transaction } from '../client';
import { aiTopics } from '../schema/ai';

export interface TaxonomySeed {
  category: string;
  name: string;
  description: string;
  keywords: string[];
}

export const INITIAL_TAXONOMY: readonly TaxonomySeed[] = [
  {
    category: 'logistica',
    name: 'atraso na entrega',
    description: 'Reclamação ou dúvida sobre pedido que não chegou no prazo',
    keywords: ['atraso', 'não chegou', 'nao chegou', 'atrasado', 'até hoje', 'faz dias'],
  },
  {
    category: 'logistica',
    name: 'frete e prazo',
    description: 'Questionamento sobre custo de envio, prazo estimado ou área de cobertura',
    keywords: ['frete', 'prazo', 'entrega', 'cep', 'envio', 'quanto tempo'],
  },
  {
    category: 'logistica',
    name: 'rastreamento',
    description: 'Pedido de informação sobre status ou código de rastreio',
    keywords: ['rastreio', 'rastreamento', 'código', 'codigo', 'onde está', 'onde esta'],
  },
  {
    category: 'produto',
    name: 'dúvida sobre especificação',
    description: 'Pergunta sobre tamanho, composição, compatibilidade ou funcionamento',
    keywords: ['tamanho', 'medida', 'material', 'composição', 'serve', 'funciona', 'compatível'],
  },
  {
    category: 'produto',
    name: 'disponibilidade e estoque',
    description: 'Pergunta sobre produto esgotado, reposição ou variação indisponível',
    keywords: ['esgotado', 'estoque', 'reposição', 'reposicao', 'tem', 'acabou', 'quando volta'],
  },
  {
    category: 'produto',
    name: 'qualidade e defeito',
    description: 'Relato de produto danificado, com defeito ou abaixo do esperado',
    keywords: ['defeito', 'quebrado', 'danificado', 'rasgou', 'péssima qualidade', 'veio errado'],
  },
  {
    category: 'produto',
    name: 'elogio ao produto',
    description: 'Manifestação positiva sobre o produto ou resultado obtido',
    keywords: ['amei', 'perfeito', 'maravilhoso', 'melhor', 'recomendo', 'top'],
  },
  {
    category: 'preco',
    name: 'questionamento de preço',
    description: 'Percepção de preço alto, comparação com concorrente ou pedido de desconto',
    keywords: ['caro', 'preço', 'preco', 'valor', 'desconto', 'absurdo', 'mais barato'],
  },
  {
    category: 'preco',
    name: 'promoção e cupom',
    description: 'Dúvida sobre validade, aplicação ou existência de promoção',
    keywords: ['cupom', 'promoção', 'promocao', 'desconto', 'black friday', 'oferta'],
  },
  {
    category: 'compra',
    name: 'como comprar',
    description: 'Pedido de link, endereço de loja ou orientação de compra',
    keywords: ['link', 'onde compro', 'como comprar', 'loja', 'site', 'endereço'],
  },
  {
    category: 'compra',
    name: 'formas de pagamento',
    description: 'Dúvida sobre parcelamento, meios de pagamento ou falha no checkout',
    keywords: ['parcela', 'pix', 'cartão', 'cartao', 'boleto', 'pagamento', 'checkout'],
  },
  {
    category: 'atendimento',
    name: 'falta de resposta',
    description: 'Reclamação de contato anterior não respondido em qualquer canal',
    keywords: ['não responde', 'nao responde', 'sem resposta', 'ninguém', 'ninguem', 'ignorada'],
  },
  {
    category: 'atendimento',
    name: 'reembolso e troca',
    description: 'Solicitação ou reclamação sobre devolução, estorno ou troca',
    keywords: ['reembolso', 'estorno', 'troca', 'devolução', 'devolucao', 'dinheiro de volta'],
  },
  {
    category: 'atendimento',
    name: 'elogio ao atendimento',
    description: 'Manifestação positiva sobre o serviço prestado',
    keywords: ['atendimento', 'atenciosa', 'resolveram', 'rápido', 'rapido', 'educado'],
  },
  {
    category: 'marca',
    name: 'elogio à marca',
    description: 'Manifestação de afinidade, lealdade ou aprovação institucional',
    keywords: ['amo', 'fã', 'fa', 'sempre compro', 'cliente fiel', 'parabéns'],
  },
  {
    category: 'marca',
    name: 'crítica institucional',
    description: 'Crítica a posicionamento, comunicação, campanha ou conduta da empresa',
    keywords: ['vergonha', 'decepção', 'decepcao', 'posicionamento', 'boicote', 'inaceitável'],
  },
  {
    category: 'conteudo',
    name: 'comentário sobre a criação',
    description: 'Reação ao criativo, música, roteiro ou pessoa que aparece na peça',
    keywords: ['música', 'musica', 'vídeo', 'video', 'quem é', 'trilha', 'edição'],
  },
  {
    category: 'conteudo',
    name: 'pedido de conteúdo',
    description: 'Sugestão ou solicitação de tema, produto ou formato futuro',
    keywords: ['faz', 'queria ver', 'sugestão', 'sugestao', 'poderiam', 'lancem'],
  },
  {
    category: 'ruido',
    name: 'marcação de terceiro',
    description: 'Menção de outro perfil sem conteúdo próprio relevante',
    keywords: ['olha isso', 'vê', 've', 'presta atenção'],
  },
  {
    category: 'ruido',
    name: 'spam e divulgação',
    description: 'Autopromoção, golpe, corrente ou link suspeito',
    keywords: ['ganhe', 'clique aqui', 'renda extra', 'sorteio', 'whatsapp', 'segue lá'],
  },
];

/**
 * Insere a taxonomia inicial para uma organização.
 *
 * `onConflictDoNothing` sobre (organization_id, name) torna a chamada segura em
 * reprocessamento: se a organização já tem um tópico com o mesmo nome — porque o
 * administrador o criou manualmente ou porque a criação foi reexecutada — o existente é
 * preservado. Sobrescrever apagaria curadoria humana.
 *
 * Recebe `tx` em vez de abrir a própria transação para que a criação da organização e o
 * seed sejam atômicos: uma organização sem taxonomia deixaria a descoberta de tópicos sem
 * ponto de partida, que é exatamente o que o Apêndice A quer evitar.
 */
export async function seedTaxonomy(tx: Transaction, organizationId: string): Promise<number> {
  const rows = INITIAL_TAXONOMY.map((topic) => ({
    organizationId,
    name: topic.name,
    description: topic.description,
    category: topic.category,
    keywords: topic.keywords,
    isManaged: false,
    isActive: true,
  }));

  const inserted = await tx
    .insert(aiTopics)
    .values(rows)
    .onConflictDoNothing({ target: [aiTopics.organizationId, aiTopics.name] })
    .returning({ id: aiTopics.id });

  return inserted.length;
}
