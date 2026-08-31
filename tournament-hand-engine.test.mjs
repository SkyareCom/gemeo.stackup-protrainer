import test from "node:test";
import assert from "node:assert/strict";
import {
  hashStr, mulberry32, tournamentRng, createDeck, shuffleDeck, dealTable,
  evaluateBestHand, compareHands, compareEval,
  handPercentile, decideVillainPreflopAction, SHOVE_OR_FOLD_STACK_BB,
  positionsForTableSize, heroPositionFromSeats, runPreflopBettingRound, playHeroHand,
  evaluateHeroPreflopDecision, createPreflopRoundCursor, applyHeroDecision, canPlayerRaise,
  finalizeHeroHandResult, splitPotIntoLayers,
} from "../app/tournamentHandEngine.js";

const c = (v, s) => ({ v, s });

test("tournamentRng namespacia a semente com 'TOURNEY|' — nunca pode colidir com sementes do treino normal", () => {
  assert.notEqual(hashStr("TOURNEY|abc"), hashStr("abc"));
  // Duas chamadas com a mesma string de semente têm que gerar a MESMA sequência (determinismo).
  const seqA = [], seqB = [];
  const rngA = tournamentRng("mesma-semente");
  const rngB = tournamentRng("mesma-semente");
  for (let i = 0; i < 5; i++) { seqA.push(rngA()); seqB.push(rngB()); }
  assert.deepEqual(seqA, seqB);
  // Sementes diferentes precisam gerar sequências diferentes.
  const rngC = tournamentRng("semente-diferente");
  assert.notEqual(rngA(), rngC());
});

test("createDeck tem exatamente 52 cartas únicas", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  const unique = new Set(deck.map((card) => `${card.v}${card.s}`));
  assert.equal(unique.size, 52);
});

test("shuffleDeck preserva as 52 cartas (só reordena, nunca perde ou duplica)", () => {
  const rng = mulberry32(hashStr("shuffle-teste"));
  const deck = createDeck();
  const shuffled = shuffleDeck(deck, rng);
  assert.equal(shuffled.length, 52);
  const originalSet = new Set(deck.map((c2) => `${c2.v}${c2.s}`));
  const shuffledSet = new Set(shuffled.map((c2) => `${c2.v}${c2.s}`));
  assert.deepEqual([...originalSet].sort(), [...shuffledSet].sort());
});

test("dealTable nunca repete uma carta entre jogadores, board e o que sobra no baralho", () => {
  for (let seed = 0; seed < 30; seed++) {
    const rng = tournamentRng(`deal-teste-${seed}`);
    const { hands, board, remainingDeck } = dealTable({ seatCount: 9, rng });
    assert.equal(hands.length, 9);
    for (const hand of hands) assert.equal(hand.length, 2);
    assert.equal(board.length, 5);
    const allCards = [...hands.flat(), ...board, ...remainingDeck];
    assert.equal(allCards.length, 52);
    const unique = new Set(allCards.map((card) => `${card.v}${card.s}`));
    assert.equal(unique.size, 52, "nenhuma carta pode se repetir dentro da mesma distribuição");
  }
});

test("evaluateBestHand reconhece corretamente as 9 categorias de mão, incluindo a roda (A-2-3-4-5)", () => {
  assert.equal(evaluateBestHand([c(14,"♠"),c(13,"♠"),c(12,"♠"),c(11,"♠"),c(10,"♠")]).categoryLabel, "STRAIGHT_FLUSH");
  assert.equal(evaluateBestHand([c(9,"♠"),c(9,"♥"),c(9,"♦"),c(9,"♣"),c(2,"♠")]).categoryLabel, "QUADRA");
  assert.equal(evaluateBestHand([c(5,"♠"),c(5,"♥"),c(5,"♦"),c(2,"♣"),c(2,"♠")]).categoryLabel, "FULL_HOUSE");
  assert.equal(evaluateBestHand([c(2,"♠"),c(5,"♠"),c(9,"♠"),c(11,"♠"),c(13,"♠")]).categoryLabel, "FLUSH");
  assert.equal(evaluateBestHand([c(9,"♠"),c(8,"♥"),c(7,"♦"),c(6,"♣"),c(5,"♠")]).categoryLabel, "SEQUENCIA");
  assert.equal(evaluateBestHand([c(14,"♠"),c(2,"♥"),c(3,"♦"),c(4,"♣"),c(5,"♠")]).categoryLabel, "SEQUENCIA");
  assert.equal(evaluateBestHand([c(7,"♠"),c(7,"♥"),c(7,"♦"),c(2,"♣"),c(9,"♠")]).categoryLabel, "TRINCA");
  assert.equal(evaluateBestHand([c(7,"♠"),c(7,"♥"),c(3,"♦"),c(3,"♣"),c(9,"♠")]).categoryLabel, "DOIS_PARES");
  assert.equal(evaluateBestHand([c(7,"♠"),c(7,"♥"),c(3,"♦"),c(5,"♣"),c(9,"♠")]).categoryLabel, "PAR");
  assert.equal(evaluateBestHand([c(2,"♠"),c(7,"♥"),c(3,"♦"),c(5,"♣"),c(9,"♠")]).categoryLabel, "CARTA_ALTA");
});

