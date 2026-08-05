/**
 * Popula o banco com dados falsos para avaliar a interface sem depender do Meta.
 *
 * Existe porque conectar de verdade depende de app aprovado no Meta App
 * Dashboard, e esperar isso para só então descobrir se a interface serve é a
 * ordem errada.
 *
 *   pnpm db:seed:demo          # insere
 *   pnpm db:seed:demo --limpar # remove só o que este script criou
 *
 * As contas criadas têm `external_id` prefixado com `demo_`, e o token cifrado é
 * lixo — qualquer chamada real à Graph API com elas falha, de propósito.
 */
import { like } from 'drizzle-orm';
import { accounts, comments, db, posts } from './index';
import { encrypt } from '../lib/crypto';
import { MOTIVES } from '../lib/taxonomy';

const DEMO_PREFIX = 'demo_';

/** Comentários plausíveis de uma marca brasileira de varejo, já classificados. */
const SAMPLES: {
  text: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  motive: string;
  intent: 'question' | 'complaint' | 'praise' | 'purchase_intent' | 'other';
  urgency: 'low' | 'medium' | 'high';
  question?: boolean;
  spam?: boolean;
}[] = [
  { text: 'Quanto custa esse? 😍', sentiment: 'neutral', motive: 'preco', intent: 'question', urgency: 'medium', question: true },
  { text: 'Amei!! Já quero', sentiment: 'positive', motive: 'intencao_compra', intent: 'purchase_intent', urgency: 'medium' },
  { text: 'Tem no tamanho 18?', sentiment: 'neutral', motive: 'disponibilidade', intent: 'question', urgency: 'medium', question: true },
  { text: 'Fiz o pedido dia 3 e até agora nada. Ninguém responde no direct.', sentiment: 'negative', motive: 'status_pedido', intent: 'complaint', urgency: 'high', question: true },
  { text: 'Chegou hoje, é ainda mais bonito que na foto ❤️', sentiment: 'positive', motive: 'qualidade', intent: 'praise', urgency: 'low' },
  { text: 'Vocês entregam em Manaus? Qual o prazo?', sentiment: 'neutral', motive: 'frete_entrega', intent: 'question', urgency: 'medium', question: true },
  { text: 'Achei bem caro pra qualidade do acabamento', sentiment: 'negative', motive: 'preco', intent: 'complaint', urgency: 'medium' },
  { text: '❤️❤️❤️', sentiment: 'positive', motive: 'elogio', intent: 'praise', urgency: 'low' },
  { text: 'O meu escureceu em duas semanas de uso. Isso é normal?', sentiment: 'negative', motive: 'qualidade', intent: 'complaint', urgency: 'high', question: true },
  { text: 'Como faço para trocar? Veio o modelo errado', sentiment: 'negative', motive: 'troca_garantia', intent: 'complaint', urgency: 'high', question: true },
  { text: 'Aceita pix parcelado?', sentiment: 'neutral', motive: 'preco', intent: 'question', urgency: 'medium', question: true },
  { text: 'Atendimento da Bia foi impecável, obrigada!', sentiment: 'positive', motive: 'atendimento', intent: 'praise', urgency: 'low' },
  { text: 'Esse cupom de 20% ainda vale?', sentiment: 'neutral', motive: 'promocao', intent: 'question', urgency: 'medium', question: true },
  { text: 'GANHE SEGUIDORES AGORA >> link.bio/xxx', sentiment: 'neutral', motive: 'spam', intent: 'other', urgency: 'low', spam: true },
  { text: 'É banhado ou ouro maciço?', sentiment: 'neutral', motive: 'duvida_produto', intent: 'question', urgency: 'medium', question: true },
  { text: 'Terceira vez que peço e terceira vez que atrasa. Última compra.', sentiment: 'negative', motive: 'frete_entrega', intent: 'complaint', urgency: 'high' },
  { text: 'Linda demais essa coleção 👏', sentiment: 'positive', motive: 'elogio', intent: 'praise', urgency: 'low' },
  { text: 'Vai ter reposição da gargantilha?', sentiment: 'neutral', motive: 'disponibilidade', intent: 'question', urgency: 'medium', question: true },
];

const AUTHORS = [
  'Ana Paula', 'Marina Costa', 'Juliana Alves', 'Rafaela Souza', 'Camila Dias',
  'Beatriz Lima', 'Patrícia Nunes', 'Letícia Moraes', 'Fernanda Rocha', 'Carla Menezes',
];

const POST_CAPTIONS = [
  'Coleção Aurora — elos em ouro 18k',
  'Novidade: brincos ponto de luz',
  'Nossa gargantilha mais pedida voltou ao estoque',
  'Presente de Dia das Mães 💛',
  'Como cuidar das suas joias no dia a dia',
  'Bastidores da produção artesanal',
];

async function clear(): Promise<void> {
  // O ON DELETE CASCADE do schema leva posts e comentários junto.
  const removed = await db.delete(accounts).where(like(accounts.externalId, `${DEMO_PREFIX}%`));
  console.log('Dados de demonstração removidos.', removed);
}

