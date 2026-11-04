API do cardápio de um foodtruck. Este guia é para quem vai construir o app da dona do foodtruck. O primeiro app roda num tablet Android e depois vem uma versão web. Leia o guia inteiro antes de desenhar as telas: as rotas dizem o que é possível, e o guia diz como isso vira uma experiência simples.

## Quem usa e para quê

A dona do foodtruck, em casa e sem pressa, cadastrando o cardápio pela primeira vez. Ela não é técnica. O app precisa ser simples, bonito, minimalista e óbvio de usar: poucas telas, um passo de cada vez, sem jargão (diga "arquivar", nunca "soft delete"; "preço", nunca "price_cents").

O app tem uma **tela de login** (e-mail e senha). Não existe cadastro de conta, "esqueci a senha" nem troca de senha no app: as contas são criadas pelo administrador. Existe **um único foodtruck**: não crie seletor de foodtruck.

## Modelo do cardápio

- **Categoria**: agrupa itens no cardápio ("Lanches", "Bebidas"). Tem `sort_order`, e as menores aparecem primeiro.
- **Item**: o que se vende ("X-Burguer"). Pertence a exatamente uma categoria e tem preço. Pode ter:
  - **ingredientes removíveis**: uma lista de textos em ordem ("alface", "tomate"), que o cliente pode pedir para tirar;
  - **adicionais aceitos**: os adicionais que podem ser somados a este item.
- **Adicional**: um extra com preço próprio ("Bacon", R$ 5,00). É cadastrado uma vez e ligado aos itens que o aceitam (`addon_ids` no item).
- **Combo**: um conjunto de itens com preço próprio. Cada componente tem `item_id`, `quantity` e, opcionalmente, `swap_category_id`: se estiver presente, o cliente pode trocar aquele item por outro da categoria (por exemplo, "qualquer bebida").

Nomes são únicos por tipo: não existem duas categorias, dois itens, dois adicionais ou dois combos ativos com o mesmo nome.

## Primeiro acesso

Com o cardápio vazio, conduza a dona nesta ordem, porque cada passo depende do anterior:

1. **Categorias**: todo item exige uma categoria.
2. **Itens**: com ingredientes removíveis.
3. **Adicionais**: depois, ligue cada um aos itens que o aceitam, editando o item.
4. **Combos**: exigem itens já cadastrados.

Cada estado vazio deve apontar o próximo passo ("Nenhuma categoria ainda. Crie a primeira, por exemplo Lanches."). Não ofereça "criar item" antes de existir uma categoria, nem "criar combo" antes de existirem itens.

## Lendo o cardápio

- `GET /api/v1/menu` devolve tudo o que está ativo num **único snapshot consistente**: categorias em ordem, cada uma com seus itens; todos os adicionais; todos os combos. É a chamada certa para a tela principal. Recarregue depois de cada alteração.
- Combos trazem **só ids** (`item_id`, `swap_category_id`). Resolva nomes e preços pelo `/menu`.
- As listagens por recurso (`GET /api/v1/items` etc.) servem para telas de gestão específicas.
- Um item lista **só os adicionais ativos**. Um adicional arquivado some dos itens e volta quando é restaurado.

## Regras

- **Dinheiro é sempre inteiro, em centavos** (`price_cents`, de 0 a 100.000.000). R$ 12,50 é `1250`. Formate em reais na tela e converta de volta ao salvar. Nunca use ponto flutuante.
- **`PATCH` é parcial**: campos omitidos ficam como estão. Mas `ingredients`, `addon_ids` e `components`, quando enviados, **substituem a lista inteira**. Para tirar um adicional, envie a lista sem ele.
- **Preço do combo**: se `price_cents` for omitido na criação, o preço vira a soma de quantidade × preço de cada componente. `suggested_price_cents` sempre traz essa soma com os preços **atuais**. Mostre os dois lado a lado para a dona perceber quando o preço do combo ficou defasado. Um `PATCH` não recalcula o preço.
- **Ids** são uuids gerados pela API.
- **As listagens aceitam só `?archived`.** Qualquer parâmetro de query desconhecido (por exemplo, um `?_=123` para furar cache) é recusado com `VALIDATION_FAILED`. As demais rotas ignoram a query.
- `DELETE` e `POST /:id/restore` não têm corpo: **não envie `Content-Type: application/json` neles**. Um corpo vazio com esse header é recusado com `MALFORMED_REQUEST`.

