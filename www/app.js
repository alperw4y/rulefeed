(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const API = 'https://api.rule34.xxx/index.php';
const AC_URLS = ['https://api.rule34.xxx/autocomplete.php', 'https://rule34.xxx/public/autocomplete.php'];
const PAGE = 40;
// Reşit olmayan karakterlere işaret eden etiketler hem sunucu sorgusunda hem istemcide filtrelenir.
const SERVER_NEG = '-loli -shota -child -toddler';
const BLOCK_RE = /(^|_)(loli|lolicon|shota|shotacon|child|children|toddler|underage|minor|preteen|prepubescent|infant|baby|young|younger|cub|kindergarten)(_|$)/i;
const isBlocked = (t) => BLOCK_RE.test(t);
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-9.5-10C1.5 7.5 4 4.5 7.2 4.5c1.9 0 3.7 1 4.8 2.7 1.1-1.7 2.9-2.7 4.8-2.7 3.2 0 5.7 3 4.7 6.5C20 16 12 21 12 21z"/></svg>';
const TYPE_LABEL = { general: 'Genel', artist: 'Sanatçı', copyright: 'Seri', character: 'Karakter', meta: 'Meta' };
const TYPE_BY_NUM = { 0: 'general', 1: 'artist', 2: 'general', 3: 'copyright', 4: 'character', 5: 'meta' };
const QUICK = ['video', 'animated', 'sound', 'sort:score:desc', 'rating:explicit', 'rating:questionable', 'rating:safe'];
const RATES = [1, 1.5, 2];

const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* dolu/engelli */ }
  }
};

const S = {
  view: 'feed',            // 'feed' | 'grid' | 'viewer'
  tags: store.get('tags', ''),
  pid: 0,
  posts: [],
  loaded: new Set(),
  skipped: 0,
  emptyRuns: 0,
  loading: false,
  end: false,
  muted: true,
  rate: RATES.indexOf(store.get('rate', 1)) !== -1 ? store.get('rate', 1) : 1,
  cur: -1,
  gen: 0,
  likes: store.get('likes', []),
  cfg: Object.assign({ user: '', key: '' }, store.get('cfg', {})),
  hist: store.get('hist', [])
};
let likedIds = new Set(S.likes.map((p) => p.id));
const typeCache = new Map();
const SEEN_MAX = 50000;
let seenList = store.get('seen', []);
if (!Array.isArray(seenList)) seenList = [];
const seenSet = new Set(seenList);
let seenSaveT = 0, seenT = 0;
// iOS'un eski sürümleri WebM oynatamaz; desteklemiyorsa bu gönderileri baştan ele
const CAN_WEBM = (() => {
  try { const v = document.createElement('video'); return !!(v.canPlayType && v.canPlayType('video/webm')); } catch (e) { return true; }
})();

const feed = $('#feed');
const https = (u) => String(u || '').replace(/^http:\/\//i, 'https://');

/* ---------- görülenler (kalıcı) ---------- */
function saveSeen() {
  clearTimeout(seenSaveT);
  seenSaveT = 0;
  store.set('seen', seenList);
}
function markSeen(id) {
  if (seenSet.has(id)) return;
  seenSet.add(id);
  seenList.push(id);
  if (seenList.length > SEEN_MAX) seenList.splice(0, 5000).forEach((x) => seenSet.delete(x));
  if (!seenSaveT) seenSaveT = setTimeout(saveSeen, 1500);
}
function resetSeen() {
  seenList = [];
  seenSet.clear();
  saveSeen();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSeen(); });
window.addEventListener('pagehide', saveSeen);

