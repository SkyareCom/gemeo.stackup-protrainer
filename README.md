# STACKUP HOLD'EM

Aplicativo de treinamento de No-Limit Hold'em com cenários pré-flop e pós-flop, filtros de treino específico, simulação de ações, relógio, revisão de mãos e análise estratégica.

Este repositório corresponde à versão 100 publicada em:

https://nlh-trainer-pro-one-teste.celsomurakami.chatgpt.site

## Requisitos

- Node.js 22.13 ou superior
- npm
- Linux/WSL para os scripts de build atuais

## Instalação e execução

```bash
npm ci
npm run dev
```

## Validação

```bash
node --test tests/*.test.mjs
npm run build
```

## Estrutura principal

- `app/Trainer.jsx`: interface, fluxo de treinamento, animações e motor de decisão.
- `app/strategicExpansion.js`: expansão estratégica e assinaturas canônicas.
- `tests/`: testes de regressão e integridade.
- `db/`: estrutura preparada para persistência.
- `worker/`: entrada do runtime de produção.
- `.openai/hosting.json`: configuração da hospedagem atual.

## Regras essenciais do produto

- Existe um único banco geral de spots.
- Fases e treinos específicos são filtros desse banco, não bancos paralelos.
- Um novo registro exige ausência comprovada por assinatura estratégica canônica.
- IDs, seeds, naipes irrelevantes ou pequenas alterações de fichas não representam conhecimento estratégico novo.
- A decisão correta não pode depender da frequência ou distribuição dos registros armazenados.
- Alterações devem preservar botões legais, pote, side pots, stacks, apostas, relógio, navegação e revisão de mão.

Leia `AGENTS.md` antes de permitir que uma IA altere o projeto e `CONTRIBUTING.md` antes de abrir uma contribuição.

## Estado de validação

- 18 testes automatizados aprovados na versão 100.
- Build de produção aprovado.
