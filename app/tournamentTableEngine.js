// ---------- FASE 3 — BALANCEAMENTO DE MESA ----------
// Camada de orquestração: junta o motor de torneio (tournamentEngine.js — nível, campo, blinds)
// e o motor de mão (tournamentHandEngine.js — cartas, avaliação, IA) SEM que um importe o outro
// (decisão de arquitetura da Fase 2). Só este módulo importa os dois, e só ele conhece o "elo"
// entre eles: aqui é onde os stacks dos adversários da mesa do herói viram persistentes de
// verdade (cada assento guarda o próprio stack em fichas entre uma mão e a seguinte), e onde
// mora a regra de balanceamento: enquanto o campo abstrato ainda tiver 9+ jogadores, a mesa do
// herói sempre tem 9 assentos ocupados — quando um vilão zera numa mão, entra outro jogador
// vindo do campo abstrato no lugar dele. Só quando o campo cai abaixo de 9 é que a mesa do
// herói vira a mesa final de verdade, e aí sim ela encolhe (sem reposição nenhuma).

import {
  currentBlinds, isFinalTable,
} from "./tournamentEngine.js";
import {
  positionsForTableSize, heroPositionFromSeats, playHeroHand, tournamentRng,
  evaluateHeroPreflopDecision, beginHeroHand, resumeHeroHandDecision,
} from "./tournamentHandEngine.js";

const FULL_TABLE_SIZE = 9;

// Sorteia um stack plausível de vilão em torno do stack médio do campo, com variância — mesmo
// espírito de heterogeneidade (alguns curtos, alguns fundos) usado no resto do motor de mão.
function drawVillainStackChips(avgStackChips, rng) {
  return Math.max(1, Math.round(avgStackChips * (0.4 + rng() * 1.6)));
}

// Cria a mesa inicial do herói: 9 assentos (ou menos, se o torneio já começar com campo curto —
// não é o caso normal, mas cobre o cenário de teste/edge case), o herói num deles, os outros
// preenchidos com vilões de stack plausível.
function initTable(tournamentState, avgStackChips, rng) {
  const tableSize = Math.min(FULL_TABLE_SIZE, tournamentState.fieldRemaining);
  const seats = [];
  for (let i = 0; i < tableSize; i++) {
    seats.push(i === tournamentState.heroSeat % tableSize
      ? { isHero: true, chips: tournamentState.heroStack }
      : { isHero: false, chips: drawVillainStackChips(avgStackChips, rng) });
  }
  // Garante que exatamente um assento é o herói (heroSeat%tableSize pode colidir em tableSize
  // pequeno — corrige se necessário, sem nunca duplicar ou perder o herói de vista).
  if (!seats.some((s) => s.isHero)) seats[0] = { isHero: true, chips: tournamentState.heroStack };
  return { seats, btnIndex: 0 };
}

// Ajusta o TAMANHO da mesa pra bater com o campo abstrato: enquanto o campo tem 9+ jogadores, a
// mesa do herói sempre fica com 9 assentos ocupados (repõe quem sair); abaixo de 9, a mesa do
// herói passa a SER a mesa final de verdade — não tem mais reposição, ela só encolhe.
function reconcileTableSize(tableState, tournamentState, avgStackChips, rng) {
  const target = Math.min(FULL_TABLE_SIZE, tournamentState.fieldRemaining);
  while (tableState.seats.length > target) {
    // Precisa encolher (campo abstrato caiu abaixo de 9) — remove um assento que NÃO é o herói.
    const removableIdx = tableState.seats.findIndex((s) => !s.isHero);
    if (removableIdx === -1) break; // não deveria acontecer (herói é só 1 dos assentos)
    tableState.seats.splice(removableIdx, 1);
    if (tableState.btnIndex >= tableState.seats.length) tableState.btnIndex = 0;
  }
  while (tableState.seats.length < target) {
    // Só pode crescer de novo se, por algum motivo, o campo tivesse voltado a crescer — não
    // acontece no fluxo normal (campo só encolhe), mas cobre o caso defensivamente.
    tableState.seats.push({ isHero: false, chips: drawVillainStackChips(avgStackChips, rng) });
  }
  return tableState;
}

