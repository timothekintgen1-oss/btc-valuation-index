# Bitcoin Valuation Index

[![Update valuation data](https://github.com/timothekintgen1-oss/btc-valuation-index/actions/workflows/update-data.yml/badge.svg)](https://github.com/timothekintgen1-oss/btc-valuation-index/actions/workflows/update-data.yml)
![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

**Tableau de bord en ligne : https://timothekintgen1-oss.github.io/btc-valuation-index/**

Un tableau de bord qui mesure si le Bitcoin est cher ou bon marché par rapport à son propre historique, et qui traduit cette lecture en un plan d'achat et de vente quotidien. Il réunit :

- **le BVI**, un indice composite de 16 indicateurs (on-chain, techniques, sentiment), sans aucune donnée future ;
- **le modèle SDCA** de l'application « BTC Strategic Dollar Cost Averaging Signal » d'Investing Campus, reproduit à l'identique, et sa **version causale** ;
- **un planificateur DCA** : une courbe d'accumulation / distribution que l'on dessine, son backtest, un optimiseur testé hors échantillon et l'action du jour.

Tout est recalculé automatiquement plusieurs fois par jour.

> Projet personnel, non commercial. Ce n'est pas un conseil en investissement.

---

## La page

| Onglet | Contenu |
|---|---|
| **Overview** | Jauge, zones, comparaison des trois modèles, risque composite avec mini-carte de navigation, prix coloré par le Z, Z-score, heatmap de tous les indicateurs. Zoom synchronisé sur tous les graphiques. |
| **Quantile Rainbow** | Le modèle de prix RAQQR : bandes de 1 % à 99 % sur tout l'historique, prolongées jusqu'à fin 2030, et prix de chaque quantile aujourd'hui et en fin d'année. |
| **DCA Plan** | Action du jour selon ta réserve de cash et tes BTC, courbe éditable à la souris, backtest quotidien (contre achat unique et DCA classique), optimiseur walk-forward, stratégies hebdomadaires. |
| **Indicators** | Valeur de chaque indicateur (convention « valorisation » ou « fiche SDCA »), sélection des indicateurs du composite (recalculé dans le navigateur), matrice de corrélation, export CSV, méthode. |
| **Cycles** | Les quatre cycles de halving superposés : multiple de prix, Z, risque SDCA et drawdown au même jour du cycle. |

En haut de page : le prix en direct (Coinbase) et sa position dans l'arc-en-ciel quantile, les lectures des modèles et l'action du jour de ton plan. Les réglages (sélection, courbe, réserve de cash) restent dans le navigateur.

## Méthode du BVI

1. **Orientation.** Chaque indicateur est orienté pour qu'une valeur haute signifie « marché cher ».
2. **Standardisation.** Chaque indicateur devient un z-score glissant sur 6 ans, calculé uniquement avec les données passées.
3. **Agrégation.** Le composite est la moyenne à poids égaux des indicateurs disponibles, standardisée à son tour de la même façon. Des sous-scores par catégorie (fondamental, technique, sentiment) sont conservés pour l'affichage.

Les poids sont égaux volontairement : les optimiser sur l'historique reviendrait à ajuster l'indice au passé.

**Aucune donnée future.** À chaque date, le score n'utilise que les données disponibles ce jour-là, y compris pour la régression du power law, recalculée chaque jour sur le passé. Des tests unitaires le vérifient (voir [Tests](#tests)). Exceptions signalées sur la page par le badge **HS** : le Rainbow Chart et l'arc-en-ciel quantile (coefficients publiés, ajustés après coup), le composite on-chain de ChartInspect et le Sharpe du P/L réalisé (rangs percentiles calculés sur tout l'historique).

### Lecture

| Z-score | Zone | Risque (loi normale) |
|---|---|---|
| < −2 | Extreme Buy | < 2 % |
| −2 à −1 | Undervalued | 2 à 16 % |
| −1 à +1 | Fair Value | 16 à 84 % |
| +1 à +2 | Elevated | 84 à 98 % |
| +2 à +3 | Overvalued | 98 à 99,9 % |
| ≥ +3 | Extreme Sell | > 99,9 % |

Le « risque » du BVI est la fonction de répartition de la loi normale appliquée au z-score : un risque bas signifie un marché plutôt bon marché. C'est un risque de valorisation, pas une allocation.

## Les indicateurs

| Indicateur | Catégorie | Ce qu'il mesure | Source |
|---|---|---|---|
| MVRV Z-Score | Fondamental | Capitalisation de marché / capitalisation réalisée (prix moyen d'acquisition du réseau) | Coin Metrics |
| AVIV Ratio | Fondamental | Variante du MVRV fondée sur la capitalisation active et la capitalisation investie | BGeometrics |
| Thermocap Multiple | Fondamental | Capitalisation / émission minière cumulée (hors frais) | Coin Metrics |
| NUPL | Fondamental | Part de la capitalisation en plus-value latente | Coin Metrics |
| RHODL Ratio | Fondamental | Poids des pièces récentes face aux pièces anciennes | BGeometrics |
| CVDD → Terminal Price | Fondamental | Position du prix entre un plancher (CVDD) et un plafond (Terminal Price), en log | BGeometrics |
| STH-SOPR (7 j) | Fondamental | Profit réalisé par les détenteurs de court terme | BGeometrics |
| Cost Basis P/L Ratio | Fondamental | Profit latent total / perte latente totale (EMA 7 j, z-score robuste sur fenêtre croissante) | ChartInspect, via l'app SDCA |
| On-chain Risk Composite | Fondamental | Moyenne pondérée des rangs percentiles de 8 mesures on-chain (MVRV, NUPL, Puell…) | ChartInspect, via l'app SDCA |
| *Realized P/L Sharpe* | Fondamental | Sharpe du P/L réalisé (EMA 14 j, rang percentile) — **optionnel** | ChartInspect, via l'app SDCA |
| Power Law Oscillator | Technique | Écart du prix à une loi de puissance dans le temps | Coin Metrics |
| Rolling 52W Sharpe | Technique | Rendement / volatilité sur un an glissant | Coin Metrics |
| Monthly RSI (14) | Technique | RSI de Wilder sur clôtures mensuelles | Coin Metrics |
| Days Higher Than Price | Technique | Part des jours passés où le prix était plus haut qu'aujourd'hui | Coin Metrics |
| BEAM | Technique | Prix / moyenne mobile 200 semaines | Coin Metrics |
| Rainbow Chart | Technique | Écart à la régression logarithmique du Rainbow Chart | Coin Metrics |
| *Quantile Rainbow (RAQQR)* | Technique | Position du prix dans le modèle quantile du SDCA — **optionnel** | Coefficients Cowen (2026) |
| Fear & Greed (7 j) | Sentiment | Indice de sentiment, de la peur à l'avidité | alternative.me |

Les deux indicateurs optionnels sont publiés et sélectionnables sur la page, mais restent hors du composite par défaut : ils sont mis à l'échelle avec tout l'historique.

Le choix des indicateurs suit ma grille de DCA pondéré (« SDCA »). Les indicateurs eux-mêmes sont des mesures publiques, créées par leurs auteurs respectifs ; ce dépôt les recalcule ou les reprend et les combine.

## Trois modèles

| Modèle | Construction | Sans donnée future ? |
|---|---|---|
| **BVI** | Ce dépôt : 16 indicateurs, z-scores glissants sur 6 ans, poids égaux | Oui (hors exceptions HS) |
| **SDCA** | L'app d'Investing Campus, reproduite à l'identique : moyenne de trois piliers bornés à ±3 — position du prix dans le modèle quantile RAQQR, Cost Basis P/L, On-chain Risk Composite. Risque = 50 − Z/3 × 50. | Non : les coefficients RAQQR ont été ajustés sur 2010-2026 |
| **SDCA, version causale** | Le même modèle, avec le pilier prix remplacé par le résidu du power law calculé sur le passé (z-score sur fenêtre croissante) | Oui pour le prix |
| **Consensus** | Moyenne des risques BVI et SDCA | Non |

La reproduction est vérifiée par les tests : 1,96 de Z et 17,3 % de risque le 23/11/2026, −2,55 au sommet de novembre 2021, comme l'application.

### Aux sommets et aux creux (risque, 0-100 %)

| Moment | BVI | SDCA | Version causale |
|---|---|---|---|
| Sommet déc. 2017 | 99 % | 97 % | 94 % |
| Creux déc. 2018 | 4 % | 16 % | 22 % |
| Sommet nov. 2021 | 86 % | 92 % | 83 % |
| Creux nov. 2022 | 1 % | 10 % | 20 % |
| Sommet oct. 2025 | 80 % | 90 % | 84 % |
| 23/11/2026 | 8 % | 17 % | 28 % |

Le modèle SDCA lit mieux les sommets de 2021 et 2025, que le BVI sous-estime (voir [Limites](#limites)). Ses piliers on-chain, et surtout le Cost Basis P/L, ne s'affaiblissent pas d'un cycle à l'autre ; son modèle de prix, lui, a appris la forme de ces cycles après coup.

## Plan DCA : courbe d'accumulation / distribution

Chaque jour, le risque du signal choisi est lu sur une courbe : au-dessus de 0, on achète ce pourcentage de la réserve de cash ; en dessous, on vend ce pourcentage des BTC détenus. C'est la mécanique de l'application SDCA, avec sa courbe par défaut (10 %/jour du cash sous 15 % de risque, 5 % à 20 %, rien entre 25 et 80 %, puis vente de 0,5 à 10 %/jour de 85 à 100 %).

**Backtest de la courbe par défaut, 10 000 $ au départ** (valeur au 24/11/2026, perte maximale entre parenthèses) :

| Départ | Achat unique | DCA classique | SDCA | SDCA causal | BVI | Consensus |
|---|---|---|---|---|---|---|
| 2015 | 1 899 443 $ (−84 %) | 337 127 $ (−78 %) | 20 583 446 $ (−61 %) | 7 899 128 $ (−51 %) | 385 137 $ (−67 %) | 4 164 790 $ (−61 %) |
| 2018 | 44 406 $ (−81 %) | 36 515 $ (−67 %) | 492 572 $ (−61 %) | 228 326 $ (−49 %) | 68 383 $ (−67 %) | 205 791 $ (−61 %) |
| 2020 | 83 383 $ (−77 %) | 20 540 $ (−52 %) | 205 408 $ (−32 %) | 36 324 $ (−42 %) | 42 598 $ (−67 %) | 108 349 $ (−46 %) |
| 2022 | 12 572 $ (−67 %) | 13 969 $ (−50 %) | 42 764 $ (−32 %) | 36 181 $ (−42 %) | 12 507 $ (−67 %) | 24 765 $ (−46 %) |

Ce que j'en retiens :

- **Le recul gonfle fortement le modèle SDCA.** Sans son modèle de prix ajusté après coup, la version causale garde un net avantage depuis 2015, 2018 et 2022, mais fait moins bien que l'achat unique en partant de 2020.
- **Le BVI pilote mal cette courbe** : avec la loi normale, il passe 29 % du temps au-dessus de 75 % de risque (contre 13 % pour le modèle SDCA) et vend donc trop souvent. Pour le BVI, les stratégies hebdomadaires (onglet DCA, en bas) sont plus adaptées.
- **L'optimiseur ne bat pas la courbe par défaut hors échantillon.** Optimisée sur 2018-2020 puis testée sur 2021-2026 : 29 917 $ contre 42 764 $ pour la courbe par défaut avec le signal SDCA, 29 136 $ contre 36 181 $ avec la version causale. Les deux restent devant l'achat unique (20 350 $) et le DCA classique (13 837 $) sur cette période. La meilleure courbe du passé n'est pas la meilleure courbe de l'avenir.

## Fonctionnement

```
GitHub Actions (toutes les 4 h, + déclencheur sur mon Mac)
  ├─ tests unitaires Python
  ├─ scripts/build_index.py   récupère les données, calcule les indicateurs, le BVI et les modèles SDCA → data.json
  ├─ tests unitaires JavaScript (le calcul côté page doit concorder avec le nouveau data.json)
  ├─ scripts/zone_alert.py    ouvre une issue GitHub si le BVI change de zone
  └─ commit de data.json      (uniquement si les données ont changé)

GitHub Pages
  ├─ index.html, assets/app.css
  └─ assets/js/               core.js (calculs, testé) + un module par onglet (Chart.js)
```

- **Données gratuites** : Coin Metrics Community API (prix, MVRV, émission), BGeometrics (AVIV, RHODL, STH-SOPR, CVDD, Terminal Price), alternative.me (Fear & Greed), et les trois séries on-chain de ChartInspect intégrées à la page publique de l'application SDCA.
- **Cache** : les séries externes sont stockées dans `data/cache/`. Leur historique continue de s'allonger alors que les offres gratuites ne renvoient qu'une fenêtre limitée, et une requête en échec ne bloque pas la mise à jour.
- **Données en retard** : BGeometrics publie avec environ 7 jours de décalage ; la dernière valeur est reportée au plus 10 jours, et la page affiche la date de chaque indicateur.
- **Aucune dépendance** : la bibliothèque standard de Python, et Node.js uniquement pour les tests JavaScript.

## Redondance et pondération : ce que j'ai testé

Beaucoup d'indicateurs mesurent au fond la même chose : la position du prix par rapport à son historique. Sur leurs z-scores, 22 paires ont une corrélation supérieure à 0,85 (par exemple MVRV et NUPL : 0,95, ce qui est logique puisque NUPL = 1 − 1/MVRV ; MVRV et le composite on-chain : 0,94). La matrice de corrélation de la page estime qu'avec une corrélation moyenne de 0,67, les 16 indicateurs valent **environ deux signaux indépendants**.

J'ai comparé l'indice publié à trois variantes : sans NUPL, à poids égaux par catégorie, et les deux combinés (`scripts/analyze_variants.py`).

| | Publié (16) | Sans NUPL | Par catégorie | Par catégorie, sans NUPL |
|---|---|---|---|---|
| Sommet 2017 | +2,33 | +2,35 | +2,32 | +2,35 |
| Creux 2022 | −2,28 | −2,21 | −2,05 | −1,97 |
| Sommet nov. 2021 | +1,10 | +1,10 | +1,08 | +1,08 |
| Sommet oct. 2025 | +0,84 | +0,86 | +0,70 | +0,71 |
| SDCA depuis 2019 (valeur / investi) | ×3,60 | ×3,59 | ×3,23 | ×3,22 |
| SDCA depuis 2021 | ×1,80 | ×1,79 | ×1,71 | ×1,71 |

Conclusions :

- **Retirer NUPL ne change presque rien** : la redondance n'est pas portée par un indicateur en particulier, elle est générale.
- **Pondérer par catégorie dégrade le backtest** : le Fear & Greed, seul indicateur de sentiment, pèserait alors un tiers du score.
- **Ajouter le Cost Basis P/L et le composite on-chain aide un peu aux sommets** (novembre 2021 : +1,05 → +1,10 ; octobre 2025 : +0,74 → +0,84), mais pas assez : avec la re-standardisation sur 6 ans, chaque nouvel indicateur pèse peu.

Je garde donc des poids égaux. Je n'ai pas modifié la méthode du BVI pour qu'il « voie » le sommet de 2025 : tout réglage choisi pour cela serait calibré sur un événement déjà connu. Le modèle SDCA, affiché à côté, joue ce rôle de deuxième lecture, avec ses propres biais.

## Limites

- Les séries BGeometrics ne remontent qu'à 2022 environ et le Fear & Greed à 2018 : avant ces dates, le composite repose sur moins d'indicateurs.
- Le Rainbow Chart et le modèle quantile RAQQR utilisent des coefficients ajustés après coup ; les backtests du modèle SDCA en profitent (voir plus haut).
- Les séries ChartInspect viennent de la page publique de l'application SDCA. Si elle change ou disparaît, la mise à jour continue avec le cache, et ces séries cessent d'avancer.
- Un indice de valorisation dit si le prix est cher, pas quand il va se retourner : un marché « bon marché » peut le rester longtemps.
- Les sommets de 2021 et 2025 n'ont pas été signalés comme extrêmes par le BVI (voir ci-dessus).
- Démarrée en 2017, la règle SDCA hebdomadaire fait moins bien qu'un DCA classique : l'indice était déjà élevé début 2017 et elle achetait peu avant la hausse.
- Les backtests ignorent les frais, les impôts et le glissement de prix.

## Lancer en local

```bash
python3 scripts/build_index.py              # reconstruit data.json
python3 -m unittest discover -s tests -v    # tests Python
npm test                                    # tests JavaScript (Node.js, aucune dépendance)
python3 -m http.server 8000                 # puis ouvrir http://localhost:8000
```

## Tests

- `tests/test_index.py` vérifie que modifier les données futures ne change aucune valeur passée (z-score glissant, régression du power law, z-score sur fenêtre croissante), les fonctions de calcul (moyenne mobile, RSI mensuel, report des données en retard, zones), la lecture des séries de l'application SDCA, et la reproduction de son modèle (niveaux RAQQR et composite aux dates de contrôle).
- `tests/js/core.test.js` vérifie que les calculs de la page concordent avec le pipeline Python et avec l'application SDCA (risque 17,3 %, achat de 7,68 % du cash le 23/11/2026), ainsi que les simulations, la courbe paramétrique et l'optimiseur.

Les tests Python tournent avant chaque mise à jour automatique, les tests JavaScript après la reconstruction : si l'un échoue, les données publiées ne sont pas modifiées.

## Licence

Code sous licence [MIT](LICENSE). Les données restent soumises aux conditions de leurs fournisseurs (Coin Metrics Community Data : CC BY-NC 4.0 ; BGeometrics et ChartInspect : usage personnel). Le modèle SDCA et sa courbe par défaut sont ceux de l'application d'Investing Campus ; les coefficients RAQQR sont ceux publiés par Cowen (2026).