/* ---------- yardımcılar ---------- */
let toastT;
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
function spinner(on) { $('#spin').style.display = on ? 'block' : 'none'; }
function showMsg(text, label, fn) {
  $('#msgT').textContent = text;
  $('#msgS').innerHTML = '';
  const b = $('#msgB');
  if (label) { b.textContent = label; b.hidden = false; b.onclick = fn; } else { b.hidden = true; b.onclick = null; }
  $('#msg').hidden = false;
}
function hideMsg() { $('#msg').hidden = true; $('#msgS').innerHTML = ''; }
function fmtTime(s) {
  s = isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtCount(n) {
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function rateLabel() { return S.rate + 'x'; }
function updateTop() {
  const t = $('#tagBtn');
  if (S.view === 'grid') t.textContent = '\u2039 Akış';
  else if (S.view === 'viewer') t.textContent = '\u2039 Beğenilenler';
  else t.textContent = S.tags || 'Etiket ara…';
  $('#likesBtn').classList.toggle('on', S.view !== 'feed');
}

/* ---------- API ---------- */
function normType(t) {
  if (t === undefined || t === null || t === '') return '';
  if (typeof t === 'number' || /^\d+$/.test(String(t))) return TYPE_BY_NUM[Number(t)] || 'general';
  const s = String(t).toLowerCase();
  if (s === 'metadata') return 'meta';
  if (s === 'tag') return 'general';
  if (s === 'series') return 'copyright';
  return TYPE_LABEL[s] ? s : '';
}
function labelCount(l) {
  const m = String(l || '').match(/\((\d+)\)\s*$/);
  return m ? Number(m[1]) : 0;
}

function norm(p) {
  const file = https(p.file_url);
  if (!file || !p.id) return null;
  const ext = (file.split('?')[0].split('.').pop() || '').toLowerCase();
  const video = ['mp4', 'webm', 'mov', 'm4v'].indexOf(ext) !== -1;
  if (ext === 'webm' && !CAN_WEBM) return null;
  const tags = String(p.tags || '').trim().split(/\s+/).filter(Boolean);
  if (tags.some(isBlocked)) return null;
  const sample = https(p.sample_url);
  const prev = https(p.preview_url);
  return {
    id: String(p.id),
    type: video ? 'video' : 'image',
    src: video ? file : (sample || file),
    poster: video ? (sample || prev) : prev,
    tags: tags,
    score: Number(p.score) || 0
  };
}

function authParams(q) {
  if (S.cfg.user) q.user_id = S.cfg.user;
  if (S.cfg.key) q.api_key = S.cfg.key;
  return q;
}

async function getJSON(url, signal) {
  const r = await fetch(url, { cache: 'no-store', signal: signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (!t.trim()) return null;
  return JSON.parse(t);
}

async function fetchPage(pid) {
  const q = authParams({
    page: 'dapi', s: 'post', q: 'index', json: '1',
    limit: String(PAGE), pid: String(pid),
    tags: (S.tags + ' ' + SERVER_NEG).trim()
  });
  const url = API + '?' + new URLSearchParams(q).toString();
  let r;
  try {
    r = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error('Bağlantı kurulamadı. VPN açık mı? (Tarayıcıda test ediyorsan CORS da sebep olabilir; iOS uygulamasında bu sorun yok.)');
  }
  const t = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 100));
  if (!t.trim()) return [];
  let j;
  try { j = JSON.parse(t); } catch (e) { throw new Error(t.replace(/<[^>]+>/g, ' ').trim().slice(0, 160) || 'Yanıt çözümlenemedi'); }
  return Array.isArray(j) ? j : [];
}

async function loadMore() {
  if (S.loading || S.end || S.view !== 'feed') return;
  const gen = S.gen;
  S.loading = true;
  spinner(true);
  let again = false;
  try {
    const raw = await fetchPage(S.pid);
    if (gen !== S.gen) return;
    S.pid++;
    if (raw.length < PAGE) S.end = true;
    const fresh = [];
    for (const r of raw) {
      const p = norm(r);
      if (!p || S.loaded.has(p.id)) continue;
      if (seenSet.has(p.id)) { S.skipped++; continue; }
      S.loaded.add(p.id);
      fresh.push(p);
    }
    if (fresh.length) {
      S.emptyRuns = 0;
      hideMsg();
      addSlides(fresh);
    } else if (!S.end) {
      S.emptyRuns++;
      if (S.emptyRuns >= 25) S.end = true; else again = true;
    }
    if (!S.posts.length && S.end) {
      if (S.skipped > 0) {
        showMsg('Bu etiketlerde görmediğin içerik kalmadı.', 'Görülenleri sıfırla', () => { resetSeen(); resetFeed(); });
      } else {
        showMsg(S.tags ? 'Bu etiketlerle sonuç bulunamadı. Etiket adı yanlış yazılmış olabilir.' : 'Sonuç bulunamadı.', 'Etiket ara', openSheet);
        if (S.tags) didYouMean(gen);
      }
    }
  } catch (e) {
    if (gen !== S.gen) return;
    if (S.posts.length) toast(e.message);
    else showMsg(e.message, 'Ayarlar', openSheet);
  } finally {
    if (gen === S.gen) { S.loading = false; spinner(false); }
  }
  if (again && gen === S.gen) loadMore();
}

/* ---------- etiket önerileri ---------- */
async function autocomplete(q, signal) {
  for (const base of AC_URLS) {
    try {
      const j = await getJSON(base + '?q=' + encodeURIComponent(q), signal);
      if (Array.isArray(j)) {
        return j.map((x) => ({
          name: String(x.value || x.name || ''),
          count: x.count !== undefined ? Number(x.count) || 0 : labelCount(x.label),
          type: normType(x.type !== undefined ? x.type : x.category)
        })).filter((x) => x.name && !isBlocked(x.name));
      }
    } catch (e) {
      if (signal && signal.aborted) return [];
    }
  }
  return null; // ulaşılamadı
}

// Öneride kategori gelmediyse etiket bilgisini ayrı sorgula (başarısız olursa sessizce boş döner)
async function resolveTypes(names) {
  try {
    const q = authParams({ page: 'dapi', s: 'tag', q: 'index', json: '1', names: names.join(' '), limit: String(names.length) });
    const j = await getJSON(API + '?' + new URLSearchParams(q).toString());
    const arr = Array.isArray(j) ? j : (j && j.tag ? [].concat(j.tag) : []);
    const map = {};
    arr.forEach((t) => {
      const n = t && (t.name || (t['@attributes'] && t['@attributes'].name));
      const ty = normType(t && t.type);
      if (n && ty) map[n] = ty;
    });
    return map;
  } catch (e) {
    return {};
  }
}

let acT = 0, acSeq = 0, acCtl = null;
function currentToken() {
  const m = $('#tagInput').value.match(/(\S*)$/);
  return m ? m[1] : '';
}
function renderSugg(items, neg, note) {
  const box = $('#sugg');
  box.innerHTML = '';
  if (note || !items.length) {
    const n = document.createElement('div');
    n.className = 'hint';
    n.textContent = note || 'Eşleşen etiket yok.';
    box.appendChild(n);
    return;
  }
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'sg';
    b.dataset.v = (neg ? '-' : '') + it.name;
    const c = document.createElement('span');
    c.className = 'cat ' + (it.type || '');
    c.textContent = it.type ? TYPE_LABEL[it.type] : 'Etiket';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = it.name;
    const ct = document.createElement('span');
    ct.className = 'ct';
    ct.textContent = fmtCount(it.count);
    b.appendChild(c);
    b.appendChild(nm);
    b.appendChild(ct);
    box.appendChild(b);
  });
}
async function runAC() {
  let tok = currentToken();
  const neg = tok.charAt(0) === '-';
  if (neg) tok = tok.slice(1);
  if (tok.length < 2 || tok.indexOf(':') !== -1) { $('#sugg').innerHTML = ''; return; }
  const seq = ++acSeq;
  if (acCtl) acCtl.abort();
  acCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const items = await autocomplete(tok, acCtl ? acCtl.signal : undefined);
  if (seq !== acSeq) return;
  if (items === null) { renderSugg([], neg, 'Öneri alınamadı. VPN açık mı, API bilgileri girili mi?'); return; }
  const top = items.slice(0, 10);
  top.forEach((it) => { if (!it.type && typeCache.has(it.name)) it.type = typeCache.get(it.name); });
  renderSugg(top, neg);
  const need = top.filter((it) => !it.type).map((it) => it.name);
  if (need.length) {
    const map = await resolveTypes(need);
    if (seq !== acSeq) return;
    Object.keys(map).forEach((k) => typeCache.set(k, map[k]));
    top.forEach((it) => { if (!it.type && map[it.name]) it.type = map[it.name]; });
    renderSugg(top, neg);
  }
}

