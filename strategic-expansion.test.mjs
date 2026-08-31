import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EXPANSION_PRESETS, buildStrategicExpansionEntries, strategicSignature,
  matchesExpansionPreset, bountyDecisionAdjustment,
} from "../app/strategicExpansion.js";

const phases = ["EARLY GAME","MID GAME","LATE GAME","BOLHA ITM","BOLHA FT","FT FINAL","D1 RE-ENTRY","D1 RE-ENTRY (F)","D1 BAGGING"];
const streets = ["PRE-FLOP","FLOP","TURN","RIVER"];
const entries = phases.flatMap((fase) => streets.flatMap((street) =>
  buildStrategicExpansionEntries(fase, street).map((entry) => ({ ...entry, fase, street }))
));

test("novas entradas possuem assinatura canônica única", () => {
  const signatures = entries.map(strategicSignature);
  assert.equal(new Set(signatures).size, signatures.length);
});

test("todos os novos estados pertencem à expansão do banco geral", () => {
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.additive === true));
});

test("filtros obrigatórios estão presentes", () => {
  const keys = new Set(EXPANSION_PRESETS.map((preset) => preset.key));
  for (const key of ["SB_EP","SB_MP","SB_LP","FACING_4BET","FOURBET_POST","POST_MULTIWAY","RIVER_BLUFF_CATCH","OVERBET_RESPONSE","ICM_5_8","ICM_9_12","ICM_13_18","ICM_19_25","SB_LIMP_CALL","SB_LIMP_RAISE","CHECK_RAISE"]) assert.ok(keys.has(key), key);
});

test("pote de 4-bet usa nível pré-flop real", () => {
  const preset = EXPANSION_PRESETS.find((item) => item.key === "FOURBET_POST");
  assert.ok(matchesExpansionPreset({ street:"FLOP", context:"3BET_POT", preflopLevel:4, position:"BTN", participantCount:2 }, preset));
  assert.ok(!matchesExpansionPreset({ street:"FLOP", context:"3BET_POT", preflopLevel:3, position:"BTN", participantCount:2 }, preset));
});

test("heads-up é estrutura 2-max explícita", () => {
  const hu = entries.filter((entry) => entry.tableStructure === "HU_2MAX");
  assert.ok(hu.length > 0);
  assert.ok(hu.every((entry) => entry.rangeProfile === "HU" && entry.participantCount === 2));
});

test("PKO altera a exigência matemática somente quando há cobertura", () => {
  const spot = { callChips:1000, bb:100, bountyState:{ coversVillain:true, villainBountyBB:12, availableBounties:2 } };
  const adjusted = bountyDecisionAdjustment(spot, 35);
  assert.ok(adjusted.adjustedEquityRequired < 35);
  assert.ok(adjusted.knockoutValueBB > 0);
  assert.equal(bountyDecisionAdjustment({ ...spot, bountyState:{ ...spot.bountyState, coversVillain:false } }, 35).adjustedEquityRequired, 35);
});

test("filtros ICM respeitam exclusivamente o bucket real de stack", () => {
  for (const preset of EXPANSION_PRESETS.filter((item) => item.key.startsWith("ICM_"))) {
    assert.ok(matchesExpansionPreset({ street: "PRE-FLOP", stackRange: [...preset.stackRange] }, preset));
    assert.ok(!matchesExpansionPreset({ street: "PRE-FLOP", stackRange: [40, 60] }, preset));
    assert.ok(!matchesExpansionPreset({ street: "PRE-FLOP" }, preset));
  }
});

test("linhas sequenciais preservam ações anteriores", () => {
  const sequential = entries.filter((entry) => entry.lineKey);
  assert.ok(sequential.length > 0);
  assert.ok(sequential.every((entry) => Array.isArray(entry.actionHistory) && entry.actionHistory.length > 0));
  assert.ok(sequential.some((entry) => entry.street === "RIVER" && entry.actionHistory.length >= 3));
});

test("cold action, BB contra limpers e block bet são nós explícitos", () => {
  assert.ok(entries.some((entry) => entry.strategicNode === "BB_VS_LIMPERS"));
  assert.ok(entries.some((entry) => entry.strategicNode === "COLD_CALL_3BET"));
  assert.ok(entries.some((entry) => entry.strategicNode === "COLD_4BET"));
  const block = entries.filter((entry) => entry.strategicNode === "BLOCK_BET_RIVER");
  assert.deepEqual([...new Set(block.map((entry) => entry.blockBetSizing))].sort(), [0.2,0.25]);
});