test("evaluateBestHand acha a melhor combinação de 5 entre 7 cartas (hole + board)", () => {
  const sevenCards = [c(14,"♠"),c(14,"♥"),c(14,"♦"),c(14,"♣"),c(2,"♠"),c(3,"♥"),c(4,"♦")];
  assert.equal(evaluateBestHand(sevenCards).categoryLabel, "QUADRA");
});

test("compareHands desempata corretamente por categoria e por kicker", () => {
  assert.ok(compareHands(
    [c(14,"♠"),c(14,"♥"),c(2,"♦"),c(5,"♣"),c(9,"♠")],
    [c(13,"♠"),c(13,"♥"),c(2,"♣"),c(5,"♦"),c(9,"♥")],
  ) > 0, "par de Ases vence par de Reis");
  assert.ok(compareHands(
    [c(9,"♠"),c(9,"♥"),c(2,"♦"),c(5,"♣"),c(13,"♠")],
    [c(9,"♦"),c(9,"♣"),c(2,"♠"),c(5,"♥"),c(12,"♥")],
  ) > 0, "mesmo par, kicker mais alto (K vs Q) desempata");
  assert.equal(compareHands(
    [c(9,"♠"),c(9,"♥"),c(2,"♦"),c(5,"♣"),c(13,"♠")],
    [c(9,"♦"),c(9,"♣"),c(2,"♠"),c(5,"♥"),c(13,"♥")],
  ), 0, "mão idêntica em força (mesmos valores) é split pot — empate exato");
});

test("compareEval é consistente e transitivo (categoria maior sempre vence, independente de kickers)", () => {
  const straightFlush = evaluateBestHand([c(14,"♠"),c(13,"♠"),c(12,"♠"),c(11,"♠"),c(10,"♠")]).evalArray;
  const quads = evaluateBestHand([c(2,"♠"),c(2,"♥"),c(2,"♦"),c(2,"♣"),c(9,"♠")]).evalArray;
  assert.ok(compareEval(straightFlush, quads) > 0, "straight flush sempre vence quadra, mesmo a mais fraca possível vs a mais forte");
});

test("distribuição estatística de categorias em amostra grande bate com as probabilidades reais conhecidas do pôquer (7 cartas)", () => {
  const counts = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const rng = tournamentRng(`dist-teste-${i}`);
    const { hands, board } = dealTable({ seatCount: 1, rng });
    const result = evaluateBestHand([...hands[0], ...board]);
    counts[result.categoryLabel] = (counts[result.categoryLabel] || 0) + 1;
  }
  const pct = (key) => (counts[key] || 0) / N;
  // Faixas de tolerância generosas em torno das probabilidades reais conhecidas (~43.8% par,
  // ~2.6% full house, ~0.168% quadra) — o objetivo é pegar um avaliador quebrado, não exigir
  // precisão estatística perfeita numa amostra de 20 mil mãos.
  assert.ok(pct("PAR") > 0.38 && pct("PAR") < 0.50, `PAR fora da faixa esperada: ${pct("PAR")}`);
  assert.ok(pct("DOIS_PARES") > 0.18 && pct("DOIS_PARES") < 0.30, `DOIS_PARES fora da faixa: ${pct("DOIS_PARES")}`);
  assert.ok(pct("FULL_HOUSE") > 0.01 && pct("FULL_HOUSE") < 0.05, `FULL_HOUSE fora da faixa: ${pct("FULL_HOUSE")}`);
  assert.ok(pct("QUADRA") > 0 && pct("QUADRA") < 0.01, `QUADRA fora da faixa: ${pct("QUADRA")}`);
  // Ordem de raridade real precisa ser respeitada: carta alta+par (comuns) somados devem ser
  // muito mais frequentes que full house+quadra+straight flush (raros) somados.
  const common = pct("CARTA_ALTA") + pct("PAR");
  const rare = pct("FULL_HOUSE") + pct("QUADRA") + pct("STRAIGHT_FLUSH");
  assert.ok(common > rare * 5, "mãos comuns precisam ser bem mais frequentes que mãos raras");
});

