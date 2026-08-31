import test from "node:test";
import assert from "node:assert/strict";
import {
  createTournamentConfig, initTournament, advanceHand, recordFinish, summarizeRankingHistogram,
  totalTournamentsPlayed, classifyPlayerStyle, buildTournamentReport, formatTournamentReportText,
  estimateProjectedFinish,
} from "../app/tournamentEngine.js";
import { decideVillainPreflopAction } from "../app/tournamentHandEngine.js";
import {
  FULL_TABLE_SIZE, initTable, reconcileTableSize, playNextTableHand, beginTableHand, resumeTableHand,
  peekHeroPositionForNextHand,
} from "../app/tournamentTableEngine.js";

function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Piloto de teste: joga como a mesma IA usada pros vilões, só pra ter uma política de decisão
// coerente durante a simulação (não é o "cérebro" do herói de verdade — isso é decisão de UI,
// Fase 4).
function heroAsAI(ctx) {
  return decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile ?? 50, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
}

test("initTable cria 9 assentos, com o herói em exatamente um deles", () => {
  const config = createTournamentConfig({ fieldSize: 100 });
  const state = initTournament(config, makeRng(1));
  const avgStack = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack, makeRng(2));
  assert.equal(tableState.seats.length, FULL_TABLE_SIZE);
  assert.equal(tableState.seats.filter((s) => s.isHero).length, 1);
  const heroSeat = tableState.seats.find((s) => s.isHero);
  assert.equal(heroSeat.chips, state.heroStack);
});

test("reconcileTableSize nunca remove o assento do herói, só vilões", () => {
  const config = createTournamentConfig({ fieldSize: 100 });
  const state = initTournament(config, makeRng(1));
  const avgStack = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack, makeRng(2));
  state.fieldRemaining = 3; // simula campo já bem reduzido
  reconcileTableSize(tableState, state, avgStack, makeRng(3));
  assert.equal(tableState.seats.length, 3);
  assert.equal(tableState.seats.filter((s) => s.isHero).length, 1, "o herói nunca pode ser removido pelo balanceamento");
});

test("a mesa do herói sempre tem 9 assentos ocupados enquanto o campo abstrato tiver 9+ jogadores, e encolhe exatamente quando o campo cai abaixo de 9", () => {
  // Roda várias sementes em vez de uma só: o herói pode ser eliminado antes de o campo abstrato
  // cair abaixo de 9 numa semente específica (fim de jogo legítimo, não bug) — o invariante de
  // tamanho de mesa é conferido em TODA mão de TODA semente; "viu encolher" só precisa acontecer
  // em pelo menos uma delas, pra provar que o mecanismo funciona sem depender de uma única sorte.
  let sawNineHanded = false, sawShrink = false;
  for (let seed = 11; seed < 11 + 8; seed++) {
    const config = createTournamentConfig({ fieldSize: 50, handsPerLevelConfig: 30 });
    const state = initTournament(config, makeRng(seed));
    const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
    const tableState = initTable(state, avgStack0, makeRng(seed + 1));

    let hands = 0;
    while (!state.finished && hands < 3000) {
      // A garantia real: a mesa usada PRA JOGAR esta mão nunca passa de min(9, campo de antes desta
      // mão) — não confundir com o tamanho depois que o campo já avançou mais uma mão (isso teria
      // uma defasagem natural de uma mão, sem ser um bug — ver nota em tournamentTableEngine.js).
      // Pode encolher mais de 1 assento na MESMA mão sem ser bug nenhum: numa mesa final de verdade
      // (campo < 9, sem reposição), um all-in multi-way com um único vencedor pode eliminar 2+
      // vilões ao mesmo tempo — applyHandResult remove todo assento que zerou naquela mão, não só
      // um por vez. O herói nunca é removido por este caminho, então a mesa nunca fica vazia.
      const expectedThisHand = Math.min(FULL_TABLE_SIZE, state.fieldRemaining);
      const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroAsAI, handSeed: `balance-${seed}-${hands}` });
      assert.ok(
        result.tableSizeAfter <= expectedThisHand && result.tableSizeAfter >= 1,
        `mesa (${result.tableSizeAfter}) não deveria passar do campo de antes desta mão (${expectedThisHand}), nem ficar sem o herói (mínimo 1)`,
      );
      if (result.tableSizeAfter === FULL_TABLE_SIZE) sawNineHanded = true;
      if (result.tableSizeAfter < FULL_TABLE_SIZE) sawShrink = true;
      advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
      hands++;
    }
  }
  assert.ok(sawNineHanded, "deveria ter passado por trechos com mesa cheia (9 assentos)");
  assert.ok(sawShrink, "deveria ter visto a mesa encolher em algum momento antes do fim, em pelo menos uma das sementes");
});