// Depois de uma mão, aplica os deltas de fichas em cada assento e substitui quem zerou — SÓ
// enquanto o campo abstrato ainda tiver 9+ jogadores (replenishment); na mesa final de verdade
// (campo < 9), quem zera está eliminado do torneio de vez, o assento é removido de fato.
function applyHandResult(tableState, handResult, tournamentState, avgStackChips, rng) {
  const tableSize = tableState.seats.length;
  // Mapeia cada assento físico pra sua posição NESTA mão (mesma lógica usada pro herói, mas
  // aplicada a todo mundo — heroPositionFromSeats é genérica o bastante pra isso).
  const seatToPosition = tableState.seats.map((_, seatIdx) => heroPositionFromSeats(seatIdx, tableState.btnIndex, tableSize));
  for (let seatIdx = 0; seatIdx < tableSize; seatIdx++) {
    const position = seatToPosition[seatIdx];
    const deltaEntry = handResult.perSeatChipDeltaBB.find((d) => d.position === position);
    if (!deltaEntry) continue;
    const bb = tournamentState._bbAtHandTime; // ver playNextHand — precisa do BB usado na mão pra converter de volta pra fichas
    tableState.seats[seatIdx].chips = Math.max(0, tableState.seats[seatIdx].chips + deltaEntry.chipDeltaBB * bb);
  }
  // Substitui/remove quem zerou (nunca o herói — a eliminação do herói é tratada à parte, pelo
  // motor de torneio da Fase 1, via advanceHand).
  const stillAboveFinalTable = tournamentState.fieldRemaining >= FULL_TABLE_SIZE;
  for (let seatIdx = tableState.seats.length - 1; seatIdx >= 0; seatIdx--) {
    const seat = tableState.seats[seatIdx];
    if (seat.isHero || seat.chips > 0) continue;
    if (stillAboveFinalTable) seat.chips = drawVillainStackChips(avgStackChips, rng); // repõe
    else tableState.seats.splice(seatIdx, 1); // mesa final de verdade: assento simplesmente acaba
  }
}

// Avalia TODAS as decisões pré-flop que o herói tomou nesta mão (pode ser mais de uma — ex:
// abriu, depois enfrentou um 3-bet) contra a régua real da IA. Classifica a mão inteira em três
// categorias: TUDO_CERTO (nenhum erro), TUDO_ERRADO (toda decisão foi errada) ou MISTA (pelo
// menos uma certa e pelo menos uma errada) — só é possível ter mão mista com 2+ decisões.
function evaluateHandDecisions(handResult) {
  const heroEntries = handResult.history.filter((h) => h.position === handResult.heroPosition);
  const evaluations = heroEntries.map((entry) => evaluateHeroPreflopDecision({
    position: entry.position, percentile: entry.percentile, facing: entry.facing, stackBB: entry.stackBB, heroAction: entry.action,
  }));
  const mistakes = evaluations.filter((ev) => !ev.correct);
  const worstMistake = mistakes.length ? mistakes.reduce((worst, ev) => (ev.severity > worst.severity ? ev : worst)) : null;
  const allCorrect = evaluations.length > 0 && mistakes.length === 0;
  const allWrong = evaluations.length > 0 && mistakes.length === evaluations.length;
  const mixed = evaluations.length > 0 && !allCorrect && !allWrong;
  return { evaluations, heroEntries, hadMistake: mistakes.length > 0, mistakeCount: mistakes.length, worstMistake, allCorrect, allWrong, mixed };
}

