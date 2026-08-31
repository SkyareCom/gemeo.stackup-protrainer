# Como contribuir

## Fluxo recomendado

```bash
git switch -c tipo/descricao-curta
npm ci
node --test tests/*.test.mjs
npm run build
```

Tipos de branch sugeridos:

- `fix/`: correção de bug.
- `feat/`: nova funcionalidade.
- `test/`: cobertura de testes.
- `docs/`: documentação.
- `refactor/`: melhoria interna sem mudança de comportamento.

## Critérios de aceitação

- O problema está reproduzido ou descrito de forma verificável.
- A mudança é mínima e não altera regras não relacionadas.
- Há teste de regressão para bugs corrigidos.
- Todos os testes passam.
- O build de produção passa.
- Nenhum segredo ou artefato gerado foi adicionado.
- Novos spots, quando realmente necessários, usam assinatura canônica e integram o banco geral.

## Conteúdo de um pull request

- Resumo da mudança.
- Motivo.
- Arquivos afetados.
- Testes executados e resultados.
- Captura de tela para mudanças visuais.
- Riscos e pendências.

