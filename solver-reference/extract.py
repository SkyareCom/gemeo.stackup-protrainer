"""
Extrator de referência do TexasSolver — lê cada árvore de estratégia solvada (JSON bruto,
10-24 MB cada) e resume nos números que interessam pra calibrar o motor do app: a frequência
REAL de fold/call/raise do range inteiro contra cada tamanho de aposta testado, comparada com
a previsão da fórmula de MDF que o buildPolicyActionEVs usa hoje.

Não lê nada do app nem grava nada nele ainda — só produz um resumo compacto (poucos KB por
cenário) a partir dos 238 MB de árvores brutas. O passo seguinte (calibrar/gravar no repo) usa
esse resumo, não os JSONs brutos.
"""
import json, os, re, glob

RANK_ORDER = "23456789TJQKA"
RANK_VALUE = {r: i for i, r in enumerate(RANK_ORDER)}

def expand_range(range_str):
    """Retorna dict combo_string -> peso, a partir de uma string tipo a do TexasSolver
    ("AA,KQs:0.5,AKo,..."). combo_string usa a MESMA convenção do JSON dumpado: carta de
    rank mais alto primeiro, formato RankSuit+RankSuit (ex: 'AcKd')."""
    weights = {}
    for token in range_str.split(","):
        token = token.strip()
        if not token:
            continue
        if ":" in token:
            notation, w = token.split(":")
            w = float(w)
        else:
            notation, w = token, 1.0
        if len(notation) == 2 and notation[0] == notation[1]:  # par, ex "AA"
            r = notation[0]
            suits = "cdhs"
            # convenção observada no dump do solver: suíte de índice MAIOR listada primeiro
            # (ex: "9d9c", "9h9c", "9h9d" — nunca "9c9d") — índices de suits = [c,d,h,s].
            for i in range(4):
                for j in range(i):
                    combo = f"{r}{suits[i]}{r}{suits[j]}"
                    weights[combo] = w
        else:
            r1, r2 = notation[0], notation[1]
            # "AK" (2 chars, ranks diferentes, sem sufixo) = as duas formas, suited E offsuit —
            # convenção padrão de notação de range (bug corrigido: antes um token de 2 chars sem
            # sufixo caía no ramo de par acima e usava só notation[0], descartando notation[1]).
            kinds = [notation[2]] if len(notation) == 3 else ["s", "o"]
            # normaliza pra rank mais alto primeiro (convenção do dump)
            if RANK_VALUE[r1] < RANK_VALUE[r2]:
                r1, r2 = r2, r1
            suits = "cdhs"
            for kind in kinds:
                if kind == "s":
                    for s in suits:
                        combo = f"{r1}{s}{r2}{s}"
                        weights[combo] = w
                else:  # "o"
                    for s1 in suits:
                        for s2 in suits:
                            if s1 == s2:
                                continue
                            combo = f"{r1}{s1}{r2}{s2}"
                            weights[combo] = w
    return weights


def weighted_action_freqs(node, range_weights):
    """Média ponderada (pelos pesos do range original) da distribuição de ação de um nó,
    só sobre os combos que de fato aparecem no nó (o solver já removeu os bloqueados pelo
    board). Retorna dict action_label -> frequência agregada (soma 1)."""
    actions = node["strategy"]["actions"]
    combos = node["strategy"]["strategy"]
    totals = [0.0] * len(actions)
    total_weight = 0.0
    missing = 0
    for combo, probs in combos.items():
        w = range_weights.get(combo)
        if w is None:
            missing += 1
            w = 1.0  # combo não encontrado no range original (não deveria acontecer) — trata como peso 1
        for i, p in enumerate(probs):
            totals[i] += p * w
        total_weight += w
    if total_weight == 0:
        return {a: 0.0 for a in actions}, missing
    return {a: totals[i] / total_weight for i, a in enumerate(actions)}, missing


def mdf_predicted_fold(pot, bet):
    return 1 - pot / (pot + bet)