test("fluxos aprovados permanecem no componente", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  for (const marker of ["reviewCurrentHand","advance(-1)","advance(1)","currentSpotIsLocked","sequenceReady"]) assert.match(source, new RegExp(marker.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(source, /toggleShotClock/);
  assert.match(source, /2: new Set\(\["SB", "BB"\]\)/);
});

test("treino específico usa 3 colunas, cor amarela uniforme (sem diferenciação de fundo por grupo) e só o título por card", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /ORDERED_TRAINING_PRESETS\.map/);
  assert.match(source, /className="grid grid-cols-3" style=\{\{ gap: 8 \}\}/);
  assert.match(source, /solid \$\{TRAINING_ESPECIFICO_COLOR\}/);
  assert.match(source, /const TRAINING_ESPECIFICO_COLOR = "#FACC15"/); // amarelo, igual aos outros painéis
  assert.doesNotMatch(source, /TRAINING_GROUP_BACKGROUNDS/); // diferenciação de fundo por grupo removida
  assert.doesNotMatch(source, />\{group\}<\/div>/);
  assert.match(source, /overflowWrap: "break-word"/); // texto quebra dentro do card, não transborda
});

test("hidratação e revisão de mão preservam todos os cliques", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /useState\("STACKUP-INITIAL"\)/);
  assert.doesNotMatch(source, /useState\(\(\) => Math\.floor\(Math\.random/);
  for (const marker of ["setReviewUnlockedSpotKey(currentSpotKey)", "setActionFlowEnabled(true)", "setActionPaused(false)", "setSequenceReady(true)"]) assert.match(source, new RegExp(marker.replace(/[()]/g, "\\$&")));
  assert.match(source, /window\.setTimeout\(\(\) => setActionStep\(0\), 220\)/);
});

test("título usa o mesmo ciano da borda e fundo translúcido", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /color: "#22D3EE", border: "2px solid #22D3EE", background: "rgba\(6,182,212,0\.18\)"/);
});

test("tipografia do aplicativo foi reduzida globalmente em um pixel", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /gap: 8, fontSize: 15/);
  assert.ok((source.match(/fontSize: 11/g) || []).length > 100);
  assert.doesNotMatch(source, /fontSize: 17/);
});

test("link compartilhado preserva a escala tipográfica móvel", () => {
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(layout, /width: "device-width"/);
  assert.match(layout, /initialScale: 1/);
  assert.match(css, /-webkit-text-size-adjust: 100%/);
  assert.match(css, /text-size-adjust: 100%/);
});

test("mesa móvel usa POT e board horizontais com dez jogadores em duas colunas", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /grid grid-cols-2 gap-2/);
  assert.match(source, /gridTemplateRows: "repeat\(5, minmax\(58px, auto\)\)"/);
  assert.match(source, /display: "flex", gap: 8, width: "100%"/);
  assert.match(source, /flex: 1, minWidth: 0, color: positionBadgeColor\(p\.pos\) \|\| seatColor\(p\)/);
  assert.match(source, /flex: 1, minWidth: 0, color: miniActionColor/);
  assert.match(source, /S \{fmtChips\(displayStackChips\)\} • \{displayStackBB\.toFixed\(1\)\} BB/);
  // A linha de aposta ("B ...") foi removida a pedido do usuário — cards de jogador mostram
  // só a linha de stack agora.
  assert.doesNotMatch(source, /B \$\{fmtChips\(actionChips\)\} · \$\{actionBB\} BB/);
  const clockwiseGrid = source.slice(source.indexOf("const clockwiseGrid = ["), source.indexOf("];", source.indexOf("const clockwiseGrid = [")));
  const visualOrder = [...clockwiseGrid.matchAll(/gridRow: (\d), gridColumn: (\d)/g)].map((match) => `${match[1]}-${match[2]}`);
  assert.deepEqual(visualOrder, ["1-1", "1-2", "2-2", "3-2", "4-2", "5-2", "5-1", "4-1", "3-1", "2-1"]);
  const controlsIndex = source.indexOf('onClick={beginActionSequence}');
  const potIndex = source.indexOf('>POT</div>', controlsIndex);
  const boardIndex = source.indexOf('{STREET_LABEL_PT[spot.street] || spot.street}</div>', potIndex);
  const heroCardsIndex = source.indexOf('<span style={{ color: "#FFF", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em" }}>HERÓI</span>', boardIndex);
  const mainPotIndex = source.indexOf('"MAIN POT"', potIndex);
  const playersIndex = source.indexOf('ref={playersSectionRef} className="grid grid-cols-2');
  // Ordem atual: INICIAR -> POT (só o total do pote atual, sem breakdown embutido) -> BOARD e
  // HERÓI na mesma linha (2/3 + 1/3, board na fonte antes do herói) -> card SHOVE POTS (main/side
  // pots detalhados, só em multi-shove, exclusivo desse card, sem duplicar no card POT) -> MESA.
  assert.ok(controlsIndex >= 0 && potIndex > controlsIndex && boardIndex > potIndex && heroCardsIndex > boardIndex && mainPotIndex > boardIndex && mainPotIndex < playersIndex && playersIndex > heroCardsIndex);
  assert.doesNotMatch(source, />AÇÃO<\/span>/);
  assert.doesNotMatch(source, /visibleActionTimeline/);
  assert.match(source, /\{fmtChips\(animatedPotChips\)\} • \{animatedPotBB\.toFixed\(1\)\} BB/);
  assert.doesNotMatch(source, />EFETIVO <\/span>/);
  assert.doesNotMatch(source, />MAIN POT <\/span>/);
  assert.match(source, /potIndex === 0 \? "MAIN POT" : `SIDE POT \$\{potIndex\}`/);
  assert.doesNotMatch(source, /VER RANGE 169/);
  assert.doesNotMatch(source, /rangePanelOpen/);
  assert.match(source, /<CardPip card=\{spot\.heroCards\[0\]\} hidden=\{!actionFlowEnabled\} \/>/);
  assert.match(source, /<CardPip card=\{spot\.heroCards\[1\]\} hidden=\{!actionFlowEnabled\} \/>/);
  assert.doesNotMatch(source, /p\.isHero \? <>\s*<CardPip card=\{p\.cards\[0\]\}/);
});