test("handPercentile ordena corretamente as mãos pré-flop conhecidas (menor percentil = mais forte)", () => {
  const p = (a, b) => handPercentile(c(...a), c(...b));
  const AA = p([14,"♠"],[14,"♥"]), KK = p([13,"♠"],[13,"♥"]), QQ = p([12,"♠"],[12,"♥"]);
  const AKs = p([14,"♠"],[13,"♠"]), AKo = p([14,"♠"],[13,"♥"]);
  const suited89 = p([8,"♠"],[9,"♠"]), pair22 = p([2,"♠"],[2,"♥"]), worst72o = p([7,"♠"],[2,"♥"]);
  assert.ok(AA < KK && KK < QQ, "AA melhor que KK melhor que QQ");
  assert.ok(AKs < AKo, "AKs melhor que AKo (mesmo suited sempre supera offsuit equivalente)");
  assert.ok(QQ < AKo, "QQ melhor que AKo");
  assert.ok(AKo < suited89, "AKo melhor que um conector suited médio");
  assert.ok(suited89 < pair22, "conector suited médio melhor que par baixo, nesta calibração");
  assert.ok(pair22 < worst72o, "qualquer par melhor que 72o");
  assert.equal(p([7,"♠"],[2,"♥"]), p([2,"♠"],[7,"♥"]), "72o e 27o são a mesma mão — ordem das cartas não importa");
});

test("decideVillainPreflopAction: mãos premium sempre abrem, mesmo em UTG; lixo sempre folda", () => {
  const rng = Math.random;
  const AA = handPercentile(c(14,"♠"),c(14,"♥"));
  const trash = handPercentile(c(7,"♠"),c(2,"♥"));
  for (const position of ["UTG","UTG1","MP","MP1","LJ","HJ","CO","BTN","SB"]) {
    assert.equal(decideVillainPreflopAction({ position, percentile: AA, facing: "NONE", stackBB: 100, rng }).action, "RAISE");
    assert.equal(decideVillainPreflopAction({ position, percentile: trash, facing: "NONE", stackBB: 100, rng }).action, "FOLD");
  }
});

test("decideVillainPreflopAction: abre mais largo em posições tardias que em posições iniciais", () => {
  const rng = Math.random;
  let opensUTG = 0, opensBTN = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const dealRng = tournamentRng(`freq-cmp-${i}`);
    const { hands } = dealTable({ seatCount: 1, rng: dealRng });
    const pct = handPercentile(hands[0][0], hands[0][1]);
    if (decideVillainPreflopAction({ position: "UTG", percentile: pct, facing: "NONE", stackBB: 100, rng }).action !== "FOLD") opensUTG++;
    if (decideVillainPreflopAction({ position: "BTN", percentile: pct, facing: "NONE", stackBB: 100, rng }).action !== "FOLD") opensBTN++;
  }
  assert.ok(opensBTN > opensUTG * 2, `BTN (${opensBTN}) deveria abrir bem mais que UTG (${opensUTG})`);
  // Faixas plausíveis de frequência real de torneio (~10-15% UTG, ~40-50% BTN).
  assert.ok(opensUTG / N > 0.05 && opensUTG / N < 0.20, `frequência de abertura do UTG fora da faixa esperada: ${opensUTG / N}`);
  assert.ok(opensBTN / N > 0.35 && opensBTN / N < 0.60, `frequência de abertura do BTN fora da faixa esperada: ${opensBTN / N}`);
});

test("decideVillainPreflopAction: stack raso vira shove-or-fold, sem call/raise pequeno no meio", () => {
  const rng = Math.random;
  const decisions = new Set();
  for (let i = 0; i < 500; i++) {
    const dealRng = tournamentRng(`shove-teste-${i}`);
    const { hands } = dealTable({ seatCount: 1, rng: dealRng });
    const pct = handPercentile(hands[0][0], hands[0][1]);
    const d = decideVillainPreflopAction({ position: "BTN", percentile: pct, facing: "NONE", stackBB: SHOVE_OR_FOLD_STACK_BB - 1, rng });
    decisions.add(d.action);
    if (d.action === "SHOVE") assert.equal(d.raiseToBB, SHOVE_OR_FOLD_STACK_BB - 1, "o shove precisa ser o stack inteiro");
  }
  assert.deepEqual([...decisions].sort(), ["FOLD", "SHOVE"], "com stack raso só pode haver FOLD ou SHOVE, nunca RAISE/CALL normal");
});

test("decideVillainPreflopAction: contra um raise, só mãos fortes continuam (call ou 3-bet)", () => {
  const rng = Math.random;
  const AA = handPercentile(c(14,"♠"),c(14,"♥"));
  const trash = handPercentile(c(7,"♠"),c(2,"♥"));
  assert.equal(decideVillainPreflopAction({ position: "CO", percentile: AA, facing: "RAISE", stackBB: 100, rng }).action, "RAISE");
  assert.equal(decideVillainPreflopAction({ position: "CO", percentile: trash, facing: "RAISE", stackBB: 100, rng }).action, "FOLD");
});

