/**
 * Carnet de recettes : serveur (Google Apps Script) de l'application web.
 *
 * L'application elle-même est hébergée sur GitHub Pages et appelle ce script en JSON.
 * Les recettes restent dans le Google Sheet « Carnet de recettes ».
 *
 * Réglages (Apps Script → ⚙️ Paramètres du projet → Propriétés du script) :
 *   CODE_FAMILLE : code demandé aux proches pour ajouter des recettes et commenter
 *   CODE_ADMIN   : ton code personnel (valider les recettes, noter dans tes colonnes)
 *   APP_URL      : adresse de l'application sur GitHub Pages (facultatif)
 */
const SPREADSHEET_ID = '1FLfsatHQr4wwzNCLAqnWh9dE6bwDSxVsFyIWarmvc1w';

// Colonnes de l'onglet Recettes (1 = A)
const C = {
  titre: 1, typeSource: 2, source: 3, lien: 4, portions: 5, unitePortions: 6,
  types: 7, aliments: 8, note: 9, premiere: 10, commentaires: 11, etapes: 12,
  origine: 13, photos: 14, ajoutee: 15, statut: 16, par: 17, saisons: 18
};
const NB_COL = 18;
const SAISONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
const A_VALIDER = 'À valider';
const ONGLET_COMMENTAIRES = 'Commentaires';

/* ---------------- Points d'entrée ---------------- */

function doGet(e) {
  if (e && e.parameter && e.parameter.action) return json_(handle_(e.parameter));
  const url = prop_('APP_URL');
  const html = url
    ? '<div style="font:18px sans-serif;padding:40px;text-align:center">Le carnet de recettes a une nouvelle adresse.<br><br>' +
      '<a href="' + url + '" target="_top" style="color:#c0562f;font-weight:bold">Ouvrir le carnet</a></div>'
    : '<div style="font:16px sans-serif;padding:40px">Carnet de recettes : serveur en ligne.</div>';
  return HtmlService.createHtmlOutput(html).setTitle('Carnet de recettes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Requête invalide.' }); }
  return json_(handle_(req));
}

