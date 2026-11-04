import { readFileSync } from "node:fs";

export const GUIDE = readFileSync(
  new URL("./guide.md", import.meta.url),
  "utf8",
);

export const TAGS = [
  {
    name: "categorias",
    description:
      "Categorias agrupam os itens no cardápio e são o primeiro cadastro: todo item exige uma categoria ativa. A ordem no cardápio vem de `sort_order` (menor primeiro) e depois do nome. Uma categoria não pode ser arquivada enquanto tiver itens ativos ou for categoria de troca de um combo ativo; o 409 `IN_USE` lista quem a usa.",
  },
  {
    name: "itens",
    description:
      "Itens são o que se vende. Cada item tem categoria, preço em centavos, ingredientes removíveis (texto, em ordem) e os adicionais que aceita. No `PATCH`, `ingredients` e `addon_ids` substituem a lista inteira. Um item não pode ser arquivado enquanto for componente de um combo ativo, nem restaurado com a categoria arquivada.",
  },
  {
    name: "adicionais",
    description:
      "Adicionais são extras com preço próprio, cadastrados uma vez e ligados aos itens que os aceitam pelo `addon_ids` do item. Um adicional não pode ser arquivado enquanto algum item ativo o aceitar: tire-o desses itens primeiro. Itens listam só os adicionais ativos.",
  },
  {
    name: "combos",
    description:
      "Combos juntam itens com quantidade e preço próprio. Cada componente pode ter uma categoria de troca, que permite ao cliente trocar o item por outro dessa categoria. Sem `price_cents`, o preço é a soma dos componentes; `suggested_price_cents` sempre mostra a soma atual. Combos trazem só ids: resolva nomes pelo `/menu`.",
  },
  {
    name: "cardapio",
    description:
      "O cardápio completo num único snapshot consistente: categorias ativas em ordem, cada uma com seus itens, mais todos os adicionais e combos ativos. É a leitura da tela principal e a fonte para resolver os ids que os combos referenciam. Arquivados nunca aparecem aqui.",
  },
] as const;
