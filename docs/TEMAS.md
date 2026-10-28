# Como criar um tema do Cursoflix

Um tema é uma pasta com dois arquivos:

```
meu-tema/
├── theme.css    obrigatório — as cores e estilos
└── theme.json   opcional — nome, autor e cores da miniatura
```

Para usar: no app, abra o menu da conta (o quadrado com a sua inicial) → **Aparência** → **Importar tema** e escolha a pasta. O tema fica salvo no app e pode ser trocado a qualquer momento.

Temas mudam só a aparência. O app não executa JavaScript de temas e bloqueia `@import` e imagens externas, então um tema não consegue enviar dados para fora nem mexer na sua conta.

## Começando pelas variáveis

O jeito mais simples é trocar as variáveis de `:root`. Este é o tema Oceano inteiro:

```css
:root {
  --cf-bg: #0e1720;
  --cf-surface: #15222e;
  --cf-raised: #1d2f3e;
  --cf-line: #29404f;
  --cf-text: #eef6f8;
  --cf-muted: #93aab6;
  --cf-accent-a: #2dd4bf;
  --cf-accent-b: #3b82f6;
  --cf-accent: #22b8c9;
  --cf-on-accent: #04141c;
}
```

| Variável | Para que serve |
| --- | --- |
| `--cf-bg` | Fundo do app |
| `--cf-surface` | Cartões, painéis e modais |
| `--cf-raised` | Elementos em destaque e efeito ao passar o mouse |
| `--cf-line` | Bordas e divisórias |
| `--cf-overlay` | Fundo escurecido atrás dos modais |
| `--cf-text` | Texto principal |
| `--cf-muted` | Texto secundário |
| `--cf-faint` | Texto de apoio, dicas |
| `--cf-accent-a` / `--cf-accent-b` | As duas cores do gradiente de destaque (botões, barras de progresso) |
| `--cf-accent` | Cor sólida de destaque (bordas de foco, item ativo) |
| `--cf-on-accent` | Cor do texto em cima do destaque |
| `--cf-done` | Aulas concluídas |
| `--cf-danger` | Erros e ações de exclusão |
| `--cf-focus` | Contorno de foco do teclado |
| `--cf-folder-sat` / `--cf-folder-light` | Saturação e luminosidade das capas geradas para cursos sem imagem |
| `--cf-font-display` / `--cf-font-body` | Fontes de títulos e de texto (use fontes instaladas no computador) |
| `--cf-radius-s` / `-m` / `-l` | Arredondamento de botões, cartões e modais |

## Indo além das variáveis

Você pode escrever qualquer regra CSS. Veja `themes/claro/theme.css`, que ajusta o cabeçalho, o logo e mantém o player escuro. Para descobrir as classes, rode a pré-visualização e use o inspetor do navegador.

## theme.json

```json
{
  "name": "Meu tema",
  "author": "Seu nome",
  "description": "Uma frase sobre o tema.",
  "swatch": ["#0E1720", "#2DD4BF", "#3B82F6"]
}
```

`swatch` são as cores mostradas na miniatura em Aparência (até 4).

## Testando sem o app

```bash
npm run preview
```

Abre a interface em http://localhost:4317 com cursos de exemplo. Para testar seu tema ali, coloque a pasta dele dentro de `themes/` e acrescente-o à lista `themes` em `dev/mock-api.js`.

Estados úteis para conferir o tema:

- http://localhost:4317/?estado=login — tela de login (senha de teste: `demo`)
- http://localhost:4317/?estado=expirado — assinatura vencida
- http://localhost:4317/?estado=vazio — biblioteca vazia
- http://localhost:4317/?atualizacao — aviso de nova versão

## Limites

- `theme.css` pode ter até 512 KB.
- Imagens só funcionam embutidas como `data:` (por exemplo, um SVG pequeno).
- Temas só funcionam no app oficial com assinatura ativa. Veja o arquivo LICENSE.
