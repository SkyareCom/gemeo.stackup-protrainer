import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_SIZES, STARTING_STACKS, HANDS_PER_LEVEL_OPTIONS, ADDON_LEVEL, REBUY_CUTOFF_LEVEL,
  TOURNAMENT_MAX_LEVEL, blindsForLevel, faseForLevel, computeItmThreshold, bountyPerPlayer,
  createTournamentConfig, initTournament, currentFase, currentBlinds, advanceHand,
  isBubble, isFinalTable, isITM,
} from "../app/tournamentEngine.js";

// RNG determinístico simples (LCG) — mesmo padrão usado nos scripts de verificação manual desta
// feature, garante que os testes sejam sempre reprodutíveis.
function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test("createTournamentConfig valida os valores permitidos e rejeita o resto", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, startingStack: 40000, handsPerLevelConfig: 40 });
  assert.equal(cfg.fieldSize, 100);
  assert.equal(cfg.actionTimerSec, 15); // reaproveita o mesmo cronômetro do Modo Prova
  assert.throws(() => createTournamentConfig({ fieldSize: 77 }));
  assert.throws(() => createTournamentConfig({ startingStack: 12345 }));
  assert.throws(() => createTournamentConfig({ handsPerLevelConfig: 25 }));
  assert.throws(() => createTournamentConfig({ tournamentType: "TURBO" }));
  assert.throws(() => createTournamentConfig({ buyInMode: "SATELITE" }));
  for (const v of FIELD_SIZES) createTournamentConfig({ fieldSize: v });
  for (const v of STARTING_STACKS) createTournamentConfig({ startingStack: v });
  for (const v of HANDS_PER_LEVEL_OPTIONS) createTournamentConfig({ handsPerLevelConfig: v });
});

test("blindsForLevel usa a mesma fórmula do resto do app (bb=nivel*200) e ante=BB (BB ante)", () => {
  assert.deepEqual(blindsForLevel(1), { sb: 100, bb: 200, ante: 200 });
  assert.deepEqual(blindsForLevel(10), { sb: 1000, bb: 2000, ante: 2000 });
  const b = blindsForLevel(5);
  assert.equal(b.ante, b.bb); // BB ante: só o botão paga, valendo exatamente 1 BB
});

test("faseForLevel cobre EARLY GAME até FT FINAL sem nenhuma fase D1", () => {
  assert.equal(faseForLevel(1), "EARLY GAME");
  assert.equal(faseForLevel(8), "EARLY GAME");
  assert.equal(faseForLevel(9), "MID GAME");
  assert.equal(faseForLevel(14), "MID GAME");
  assert.equal(faseForLevel(15), "LATE GAME");
  assert.equal(faseForLevel(19), "BOLHA ITM");
  assert.equal(faseForLevel(23), "BOLHA FT");
  assert.equal(faseForLevel(27), "FT FINAL");
  assert.equal(faseForLevel(35), "FT FINAL");
  for (let lvl = 1; lvl <= TOURNAMENT_MAX_LEVEL; lvl++) {
    assert.doesNotMatch(faseForLevel(lvl), /D1/);
  }
});

test("initTournament sorteia BTN e posição do herói entre 0 e 8 (mesa 9-max)", () => {
  const cfg = createTournamentConfig();
  for (let seed = 1; seed <= 50; seed++) {
    const state = initTournament(cfg, makeRng(seed));
    assert.ok(state.btnSeat >= 0 && state.btnSeat <= 8);
    assert.ok(state.heroSeat >= 0 && state.heroSeat <= 8);
    assert.equal(state.level, 1);
    assert.equal(state.fieldRemaining, cfg.fieldSize);
    assert.equal(state.heroStack, cfg.startingStack);
    assert.equal(state.totalChipsInPlay, cfg.fieldSize * cfg.startingStack);
  }
});

test("o campo abstrato encolhe seguindo a curva planejada: ITM perto do nível 21-22, mesa final perto do 26, torneio some perto do 34-35", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, handsPerLevelConfig: 40 });
  const state = initTournament(cfg, makeRng(7));
  let itmLevel = null, ftLevel = null;
  let hands = 0;
  while (!state.finished && hands < 3000) {
    advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(hands + 1));
    hands++;
    if (itmLevel === null && isITM(state)) itmLevel = state.level;
    if (ftLevel === null && isFinalTable(state)) ftLevel = state.level;
  }
  assert.ok(state.finished, "o torneio precisa terminar dentro de 3000 mãos");
  assert.equal(state.finishRank, 1, "sem o herói nunca ser eliminado, ele termina campeão");
  assert.ok(itmLevel >= 18 && itmLevel <= 24, `ITM bateu no nível ${itmLevel}, esperado perto de 21-22`);
  assert.ok(ftLevel >= 23 && ftLevel <= 29, `mesa final bateu no nível ${ftLevel}, esperado perto de 26`);
  assert.ok(state.level >= 30, `torneio terminou cedo demais, no nível ${state.level}`);
});