// Sonuç boşsa yazım hatalarını bulup öner
async function didYouMean(gen) {
  const toks = S.tags.split(/\s+/).filter((t) => t && t.charAt(0) !== '-' && t.indexOf(':') === -1).slice(0, 3);
  const props = [];
  for (const t of toks) {
    const items = await autocomplete(t.replace(/^~/, ''));
    if (gen !== S.gen) return;
    if (!items || !items.length || items.some((x) => x.name === t)) continue;
    props.push({ from: t, to: items[0].name });
  }
  if (!props.length || gen !== S.gen) return;
  const box = $('#msgS');
  box.innerHTML = '';
  props.forEach((pr) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = pr.from + ' \u2192 ' + pr.to;
    b.onclick = () => setTags(S.tags.split(/\s+/).map((x) => (x === pr.from ? pr.to : x)).join(' '));
    box.appendChild(b);
  });
  $('#msgT').textContent = 'Bu etiketlerle sonuç bulunamadı. Şunu mu demek istedin?';
}

/* ---------- akış ---------- */
function makeSlide(p, i) {
  const el = document.createElement('section');
  el.className = 'slide';
  el.dataset.i = String(i);
  el.dataset.id = p.id;

  const side = document.createElement('div');
  side.className = 'side';
  side.innerHTML =
    '<button class="b like" aria-label="Beğen">' + HEART + '<span class="n"></span></button>' +
    '<button class="b mute" aria-label="Ses"></button>' +
    '<a class="b open" target="_blank" rel="noopener noreferrer" aria-label="Orijinal" href="https://rule34.xxx/index.php?page=post&s=view&id=' +
    encodeURIComponent(p.id) + '">\u2197\uFE0E</a>';
  side.querySelector('.n').textContent = String(p.score);
  side.querySelector('.like').classList.toggle('on', likedIds.has(p.id));
  side.querySelector('.mute').textContent = S.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  if (p.type !== 'video') side.querySelector('.mute').style.display = 'none';

  const chips = document.createElement('div');
  chips.className = 'chips';
  p.tags.slice(0, 14).forEach((t) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.t = t;
    c.textContent = t;
    chips.appendChild(c);
  });

  el.appendChild(side);
  el.appendChild(chips);

  if (p.type === 'video') {
    const vc = document.createElement('div');
    vc.className = 'vc';
    vc.innerHTML =
      '<div class="vrow">' +
      '<button class="vb skip" data-d="-10">\u221210s</button>' +
      '<button class="vb skip" data-d="10">+10s</button>' +
      '<button class="vb spd"></button>' +
      '<span class="vt">0:00 / 0:00</span></div>' +
      '<input class="seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Süre">';
    vc.querySelector('.spd').textContent = rateLabel();
    el.appendChild(vc);
  }
  return el;
}

