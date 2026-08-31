# Instruções para agentes de IA

## Objetivo

Melhorar o STACKUP HOLD'EM sem criar duplicatas estratégicas, quebrar o fluxo aprovado ou transformar o banco de treinamento em fonte de verdade para decisões.

## Antes de editar

1. Leia `README.md` e os testes existentes.
2. Inspecione `app/Trainer.jsx` e `app/strategicExpansion.js` apenas na área necessária.
3. Execute `git status --short` e preserve mudanças do usuário.
4. Crie uma branch específica para a tarefa.

## Dados e spots

- Todos os spots pertencem ao banco geral.
- Botões de fase e treino específico são somente filtros.
- Não crie bancos paralelos.
- Antes de inserir um spot, compare a assinatura estratégica canônica.
- Não multiplique estados por ID, seed, variante, naipe irrelevante ou mudanças mínimas dentro do mesmo bucket.
- Preserve IDs existentes; produza relatório antes de qualquer deduplicação destrutiva.
- Separe contagens de registros físicos, estados estratégicos únicos, variações de cartas e filtros.

## Motor estratégico

- Nunca derive a ação correta da quantidade ou frequência dos spots armazenados.
- Não use ID, índice, seed, frequência de amostragem ou distribuição interna como variável decisória.
- Considere estado da mão, posição, stack efetivo, ranges, jogadores, sequência de ações, pot odds, SPR, ICM, bounty, textura e bloqueadores.
- Mudanças estratégicas precisam de teste determinístico e justificativa explícita.

## Interface e fluxo protegido

- Preserve a ordem real das ações.
- Pré-flop: todos os jogadores válidos começam abertos e ficam opacos ao foldar.
- Pós-flop: somente participantes ficam abertos; a ordem vai da pior para a melhor posição até o herói.
- Preserve sons, opacidade, destaques e valores sincronizados.
- Preserve INICIAR, TEMPO, SOM, PRÓXIMO, ANTERIOR e REVER MÃO.
- Uma nova mão só começa quando o fluxo aprovado determinar.
- Ao usar PRÓXIMO, mantenha o foco em BOARD, POT e JOGADORES.

## Validação obrigatória

```bash
node --test tests/*.test.mjs
npm run build
```

Não considere a tarefa concluída se algum teste falhar ou se o build terminar com erro.

## Pull requests

- Uma finalidade por branch e por PR.
- Descreva comportamento anterior, comportamento novo e testes executados.
- Não misture formatação geral com mudança funcional.
- Não inclua `node_modules`, builds, caches, `.env` ou credenciais.

## Achado pendente: densidade do banco cai muito ao combinar fase+street+posição

Medido com dados reais (`selectGeneralSpots` + `filterBankByHeroPosition`, 360 combinações de
9 fases × 4 streets × 10 posições): a combinação tripla de filtros ativos ao mesmo tempo reduz
o banco disponível bem abaixo do que `MIN_TRAINING_VARIATIONS = 5000` sugere estar garantido.

- Mínimo encontrado: 1.291 spots (EARLY GAME / PRÉ-FLOP / UTG)
- Máximo encontrado: 6.796 spots (EARLY GAME / PRÉ-FLOP / CO)
- Média: 2.789 spots
- 37,5% das 360 combinações ficam abaixo de 2.000 spots
- 92,5% ficam abaixo do piso teórico de 5.000

Mecanismo: `selectSessionVariation` estica o banco pequeno num "pool virtual" de pelo menos 5.000
posições via `virtualPoolLength = max(MIN_TRAINING_VARIATIONS, trainingTarget, bank.length)` e
um passo coprimo (`sessionIndex`), mas o retorno real é sempre `bank[virtualIndex % bank.length]`
— ou seja, quando `bank.length` real é pequeno (ex: 1.291), os spots DISTINTOS se esgotam e
começam a repetir bem antes de o usuário terminar uma sessão longa (500/1000/1500/2000 spots),
mesmo que o "pool virtual" continue reportando 5.000+.

Uma conversa anterior (fora deste sandbox) já havia discutido e aparentemente implementado uma
correção de raiz: trocar os bancos pré-construídos por geração matemática direta via índice
(`decodePreflopComboAt`, ~37.322 combinações de pré-flop garantidas por fórmula, com prova de
equivalência exaustiva, mais decodificadores pós-flop equivalentes). Essa correção NÃO chegou a
ser commitada — não existe em nenhum branch local ou remoto (`main`, `feat/simulador-torneio-motor`,
`feat/treino-por-posicao-modo-prova-automatico`, nem nos dois branches remotos de conteúdo/UI).
O trabalho ficou só no sandbox daquela sessão, que é isolado e temporário, e se perdeu quando a
conversa terminou sem um commit/push explícito.

**Corrigido** (reforço cirúrgico do banco, não a reescrita por fórmula que a outra conversa
havia planejado — ver commit "fix: aumenta densidade..."). Resultado medido: mínimo de 5.103
spots em todas as 360 combinações (era 1.291), 0% abaixo do piso de 5.000 (era 92,5%). Trade-off
aceito conscientemente: a primeira geração de uma combinação fase+street nova ficou mais lenta
(~500ms medido com clique real de navegador, cache depois disso) — não é ideal, mas foi reduzido
de um pior caso de 641ms/17,7s (todas as 36) pra 214-413ms/13,3s através de reforço cirúrgico
(só as posições realmente carentes, não um aumento uniforme). Se o usuário achar essa lentidão
inaceitável no futuro, a solução de raiz continua sendo a reescrita por fórmula
(`decodePreflopComboAt`) que a conversa anterior tinha começado — essa opção não foi descartada,
só adiada em favor de uma correção mais rápida de aplicar agora.

