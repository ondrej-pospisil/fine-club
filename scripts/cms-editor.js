/* FINE CMS — editor textů přímo na stránce (načítá se jen přes scripts/cms.py) */
(() => {
  'use strict';

  const cfg = window.FINE_CMS;
  const html = document.documentElement;
  const DRAFT_KEY = `fine-cms:draft:${cfg.page}`;
  const PREF_KEY = 'fine-cms:autosave';
  const AUTOSAVE_DELAY = 1200;
  const RETRY_DELAY = 5000;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* plné úložiště */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  /* Stav editoru ------------------------------------------------------------ */
  const base = new Map();      // id → obsah při načtení / po posledním uložení
  const pending = new Map();   // id → { html, base }
  let meta = {};
  let unresolvedDraft = null;  // koncept z minula, o kterém se ještě nerozhodlo
  let saving = false;
  let saveTimer = 0;
  let retryTimer = 0;
  let autosave = store.get(PREF_KEY) !== false;

  /* Styl ---------------------------------------------------------------------- */
  const style = document.createElement('style');
  style.textContent = `
    .fade, .rise > span, .wipe, .fig img { opacity: 1 !important; transform: none !important; clip-path: none !important; }
    .ticket__stamp { pointer-events: auto !important; }
    .dock { display: none !important; }
    section[hidden] { display: block !important; position: relative; opacity: .45; outline: 2px dashed rgba(192, 83, 58, .7); outline-offset: -2px; }
    section[hidden]::before { content: "Skrytá sekce — na webu se nezobrazuje"; position: absolute; top: 12px; left: 50%; z-index: 5; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px; background: #C0533A; color: #fff; font: 500 12px 'Archivo', sans-serif; letter-spacing: 0; text-transform: none; }
    body { padding-bottom: var(--cms-bar-h, 150px); }
    [data-cms] { outline: 1px dashed transparent; outline-offset: 4px; cursor: text; transition: outline-color .2s, background-color .2s; }
    [data-cms]:hover { outline-color: rgba(160, 127, 82, .75); }
    [data-cms]:focus { outline: 2px solid #A07F52; }
    [data-cms].cms-dirty { outline: 1px solid #C7A97B; background: rgba(199, 169, 123, .14); }
    [data-cms].cms-conflict { outline: 2px solid #C0533A; background: rgba(192, 83, 58, .12); }

    .cms-ui, .cms-ui * { box-sizing: border-box; font-family: 'Archivo', system-ui, sans-serif; letter-spacing: 0; text-transform: none; }
    .cms-ui { position: fixed; z-index: 99999; color: #F4F0E8; background: #0E212D; border-radius: 12px;
      box-shadow: 0 24px 60px -24px rgba(0, 0, 0, .7); font-size: 13px; line-height: 1.35; }
    .cms-ui button, .cms-ui select, .cms-ui input, .cms-ui textarea, .cms-ui a.cms-btn {
      font: inherit; color: inherit; background: rgba(244, 240, 232, .08); text-decoration: none;
      border: 1px solid rgba(244, 240, 232, .18); border-radius: 7px; padding: 7px 11px; cursor: pointer; }
    .cms-ui select option { color: #16303F; }
    .cms-ui button:disabled { opacity: .4; cursor: default; }
    .cms-ui .cms-primary { background: #C7A97B; color: #14232C; border-color: #C7A97B; font-weight: 500; }

    .cms-bar { left: 12px; right: 12px; bottom: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
    .cms-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
    .cms-brand { font-family: 'Fraunces', serif !important; font-size: 15px; margin-right: 4px; }
    .cms-grow { flex: 1; }
    .cms-status { display: inline-flex; align-items: center; gap: 7px; opacity: .85; }
    .cms-status i { width: 8px; height: 8px; border-radius: 50%; background: #6FBF8E; }
    .cms-status[data-tone="busy"] i { background: #C7A97B; }
    .cms-status[data-tone="warn"] i { background: #E0A04A; }
    .cms-status[data-tone="error"] i { background: #C0533A; }
    .cms-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; opacity: .85; }

    .cms-states { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 10px; border-top: 1px solid rgba(244, 240, 232, .12); }
    .cms-states > span { opacity: .6; margin-right: 4px; }
    .cms-chip { position: relative; border-radius: 999px !important; padding: 6px 12px !important; }
    .cms-chip[aria-pressed="true"] { background: #F4F0E8 !important; color: #14232C !important; border-color: #F4F0E8 !important; }
    .cms-chip .cms-live { display: none; margin-left: 6px; font-size: 11px; color: #6FBF8E; }
    .cms-chip.is-live .cms-live { display: inline; }
    .cms-chip[aria-pressed="true"] .cms-live { color: #2E7D4F; }
    .cms-state-hint { flex-basis: 100%; opacity: .7; font-size: 12px; }
    .cms-collapse { padding: 7px 9px !important; }
    .cms-bar.is-collapsed .cms-states, .cms-bar.is-collapsed [data-open], .cms-bar.is-collapsed .cms-toggle, .cms-bar.is-collapsed .cms-page { display: none; }

    .cms-panel { left: 12px; bottom: calc(var(--cms-bar-h, 150px) + 8px); width: min(560px, calc(100vw - 24px)); max-height: 60vh; overflow: auto;
      padding: 16px; display: none; flex-direction: column; gap: 12px; }
    .cms-panel.is-open { display: flex; }
    .cms-panel h3 { margin: 0; font-size: 14px; font-weight: 500; color: #F4F0E8; }
    .cms-panel label { display: flex; flex-direction: column; gap: 6px; }
    .cms-panel small { opacity: .6; }
    .cms-panel ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .cms-panel li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px;
      border-radius: 8px; background: rgba(244, 240, 232, .05); }
    .cms-panel .cms-conflict-item { flex-direction: column; align-items: stretch; }
    .cms-panel blockquote { margin: 0; padding: 8px 10px; border-left: 2px solid rgba(244, 240, 232, .3); opacity: .8; }
    .cms-banner { top: 84px; left: 50%; transform: translateX(-50%); width: min(620px, calc(100vw - 24px));
      padding: 14px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .cms-banner p { margin: 0; flex: 1 1 260px; color: #F4F0E8; }
  `;
  document.head.append(style);

  /* Lišta ---------------------------------------------------------------------- */
  const bar = document.createElement('div');
  bar.className = 'cms-ui cms-bar';
  const pageOptions = Object.entries(cfg.pages)
    .map(([path, label]) => `<option value="${esc(path)}"${path === cfg.page ? ' selected' : ''}>${esc(label)}</option>`).join('');
  bar.innerHTML = `
    <div class="cms-row">
      <button type="button" class="cms-collapse" aria-label="Sbalit lištu" title="Sbalit / rozbalit">▾</button>
      <span class="cms-brand">FINE CMS</span>
      <select class="cms-page" aria-label="Stránka">${pageOptions}</select>
      <button type="button" data-open="seo">SEO</button>
      <button type="button" data-open="history">Historie</button>
      <span class="cms-grow"></span>
      <span class="cms-status" role="status"><i></i><span>Vše uloženo</span></span>
      <label class="cms-toggle"><input type="checkbox" class="cms-autosave"> Ukládat automaticky</label>
      <button type="button" class="cms-primary cms-save" disabled>Uložit</button>
    </div>
    ${cfg.states.length ? `
    <div class="cms-states" role="group" aria-label="Verze stránky">
      <span>Verze stránky:</span>
      ${cfg.states.map((st) => `<button type="button" class="cms-chip" data-state="${esc(st.attr)}" data-slug="${esc(st.slug)}">${esc(st.label)}<span class="cms-live">● živě</span></button>`).join('')}
      <span class="cms-grow"></span>
      <a class="cms-btn cms-preview" target="_blank" rel="noopener">Náhled ↗</a>
      <button type="button" class="cms-make-live">Nastavit jako živou</button>
      <span class="cms-state-hint"></span>
    </div>` : ''}
  `;
  document.body.append(bar);

  const syncBarHeight = () => html.style.setProperty('--cms-bar-h', `${bar.offsetHeight + 24}px`);
  new ResizeObserver(syncBarHeight).observe(bar);
  syncBarHeight();
  const collapseBtn = $('.cms-collapse', bar);
  const setCollapsed = (on) => {
    bar.classList.toggle('is-collapsed', on);
    collapseBtn.textContent = on ? '▴' : '▾';
    store.set('fine-cms:collapsed', on);
  };
  collapseBtn.addEventListener('click', () => setCollapsed(!bar.classList.contains('is-collapsed')));
  setCollapsed(store.get('fine-cms:collapsed') === true);

  const statusEl = $('.cms-status', bar);
  const saveBtn = $('.cms-save', bar);
  const autosaveBox = $('.cms-autosave', bar);
  autosaveBox.checked = autosave;

  const setStatus = (text, tone = 'ok') => {
    statusEl.dataset.tone = tone;
    $('span', statusEl).textContent = text;
  };
  const hasPending = () => pending.size > 0 || Object.keys(meta).length > 0;
  const refresh = () => {
    saveBtn.disabled = saving || !hasPending();
    const conflictOpen = document.querySelector('.cms-panel[data-panel="conflict"].is-open');
    if (!saving && hasPending() && !conflictOpen && statusEl.dataset.tone !== 'error') setStatus(`Neuloženo: ${pending.size + Object.keys(meta).length}`, 'busy');
  };

  /* Panely --------------------------------------------------------------------- */
  const panel = (name, inner) => {
    const el = document.createElement('div');
    el.className = 'cms-ui cms-panel';
    el.dataset.panel = name;
    el.innerHTML = inner;
    document.body.append(el);
    return el;
  };
  const togglePanel = (name, force) => {
    $$('.cms-panel').forEach((p) => p.classList.toggle('is-open', p.dataset.panel === name ? force ?? !p.classList.contains('is-open') : false));
  };
  $$('[data-open]', bar).forEach((btn) => btn.addEventListener('click', () => {
    togglePanel(btn.dataset.open);
    if (btn.dataset.open === 'history') loadHistory();
  }));

  /* SEO */
  const metaDesc = $('meta[name="description"]');
  const seoPanel = panel('seo', `
    <h3>SEO — jak stránku uvidí Google</h3>
    <label>Titulek stránky <input class="cms-title" maxlength="120"><small class="cms-title-count"></small></label>
    <label>Popis ve výsledcích hledání <textarea class="cms-desc" rows="3" maxlength="300"></textarea><small class="cms-desc-count"></small></label>
  `);
  const titleInput = $('.cms-title', seoPanel);
  const descInput = $('.cms-desc', seoPanel);
  const baseTitle = document.title.replace(/^[^·]+ · (?=Networking)/, '');
  titleInput.value = baseTitle;
  descInput.value = metaDesc ? metaDesc.content : '';
  const counts = () => {
    $('.cms-title-count', seoPanel).textContent = `${titleInput.value.length} znaků · ideálně do 60`;
    $('.cms-desc-count', seoPanel).textContent = `${descInput.value.length} znaků · ideálně 120–155`;
  };
  counts();
  titleInput.addEventListener('input', () => { meta.title = titleInput.value; counts(); onEdit(); });
  descInput.addEventListener('input', () => { meta.description = descInput.value; counts(); onEdit(); });

  /* Historie */
  const historyPanel = panel('history', '<h3>Historie záloh</h3><small>Záloha vzniká při spuštění CMS, před úpravami (nejvýš jednou za 5 minut), před obnovou a před změnou živé verze.</small><ul></ul>');
  const REASONS = { start: 'Spuštění CMS', uprava: 'Před úpravou', 'pred-obnovou': 'Před obnovou', 'zmena-stavu': 'Před změnou verze' };
  async function loadHistory() {
    const list = $('ul', historyPanel);
    list.innerHTML = '<li>Načítám…</li>';
    try {
      const data = await api(`/__cms/history?page=${encodeURIComponent(cfg.page)}`);
      list.innerHTML = data.items.length ? data.items.map((item) => `
        <li><span>${new Date(item.time * 1000).toLocaleString('cs-CZ')}<br><small>${esc(REASONS[item.reason] || item.reason)}</small></span>
        <button type="button" data-restore="${esc(item.id)}">Obnovit</button></li>`).join('') : '<li>Zatím žádné zálohy.</li>';
    } catch (err) {
      list.innerHTML = `<li>Chyba: ${esc(err.message)}</li>`;
    }
  }
  historyPanel.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-restore]')?.dataset.restore;
    if (!id) return;
    if (!confirm('Obnovit stránku do stavu z této zálohy? Aktuální verze se předtím sama zazálohuje.')) return;
    try {
      await api('/__cms/restore', { page: cfg.page, backup: id });
      store.remove(DRAFT_KEY);
      pending.clear();
      meta = {};
      window.location.reload();
    } catch (err) {
      setStatus(`Obnova selhala: ${err.message}`, 'error');
    }
  });

  /* Konflikty */
  const conflictPanel = panel('conflict', '<h3>Text se mezitím změnil jinde</h3><small>Někdo (nebo jiné okno) upravil stejný text. Vyberte, která verze platí.</small><ul></ul>');
  function showConflicts(conflicts) {
    $('ul', conflictPanel).innerHTML = conflicts.map((c) => `
      <li class="cms-conflict-item" data-id="${esc(c.id)}">
        <small>V souboru je teď:</small>
        <blockquote>${c.current === null ? '<em>(text už na stránce neexistuje)</em>' : c.current}</blockquote>
        <div class="cms-row">
          <button type="button" class="cms-primary" data-keep="mine">Použít moji verzi</button>
          <button type="button" data-keep="theirs"${c.current === null ? ' disabled' : ''}>Ponechat verzi ze souboru</button>
        </div>
      </li>`).join('');
    conflicts.forEach((c) => $(`[data-cms="${c.id}"]`)?.classList.add('cms-conflict'));
    togglePanel('conflict', true);
  }
  conflictPanel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-keep]');
    if (!btn) return;
    const item = btn.closest('[data-id]');
    const id = item.dataset.id;
    const el = $(`[data-cms="${id}"]`);
    if (btn.dataset.keep === 'theirs') {
      const current = $('blockquote', item).innerHTML;
      if (el) { el.innerHTML = current; el.classList.remove('cms-conflict', 'cms-dirty'); }
      base.set(id, current);
      pending.delete(id);
      persistDraft();
    } else {
      await save({ force: true, only: [id] });
      el?.classList.remove('cms-conflict');
    }
    item.remove();
    if (!$('li', conflictPanel)) togglePanel('conflict', false);
    refresh();
  });

  /* API ------------------------------------------------------------------------- */
  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-CMS-Token': cfg.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Server odpověděl ${res.status}`); }
    if (!data.ok) throw new Error(data.error || 'Neznámá chyba');
    return data;
  }

  /* Koncept v prohlížeči ------------------------------------------------------- */
  function persistDraft() {
    const changes = { ...(unresolvedDraft?.changes || {}), ...Object.fromEntries(pending) };
    const draftMeta = { ...(unresolvedDraft?.meta || {}), ...meta };
    if (Object.keys(changes).length || Object.keys(draftMeta).length) {
      store.set(DRAFT_KEY, { changes, meta: draftMeta, time: unresolvedDraft?.time || Date.now() });
    } else {
      store.remove(DRAFT_KEY);
    }
  }

  /* Editovatelné texty -------------------------------------------------------- */
  $$('details').forEach((d) => { d.open = true; });

  function onEdit() {
    persistDraft();
    refresh();
    clearTimeout(saveTimer);
    if (autosave) saveTimer = setTimeout(() => save(), AUTOSAVE_DELAY);
  }

  $$('[data-cms]').forEach((el) => {
    const id = el.dataset.cms;
    el.contentEditable = 'true';
    el.spellcheck = true;
    base.set(id, el.innerHTML);

    el.addEventListener('input', () => {
      if (el.innerHTML === base.get(id)) pending.delete(id);
      else pending.set(id, { html: el.innerHTML, base: base.get(id) });
      el.classList.toggle('cms-dirty', pending.has(id));
      onEdit();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') {
        el.innerHTML = base.get(id);
        el.dispatchEvent(new Event('input'));
        el.blur();
      }
    });
    el.addEventListener('blur', () => { if (autosave && pending.has(id)) save(); });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  });

  // Odkazy a tlačítka v režimu úprav neodvádějí ze stránky.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.cms-ui')) return;
    if (e.target.closest('[data-cms], a, summary, button')) e.preventDefault();
  }, true);

  /* Ukládání ----------------------------------------------------------------- */
  async function save({ force = false, only = null } = {}) {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    if (saving) { saveTimer = setTimeout(() => save({ force, only }), 400); return; }
    const ids = only || [...pending.keys()];
    const changes = Object.fromEntries(ids.filter((id) => pending.has(id)).map((id) => [id, pending.get(id)]));
    const sentMeta = only ? {} : { ...meta };
    if (!Object.keys(changes).length && !Object.keys(sentMeta).length) return;

    saving = true;
    refresh();
    setStatus('Ukládám…', 'busy');
    try {
      const data = await api('/__cms/save', { page: cfg.page, changes, meta: sentMeta, force });
      data.saved.forEach((id) => {
        base.set(id, changes[id].html);
        const now = pending.get(id);
        if (now && now.html !== changes[id].html) {
          pending.set(id, { html: now.html, base: changes[id].html });
        } else {
          pending.delete(id);
          $(`[data-cms="${id}"]`)?.classList.remove('cms-dirty', 'cms-conflict');
        }
      });
      Object.keys(sentMeta).forEach((k) => { if (meta[k] === sentMeta[k]) delete meta[k]; });
      persistDraft();
      const time = new Date(data.time * 1000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      if (data.conflicts.length) {
        setStatus(`Uloženo ${time} · ${data.conflicts.length} ke kontrole`, 'warn');
        showConflicts(data.conflicts);
      } else {
        setStatus(`Vše uloženo ${time}${data.built ? ' · verze přegenerovány' : ''}`);
      }
    } catch (err) {
      const offline = err instanceof TypeError;
      setStatus(offline ? 'CMS server neběží · změny jsou v bezpečí v prohlížeči' : `Chyba: ${err.message}`, 'error');
      if (offline) retryTimer = setTimeout(() => save({ force, only }), RETRY_DELAY);
    } finally {
      saving = false;
      refresh();
    }
  }

  saveBtn.addEventListener('click', () => save());
  autosaveBox.addEventListener('change', () => {
    autosave = autosaveBox.checked;
    store.set(PREF_KEY, autosave);
    if (autosave) save();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (!hasPending()) return;
    persistDraft();
    e.preventDefault();
    e.returnValue = '';
  });

  $('.cms-page', bar).addEventListener('change', (e) => {
    persistDraft();
    window.location.href = `/${e.target.value}`;
  });

  /* Verze stránky ------------------------------------------------------------ */
  if (cfg.states.length) {
    const chips = $$('.cms-chip', bar);
    const hint = $('.cms-state-hint', bar);
    const preview = $('.cms-preview', bar);
    const makeLive = $('.cms-make-live', bar);
    let live = cfg.live;

    const show = (attr) => {
      const st = cfg.states.find((s) => s.attr === attr) || cfg.states[0];
      html.dataset.state = st.attr;
      chips.forEach((c) => {
        c.setAttribute('aria-pressed', String(c.dataset.state === st.attr));
        c.classList.toggle('is-live', c.dataset.slug === live);
      });
      const isLive = st.slug === live;
      hint.textContent = `${st.hint}${isLive ? ' Tahle verze je teď na webu.' : ''}`;
      preview.href = `/stranky/${st.file}`;
      makeLive.disabled = isLive;
      makeLive.textContent = isLive ? 'Je živá na webu' : `Nastavit „${st.label}“ jako živou`;
      window.dispatchEvent(new Event('resize'));
    };

    chips.forEach((c) => c.addEventListener('click', () => show(c.dataset.state)));
    makeLive.addEventListener('click', async () => {
      const st = cfg.states.find((s) => s.attr === html.dataset.state);
      if (!confirm(`Nastavit „${st.label}“ jako verzi hlavní stránky? Projeví se na webu po nahrání na hosting.`)) return;
      await save();
      try {
        const data = await api('/__cms/live', { state: st.slug });
        live = data.live;
        show(st.attr);
        setStatus(`Živá verze: ${st.label}`);
      } catch (err) {
        setStatus(`Nepodařilo se: ${err.message}`, 'error');
      }
    });
    show(html.dataset.state);
  }

  /* Obnova konceptu --------------------------------------------------------- */
  const draft = store.get(DRAFT_KEY);
  if (draft && (Object.keys(draft.changes || {}).length || Object.keys(draft.meta || {}).length)) {
    unresolvedDraft = draft;
    const count = Object.keys(draft.changes || {}).length + Object.keys(draft.meta || {}).length;
    const banner = document.createElement('div');
    banner.className = 'cms-ui cms-banner';
    banner.innerHTML = `<p>Našel jsem neuložené změny z ${new Date(draft.time).toLocaleString('cs-CZ')} (${count}). Obnovit je?</p>
      <button type="button" class="cms-primary" data-draft="restore">Obnovit a uložit</button>
      <button type="button" data-draft="discard">Zahodit</button>`;
    document.body.append(banner);
    banner.addEventListener('click', (e) => {
      const action = e.target.closest('[data-draft]')?.dataset.draft;
      if (!action) return;
      unresolvedDraft = null;
      if (action === 'restore') {
        Object.entries(draft.changes || {}).forEach(([id, change]) => {
          const el = $(`[data-cms="${id}"]`);
          if (!el) return;
          el.innerHTML = change.html;
          pending.set(id, change);
          el.classList.add('cms-dirty');
        });
        meta = { ...(draft.meta || {}) };
        if (meta.title) titleInput.value = meta.title;
        if (meta.description) descInput.value = meta.description;
        counts();
        save();
      } else {
        persistDraft();
      }
      banner.remove();
    });
  }

  refresh();
})();