// Registra o efeito desta mão no placar de qualidade de decisão do torneio inteiro — só soma o
// saldo real (heroChipDelta) no balde certo (tudo certo / tudo errado / mista); não inventa
// nenhum valor. Também conta abertura de jogo por posição (RFI) e vitórias em showdown, pro
// relatório final.
function recordDecisionQuality(tournamentState, handResult, heroChipDelta) {
  const { evaluations, heroEntries, hadMistake, mistakeCount, worstMistake, allWrong, mixed } = evaluateHandDecisions(handResult);
  if (handResult.involved) tournamentState.handsInvolved += 1;
  if (handResult.heroWon) tournamentState.handsWon += 1;
  if (handResult.wentToShowdown) {
    tournamentState.showdownsSeen += 1;
    if (handResult.heroWon) tournamentState.showdownsWon += 1;
  }
  // Abertura de jogo (RFI): a primeira decisão do herói na mão foi de abrir (ninguém tinha
  // aberto ainda, e ele não foldou) — conta por posição.
  const firstEntry = heroEntries[0];
  if (firstEntry && firstEntry.facing === "NONE" && firstEntry.action !== "FOLD") {
    tournamentState.openCountByPosition[firstEntry.position] = (tournamentState.openCountByPosition[firstEntry.position] || 0) + 1;
  }
  if (!evaluations.length) return; // herói não tomou nenhuma decisão real nesta mão (ex: ganhou de graça no BB)
  tournamentState.decisionsCount += evaluations.length;
  if (!hadMistake) { tournamentState.handsAllCorrect += 1; tournamentState.chipsFromGoodDecisions += heroChipDelta; return; }
  tournamentState.mistakesCount += mistakeCount;
  tournamentState.chipsFromMistakes += heroChipDelta;
  if (allWrong) { tournamentState.handsAllWrong += 1; tournamentState.chipsAllWrong += heroChipDelta; }
  else if (mixed) { tournamentState.handsMixed += 1; tournamentState.chipsMixed += heroChipDelta; }
  tournamentState.mistakeLog.push({
    level: tournamentState.level, position: handResult.heroPosition, mistakeType: worstMistake.mistakeType,
    severity: worstMistake.severity, chipDelta: heroChipDelta,
  });
  if (tournamentState.mistakeLog.length > 50) tournamentState.mistakeLog.shift(); // cap de tamanho
}

// Joga UMA mão completa na mesa do herói, já integrando as duas engines: pega o nível/campo
// atual do motor de torneio (Fase 1), monta os stacks reais e persistentes da mesa, chama o
// motor de mão (Fase 2) pra jogar de verdade, e devolve tudo atualizado — balanceando a mesa
// antes e depois, conforme necessário.
function playNextTableHand({ tableState, tournamentState, heroDecisionPolicy, handSeed }) {
  const rng = tournamentRng(`${handSeed}-BALANCE`);
  const avgStackChips = tournamentState.totalChipsInPlay / tournamentState.fieldRemaining;

  reconcileTableSize(tableState, tournamentState, avgStackChips, rng);
  const tableSize = tableState.seats.length;
  const { bb } = currentBlinds(tournamentState);
  tournamentState._bbAtHandTime = bb; // ver applyHandResult

  const heroSeat = tableState.seats.findIndex((s) => s.isHero);
  const stacksBBOverride = positionsForTableSize(tableSize).map((_, posIdx) => {
    // Descobre qual assento físico ocupa esta posição nesta mão, pra pegar o stack real dele.
    const seatIdx = tableState.seats.findIndex((_, sIdx) => heroPositionFromSeats(sIdx, tableState.btnIndex, tableSize) === positionsForTableSize(tableSize)[posIdx]);
    return Math.max(1, +(tableState.seats[seatIdx].chips / bb).toFixed(2));
  });
  const heroStackBB = Math.max(1, +(tableState.seats[heroSeat].chips / bb).toFixed(2));

  const handResult = playHeroHand({
    heroSeat, btnSeat: tableState.btnIndex, tableSize, heroStackBB, stacksBBOverride,
    heroDecisionPolicy, seedStr: handSeed,
  });

  applyHandResult(tableState, handResult, tournamentState, avgStackChips, rng);
  tableState.btnIndex = (tableState.btnIndex + 1) % tableState.seats.length;

  const heroChipDelta = Math.round(handResult.heroChipDeltaBB * bb);
  recordDecisionQuality(tournamentState, handResult, heroChipDelta);
  return { handResult, heroChipDelta, tableSizeAfter: tableState.seats.length, isFinalTableNow: isFinalTable(tournamentState) };
}