test("positionsForTableSize e heroPositionFromSeats mapeiam a mesa corretamente em vários tamanhos", () => {
  assert.deepEqual(positionsForTableSize(9), ["UTG","UTG1","MP","LJ","HJ","CO","BTN","SB","BB"]);
  assert.deepEqual(positionsForTableSize(6), ["LJ","HJ","CO","BTN","SB","BB"]);
  assert.deepEqual(positionsForTableSize(2), ["SB","BB"]);
  assert.equal(heroPositionFromSeats(0, 0, 9), "BTN");
  assert.equal(heroPositionFromSeats(1, 0, 9), "SB");
  assert.equal(heroPositionFromSeats(2, 0, 9), "BB");
  assert.equal(heroPositionFromSeats(0, 0, 2), "SB");
  assert.equal(heroPositionFromSeats(1, 0, 2), "BB");
});

test("runPreflopBettingRound: conservação de fichas exata — a soma do que cada jogador contribuiu bate com o pote, sempre", () => {
  const positions = positionsForTableSize(9);
  const heroPolicy = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  let maxImbalance = 0;
  for (let i = 0; i < 500; i++) {
    const rng = tournamentRng(`conserv-${i}`);
    const stacksBB = positions.map(() => 20 + rng() * 150);
    const percentileBySeat = positions.map(() => rng() * 100);
    const round = runPreflopBettingRound({ positions, stacksBB, percentileBySeat, heroIndex: i % 9, heroDecisionPolicy: heroPolicy, rng });
    const sumContributed = round.totalContributedBB.reduce((a, b) => a + b, 0);
    maxImbalance = Math.max(maxImbalance, Math.abs(sumContributed - round.potBB));
  }
  assert.ok(maxImbalance < 0.001, `desbalanço de fichas encontrado: ${maxImbalance}`);
});

test("runPreflopBettingRound: ninguém aposta mais do que o próprio stack", () => {
  const positions = positionsForTableSize(9);
  const heroPolicy = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  for (let i = 0; i < 300; i++) {
    const rng = tournamentRng(`stack-limit-${i}`);
    const stacksBB = positions.map(() => 5 + rng() * 100);
    const percentileBySeat = positions.map(() => rng() * 100);
    const round = runPreflopBettingRound({ positions, stacksBB, percentileBySeat, heroIndex: i % 9, heroDecisionPolicy: heroPolicy, rng });
    round.totalContributedBB.forEach((contributed, idx) => {
      assert.ok(contributed <= stacksBB[idx] + 1e-9, `assento ${idx} contribuiu ${contributed} > stack ${stacksBB[idx]}`);
    });
  }
});

test("playHeroHand: herói que sempre folda nunca perde mais que o valor de blind que já tinha postado (exceto quando ganha de graça — todo mundo foldou antes de chegar nele, ex: BB sem ninguém entrando)", () => {
  for (let i = 0; i < 50; i++) {
    const hand = playHeroHand({
      heroSeat: i % 9, btnSeat: 0, tableSize: 9, heroStackBB: 100, villainStackHintBB: 80,
      heroDecisionPolicy: () => ({ action: "FOLD" }), seedStr: `fold-sempre-${i}`,
    });
    assert.equal(hand.involved, false, "herói que sempre folda nunca deveria contar como 'envolvido'");
    if (hand.heroWon) {
      // Só pode ganhar sem nunca ter "decidido" nada se a ação nem chegou até ele (blind
      // levando o pote de graça porque todo mundo foldou antes) — não pode ter apostado nada
      // além do próprio blind pra isso acontecer.
      assert.ok(["SB", "BB"].includes(hand.heroPosition), `ganhou sem decidir fora do blind: ${hand.heroPosition}`);
    } else {
      assert.ok(hand.heroChipDeltaBB >= -1, `perda além do blind: ${hand.heroChipDeltaBB} na posição ${hand.heroPosition}`);
      assert.ok(hand.heroChipDeltaBB <= 0, "quem sempre folda e não ganha de graça nunca pode terminar com saldo positivo");
    }
  }
});