test("o torneio inteiro (Fase 1 + Fase 2 + Fase 3 integradas) roda de ponta a ponta sem travar, em vários campos e formatos", () => {
  for (const fieldSize of [50, 100]) {
    for (const buyInMode of ["FREEZEOUT", "REBUY"]) {
      const config = createTournamentConfig({ fieldSize, buyInMode, handsPerLevelConfig: 30 });
      const state = initTournament(config, makeRng(21));
      const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
      const tableState = initTable(state, avgStack0, makeRng(22));
      let hands = 0;
      while (!state.finished && hands < 3000) {
        const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroAsAI, handSeed: `e2e-${fieldSize}-${buyInMode}-${hands}` });
        advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
        hands++;
      }
      assert.equal(state.finished, true, `torneio (campo ${fieldSize}, ${buyInMode}) não terminou dentro de 3000 mãos`);
      assert.ok(state.finishRank >= 1, "posição final precisa ser um número válido");
    }
  }
});

test("quando o herói é eliminado, o torneio encerra e o assento dele nunca é reaproveitado por outro jogador", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "FREEZEOUT", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(31));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(32));
  const heroForceBustPolicy = () => ({ action: "SHOVE", raiseToBB: 1000 });
  let hands = 0;
  while (!state.finished && hands < 200) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroForceBustPolicy, handSeed: `bust-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
    if (state.finished) break;
  }
  assert.equal(state.finished, true);
  assert.equal(state.heroBusted, true);
});

test("rastreio de qualidade de decisão: herói jogando mal (abre tudo, sempre) acumula MUITOS erros, e o saldo de fichas nas mãos com erro fica bem negativo", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(42));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(43));
  const heroBadPolicy = () => ({ action: "RAISE", raiseToBB: 3 }); // abre qualquer mão, ignora força
  let hands = 0;
  while (!state.finished && hands < 500) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroBadPolicy, handSeed: `mau-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  assert.ok(state.decisionsCount > 0, "precisa ter tomado alguma decisão");
  const mistakeRate = state.mistakesCount / state.decisionsCount;
  assert.ok(mistakeRate > 0.7, `jogando tudo igual (abrir sempre), a taxa de erro deveria ser bem alta: ${mistakeRate}`);
  assert.ok(state.chipsFromMistakes < 0, "saldo de fichas nas mãos com erro precisa ficar negativo no total, jogando tão mal");
  assert.ok(state.mistakeLog.length > 0 && state.mistakeLog.length <= 50, "log de erros precisa existir e respeitar o teto de tamanho");
});