function handle_(req) {
  try {
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error('Action inconnue.');
    return { ok: true, data: fn(req) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const ACTIONS = {
  data: req => { const r = role_(req.code); noterVisite_(req.auteur, r); return getData_(r); },
  role: req => ({ role: role_(req.code) }),
  addRecette: req => addRecette_(req),
  updateRecette: req => updateRecette_(req),
  addComment: req => addComment_(req),
  deleteComment: req => deleteComment_(req),
  saveAvis: req => saveAvis_(req),
  publish: req => publish_(req),
  deleteRecette: req => deleteRecette_(req)
};

/* ---------------- Droits ---------------- */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function role_(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const admin = prop_('CODE_ADMIN'), famille = prop_('CODE_FAMILLE');
  if (admin && code === admin) return 'admin';
  if (famille && code === famille) return 'famille';
  return null;
}

function exiger_(req, niveau) {
  if (!prop_('CODE_FAMILLE') || !prop_('CODE_ADMIN'))
    throw new Error('Les codes ne sont pas encore réglés dans Apps Script (propriétés CODE_FAMILLE et CODE_ADMIN).');
  const r = role_(req.code);
  if (!r) throw new Error('Code incorrect.');
  if (niveau === 'admin' && r !== 'admin') throw new Error('Action réservée au propriétaire du carnet.');
  return r;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- Lecture ---------------- */

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function getData_(role) {
  const ss = ss_();
  const rows = ss.getSheetByName('Recettes').getDataRange().getDisplayValues();
  const entetes = rows.shift();
  const recettes = rows
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({
      titre: String(r[0]).trim(), typeSource: r[1], source: r[2], lien: r[3],
      portions: r[4], unitePortions: r[5],
      types: splitList_(r[6]), aliments: splitList_(r[7]),
      note: r[8], premiere: r[9], commentaires: r[10],
      etapes: r[11], origine: r[12], photos: r[13], ajoutee: r[14],
      statut: String(r[15] || '').trim(), par: String(r[16] || '').trim(),
      saisons: String(r[17] || '').trim(),
      // colonnes ajoutées après R (ex. « Batch cooking ») : renvoyées par leur titre, sans modifier ce script
      x: entetes.slice(NB_COL).reduce((o, t, i) => { if (t && r[NB_COL + i]) o[String(t).trim()] = r[NB_COL + i]; return o; }, {})
    }))
    .filter(r => role === 'admin' || r.statut !== A_VALIDER);

  const ingRows = ss.getSheetByName('Ingrédients').getDataRange().getDisplayValues();
  ingRows.shift();
  const ingredients = {};
  ingRows.forEach(r => {
    const t = String(r[0]).trim();
    if (!t || !String(r[3]).trim()) return;
    (ingredients[t] = ingredients[t] || []).push({ q: r[1], u: r[2], n: r[3], rayon: r[6] || '' });
  });

  const lst = ss.getSheetByName('Listes').getDataRange().getDisplayValues();
  lst.shift();
  const unitesS = [], pluriels = {}, rayons = [], typesPlat = [], typesSource = [];
  lst.forEach(r => {
    if (r[2]) typesPlat.push(String(r[2]).trim());
    if (r[4]) typesSource.push(String(r[4]).trim());
    if (r[8]) unitesS.push(String(r[8]).trim());
    if (r[10] && r[11]) pluriels[String(r[10]).trim()] = String(r[11]).trim();
    if (r[13]) rayons.push(String(r[13]).trim());
  });

  const commentaires = [];
  const sc = ss.getSheetByName(ONGLET_COMMENTAIRES);
  if (sc && sc.getLastRow() > 1) {
    sc.getRange(2, 1, sc.getLastRow() - 1, 6).getDisplayValues().forEach(r => {
      if (r[0] && r[1]) commentaires.push({ id: r[0], titre: r[1], auteur: r[2], date: r[3], note: r[4], texte: r[5] });
    });
  }

  return { role, recettes, ingredients, unitesS, pluriels, rayons, typesPlat, typesSource, commentaires };
}

/* ---------------- Journal des visites ---------------- */
// Une ligne par personne et par jour dans l'onglet « Visites » : date, prénom, rôle, nombre d'ouvertures, dernière heure.
function noterVisite_(auteur, role) {
  try {
    const tz = Session.getScriptTimeZone() || 'Europe/Brussels';
    const now = new Date();
    const jour = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const heure = Utilities.formatDate(now, tz, 'HH:mm');
    const prenom = txt_(auteur, 40) || 'Anonyme';
    const roleTxt = role === 'admin' ? 'Propriétaire' : role === 'famille' ? 'Famille' : 'Lecture seule';
    withLock_(() => {
      const ss = ss_();
      let sv = ss.getSheetByName('Visites');
      if (!sv) {
        sv = ss.insertSheet('Visites');
        sv.getRange(1, 1, 1, 5).setValues([['Date', 'Prénom', 'Rôle', 'Ouvertures', 'Dernière ouverture']]).setFontWeight('bold');
        sv.setFrozenRows(1);
      }
      const n = sv.getLastRow();
      if (n > 1) {
        const debut = Math.max(2, n - 199);
        const v = sv.getRange(debut, 1, n - debut + 1, 4).getDisplayValues();
        for (let i = v.length - 1; i >= 0; i--) {
          if (v[i][0] !== jour) break;
          if (norm_(v[i][1]) === norm_(prenom)) {
            sv.getRange(debut + i, 3, 1, 3).setValues([[roleTxt, (parseInt(v[i][3], 10) || 0) + 1, "'" + heure]]);
            return;
          }
        }
      }
      sv.appendRow(["'" + jour, prenom, roleTxt, 1, "'" + heure]);   // apostrophe : gardé tel quel, pas converti en date
    });
  } catch (e) { /* le journal ne doit jamais empêcher l'app de charger */ }
}

/* ---------------- Écriture ---------------- */

function dateFr_() {
  const m = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const d = new Date();
  return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
}

const txt_ = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 500);
const norm_ = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Dernière ligne non vide de la colonne A (les colonnes calculées peuvent aller plus loin)
function lastRowA_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return 1;
  const v = sh.getRange(1, 1, n, 1).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim()) return i + 1;
  return 1;
}

function ensureRows_(sh, upTo) {
  if (sh.getMaxRows() < upTo) sh.insertRowsAfter(sh.getMaxRows(), upTo - sh.getMaxRows() + 50);
}

function findRecette_(sh, titre) {
  const n = lastRowA_(sh);
  if (n < 2) return -1;
  const v = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
  const t = String(titre).trim();
  const i = v.findIndex(x => String(x[0]).trim() === t);
  return i < 0 ? -1 : i + 2;
}