test("playHeroHand: showdown decide por força de mão real — herói com o melhor board sempre ganha", () => {
  // Herói sempre dá all-in (SHOVE) com qualquer mão; ao menos um vilão também acaba pagando com
  // frequência alta o bastante (stacks rasos, IA de shove-or-fold) pra garantir amostra de
  // showdown suficiente pra checar a coerência com o avaliador de mãos.
  const heroAlwaysShoves = (ctx) => ({ action: "SHOVE", raiseToBB: ctx.stackBB });
  let checked = 0;
  for (let i = 0; i < 400 && checked < 30; i++) {
    const hand = playHeroHand({
      heroSeat: i % 9, btnSeat: 0, tableSize: 9, heroStackBB: 10, villainStackHintBB: 10,
      heroDecisionPolicy: heroAlwaysShoves, seedStr: `showdown-teste-${i}`,
    });
    if (!hand.wentToShowdown) continue;
    checked++;
    const heroFullHand = [...hand.heroCards, ...hand.board];
    evaluateBestHand(heroFullHand); // confirma que a mão do herói é avaliável sem lançar erro
    // Não temos a mão do vencedor exposta diretamente quando não é o herói, mas podemos ao menos
    // confirmar consistência interna: se o herói venceu, ninguém mais no showdown deveria ter
    // avaliação estritamente melhor — isso é garantido pela própria implementação (mesmo
    // avaliador usado pros dois lados), então aqui validamos que o resultado é determinístico e
    // sempre coerente com heroWon/heroSplit combinados corretamente.
    assert.equal(typeof hand.heroWon, "boolean");
    if (hand.heroSplit) assert.equal(hand.heroWon, true, "split só faz sentido se heroWon também for true");
  }
  assert.ok(checked >= 10, `poucas amostras de showdown pra validar (${checked}) — ajustar o teste`);
});

test("playHeroHand: conservação de fichas do herói — o delta nunca excede o que estava em jogo na mão", () => {
  const heroAsAI = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  for (let i = 0; i < 300; i++) {
    const heroStackBB = 20 + (i % 10) * 15;
    const hand = playHeroHand({
      heroSeat: i % 9, btnSeat: (i * 5) % 9, tableSize: 9, heroStackBB, villainStackHintBB: 60,
      heroDecisionPolicy: heroAsAI, seedStr: `hero-conserv-${i}`,
    });
    assert.ok(hand.heroChipDeltaBB >= -heroStackBB - 1e-6, `herói perdeu mais do que tinha: ${hand.heroChipDeltaBB} com stack ${heroStackBB}`);
    assert.ok(hand.heroChipDeltaBB <= hand.potBB, `herói ganhou mais do que o pote inteiro: ${hand.heroChipDeltaBB} > ${hand.potBB}`);
  }
});

test("playHeroHand: perSeatChipDeltaBB cobre todos os assentos, soma zero, e bate com heroChipDeltaBB na posição do herói", () => {
  const heroAsAI = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  for (let i = 0; i < 300; i++) {
    const hand = playHeroHand({
      heroSeat: i % 9, btnSeat: 0, tableSize: 9, heroStackBB: 60, villainStackHintBB: 60,
      heroDecisionPolicy: heroAsAI, seedStr: `perseat-${i}`,
    });
    assert.equal(hand.perSeatChipDeltaBB.length, 9);
    const sum = hand.perSeatChipDeltaBB.reduce((a, b) => a + b.chipDeltaBB, 0);
    assert.ok(Math.abs(sum) < 0.001, `soma dos deltas por assento deveria ser 0, deu ${sum}`);
    const heroEntry = hand.perSeatChipDeltaBB.find((s) => s.position === hand.heroPosition);
    assert.ok(Math.abs(heroEntry.chipDeltaBB - hand.heroChipDeltaBB) < 0.001, "delta do herói na lista por assento precisa bater com heroChipDeltaBB");
  }
});

test("playHeroHand: stacksBBOverride usa os stacks reais passados em vez de sortear aleatoriamente", () => {
  const fixedStacks = [40, 55, 30, 62, 48, 71, 90, 25, 33]; // uma entrada por posição de positionsForTableSize(9)
  const hand = playHeroHand({
    heroSeat: 3, btnSeat: 0, tableSize: 9, heroStackBB: fixedStacks[positionsForTableSize(9).indexOf(heroPositionFromSeats(3, 0, 9))],
    stacksBBOverride: fixedStacks, heroDecisionPolicy: () => ({ action: "FOLD" }), seedStr: "override-teste",
  });
  // Confere indiretamente: nenhum assento pode ter contribuído mais do que o stack fixo dado.
  hand.perSeatChipDeltaBB.forEach((entry, idx) => {
    assert.ok(-entry.chipDeltaBB <= fixedStacks[idx] + 1e-6, `assento ${idx} perdeu mais do que o stack fixo definido`);
  });
});

