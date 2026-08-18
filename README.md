# Meta Comments

Plataforma de gestão e análise de comentários do Facebook e do Instagram. Traz os comentários
das suas páginas para um só lugar, onde você responde, curte, oculta e exclui — e mostra
volumetria, sentimento e os principais motivos, classificados por IA.

Um app e um banco em arquivo. Além do Meta e do OpenRouter, usa o Resend para enviar códigos de
acesso por e-mail.

## O que ela faz

**Moderação.** Fila ordenada por urgência e depois por recência: o cliente irritado de ontem
vem antes do emoji de agora. Em cada comentário você responde (a resposta é publicada no Meta),
curte, oculta, exclui ou arquiva, e vê a thread completa de respostas — as suas e as de
terceiros. Filtros por situação, plataforma, sentimento, motivo, urgência, conta e busca no
texto, todos na URL: `?sentiment=negative&motive=frete_entrega` é um link que você pode salvar.
ADMs também podem cadastrar filtros globais por palavra, número ou frase para retirar automações
da fila e das análises — inclusive da IA — sem excluir ou arquivar os comentários no Meta.

**Análise.** Volumetria diária empilhada por sentimento, participação de sentimento no período,
os dez principais motivos (clicáveis, levam ao inbox filtrado) e uma leitura em texto gerada
sob demanda. Janelas de 7, 30 ou 90 dias.

## Como rodar

Requer Node 22+ e pnpm.

```bash
pnpm install
cp .env.example .env     # preencha; veja abaixo
pnpm db:push             # cria o banco SQLite
pnpm dev                 # http://localhost:3000
```

### Variáveis mínimas para subir

Estas variáveis configuram a aplicação e o login:

| Variável | Como obter |
| --- | --- |
| `APP_URL` | `http://localhost:3000` em desenvolvimento |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` (cifra os tokens do Meta em repouso) |
| `RESEND_API_KEY` | chave criada em [resend.com/api-keys](https://resend.com/api-keys) |
| `RESEND_FROM_EMAIL` | remetente de um domínio verificado no Resend |

O login é por usuário, sem senha: o app envia um código de 6 dígitos que expira em 10 minutos.
`pnpm db:push` cria as tabelas e garante o primeiro ADM:
`thiago@muranojoias.com.br`. Depois de entrar, o ADM adiciona e desativa outros usuários em
**Configurações → Usuários**.

Em desenvolvimento (`pnpm dev`), se o Resend não estiver configurado, o código é exibido na
própria tela de login para facilitar o uso local. Em produção, `RESEND_API_KEY` e
`RESEND_FROM_EMAIL` continuam obrigatórios e nenhum código é mostrado na interface.

No Resend, verifique o domínio usado em `RESEND_FROM_EMAIL`. O remetente de teste
`onboarding@resend.dev` só consegue enviar para o próprio e-mail da conta Resend.

`META_APP_ID`/`META_APP_SECRET` e `OPENROUTER_API_KEY` podem ficar vazias: o processo sobe, e
cada tela avisa qual variável falta em vez de falhar de forma opaca. Sem o Meta não há como
conectar; sem o OpenRouter a moderação funciona e a análise fica vazia. Sem as variáveis do
Resend, a tela de login abre, mas informa que ainda não consegue enviar o código.

### Ver funcionando antes de configurar o Meta

Aprovar um app no Meta leva dias ou semanas. Para avaliar a interface hoje:

```bash
pnpm db:seed:demo            # 2 contas, 12 publicações, ~93 comentários já classificados
pnpm db:seed:demo -- --limpar # remove só o que o seed criou
```

Os dados de demonstração têm `external_id` prefixado com `demo_` e token inválido de propósito:
qualquer ação real contra a Graph API com eles falha na hora, em vez de parecer ter funcionado.

## Configurando o app no Meta

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo
   **Business** e adicione o produto **Facebook Login**.
2. Em *Facebook Login → Configurações*, adicione como **Valid OAuth Redirect URI**:
   `http://localhost:3000/api/meta/callback` — precisa bater exatamente com `APP_URL`.
3. Copie **App ID** e **App Secret** para `META_APP_ID` e `META_APP_SECRET`.
4. Reinicie e clique em **Conectar meu Meta** em Configurações.

### Permissões

```
pages_show_list            pages_read_engagement      pages_read_user_content
pages_manage_engagement    instagram_basic            instagram_manage_comments
business_management
```

Enquanto o app está em modo **Development**, elas funcionam nas páginas das quais você é
admin — o suficiente para uso próprio. Modo **Live** exige App Review e Business Verification.

**A página precisa conceder a tarefa `MODERATE` ao app.** Desde a v11.0 a Graph API não retorna
IDs de comentário sem ela, e o sync volta vazio *sem erro*. A tela de Configurações avisa com
uma etiqueta quando detecta uma conta sem essa tarefa.