test("o campo nunca aumenta e nunca vai abaixo de 1", () => {
  const cfg = createTournamentConfig({ fieldSize: 50, handsPerLevelConfig: 30 });
  const state = initTournament(cfg, makeRng(3));
  let prevField = state.fieldRemaining;
  let hands = 0;
  while (!state.finished && hands < 3000) {
    advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(hands + 100));
    hands++;
    assert.ok(state.fieldRemaining <= prevField, "campo nunca pode crescer");
    assert.ok(state.fieldRemaining >= 1, "campo nunca pode ir abaixo de 1");
    prevField = state.fieldRemaining;
  }
});

test("FREEZEOUT: primeira eliminação do herói encerra o torneio imediatamente, sem rebuy", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, buyInMode: "FREEZEOUT" });
  const state = initTournament(cfg, makeRng(9));
  advanceHand(state, { heroChipDelta: -state.heroStack, heroBusted: true }, makeRng(1));
  assert.equal(state.finished, true);
  assert.equal(state.heroBusted, true);
  assert.equal(state.heroRebuys, 0);
  assert.equal(state.finishRank, cfg.fieldSize);
});

test("REBUY: herói pode recomprar até o nível de corte, mas não depois", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, buyInMode: "REBUY", handsPerLevelConfig: 30 });
  const state = initTournament(cfg, makeRng(11));
  // Força o herói a zerar repetidamente até passar do nível de corte de rebuy.
  let hands = 0;
  while (!state.finished && state.level <= REBUY_CUTOFF_LEVEL + 2 && hands < 500) {
    advanceHand(state, { heroChipDelta: -state.heroStack, heroBusted: true }, makeRng(hands + 1));
    hands++;
  }
  assert.ok(state.heroRebuys >= 1, "deveria ter recomprado pelo menos uma vez dentro do período");
  assert.equal(state.finished, true, "no fim, um bust após o nível de corte precisa encerrar o torneio");
  assert.ok(state.level > REBUY_CUTOFF_LEVEL, "só devia encerrar depois do nível de corte de rebuy");
});

test("REBUY: add-on dispara sozinho ao alcançar o nível configurado — soma 20x o BB do nível de add-on (uma vez só)", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, buyInMode: "REBUY", takesAddOn: true, startingStack: 40000, handsPerLevelConfig: 30 });
  const state = initTournament(cfg, makeRng(5));
  let hands = 0;
  while (state.level < ADDON_LEVEL + 3 && !state.finished && hands < 500) {
    advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(hands + 1));
    hands++;
  }
  assert.equal(state.heroAddOnUsed, true);
  // Add-on = 20x o BB DO NÍVEL DO ADD-ON (não o stack inicial) — reflete o valor real das
  // fichas naquele ponto do torneio, já com os blinds bem mais altos que no início.
  const bbNoNivelDoAddOn = blindsForLevel(ADDON_LEVEL).bb;
  assert.equal(state.heroStack, cfg.startingStack + bbNoNivelDoAddOn * 20);
  assert.equal(state.log.filter((e) => e.event === "ADD_ON").length, 1, "add-on só pode acontecer uma vez");
});

test("REBUY com takesAddOn=false nunca aplica o add-on mesmo passando do nível 12", () => {
  const cfg = createTournamentConfig({ fieldSize: 100, buyInMode: "REBUY", takesAddOn: false, handsPerLevelConfig: 30 });
  const state = initTournament(cfg, makeRng(6));
  let hands = 0;
  while (state.level < ADDON_LEVEL + 3 && !state.finished && hands < 500) {
    advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(hands + 1));
    hands++;
  }
  assert.equal(state.heroAddOnUsed, false);
  assert.equal(state.heroStack, cfg.startingStack);
});