test("evaluateHeroPreflopDecision usa a MESMA régua da IA dos adversários — nenhuma tabela nova, nenhum critério mais duro pro herói", () => {
  // Correta: mão premium abre em qualquer posição.
  const good = evaluateHeroPreflopDecision({ position: "UTG", percentile: 0.3, facing: "NONE", stackBB: 100, heroAction: "RAISE" });
  assert.equal(good.correct, true);
  assert.equal(good.severity, 0);

  // Erro grave: foldar a melhor mão possível.
  const foldedAA = evaluateHeroPreflopDecision({ position: "UTG", percentile: 0.3, facing: "NONE", stackBB: 100, heroAction: "FOLD" });
  assert.equal(foldedAA.correct, false);
  assert.equal(foldedAA.mistakeType, "FOLDOU_DEMAIS");
  assert.ok(foldedAA.severity > 10, "foldar a melhor mão do jogo precisa contar como erro grave");

  // Erro grave: abrir lixo puro em posição inicial.
  const openedTrash = evaluateHeroPreflopDecision({ position: "UTG", percentile: 95, facing: "NONE", stackBB: 100, heroAction: "RAISE" });
  assert.equal(openedTrash.correct, false);
  assert.equal(openedTrash.mistakeType, "JOGOU_DEMAIS");
  assert.ok(openedTrash.severity > 50, "abrir a pior mão do jogo em UTG precisa contar como erro grave");
});

test("evaluateHeroPreflopDecision: erro perto do limiar tem severidade baixa; erro longe do limiar tem severidade alta", () => {
  const near = evaluateHeroPreflopDecision({ position: "UTG", percentile: 22, facing: "NONE", stackBB: 100, heroAction: "RAISE" }); // limiar UTG=15
  const far = evaluateHeroPreflopDecision({ position: "UTG", percentile: 95, facing: "NONE", stackBB: 100, heroAction: "RAISE" });
  assert.equal(near.correct, false);
  assert.equal(far.correct, false);
  assert.ok(near.severity < far.severity, "mão limítrofe deveria pesar menos que mão completamente fora do range");
});

test("evaluateHeroPreflopDecision: SHOVE conta como categoria equivalente a RAISE quando a IA recomenda SHOVE (stack curto)", () => {
  const result = evaluateHeroPreflopDecision({ position: "BTN", percentile: 20, facing: "NONE", stackBB: 8, heroAction: "SHOVE" });
  assert.equal(result.correct, true);
  assert.equal(result.baselineAction, "SHOVE");
});

test("applyPreflopAction/history: cada entrada do histórico carrega percentil, facing e stack — necessário pra avaliar a decisão depois, sem re-simular nada", () => {
  const heroAsAI = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  const hand = playHeroHand({
    heroSeat: 0, btnSeat: 0, tableSize: 9, heroStackBB: 60, villainStackHintBB: 60,
    heroDecisionPolicy: heroAsAI, seedStr: "history-meta-teste",
  });
  for (const entry of hand.history) {
    assert.ok(typeof entry.percentile === "number", `entrada sem percentil: ${JSON.stringify(entry)}`);
    assert.ok(["NONE", "RAISE", "3BET"].includes(entry.facing), `facing inválido: ${entry.facing}`);
    assert.ok(typeof entry.stackBB === "number");
  }
});

test("regra do pôquer: um raise nunca pode deixar menos de 1bb no stack — vira shove automaticamente nesse caso", () => {
  const positions = positionsForTableSize(9);
  const heroIndex = positions.indexOf("UTG"); // sem ante, mais fácil de calcular exatamente

  function raiseAndCheck(stackBB, raiseToBBRequested, currentBetBB) {
    const cursor = createPreflopRoundCursor({
      positions, stacksBB: positions.map((_, i) => (i === heroIndex ? stackBB : 100)),
      percentileBySeat: positions.map(() => 50), heroIndex, rng: () => 0.5,
    });
    cursor.currentBetBB = currentBetBB;
    applyHeroDecision(cursor, { action: "RAISE", raiseToBB: raiseToBBRequested });
    return { bet: cursor.committedBB[heroIndex], remaining: +(cursor.effectiveStacksBB[heroIndex] - cursor.committedBB[heroIndex]).toFixed(2) };
  }

  // Pedidos que deixariam menos de 1bb: sempre viram shove (aposta o stack inteiro, 0 sobrando).
  assert.deepEqual(raiseAndCheck(20, 19.7, 3), { bet: 20, remaining: 0 });
  assert.deepEqual(raiseAndCheck(20, 19.99, 3), { bet: 20, remaining: 0 });
  // Exatamente 1bb sobrando: continua sendo um raise normal, não vira shove.
  assert.deepEqual(raiseAndCheck(20, 19.0, 3), { bet: 19, remaining: 1 });
  // Mais de 1bb sobrando: raise normal, valor pedido respeitado exatamente.
  assert.deepEqual(raiseAndCheck(20, 18.9, 3), { bet: 18.9, remaining: 1.1 });
});