function addSlides(list) {
  const base = S.posts.length;
  S.posts.push.apply(S.posts, list);
  list.forEach((p, k) => {
    const el = makeSlide(p, base + k);
    feed.appendChild(el);
    near.observe(el);
    act.observe(el);
  });
}

function updateVC(slide, v) {
  const t = slide.querySelector('.vt');
  if (!t) return;
  const d = isFinite(v.duration) ? v.duration : 0;
  t.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(d);
  if (!slide.dataset.seeking) {
    const s = slide.querySelector('.seek');
    if (s) s.value = d ? String(Math.round(v.currentTime / d * 1000)) : '0';
  }
}

function mount(slide) {
  if (slide.dataset.m || slide.dataset.bad) return;
  const p = S.posts[Number(slide.dataset.i)];
  if (!p) return;
  let m;
  if (p.type === 'video') {
    m = document.createElement('video');
    m.loop = true;
    m.muted = S.muted;
    m.playsInline = true;
    m.setAttribute('playsinline', '');
    m.setAttribute('webkit-playsinline', '');
    m.preload = 'auto';
    m.defaultPlaybackRate = S.rate;
    m.playbackRate = S.rate;
    if (p.poster) m.poster = p.poster;
    m.addEventListener('timeupdate', () => updateVC(slide, m));
    m.addEventListener('durationchange', () => updateVC(slide, m));
    m.addEventListener('loadedmetadata', () => { m.playbackRate = S.rate; updateVC(slide, m); });
  } else {
    m = document.createElement('img');
    m.decoding = 'async';
    m.draggable = false;
  }
  m.referrerPolicy = 'no-referrer';
  m.className = 'media';
  m.addEventListener('error', () => {
    if (!slide.contains(m)) return;
    m.remove();
    delete slide.dataset.m;
    slide.dataset.bad = '1';
    if (S.view === 'feed') markSeen(p.id); // oynamayan içerik bir daha gelmesin
    let host = '?';
    try { host = new URL(p.src).hostname; } catch (er) { /* yoksay */ }
    const ext = (p.src.split('?')[0].split('.').pop() || '').toLowerCase();
    const code = m.error && m.error.code ? ', kod ' + m.error.code : '';
    const f = document.createElement('div');
    f.className = 'fail';
    f.textContent = (p.type === 'video' ? 'Video' : 'Görsel') + ' yüklenemedi (.' + ext + code + ', ' + host + '). ' +
      (p.type === 'video' ? 'Bu cihaz biçimi desteklemiyor olabilir. ' : 'VPN açık mı? ') + 'Sonrakine geçiliyor…';
    slide.insertBefore(f, slide.firstChild);
    if (slide.dataset.a === '1') {
      setTimeout(() => {
        if (slide.dataset.a !== '1') return;
        const top = (Number(slide.dataset.i) + 1) * feed.clientHeight;
        if (feed.scrollTo) feed.scrollTo({ top: top, behavior: 'smooth' }); else feed.scrollTop = top;
      }, 1200);
    }
  });
  m.src = p.src;
  slide.insertBefore(m, slide.firstChild);
  slide.dataset.m = '1';
  if (slide.dataset.a === '1') play(slide);
}

