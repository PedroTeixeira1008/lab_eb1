# Painel das aulas práticas · EB I

Painel interativo para explorar os dados das práticas de Engenharia de Bioprocessos I (FES e cinética bacteriana). Os dados **não ficam no repositório**: a página lê a planilha pública `dados_labs_eb1` quando se clica em **Atualizar dados**.

## Abas

| Aba | O que mostra |
|---|---|
| Biorreator | Séries temporais de X, OD, pH, qO₂, temperatura e agitação no mesmo eixo de tempo, com hover unificado. Mostra também o pulso de OUR (curva de queda do OD) e a comparação do X do biorreator com os Erlenmeyers das equipes. |
| Cinética · estatística | μmax e tg por equipe: barra (média), barra de erro (DP/EP/IC 95 %), frascos e colchetes de significância para qualquer par escolhido. O biorreator aparece como referência (n = 1, sem teste). |
| FES · estatística | Atividade amilolítica, proteína (com LQ) e atividade específica, no mesmo formato. |
| Metodologia | Explicação do experimento, do fluxo de dados e da análise estatística, mais os parâmetros em vigor na planilha. |
| Dados | As tabelas lidas, com download em CSV. |

## De onde vêm os dados

A página consulta estas abas da planilha (geradas por fórmula, em formato longo):

- `para_html_grupos`: equipes, condição experimental (coluna `condicao`, editável) e se há dados
- `para_html_curvas`: X por equipe × frasco × coleta, fase exponencial, descartes
- `para_html_bio`: registro do biorreator (T, pH, OD, rpm, ar, X, OUR, qO₂)
- `para_html_pulsos`: OD ao longo de cada pulso de interrupção do ar
- `para_html_valores`: um valor por frasco para μmax, tg, AA, proteína e AE
- `para_html_stats`: teste t (Student e Welch) para todos os pares de equipes
- `para_html_descartes`: lista editável de pontos a descartar (equipes ≠ 3 e 6)
- `parametros`: constantes (α, LQ etc.)

Se uma coluna for renomeada, o painel avisa no topo da página. As abas `para_html_*` podem ficar ocultas na planilha.

## Detalhes técnicos

- HTML + JS puro, sem build. Gráficos com [Plotly.js](https://plotly.com/javascript/).
- Leitura pelo endpoint público `gviz/tq` do Google Sheets (a planilha precisa estar como "qualquer pessoa com o link pode ver").
- A última leitura fica em cache no navegador, então a página abre com dados mesmo sem internet. **Atualizar dados** busca a versão atual.
- O estado da tela (aba, grupos, pares marcados) fica no endereço da página: dá para mandar o link de uma visualização específica.
- Para trocar de planilha, edite `CONFIG.sheetId` no topo de `app.js`.

## Publicação (GitHub Pages)

Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
