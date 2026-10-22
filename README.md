# €RAPH — gamification de la vraie vie

Site statique (un seul fichier `index.html`, aucune dépendance), en ligne sur https://eraph.vercel.app.
Ouvrir `index.html` dans un navigateur, ou le servir avec n'importe quel hébergeur statique.

- **Actions** : cocher les actions du jour, le total s'affiche en bas à droite, puis « Valider ».
- **Shop** : dépenser ses ℝ (une ligne par objet, triée par prix croissant), créer ou modifier des items
  (« Nouveau item » : lien du produit pour récupérer sa photo, ou photo envoyée) et suivre le relevé
  des créations et achats.
- **Prix des items** : le prix saisi en euros est arrondi à l'euro supérieur puis multiplié par
  C(p) = 1 + 1,3 (1 − 3t² + 2t³), avec t = min(1, max(0, (p − 1) / 99)) : 2,3 à 1 €, 1 dès 100 €,
  décroissance continue sans rupture de pente. Calcul exact (BigInt), arrondi au centime inférieur à la fin. `api/preview.js` va chercher l'image de la page (og:image, JSON-LD…),
  refuse le SVG et les adresses internes, et n'accepte que les appareils connectés.
- **Calendrier** : un rond par jour (plein = validé), un tiret pour les jours inexistants.
  Toucher un jour passé permet de le valider, le corriger ou le remettre à zéro.
- **Paramètres** : Banque Sabatier et liste d'actions (création : difficulté + impact × 0,1 ; suppression avec double confirmation).
- **Banque Sabatier** : reçoit les arrondis du porte-monnaie (automatiquement en fin de journée), 1 % d'intérêts par jour,
  reverse 20 ℝ au porte-monnaie dès qu'elle les dépasse, et absorbe d'abord les journées négatives.
- Les montants sont au centime, arrondis au centime inférieur.
- Dodo : minuit le premier jour, puis une minute plus tôt chaque jour, jusqu'à 22h30.
- Les cases se remettent à zéro chaque jour à minuit ; le porte-monnaie est conservé.

## Synchronisation entre appareils

Les données sont gardées sur l'appareil (`localStorage`) et synchronisées par `api/state.js`
(fonction Vercel) dans Redis (Upstash, via le Marketplace Vercel), avec les 60 dernières versions en sauvegarde.

- Variables d'environnement : `KV_REST_API_URL` et `KV_REST_API_TOKEN` (posées par l'intégration Upstash),
  `SYNC_CODE` (code de synchronisation, à garder secret).
- Connecter un appareil : ouvrir une fois `https://eraph.vercel.app/#sync=LE-CODE`,
  ou toucher « Non synchronisé · connecter » sous la date et saisir le code.
- Hors ligne, les changements restent sur l'appareil et partent au retour de la connexion.