function unmount(slide) {
  const m = slide.querySelector('.media');
  if (!m) return;
  if (m.tagName === 'VIDEO') { m.pause(); m.removeAttribute('src'); m.load(); }
  m.remove();
  delete slide.dataset.m;
}

function play(slide) {
  const v = slide.querySelector('video');
  if (!v) return;
  v.muted = S.muted;
  v.playbackRate = S.rate;
  const pr = v.play();
  if (pr && pr.catch) pr.catch(() => {});
}

function activate(slide) {
  slide.dataset.a = '1';
  S.cur = Number(slide.dataset.i);
  play(slide);
  if (S.view === 'feed') {
    const cp = S.posts[S.cur];
    clearTimeout(seenT);
    if (cp) seenT = setTimeout(() => markSeen(cp.id), 700);
  }
  if (S.view === 'feed' && S.cur >= S.posts.length - 6) loadMore();
}

function deactivate(slide) {
  slide.dataset.a = '0';
  const v = slide.querySelector('video');
  if (v) v.pause();
}

const near = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) mount(e.target); else unmount(e.target); });
}, { root: feed, rootMargin: '100% 0px' });

const act = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) activate(e.target); else deactivate(e.target); });
}, { root: feed, threshold: 0.6 });

function clearFeed() {
  feed.querySelectorAll('.slide').forEach((s) => { near.unobserve(s); act.unobserve(s); unmount(s); });
  feed.innerHTML = '';
  feed.scrollTop = 0;
  S.posts = [];
  S.loaded.clear();
  S.skipped = 0;
  S.emptyRuns = 0;
  clearTimeout(seenT);
  S.cur = -1;
  S.gen++;
  S.loading = false;
  spinner(false);
  hideMsg();
}

function resetFeed() {
  $('#grid').hidden = true;
  clearFeed();
  S.view = 'feed';
  S.pid = 0;
  S.end = false;
  updateTop();
  loadMore();
}

/* ---------- beğenilenler: ızgara + gezgin ---------- */
function renderGrid() {
  const g = $('#grid');
  g.innerHTML = '';
  g.scrollTop = 0;
  if (!S.likes.length) {
    const d = document.createElement('div');
    d.className = 'gempty';
    d.textContent = 'Henüz beğendiğin bir şey yok. Akışta çift dokunarak beğenebilirsin.';
    g.appendChild(d);
    return;
  }
  S.likes.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'cell';
    b.dataset.i = String(i);
    if (p.poster || p.type !== 'video') {
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.alt = '';
      im.referrerPolicy = 'no-referrer';
      im.addEventListener('error', () => im.remove());
      im.src = p.poster || p.src;
      b.appendChild(im);
    }
    if (p.type === 'video') {
      const v = document.createElement('span');
      v.className = 'vi';
      v.textContent = '\u25B6';
      b.appendChild(v);
    }
    g.appendChild(b);
  });
}

function openGrid() {
  clearFeed();
  S.view = 'grid';
  S.end = true;
  renderGrid();
  $('#grid').hidden = false;
  updateTop();
}