function addRecette_(req) {
  const role = exiger_(req, 'famille');
  const r = req.recette || {};
  const auteur = txt_(req.auteur, 40);
  if (!auteur) throw new Error('Indiquez votre prénom.');
  const titre = txt_(r.titre, 150);
  if (!titre) throw new Error('Le titre est obligatoire.');
  const ings = (r.ingredients || []).slice(0, 80)
    .map(i => ({ q: txt_(i.q, 20), u: txt_(i.u, 30), n: txt_(i.n, 120) }))
    .filter(i => i.n);
  if (!ings.length) throw new Error('Ajoutez au moins un ingrédient.');
  const etapes = txt_(r.etapes, 10000);
  if (!etapes) throw new Error('Ajoutez les étapes de préparation.');

  return withLock_(() => {
    const ss = ss_();
    const sh = ss.getSheetByName('Recettes');
    if (findRecette_(sh, titre) > 0) throw new Error('Une recette porte déjà ce titre : changez-le légèrement.');
    if (!sh.getRange(1, C.saisons).getDisplayValue()) sh.getRange(1, C.statut, 1, 3).setValues([['Statut', 'Ajoutée par', 'Saisons']]);

    const portions = parseInt(r.portions, 10);
    const ligne = new Array(NB_COL).fill('');
    ligne[C.titre - 1] = titre;
    ligne[C.typeSource - 1] = txt_(r.typeSource, 40);
    ligne[C.source - 1] = txt_(r.source, 300);
    ligne[C.lien - 1] = /^https?:\/\//i.test(txt_(r.lien)) ? txt_(r.lien, 500) : '';
    ligne[C.portions - 1] = portions >= 1 && portions <= 99 ? portions : '';
    ligne[C.unitePortions - 1] = txt_(r.unitePortions, 30) || 'personnes';
    ligne[C.types - 1] = (r.types || []).map(t => txt_(t, 40)).filter(Boolean).join(', ');
    ligne[C.aliments - 1] = txt_(r.aliments, 300);
    ligne[C.etapes - 1] = etapes;
    ligne[C.origine - 1] = txt_(r.origine, 20000);
    ligne[C.ajoutee - 1] = dateFr_();
    ligne[C.statut - 1] = role === 'admin' ? '' : A_VALIDER;
    ligne[C.par - 1] = auteur;
    ligne[C.saisons - 1] = saisonsTexte_(r.saisons);
    const row = lastRowA_(sh) + 1;
    ensureRows_(sh, row);
    sh.getRange(row, 1, 1, NB_COL).setValues([ligne]);
    if (r.batch) {
      const ent = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
      let col = ent.findIndex(t => String(t).trim() === 'Batch cooking') + 1;
      if (!col) { col = Math.max(sh.getLastColumn(), NB_COL) + 1; sh.getRange(1, col).setValue('Batch cooking'); }
      sh.getRange(row, col).setValue(txt_(r.batch, 2000));
    }

    // Ingrédients : rayon repris d'un ingrédient du même nom déjà présent, sinon « Autres »
    const si = ss.getSheetByName('Ingrédients');
    const last = lastRowA_(si);
    const rayonDe = {};
    if (last > 1) si.getRange(2, 1, last - 1, 7).getDisplayValues().forEach(x => {
      if (x[3] && x[6]) rayonDe[norm_(x[3])] = x[6];
    });
    const start = last + 1;
    ensureRows_(si, start + ings.length);
    si.getRange(start, 1, ings.length, 4).setValues(ings.map(i => {
      const q = String(i.q).replace(',', '.');
      return [titre, /^\d+(\.\d+)?$/.test(q) ? Number(q) : i.q, i.u, i.n];
    }));
    si.getRange(start, 7, ings.length, 1).setValues(ings.map(i => [rayonDe[norm_(i.n)] || 'Autres']));
    SpreadsheetApp.flush();
    return { titre, statut: ligne[C.statut - 1] };
  });
}

/**
 * Modifie une recette existante. Le propriétaire peut tout modifier ; un proche seulement
 * sa propre proposition encore « À valider ». Note, commentaires, statut et analyse batch sont conservés.
 * Les lignes d'ingrédients sont réécrites sur place (jamais supprimées, pour ne pas casser les formules du Sheet).
 */