## Limites reais das APIs do Meta

Nenhum destes tem solução via API oficial, e por isso a interface os trata explicitamente em
vez de oferecer uma ação que sempre falha:

- **Não existe endpoint para curtir comentários do Instagram.** O botão não aparece nesses
  comentários — ausente, não desabilitado.
- **O `username` de quem comentou no Instagram só vem com `instagram_manage_comments`
  concedida.** Sem ela, comentários anônimos.
- **No Instagram, só o dono da mídia pode excluir comentários**, mesmo que o solicitante seja o
  autor. Falha de exclusão é resultado esperado em alguns casos.
- **Comentários ocultos do próprio dono da mídia continuam visíveis** no Instagram.
- **Ausência na API não é exclusão.** Comentários de usuários restringidos também desaparecem,
  então o sistema só marca `deleted_on_platform` após duas ausências consecutivas.
- **Não há como consultar histórico de webhooks.** É por isso que a ingestão aqui é varredura, e
  não webhook: o que o webhook não entregasse estaria perdido e a varredura seria necessária de
  qualquer forma. Um webhook, se entrar depois, só reduz a latência.
- **Alguns dark posts não retornam comentários.** O post é marcado `comments_available = false`
  e a origem do problema fica registrada.

## Arquitetura

Um processo Next.js. Sem fila, sem Redis, sem worker separado — a sincronização roda no próprio
processo, automaticamente em produção e também sob demanda pelo botão.

| Caminho | Conteúdo |
| --- | --- |
| [src/db/](src/db/) | Schema Drizzle (contas, posts, comentários, log de ações, execuções) |
| [src/app/login/](src/app/login/) | Login por código de uso único enviado pelo Resend |
| [src/lib/meta/](src/lib/meta/) | Graph API: transporte com backoff, OAuth, leitura e moderação |
| [src/lib/sync.ts](src/lib/sync.ts) | Varredura de publicações e comentários |
| [src/lib/ai.ts](src/lib/ai.ts) | OpenRouter: classificação em lote e resumo |
| [src/lib/taxonomy.ts](src/lib/taxonomy.ts) | **Os motivos. Edite aqui para adaptar ao seu negócio** |
| [src/lib/queries.ts](src/lib/queries.ts) | Leituras do inbox e do dashboard, com critérios compartilhados |
| [src/app/actions.ts](src/app/actions.ts) | Ações do operador |

Três decisões que valem saber:

**Comentários e respostas na mesma tabela.** Uma resposta é um comentário com
`parent_external_id`. É o que permite ver a thread sem uma segunda tabela e sem uma consulta por
comentário.

**Resultado da IA desnormalizado em `comments`.** Todo filtro do inbox e todo gráfico cruza
sentimento/motivo/urgência com `published_at`; em tabela separada isso exigiria join dentro da
query paginada.

**A API vem antes do banco.** Toda ação chama o Meta primeiro e só grava localmente se foi
aceita. O contrário produziria um inbox que discorda do que está publicado — a pessoa acredita
ter respondido e não respondeu.

**Reprocessamento preserva o que é seu.** Um re-sync atualiza texto, contadores e visibilidade,
mas nunca `status`, `liked_by_us` nem os campos de IA. Se o texto do comentário mudou,
`analyzed_at` é zerado para a IA reprocessar aquele comentário — só aquele.

## Cores dos gráficos

Sentimento usa par divergente **azul ↔ vermelho com cinza no meio**, e não verde ↔ vermelho.
Não é preferência: verde e vermelho ficam a ΔE 5.7 em deuteranopia (indistinguíveis), contra
ΔE 21.6 do par adotado. Os hex em [globals.css](src/app/globals.css) são literais de propósito —
foram validados contra as duas superfícies reais da interface, e reescrevê-los em OKLCH
"equivalente" invalidaria a medição.

## Manutenção

```bash
pnpm typecheck
pnpm build
pnpm db:studio      # inspecionar o banco
```

O banco é um arquivo em `data/comments.db` (fora do Git). Backup é `cp`.

### Sincronização automática

Em produção, a sincronização inicia 15 segundos depois do servidor e se repete a cada 5 minutos.
`AUTO_SYNC_INTERVAL_MINUTES=0` desativa o agendador. O botão continua disponível e compartilha a
mesma execução se for acionado enquanto o ciclo automático estiver rodando.

O sync descobre todas as publicações acessíveis, porque comentário novo pode aparecer em mídia
antiga. Ele só persiste comentários dentro de `BACKFILL_DAYS`, usa o contador do Meta para
reconsultar publicações alteradas, relê as recentes em todo ciclo e reconcilia as demais a cada
`SYNC_RECONCILE_HOURS`. Isso mantém a cobertura sem baixar anos de comentários a cada 5 minutos.
