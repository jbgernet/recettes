'use strict';
/* Carnet de recettes — application web (GitHub Pages) */

const CFG = window.CONFIG || {};
const OWNER = CFG.OWNER_NAME || 'le propriétaire';
const A_VALIDER = 'À valider';
const JOURS = [['lun', 'Lundi'], ['mar', 'Mardi'], ['mer', 'Mercredi'], ['jeu', 'Jeudi'], ['ven', 'Vendredi'], ['sam', 'Samedi'], ['dim', 'Dimanche'], ['', 'Sans jour']];
const jourNom = j => (JOURS.find(x => x[0] === j) || JOURS[7])[1];

/* ---------- Stockage local (propre à chaque téléphone) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('cr_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cr_' + k, JSON.stringify(v)); } catch (e) {} }
};
let DATA = store.get('data', null);
let profil = store.get('profil', { prenom: '', code: '', role: null });
let perso = store.get('perso', { fav: [], tester: [] });
let menu = store.get('menu', []);            // [{id, titre, portions, jour}]
let produits = store.get('produits', []);    // [{nom, rayon}]
let coches = store.get('coches', []);
let stock = store.get('stock', ['sel', 'poivre', 'eau', "huile d'olive"]);
let propositions = store.get('propositions', []);
let timers = store.get('timers', []);        // [{id, label, end, fini}]
let brouillon = store.get('brouillon', null);
let frigoItems = store.get('frigo', []);            // ce que j'ai sous la main (onglet 🧺)
let cuisine = store.get('cuisine', null);           // recette en cours : étape du pas à pas, cases cochées, portions

const S = {
  view: 'list', q: '', type: '', filtre: 'toutes', sort: 'az', frigo: false, frigoQ: '',
  open: null, portions: null, done: {}, wake: true, pas: null, confirm: null,
  avisDirty: false, comNote: 0, busy: false
};

/* ---------- Utilitaires ---------- */
const $ = id => document.getElementById(id);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").trim();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = s => { const n = parseFloat(String(s == null ? '' : s).replace(',', '.')); return isNaN(n) ? null : n; };
const plat = s => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();   // recherche sans accents ni ponctuation
const uid = () => Math.random().toString(36).slice(2, 10);
const rec = t => DATA && DATA.recettes.find(r => r.titre === t);
const isAdmin = () => profil.role === 'admin';
const canWrite = () => profil.role === 'admin' || profil.role === 'famille';
const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

function toast(t, ms) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = t;
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.textContent = ''; }, ms || 3500);
}

function dateFr(d) {
  const m = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  d = d || new Date(); return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
}
function parseDate(s) {
  const mois = { janv: 0, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, aout: 7, sept: 8, oct: 9, nov: 10, dec: 11 };
  const m = norm(s).match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
  if (m && mois[m[2]] != null) return new Date(+m[3], mois[m[2]], +m[1]).getTime();
  const m2 = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1]).getTime();
  return 0;
}