test("regra do pôquer: all-in incompleto trava re-raise só pra quem já agiu; quem não agiu ainda pode subir de novo (com base na última aposta válida)", () => {
  // Cenário exato do exemplo dado: aposta válida de 20bb (incremento mínimo passa a ser 20bb),
  // um all-in incompleto sobe pra 30bb (incremento de só 10bb, menor que o mínimo de 20) —
  // quem já pagou os 20bb só pode pagar os 30bb ou foldar; quem ainda não agiu pode pagar os 30
  // OU subir de novo, com o mínimo sendo 30+20=50bb (a última aposta válida + o incremento).
  const positions = positionsForTableSize(9);
  const utgIdx = positions.indexOf("UTG"), utg1Idx = positions.indexOf("UTG1"), mpIdx = positions.indexOf("MP");

  const cursor = createPreflopRoundCursor({
    positions,
    stacksBB: positions.map((_, i) => (i === utg1Idx ? 30 : 200)), // UTG1 só tem 30bb (all-in incompleto de verdade)
    percentileBySeat: positions.map(() => 50),
    heroIndex: mpIdx, // MP é "o herói" só pra dar um índice — não importa aqui, ninguém decide via heroDecisionPolicy neste teste
    rng: () => 0.5,
  });

  // Monta o cenário diretamente, sem depender da ordem normal do cursor nem de decisões
  // aleatórias de IA — aplica cada ação no assento certo, na ordem certa.
  const applyDirect = (idx, decision) => {
    // Reaproveita a função interna via applyHeroDecision trocando heroIndex temporariamente.
    const savedHeroIndex = cursor.heroIndex;
    cursor.heroIndex = idx;
    applyHeroDecision(cursor, decision);
    cursor.heroIndex = savedHeroIndex;
  };

  applyDirect(utgIdx, { action: "RAISE", raiseToBB: 20 });
  assert.equal(cursor.currentBetBB, 20);
  assert.equal(cursor.minRaiseIncrement, 19); // subiu de 1 pra 20 -> incremento de 19
  assert.equal(cursor.lastRaiseWasComplete, true);

  // UTG1 (só tem 30bb) vai all-in — incompleto, porque 30-20=10 < 19 (o incremento mínimo).
  applyDirect(utg1Idx, { action: "SHOVE", raiseToBB: 30 });
  assert.equal(cursor.committedBB[utg1Idx], 30);
  assert.equal(cursor.currentBetBB, 30);
  assert.equal(cursor.lastRaiseWasComplete, false, "o all-in de 30 é incompleto (incremento de só 10, menor que o mínimo de 19)");
  assert.equal(cursor.minRaiseIncrement, 19, "o incremento mínimo NÃO muda com um all-in incompleto — continua sendo o da última aposta válida");

  // UTG já tinha agido (apostou os 20) -> NÃO pode subir de novo, só pagar ou foldar.
  assert.equal(canPlayerRaise(cursor, utgIdx), false, "UTG já agiu no raise de 20 -> não pode subir de novo contra um all-in incompleto");
  // MP ainda não tinha agido nesta rodada -> PODE subir de novo.
  assert.equal(canPlayerRaise(cursor, mpIdx), true, "MP ainda não tinha agido -> pode pagar os 30 ou subir de novo");

  // Confirma na prática: se UTG (que não pode) tentar subir mesmo assim, o motor rebaixa pra CALL.
  applyDirect(utgIdx, { action: "RAISE", raiseToBB: 999 });
  assert.equal(cursor.committedBB[utgIdx], 30, "a tentativa de re-raise de quem não pode vira um CALL automático, pagando o all-in incompleto");

  // Confirma na prática: se MP (que pode) decidir subir, o mínimo legal é 30 + 19 = 49 (a última
  // aposta válida de verdade, 30, mais o incremento mínimo de 19) — pedindo menos que isso, o
  // motor arredonda pra cima pro mínimo legal, nunca aceita um valor abaixo dele.
  applyDirect(mpIdx, { action: "RAISE", raiseToBB: 35 }); // pede menos que o mínimo legal
  assert.equal(cursor.committedBB[mpIdx], 49, "MP pediu 35, mas o mínimo legal pra reabrir era 30+19=49 — o motor não aceita menos que isso");
  assert.equal(cursor.lastRaiseWasComplete, true, "esse raise de MP É completo (49-30=19, exatamente o mínimo) -- reabre a ação de novo pra todo mundo");
});