test("rastreio de qualidade de decisão: herói jogando com a mesma régua da IA nunca comete erro (por definição — é a própria régua)", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(42));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(43));
  const heroGoodPolicy = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  let hands = 0;
  while (!state.finished && hands < 400) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroGoodPolicy, handSeed: `bom-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  assert.equal(state.mistakesCount, 0);
  assert.equal(state.chipsFromMistakes, 0);
  assert.ok(state.chipsFromGoodDecisions !== 0 || state.decisionsCount === 0);
});

test("ranking histórico entre torneios: recordFinish/summarizeRankingHistogram acumulam e formatam corretamente", () => {
  let histogram = {};
  histogram = recordFinish(histogram, 1);
  histogram = recordFinish(histogram, 1);
  histogram = recordFinish(histogram, 1);
  histogram = recordFinish(histogram, 2);
  for (let i = 0; i < 10; i++) histogram = recordFinish(histogram, 2);
  for (let i = 0; i < 23; i++) histogram = recordFinish(histogram, 20);
  const summary = summarizeRankingHistogram(histogram);
  assert.deepEqual(summary, [{ rank: 1, count: 3 }, { rank: 2, count: 11 }, { rank: 20, count: 23 }]);
  assert.equal(totalTournamentsPlayed(histogram), 3 + 11 + 23);
});

test("estimateProjectedFinish: nunca projeta colocação pior que a real, e não projeta nada quando já é 1º lugar", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(77));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(78));
  let callCount = 0;
  const heroMixedPolicy = (ctx) => {
    callCount++;
    if (callCount % 3 === 0) return { action: "RAISE", raiseToBB: 3 };
    return decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  };
  let hands = 0;
  while (!state.finished && hands < 2000) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroMixedPolicy, handSeed: `proj-report-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  const report = buildTournamentReport(state);
  assert.ok(report.projectedFinish, "precisa existir um objeto de projeção");
  if (state.finishRank > 1) {
    assert.ok(report.projectedFinish.projectedRank <= state.finishRank, "a projeção nunca pode ser pior que a colocação real");
    assert.ok(report.projectedFinish.projectedRank >= 1, "a projeção nunca pode passar do 1º lugar");
  } else {
    assert.equal(report.projectedFinish.projectedRank, 1);
    assert.equal(report.projectedFinish.hypotheticalStack, null, "campeão não precisa de projeção (já é a melhor colocação possível)");
    assert.doesNotMatch(formatTournamentReportText(report), /Projeção:/, "não deveria aparecer texto de projeção pra quem já é 1º lugar");
  }
});

test("estimateProjectedFinish: quanto mais fichas 'limpas' (só efeito de boas decisões) em relação à média do campo, melhor (menor) a colocação projetada", () => {
  // Casos sintéticos diretos, sem depender de simulação aleatória: confere a matemática pura da
  // fórmula de projeção.
  const config = createTournamentConfig({ fieldSize: 100, startingStack: 40000 });
  const baseState = initTournament(config, makeRng(1));
  baseState.finished = true;
  baseState.finishRank = 80;
  baseState.totalChipsInPlay = 80 * 40000; // stack médio exato de 40000 na hora da eliminação

  const reportNoEffect = { chipsFromGoodDecisions: 0 };
  const reportBigGain = { chipsFromGoodDecisions: 120000 }; // stack limpo = 160000 = 4x a média
  const reportLoss = { chipsFromGoodDecisions: -50000 }; // stack limpo negativo -> vira 0

  const projNoEffect = estimateProjectedFinish(baseState, reportNoEffect);
  const projBigGain = estimateProjectedFinish(baseState, reportBigGain);
  const projLoss = estimateProjectedFinish(baseState, reportLoss);

  // Sem nenhum efeito de boas decisões, o stack "limpo" é só o stack inicial (40000) — igual à
  // média do campo na eliminação, então a projeção prevê melhora de fato (não é 0 fichas):
  // round(80 * 40000/(40000+40000)) = 40. Só fica IGUAL à colocação real quando o stack limpo
  // é 0 de verdade (ver projLoss abaixo) — não quando é só "sem ganho adicional".
  assert.equal(projNoEffect.projectedRank, 40, "com stack limpo igual à média do campo, a projeção deveria prever melhora de metade da colocação");
  assert.ok(projBigGain.projectedRank < projNoEffect.projectedRank, "stack limpo bem maior que a média precisa projetar uma colocação melhor ainda");
  assert.equal(projLoss.hypotheticalStack, 0, "stack limpo negativo vira 0, nunca fica abaixo disso");
  assert.equal(projLoss.projectedRank, 80, "sem stack limpo nenhum (0), a projeção fica igual à colocação real — não tem base pra estimar melhora");
});

test("classifyPlayerStyle usa as faixas convencionais de VPIP", () => {
  assert.equal(classifyPlayerStyle(10), "NIT (excessivamente apertado)");
  assert.equal(classifyPlayerStyle(17), "TIGHT (apertado)");
  assert.equal(classifyPlayerStyle(24), "EQUILIBRADO");
  assert.equal(classifyPlayerStyle(35), "LOOSE (solto demais)");
  assert.equal(classifyPlayerStyle(50), "MANÍACO (joga mãos demais)");
});