test("ações começam no primeiro jogador, terminam no herói e folds ficam opacos com som", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /const POSITIONS_ORDER = \["UTG","UTG1","MP","MP1","LJ","HJ","CO","BTN","SB","BB"\]/);
  assert.match(source, /const POSTFLOP_ACTION_ORDER = \["SB","BB","UTG","UTG1","MP","MP1","LJ","HJ","CO","BTN"\]/);
  assert.match(source, /buildActionTimeline\(spot\)\.filter\(\(event\) => allowedTablePositions\.has\(event\.pos\)\)/);
  assert.match(source, /if \(actionStep >= actionSequence\.length\)[\s\S]*?setSequenceReady\(true\)/);
  assert.match(source, /playActionSound\(actionSequence\[actionStep\]\.action\)/);
  assert.match(source, /normalized === "FOLD"/);
  assert.match(source, /if \(participants\.has\(pos\).*?add\(pos, "CHECK", 0\)/);
  assert.match(source, /if \(participants\.has\(pos\).*?add\(pos, "CALL", spot\.currentBet \/ spot\.bb\)/);
  assert.match(source, /foldedBeforeStreet = spot\.street !== "PRE-FLOP" && p\.isAtTable && !p\.isInvolved && !displayEvent/);
  assert.match(source, /displayEvent\?\.action \|\| \(foldedBeforeStreet \? "FOLD" : null\)/);
  assert.match(source, /folded \? 0\.5 : p\.isAtTable \? 1/);
});

test("ANTERIOR e PRÓXIMO posicionam a nova mão com o POT preso na borda superior", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /const boardSectionRef = useRef\(null\)/);
  assert.match(source, /const gameFocusRequestedRef = useRef\(false\)/);
  assert.match(source, /ref=\{boardSectionRef\}/);
  assert.match(source, /ref=\{potSectionRef\}/);
  assert.match(source, /potSectionRef\.current\?\.scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/);
  // Ambas as direções reposicionam agora — antes só PRÓXIMO (dir > 0) fazia isso.
  assert.doesNotMatch(source, /if \(dir > 0\) gameFocusRequestedRef\.current = true/);
  assert.match(source, /gameFocusRequestedRef\.current = true;\s*\};/);
  assert.match(source, /window\.requestAnimationFrame\(alignGameArea\)/);
  assert.match(source, /\}, 360\)/);
});

test("cada treino oferece no mínimo cinco mil variações aleatórias sem criar banco paralelo", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /const MIN_TRAINING_VARIATIONS = 5000/);
  assert.match(source, /Math\.max\(MIN_TRAINING_VARIATIONS, Number\(cfg\.trainingTarget \|\| 0\), bank\.length\)/);
  assert.match(source, /selectSessionVariation\(bank, cfg\)/);
  assert.match(source, /trainingVariation: \{ virtualIndex, variationIndex, virtualPoolLength, sourceId: entry\.id \}/);
  assert.match(source, /\|\$\{virtualIndex\}\|\$\{cfg\.sessionSeed\}/);
  assert.match(source, /const SPOTS_OPTIONS = \[200, 500, 1000, 1500, 2000\]/); // opções de sessão do usuário — não afeta o piso de 5000 variações do banco (MIN_TRAINING_VARIATIONS acima)
  assert.doesNotMatch(source, /GENERAL_SPOT_BANK\.push\(\.\.\.indexed,.*variation/s);
});

