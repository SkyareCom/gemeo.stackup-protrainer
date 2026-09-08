# Referência de solver real (GRAU 2)

Este diretório documenta a base de calibração usada em `buildPolicyActionEVs` (`app/Trainer.jsx`)
pra aproximar o motor determinístico do app de um solver de verdade, sem nunca chamar um solver em
tempo real durante o treino (isso seria inviável — minutos por spot).

## O que foi feito

1. Compilado o [TexasSolver](https://github.com/bupticybee/TexasSolver) (branch `console`), um
   solver CFR de código aberto, licença AGPL v3, gratuito. Rodado 100% localmente/offline — nunca
   em produção, nunca por spot de treino.
2. Resolvidos **24 cenários representativos** de pós-flop, heads-up (limitação do próprio
   TexasSolver console — ele não resolve multiway nativamente): 4 texturas de board (seca,
   molhada, parelhada, monocromática) × 3 SPR (raso ~1.5, médio ~3, fundo ~5) × 2 tipos de pote
   (raise único, 3-bet pot). Board fixo por textura, ranges representativas de IP/OOP (não
   extraídas dinamicamente do motor do app — ver `extract.py` pros valores exatos usados).
3. Cada solve grava uma árvore de estratégia completa (10-24 MB de JSON por cenário — não versionada
   aqui, só o resumo). `extract.py` lê essas árvores e resume: a frequência REAL (ponderada pelo
   range) de FOLD/CALL/RAISE do lado que enfrenta cada aposta testada, comparada com a previsão da
   fórmula pura de MDF (`fold = aposta/(pote+aposta)`).
4. `extracted_summary.json` é esse resumo (20 KB, um por cenário) — as árvores brutas (238 MB no
   total) ficam só na máquina onde foram geradas, não faz sentido versionar.

## O achado principal

A fórmula pura de MDF **superestima sistematicamente** quanto o vilão desiste, e o desvio cresce
com o tamanho da aposta antes de estabilizar:

| aposta (% do pote) | MDF prevista | solver real (média, n conforme tabela) | razão |
| ------------------- | ------------: | --------------------------------------: | ----: |
| 50%  (β=0.5)         | 33,3%         | 28,0% (n=24)                             | 0,84  |
| 150% (β=1.5)         | 60,0%         | 40,5% (n=8)                              | 0,67  |
| 300% (β=3.0)         | 75,0%         | 53,8% (n=8)                              | 0,72  |
| 500% (β=5.0)         | 83,3%         | 59,6% (n=8)                              | 0,72  |

Interpretação: MDF pura é um modelo estático de uma street só. O vilão de verdade retém equidade
em mãos que "deveriam" foldar pela MDF (redraws, implied odds nas streets seguintes), e por isso
continua mais do que o piso teórico — mais ainda em apostas grandes.

`calibratedFoldFrequency` (em `app/Trainer.jsx`, logo antes de `buildPolicyActionEVs`) interpola
linearmente entre esses 4 pontos medidos e, fora do intervalo [0.5, 5.0], aplica a razão do ponto
mais próximo sobre a curva teórica.

## Limitações honestas (não escondidas)

- **Só heads-up.** O TexasSolver console não resolve multiway. Spots com 3-4 participantes ativos
  continuam sem uma calibração de solver por trás — só a análise Monte Carlo/heurística de sempre.
- **Ranges representativas, não extraídas do motor.** As ranges de IP/OOP usadas nos 24 solves são
  estimativas razoáveis de raise único / 3-bet pot (ver `extract.py`), não as ranges dinâmicas que
  `preflopRangeDecision` calcula pro spot exato do herói.
- **24 pontos, não um lookup table por spot.** Isso calibra os PARÂMETROS de uma fórmula que roda
  em todo spot — não é (e não deveria ser) uma tabela de consulta 1-pra-1 por spot de treino. Ver
  discussão no histórico de commits sobre por que um número muito maior (ex. 100 mil) nem seria
  viável (dias de compute) nem seria a alavanca certa (o modelo tem poucos graus de liberdade reais
  pra calibrar).
- **Variação por textura existe mas é secundária.** A média por textura em cada β fica dentro de
  uma faixa de ~±0,05 — o desvio sistemático da MDF pura é a correção dominante; textura seria um
  refinamento de segunda ordem, não implementado nesta rodada.

## Reproduzir

```bash
# 1. compilar (branch console, sem GUI/Qt)
git clone --branch console https://github.com/bupticybee/TexasSolver.git
cd TexasSolver && mkdir build && cd build && cmake -DCMAKE_BUILD_TYPE=Release .. && make console_solver

# 2. gerar os 24 arquivos de entrada (ranges/boards/SPR documentados em extract.py)
#    e rodar cada um: ./console_solver -i <input>.txt -r ./resources
#    (roda a partir da raiz do TexasSolver — o dicionário de avaliação de mãos é resolvido
#    relativo ao cwd via -r)

# 3. resumir as árvores resultantes
python3 solver-reference/extract.py   # espera os .json brutos em /tmp/texassolver-batch/outputs
```