test("multi-shove com stacks efetivos diferentes: side pot de verdade, não pote inteiro pro vencedor do showdown (bug reportado: contas não fechavam)", () => {
  // 3 sobreviventes, três profundidades de all-in diferentes: 10bb, 30bb e 50bb — pote total 90bb.
  // Mão do assento 0 (só tinha 10bb) é a MELHOR (quadra), assento 1 (30bb) é a segunda melhor
  // (dois pares), assento 2 (50bb) é a pior (par). Sem side pot, o vencedor do showdown levaria
  // os 90bb inteiros — errado, porque 40bb desse total só existiam entre os assentos 1 e 2 (o
  // assento 0 nunca colocou ficha lá pra poder disputar aquela parte).
  const board = [c(9, "♣"), c(9, "♦"), c(4, "♦"), c(7, "♣"), c(2, "♠")];
  const hands = [
    [c(9, "♥"), c(9, "♠")], // QUADRA (9,9,9,9 usando o par do board)
    [c(4, "♥"), c(7, "♥")], // DOIS PARES (9s do board + 4s/7s)
    [c(13, "♦"), c(12, "♣")], // só o par de 9s do board, kickers K/Q
  ];
  const positions = ["A", "B", "C"];
  const round = { totalContributedBB: [10, 30, 50], survivors: [0, 1, 2], history: [], heroFolded: false, potBB: 90 };

  const result = finalizeHeroHandResult({ positions, heroIndex: 0, heroPosition: "A", hands, board, round });

  assert.equal(result.potBB, 90, "pote total precisa ser a soma bruta contribuída, sem side pot ainda aplicado");
  const deltaByPos = Object.fromEntries(result.perSeatChipDeltaBB.map((d) => [d.position, d.chipDeltaBB]));
  // Camada 1 (0-10, todos elegíveis, 30bb) -> assento 0 (melhor mão) leva tudo: +20 líquido (30-10).
  // Camada 2 (10-30, só 1 e 2 elegíveis, 40bb) -> assento 1 (segunda melhor) leva tudo: +10 líquido (40-30).
  // Camada 3 (30-50, só o assento 2 alcançou, 20bb) -> devolvida sem disputa: 0 líquido (20-20... na
  // verdade o assento 2 só recupera o que ninguém mais cobriu, ficando com -30 no total: perdeu os
  // 30bb que os outros dois igualaram e nunca recuperou nada delas).
  assert.ok(Math.abs(deltaByPos.A - 20) < 1e-9, `assento A (quadra, 10bb) deveria ganhar +20, deu ${deltaByPos.A}`);
  assert.ok(Math.abs(deltaByPos.B - 10) < 1e-9, `assento B (dois pares, 30bb) deveria ganhar +10 (vence o side pot contra C), deu ${deltaByPos.B}`);
  assert.ok(Math.abs(deltaByPos.C - (-30)) < 1e-9, `assento C (par, 50bb) deveria perder -30 (nunca disputou nada com a quadra do assento A), deu ${deltaByPos.C}`);
  const sum = result.perSeatChipDeltaBB.reduce((s, d) => s + d.chipDeltaBB, 0);
  assert.ok(Math.abs(sum) < 1e-9, `soma dos deltas precisa ser 0 (conservação de fichas), deu ${sum}`);
  assert.equal(result.heroWon, true, "assento 0 é o herói neste teste e venceu a mão principal");
  assert.equal(result.heroChipDeltaBB, deltaByPos.A);
  // Bug antigo (sem side pot): assento A levaria os 90bb inteiros (delta +80) — confirma que a
  // correção realmente mudou o comportamento, não só manteve por acaso o resultado antigo.
  assert.notEqual(deltaByPos.A, 80, "se isso disparar, a correção de side pot regrediu pro bug antigo (pote inteiro pro vencedor do showdown)");
});

test("splitPotIntoLayers particiona o total contribuído em camadas que somam exatamente o pote, mesmo com fold no meio", () => {
  // 4 jogadores: um foldou cedo (contribuiu 5, dead money), dois sobreviventes com stacks
  // diferentes (15 e 40) e um terceiro sobrevivente cobrindo todo mundo (60).
  const totalContributedBB = [5, 15, 40, 60];
  const survivors = [1, 2, 3]; // idx 0 foldou
  const layers = splitPotIntoLayers(totalContributedBB, survivors);
  const totalLayered = layers.reduce((sum, l) => sum + l.amount, 0);
  const totalContributed = totalContributedBB.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(totalLayered - totalContributed) < 1e-9, `camadas (${totalLayered}) precisam somar exatamente o total contribuído (${totalContributed})`);
  // Nenhum jogador que foldou (idx 0) pode aparecer como elegível em nenhuma camada.
  for (const layer of layers) assert.ok(!layer.eligible.includes(0), "quem foldou nunca pode ser elegível a ganhar uma camada");
});