function updateRecette_(req) {
  const role = exiger_(req, 'famille');
  const auteur = txt_(req.auteur, 40);
  const ancien = txt_(req.titreOriginal, 150);
  const r = req.recette || {};
  const titre = txt_(r.titre, 150);
  if (!titre) throw new Error('Le titre est obligatoire.');
  const ings = (r.ingredients || []).slice(0, 80)
    .map(i => ({ q: txt_(i.q, 20), u: txt_(i.u, 30), n: txt_(i.n, 120) }))
    .filter(i => i.n);
  if (!ings.length) throw new Error('Ajoutez au moins un ingrédient.');
  const etapes = txt_(r.etapes, 10000);
  if (!etapes) throw new Error('Ajoutez les étapes de préparation.');

  return withLock_(() => {
    const ss = ss_();
    const sh = ss.getSheetByName('Recettes');
    const row = findRecette_(sh, ancien);
    if (row < 0) throw new Error('Recette introuvable : ' + ancien);
    const cur = sh.getRange(row, 1, 1, NB_COL).getValues()[0];
    if (role !== 'admin') {
      if (String(cur[C.statut - 1]).trim() !== A_VALIDER) throw new Error('Cette recette est déjà publiée : seul le propriétaire du carnet peut la modifier.');
      if (norm_(cur[C.par - 1]) !== norm_(auteur)) throw new Error('Vous ne pouvez modifier que vos propres propositions.');
    }
    if (titre !== ancien && findRecette_(sh, titre) > 0) throw new Error('Une autre recette porte déjà ce titre.');

    const portions = parseInt(r.portions, 10);
    const maj = {
      titre: titre, typeSource: txt_(r.typeSource, 40), source: txt_(r.source, 300),
      lien: /^https?:\/\//i.test(txt_(r.lien)) ? txt_(r.lien, 500) : '',
      portions: portions >= 1 && portions <= 999 ? portions : '', unitePortions: txt_(r.unitePortions, 30) || 'personnes',
      types: (r.types || []).map(t => txt_(t, 40)).filter(Boolean).join(', '),
      aliments: txt_(r.aliments, 300), etapes: etapes, origine: txt_(r.origine, 20000), saisons: saisonsTexte_(r.saisons)
    };
    Object.keys(maj).forEach(k => { cur[C[k] - 1] = maj[k]; });
    sh.getRange(row, 1, 1, NB_COL).setValues([cur]);

    // Ingrédients : réécrits dans les lignes de l'ancienne recette, puis ajoutés à la suite si besoin
    const si = ss.getSheetByName('Ingrédients');
    const last = lastRowA_(si);
    const lignes = [], rayonDe = {}, rayonRecette = {};
    if (last > 1) si.getRange(2, 1, last - 1, 7).getDisplayValues().forEach((x, i) => {
      if (x[3] && x[6]) rayonDe[norm_(x[3])] = x[6];
      if (String(x[0]).trim() === ancien) { lignes.push(i + 2); if (x[3]) rayonRecette[norm_(x[3])] = x[6]; }
    });
    const valeur = i => { const q = String(i.q).replace(',', '.'); return /^\d+(\.\d+)?$/.test(q) ? Number(q) : i.q; };
    const rayon = i => rayonRecette[norm_(i.n)] || rayonDe[norm_(i.n)] || 'Autres';
    ings.forEach((i, k) => {
      let rr = lignes[k];
      if (!rr) { rr = lastRowA_(si) + 1; ensureRows_(si, rr); }
      si.getRange(rr, 1, 1, 4).setValues([[titre, valeur(i), i.u, i.n]]);
      si.getRange(rr, 7).setValue(rayon(i));
    });
    lignes.slice(ings.length).forEach(rr => { si.getRange(rr, 1, 1, 4).clearContent(); si.getRange(rr, 7).clearContent(); });

    // Commentaires : suivent le nouveau titre
    if (titre !== ancien) {
      const sc = ss.getSheetByName(ONGLET_COMMENTAIRES);
      if (sc && sc.getLastRow() > 1) {
        const v = sc.getRange(2, 2, sc.getLastRow() - 1, 1).getValues();
        v.forEach((x, i) => { if (String(x[0]).trim() === ancien) sc.getRange(i + 2, 2).setValue(titre); });
      }
    }
    SpreadsheetApp.flush();
    return { titre, statut: String(cur[C.statut - 1]).trim() };
  });
}