## Autenticação

Toda rota de `/api/v1` exige `Authorization: Bearer <access_token>`, inclusive `/menu`. Só `POST /api/v1/auth/login` e `POST /api/v1/auth/refresh` são abertas. Todas as respostas de `/api/v1/auth/*` vêm com `Cache-Control: no-store`.

O fluxo, na ordem:

1. **Login**: `POST /api/v1/auth/login` com `{ email, password }` devolve `{ access_token, token_type, expires_in, refresh_token, refresh_expires_at, user }`. O `access_token` vale 15 minutos (`expires_in: 900`).
2. **Guarde os tokens com cuidado**: o `refresh_token` fica em `expo-secure-store`, nunca em AsyncStorage nem localStorage. O `access_token` fica só em memória.
3. **Toda requisição** leva `Authorization: Bearer <access_token>`.
4. **Renovação**: quando uma requisição devolve 401 `UNAUTHENTICATED`, chame `POST /api/v1/auth/refresh` com `{ refresh_token }` **uma vez** e repita a requisição original com o novo `access_token`. Se várias requisições falharem ao mesmo tempo, todas esperam a mesma renovação: duas renovações em paralelo com o mesmo token encerram a sessão.
5. **O refresh token roda**: cada renovação devolve um novo `refresh_token` e invalida o anterior. Guarde sempre o novo. Reapresentar um token já usado encerra a sessão inteira.
6. **Fim da sessão**: se a renovação devolver 401 `INVALID_REFRESH_TOKEN`, limpe o armazenamento e vá para o login. A sessão termina 24 horas depois do login (`refresh_expires_at`), mesmo com o app em uso e com renovações; depois disso a dona entra de novo.
7. **Sair**: o botão "Sair" chama `POST /api/v1/auth/logout` (com o bearer; responde 204) e limpa o armazenamento.
8. **Ao abrir o app**: se houver `refresh_token` guardado, renove e chame `GET /api/v1/auth/me`, que devolve `{ id, name, email, role }`, para saber quem está logada. Sem token guardado, mostre o login.

Falhas de login em excesso bloqueiam por 15 minutos (5 falhas por e-mail ou 20 por IP). O 429 `TOO_MANY_ATTEMPTS` traz o `Retry-After` em segundos, também em `details.retry_after_seconds`. Um 403 `FORBIDDEN` existe para papéis futuros; a dona (`owner`) nunca o recebe hoje.

## Erros

Toda resposta de erro tem o formato `{ status_code, error, code, message, details? }`. **Traduza a partir de `code`, nunca de `message`**: `message` é em inglês e serve só para depuração. `details` aparece apenas nos códigos indicados abaixo.