/* ---------- Quantités et pluriels ---------- */
const FRACS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
function parseQty(s) {
  s = String(s || '').trim().replace(',', '.');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+)?\s*([½¼¾⅓⅔])$/))) return { a: (+m[1] || 0) + FRACS[m[2]] };
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return { a: +m[1] + m[2] / m[3] };
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return { a: m[1] / m[2] };
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|à)\s*(\d+(?:\.\d+)?)$/))) return { a: +m[1], b: +m[2] };
  if (/^\d*\.?\d+$/.test(s)) return { a: +s };
  return { raw: s };
}
function fmt(x) {
  if (Math.abs(x - Math.round(x)) < 0.05) return String(Math.round(x));
  const fr = [[0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1 / 3, '⅓'], [2 / 3, '⅔']];
  const ent = Math.floor(x), dec = x - ent;
  if (x < 5) for (const [v, c] of fr) if (Math.abs(dec - v) < 0.04) return (ent ? ent + ' ' : '') + c;
  const r = x < 10 ? Math.round(x * 10) / 10 : Math.round(x);
  return String(r).replace('.', ',');
}
const H_ASPIRE = ['haricot', 'hareng', 'homard', 'hachis', 'houmous'];
function de(nom) {
  const n = norm(nom);
  if (H_ASPIRE.some(h => n.startsWith(h))) return 'de ';
  return /^[aeiouyh]/.test(n) ? "d'" : 'de ';
}
// Pluriel simple du premier mot (« poireau » → « poireaux », « pomme de terre » → « pommes de terre »)
function pluriel(nom) {
  return nom.replace(/^([^\s(,]+)/, w => /[sxz]$/i.test(w) ? w : /(eau|au|eu)$/i.test(w) ? w + 'x' : w + 's');
}
const UNITES_MOTS = ['gousse', 'tranche', 'pincée', 'brin', 'feuille', 'verre', 'tasse', 'sachet', 'boîte', 'bouquet', 'botte', 'branche', 'noisette', 'poignée', 'pot', 'cube', 'tablette', 'filet', 'bâton', 'brique', 'bol', 'tête', 'boule'];
function formatLine(qtxt, val, unite, nom) {
  unite = String(unite || '').trim(); nom = String(nom || '').trim();
  const plur = val >= 2;
  if (unite) {
    if (plur && unite === 'morceau') unite = 'morceaux';
    else if (plur && (DATA.unitesS.includes(unite) || UNITES_MOTS.includes(unite))) unite += 's';
    return (qtxt ? '<b>' + esc(qtxt) + ' ' + esc(unite) + '</b> ' + esc(de(nom)) : '') + esc(nom);
  }
  if (plur) nom = DATA.pluriels[nom] || (Object.values(DATA.pluriels).includes(nom) ? nom : pluriel(nom));
  return (qtxt ? '<b>' + esc(qtxt) + '</b> ' : '') + esc(nom);
}
function ligne(ing, ratio) {
  const p = parseQty(ing.q);
  let qtxt = '', val = 0;
  if (p && p.raw) { qtxt = p.raw; val = 1; }
  else if (p && p.b != null) { qtxt = fmt(p.a * ratio) + ' à ' + fmt(p.b * ratio); val = p.b * ratio; }
  else if (p) { qtxt = fmt(p.a * ratio); val = p.a * ratio; }
  return formatLine(qtxt, val, ing.u, ing.n);
}
const stars = (n, cls) => { n = Math.round(num(n) || 0); return n ? '<span class="stars ' + (cls || '') + '">' + '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) + '</span>' : ''; };

/* ---------- Saisons ---------- */
const SAISONS = [['Printemps', '🌸'], ['Été', '☀️'], ['Automne', '🍂'], ['Hiver', '❄️']];
const NOMS_SAISONS = SAISONS.map(x => x[0]);
function saisonsDe(r) {
  const s = norm(r && r.saisons);
  if (!s) return [];
  if (s.includes('toute')) return NOMS_SAISONS.slice();
  return NOMS_SAISONS.filter(x => s.includes(norm(x)));
}
function saisonActuelle() {
  const m = new Date().getMonth();
  return m >= 2 && m <= 4 ? 'Printemps' : m >= 5 && m <= 7 ? 'Été' : m >= 8 && m <= 10 ? 'Automne' : 'Hiver';
}
const emoji = s => (SAISONS.find(x => x[0] === s) || [])[1] || '';
function saisonsCourt(r) {
  const l = saisonsDe(r);
  if (!l.length) return '';
  return l.length === 4 ? 'Toutes saisons' : l.map(emoji).join('');
}
function saisonsTexte(list) {
  if (list.includes('Toutes saisons') || NOMS_SAISONS.every(s => list.includes(s))) return 'Toutes saisons';
  return NOMS_SAISONS.filter(s => list.includes(s)).join(', ');
}

// Produits de saison (France, Belgique) : sert à proposer les saisons d'une recette saisie à la main
const P = 'Printemps', E = 'Été', A = 'Automne', H = 'Hiver';
const SAISON_PRODUITS = [
  [['asperge', 'petit pois', 'petits pois', 'feve', 'radis', 'rhubarbe', 'ail des ours', 'oignon nouveau', 'cresson', 'morille'], [P]],
  [['fraise', 'artichaut'], [P, E]],
  [['epinard', 'pousse d\'epinard'], [P, A]],
  [['tomate', 'tomate cerise', 'courgette', 'aubergine', 'poivron', 'concombre', 'haricot vert', 'mais', 'melon', 'pasteque', 'peche', 'abricot', 'nectarine', 'cerise', 'framboise', 'myrtille', 'groseille', 'cassis', 'mure', 'basilic', 'mirabelle', 'fleur de courgette'], [E]],
  [['figue', 'prune', 'quetsche', 'blette', 'fenouil', 'brocoli', 'girolle'], [E, A]],
  [['potiron', 'citrouille', 'champignon', 'cepe', 'raisin', 'coing', 'noix', 'kaki', 'noisette fraiche'], [A]],
  [['courge', 'butternut', 'potimarron', 'chataigne', 'marron', 'poire', 'pomme', 'betterave', 'panais', 'topinambour', 'celeri-rave', 'celeri rave', 'chou', 'chou-fleur', 'chou de bruxelles', 'choux de bruxelles', 'chou rouge', 'chou kale', 'kale', 'poireau', 'radicchio', 'chicoree', 'endive', 'patate douce', 'navet', 'grenade', 'canneberge'], [A, H]],
  [['rutabaga', 'salsifis', 'mache', 'orange', 'clementine', 'mandarine', 'pamplemousse', 'kiwi', 'cardon', 'crosne'], [H]]
];
const HORS_SAISON = /(conserve|boite|surgel|seche|concentre|coulis|passata|sauce tomate|puree de tomate|confiture|compote|jus|sirop|en poudre|deshydrat|pomme de terre|pommes de terre|noix de coco|noix de cajou|noix de muscade|noix de pecan|lait de coco|fleur d'oranger|zeste)/;
function suggestionSaisons(ings) {
  const score = { [P]: 0, [E]: 0, [A]: 0, [H]: 0 };
  const vus = [];
  ings.forEach(i => {
    const n = norm(i.n);
    if (!n || HORS_SAISON.test(n) || norm(i.u) === 'boite') return;
    for (const [mots, saisons] of SAISON_PRODUITS) {
      const m = mots.find(w => new RegExp('(^|[^a-z])' + w.replace(/[-]/g, '\\-') + '(s|x)?($|[^a-z])').test(n));
      if (m) { saisons.forEach(s => score[s] += 1 / saisons.length); vus.push(i.n); break; }
    }
  });
  const max = Math.max(...Object.values(score));
  if (!max) return { saisons: [], vus };
  return { saisons: NOMS_SAISONS.filter(s => score[s] >= max * 0.6), vus };
}

/* ---------- Analyse d'une liste d'ingrédients collée (sans IA) ---------- */
const UNITES = [
  ['c. à soupe', ['cuilleres a soupe', 'cuillere a soupe', 'cuil. a soupe', 'c. a soupe', 'c.a soupe', 'c a soupe', 'cas', 'c.s.', 'cs', 'tbsp']],
  ['c. à café', ['cuilleres a cafe', 'cuillere a cafe', 'cuil. a cafe', 'c. a cafe', 'c.a cafe', 'c a cafe', 'cac', 'c.c.', 'cc', 'tsp']],
  ['kg', ['kg', 'kilos', 'kilo']], ['g', ['grammes', 'gramme', 'gr', 'g']], ['mg', ['mg']],
  ['l', ['litres', 'litre', 'l']], ['dl', ['dl']], ['cl', ['cl']], ['ml', ['ml']],
  ['gousse', ['gousses', 'gousse']], ['tranche', ['tranches', 'tranche']], ['pincée', ['pincees', 'pincee']],
  ['brin', ['brins', 'brin']], ['feuille', ['feuilles', 'feuille']], ['verre', ['verres', 'verre']],
  ['tasse', ['tasses', 'tasse']], ['sachet', ['sachets', 'sachet']], ['boîte', ['boites', 'boite']],
  ['bouquet', ['bouquets', 'bouquet']], ['morceau', ['morceaux', 'morceau']], ['botte', ['bottes', 'botte']],
  ['branche', ['branches', 'branche']], ['noisette', ['noisettes', 'noisette']], ['poignée', ['poignees', 'poignee']],
  ['pot', ['pots', 'pot']], ['cube', ['cubes', 'cube']], ['tablette', ['tablettes', 'tablette']],
  ['filet', ['filets', 'filet']], ['bâton', ['batons', 'baton']], ['brique', ['briques', 'brique']], ['bol', ['bols', 'bol']]
];
const UNITES_FLAT = UNITES.flatMap(([u, vs]) => vs.map(v => [v, u])).sort((a, b) => b[0].length - a[0].length);

function parseIngredientLine(line) {
  let s = String(line).replace(/^[\s\-–—•*·▪●◦>]+/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let q = '';
  const mq = s.match(/^(\d+\s+\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔]|\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*(?:-|à)\s*\d+(?:[.,]\d+)?)?|[½¼¾⅓⅔])/);
  if (mq) {
    const p = parseQty(mq[1].replace(/\s+/g, ' '));
    if (p && p.raw == null) q = p.b != null ? mq[1].replace(',', '.').replace(/\s+/g, ' ') : String(Math.round(p.a * 1000) / 1000);
    s = s.slice(mq[1].length).trim();
  }
  let u = '';
  if (q) {
    const ns = norm(s);
    for (const [v, unite] of UNITES_FLAT) {
      if (ns.startsWith(v) && (ns.length === v.length || /[\s.'’]/.test(ns[v.length]) || /^(g|kg|ml|cl|l|dl|mg)$/.test(v) && /\s/.test(ns[v.length] || ' '))) {
        // garde « 2 gousses », évite de prendre le début d'un mot (« l » de « lait »)
        if (v.length === 1 && ns[1] && ns[1] !== ' ') continue;
        u = unite; s = s.slice(v.length).replace(/^\.?\s*/, ''); break;
      }
    }
    s = s.replace(/^(de |d'|d’|des |du )/i, '');
  }
  let n = s.trim().replace(/[.;,]$/, '');
  if (!n) return null;
  if (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(n)) n = n[0].toLowerCase() + n.slice(1);
  // « 3 carottes » → « carotte » si le singulier est connu (onglet Listes)
  if (!u && num(q) >= 2 && DATA) {
    const sing = Object.keys(DATA.pluriels).find(k => DATA.pluriels[k] === n);
    if (sing) n = sing;
  }
  return { q, u, n };
}

/* ---------- Serveur (Google Apps Script) ---------- */
async function api(action, payload) {
  if (!CFG.API_URL || /COLLER/.test(CFG.API_URL)) throw new Error('Adresse du serveur non configurée (config.js).');
  const body = Object.assign({ action, code: profil.code, auteur: profil.prenom }, payload || {});
  const res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  if (!res.ok) throw new Error('Serveur injoignable (' + res.status + ').');
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Erreur du serveur.');
  return j.data;
}

let lastRefresh = 0, refreshing = false;
async function refresh(force) {
  if (refreshing || (!force && Date.now() - lastRefresh < 20000)) return;
  refreshing = true;
  try {
    const d = await api('data');
    lastRefresh = Date.now();
    if (profil.code && d.role !== profil.role) { profil.role = d.role; store.set('profil', profil); }
    DATA = d; store.set('data', d);
    const avant = propositions.length;
    propositions = propositions.filter(p => !d.recettes.some(r => r.titre === p.titre && r.statut !== A_VALIDER));
    if (propositions.length !== avant) { store.set('propositions', propositions); toast('Une de vos recettes a été validée 🎉'); }
    if (S.view === 'recipe' && !rec(S.open)) S.view = 'list';
    if (!isBusy()) renderKeep();
  } catch (e) {
    if (!DATA) $('app').innerHTML = '<div class="loading">Impossible de charger les recettes.<br><br>' + esc(e.message) + '<br><br><button class="btn ghost" data-act="retry">Réessayer</button></div>';
    else if (force) toast('Hors connexion : dernière version enregistrée affichée.');
  } finally { refreshing = false; }
}

function isBusy() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  return S.view === 'add' || S.avisDirty || S.busy || !!$('modal').innerHTML || !!S.pas;
}

/* ---------- Recette en cours (survit à la sortie de l'app) ---------- */
function saveCuisine() {
  if (S.view !== 'recipe' || !S.open) return;
  const garde = cuisine && cuisine.titre === S.open ? cuisine.i : null;
  cuisine = { titre: S.open, i: S.pas ? S.pas.i : garde, ouvert: !!S.pas, portions: S.portions, done: S.done, ts: Date.now() };
  store.set('cuisine', cuisine);
}
let cuisineRestauree = false;
function restaurerCuisine() {
  if (cuisineRestauree || !DATA) return;
  cuisineRestauree = true;
  if (!cuisine || !rec(cuisine.titre)) return;
  const age = Date.now() - cuisine.ts;
  if (cuisine.ouvert && cuisine.i != null && age < 12 * 3600e3) {
    go('recipe', { titre: cuisine.titre });
    S.pas = { i: Math.min(cuisine.i, Math.max(0, etapesDe(rec(cuisine.titre)).etapes.length - 1)) };
    history.pushState({ view: 'recipe', titre: S.open, pas: true }, '');
    renderPas(); wake();
    toast('Reprise du pas à pas : étape ' + (S.pas.i + 1));
  } else if (age < 3 * 3600e3) go('recipe', { titre: cuisine.titre });
}

/* ---------- Navigation ---------- */
function go(view, opts) {
  opts = opts || {};
  closeModal();
  S.view = view; S.confirm = null;
  if (view === 'recipe') {
    S.open = opts.titre;
    const r = rec(S.open), m = menu.find(x => x.titre === S.open);
    S.portions = (m && num(m.portions)) || num(r.portions);
    S.done = {}; S.avisDirty = false; S.comNote = 0;
    if (cuisine && cuisine.titre === S.open && Date.now() - cuisine.ts < 12 * 3600e3) {
      S.done = cuisine.done || {};
      if (num(cuisine.portions)) S.portions = num(cuisine.portions);
    }
  }
  if (opts.push !== false) history.pushState({ view, titre: opts.titre || null }, '');
  render(); $('app').scrollTop = 0; wake();
  if (view === 'list' || view === 'courses') refresh();
}
window.addEventListener('popstate', e => {
  const s = e.state || { view: 'list' };
  if (S.pas) { S.pas = null; renderPasClose(); saveCuisine(); }
  closeModal();
  if (s.view === 'recipe' && rec(s.titre)) go('recipe', { titre: s.titre, push: false });
  else go(s.view || 'list', { push: false });
});

function render() {
  if (!DATA) return;
  const nbCourses = menu.length + produits.length;
  const nbValider = isAdmin() ? DATA.recettes.filter(r => r.statut === A_VALIDER).length : 0;
  $('tabs').innerHTML = [
    ['list', '📖', 'Recettes', nbValider],
    ['frigo', '🧺', "J'ai…", 0],
    ['add', '➕', 'Ajouter', 0],
    ['courses', '🛒', 'Courses', nbCourses],
    ['moi', '👤', profil.prenom ? esc(profil.prenom) : 'Moi', 0]
  ].map(([v, i, l, n]) => `<button data-act="tab" data-v="${v}" class="${S.view === v || (S.view === 'recipe' && v === 'list') ? 'on' : ''}"><b>${i}</b>${l}${n ? ' <span class="badge">' + n + '</span>' : ''}</button>`).join('');
  ({ list: renderList, recipe: renderRecipe, frigo: renderFrigo, add: renderAdd, courses: renderCourses, moi: renderMoi })[S.view]();
  renderTimers();
}
function renderKeep() { const y = $('app').scrollTop; render(); $('app').scrollTop = y; }

/* ---------- Liste des recettes ---------- */
// Nom court du livre ou de la source : « Yummix », « Whoogy's », « One Pot », « NYT Cooking »…
function livreDe(r) {
  const s = String(r.source || '').trim();
  if (!s) return '';
  let m = s.match(/^(?:livre|application|site)?\s*«\s*([^»]+?)\s*»/i);
  if (m) return m[1];
  const premier = s.split(',')[0].trim();
  if (/^(livre|application|site)$/i.test(premier)) return '';
  m = premier.match(/\(([^)]+)\)/);
  if (m && !/^(livre|de .*)$/i.test(m[1].trim())) return m[1].trim();
  return premier.replace(/\(.*?\)/g, '').replace(/\bp\.\s*\d+.*$/, '').trim();
}
function sourcesListe() {
  const c = {};
  DATA.recettes.forEach(r => { if (r.statut === A_VALIDER) return; const l = livreDe(r); if (l) c[l] = (c[l] || 0) + 1; });
  return Object.keys(c).filter(k => c[k] >= 2).sort((a, b) => c[b] - c[a] || a.localeCompare(b, 'fr')).map(k => [k, c[k]]);
}
function allTypes() {
  const c = {};
  DATA.recettes.forEach(r => r.types.forEach(t => c[t] = (c[t] || 0) + 1));
  return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b, 'fr'));
}
const comsDe = t => DATA.commentaires.filter(c => c.titre === t);

function recettesFiltrees() {
  const q = plat(S.q).split(/\s+/).filter(Boolean);
  return DATA.recettes.filter(r => {
    if (S.source && livreDe(r) !== S.source) return false;
    if (S.filtre === 'valider') { if (r.statut !== A_VALIDER) return false; }
    else if (r.statut === A_VALIDER) return false;
    if (S.filtre === 'fav' && !perso.fav.includes(r.titre)) return false;
    if (S.filtre === 'tester' && !perso.tester.includes(r.titre)) return false;
    if (S.type && !r.types.includes(S.type)) return false;
    if (!q.length || S.frigo) return true;
    const ings = (DATA.ingredients[r.titre] || []).map(i => i.n).join(' ');
    const hay = plat([r.titre, r.aliments.join(' '), r.types.join(' '), ings, r.source, r.typeSource].join(' '));
    const hayColle = hay.replace(/ /g, '');
    return q.every(w => hay.includes(w) || hayColle.includes(w));
  });
}

const enStock = nom => {
  const parts = norm(nom).replace(/\(.*?\)/g, '').split(/,|\s+et\s+/).map(x => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(n => stock.some(s => { s = norm(s); return n === s || n.startsWith(s + ' '); }));
};
const racine = w => norm(w).replace(/(x|s)$/, '');

function frigoClasse(list) {
  const terms = S.frigoQ.split(/[,;\n]+|\s+et\s+/).map(racine).filter(t => t.length >= 2);
  if (!terms.length) return null;
  return list.map(r => {
    let have = 0; const missing = [];
    (DATA.ingredients[r.titre] || []).forEach(i => {
      const n = norm(i.n);
      if (terms.some(t => n.includes(t))) have++;
      else if (!enStock(i.n)) missing.push(i.n);
    });
    return { r, have, missing };
  }).filter(x => x.have > 0).sort((a, b) => a.missing.length - b.missing.length || b.have - a.have);
}

function cardHtml(r, extra) {
  const nb = comsDe(r.titre).length;
  const icons = [perso.fav.includes(r.titre) ? '♥' : '', perso.tester.includes(r.titre) ? '🔖' : '',
    menu.some(m => m.titre === r.titre) ? '🛒' : '', nb ? '💬' + nb : ''].filter(Boolean).join(' ');
  return `<div class="card ${r.statut === A_VALIDER ? 'pending' : ''}" data-act="open" data-t="${esc(r.titre)}">
    <h2>${esc(r.titre)}</h2>
    <div class="meta">${r.statut === A_VALIDER ? '<b style="color:var(--accent)">À valider</b> · proposée par ' + esc(r.par) + ' · ' : ''}${stars(r.note)} ${esc(r.types.slice(0, 3).join(' · '))}${saisonsCourt(r) ? ' · <span class="ssn">' + esc(saisonsCourt(r)) + '</span>' : ''}<span class="icons">${icons ? ' · ' + icons : ''}</span></div>
    ${(S.q || S.source) && livreDe(r) ? `<div class="meta">📚 ${esc(livreDe(r))}</div>` : ''}
    ${extra || ''}</div>`;
}

function renderList() {
  let list = recettesFiltrees();
  const az = (a, b) => a.titre.localeCompare(b.titre, 'fr');
  if (S.sort.startsWith('saison:')) {
    const s = S.sort.slice(7);
    const rang = r => { const l = saisonsDe(r); return l.includes(s) ? 0 : l.length ? 2 : 1; };
    list.sort((a, b) => rang(a) - rang(b) || az(a, b));
  } else list.sort({
    az,
    recent: (a, b) => parseDate(b.ajoutee) - parseDate(a.ajoutee),
    note: (a, b) => (num(b.note) || 0) - (num(a.note) || 0) || az(a, b)
  }[S.sort] || az);
  const fr = S.frigo ? frigoClasse(list) : null;
  const nbValider = isAdmin() ? DATA.recettes.filter(r => r.statut === A_VALIDER).length : 0;
  const filtres = [['toutes', 'Toutes'], ['fav', '♥ Favoris'], ['tester', '🔖 À tester']];
  if (nbValider) filtres.push(['valider', 'À valider (' + nbValider + ')']);

  let body;
  if (S.frigo && fr) {
    body = fr.length ? fr.map(x => cardHtml(x.r, x.missing.length
      ? `<div class="missing">Il manque : ${esc(x.missing.slice(0, 6).join(', '))}${x.missing.length > 6 ? '…' : ''}</div>`
      : '<div class="missing none">Vous avez tout !</div>')).join('') : '<div class="empty">Aucune recette avec ces ingrédients.</div>';
  } else if (S.frigo) {
    body = '<div class="empty">Indiquez ce que vous avez, séparé par des virgules.<br>Ex : poireau, pommes de terre, crème</div>';
  } else {
    body = list.length ? list.map(r => cardHtml(r)).join('') : '<div class="empty">' + (S.filtre === 'fav' ? 'Pas encore de favoris : touchez ♥ sur une recette.' : S.filtre === 'tester' ? 'Rien à tester pour l\'instant : touchez 🔖 sur une recette.' : 'Aucune recette ne correspond.') + '</div>';
  }

  $('app').innerHTML = `
    <header>
      <h1>Carnet de recettes</h1>
      ${S.frigo
        ? `<input id="frigoQ" class="field" type="search" placeholder="Ce que j'ai : poireau, crème, lardons…" value="${esc(S.frigoQ)}" autocomplete="off">`
        : `<input id="q" class="field" type="search" placeholder="Plat, ingrédient, livre (Yummix, Whoogy's…)" value="${esc(S.q)}" autocomplete="off">`}
      <div class="seg">
        ${filtres.map(([k, l]) => `<button data-act="filtre" data-k="${k}" class="${S.filtre === k ? 'on' : ''} ${k === 'valider' ? 'warn' : ''}">${l}</button>`).join('')}
      </div>
      <div class="chips">
        <label class="chip srcchip ${S.source ? 'on' : ''}">📚 <select id="srcSel" aria-label="Filtrer par livre ou source">
          <option value="">Livre / source</option>
          ${sourcesListe().map(([s, n]) => `<option value="${esc(s)}" ${S.source === s ? 'selected' : ''}>${esc(s)} (${n})</option>`).join('')}
        </select></label>
        <button class="chip ${S.type ? '' : 'on'}" data-act="type" data-t="">Tout</button>
        ${allTypes().map(t => `<button class="chip ${S.type === t ? 'on' : ''}" data-act="type" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
    </header>
    ${S.frigo ? '<div class="bar"><span>Classées par nombre d\'ingrédients manquants (hors « toujours à la maison »)</span></div>' : `
    <div class="bar">
      <span>${list.length} recette${list.length > 1 ? 's' : ''}</span>
      <label class="sortbox">↕ Trier<select id="sort" aria-label="Trier les recettes">
        <option value="az" ${S.sort === 'az' ? 'selected' : ''}>A → Z</option>
        <option value="recent" ${S.sort === 'recent' ? 'selected' : ''}>Plus récentes</option>
        <option value="note" ${S.sort === 'note' ? 'selected' : ''}>Mieux notées</option>
        ${SAISONS.map(([s, e]) => `<option value="saison:${s}" ${S.sort === 'saison:' + s ? 'selected' : ''}>${e} ${s}${s === saisonActuelle() ? ' (maintenant)' : ' d\'abord'}</option>`).join('')}
      </select></label>
    </div>`}
    <main>
      ${propositions.length && S.filtre === 'toutes' && !S.frigo ? `<div class="hint" style="padding:4px 4px 0">⏳ ${propositions.length} recette${propositions.length > 1 ? 's' : ''} proposée${propositions.length > 1 ? 's' : ''} en attente de validation par ${esc(OWNER)}.</div>` : ''}
      ${body}
    </main>`;

  const inp = $('q') || $('frigoQ');
  inp.oninput = () => {
    if (S.frigo) S.frigoQ = inp.value; else S.q = inp.value;
    const pos = inp.selectionStart; renderList();
    const i2 = $('q') || $('frigoQ'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {}
  };
  if ($('sort')) $('sort').onchange = e => { S.sort = e.target.value; renderList(); };
  if ($('srcSel')) $('srcSel').onchange = e => { S.source = e.target.value; renderList(); };
}

/* ---------- Avec ce que j'ai (onglet 🧺) ---------- */
const terme = t => racine(t);
function frigoResultats() {
  const terms = frigoItems.map(x => cleIngredient(x) || racine(x)).filter(t => t.length >= 2);
  if (!terms.length) return [];
  // « crème » doit trouver « crème fraîche » mais pas « crème d'amande » ; « butternut » trouve « courge butternut »
  const correspond = (nom, t) => {
    const key = cleIngredient(nom), n = norm(nom);
    if (!key) return false;
    if (key === t) return true;
    const compose = /\s(de|d'|d|a|au|aux)\s/.test(key);
    if (!compose && key.startsWith(t + ' ')) return true;
    return t.length >= 4 && !key.startsWith(t) && new RegExp('(^|[^a-z])' + t.replace(/[^a-z' -]/g, '') + '(s|x)?([^a-z]|$)').test(n);
  };
  return DATA.recettes.filter(r => r.statut !== A_VALIDER && (!S.frigoType || r.types.includes(S.frigoType))).map(r => {
    const utilise = [], missing = [];
    (DATA.ingredients[r.titre] || []).forEach(i => {
      const t = terms.find(x => correspond(i.n, x));
      if (t) { if (!utilise.includes(nomAffiche(i.n))) utilise.push(nomAffiche(i.n)); }
      else if (!enStock(i.n) && norm(i.rayon) !== norm('Épices et huiles')) missing.push(nomAffiche(i.n));
    });
    return { r, utilise, missing };
  }).filter(x => x.utilise.length).sort((a, b) => (a.missing.length - 1.5 * a.utilise.length) - (b.missing.length - 1.5 * b.utilise.length) || a.missing.length - b.missing.length || a.r.titre.localeCompare(b.r.titre, 'fr'));
}
function nomsIngredients() {
  const s = new Set();
  Object.values(DATA.ingredients).forEach(l => l.forEach(i => { const n = nomAffiche(i.n); if (n && n.length < 30 && !enStock(n)) s.add(n); }));
  return Array.from(s).sort((a, b) => a.localeCompare(b, 'fr'));
}
function renderFrigo() {
  const res = frigoResultats();
  const types = allTypes().filter(t => ['Plat principal', 'Entrée', 'Soupe', 'Salade', 'Dessert', 'Accompagnement', 'Goûter', 'Bébé'].includes(t));
  $('app').innerHTML = `
    <header>
      <h1>Avec ce que j'ai</h1>
      <div class="meta">Ajoutez ce que vous avez sous la main. Les produits « toujours à la maison » et les épices comptent comme disponibles.</div>
    </header>
    <main>
      <section>
        <h3>Sous la main ${frigoItems.length ? '<button class="tog" data-act="frigoClear">' + (S.confirm === 'frigo' ? 'Confirmer ?' : 'Tout effacer') + '</button>' : ''}</h3>
        <div class="chips wrap" style="padding-top:0">${frigoItems.map((x, i) => `<button class="chip on" data-act="frigoDel" data-i="${i}">${esc(x)} ✕</button>`).join('') || '<span class="hint">Rien pour l\'instant.</span>'}</div>
        <div class="add">
          <input class="field" id="frigoIn" list="frigoList" placeholder="Ex : poireau, crème, lardons" autocomplete="off" autocapitalize="off">
          <button class="go" data-act="frigoAdd">＋</button>
        </div>
        <datalist id="frigoList">${nomsIngredients().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <details class="stock" style="margin-top:10px"><summary>Toujours à la maison (${stock.length})</summary>
          <div class="chips wrap">${stock.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
          <div class="hint">À modifier dans l'onglet 👤.</div></details>
      </section>
      ${frigoItems.length ? `
      <div class="chips" style="padding:0 2px 6px">
        <button class="chip ${S.frigoType ? '' : 'on'}" data-act="frigoType" data-t="">Tout</button>
        ${types.map(t => `<button class="chip ${S.frigoType === t ? 'on' : ''}" data-act="frigoType" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <div class="bar" style="padding:2px 4px 6px"><span>${res.length} recette${res.length > 1 ? 's' : ''}, celles où il manque le moins d'abord</span></div>
      ${res.length ? res.slice(0, 40).map(x => cardHtml(x.r, `
        <div class="missing none" style="font-weight:500">✓ ${esc(x.utilise.slice(0, 5).join(', '))}</div>
        ${x.missing.length ? `<div class="missing">Il manque : ${esc(x.missing.slice(0, 6).join(', '))}${x.missing.length > 6 ? '…' : ''}</div>` : '<div class="missing none">Vous avez tout !</div>'}`)).join('')
        : '<div class="empty">Aucune recette avec ces ingrédients.</div>'}` : '<div class="empty">Ajoutez un ou plusieurs ingrédients pour voir les recettes possibles.</div>'}
    </main>`;
  $('frigoIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ACT.frigoAdd(); } };
}

/* ---------- Minuteurs dans les étapes ---------- */
const RX_DUREE = /(\d+)\s*h\s*(\d{2})(?!\d)|(\d+(?:[.,]\d+)?)(?:\s*(?:à|-|ou)\s*(\d+(?:[.,]\d+)?))?\s*(heures?|minutes?|mn|min|secondes?|sec|h|s)(?![a-zà-ÿ])/gi;
function avecMinuteurs(texte, label) {
  return esc(texte).replace(RX_DUREE, (m, hh, mm, a, b, unit) => {
    let sec;
    if (hh) sec = (+hh) * 3600 + (+mm) * 60;
    else {
      const v = num(a), u = unit.toLowerCase()[0];
      sec = Math.round(v * (u === 'h' ? 3600 : u === 'm' ? 60 : 1));
    }
    if (!sec || sec > 24 * 3600) return m;
    return `<button class="tmr" data-act="timer" data-sec="${sec}" data-label="${esc(label)}">${m}</button>`;
  });
}

function etapesDe(r) {
  const lignes = String(r.etapes || '').split('\n').map(s => s.trim()).filter(Boolean);
  return {
    temps: lignes.filter(l => /^temps\s*:/i.test(l)).map(l => l.replace(/^temps\s*:\s*/i, '')),
    etapes: lignes.filter(l => !/^temps\s*:/i.test(l)).map(l => l.replace(/^\d+\s*[.)-]\s*/, ''))
  };
}

/* ---------- Fiche recette ---------- */
function renderRecipe() {
  const r = rec(S.open);
  if (!r) { S.view = 'list'; return renderList(); }
  const base = num(r.portions);
  const ratio = base && S.portions ? S.portions / base : 1;
  const ings = DATA.ingredients[r.titre] || [];
  const { temps, etapes } = etapesDe(r);
  const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());
  const m = menu.find(x => x.titre === r.titre);
  const coms = comsDe(r.titre);
  const notesProches = coms.map(c => num(c.note)).filter(Boolean);
  const moy = notesProches.length ? notesProches.reduce((a, b) => a + b, 0) / notesProches.length : 0;
  const ownerAvis = r.note || r.premiere || r.commentaires;
  const pending = r.statut === A_VALIDER;

  $('app').innerHTML = `
    <header>
      <button class="back" data-act="back">‹ Retour</button>
      <h1>${esc(r.titre)}</h1>
      <div class="meta">${stars(r.note)} ${esc([[r.typeSource, r.source].filter(Boolean).join(' – '), r.par ? 'ajoutée par ' + r.par : ''].filter(Boolean).join(' · '))}</div>
      ${moy ? `<div class="meta">Proches : ${stars(moy, 'blue')} (${notesProches.length})</div>` : ''}
      <div class="tags">${saisonsDe(r).length === 4 ? '<span class="tag ssn">🗓 Toutes saisons</span>' : saisonsDe(r).map(s => `<span class="tag ssn">${emoji(s)} ${s}</span>`).join('')}${r.types.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${pending ? '' : `<button class="btn menuBtn ${m ? 'ok' : ''}" data-act="menuSheet">${m ? '✓ Au menu : ' + esc(jourNom(m.jour)) + ' · modifier' : '🗓 Ajouter au menu de la semaine'}</button>`}
      <div class="toggles">
        <button class="tog ${perso.fav.includes(r.titre) ? 'on' : ''}" data-act="perso" data-k="fav">♥ Favori</button>
        <button class="tog ${perso.tester.includes(r.titre) ? 'on' : ''}" data-act="perso" data-k="tester">🔖 À tester</button>
        ${'wakeLock' in navigator ? `<button class="tog ${S.wake ? 'on' : ''}" data-act="wake">🔆 Écran allumé</button>` : ''}
      </div>
    </header>
    <main>
      ${pending && isAdmin() ? `
      <section class="banner">
        <h3>Recette proposée par ${esc(r.par || '?')}</h3>
        <div class="hint">Vérifiez-la, puis publiez-la pour tout le monde. Vous pouvez aussi la corriger dans le Google Sheet avant.</div>
        <div class="btns"><button class="btn" data-act="publish">Publier</button>
        <button class="btn ghost" data-act="delrec">${S.confirm === 'delrec' ? 'Confirmer la suppression' : 'Supprimer'}</button></div>
      </section>` : ''}
      ${ings.length ? `
      <section>
        <h3>Ingrédients
          ${base ? `<span class="stepper"><button data-act="portions" data-d="-1">−</button>${fmt(S.portions)} ${esc(r.unitePortions)}<button data-act="portions" data-d="1">+</button></span>` : ''}
        </h3>
        <ul class="ing">
          ${ings.map((g, k) => `<li data-act="check" data-k="i${k}" class="${S.done['i' + k] ? 'done' : ''}"><span class="box"></span><span class="txt">${ligne(g, ratio)}</span></li>`).join('')}
        </ul>
        ${pending ? '' : `<button class="btn ${m ? 'ok' : 'ghost'}" data-act="menuSheet">${m ? '✓ Au menu : ' + esc(jourNom(m.jour)) + (base ? ' · ' + fmt(num(m.portions) || base) + ' ' + esc(r.unitePortions) : '') + ' — modifier' : '🗓 Ajouter au menu' + (base ? ' (' + fmt(S.portions) + ' ' + esc(r.unitePortions) + ')' : '')}</button>`}
      </section>` : ''}
      ${m ? (b => b ? `<div style="margin:12px 0">${b}</div>` : '')(batchHtml(suggestionsBatch([r.titre], 3), 'À cuisiner en même temps')) : ''}
      ${etapes.length ? `
      <section>
        <h3>Préparation</h3>
        ${temps.map(t => `<div class="time">⏱ ${esc(t)}</div>`).join('')}
        <button class="btn dark" data-act="pas" style="margin:4px 0 10px">👩‍🍳 ${cuisine && cuisine.titre === r.titre && cuisine.i != null ? 'Reprendre le pas à pas (étape ' + (cuisine.i + 1) + ')' : 'Mode pas à pas'}</button>
        <div class="hint">Touchez une étape pour la cocher, une durée pour lancer un minuteur.</div>
        <ol class="steps">
          ${etapes.map((e, k) => `<li data-act="check" data-k="e${k}" class="${S.done['e' + k] ? 'done' : ''}">${avecMinuteurs(e, r.titre + ' · étape ' + (k + 1))}</li>`).join('')}
        </ol>
      </section>` : ''}
      ${isAdmin() ? avisAdminHtml(r) : (ownerAvis ? `
      <section>
        <h3>L'avis de ${esc(OWNER)}</h3>
        <div class="com owner">
          ${r.note ? `<div>${stars(r.note)}</div>` : ''}
          ${r.premiere ? `<div class="meta">Première réalisation : ${esc(r.premiere)}</div>` : ''}
          ${r.commentaires ? `<div class="txt">${esc(r.commentaires)}</div>` : ''}
        </div>
      </section>` : '')}
      ${pending ? '' : commentairesHtml(r, coms)}
      ${(isUrl(r.lien) || isUrl(r.photos)) ? `
      <section>
        ${isUrl(r.lien) ? `<div><a href="${esc(r.lien.trim())}" target="_blank" rel="noopener">Voir la recette en ligne</a></div>` : ''}
        ${isUrl(r.photos) ? `<div><a href="${esc(r.photos.trim())}" target="_blank" rel="noopener">Voir les photos d'origine</a></div>` : ''}
      </section>` : ''}
      ${r.origine ? `<section><details><summary>Recette d'origine</summary><pre>${esc(r.origine)}</pre></details></section>` : ''}
    </main>`;

  if (isAdmin()) {
    ['premiere', 'comm'].forEach(id => { if ($(id)) $(id).oninput = () => { S.avisDirty = true; $('saveAvis').style.display = 'block'; $('avisEtat').textContent = ''; }; });
  }
}

function avisAdminHtml(r) {
  return `
  <section>
    <h3>Mon avis <span class="meta" id="avisEtat"></span></h3>
    <div class="rate">${[1, 2, 3, 4, 5].map(n => `<button data-act="ownerStar" data-n="${n}" class="${(num(r.note) || 0) >= n ? 'on' : ''}">★</button>`).join('')}</div>
    <div class="hint">Touchez une étoile pour noter (retouchez la même pour effacer).</div>
    <label class="lbl">Première réalisation</label>
    <div class="add" style="margin-top:0">
      <input class="field" id="premiere" value="${esc(r.premiere)}" placeholder="Ex : ${dateFr()}" autocomplete="off">
      <button class="go" data-act="today">Aujourd'hui</button>
    </div>
    <label class="lbl">Mes commentaires</label>
    <textarea class="field" id="comm" rows="4" placeholder="Ce qui a marché, ce qu'il faudrait changer…">${esc(r.commentaires)}</textarea>
    <button class="btn" id="saveAvis" data-act="saveAvis" style="display:${S.avisDirty ? 'block' : 'none'}">Enregistrer</button>
  </section>`;
}

function commentairesHtml(r, coms) {
  const moi = norm(profil.prenom);
  let form;
  if (profil.role === 'famille') {
    form = `
      <label class="lbl">Votre avis (${esc(profil.prenom)})</label>
      <div class="rate blue">${[1, 2, 3, 4, 5].map(n => `<button data-act="comStar" data-n="${n}" class="${S.comNote >= n ? 'on' : ''}">★</button>`).join('')}</div>
      <textarea class="field" id="comTxt" rows="3" placeholder="Votre commentaire…" style="margin-top:8px"></textarea>
      <button class="btn" data-act="addCom" style="background:var(--blue);border-color:var(--blue)">Publier</button>`;
  } else if (!isAdmin()) {
    form = `<div class="hint">Pour noter et commenter, entrez le code famille dans l'onglet 👤.</div>`;
  } else form = '';
  if (!coms.length && !form) return '';
  return `
  <section class="blue">
    <h3>${isAdmin() ? 'Avis des proches' : 'Commentaires des proches'}</h3>
    ${coms.length ? coms.map(c => `
      <div class="com">
        ${(isAdmin() || (moi && norm(c.auteur) === moi)) ? `<button class="del" data-act="delCom" data-id="${esc(c.id)}">${S.confirm === 'com' + c.id ? 'Confirmer ?' : 'Supprimer'}</button>` : ''}
        <span class="who">${esc(c.auteur)}</span> <span class="meta">· ${esc(c.date)}</span> ${stars(c.note, 'blue')}
        ${c.texte ? `<div class="txt">${esc(c.texte)}</div>` : ''}
      </div>`).join('') : '<div class="hint">Pas encore de commentaire.</div>'}
    ${form}
  </section>`;
}

/* ---------- Mode pas à pas ---------- */
function ingredientsDeLEtape(texte, ings, ratio) {
  const t = norm(texte);
  return ings.filter(i => {
    const mots = norm(i.n).replace(/\(.*?\)/g, '').split(/[\s']+/).filter(w => w.length >= 3 && !['des', 'les', 'aux', 'pour', 'frais', 'fraiche', 'rouge', 'vert', 'verte', 'blanc', 'noir'].includes(w));
    return mots.length && t.includes(racine(mots[0]));
  }).map(i => ligne(i, ratio));
}
function renderPas() {
  const r = rec(S.open); if (!r || !S.pas) return;
  const { etapes } = etapesDe(r);
  const i = S.pas.i, n = etapes.length;
  const base = num(r.portions), ratio = base && S.portions ? S.portions / base : 1;
  const ings = ingredientsDeLEtape(etapes[i], DATA.ingredients[r.titre] || [], ratio);
  let el = $('pas');
  if (!el) { el = document.createElement('div'); el.id = 'pas'; el.className = 'pas'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="top"><span>Étape ${i + 1} / ${n}</span><button class="x" data-act="pasClose">✕</button></div>
    <div class="prog"><i style="width:${((i + 1) / n) * 100}%"></i></div>
    <div class="body">
      <div class="stext">${avecMinuteurs(etapes[i], r.titre + ' · étape ' + (i + 1))}</div>
      ${ings.length ? `<div class="sings"><div class="meta">Pour cette étape</div>${ings.map(x => `<div>${x}</div>`).join('')}</div>` : ''}
    </div>
    <div class="nav">
      <button class="btn ghost" data-act="pasPrev" ${i === 0 ? 'disabled' : ''}>◀ Précédente</button>
      ${i < n - 1 ? '<button class="btn" data-act="pasNext">Suivante ▶</button>' : '<button class="btn" data-act="pasClose">Terminé ✓</button>'}
    </div>`;
  document.body.style.overflow = 'hidden'; document.body.classList.add('paso');
}
function renderPasClose() { const el = $('pas'); if (el) el.remove(); document.body.style.overflow = ''; document.body.classList.remove('paso'); }

/* ---------- Minuteurs ---------- */
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep() {
  try {
    if (!audioCtx) return;
    for (let k = 0; k < 3; k++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + k * 0.35;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.start(t); o.stop(t + 0.3);
    }
  } catch (e) {}
  try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 300]); } catch (e) {}
}
function startTimer(sec, label) {
  unlockAudio();
  timers.push({ id: uid(), label, end: Date.now() + sec * 1000, fini: false });
  store.set('timers', timers); renderTimers(); tick();
  toast('Minuteur lancé : ' + mmss(sec));
}
const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function renderTimers() {
  const el = $('timers'); if (!el) return;
  el.innerHTML = timers.map(t => {
    const left = (t.end - Date.now()) / 1000;
    return `<div class="timer ${t.fini ? 'fini' : ''}"><span class="t">${t.fini ? '⏰' : mmss(left)}</span><span class="l">${t.fini ? 'Terminé · ' : ''}${esc(t.label)}</span><button data-act="timerStop" data-id="${t.id}">${t.fini ? 'OK' : '✕'}</button></div>`;
  }).join('');
}
let tickTimer = null;
function tick() {
  clearInterval(tickTimer);
  if (!timers.length) return;
  tickTimer = setInterval(() => {
    let change = false;
    timers.forEach(t => { if (!t.fini && t.end <= Date.now()) { t.fini = true; change = true; beep(); } });
    if (change) store.set('timers', timers);
    if (timers.some(t => t.fini) && Date.now() % 4000 < 1000) beep();
    renderTimers();
    if (!timers.length) clearInterval(tickTimer);
  }, 1000);
}

/* ---------- Écran allumé ---------- */
let wakeLock = null;
async function wake() {
  const want = (S.view === 'recipe' && S.wake) || !!S.pas;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}

/* ---------- Menu de la semaine ---------- */
function menuSheet(titre) {
  const r = rec(titre), m = menu.find(x => x.titre === titre);
  openModal(`
    <h2>${m ? 'Au menu' : 'Ajouter au menu'}</h2>
    <div class="meta">${esc(titre)}</div>
    <div class="daygrid">${JOURS.map(([j, l]) => `<button data-act="setJour" data-j="${j}" class="${m && m.jour === j ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${m ? '<button class="btn ghost" data-act="unmenu">Retirer du menu</button>' : ''}
    <button class="btn ghost" data-act="closeModal" style="border-color:var(--line);color:var(--muted)">Annuler</button>`);
  S.sheetTitre = titre;
}
function setJour(j) {
  const titre = S.sheetTitre, r = rec(titre);
  let m = menu.find(x => x.titre === titre);
  const base = num(r && r.portions);
  if (m) { m.jour = j; if (S.view === 'recipe' && base) m.portions = S.portions; }
  else menu.push({ id: uid(), titre, portions: base ? (S.view === 'recipe' ? S.portions : base) : '', jour: j });
  store.set('menu', menu); closeModal(); renderKeep();
  const n = suggestionsBatch(menu.map(x => x.titre), 5).length;
  toast('Ajouté au menu : ' + jourNom(j) + '.' + (n ? ' 💡 ' + n + ' idée' + (n > 1 ? 's' : '') + ' de batch cooking dans Menu & courses.' : ' La liste de courses est à jour.'), 4500);
}

/* ---------- Suggestions batch cooking ---------- */
// Sans IA : on compare les ingrédients frais en commun et les procédés (four à la même température, mixeur, mijoté…).
let batchIgnore = store.get('batchIgnore', []);
const RAYONS_FRAIS = ['Fruits', 'Légumes et herbes', 'Crèmerie et œufs', 'Boucherie et poissonnerie', 'Boulangerie'];
const BASIQUES = ['garni', 'sel', 'poivre', 'huile', 'eau', 'sucre', 'farine', 'beurre', 'ail', 'oignon', 'echalote', 'bouillon', 'levure', 'vinaigre', 'moutarde', 'cube', 'fecule', 'maizena', 'bicarbonate', 'sauce soja', 'miel'];
const QUALIFS = /\b(frais|fraiche|fraiches|gros|grosse|grosses|petit|petite|petits|petites|beau|belle|bio|entier|entiere|moyen|moyenne|hache|hachee|haches|hachees|rape|rapee|rapes|emince|emincee|emincees|egoutte|surgele|surgeles|surgelee|cuit|cuite|cuits|cuites)\b/g;
const MESURES = /^((petit |gros |grand |beau |belle )?(cm|bouquet|brin|brins|branche|branches|feuille|feuilles|pincee|tranche|tranches|gousse|gousses|filet|botte|poignee|morceau|morceaux|zeste|jus|boule|bloc|tete|pot|sachet|boite)\s+(de |d'|du |des )?)+/;
function nomCourt(nom) {
  let n = norm(nom).replace(/\(.*?\)/g, ' ').split(/[,;:]| ou /)[0].replace(QUALIFS, ' ').replace(/\s+/g, ' ').trim();
  return n.replace(/^(de |d'|des |du |la |le |les |l')+/, '').replace(MESURES, '').trim();
}
// Même nettoyage, mais en gardant les accents pour l'affichage
const MOTS_TETE = ['de', "d'", 'du', 'des', 'la', 'le', 'les', "l'", 'petit', 'petite', 'gros', 'grosse', 'grand', 'beau', 'belle', 'cm', 'bouquet', 'brin', 'brins', 'branche', 'branches', 'feuille', 'feuilles', 'pincee', 'tranche', 'tranches', 'gousse', 'gousses', 'filet', 'botte', 'poignee', 'morceau', 'morceaux', 'zeste', 'jus', 'boule', 'bloc', 'tete', 'pot', 'sachet', 'boite'];
function nomAffiche(nom) {
  const s = String(nom).toLowerCase().replace(/\(.*?\)/g, ' ').split(/[,;:+]| ou /)[0].replace(/\bde (petite|grosse|moyenne) taille\b/, '');
  let mots = s.split(/\s+/).filter(Boolean).filter(w => !norm(w).replace(QUALIFS, '').trim() === false || norm(w).replace(QUALIFS, '').trim());
  while (mots.length > 1 && MOTS_TETE.includes(norm(mots[0]))) mots.shift();
  if (mots.length && /^(d'|l')/.test(norm(mots[0])) && mots[0].length > 2) mots[0] = mots[0].slice(2);
  return mots.join(' ');
}
function cleIngredient(nom) {
  const n = nomCourt(nom);
  const m = n.match(/^([a-z'-]+)(?:\s+(de|d'|a|au|aux)\s*([a-z'-]+))?/);
  if (!m) return '';
  const sing = w => w.replace(/(x|s)$/, '');
  if (m[2] && ['pomme', 'pommes', 'lait', 'noix', 'pois', 'feuille', 'feuilles', 'fond', 'jambon', 'fromage', 'pate', 'pates', 'creme', 'chou', 'choux'].includes(m[1]))
    return sing(m[1]) + ' ' + m[2] + ' ' + sing(m[3]);
  return sing(m[1]);
}
const PROCEDES = [
  ['four', /\b(four|enfourn|rotir|roti|gratin|gratiner)/],
  ['mixeur', /\b(mix|blender|velout)/],
  ['mijoté', /\b(mijot|cocotte|braiser)/],
  ['pâte à tarte', /\b(pate (brisee|feuilletee|sablee|a tarte|a quiche)|fond de tarte|abaisse)/],
  ['eau bouillante (pâtes, riz)', /\b(eau bouillante|cuire les pates|cuisson des pates|al dente|cuire le riz)/],
  ['vapeur', /\b(vapeur|varoma)/]
];
const profils = {};
function profilBatch(r) {
  if (profils[r.titre] && profils[r.titre].src === r.etapes) return profils[r.titre];
  const ings = {};
  (DATA.ingredients[r.titre] || []).forEach(i => {
    if (enStock(i.n) || norm(i.rayon) === norm('Épices et huiles')) return;
    const k = cleIngredient(i.n);
    if (!k || BASIQUES.some(b => k === b || k.startsWith(b + ' '))) return;
    const courant = ['citron', 'creme', 'lait', 'parmesan', 'oeuf', 'œuf', 'pain', 'persil', 'thym', 'laurier', 'romarin'].some(c => k === c || k.startsWith(c + ' '));
    ings[k] = { nom: nomAffiche(i.n), poids: courant ? 0.7 : RAYONS_FRAIS.includes(i.rayon) ? 2 : 0.5 };
  });
  const t = norm(r.etapes);
  const proc = PROCEDES.filter(([, rx]) => rx.test(t)).map(([l]) => l);
  if (norm(r.typeSource) === 'thermomix' || /thermomix|vitesse \d/.test(t)) proc.push('Thermomix');
  const mt = t.match(/(?:four|prechauff)[^.]{0,60}?(\d{3})\s*°?\s*c\b/) || t.match(/(\d{3})\s*°?\s*c\b[^.]{0,30}(?:four|chaleur tournante)/);
  const temp = mt && mt[1];
  return (profils[r.titre] = { src: r.etapes, ings, proc, temp: temp ? +temp : null });
}
// Analyse « Batch cooking » faite par Claude dans le Sheet (colonne S), une ligne par préparation :
// « four 200 °C, 30 min : butternut », « vapeur 20 min : … », « base : sauce tomate », « céréale : riz », « découpe : oignon, carottes »…
const TYPES_PREP = [['four', 'four'], ['vapeur', 'vapeur'], ['eau bouillante', 'eau'], ['cereale', 'cereale'], ['base', 'base'], ['decoupe', 'decoupe'], ['mijote', 'mijote'], ['garde', 'garde']];
const SYN_BASE = { 'pate a tarte': 'pate brisee', 'sauce tomate marinara': 'sauce tomate', 'marinara': 'sauce tomate' };
function prepsDe(r) {
  const t = (r.x && r.x['Batch cooking']) || '';
  return t.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf(':');
    const head = i >= 0 ? l.slice(0, i).trim() : l, quoi = i >= 0 ? l.slice(i + 1).trim() : '';
    const nh = norm(head), tp = TYPES_PREP.find(([k]) => nh.startsWith(k));
    if (!tp) return null;
    const temp = (nh.match(/(\d{2,3})\s*°?\s*c\b/) || [])[1];
    let cle = norm(quoi).replace(/\(.*?\)/g, '').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
    cle = SYN_BASE[cle] || cle;
    return { type: tp[1], quoi, temp: temp ? +temp : null, cle, items: quoi.split(/,| et | ou /).map(x => cleIngredient(x)).filter(Boolean) };
  }).filter(Boolean);
}
const court = s => String(s).replace(/\s*\(.*?\)/g, '');
function liensPreps(pa, pb) {
  const best = {};
  const garder = (type, pts, txt) => { if (!best[type] || best[type].pts < pts) best[type] = { pts, txt }; };
  pa.forEach(a => pb.forEach(b => {
    if (a.type !== b.type) return;
    if (a.type === 'four') {
      if (a.temp && b.temp && Math.abs(a.temp - b.temp) <= 10) garder('four', 3, `même four ${b.temp} °C : ${court(a.quoi)} + ${court(b.quoi)}`);
      else if (a.temp && b.temp && Math.abs(a.temp - b.temp) <= 25) garder('four', 1.2, `four ${a.temp} et ${b.temp} °C : à enchaîner`);
      else garder('four', 0.6, 'four');
    } else if (a.type === 'vapeur') garder('vapeur', 2, `vapeur en même temps : ${court(a.quoi)} + ${court(b.quoi)}`);
    else if (a.type === 'eau') garder('eau', 0.8, `même eau bouillante : ${court(a.quoi)}, puis ${court(b.quoi)}`);
    else if (a.type === 'cereale') { if (a.items[0] && a.items[0] === b.items[0]) garder('cereale', 2, `${court(b.quoi)} : une seule cuisson pour les deux`); }
    else if (a.type === 'base') { if (a.cle && a.cle === b.cle) garder('base:' + a.cle, 3, `base commune : ${court(b.quoi)}`); }
    else if (a.type === 'mijote') garder('mijote', 0.8, 'deux mijotés à lancer côte à côte');
    else if (a.type === 'decoupe') {
      const comm = b.items.filter(k => a.items.includes(k));
      if (comm.length) {
        const pts = comm.reduce((s, k) => s + (['oignon', 'ail', 'echalote'].includes(k) ? 0.3 : 0.8), 0);
        const noms = b.quoi.split(/,| et | ou /).map(x => x.trim()).filter(x => comm.includes(cleIngredient(x)));
        garder('decoupe', Math.min(2, pts), `à éplucher et couper ensemble : ${noms.join(', ')}`);
      }
    }
  }));
  return Object.values(best);
}
function suggestionsBatch(seeds, max) {
  const base = seeds.map(rec).filter(Boolean);
  if (!base.length) return [];
  const pris = new Set(menu.map(m => m.titre).concat(batchIgnore));
  const pa = base.map(profilBatch), preA = base.map(prepsDe);
  return DATA.recettes.filter(r => r.statut !== A_VALIDER && !pris.has(r.titre) && !seeds.includes(r.titre)).map(r => {
    const p = profilBatch(r), preB = prepsDe(r);
    const analyse = preB.length && preA.some(x => x.length);
    let score = 0; const communs = new Map(), procs = new Set(); let four = null;
    pa.forEach(a => {
      Object.keys(p.ings).forEach(k => { if (a.ings[k]) { communs.set(k, p.ings[k].nom); } });
      p.proc.forEach(x => { if (a.proc.includes(x)) procs.add(x); });
      if (p.temp && a.temp && Math.abs(p.temp - a.temp) <= 10 && p.proc.includes('four')) four = a.temp;
    });
    communs.forEach((nom, k) => { score += Math.max(...pa.map(a => a.ings[k] ? Math.min(a.ings[k].poids, p.ings[k].poids) : 0)) * (analyse ? 0.6 : 1); });
    const raisons = [];
    let liens = [];
    if (analyse) {
      const best = {};
      preA.forEach(x => liensPreps(x, preB).forEach(l => { const k = l.txt.split(':')[0]; if (!best[k] || best[k].pts < l.pts) best[k] = l; }));
      liens = Object.values(best).sort((a, b) => b.pts - a.pts);
      score += liens.reduce((s, l) => s + l.pts, 0);
      liens.filter(l => l.pts >= 0.8).slice(0, 3).forEach(l => raisons.push(l.txt));
      const garde = preB.find(x => x.type === 'garde');
      if (garde) score += 0.3;
    } else {
      score += procs.size * 0.7 + (four ? 1 : 0);
    }
    if (r.types.includes("À l'avance")) score += 0.5;
    const sucre = x => x.types.some(t => ['Dessert', 'Goûter'].includes(t));
    if (sucre(r) !== base.some(sucre)) score -= 1.5;
    const s = saisonActuelle(), ls = saisonsDe(r);
    if (ls.length && !ls.includes(s)) score -= 1;
    const dejaCites = raisons.join(' ').toLowerCase();
    const ingsTxt = Array.from(communs.values()).filter(n => !dejaCites.includes(n.toLowerCase())).slice(0, 4);
    if (ingsTxt.length) raisons.push('en commun : ' + ingsTxt.join(', '));
    if (!analyse) {
      if (four) raisons.push('même four à ' + four + ' °C');
      const autres = Array.from(procs).filter(x => !(four && x === 'four'));
      if (autres.length) raisons.push(autres.join(', '));
    }
    const fort = liens.some(l => l.pts >= 2);
    return { r, score, raisons, ok: communs.size || fort };
  }).filter(x => x.score >= 2.5 && x.ok && x.raisons.length).sort((a, b) => b.score - a.score).slice(0, max || 5);
}
function batchHtml(list, titre) {
  if (!list.length) return '';
  return `<div class="batch"><div class="batch-h">💡 ${titre}</div>
    ${list.map(x => `<div class="batch-i">
      <div class="name" data-act="open" data-t="${esc(x.r.titre)}"><b>${esc(x.r.titre)}</b><small>${esc(x.raisons.join(' · '))}</small></div>
      <button class="go" data-act="batchAdd" data-t="${esc(x.r.titre)}">＋ Menu</button>
      <button class="x" data-act="batchHide" data-t="${esc(x.r.titre)}" title="Ne plus proposer cette semaine">✕</button></div>`).join('')}</div>`;
}

/* ---------- Liste de courses ---------- */
const itemKey = (rayon, nom, unite) => [rayon, nom, unite].map(norm).join('|');
function computeCourses() {
  const items = {};
  menu.forEach(sel => {
    const r = rec(sel.titre);
    const base = r ? num(r.portions) : null, p = num(sel.portions);
    const coef = base && p ? p / base : 1;
    (DATA.ingredients[sel.titre] || []).forEach(g => {
      const rayon = String(g.rayon || '').trim() || 'Autres';
      const unite = String(g.u || '').trim();
      let nom = String(g.n || '').trim();
      const sing = Object.keys(DATA.pluriels).find(k => DATA.pluriels[k] === nom);
      if (sing) nom = sing;
      const k = itemKey(rayon, nom, unite);
      const it = items[k] || (items[k] = { k, rayon, nom, unite, v: 0, raw: null, de: [] });
      const pq = parseQty(g.q);
      if (pq && pq.raw == null) it.v += (pq.b != null ? pq.b : pq.a) * coef;
      else if (pq && pq.raw) it.raw = pq.raw;
      if (!it.de.includes(sel.titre)) it.de.push(sel.titre);
    });
  });
  produits.forEach(p => {
    const rayon = String(p.rayon || '').trim() || 'Autres';
    const k = itemKey(rayon, p.nom, '');
    if (!items[k]) items[k] = { k, rayon, nom: p.nom, unite: '', v: 0, raw: null, de: [] };
  });
  const all = Object.values(items);
  const ordre = r => { const i = DATA.rayons.indexOf(r); return i < 0 ? 99 : i; };
  const groups = {};
  all.filter(it => !(it.de.length && enStock(it.nom))).forEach(it => (groups[it.rayon] = groups[it.rayon] || []).push(it));
  return {
    groups: Object.keys(groups).sort((a, b) => ordre(a) - ordre(b) || a.localeCompare(b, 'fr'))
      .map(r => ({ rayon: r, items: groups[r].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) })),
    maison: all.filter(it => it.de.length && enStock(it.nom))
  };
}
const itemLine = it => formatLine(it.v > 0 ? fmt(it.v) : (it.raw || ''), it.v || (it.raw ? 1 : 0), it.unite, it.nom);

function renderCourses() {
  const { groups, maison } = computeCourses();
  const set = new Set(coches);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const restants = groups.reduce((s, g) => s + g.items.filter(i => !set.has(i.k)).length, 0);
  const plusieurs = menu.length > 1;
  const titres = DATA.recettes.filter(r => r.statut !== A_VALIDER && !menu.some(m => m.titre === r.titre)).map(r => r.titre).sort((a, b) => a.localeCompare(b, 'fr'));
  const parJour = JOURS.map(([j, l]) => ({ j, l, items: menu.filter(m => (m.jour || '') === j) })).filter(x => x.items.length);

  $('app').innerHTML = `
    <header><h1>Menu & courses</h1>
      <div class="meta">${total ? `<b class="reste">${restants} article${restants > 1 ? 's' : ''} à acheter</b> sur ${total}` : 'Liste vide'} · enregistrée sur ce téléphone</div>
    </header>
    <main>
      <section>
        <h3>Menu de la semaine</h3>
        ${parJour.length ? parJour.map(d => `<div class="day">${d.l}</div>` + d.items.map(m => {
          const r = rec(m.titre), base = r ? num(r.portions) : null, p = num(m.portions) || base;
          return `<div class="row menu">
            <div class="name" data-act="open" data-t="${esc(m.titre)}">${esc(m.titre)}${r ? '' : '<small>Recette introuvable</small>'}</div>
            ${base ? `<span class="stepper"><button class="mini" data-act="mPortions" data-id="${m.id}" data-d="-1">−</button>${fmt(p)}<button class="mini" data-act="mPortions" data-id="${m.id}" data-d="1">+</button></span>` : ''}
            <select data-act="mJour" data-id="${m.id}">${JOURS.map(([j, l]) => `<option value="${j}" ${m.jour === j ? 'selected' : ''}>${l.slice(0, 3)}${j ? '.' : ''}</option>`).join('')}</select>
            <button class="x" data-act="mDel" data-id="${m.id}">✕</button></div>`;
        }).join('')).join('') : '<div class="hint">Ajoutez des recettes depuis leur fiche (🗓) ou ici.</div>'}
        <div class="add">
          <select class="field" id="addR" style="flex:1"><option value="">＋ Une recette…</option>${titres.map(t => `<option>${esc(t)}</option>`).join('')}</select>
          <select class="field" id="addJ" style="flex:0 0 30%">${JOURS.map(([j, l]) => `<option value="${j}">${l}</option>`).join('')}</select>
          <button class="go" data-act="addMenu">＋</button>
        </div>
        ${batchHtml(suggestionsBatch(menu.map(x => x.titre), 5), 'Idées batch cooking : à cuisiner en même temps')}
      </section>

      <section>
        <h3>Produits en plus</h3>
        ${produits.map((p, i) => `<div class="row"><div class="name">${esc(p.nom)}<small>${esc(p.rayon || 'Autres')}</small></div><button class="x" data-act="pDel" data-i="${i}">✕</button></div>`).join('')}
        <div class="add">
          <input class="field" id="pNom" placeholder="Ex : yaourts" autocomplete="off">
          <select class="field" id="pRayon">${DATA.rayons.map(r => `<option ${r === 'Autres' ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
          <button class="go" data-act="pAdd">＋</button>
        </div>
      </section>

      ${total || maison.length ? `
      <section>
        <h3>À acheter ${total ? `<button class="tog" data-act="share">📤 Partager</button>` : ''}</h3>
        ${restants ? groups.filter(g => g.items.some(i => !set.has(i.k))).map(g => `<div class="rayon">${esc(g.rayon)}</div>
          <ul class="ing">${g.items.filter(i => !set.has(i.k)).map(it => `<li data-act="ck" data-k="${esc(it.k)}"><span class="box"></span>
              <span class="txt">${itemLine(it)}${plusieurs && it.de.length ? `<span class="from">${esc(it.de.join(' · '))}</span>` : ''}</span>
              ${it.de.length ? `<button class="home" data-act="stockAdd" data-n="${esc(it.nom)}" title="Toujours à la maison">🏠</button>` : ''}</li>`).join('')}</ul>`).join('')
          : (total ? '<div class="alldone">✓ Tout est dans le panier !</div>' : '')}
        ${total - restants ? `<details class="stock panier" ${S.panierOuvert ? 'open' : ''}><summary>✓ Dans le panier (${total - restants})</summary>
          <ul class="ing">${groups.flatMap(g => g.items.filter(i => set.has(i.k))).map(it => `<li data-act="ck" data-k="${esc(it.k)}" class="done"><span class="box"></span><span class="txt">${itemLine(it)}</span></li>`).join('')}</ul></details>` : ''}
        <div class="hint" style="margin-top:10px">🏠 = toujours à la maison : l'article ne sera plus proposé.</div>
        ${maison.length ? `<details class="stock"><summary>Déjà à la maison (${maison.length})</summary>
          <ul class="ing">${maison.map(it => `<li><span class="txt">${itemLine(it)}</span><button class="tog" data-act="stockDel" data-n="${esc(it.nom)}">À acheter</button></li>`).join('')}</ul></details>` : ''}
      </section>` : ''}

      ${menu.length || produits.length ? `<button class="btn ghost" data-act="newWeek">${S.confirm === 'week' ? 'Touchez encore pour tout effacer' : 'Nouvelle semaine (vider le menu et la liste)'}</button>` : ''}
    </main>`;
  $('pNom').onkeydown = e => { if (e.key === 'Enter') ACT.pAdd(); };
}

function shareText() {
  const { groups } = computeCourses();
  const set = new Set(coches);
  const lines = ['🛒 Liste de courses'];
  groups.forEach(g => {
    const its = g.items.filter(i => !set.has(i.k));
    if (!its.length) return;
    lines.push('', g.rayon.toUpperCase());
    its.forEach(i => lines.push('• ' + plain(itemLine(i))));
  });
  return lines.join('\n');
}

/* ---------- Ajouter une recette ---------- */
function blankForm() {
  return { titre: '', typeSource: '', source: '', lien: '', portions: '4', unitePortions: 'personnes', types: [], saisons: [], saisonsAuto: true, aliments: '', ingredients: '', etapes: '', origine: '' };
}
function renderAdd() {
  if (!canWrite()) {
    $('app').innerHTML = `<header><h1>Ajouter une recette</h1></header><main>
      <section><h3>Code famille nécessaire</h3>
      <div class="hint">Pour proposer des recettes, entrez le code famille que ${esc(OWNER)} vous a donné.</div>
      <label class="lbl">Votre prénom</label><input class="field" id="fPrenom" value="${esc(profil.prenom)}" autocomplete="given-name">
      <label class="lbl">Code famille</label><input class="field" id="fCode" autocomplete="off" autocapitalize="off">
      <button class="btn" data-act="saveProfil">Valider</button></section></main>`;
    return;
  }
  const f = brouillon || (brouillon = blankForm());
  if (!Array.isArray(f.saisons)) { f.saisons = []; f.saisonsAuto = true; }
  $('app').innerHTML = `
    <header><h1>Ajouter une recette</h1>
      <div class="meta">${isAdmin() ? 'Elle sera publiée directement.' : 'Elle sera visible par tous après validation par ' + esc(OWNER) + '.'}</div></header>
    <main>
      <section>
        <label class="lbl">Titre *</label>
        <input class="field" data-f="titre" value="${esc(f.titre)}" placeholder="Ex : Tarte aux poireaux">
        <div class="add" style="margin-top:0">
          <div style="flex:1"><label class="lbl">Portions</label><input class="field" data-f="portions" inputmode="numeric" value="${esc(f.portions)}"></div>
          <div style="flex:1"><label class="lbl">Unité</label><input class="field" data-f="unitePortions" value="${esc(f.unitePortions)}"></div>
        </div>
        <label class="lbl">Types</label>
        <div class="chips wrap" style="padding-top:0">${(DATA.typesPlat.length ? DATA.typesPlat : allTypes()).map(t => `<button class="chip ${f.types.includes(t) ? 'on' : ''}" data-act="fType" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </section>
      <section>
        <label class="lbl">Ingrédients * (un par ligne)</label>
        <textarea class="field" data-f="ingredients" rows="7" placeholder="250 g de lentilles corail&#10;2 gousses d'ail&#10;1 c. à soupe d'huile d'olive&#10;3 carottes&#10;sel, poivre">${esc(f.ingredients)}</textarea>
        <div class="hint">Vous pouvez coller la liste telle quelle : quantités et unités sont reconnues automatiquement. Vérifiez l'aperçu.</div>
        <div id="preview"></div>
      </section>
      <section>
        <label class="lbl">Saisons</label>
        <div id="saisonsBox"></div>
      </section>
      <section>
        <label class="lbl">Préparation * (une étape par ligne)</label>
        <textarea class="field" data-f="etapes" rows="8" placeholder="Émincer l'oignon et le faire revenir 5 minutes.&#10;Ajouter les lentilles…">${esc(f.etapes)}</textarea>
        <div class="hint">La numérotation est ajoutée automatiquement. Une ligne « Temps : … » reste en tête.</div>
      </section>
      <section>
        <label class="lbl">Type de source</label>
        <select class="field" data-f="typeSource"><option value=""></option>${(DATA.typesSource.length ? DATA.typesSource : ['Livre', 'Site ou blog', 'Application', 'Autre']).map(t => `<option ${f.typeSource === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <label class="lbl">Source (livre, auteur, page…)</label>
        <input class="field" data-f="source" value="${esc(f.source)}" placeholder="Ex : recette de mamie">
        <label class="lbl">Lien</label>
        <input class="field" data-f="lien" value="${esc(f.lien)}" type="url" placeholder="https://…">
        <label class="lbl">Aliments principaux (pour la recherche)</label>
        <input class="field" data-f="aliments" value="${esc(f.aliments)}" placeholder="Ex : poireau, crème, lardons">
        <label class="lbl">Texte d'origine (facultatif)</label>
        <textarea class="field" data-f="origine" rows="3" placeholder="Collez ici la recette d'origine complète si vous voulez la garder.">${esc(f.origine)}</textarea>
      </section>
      <button class="btn" data-act="submitRecette" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Envoi…' : isAdmin() ? 'Publier la recette' : 'Envoyer la recette'}</button>
      <button class="btn ghost" data-act="clearForm" style="border-color:var(--line);color:var(--muted)">${S.confirm === 'form' ? 'Touchez encore pour tout effacer' : 'Effacer le formulaire'}</button>
    </main>`;
  document.querySelectorAll('[data-f]').forEach(el => {
    const ev = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
    el[ev] = () => { brouillon[el.dataset.f] = el.value; store.set('brouillon', brouillon); if (el.dataset.f === 'ingredients') { renderPreview(); renderSaisonsForm(); } };
  });
  renderPreview(); renderSaisonsForm();
}
function renderSaisonsForm() {
  const box = $('saisonsBox'); if (!box) return;
  const f = brouillon, sug = suggestionSaisons(parsedIngredients());
  if (f.saisonsAuto) { f.saisons = sug.saisons.slice(); store.set('brouillon', f); }
  const toutes = NOMS_SAISONS.every(s => f.saisons.includes(s));
  box.innerHTML = `
    <div class="chips wrap" style="padding-top:0">
      ${SAISONS.map(([s, e]) => `<button class="chip ${f.saisons.includes(s) ? 'on' : ''}" data-act="fSaison" data-s="${s}">${e} ${s}</button>`).join('')}
      <button class="chip ${toutes ? 'on' : ''}" data-act="fSaison" data-s="toutes">🗓 Toutes saisons</button>
    </div>
    <div class="hint">${f.saisonsAuto
      ? (sug.saisons.length ? '💡 Proposition d\'après les ingrédients (' + esc(sug.vus.slice(0, 4).join(', ')) + ') : vérifiez ou corrigez.' : 'Pas de proposition automatique : aucun ingrédient de saison reconnu. Choisissez, ou laissez vide.')
      : 'Si la recette indique une saison, reprenez-la.'}</div>`;
}
function parsedIngredients() {
  return String((brouillon || {}).ingredients || '').split('\n').map(parseIngredientLine).filter(Boolean);
}
function renderPreview() {
  const list = parsedIngredients();
  $('preview').innerHTML = list.length ? `<div class="preview"><div class="meta" style="margin-bottom:4px">Aperçu : ${list.length} ingrédient${list.length > 1 ? 's' : ''}</div><table>${list.map(i => `<tr><td class="q">${esc(i.q.replace('.', ','))}</td><td class="u">${esc(i.u)}</td><td>${esc(i.n)}</td></tr>`).join('')}</table></div>` : '';
}
async function submitRecette() {
  const f = brouillon;
  const ingredients = parsedIngredients();
  const lignes = String(f.etapes || '').split('\n').map(s => s.trim().replace(/^(\d+\s*[.)-]|[-–•*])\s*/, '')).filter(Boolean);
  const temps = lignes.filter(l => /^temps\s*:/i.test(l)), et = lignes.filter(l => !/^temps\s*:/i.test(l));
  const etapes = temps.concat(et.map((l, i) => (i + 1) + '. ' + l)).join('\n');
  if (!f.titre.trim()) return toast('Le titre est obligatoire.');
  if (!ingredients.length) return toast('Ajoutez au moins un ingrédient.');
  if (!et.length) return toast('Ajoutez les étapes de préparation.');
  const aliments = f.aliments.trim() || ingredients.filter(i => !enStock(i.n)).slice(0, 5).map(i => i.n.replace(/\(.*?\)/g, '').trim()).join(', ');
  S.busy = true; renderKeep();
  try {
    const res = await api('addRecette', { recette: Object.assign({}, f, { titre: f.titre.trim(), ingredients, etapes, aliments, saisons: saisonsTexte(f.saisons || []) }) });
    brouillon = null; store.set('brouillon', null);
    if (res.statut === A_VALIDER) {
      propositions.push({ titre: res.titre, date: dateFr() }); store.set('propositions', propositions);
      toast('Merci ! La recette apparaîtra après validation par ' + OWNER + '.', 5000);
    } else toast('Recette publiée 🎉');
    S.busy = false;
    await refresh(true);
    go('list');
  } catch (e) { S.busy = false; renderKeep(); toast(e.message, 5000); }
}

/* ---------- Profil ---------- */
function renderMoi() {
  const roleTxt = { admin: 'Propriétaire du carnet : vous validez les recettes et vos notes vont dans vos colonnes du Sheet.', famille: 'Famille : vous pouvez proposer des recettes, noter et commenter.' }[profil.role] || 'Lecture seule : entrez le code famille pour proposer des recettes et commenter.';
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('app').innerHTML = `
    <header><h1>${profil.prenom ? 'Bonjour ' + esc(profil.prenom) : 'Mon profil'}</h1><div class="meta">${roleTxt}</div></header>
    <main>
      <section>
        <h3>Profil</h3>
        <label class="lbl">Prénom (affiché avec vos commentaires)</label>
        <input class="field" id="fPrenom" value="${esc(profil.prenom)}" autocomplete="given-name">
        <label class="lbl">Code d'accès</label>
        <input class="field" id="fCode" value="${esc(profil.code)}" autocomplete="off" autocapitalize="off" placeholder="Code famille">
        <button class="btn" data-act="saveProfil">Enregistrer</button>
      </section>
      ${propositions.length ? `<section><h3>Mes recettes en attente</h3>${propositions.map((p, i) => `<div class="row"><div class="name">${esc(p.titre)}<small>Envoyée le ${esc(p.date)}</small></div><button class="x" data-act="propDel" data-i="${i}">✕</button></div>`).join('')}</section>` : ''}
      <section>
        <h3>Toujours à la maison</h3>
        <div class="hint">Ces produits n'apparaissent pas dans la liste de courses et ne comptent pas comme manquants dans « Avec ce que j'ai ».</div>
        <div class="chips wrap">${stock.map((s, i) => `<button class="chip" data-act="stockDelI" data-i="${i}">${esc(s)} ✕</button>`).join('')}</div>
        <div class="add"><input class="field" id="sNom" placeholder="Ex : huile d'olive" autocomplete="off"><button class="go" data-act="stockNew">＋</button></div>
      </section>
      ${standalone ? '' : `<section><h3>Installer l'app</h3>
        ${isIOS ? '<div>Dans Safari, touchez <b>Partager</b> (carré avec une flèche) puis <b>« Sur l\'écran d\'accueil »</b>.</div>'
          : deferredPrompt ? '<button class="btn" data-act="install">Installer sur l\'écran d\'accueil</button>'
          : '<div>Dans Chrome, ouvrez le menu <b>⋮</b> puis <b>« Ajouter à l\'écran d\'accueil »</b> ou <b>« Installer l\'application »</b>.</div>'}
      </section>`}
      <section>
        <h3>Partager l'app</h3>
        <div class="hint">Envoyez le lien à vos proches${isAdmin() ? ', avec le code famille si vous voulez qu\'ils puissent ajouter des recettes et commenter' : ''}.</div>
        <button class="btn ghost" data-act="shareApp">📤 Envoyer le lien</button>
      </section>
      <button class="btn ghost" data-act="reload">↻ Actualiser les recettes</button>
      <div class="hint" style="text-align:center;margin-top:14px">Favoris, menu, liste de courses et minuteurs sont enregistrés sur ce téléphone.</div>
    </main>`;
  $('sNom').onkeydown = e => { if (e.key === 'Enter') ACT.stockNew(); };
}

async function saveProfil() {
  const prenom = ($('fPrenom').value || '').trim().slice(0, 40);
  const code = ($('fCode').value || '').trim();
  if (!prenom) return toast('Indiquez votre prénom.');
  profil.prenom = prenom; profil.code = code;
  if (code) {
    try {
      const r = await api('role');
      profil.role = r.role;
      if (!r.role) toast('Code incorrect : vous restez en lecture seule.', 4500);
      else toast(r.role === 'admin' ? 'Bienvenue ' + prenom + ' : mode propriétaire activé.' : 'Code accepté : vous pouvez ajouter des recettes et commenter.', 4500);
    } catch (e) { toast(e.message, 5000); }
  } else { profil.role = null; toast('Profil enregistré.'); }
  store.set('profil', profil); closeModal();
  await refresh(true); renderKeep();
}

/* ---------- Fenêtre modale ---------- */
function openModal(html) { $('modal').innerHTML = `<div class="overlay" data-act="overlay"><div class="sheet">${html}</div></div>`; }
function closeModal() { if ($('modal')) $('modal').innerHTML = ''; }
function welcome() {
  openModal(`
    <h2>Bienvenue dans le carnet de recettes 👋</h2>
    <div class="hint">Votre prénom sert à signer vos commentaires.</div>
    <label class="lbl">Votre prénom</label>
    <input class="field" id="fPrenom" autocomplete="given-name">
    <label class="lbl">Code famille (facultatif)</label>
    <input class="field" id="fCode" autocomplete="off" autocapitalize="off" placeholder="Pour ajouter des recettes et commenter">
    <button class="btn" data-act="saveProfil">Continuer</button>
    <button class="btn ghost" data-act="closeModal" style="border-color:var(--line);color:var(--muted)">Plus tard (lecture seule)</button>`);
}

/* ---------- Actions (un seul gestionnaire de clics) ---------- */
const ACT = {
  retry: () => refresh(true),
  tab: el => go(el.dataset.v),
  open: el => { if (rec(el.dataset.t)) go('recipe', { titre: el.dataset.t }); },
  back: () => history.length > 1 ? history.back() : go('list'),
  filtre: el => { S.filtre = el.dataset.k; renderList(); },
  frigoAdd: () => {
    const v = $('frigoIn').value.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
    v.forEach(x => { if (!frigoItems.some(y => norm(y) === norm(x))) frigoItems.push(x); });
    store.set('frigo', frigoItems); renderKeep(); if ($('frigoIn')) $('frigoIn').focus();
  },
  frigoDel: el => { frigoItems.splice(+el.dataset.i, 1); store.set('frigo', frigoItems); renderKeep(); },
  frigoClear: () => {
    if (S.confirm !== 'frigo') { S.confirm = 'frigo'; return renderKeep(); }
    S.confirm = null; frigoItems = []; store.set('frigo', frigoItems); renderKeep();
  },
  frigoType: el => { S.frigoType = el.dataset.t; renderKeep(); },
  frigo: () => { S.frigo = !S.frigo; renderList(); const i = $('frigoQ') || $('q'); if (S.frigo) i.focus(); },
  type: el => { S.type = el.dataset.t; renderList(); },
  check: el => { S.done[el.dataset.k] = !S.done[el.dataset.k]; el.classList.toggle('done'); saveCuisine(); },
  portions: el => { const p = S.portions + (+el.dataset.d); if (p >= 1 && p <= 99) { S.portions = p; saveCuisine(); renderKeep(); } },
  perso: el => {
    const k = el.dataset.k, l = perso[k], t = S.open;
    perso[k] = l.includes(t) ? l.filter(x => x !== t) : l.concat(t);
    store.set('perso', perso); renderKeep();
  },
  wake: () => { S.wake = !S.wake; wake(); renderKeep(); toast(S.wake ? 'L\'écran restera allumé sur cette recette.' : 'Mise en veille normale.'); },
  menuSheet: () => menuSheet(S.open),
  setJour: el => setJour(el.dataset.j),
  unmenu: () => { menu = menu.filter(m => m.titre !== S.sheetTitre); store.set('menu', menu); closeModal(); renderKeep(); },
  closeModal: () => closeModal(),
  overlay: (el, e) => { if (e.target === el) closeModal(); },
  pas: () => {
    const reprise = cuisine && cuisine.titre === S.open && cuisine.i != null && Date.now() - cuisine.ts < 12 * 3600e3;
    S.pas = { i: reprise ? cuisine.i : 0 };
    history.pushState({ view: 'recipe', titre: S.open, pas: true }, ''); renderPas(); wake(); saveCuisine();
  },
  pasNext: () => { S.pas.i++; saveCuisine(); renderPas(); },
  pasPrev: () => { if (S.pas.i > 0) { S.pas.i--; saveCuisine(); renderPas(); } },
  pasClose: el => {
    const fini = el && /Terminé/.test(el.textContent);
    S.pas = null; renderPasClose();
    if (fini) { cuisine = null; store.set('cuisine', null); } else saveCuisine();
    history.back();
  },
  timer: el => startTimer(+el.dataset.sec, el.dataset.label),
  timerStop: el => { timers = timers.filter(t => t.id !== el.dataset.id); store.set('timers', timers); renderTimers(); },
  ownerStar: el => {
    const r = rec(S.open), n = +el.dataset.n;
    r.note = num(r.note) === n ? '' : String(n);
    document.querySelectorAll('[data-act=ownerStar]').forEach(s => s.classList.toggle('on', (num(r.note) || 0) >= +s.dataset.n));
    saveAvis();
  },
  today: () => { $('premiere').value = dateFr(); $('premiere').dispatchEvent(new Event('input')); },
  saveAvis: () => saveAvis(),
  comStar: el => { const n = +el.dataset.n; S.comNote = S.comNote === n ? 0 : n; document.querySelectorAll('[data-act=comStar]').forEach(s => s.classList.toggle('on', S.comNote >= +s.dataset.n)); },
  addCom: async el => {
    const texte = $('comTxt').value.trim();
    if (!texte && !S.comNote) return toast('Écrivez un commentaire ou donnez une note.');
    el.disabled = true;
    try {
      const c = await api('addComment', { titre: S.open, note: S.comNote, texte });
      DATA.commentaires.push(c); store.set('data', DATA); S.comNote = 0; renderKeep(); toast('Merci pour votre avis !');
    } catch (e) { el.disabled = false; toast(e.message, 5000); }
  },
  delCom: async el => {
    const id = el.dataset.id;
    if (S.confirm !== 'com' + id) { S.confirm = 'com' + id; return renderKeep(); }
    S.confirm = null;
    try { await api('deleteComment', { id }); DATA.commentaires = DATA.commentaires.filter(c => c.id !== id); store.set('data', DATA); renderKeep(); }
    catch (e) { toast(e.message, 5000); }
  },
  publish: async el => {
    el.disabled = true;
    try { await api('publish', { titre: S.open }); rec(S.open).statut = ''; store.set('data', DATA); toast('Recette publiée 🎉'); renderKeep(); }
    catch (e) { el.disabled = false; toast(e.message, 5000); }
  },
  delrec: async () => {
    if (S.confirm !== 'delrec') { S.confirm = 'delrec'; return renderKeep(); }
    try { await api('deleteRecette', { titre: S.open }); DATA.recettes = DATA.recettes.filter(r => r.titre !== S.open); store.set('data', DATA); toast('Recette supprimée.'); go('list'); }
    catch (e) { toast(e.message, 5000); }
  },
  addMenu: () => {
    const t = $('addR').value; if (!t) return toast('Choisissez une recette.');
    const r = rec(t); menu.push({ id: uid(), titre: t, portions: num(r.portions) || '', jour: $('addJ').value });
    store.set('menu', menu); renderKeep();
  },
  mPortions: el => {
    const m = menu.find(x => x.id === el.dataset.id), r = rec(m.titre);
    const p = (num(m.portions) || num(r.portions)) + (+el.dataset.d);
    if (p >= 1 && p <= 99) { m.portions = p; store.set('menu', menu); renderKeep(); }
  },
  mDel: el => { menu = menu.filter(x => x.id !== el.dataset.id); store.set('menu', menu); renderKeep(); },
  pAdd: () => {
    const nom = $('pNom').value.trim(); if (!nom) return;
    produits.push({ nom, rayon: $('pRayon').value }); store.set('produits', produits); renderKeep();
    $('pNom') && $('pNom').focus();
  },
  pDel: el => { produits.splice(+el.dataset.i, 1); store.set('produits', produits); renderKeep(); },
  ck: (el, e) => {
    if (e.target.closest('.home')) return;
    const k = el.dataset.k; const set = new Set(coches);
    set.has(k) ? set.delete(k) : set.add(k); coches = Array.from(set); store.set('coches', coches); renderKeep();
  },
  stockAdd: el => { if (!enStock(el.dataset.n)) stock.push(el.dataset.n); store.set('stock', stock); renderKeep(); toast('« ' + el.dataset.n + ' » : toujours à la maison.'); },
  stockDel: el => { const n = norm(el.dataset.n); stock = stock.filter(s => !(n === norm(s) || n.startsWith(norm(s) + ' '))); store.set('stock', stock); renderKeep(); },
  stockDelI: el => { stock.splice(+el.dataset.i, 1); store.set('stock', stock); renderKeep(); },
  stockNew: () => { const v = $('sNom').value.trim(); if (v && !enStock(v)) { stock.push(v); store.set('stock', stock); } renderKeep(); },
  batchAdd: el => menuSheet(el.dataset.t),
  batchHide: el => { batchIgnore.push(el.dataset.t); store.set('batchIgnore', batchIgnore); renderKeep(); },
  newWeek: () => {
    if (S.confirm !== 'week') { S.confirm = 'week'; renderKeep(); setTimeout(() => { if (S.confirm === 'week') { S.confirm = null; renderKeep(); } }, 4000); return; }
    S.confirm = null; menu = []; produits = []; coches = []; batchIgnore = []; store.set('batchIgnore', batchIgnore);
    store.set('menu', menu); store.set('produits', produits); store.set('coches', coches); renderKeep();
  },
  share: async () => {
    const text = shareText();
    try { if (navigator.share) { await navigator.share({ title: 'Liste de courses', text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Liste copiée : collez-la dans un message.'); }
    catch (e) { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); }
  },
  fSaison: el => {
    const s = el.dataset.s, f = brouillon;
    f.saisonsAuto = false;
    if (s === 'toutes') f.saisons = NOMS_SAISONS.every(x => f.saisons.includes(x)) ? [] : NOMS_SAISONS.slice();
    else f.saisons = f.saisons.includes(s) ? f.saisons.filter(x => x !== s) : f.saisons.concat(s);
    store.set('brouillon', f); renderSaisonsForm();
  },
  fType: el => { const t = el.dataset.t; brouillon.types = brouillon.types.includes(t) ? brouillon.types.filter(x => x !== t) : brouillon.types.concat(t); store.set('brouillon', brouillon); el.classList.toggle('on'); },
  submitRecette: () => submitRecette(),
  clearForm: () => {
    if (S.confirm !== 'form') { S.confirm = 'form'; return renderKeep(); }
    S.confirm = null; brouillon = blankForm(); store.set('brouillon', brouillon); renderKeep();
  },
  saveProfil: () => saveProfil(),
  propDel: el => { propositions.splice(+el.dataset.i, 1); store.set('propositions', propositions); renderKeep(); },
  install: async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; renderKeep(); } },
  shareApp: async () => {
    const url = location.origin + location.pathname;
    try { if (navigator.share) { await navigator.share({ title: 'Carnet de recettes', url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié.'); } catch (e) { toast(url, 8000); }
  },
  reload: () => { toast('Actualisation…'); refresh(true); }
};

async function saveAvis() {
  const r = rec(S.open);
  const avis = { note: r.note, premiere: $('premiere').value.trim(), commentaires: $('comm').value };
  $('avisEtat').textContent = 'Enregistrement…'; $('saveAvis').style.display = 'none';
  try {
    const v = await api('saveAvis', { titre: r.titre, avis });
    Object.assign(r, v); store.set('data', DATA); S.avisDirty = false;
    if (S.view === 'recipe' && S.open === r.titre) { renderKeep(); if ($('avisEtat')) $('avisEtat').textContent = '✓ Enregistré'; }
  } catch (e) {
    if ($('avisEtat')) $('avisEtat').textContent = '';
    if ($('saveAvis')) $('saveAvis').style.display = 'block';
    toast('Avis non enregistré : ' + e.message, 5000);
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = ACT[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'mJour') {
    const m = menu.find(x => x.id === el.dataset.id); m.jour = el.value; store.set('menu', menu); renderKeep();
  }
});
document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('panier')) S.panierOuvert = e.target.open; }, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { wake(); renderTimers(); if (DATA && !S.pas) refresh(); }
  else saveCuisine();
});

let deferredPrompt = null;
window.addEventListener('pagehide', saveCuisine);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (S.view === 'moi') renderKeep(); });

/* ---------- Mise à jour automatique de l'app ---------- */
const APP_V = +(((document.querySelector('script[src*="app.js"]') || {}).src || '').match(/v=(\d+)/) || [])[1] || 0;
let majEnAttente = false;
async function verifierMaj() {
  try {
    const t = await (await fetch('index.html?maj=' + Date.now(), { cache: 'no-store' })).text();
    const v = +((t.match(/app\.js\?v=(\d+)/) || [])[1] || 0);
    if (!APP_V || v <= APP_V) return;
    majEnAttente = true;
    if (!isBusy() && !S.pas) location.reload();
    else toast('Nouvelle version de l\'app : elle s\'installera à la prochaine ouverture.', 5000);
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifierMaj(); });
setTimeout(verifierMaj, 3000);

/* ---------- Démarrage ---------- */
history.replaceState({ view: 'list' }, '');
if (DATA) { render(); restaurerCuisine(); }
refresh(true).then(() => { restaurerCuisine(); if (DATA && !profil.prenom && !$('modal').innerHTML && !S.pas) welcome(); });
if (timers.length) tick();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