SRP_RANGE_IP = "AA,KK,QQ,JJ,TT,99:0.75,88:0.75,77:0.5,66:0.25,55:0.25,AK,AQs,AQo:0.75,AJs,AJo:0.5,ATs:0.75,A6s:0.25,A5s:0.75,A4s:0.75,A3s:0.5,A2s:0.5,KQs,KQo:0.5,KJs,KTs:0.75,K5s:0.25,K4s:0.25,QJs:0.75,QTs:0.75,Q9s:0.5,JTs:0.75,J9s:0.75,J8s:0.75,T9s:0.75,T8s:0.75,T7s:0.75,98s:0.75,97s:0.75,96s:0.5,87s:0.75,86s:0.5,85s:0.5,76s:0.75,75s:0.5,65s:0.75,64s:0.5,54s:0.75,53s:0.5,43s:0.5"
SRP_RANGE_OOP = "QQ:0.5,JJ:0.75,TT,99,88,77,66,55,44,33,22,AKo:0.25,AQs,AQo:0.75,AJs,AJo:0.75,ATs,ATo:0.75,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQ,KJ,KTs,KTo:0.5,K9s,K8s,K7s,K6s,K5s,K4s:0.5,K3s:0.5,K2s:0.5,QJ,QTs,Q9s,Q8s,Q7s,JTs,JTo:0.5,J9s,J8s,T9s,T8s,T7s,98s,97s,96s,87s,86s,76s,75s,65s,64s,54s,53s,43s"
THREEBET_RANGE_IP = "AA,KK,QQ,JJ,TT,99,88,77,AKs,AKo,AQs,AQo:0.5,AJs:0.75,ATs:0.5,KQs,KJs:0.5,QJs:0.5,JTs:0.5,A5s,A4s,A3s,A2s:0.5"
THREEBET_RANGE_OOP = "QQ,JJ,TT,99,88:0.5,77:0.25,AKs,AKo,AQs:0.75,AQo:0.5,AJs:0.5,KQs:0.5,A5s:0.5,A4s:0.25"

SCENARIO_META = {}
for texture in ["dry", "wet", "paired", "mono"]:
    for spr in ["shallow", "medium", "deep"]:
        SCENARIO_META[f"srp_{texture}_{spr}"] = ("srp", texture, spr)
        SCENARIO_META[f"threebet_{texture}_{spr}"] = ("threebet", texture, spr)
# lote piloto usou nomes sem prefixo "srp_"
for texture in ["dry", "wet", "paired"]:
    for spr in ["shallow", "deep"]:
        SCENARIO_META[f"{texture}_{spr}"] = ("srp", texture, spr)

POT = 100.0

def main():
    out_dir = "/tmp/texassolver-batch/outputs"
    results = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        key = os.path.basename(path)[:-5]
        pot_type, texture, spr = SCENARIO_META[key]
        range_ip, range_oop = (SRP_RANGE_IP, SRP_RANGE_OOP) if pot_type == "srp" else (THREEBET_RANGE_IP, THREEBET_RANGE_OOP)
        ip_weights = expand_range(range_ip)
        oop_weights = expand_range(range_oop)

        with open(path) as f:
            root = json.load(f)

        root_freqs, root_missing = weighted_action_freqs(root, oop_weights)

        bet_results = {}
        for action_label, child in root["childrens"].items():
            if not action_label.startswith("BET"):
                continue
            bet_amount = float(action_label.split()[1])
            freqs, missing = weighted_action_freqs(child, ip_weights)
            fold_real = freqs.get("FOLD", 0.0)
            fold_pred = mdf_predicted_fold(POT, bet_amount)
            bet_results[bet_amount] = {
                "solver_fold": fold_real,
                "solver_call": freqs.get("CALL", 0.0),
                "solver_raise": sum(v for a, v in freqs.items() if a.startswith("RAISE")),
                "mdf_predicted_fold": fold_pred,
                "missing_combos": missing,
                "num_combos": len(child["strategy"]["strategy"]),
            }

        results.append({
            "key": key, "pot_type": pot_type, "texture": texture, "spr": spr,
            "root_action_freqs": root_freqs, "root_missing_combos": root_missing,
            "bet_size_response": bet_results,
        })

    with open("/tmp/texassolver-batch/extracted_summary.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"extracted {len(results)} scenarios")
    return results


if __name__ == "__main__":
    main()