function openViewer(i) {
  $('#grid').hidden = true;
  clearFeed();
  S.view = 'viewer';
  S.end = true;
  updateTop();
  addSlides(S.likes.slice());
  feed.scrollTop = i * feed.clientHeight;
}

$('#grid').addEventListener('click', (e) => {
  const c = e.target.closest('.cell');
  if (c) openViewer(Number(c.dataset.i));
});

/* ---------- beğeni / ses / hız / dokunma ---------- */
function setLike(p, on) {
  if (on === undefined) on = !likedIds.has(p.id);
  if (on && !likedIds.has(p.id)) {
    S.likes.unshift(p);
    likedIds.add(p.id);
    if (S.likes.length > 500) { const r = S.likes.pop(); likedIds.delete(r.id); }
  } else if (!on && likedIds.has(p.id)) {
    S.likes = S.likes.filter((x) => x.id !== p.id);
    likedIds.delete(p.id);
  }
  store.set('likes', S.likes);
  document.querySelectorAll('.slide').forEach((s) => {
    if (s.dataset.id === p.id) s.querySelector('.like').classList.toggle('on', likedIds.has(p.id));
  });
}

function setMuted(m) {
  S.muted = m;
  document.querySelectorAll('video').forEach((v) => { v.muted = m; });
  document.querySelectorAll('.mute').forEach((b) => { b.textContent = m ? '\uD83D\uDD07' : '\uD83D\uDD0A'; });
}

function cycleRate() {
  S.rate = RATES[(RATES.indexOf(S.rate) + 1) % RATES.length];
  store.set('rate', S.rate);
  document.querySelectorAll('video').forEach((v) => { v.playbackRate = S.rate; v.defaultPlaybackRate = S.rate; });
  document.querySelectorAll('.spd').forEach((b) => { b.textContent = rateLabel(); });
}

function heartPop(slide, x, y) {
  const d = document.createElement('div');
  d.className = 'pop';
  d.innerHTML = HEART;
  const r = slide.getBoundingClientRect();
  d.style.left = (x - r.left) + 'px';
  d.style.top = (y - r.top) + 'px';
  slide.appendChild(d);
  setTimeout(() => d.remove(), 750);
}

let lastTap = 0, lastSlide = null, tapT = null;
feed.addEventListener('click', (e) => {
  const slide = e.target.closest('.slide');
  if (!slide) return;
  const p = S.posts[Number(slide.dataset.i)];
  if (!p) return;
  const chip = e.target.closest('.chip');
  if (chip) { setTags(chip.dataset.t); return; }
  if (e.target.closest('.like')) { setLike(p); return; }
  if (e.target.closest('.mute')) { setMuted(!S.muted); return; }
  if (e.target.closest('.open')) return;
  const sk = e.target.closest('.skip');
  if (sk) {
    const v = slide.querySelector('video');
    if (v) {
      const max = isFinite(v.duration) ? v.duration : Infinity;
      v.currentTime = Math.max(0, Math.min(max, v.currentTime + Number(sk.dataset.d)));
      updateVC(slide, v);
    }
    return;
  }
  if (e.target.closest('.spd')) { cycleRate(); return; }
  if (e.target.closest('.vc')) return;
  const now = Date.now();
  if (now - lastTap < 300 && lastSlide === slide) {
    clearTimeout(tapT);
    lastTap = 0;
    setLike(p, true);
    heartPop(slide, e.clientX, e.clientY);
  } else {
    lastTap = now;
    lastSlide = slide;
    clearTimeout(tapT);
    tapT = setTimeout(() => {
      const v = slide.querySelector('video');
      if (v) { if (v.paused) play(slide); else v.pause(); }
    }, 300);
  }
});

// Süre çubuğu
feed.addEventListener('input', (e) => {
  const r = e.target.closest ? e.target.closest('.seek') : null;
  if (!r) return;
  const slide = r.closest('.slide');
  const v = slide && slide.querySelector('video');
  if (!v || !isFinite(v.duration)) return;
  v.currentTime = v.duration * Number(r.value) / 1000;
  updateVC(slide, v);
});
feed.addEventListener('pointerdown', (e) => {
  const r = e.target.closest ? e.target.closest('.seek') : null;
  if (r) r.closest('.slide').dataset.seeking = '1';
});
function endSeek() {
  feed.querySelectorAll('.slide').forEach((s) => { delete s.dataset.seeking; });
}
document.addEventListener('pointerup', endSeek);
document.addEventListener('pointercancel', endSeek);