// Aplica o resultado final de uma mão (já resolvida) na mesa e no torneio — mesmo passo final
// que playNextTableHand faz, extraído à parte pra ser reaproveitado pelo par retomável abaixo
// (begin/resumeTableHand), usado pela tela de verdade, onde a decisão do herói vem de um clique.
function finishTableHand(pending, handResult) {
  const { tableState, tournamentState, avgStackChips, rng, bb } = pending;
  applyHandResult(tableState, handResult, tournamentState, avgStackChips, rng);
  tableState.btnIndex = (tableState.btnIndex + 1) % tableState.seats.length;
  const heroChipDelta = Math.round(handResult.heroChipDeltaBB * bb);
  recordDecisionQuality(tournamentState, handResult, heroChipDelta);
  return { status: "done", handResult, heroChipDelta, tableSizeAfter: tableState.seats.length, isFinalTableNow: isFinalTable(tournamentState) };
}

// Começa uma mão na mesa do herói e PAUSA exatamente na primeira decisão dele — pra tela de
// verdade, onde a decisão vem de um clique (assíncrono), não de uma função que já devolve a
// resposta na hora. Faz a mesma preparação de playNextTableHand (balanceamento, stacks reais e
// persistentes), só que usa beginHeroHand por baixo em vez de playHeroHand.
function beginTableHand({ tableState, tournamentState, handSeed, heroCardsOverride }) {
  const rng = tournamentRng(`${handSeed}-BALANCE`);
  const avgStackChips = tournamentState.totalChipsInPlay / tournamentState.fieldRemaining;

  reconcileTableSize(tableState, tournamentState, avgStackChips, rng);
  const tableSize = tableState.seats.length;
  const { bb } = currentBlinds(tournamentState);
  tournamentState._bbAtHandTime = bb;

  const heroSeat = tableState.seats.findIndex((s) => s.isHero);
  const stacksBBOverride = positionsForTableSize(tableSize).map((_, posIdx) => {
    const seatIdx = tableState.seats.findIndex((_, sIdx) => heroPositionFromSeats(sIdx, tableState.btnIndex, tableSize) === positionsForTableSize(tableSize)[posIdx]);
    return Math.max(1, +(tableState.seats[seatIdx].chips / bb).toFixed(2));
  });
  const heroStackBB = Math.max(1, +(tableState.seats[heroSeat].chips / bb).toFixed(2));

  const begin = beginHeroHand({ heroSeat, btnSeat: tableState.btnIndex, tableSize, heroStackBB, stacksBBOverride, heroCardsOverride, seedStr: handSeed });
  const pending = { tableState, tournamentState, avgStackChips, rng, bb };
  if (begin.status === "done") return finishTableHand(pending, begin.result);
  return { status: "awaiting_hero", context: begin.context, heroCards: begin.heroCards, pending: { ...pending, session: begin.session } };
}

// A posição real do herói NESTA mão, antes de a mão começar — usado pela tela pra consultar o
// banco geral de spots do app (por fase+posição) e "encomendar" as cartas do herói a partir de
// lá (ver Trainer.jsx), sem precisar duplicar essa conta em dois lugares. Reconcilia o tamanho
// da mesa primeiro (idempotente — beginTableHand faz de novo depois, sem efeito duplicado) pra
// nunca calcular a posição contra uma mesa desatualizada.
function peekHeroPositionForNextHand({ tableState, tournamentState, handSeed }) {
  const rng = tournamentRng(`${handSeed}-BALANCE`);
  const avgStackChips = tournamentState.totalChipsInPlay / tournamentState.fieldRemaining;
  reconcileTableSize(tableState, tournamentState, avgStackChips, rng);
  const tableSize = tableState.seats.length;
  const heroSeat = tableState.seats.findIndex((s) => s.isHero);
  return heroPositionFromSeats(heroSeat, tableState.btnIndex, tableSize);
}

// Continua uma mão pausada por beginTableHand (ou por uma chamada anterior desta função, se a
// ação reabrir) — recebe a decisão real do herói (do clique na tela).
function resumeTableHand(pending, decision) {
  const step = resumeHeroHandDecision(pending.session, decision);
  if (step.status === "done") return finishTableHand(pending, step.result);
  return { status: "awaiting_hero", context: step.context, heroCards: step.heroCards, pending: { ...pending, session: step.session } };
}

export {
  FULL_TABLE_SIZE, drawVillainStackChips, initTable, reconcileTableSize, applyHandResult,
  evaluateHandDecisions, recordDecisionQuality, playNextTableHand,
  beginTableHand, resumeTableHand, peekHeroPositionForNextHand,
};
