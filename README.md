# Bitcoin Valuation Index

[![Update valuation data](https://github.com/timothekintgen1-oss/btc-valuation-index/actions/workflows/update-data.yml/badge.svg)](https://github.com/timothekintgen1-oss/btc-valuation-index/actions/workflows/update-data.yml)
![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

**Tableau de bord en ligne : https://timothekintgen1-oss.github.io/btc-valuation-index/**

Un indice composite qui mesure si le Bitcoin est cher ou bon marché par rapport à son propre historique. Il agrège 14 indicateurs (on-chain, techniques et de sentiment) en un seul score, recalculé automatiquement plusieurs fois par jour.

Je l'utilise pour piloter mon propre investissement : un achat de Bitcoin chaque semaine, dont le montant augmente quand l'indice est bas et diminue quand il est haut.

> Projet personnel, non commercial. Ce n'est pas un conseil en investissement.

---

## Méthode

1. **Orientation.** Chaque indicateur est orienté pour qu'une valeur haute signifie « marché cher ».
2. **Standardisation.** Chaque indicateur devient un z-score glissant sur 6 ans, calculé uniquement avec les données passées.
3. **Agrégation.** Le composite est la moyenne à poids égaux des indicateurs disponibles, standardisée à son tour de la même façon. Des sous-scores par catégorie (fondamental, technique, sentiment) sont conservés pour l'affichage.

Les poids sont égaux volontairement : les optimiser sur l'historique reviendrait à ajuster l'indice au passé.

**Aucune donnée future.** À chaque date, le score n'utilise que les données disponibles ce jour-là, y compris pour la régression du power law, recalculée chaque jour sur le passé. Des tests unitaires le vérifient (voir [Tests](#tests)). Seule exception : le Rainbow Chart, dont les coefficients publiés ont été ajustés après coup.

### Lecture

| Z-score | Zone | Risque (loi normale) |
|---|---|---|
| < −2 | Extreme Buy | < 2 % |
| −2 à −1 | Undervalued | 2 à 16 % |
| −1 à +1 | Fair Value | 16 à 84 % |
| +1 à +2 | Elevated | 84 à 98 % |
| +2 à +3 | Overvalued | 98 à 99,9 % |
| ≥ +3 | Extreme Sell | > 99,9 % |

Le « risque » affiché est la fonction de répartition de la loi normale appliquée au z-score : un risque bas signifie un marché plutôt bon marché. C'est un risque de valorisation, pas une allocation.

## Les 14 indicateurs

| Indicateur | Catégorie | Ce qu'il mesure | Source |
|---|---|---|---|
| MVRV Z-Score | Fondamental | Capitalisation de marché / capitalisation réalisée (prix moyen d'acquisition du réseau) | Coin Metrics |
| AVIV Ratio | Fondamental | Variante du MVRV fondée sur la capitalisation active et la capitalisation investie | BGeometrics |
| Thermocap Multiple | Fondamental | Capitalisation / émission minière cumulée (hors frais) | Coin Metrics |
| NUPL | Fondamental | Part de la capitalisation en plus-value latente | Coin Metrics |
| RHODL Ratio | Fondamental | Poids des pièces récentes face aux pièces anciennes | BGeometrics |
| CVDD → Terminal Price | Fondamental | Position du prix entre un plancher (CVDD) et un plafond (Terminal Price), en log | BGeometrics |
| STH-SOPR (7 j) | Fondamental | Profit réalisé par les détenteurs de court terme | BGeometrics |
| Power Law Oscillator | Technique | Écart du prix à une loi de puissance dans le temps | Coin Metrics |
| Rolling 52W Sharpe | Technique | Rendement / volatilité sur un an glissant | Coin Metrics |
| Monthly RSI (14) | Technique | RSI de Wilder sur clôtures mensuelles | Coin Metrics |
| Days Higher Than Price | Technique | Part des jours passés où le prix était plus haut qu'aujourd'hui | Coin Metrics |
| BEAM | Technique | Prix / moyenne mobile 200 semaines | Coin Metrics |
| Rainbow Chart | Technique | Écart à la régression logarithmique du Rainbow Chart | Coin Metrics |
| Fear & Greed (7 j) | Sentiment | Indice de sentiment, de la peur à l'avidité | alternative.me |

Le choix des indicateurs suit ma grille de DCA pondéré (« SDCA »). Les indicateurs eux-mêmes sont des mesures publiques, créées par leurs auteurs respectifs ; ce dépôt les recalcule à partir des données brutes et les combine.

## Fonctionnement

```
GitHub Actions (toutes les 4 h)
  ├─ tests unitaires
  ├─ scripts/build_index.py   récupère les données, calcule les 14 indicateurs et le composite → data.json
  ├─ scripts/zone_alert.py    ouvre une issue GitHub si l'indice change de zone
  └─ commit de data.json      (uniquement si les données ont changé)

GitHub Pages
  └─ index.html               lit data.json et trace les graphiques (Chart.js)
```

- **Données gratuites** : Coin Metrics Community API (prix, MVRV, émission), BGeometrics (AVIV, RHODL, STH-SOPR, CVDD, Terminal Price), alternative.me (Fear & Greed).
- **Cache** : les séries externes sont stockées dans `data/cache/`. Leur historique continue de s'allonger alors que les offres gratuites ne renvoient qu'une fenêtre limitée, et une requête en échec ne bloque pas la mise à jour.
- **Données en retard** : BGeometrics publie avec environ 7 jours de décalage ; la dernière valeur est reportée au plus 10 jours, et la page affiche la date de chaque indicateur.
- **Aucune dépendance** : uniquement la bibliothèque standard de Python.

## Backtest intégré

La page compare, depuis l'année choisie, quatre façons d'acheter chaque semaine :

| Stratégie | Règle |
|---|---|
| DCA | 100 $ par semaine |
| SDCA | 100 $ × (1 − Z), plafonné à 300 $ et jamais négatif : 300 $ à Z ≤ −2, 100 $ à Z = 0, rien à partir de Z = 1 |
| SDCA + prise de profit | mêmes achats, et vente de 5 % des BTC détenus chaque semaine tant que Z ≥ 2 (10 % si Z ≥ 3) |
| Zones de risque | 200 $ en zone d'achat, 100 $ en accumulation, rien en zone d'allègement, vente de 2 % par semaine en zone de vente |

Frais et fiscalité ne sont pas pris en compte.

## Redondance et pondération : ce que j'ai testé

Beaucoup d'indicateurs mesurent au fond la même chose : la position du prix par rapport à son historique. Sur leurs z-scores, 18 paires ont une corrélation supérieure à 0,85 (par exemple MVRV et NUPL : 0,95, ce qui est logique puisque NUPL = 1 − 1/MVRV). Le composite est donc moins diversifié que ses 14 composantes ne le laissent penser.

J'ai comparé l'indice publié à trois variantes : sans NUPL, à poids égaux par catégorie, et les deux combinés (`scripts/analyze_variants.py`).

| | Publié | Sans NUPL | Par catégorie | Par catégorie, sans NUPL |
|---|---|---|---|---|
| Sommet 2017 | +2,42 | +2,44 | +2,49 | +2,64 |
| Creux 2022 | −2,42 | −2,35 | −2,21 | −2,13 |
| Sommet nov. 2021 | +1,05 | +1,04 | +1,07 | +1,06 |
| Sommet oct. 2025 | +0,74 | +0,75 | +0,62 | +0,61 |
| SDCA depuis 2019 (valeur / investi) | ×4,59 | ×4,56 | ×4,11 | ×4,09 |
| SDCA depuis 2021 | ×2,29 | ×2,29 | ×2,19 | ×2,18 |

Conclusions :

- **Retirer NUPL ne change presque rien** : la redondance n'est pas portée par un indicateur en particulier, elle est générale.
- **Pondérer par catégorie dégrade le backtest** : le Fear & Greed, seul indicateur de sentiment, pèserait alors un tiers du score.
- **Aucune variante ne signale les sommets de 2021 et 2025 comme extrêmes.** La cause n'est pas la pondération : les cycles du Bitcoin sont de moins en moins amples, et chaque date est comparée aux six années précédentes.

Je garde donc la pondération actuelle. Je n'ai pas modifié l'indice pour qu'il « voie » le sommet de 2025 : tout réglage choisi pour cela serait calibré sur un événement déjà connu, sans moyen de le valider hors échantillon.

## Limites

- Les séries BGeometrics ne remontent qu'à 2022 environ et le Fear & Greed à 2018 : avant ces dates, le composite repose sur moins d'indicateurs (9 avant 2018).
- Le Rainbow Chart utilise des coefficients ajustés après coup.
- Un indice de valorisation dit si le prix est cher, pas quand il va se retourner : un marché « bon marché » peut le rester longtemps.
- Les sommets de 2021 et 2025 n'ont pas été signalés comme extrêmes (voir ci-dessus).
- Démarrée en 2017, la règle SDCA fait moins bien qu'un DCA classique : l'indice était déjà élevé début 2017 et elle achetait peu avant la hausse.
- Les backtests ignorent les frais, les impôts et le glissement de prix.

## Lancer en local

```bash
python3 scripts/build_index.py              # reconstruit data.json
python3 -m unittest discover -s tests -v    # lance les tests
python3 -m http.server 8000                 # puis ouvrir http://localhost:8000
```

## Tests

`tests/test_index.py` vérifie notamment que modifier les données futures ne change aucune valeur passée (z-score glissant et régression du power law), ainsi que les fonctions de calcul (moyenne mobile, RSI mensuel, report des données en retard, zones). Les tests tournent avant chaque mise à jour automatique : si l'un échoue, les données publiées ne sont pas modifiées.

## Licence

Code sous licence [MIT](LICENSE). Les données restent soumises aux conditions de leurs fournisseurs (Coin Metrics Community Data : CC BY-NC 4.0).