| `code`                     | status | quando                                                                           | `details`                                    | o que a interface faz                                                                       |
| -------------------------- | ------ | -------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`        | 400    | o corpo, a query ou o id não passam no schema                                    | —                                            | valide antes de enviar; se acontecer, é bug do app                                          |
| `MALFORMED_REQUEST`        | 400    | JSON inválido, ou corpo vazio com `Content-Type` JSON                            | —                                            | bug do app                                                                                  |
| `UNSUPPORTED_MEDIA_TYPE`   | 415    | `Content-Type` diferente de `application/json` (inclusive `text/plain`)          | —                                            | bug do app                                                                                  |
| `PAYLOAD_TOO_LARGE`        | 413    | corpo grande demais                                                              | —                                            | bug do app                                                                                  |
| `NOT_FOUND`                | 404    | rota inexistente                                                                 | —                                            | bug do app                                                                                  |
| `CATEGORY_NOT_FOUND`       | 404    | a categoria não existe ou está arquivada                                         | —                                            | "Essa categoria não existe mais." e recarregue                                              |
| `ITEM_NOT_FOUND`           | 404    | o item não existe ou está arquivado                                              | —                                            | idem, para item                                                                             |
| `ADDON_NOT_FOUND`          | 404    | o adicional não existe ou está arquivado                                         | —                                            | idem, para adicional                                                                        |
| `COMBO_NOT_FOUND`          | 404    | o combo não existe ou está arquivado                                             | —                                            | idem, para combo                                                                            |
| `NAME_TAKEN`               | 409    | já existe um registro ativo com esse nome                                        | —                                            | "Já existe um item chamado X." no campo de nome                                             |
| `NAME_TAKEN_ARCHIVED`      | 409    | o nome pertence a um registro arquivado                                          | `archived_id`                                | "Já existe um X arquivado. Restaurar?" e, se ela aceitar, chame `restore` com `archived_id` |
| `IN_USE`                   | 409    | o arquivamento foi bloqueado porque outros registros ativos dependem deste       | `items`, `combos` (listas de `{ id, name }`) | "Não dá para arquivar: usado por Combo X, Item Y." com atalhos para eles                    |
| `NOT_ARCHIVED`             | 409    | restaurar algo que não está arquivado                                            | —                                            | recarregue a lista                                                                          |
| `RESTORE_BLOCKED`          | 409    | a restauração foi bloqueada porque algo de que o registro depende está arquivado | `items`, `categories`                        | "Restaure antes: Categoria X." com atalho                                                   |
| `INVALID_REFERENCE`        | 422    | aponta para categoria, item ou adicional inexistente ou arquivado                | `ids`                                        | recarregue as opções do formulário                                                          |
| `SUGGESTED_PRICE_TOO_HIGH` | 422    | combo sem preço cuja soma passa do teto                                          | `suggested_price_cents`                      | peça para a dona informar o preço do combo                                                  |
| `UNAUTHENTICATED`          | 401    | falta o token de acesso, ou ele é inválido ou expirou                            | —                                            | renove com o refresh token uma vez e repita a requisição (veja Autenticação)                |
| `FORBIDDEN`                | 403    | o usuário não tem permissão para a ação                                          | —                                            | "Você não tem permissão para isso."                                                         |
| `INVALID_CREDENTIALS`      | 401    | e-mail ou senha incorretos no login                                              | —                                            | "E-mail ou senha incorretos."                                                               |
| `INVALID_REFRESH_TOKEN`    | 401    | o refresh token é inválido, já foi usado ou a sessão terminou                    | —                                            | limpe o armazenamento e volte para o login                                                  |
| `TOO_MANY_ATTEMPTS`        | 429    | tentativas de login demais em pouco tempo                                        | `retry_after_seconds`                        | "Muitas tentativas. Tente de novo em N minutos." a partir de `Retry-After`                  |
| `INTERNAL_ERROR`           | 500    | erro inesperado                                                                  | —                                            | "Algo deu errado. Tente de novo."                                                           |

Para cada rota, a descrição de cada resposta de erro lista os códigos que ela pode devolver.

## Arquivar e restaurar

Nada é apagado. `DELETE` **arquiva**: o registro some das listagens e do `/menu`, mas continua existindo com o mesmo id, porque pedidos futuros vão referenciá-lo.

- Logo depois de arquivar, ofereça **"Desfazer"**, que chama `POST /api/v1/<recurso>/<id>/restore`.
- Uma tela de **arquivados** usa `GET /api/v1/<recurso>?archived=true`. Um combo ou item arquivado costuma apontar para itens ou categorias também arquivados, que não estão no `/menu`. Para mostrar os nomes, junte a listagem ativa com a `?archived=true` do recurso referenciado.
- O que bloqueia um arquivamento: uma categoria com itens ativos ou usada como troca num combo ativo; um adicional aceito por algum item ativo; um item que é componente de um combo ativo. Combos nunca bloqueiam.
- O que bloqueia uma restauração: um item cuja categoria está arquivada; um combo com algum item ou categoria de troca arquivados.

## O que ainda não existe

Pedidos, operações (eventos, noites de praça), caixa, relatórios e preços por evento ainda **não existem** nesta API. Não crie telas nem dados de exemplo para eles. Por enquanto, o app é o cadastro do cardápio.