/* ---------- etiket / ayar paneli ---------- */
function renderHist() {
  const box = $('#hist');
  box.innerHTML = '';
  S.hist.forEach((t) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = t;
    c.onclick = () => { closeSheet(); setTags(t); };
    box.appendChild(c);
  });
}
function renderQuick() {
  const box = $('#quick');
  QUICK.forEach((t) => {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = t;
    c.onclick = () => {
      const inp = $('#tagInput');
      const cur = inp.value.trim().split(/\s+/).filter(Boolean);
      if (cur.indexOf(t) === -1) cur.push(t);
      inp.value = cur.join(' ') + ' ';
    };
    box.appendChild(c);
  });
}
function openSheet() {
  $('#tagInput').value = S.tags ? S.tags + ' ' : '';
  $('#uidInput').value = S.cfg.user;
  $('#keyInput').value = S.cfg.key;
  updateSeenHint();
  $('#sugg').innerHTML = '';
  renderHist();
  $('#sheet').classList.add('open');
  $('#scrim').classList.add('open');
}
function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#scrim').classList.remove('open');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function setTags(raw) {
  let parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const bad = parts.filter((x) => x.charAt(0) !== '-' && isBlocked(x));
  if (bad.length) {
    toast('Engellenen etiket çıkarıldı: ' + bad.join(', '));
    parts = parts.filter((x) => bad.indexOf(x) === -1);
  }
  S.tags = parts.join(' ');
  store.set('tags', S.tags);
  if (S.tags) {
    S.hist = [S.tags].concat(S.hist.filter((x) => x !== S.tags)).slice(0, 12);
    store.set('hist', S.hist);
  }
  resetFeed();
}

function onTagBtn() {
  if (S.view === 'feed') openSheet();
  else if (S.view === 'viewer') openGrid();
  else resetFeed();
}
function onLikesBtn() {
  if (S.view === 'grid') resetFeed(); else openGrid();
}

$('#tagBtn').onclick = onTagBtn;
$('#likesBtn').onclick = onLikesBtn;
$('#setBtn').onclick = openSheet;
$('#scrim').onclick = closeSheet;
$('#applyBtn').onclick = () => { closeSheet(); setTags($('#tagInput').value); };
$('#tagInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#applyBtn').click(); });
$('#tagInput').addEventListener('input', () => { clearTimeout(acT); acT = setTimeout(runAC, 250); });
$('#sugg').addEventListener('click', (e) => {
  const b = e.target.closest('.sg');
  if (!b) return;
  const inp = $('#tagInput');
  inp.value = inp.value.replace(/\S*$/, '') + b.dataset.v + ' ';
  $('#sugg').innerHTML = '';
  inp.focus();
});
$('#saveBtn').onclick = () => {
  S.cfg = { user: $('#uidInput').value.trim(), key: $('#keyInput').value.trim() };
  store.set('cfg', S.cfg);
  closeSheet();
  setTags($('#tagInput').value);
};

function updateSeenHint() {
  $('#seenHint').textContent = seenList.length + ' içerik görüldü olarak işaretli; akışta tekrar gösterilmez.';
}
let resetArm = 0;
$('#resetSeen').onclick = () => {
  const b = $('#resetSeen');
  if (!resetArm) {
    b.textContent = 'Emin misin? Tekrar dokun';
    resetArm = setTimeout(() => { resetArm = 0; b.textContent = 'Görülenleri sıfırla'; }, 3500);
    return;
  }
  clearTimeout(resetArm);
  resetArm = 0;
  b.textContent = 'Görülenleri sıfırla';
  resetSeen();
  updateSeenHint();
  closeSheet();
  toast('Görülenler sıfırlandı');
  resetFeed();
};

/* ---------- başlat ---------- */
function start() {
  updateTop();
  if (!S.cfg.user || !S.cfg.key) {
    showMsg('Başlamak için rule34.xxx API bilgilerini (user_id ve api_key) ayarlardan gir.', 'Ayarlar', openSheet);
    return;
  }
  resetFeed();
}

renderQuick();
if (store.get('age_ok', false)) {
  start();
} else {
  $('#gate').hidden = false;
  $('#gateOk').onclick = () => {
    store.set('age_ok', true);
    $('#gate').hidden = true;
    start();
  };
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
})();