function commentSheet_(ss) {
  let sc = ss.getSheetByName(ONGLET_COMMENTAIRES);
  if (!sc) {
    sc = ss.insertSheet(ONGLET_COMMENTAIRES);
    sc.getRange(1, 1, 1, 6).setValues([['Id', 'Recette', 'Auteur', 'Date', 'Note (1 à 5)', 'Commentaire']]).setFontWeight('bold');
    sc.setFrozenRows(1);
    sc.setColumnWidth(2, 260); sc.setColumnWidth(6, 420);
  }
  return sc;
}

function addComment_(req) {
  exiger_(req, 'famille');
  const auteur = txt_(req.auteur, 40);
  if (!auteur) throw new Error('Indiquez votre prénom.');
  const titre = txt_(req.titre, 150);
  let note = parseInt(req.note, 10);
  note = note >= 1 && note <= 5 ? note : '';
  const texte = txt_(req.texte, 3000);
  if (!texte && !note) throw new Error('Le commentaire est vide.');
  return withLock_(() => {
    const ss = ss_();
    if (findRecette_(ss.getSheetByName('Recettes'), titre) < 0) throw new Error('Recette introuvable.');
    const sc = commentSheet_(ss);
    const c = { id: Utilities.getUuid().slice(0, 8), titre, auteur, date: dateFr_(), note: String(note), texte };
    sc.appendRow([c.id, c.titre, c.auteur, c.date, note, c.texte]);
    return c;
  });
}

function deleteComment_(req) {
  const role = exiger_(req, 'famille');
  return withLock_(() => {
    const sc = commentSheet_(ss_());
    const n = sc.getLastRow();
    if (n < 2) throw new Error('Commentaire introuvable.');
    const v = sc.getRange(2, 1, n - 1, 3).getDisplayValues();
    const i = v.findIndex(x => x[0] === String(req.id));
    if (i < 0) throw new Error('Commentaire introuvable.');
    if (role !== 'admin' && norm_(v[i][2]) !== norm_(req.auteur)) throw new Error('Vous ne pouvez supprimer que vos propres commentaires.');
    sc.deleteRow(i + 2);
    return { id: req.id };
  });
}

function saveAvis_(req) {
  exiger_(req, 'admin');
  const a = req.avis || {};
  return withLock_(() => {
    const sh = ss_().getSheetByName('Recettes');
    const row = findRecette_(sh, req.titre);
    if (row < 0) throw new Error('Recette introuvable.');
    let note = parseInt(a.note, 10);
    note = note >= 1 && note <= 5 ? note : '';
    const range = sh.getRange(row, C.note, 1, 3);
    range.setValues([[note, txt_(a.premiere, 60), txt_(a.commentaires, 5000)]]);
    SpreadsheetApp.flush();
    const v = range.getDisplayValues()[0];
    return { note: v[0], premiere: v[1], commentaires: v[2] };
  });
}

function publish_(req) {
  exiger_(req, 'admin');
  return withLock_(() => {
    const sh = ss_().getSheetByName('Recettes');
    const row = findRecette_(sh, req.titre);
    if (row < 0) throw new Error('Recette introuvable.');
    sh.getRange(row, C.statut).setValue('');
    return { titre: req.titre };
  });
}

function deleteRecette_(req) {
  exiger_(req, 'admin');
  return withLock_(() => {
    const ss = ss_();
    const sh = ss.getSheetByName('Recettes');
    const row = findRecette_(sh, req.titre);
    if (row < 0) throw new Error('Recette introuvable.');
    if (String(sh.getRange(row, C.statut).getDisplayValue()).trim() !== A_VALIDER)
      throw new Error('Seules les recettes « À valider » peuvent être supprimées depuis l\'app.');
    sh.deleteRow(row);
    const si = ss.getSheetByName('Ingrédients');
    const last = lastRowA_(si);
    if (last > 1) {
      const v = si.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim() === String(req.titre).trim()) si.deleteRow(i + 2);
    }
    return { titre: req.titre };
  });
}

// « Toutes saisons » si les quatre sont cochées, sinon la liste dans l'ordre de l'année
function saisonsTexte_(list) {
  const set = new Set((Array.isArray(list) ? list : String(list || '').split(','))
    .map(s => String(s).trim()).filter(s => SAISONS.includes(s) || s === 'Toutes saisons'));
  if (set.has('Toutes saisons') || SAISONS.every(s => set.has(s))) return 'Toutes saisons';
  return SAISONS.filter(s => set.has(s)).join(', ');
}

function splitList_(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}
