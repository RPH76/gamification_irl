# €RAPH — gamification de la vraie vie

Site statique (un seul fichier `index.html`, aucune dépendance), en ligne sur https://eraph.vercel.app.
Ouvrir `index.html` dans un navigateur, ou le servir avec n'importe quel hébergeur statique.

- **Actions** : cocher les actions du jour, le total s'affiche en bas à droite, puis « Valider ».
- **Shop** : dépenser ses ℝ (une ligne par objet, triée par prix croissant).
- **Calendrier** : un rond par jour (plein = validé), un tiret pour les jours inexistants.
- **Banque Sabatier** : reçoit les arrondis du porte-monnaie, 1 % d'intérêts par jour,
  reverse 20 ℝ au porte-monnaie dès qu'elle les dépasse, et absorbe d'abord les journées négatives.
- Les montants sont au centime, arrondis au centime inférieur.
- Dodo : minuit le premier jour, puis une minute plus tôt chaque jour, jusqu'à 22h30.
- Les cases se remettent à zéro chaque jour à minuit ; le porte-monnaie est conservé
  (stocké dans le navigateur, `localStorage`).