async function seed(): Promise<void> {
  const existing = await db.select().from(accounts).where(like(accounts.externalId, `${DEMO_PREFIX}%`)).all();
  if (existing.length > 0) {
    console.log('Já existem dados de demonstração. Rode com --limpar antes de inserir de novo.');
    return;
  }

  // Token deliberadamente inválido: se algo tentar usar estas contas contra a
  // Graph API, a falha é imediata em vez de silenciosa.
  const fakeToken = encrypt('TOKEN_DE_DEMONSTRACAO_INVALIDO');

  const created = [];
  for (const spec of [
    { platform: 'facebook', name: 'Murano Joias (demo)', username: null },
    { platform: 'instagram', name: 'muranojoias (demo)', username: 'muranojoias' },
  ]) {
    created.push(
      await db
        .insert(accounts)
        .values({
          platform: spec.platform,
          externalId: `${DEMO_PREFIX}${spec.platform}`,
          name: spec.name,
          username: spec.username,
          accessToken: fakeToken,
          tasks: ['MODERATE', 'CREATE_CONTENT', 'MANAGE'],
          status: 'active',
          lastSyncedAt: new Date(),
        })
        .returning()
        .get(),
    );
  }

  const day = 86_400_000;
  let commentCount = 0;
  let replyCount = 0;

  for (const account of created) {
    for (const [index, caption] of POST_CAPTIONS.entries()) {
      // Publicações espalhadas pelos últimos 60 dias.
      const publishedAt = new Date(Date.now() - (index * 9 + 2) * day);

      const post = await db
        .insert(posts)
        .values({
          accountId: account.id,
          externalId: `${DEMO_PREFIX}post_${account.platform}_${index}`,
          platform: account.platform,
          message: caption,
          permalink: 'https://example.com/demo-post',
          mediaType: account.platform === 'instagram' ? 'IMAGE' : 'PHOTO',
          publishedAt,
        })
        .returning()
        .get();

      // Volume variável por post, para a volumetria não ficar uma reta.
      const howMany = 4 + ((index * 5 + account.platform.length) % 9);

      for (let n = 0; n < howMany; n++) {
        const sample = SAMPLES[(index * 7 + n * 3) % SAMPLES.length];
        const author = AUTHORS[(index + n) % AUTHORS.length];
        // Comentários caem depois do post, ao longo de até 3 dias.
        const commentAt = new Date(publishedAt.getTime() + (n + 1) * 4 * 3_600_000);
        if (commentAt > new Date()) continue;

        const externalId = `${DEMO_PREFIX}c_${account.platform}_${index}_${n}`;
        // Parte dos urgentes fica sem resposta, para a fila ter o que mostrar.
        const answered = sample.urgency !== 'high' && n % 3 === 0;

        await db.insert(comments).values({
          accountId: account.id,
          postId: post.id,
          externalId,
          platform: account.platform,
          authorExternalId: `${DEMO_PREFIX}author_${author.replace(/\s/g, '')}`,
          authorName: account.platform === 'instagram' ? author.split(' ')[0].toLowerCase() : author,
          message: sample.text,
          likeCount: (n * 3) % 12,
          replyCount: answered ? 1 : 0,
          publishedAt: commentAt,
          status: answered ? 'answered' : 'new',
          sentiment: sample.sentiment,
          motive: sample.motive,
          intent: sample.intent,
          urgency: sample.urgency,
          isQuestion: sample.question ?? false,
          isSpam: sample.spam ?? false,
          aiConfidence: 80 + ((n * 7) % 18),
          aiModel: 'demo',
          analyzedAt: new Date(),
          syncedAt: new Date(),
        });
        commentCount++;

        if (answered) {
          await db.insert(comments).values({
            accountId: account.id,
            postId: post.id,
            externalId: `${externalId}_r`,
            platform: account.platform,
            parentExternalId: externalId,
            authorExternalId: account.externalId,
            authorName: 'Você',
            isOwn: true,
            message: 'Oi! Respondemos no seu direct com todos os detalhes 💛',
            publishedAt: new Date(commentAt.getTime() + 2 * 3_600_000),
            status: 'answered',
            syncedAt: new Date(),
          });
          replyCount++;
        }
      }
    }
  }

  // Rede de segurança para quem editar a taxonomia e esquecer o seed.
  const known = new Set(MOTIVES.map((motive) => motive.id as string));
  const unknown = [...new Set(SAMPLES.map((sample) => sample.motive))].filter(
    (motive) => !known.has(motive),
  );
  if (unknown.length > 0) {
    console.warn('Motivos fora da taxonomia:', unknown.join(', '));
  }

  console.log(
    `Inseridos: 2 contas, ${POST_CAPTIONS.length * 2} publicações, ` +
      `${commentCount} comentários e ${replyCount} respostas.`,
  );
}

const main = process.argv.includes('--limpar') ? clear : seed;
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
