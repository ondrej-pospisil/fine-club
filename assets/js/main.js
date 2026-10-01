/* FINE Club — main.js */
(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cmsEdit = document.documentElement.hasAttribute('data-cms-edit');

  /* Chybějící fotky se skryjí, ať místo nich není ikona rozbitého obrázku */
  const hideMissing = (img) => img.classList.add('is-missing');
  $$('img').forEach((img) => {
    if (img.complete && !img.naturalWidth) hideMissing(img);
    else img.addEventListener('error', () => hideMissing(img), { once: true });
  });

  /* ----------------------------------------------------------------------
     Scroll engine — pozice se měří jen při resize, scroll jen čte scrollY
     ---------------------------------------------------------------------- */
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  const measurers = [];
  const updaters = [];
  let frame = 0;

  const render = () => {
    frame = 0;
    const y = window.scrollY;
    for (const update of updaters) update(y);
  };
  const requestRender = () => { if (!frame) frame = requestAnimationFrame(render); };
  const measure = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
    for (const m of measurers) m();
    render();
  };
  let measureFrame = 0;
  const requestMeasure = () => {
    cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(measure);
  };

  const onScroll = (measureFn, updateFn) => {
    if (measureFn) measurers.push(measureFn);
    updaters.push(updateFn);
  };

  /* Průběh sticky sekce 0–1 */
  const stageProgress = (el) => {
    let top = 0;
    let span = 1;
    return {
      measure() { top = pageTop(el); span = Math.max(1, el.offsetHeight - vh); },
      at(y) { return clamp((y - top) / span); },
    };
  };

  const nav = $('#nav');

  /* Mobilní menu */
  const toggle = $('.nav__toggle');
  const menu = $('#menu');
  if (toggle && menu) {
    const setMenu = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Zavřít menu' : 'Otevřít menu');
      menu.classList.toggle('is-open', open);
      menu.inert = !open;
      nav.classList.toggle('is-menu', open);
      document.body.classList.toggle('is-locked', open);
    };
    menu.inert = true;
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
    $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    window.matchMedia('(min-width: 981px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });
  }

  /* ----------------------------------------------------------------------
     Dock s rezervací (mobil)
     ---------------------------------------------------------------------- */
  const dock = $('#dock');
  const form = $('#prihlaska');
  if (dock && form) {
    let formTop = 0;
    let shown = null;
    onScroll(() => { formTop = pageTop(form); }, (y) => {
      const show = y > vh * 0.55 && formTop - y > vh * 0.45;
      if (show !== shown) { dock.classList.toggle('is-visible', show); shown = show; }
    });
  }

  /* ----------------------------------------------------------------------
     Odpočet
     ---------------------------------------------------------------------- */
  const countdown = $('#countdown');
  if (countdown) {
    /* Odpočet míří vždy na nejbližší termín. Termíny se berou z karet v sekci Termíny
       (data-days-to), takže stačí upravit je tam. Po skončení večera se přepne na další. */
    const EVENT_SLOT = 5 * 3600 * 1000;
    const targets = $$('[data-days-to]')
      .map((el) => new Date(el.dataset.daysTo).getTime())
      .filter(Number.isFinite)
      .sort((x, y) => x - y);
    const fallback = new Date(countdown.dataset.target).getTime();
    const nextTarget = (now) => targets.find((t) => t + EVENT_SLOT > now) ?? (fallback + EVENT_SLOT > now ? fallback : null);

    const dateLabel = $('.countdown__date b');
    const dateFormat = new Intl.DateTimeFormat('cs-CZ', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Prague',
    });
    const [d, h, m, s] = ['d', 'h', 'm', 's'].map((k) => $(`[data-unit="${k}"]`, countdown));
    const live = document.createElement('p');
    live.className = 'countdown__live';
    live.hidden = true;
    countdown.after(live);
    const pad = (n) => String(n).padStart(2, '0');

    let target = null;
    const tick = () => {
      const now = Date.now();
      const next = nextTarget(now);
      if (next !== target) {
        target = next;
        if (target && dateLabel && !cmsEdit) dateLabel.textContent = dateFormat.format(target);
      }
      const diff = target === null ? -1 : target - now;
      countdown.hidden = diff <= 0;
      live.hidden = diff > 0;
      if (diff <= 0) {
        live.textContent = target === null ? 'Večer proběhl' : 'Právě probíhá';
        return;
      }
      const sec = Math.floor(diff / 1000);
      d.textContent = Math.floor(sec / 86400);
      h.textContent = pad(Math.floor((sec % 86400) / 3600));
      m.textContent = pad(Math.floor((sec % 3600) / 60));
      s.textContent = pad(sec % 60);
    };
    tick();
    setInterval(tick, 1000);
  }

  /* Termíny — „za X dní“ */
  const dayWord = (n) => (n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní');
  $$('[data-days-to]').forEach((el) => {
    const target = new Date(el.dataset.daysTo);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(target);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((day - today) / 86400000);
    el.textContent = days > 1 ? `za ${days} ${dayWord(days)}` : days === 1 ? 'zítra' : days === 0 ? 'dnes' : '';
  });

  /* ----------------------------------------------------------------------
     Nadpisy dobarvované po slovech
     ---------------------------------------------------------------------- */
  if (!cmsEdit) $$('[data-fill]').forEach((heading) => {
    const words = heading.textContent.trim().split(/\s+/);
    heading.textContent = '';
    words.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = word;
      heading.append(span, i < words.length - 1 ? ' ' : '');
    });
    const spans = $$('.w', heading);
    if (reduceMotion) { spans.forEach((w) => w.classList.add('is-on')); return; }

    let top = 0;
    let height = 0;
    let lit = -1;
    onScroll(() => { top = pageTop(heading); height = heading.offsetHeight; }, (y) => {
      const p = clamp((vh * 0.86 - (top - y)) / (vh * 0.42 + height));
      const n = Math.round(p * spans.length);
      if (n === lit) return;
      spans.forEach((w, i) => w.classList.toggle('is-on', i < n));
      lit = n;
    });
  });

  /* ----------------------------------------------------------------------
     Timeline průběhu večera
     ---------------------------------------------------------------------- */
  const timeline = $('.timeline');
  if (timeline) {
    const spine = $('.timeline__spine i', timeline);
    const steps = $$('.step', timeline);
    let top = 0;
    let height = 1;
    let stepTops = [];
    onScroll(() => {
      top = pageTop(timeline);
      height = timeline.offsetHeight || 1;
      stepTops = steps.map(pageTop);
    }, (y) => {
      const line = y + vh * 0.62;
      spine.style.transform = `scaleY(${clamp((line - top) / height)})`;
      steps.forEach((step, i) => step.classList.toggle('is-active', stepTops[i] < line));
    });
  }

  /* ----------------------------------------------------------------------
     Kruh — linka se při scrollu dokreslí a postupně rozsvítí čtyři témata
     ---------------------------------------------------------------------- */
  const orbit = $('[data-orbit]');
  if (orbit) {
    const progress = $('.orbit__progress', orbit);
    const items = $$('.orbit__item', orbit);
    const dots = $$('.orbit__dot', orbit);
    const light = (count, closed) => {
      items.forEach((item, i) => item.classList.toggle('is-lit', i < count));
      dots.forEach((dot, i) => dot.classList.toggle('is-lit', i < count));
      orbit.classList.toggle('is-closed', closed);
    };

    items.forEach((item, i) => {
      item.addEventListener('mouseenter', () => dots[i].classList.add('is-hover'));
      item.addEventListener('mouseleave', () => dots[i].classList.remove('is-hover'));
    });

    const setCurrent = (index) => {
      items.forEach((item, i) => item.classList.toggle('is-current', i === index));
      dots.forEach((dot, i) => dot.classList.toggle('is-current', i === index));
    };

    if (reduceMotion || cmsEdit) {
      orbit.classList.add('orbit--static');
      progress.style.strokeDashoffset = 0;
      light(items.length, true);
    } else {
      // Desktop: linka se kreslí, jak kruh projíždí obrazovkou.
      // Tablet/mobil: kruh stojí a témata se v něm střídají jedno po druhém.
      const ring = $('.orbit__ring', orbit);
      const compact = window.matchMedia('(max-width: 980px)');
      const steps = items.length + 1;
      let mobile = compact.matches;
      let top = 0;
      let span = 1;
      let last = -1;
      onScroll(() => {
        mobile = compact.matches;
        if (mobile) {
          top = pageTop(orbit);
          span = Math.max(1, orbit.offsetHeight - vh);
        } else {
          top = pageTop(ring);
          span = ring.offsetHeight * 0.95;
        }
        last = -1;
      }, (y) => {
        if (mobile) {
          const p = clamp((y - top) / span);
          const index = Math.min(steps - 1, Math.floor(p * steps));
          const key = Math.round(p * 1000) / 1000;
          if (key === last) return;
          last = key;
          progress.style.strokeDashoffset = 1 - Math.min(1, (p * steps) / items.length);
          light(Math.min(items.length, index + 1), index >= items.length);
          setCurrent(index < items.length ? index : -1);
          return;
        }
        const raw = clamp((y + vh * 0.78 - top) / span);
        const p = raw > 0.97 ? 1 : Math.round(raw * 1000) / 1000;
        if (p === last) return;
        last = p;
        progress.style.strokeDashoffset = 1 - p;
        light(items.filter((_, i) => p > i / items.length + 0.02).length, p >= 1);
        setCurrent(-1);
      });
    }
  }

  /* ----------------------------------------------------------------------
     Mapa ČR — mezi městy se náhodně rozsvěcují propojení
     ---------------------------------------------------------------------- */
  const czmap = $('[data-czmap]');
  if (czmap) {
    const NS = 'http://www.w3.org/2000/svg';
    const layer = $('.czmap__links', czmap);
    const cities = $$('.czmap__city', czmap);
    const pts = cities.map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    const litCount = new Array(cities.length).fill(0);

    const pickPair = () => {
      const a = Math.floor(Math.random() * pts.length);
      for (let tries = 0; tries < 20; tries += 1) {
        const b = Math.floor(Math.random() * pts.length);
        if (b !== a && Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) > 70) return [a, b];
      }
      return [a, (a + 1) % pts.length];
    };

    const makeLink = (a, b, extraClass = '') => {
      const [x1, y1] = pts[a];
      const [x2, y2] = pts[b];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const bow = len * 0.18 * (Math.random() < 0.5 ? 1 : -1);
      const cx = (x1 + x2) / 2 - ((y2 - y1) / len) * bow;
      const cy = (y1 + y2) / 2 + ((x2 - x1) / len) * bow;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', `czmap__link ${extraClass}`.trim());
      path.setAttribute('pathLength', '1');
      path.setAttribute('d', `M${x1} ${y1} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`);
      layer.append(path);
      return path;
    };

    const flash = (i, delay) => setTimeout(() => {
      litCount[i] += 1;
      cities[i].classList.add('is-lit');
      setTimeout(() => {
        litCount[i] -= 1;
        if (!litCount[i]) cities[i].classList.remove('is-lit');
      }, 2200);
    }, delay);

    const connect = () => {
      const [a, b] = pickPair();
      const path = makeLink(a, b);
      path.addEventListener('animationend', () => path.remove(), { once: true });
      flash(a, 0);
      flash(b, 1400);
    };

    if (reduceMotion) {
      for (let i = 0; i < 7; i += 1) {
        const [a, b] = pickPair();
        makeLink(a, b, 'czmap__link--static');
      }
    } else {
      let timer = 0;
      new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !timer) {
          connect();
          timer = setInterval(connect, 850);
        } else if (!entry.isIntersecting && timer) {
          clearInterval(timer);
          timer = 0;
        }
      }, { threshold: 0.2 }).observe(czmap);
    }
  }

  /* ----------------------------------------------------------------------
     Klíčová dírka
     ---------------------------------------------------------------------- */
  const keyhole = $('#vztahy');
  if (keyhole) {
    const reveal = $('.stage__reveal', keyhole);
    const img = $('.stage__scene > img', keyhole);
    const copy = $('.stage__copy', keyhole);
    const hint = $('.stage__hint', keyhole);

    if (reduceMotion) {
      copy.classList.add('is-on');
      keyhole.dataset.theme = 'dark';
    } else {
      const stage = stageProgress(keyhole);
      let last = -1;
      onScroll(stage.measure, (y) => {
        const p = stage.at(y);
        if (p === last) return;
        last = p;
        const e = easeInOut(p);
        const size = `${14 + e * e * 760}vmin`;
        reveal.style.webkitMaskSize = size;
        reveal.style.maskSize = size;
        img.style.transform = `scale(${1.4 - e * 0.4})`;
        copy.classList.toggle('is-on', p > 0.62);
        hint.style.opacity = p > 0.1 ? 0 : 1;
        keyhole.dataset.theme = p > 0.4 ? 'dark' : 'light';
      });
    }
  }

  /* ----------------------------------------------------------------------
     Sestřih — kruhové okno se rozevře jako klíčová dírka
     ---------------------------------------------------------------------- */
  const reel = $('#video');
  if (reel) {
    const reveal = $('.stage__reveal', reel);
    const img = $('.stage__scene > img', reel);
    const copy = $('.stage__copy', reel);
    const hint = $('.stage__hint', reel);
    const marks = $('.reel__marks', reel);

    if (reduceMotion) {
      copy.classList.add('is-on');
      reel.dataset.theme = 'dark';
    } else {
      const stage = stageProgress(reel);
      let r0 = 0;
      let r1 = 0;
      let last = -1;
      onScroll(() => {
        stage.measure();
        r0 = Math.min(vw, vh) * (vw <= 600 ? 0.13 : 0.09);
        r1 = Math.hypot(vw / 2, vh * 0.55) + 2;
        last = -1;
      }, (y) => {
        const p = stage.at(y);
        if (p === last) return;
        last = p;
        const e = easeInOut(p);
        reveal.style.clipPath = `circle(${(r0 + (r1 - r0) * e).toFixed(1)}px at 50% 55%)`;
        img.style.transform = `scale(${1.4 - e * 0.4})`;
        marks.style.opacity = p > 0.06 ? 0 : 1;
        hint.style.opacity = p > 0.1 ? 0 : 1;
        copy.classList.toggle('is-on', p > 0.62);
        reel.dataset.theme = p > 0.4 ? 'dark' : 'light';
      });
    }
  }

  /* ----------------------------------------------------------------------
     YouTube — načtení až po kliknutí
     ---------------------------------------------------------------------- */
  /* Video se vždy přehrává v modalu na stránce.
     - data-mp4: vlastní soubor, funguje všude (i při otevření ze složky),
     - jinak YouTube; ten vyžaduje Referer, takže ze souboru (file://) nejde a modal to vysvětlí. */
  const canEmbed = window.location.protocol.startsWith('http');
  const ytFrame = (id, title) => {
    const params = new URLSearchParams({
      autoplay: '1', rel: '0', playsinline: '1', modestbranding: '1', origin: window.location.origin,
    });
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${id}?${params}`;
    iframe.title = title;
    iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    return iframe;
  };
  const mp4Player = (src, poster) => {
    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    if (poster) video.poster = poster;
    return video;
  };
  const offlineNote = () => {
    const note = document.createElement('div');
    note.className = 'lightbox__note';
    note.innerHTML = '<p>YouTube nedovolí přehrát video ve stránce otevřené přímo ze složky.</p>'
      + '<p>Na webu i v CMS se tady přehraje normálně.</p>';
    return note;
  };

  const lightbox = $('#lightbox');
  if (lightbox) {
    const frameBox = $('.lightbox__frame', lightbox);
    $$('[data-video]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { video, mp4, poster, title = 'Video' } = btn.dataset;
        let player;
        if (mp4) player = mp4Player(mp4, poster);
        else if (canEmbed) player = ytFrame(video, title);
        else player = offlineNote();
        frameBox.replaceChildren(player);
        lightbox.showModal();
      });
    });
    $('.lightbox__close', lightbox).addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
    lightbox.addEventListener('close', () => frameBox.replaceChildren());
  }

  /* ----------------------------------------------------------------------
     Reveal animace
     ---------------------------------------------------------------------- */
  const revealEls = $$('.fade, .wipe, .rise, .fig');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealEls.forEach((el) => { if (!el.classList.contains('is-in')) io.observe(el); });
  }

  /* ----------------------------------------------------------------------
     Hero video — hraje jen ve viewportu
     ---------------------------------------------------------------------- */
  const heroVideo = $('.hero__media');
  if (heroVideo instanceof HTMLVideoElement) {
    if (reduceMotion) {
      heroVideo.pause();
    } else {
      new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) heroVideo.play().catch(() => {});
        else heroVideo.pause();
      }, { threshold: 0.05 }).observe(heroVideo);
    }
  }

  /* ----------------------------------------------------------------------
     Tally formulář — skript až když se blíží viewport
     ---------------------------------------------------------------------- */
  const tallyFrame = $('iframe[data-tally-src]');
  if (tallyFrame) {
    const TALLY = 'https://tally.so/widgets/embed.js';
    const fallback = () => $$('iframe[data-tally-src]:not([src])').forEach((f) => { f.src = f.dataset.tallySrc; });
    const load = () => {
      if (window.Tally) { window.Tally.loadEmbeds(); return; }
      const script = document.createElement('script');
      script.src = TALLY;
      script.async = true;
      script.onload = () => (window.Tally ? window.Tally.loadEmbeds() : fallback());
      script.onerror = fallback;
      document.body.append(script);
    };
    new IntersectionObserver(([entry], obs) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      load();
    }, { rootMargin: '1200px 0px' }).observe(tallyFrame);
  }

  /* ----------------------------------------------------------------------
     Navigace — barva podle sekce pod ní (registruje se jako poslední,
     aby četla téma, které sticky sekce nastavily ve stejném snímku)
     ---------------------------------------------------------------------- */
  const hero = $('#top');
  const themed = $$('[data-theme]:not(#nav)');
  let bands = [];
  let heroEnd = 0;
  let navH = 0;
  let navSolid = null;
  let navTheme = null;

  onScroll(() => {
    navH = nav.offsetHeight;
    heroEnd = hero.offsetHeight - navH;
    bands = themed.map((el) => ({ el, top: pageTop(el), bottom: pageTop(el) + el.offsetHeight }));
  }, (y) => {
    const solid = y > heroEnd;
    const probe = y + navH / 2;
    const band = bands.find((b) => probe >= b.top && probe < b.bottom);
    const theme = band ? band.el.dataset.theme : 'light';
    if (solid !== navSolid) { nav.classList.toggle('is-solid', solid); navSolid = solid; }
    if (theme !== navTheme) { nav.dataset.theme = theme; navTheme = theme; }
  });

  /* ----------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */
  measure();
  window.addEventListener('scroll', requestRender, { passive: true });
  window.addEventListener('resize', requestMeasure);
  window.addEventListener('load', requestMeasure);
  if (document.fonts) document.fonts.ready.then(requestMeasure);
  if ('ResizeObserver' in window) new ResizeObserver(requestMeasure).observe(document.body);
})();