test("TREINO POR POSIÇÃO e ALEATÓRIO combinam cumulativamente com FASE e STREET", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  // Estado: as três dimensões começam em ALEATÓRIO por padrão.
  assert.match(source, /const \[fase, setFase\] = useState\("ALEATORIO"\)/);
  assert.match(source, /const \[heroPositionFilter, setHeroPositionFilter\] = useState\("ALEATORIO"\)/);
  // Fase ALEATÓRIO sorteia uma fase real determinística por spot (não existe fase "ALEATÓRIO" de
  // verdade no banco).
  assert.match(source, /if \(!faseKey \|\| faseKey === "ALEATORIO"\)/);
  // Filtro de posição existe, é cumulativo com fase/street, e tem fallback seguro (nunca trava
  // o treino numa combinação vazia).
  assert.match(source, /function filterBankByHeroPosition\(bank, positionFilter\)/);
  assert.match(source, /return filtered\.length \? filtered : bank;/);
  // O filtro de posição só se aplica no treino geral — um preset específico ativo combina
  // somente com a fase (posição e street ficam sem efeito na geração).
  assert.match(source, /if \(!cfg\.preset\) presetFiltered = filterBankByHeroPosition\(presetFiltered, cfg\.heroPositionFilter\);/g);
  // Card de UI existe com as 8 posições + ALEATÓRIO.
  assert.match(source, /const HERO_POSITION_FILTER_OPTIONS = \["ALEATORIO", "SB", "BB", "UTG", "MP", "HJ", "LJ", "CO", "BTN"\]/);
  assert.match(source, /TREINO POR POSIÇÃO/);
  // Histórico grava a fase de fato sorteada (nunca o literal "ALEATORIO").
  assert.match(source, /fase: spot\.faseCfg\?\.key \|\| cfg\.fase/);
});

test("banco geral é construído sob demanda (cache), não mais eager no carregamento do módulo", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  // Não existe mais um laço eager (fase x street) construindo as 36 combinações inteiras no
  // carregamento do módulo — cada combinação é calculada e cacheada na primeira vez que é
  // pedida (ver GENERAL_SPOT_CACHE / selectGeneralSpots), o que elimina o custo de pré-montar
  // ~783 mil registros antes da primeira tela ficar pronta.
  assert.match(source, /const GENERAL_SPOT_CACHE = \{\};/);
  assert.match(source, /function buildGeneralSpotEntries\(faseKey, streetKey\)/);
  assert.match(source, /if \(!GENERAL_SPOT_CACHE\[cacheKey\]\) GENERAL_SPOT_CACHE\[cacheKey\] = buildGeneralSpotEntries\(faseKey, streetKey\);/);
  assert.doesNotMatch(source, /const GENERAL_SPOT_BANK = \[\];/);
  assert.doesNotMatch(source, /const BANK_FASES = \[/);
  assert.doesNotMatch(source, /for \(const streetKey of \["PRE-FLOP", "FLOP", "TURN", "RIVER"\]\) \{\s*\n\s*let entries;/);
});

test("pós-flop cobre 3 tamanhos de aposta a mais (33%, 66%, ALL_IN) além dos 6 originais", () => {
  const source = fs.readFileSync(new URL("../app/Trainer.jsx", import.meta.url), "utf8");
  assert.match(source, /const POSTFLOP_SCENARIOS = \["CHECKED", "BET_25", "BET_33", "BET_50", "BET_66", "BET_75", "BET_100", "BET_150", "ALL_IN"\]/);
  assert.match(source, /const BET_FRACTION = \{ BET_25: 0\.25, BET_33: 0\.33, BET_50: 0\.5, BET_66: 0\.66, BET_75: 0\.75, BET_100: 1\.0, BET_150: 1\.5 \}/);
  // ALL_IN não usa a fração do pote: é sempre exatamente o stack efetivo do herói, não uma
  // fração — garante um shove de verdade independentemente do SPR da mão.
  assert.match(source, /if \(entry\.scenario === "ALL_IN"\) \{[\s\S]{0,200}currentBet = heroStack;/);
});