test("invariante de fichas: totalChipsInPlay só muda por rebuy/add-on, nunca por decaimento de campo ou variação de mão", () => {
  const cfg = createTournamentConfig({ fieldSize: 50, buyInMode: "REBUY", takesAddOn: true, startingStack: 30000, handsPerLevelConfig: 30, tournamentType: "BOUNTY" });
  const state = initTournament(cfg, makeRng(99));
  const rng = makeRng(99);
  let hands = 0;
  while (!state.finished && hands < 3000) {
    const roll = rng();
    const heroChipDelta = roll < 0.35 ? -Math.round(state.heroStack * 0.9) : Math.round((rng() - 0.4) * state.heroStack * 0.2);
    const bountyCollected = roll < 0.1 ? bountyPerPlayer(cfg.startingStack) : 0;
    advanceHand(state, { heroChipDelta, heroBusted: state.heroStack + heroChipDelta <= 0, bountyCollected }, rng);
    hands++;
  }
  const expectedTotal = cfg.fieldSize * cfg.startingStack
    + state.heroRebuys * cfg.startingStack
    + (state.heroAddOnUsed ? cfg.startingStack : 0);
  assert.equal(state.totalChipsInPlay, expectedTotal);
});

test("BOUNTY acumula heroBountyCollected; NORMAL mantém heroBountyCollected null", () => {
  const cfgBounty = createTournamentConfig({ tournamentType: "BOUNTY" });
  const stateBounty = initTournament(cfgBounty, makeRng(1));
  advanceHand(stateBounty, { heroChipDelta: 1000, heroBusted: false, bountyCollected: 5000 }, makeRng(2));
  assert.equal(stateBounty.heroBountyCollected, 5000);

  const cfgNormal = createTournamentConfig({ tournamentType: "NORMAL" });
  const stateNormal = initTournament(cfgNormal, makeRng(1));
  advanceHand(stateNormal, { heroChipDelta: 1000, heroBusted: false, bountyCollected: 5000 }, makeRng(2));
  assert.equal(stateNormal.heroBountyCollected, null);
});

test("BTN gira uma posição por mão, voltando a 0 depois de 8 (mesa 9-max)", () => {
  const cfg = createTournamentConfig();
  const state = initTournament(cfg, makeRng(1));
  state.btnSeat = 8;
  advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(1));
  assert.equal(state.btnSeat, 0);
});

test("computeItmThreshold e bountyPerPlayer calculam valores plausíveis", () => {
  assert.equal(computeItmThreshold(100), 15);
  assert.equal(computeItmThreshold(50), 8);
  assert.equal(computeItmThreshold(200), 30);
  assert.ok(bountyPerPlayer(40000) > 0);
});

test("currentFase e currentBlinds refletem o nível atual do estado", () => {
  const cfg = createTournamentConfig();
  const state = initTournament(cfg, makeRng(1));
  assert.equal(currentFase(state), "EARLY GAME");
  assert.deepEqual(currentBlinds(state), blindsForLevel(1));
});

test("o torneio sempre converge a 1 campeão, mesmo com campo grande (200) onde 1% já é um número inteiro de jogadores", () => {
  // Bug real encontrado: a curva de decaimento tinha um piso fixo (1% do campo) que, pra campos
  // grandes, já é um número inteiro maior que 1 (1% de 200 = 2) — o campo travava em 2 jogadores
  // pra sempre e o torneio nunca terminava. A curva agora precisa continuar caindo além do
  // último ponto de referência até esbarrar em 1 de verdade.
  for (const fieldSize of [50, 100, 200]) {
    const cfg = createTournamentConfig({ fieldSize, handsPerLevelConfig: 50 });
    const state = initTournament(cfg, makeRng(21));
    let hands = 0;
    while (!state.finished && hands < 6000) {
      advanceHand(state, { heroChipDelta: 0, heroBusted: false }, makeRng(hands + 1));
      hands++;
    }
    assert.equal(state.finished, true, `campo ${fieldSize} não terminou dentro de 6000 mãos`);
    assert.equal(state.fieldRemaining, 1, `campo ${fieldSize} travou em ${state.fieldRemaining} jogadores em vez de convergir a 1`);
  }
});

test("isBubble identifica a janela estreita logo antes do limiar de ITM", () => {
  const cfg = createTournamentConfig({ fieldSize: 100 });
  const state = initTournament(cfg, makeRng(1));
  state.fieldRemaining = computeItmThreshold(100) + 2; // 17, dentro da janela de bolha
  assert.equal(isBubble(state), true);
  state.fieldRemaining = computeItmThreshold(100); // já é ITM, não é mais bolha
  assert.equal(isBubble(state), false);
});