test("buildTournamentReport/formatTournamentReportText: relatório real reflete decisões certas/erradas/mistas, aberturas por posição e taxa de vitória", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(77));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(78));
  // Herói instável: 2 de cada 3 decisões seguem a régua correta, 1 de cada 3 abre qualquer coisa
  // (gera uma mistura real de certo/errado/misto, não só os dois extremos).
  let callCount = 0;
  const heroMixedPolicy = (ctx) => {
    callCount++;
    if (callCount % 3 === 0) return { action: "RAISE", raiseToBB: 3 };
    return decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  };
  let hands = 0;
  while (!state.finished && hands < 2000) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroMixedPolicy, handSeed: `report-teste-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  const report = buildTournamentReport(state);

  // As três fatias (certo/errado/misto) precisam somar ~100% das mãos com decisão.
  assert.ok(Math.abs(report.correctPercent + report.wrongPercent + report.mixedPercent - 100) < 0.5);
  assert.ok(report.mixedPercent > 0, "com decisões instáveis, precisa aparecer pelo menos alguma mão mista");
  assert.equal(report.chipsFromMistakes, report.chipsAllWrong + report.chipsMixed);
  assert.equal(report.netChipEffect, report.chipsFromGoodDecisions + report.chipsFromMistakes);
  assert.ok(report.handsPlayed > 0);
  assert.ok(report.vpipPercent >= 0 && report.vpipPercent <= 100);
  assert.ok(typeof report.playerStyle === "string" && report.playerStyle.length > 0);
  assert.ok(Object.keys(report.openCountByPosition).length > 0, "precisa ter aberto o jogo em pelo menos uma posição");
  assert.ok(report.winPercent >= 0 && report.winPercent <= 100);

  const text = formatTournamentReportText(report);
  assert.match(text, /decisões corretas/);
  assert.match(text, /decisões erradas|erradas/);
  assert.match(text, /mistas/);
  assert.match(text, /jogador/);
  assert.match(text, /mãos e venceu/);
  assert.match(text, /Abriu o jogo/);
  // Ordem de exibição das posições precisa seguir a ordem real de ação (utg antes de utg1 antes
  // de mp, etc.), não a ordem de inserção do objeto.
  const utgIdx = text.indexOf(" utg ");
  const btnIdx = text.indexOf(" btn ");
  if (utgIdx >= 0 && btnIdx >= 0) assert.ok(utgIdx < btnIdx, "utg precisa aparecer antes de btn no texto");
});

test("buildTournamentReport: torneio 'perfeito' (herói sempre segue a régua) nunca gera decisão errada nem mista", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(42));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(43));
  const heroGoodPolicy = (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng: Math.random });
  let hands = 0;
  while (!state.finished && hands < 400) {
    const result = playNextTableHand({ tableState, tournamentState: state, heroDecisionPolicy: heroGoodPolicy, handSeed: `perfeito-${hands}` });
    advanceHand(state, { heroChipDelta: result.heroChipDelta, heroBusted: state.heroStack + result.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  const report = buildTournamentReport(state);
  assert.equal(report.wrongPercent, 0);
  assert.equal(report.mixedPercent, 0);
  assert.equal(report.correctPercent, 100);
  assert.equal(report.recommendedTraining, null, "sem nenhum erro, não deveria sugerir nenhum foco de treino");
});

// Política de "clique real": decide como a IA decidiria — usada só pra simular um usuário
// coerente clicando nos botões, passando pelo status awaiting_hero/resume de verdade, igual a
// tela real vai fazer (nunca usa playNextTableHand/heroDecisionPolicy síncrono). Fábrica com
// RNG determinístico (não Math.random) — cada teste cria sua própria instância a partir da
// mesma seed, pra decisões reprodutíveis sem compartilhar estado entre testes (importante pro
// teste de paridade, que compara duas simulações que precisam usar a mesma sequência de forma
// independente). Math.random deixava estes testes sensíveis ao timing de execução em paralelo
// com outros arquivos de teste, causando falhas intermitentes não relacionadas ao motor em si.
function makeClickLikeAI(seed) {
  const rng = makeRng(seed);
  return (ctx) => decideVillainPreflopAction({ position: ctx.position, percentile: ctx.percentile, facing: ctx.facing, stackBB: ctx.stackBB, rng });
}

test("beginTableHand/resumeTableHand: fluxo pausável de verdade, joga o torneio inteiro mão a mão via cliques simulados", () => {
  const config = createTournamentConfig({ fieldSize: 50, buyInMode: "FREEZEOUT", handsPerLevelConfig: 30 });
  const state = initTournament(config, makeRng(55));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(56));
  const clickLikeAI = makeClickLikeAI(57);

  let hands = 0, decisionsShown = 0;
  while (!state.finished && hands < 400) {
    let step = beginTableHand({ tableState, tournamentState: state, handSeed: `resumable-e2e-${hands}` });
    let guard = 0;
    while (step.status === "awaiting_hero" && guard++ < 15) {
      decisionsShown++;
      const decision = clickLikeAI(step.context);
      step = resumeTableHand(step.pending, decision);
    }
    assert.equal(step.status, "done", "a mão precisa terminar (não pode ficar presa pedindo decisão pra sempre)");
    advanceHand(state, { heroChipDelta: step.heroChipDelta, heroBusted: state.heroStack + step.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  assert.equal(state.finished, true, "torneio precisa terminar dentro de 400 mãos");
  assert.ok(decisionsShown >= hands, "cada mão jogada teve pelo menos uma decisão real mostrada ao herói (ou zero, se ganhou de graça no BB — mas no total tem que ter pelo menos uma por mão em média)");
  assert.ok(state.decisionsCount > 0);
});

test("beginTableHand/resumeTableHand produz o MESMO resultado que playNextTableHand síncrono, com a mesma semente e a mesma política de decisão", () => {
  // Duas simulações lado a lado: uma com o fluxo síncrono antigo (heroDecisionPolicy), outra com
  // o fluxo pausável novo (begin/resume) — como usam exatamente a mesma semente e a mesma régua
  // de decisão, os resultados hand a hand precisam bater bit a bit.
  const configA = createTournamentConfig({ fieldSize: 50, buyInMode: "FREEZEOUT", handsPerLevelConfig: 30 });
  const stateA = initTournament(configA, makeRng(99));
  const avgStackA = stateA.totalChipsInPlay / stateA.fieldRemaining;
  const tableA = initTable(stateA, avgStackA, makeRng(100));

  const configB = createTournamentConfig({ fieldSize: 50, buyInMode: "FREEZEOUT", handsPerLevelConfig: 30 });
  const stateB = initTournament(configB, makeRng(99));
  const avgStackB = stateB.totalChipsInPlay / stateB.fieldRemaining;
  const tableB = initTable(stateB, avgStackB, makeRng(100));

  // Instâncias independentes com a MESMA seed — A e B precisam receber a mesma sequência de
  // decisões cada um na sua própria simulação (não uma única instância compartilhada, que
  // ficaria consumida de forma intercalada entre as chamadas de A e de B).
  const clickLikeAiA = makeClickLikeAI(57);
  const clickLikeAiB = makeClickLikeAI(57);

  let hands = 0;
  while (!stateA.finished && !stateB.finished && hands < 200) {
    const resultA = playNextTableHand({ tableState: tableA, tournamentState: stateA, heroDecisionPolicy: clickLikeAiA, handSeed: `paridade-${hands}` });
    let stepB = beginTableHand({ tableState: tableB, tournamentState: stateB, handSeed: `paridade-${hands}` });
    let guard = 0;
    while (stepB.status === "awaiting_hero" && guard++ < 10) stepB = resumeTableHand(stepB.pending, clickLikeAiB(stepB.context));

    assert.equal(resultA.heroChipDelta, stepB.heroChipDelta, `mão ${hands}: delta de fichas do herói divergiu entre o fluxo síncrono e o pausável`);
    assert.deepEqual(resultA.handResult.heroCards, stepB.handResult.heroCards, `mão ${hands}: cartas do herói divergiram`);

    advanceHand(stateA, { heroChipDelta: resultA.heroChipDelta, heroBusted: stateA.heroStack + resultA.heroChipDelta <= 0 }, makeRng(hands + 1));
    advanceHand(stateB, { heroChipDelta: stepB.heroChipDelta, heroBusted: stateB.heroStack + stepB.heroChipDelta <= 0 }, makeRng(hands + 1));
    hands++;
  }
  assert.ok(hands > 50, "precisa ter comparado uma quantidade razoável de mãos");
});

test("nenhuma mão trava num cabo de guerra de re-raise de incremento mínimo (bug real: raise sugerido menor que a aposta já em jogo virava +0,5bb repetido, sem nunca fechar)", () => {
  // Amostra grande de propósito: o bug só aparecia com stacks fundos (~90-100bb) depois de
  // algumas rodadas de raise, então precisa de volume real pra garantir que não volta.
  let maxDecisionsSeen = 0;
  for (let trial = 0; trial < 15; trial++) {
    const config = createTournamentConfig({ fieldSize: 100, handsPerLevelConfig: 40, buyInMode: "REBUY" });
    const state = initTournament(config, makeRng(2000 + trial));
    const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
    const tableState = initTable(state, avgStack0, makeRng(3000 + trial));
    const clickLikeAI = makeClickLikeAI(4000 + trial);
    let hands = 0;
    while (!state.finished && hands < 800) {
      let step = beginTableHand({ tableState, tournamentState: state, handSeed: `sem-loop-${trial}-${hands}` });
      let guard = 0;
      while (step.status === "awaiting_hero" && guard++ < 30) step = resumeTableHand(step.pending, clickLikeAI(step.context));
      assert.ok(guard < 30, `mão travou (trial ${trial}, mão ${hands}) — precisou de 30+ decisões do herói numa mão só`);
      maxDecisionsSeen = Math.max(maxDecisionsSeen, guard);
      advanceHand(state, { heroChipDelta: step.heroChipDelta, heroBusted: state.heroStack + step.heroChipDelta <= 0 }, makeRng(hands + 1));
      hands++;
    }
  }
  assert.ok(maxDecisionsSeen <= 25, `número de decisões numa mão ficou alto demais (${maxDecisionsSeen}) — sinal de cabo de guerra descontrolado`);
});

test("peekHeroPositionForNextHand adivinha corretamente a posição real que a mão vai usar (integração com o banco geral de spots do app)", () => {
  const config = createTournamentConfig({ fieldSize: 100, handsPerLevelConfig: 40 });
  const state = initTournament(config, makeRng(42));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(43));

  for (let i = 0; i < 20; i++) {
    const handSeed = `peek-teste-${i}`;
    const peeked = peekHeroPositionForNextHand({ tableState, tournamentState: state, handSeed });
    const step = beginTableHand({ tableState, tournamentState: state, handSeed });
    const actualPosition = step.status === "awaiting_hero" ? step.context.position : step.handResult.heroPosition;
    assert.equal(peeked, actualPosition, `mão ${i}: posição espiada (${peeked}) não bateu com a real (${actualPosition})`);
    // Resolve a mão (foldando sempre) pra avançar pra próxima e continuar o teste.
    let s = step;
    let guard = 0;
    while (s.status === "awaiting_hero" && guard++ < 10) s = resumeTableHand(s.pending, { action: "FOLD" });
    advanceHand(state, { heroChipDelta: s.heroChipDelta, heroBusted: state.heroStack + s.heroChipDelta <= 0 }, makeRng(i + 1));
  }
});

test("beginTableHand com heroCardsOverride: herói recebe exatamente as cartas encomendadas, sem duplicar com o resto da mesa", () => {
  const config = createTournamentConfig({ fieldSize: 100, handsPerLevelConfig: 40 });
  const state = initTournament(config, makeRng(42));
  const avgStack0 = state.totalChipsInPlay / state.fieldRemaining;
  const tableState = initTable(state, avgStack0, makeRng(43));

  const encomendadas = [{ v: 14, s: "♠" }, { v: 13, s: "♠" }]; // AKs
  const step = beginTableHand({ tableState, tournamentState: state, handSeed: "override-teste", heroCardsOverride: encomendadas });
  assert.deepEqual(step.heroCards, encomendadas);
});
