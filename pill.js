// La pastille : le minuteur de la séance, posé dans un coin de chaque page.
// Le fond l'inscrit pour les pages ouvertes pendant une séance et la pose dans
// les onglets déjà ouverts ; hors séance, ce fichier ne tourne nulle part.
(() => {
  // Une pastille déjà là (extension rechargée, deuxième pose) laisse la place.
  globalThis.focusPill?.();

  const CORNERS = ['br', 'bl', 'tl', 'tr'];

  // Textes dans la langue de Chrome (_locales), pluriels selon la règle de la langue.
  // Script injecté dans les pages : il n'utilise pas i18n.js, qui touche au document.
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  const plurals = new Intl.PluralRules(chrome.i18n.getUILanguage());
  const tp = (key, count, ...subs) =>
    chrome.i18n.getMessage(`${key}_${plurals.select(count)}`, [count, ...subs].map(String)) || t(`${key}_other`, count, ...subs);
  const SHOW_MS = 8000; // durée d'une annonce (pause, reprise, fin) avant de se replier

  const CSS_TEXT = `
    :host {
      --card: #ffffff;
      --text: #1c1c1e;
      --muted: #8e8e93;
      --field: #f2f2f7;
      --accent: #0e93a8;
      --shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(60, 60, 67, 0.12);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --card: #2c2c2e;
        --text: #f2f2f7;
        --field: #3a3a3c;
        --accent: #40c8e0;
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(235, 235, 245, 0.12);
      }
    }
    * {
      box-sizing: border-box;
    }
    [hidden] {
      display: none !important;
    }
    .dock {
      position: fixed;
      color: var(--text);
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: center;
      pointer-events: auto;
      cursor: default;
    }
    .dock.br { right: 16px; bottom: 16px; }
    .dock.bl { left: 16px; bottom: 16px; }
    .dock.tl { left: 16px; top: 16px; }
    .dock.tr { right: 16px; top: 16px; }
    button {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    svg {
      display: block;
      flex: none;
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Repliée : un anneau qui se remplit, la tâche, le temps. */
    .pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px 7px 9px;
      border-radius: 999px;
      background: var(--card);
      box-shadow: var(--shadow);
      font-weight: 600;
      white-space: nowrap;
    }
    .ring {
      width: 18px;
      height: 18px;
      stroke-width: 3;
      transform: rotate(-90deg);
    }
    .ring .rest {
      stroke: color-mix(in srgb, var(--muted) 35%, transparent);
    }
    .ring .done {
      stroke: var(--accent);
    }
    .name {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .time,
    .clock {
      font-variant-numeric: tabular-nums;
    }
    .pause .name,
    .held .time,
    .held .clock,
    .pause .task {
      color: var(--muted);
    }

    /* Dépliée : la même chose en grand, avec de quoi noter et agir. */
    .card {
      width: 272px;
      padding: 10px 12px 12px;
      border-radius: 14px;
      background: var(--card);
      box-shadow: var(--shadow);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-bottom: 4px;
    }
    .where {
      flex: 1;
      color: var(--muted);
      font-size: 12px;
      text-align: left;
    }
    .tool {
      padding: 6px;
      border-radius: 999px;
      color: var(--muted);
    }
    .tool:hover {
      background: var(--field);
      color: var(--text);
    }
    .headline {
      color: var(--accent);
      font-size: 12px;
      font-weight: 600;
    }
    .task {
      overflow: hidden;
      font-size: 16px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .clock {
      font-size: 40px;
      font-weight: 700;
      letter-spacing: -1px;
      line-height: 1.15;
    }
    .track {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .track i {
      flex: 1;
      height: 5px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--muted) 30%, var(--field));
    }
    .track b {
      display: block;
      width: 0;
      height: 100%;
      border-radius: 999px;
      background: var(--accent);
    }
    .notes {
      max-height: 120px;
      margin: 10px 0 0;
      padding: 2px 0;
      overflow-y: auto;
      scrollbar-width: thin;
      border-radius: 12px;
      background: var(--field);
      list-style: none;
    }
    .notes li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px 2px 12px;
      text-align: left;
    }
    .notes span {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .notes .tool:hover {
      color: var(--accent);
    }
    input {
      display: block;
      width: 100%;
      margin: 10px 0 0;
      padding: 8px 12px;
      border: 0;
      border-radius: 12px;
      outline: 0;
      background: var(--field);
      color: inherit;
      font: inherit;
    }
    input::placeholder {
      color: var(--muted);
    }
    input:focus-visible,
    button:focus-visible {
      outline: 0;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
    }
    .count,
    .stop {
      color: var(--muted);
      font-size: 12px;
    }
    .count {
      margin-top: 6px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .soft {
      flex: 1;
      padding: 8px;
      border-radius: 999px;
      background: var(--field);
      font-weight: 600;
      white-space: nowrap;
    }
    .soft:hover {
      background: color-mix(in srgb, var(--text) 9%, var(--field));
    }
    .stop {
      margin-top: 10px;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .stop:hover {
      text-decoration: underline;
    }
  `;

  // Les mêmes calculs que shared.js, recopiés : ce fichier est posé seul dans les pages.
  const stepOf = (session) => session?.steps[session.index] ?? null;
  const leftOf = (session) => Math.max(0, session.endsAt ? session.endsAt - Date.now() : session.left);
  const clock = (ms) => {
    const seconds = Math.ceil(ms / 1000);
    const pad = (value) => String(value).padStart(2, '0');
    const [hours, minutes] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60)];
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
  };
  const send = (focus, more = {}) => chrome.runtime.sendMessage({ focus, ...more }).catch(() => {});

  const make = (tag, className, ...children) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  };
  const shape = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const icon = (d) => {
    const svg = shape('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
    svg.append(shape('path', { d }));
    return svg;
  };
  const button = (className, title, ...children) => {
    const node = make('button', className, ...children);
    node.type = 'button';
    if (title) node.title = title;
    if (title) node.setAttribute('aria-label', title);
    return node;
  };
  // Seulement les vrais clics : la page ne doit pas pouvoir piloter la séance.
  const onClick = (node, handler) => node.addEventListener('click', (event) => event.isTrusted && handler(event));

  const host = document.createElement('div');
  host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
  const OWN_STYLE = host.style.cssText; // tel que Chrome le réécrit, pour voir si la page y a touché
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS_TEXT);
  root.adoptedStyleSheets = [sheet];

  const RING = 2 * Math.PI * 7;
  const ring = shape('svg', { viewBox: '0 0 18 18', class: 'ring', 'aria-hidden': 'true' });
  const ringDone = shape('circle', { cx: 9, cy: 9, r: 7, class: 'done', 'stroke-dasharray': RING });
  ring.append(shape('circle', { cx: 9, cy: 9, r: 7, class: 'rest' }), ringDone);
  const name = make('span', 'name');
  const time = make('span', 'time');
  const pill = button('pill', t('openTimer'), ring, name, time);

  const where = make('span', 'where');
  const cornerButton = button('tool', t('changeCorner'), icon('M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2'));
  const closeButton = button('tool', t('fold'), icon('M4.5 4.5l7 7M11.5 4.5l-7 7'));
  const headline = make('div', 'headline');
  const task = make('div', 'task');
  const bigClock = make('div', 'clock');
  const track = make('div', 'track');
  const notes = make('ul', 'notes');
  const input = make('input');
  input.type = 'text';
  input.maxLength = 200;
  input.autocomplete = 'off';
  input.placeholder = t('pillPlaceholder');
  input.setAttribute('aria-label', t('noteForLater'));
  const form = make('form', '', input);
  const count = make('div', 'count');
  const holdButton = button('soft');
  const skipButton = button('soft');
  const actions = make('div', 'actions', holdButton, skipButton);
  const stopButton = button('stop');
  const card = make('div', 'card', make('div', 'head', where, cornerButton, closeButton), headline, task, bigClock, track, notes, form, count, actions, stopButton);
  const dock = make('div', 'dock', pill, card);
  root.append(dock);

  let session = null;
  let later = [];
  let corner = CORNERS[0];
  let done = null; // la dernière séance allée au bout : { at, blocks }
  let open = false;
  let news = ''; // l'annonce affichée en tête de la carte
  let farewell = false; // la séance vient de finir : la carte le dit, puis s'en va
  let timer = null;
  let folding = null;
  let armed = null;

  const draw = () => {
    const step = stepOf(session);
    if (!step && !farewell) return;
    const working = step?.kind === 'work';
    const held = Boolean(session) && !session.endsAt;
    dock.className = `dock ${corner}${step && !working ? ' pause' : ''}${held ? ' held' : ''}`;
    pill.hidden = open;
    card.hidden = !open;
    headline.hidden = !news;
    headline.textContent = news;
    for (const part of [bigClock, track, form, actions, stopButton, cornerButton]) part.hidden = farewell;
    notes.hidden = farewell || working || !later.length;
    count.hidden = farewell || !working || !later.length;

    if (farewell) {
      where.textContent = 'Focus';
      task.textContent = tp('blocksDone', done.blocks);
      return;
    }

    const works = session.steps.filter((entry) => entry.kind === 'work');
    const position = session.steps.slice(0, session.index + 1).filter((entry) => entry.kind === 'work').length;
    const left = leftOf(session);
    const share = 1 - left / (step.minutes * 60000);
    name.textContent = working ? step.name : t('pause');
    time.textContent = clock(left);
    ringDone.setAttribute('stroke-dashoffset', RING * (1 - share));

    if (!open) return;
    where.textContent = t(working ? 'blockOf' : 'blockOfDone', position, works.length);
    task.textContent = name.textContent;
    bigClock.textContent = time.textContent;
    if (track.childElementCount !== works.length) track.replaceChildren(...works.map(() => make('i', '', make('b'))));
    works.forEach((work, index) => {
      const full = index + 1 < position || (index + 1 === position && !working);
      track.children[index].firstChild.style.width = `${Math.round((full ? 1 : index + 1 === position ? share : 0) * 100)}%`;
    });
    count.textContent = tp('notesForBreak', later.length);
    holdButton.textContent = t(held ? 'resume' : 'hold');
    skipButton.textContent = t(working ? 'finishedBlock' : 'endBreak');
    skipButton.hidden = held;
    if (!armed) stopButton.textContent = t('stop');
  };

  const drawNotes = () => {
    notes.replaceChildren(
      ...later.map((note) => {
        const tick = button('tool', t('done'), icon('M3.5 8.5l3 3 6-7'));
        onClick(tick, () => send('forget', { id: note.id }));
        const text = make('span', '', note.text);
        text.title = note.text;
        return make('li', '', text, tick);
      }),
    );
  };

  const mount = () => {
    if (host.isConnected) return;
    document.documentElement.append(host);
    try {
      // Au-dessus de tout ce que la page affiche, ses fenêtres comprises.
      host.popover = 'manual';
      host.showPopover();
    } catch {
      // popover indisponible : le z-index suffit
    }
  };

  // Passe devant tout ce que la page a ouvert après la pastille (publicité plein écran,
  // fenêtre du site, vidéo en plein écran).
  let raised = 0;
  const raise = () => {
    raised = Date.now();
    try {
      host.hidePopover();
      host.showPopover();
    } catch {
      // popover indisponible
    }
  };

  // La page peut toucher à la pastille (la masquer, la rendre inactive) ou ouvrir quelque
  // chose par-dessus : on la remet en état, et devant.
  const keep = () => {
    if (host.style.cssText !== OWN_STYLE) host.style.cssText = OWN_STYLE;
    for (const name of host.getAttributeNames()) if (name !== 'style' && name !== 'popover') host.removeAttribute(name);
    if (!host.matches(':popover-open')) return raise();
    const box = (open ? card : pill).getBoundingClientRect();
    const front = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (front !== host && Date.now() - raised > 3000) raise();
  };

  const unmount = () => {
    clearTimeout(folding);
    folding = null;
    farewell = false;
    open = false;
    news = '';
    host.remove();
  };

  // Replie la carte ; après l'annonce de fin, il n'y a plus rien à montrer.
  const fold = () => {
    clearTimeout(folding);
    folding = null;
    if (farewell) return unmount();
    open = false;
    news = '';
    draw();
  };

  // Une annonce s'ouvre toute seule, puis se replie si on ne s'en sert pas.
  const announce = (text) => {
    open = true;
    news = text;
    clearTimeout(folding);
    folding = document.hidden ? null : setTimeout(fold, SHOW_MS);
  };

  const dispose = () => {
    clearTimeout(timer);
    clearTimeout(folding);
    clearTimeout(armed);
    host.remove();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('fullscreenchange', onFullscreen);
    for (const type of ['keydown', 'keyup', 'keypress']) window.removeEventListener(type, onKey, true);
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {
      // extension rechargée : plus rien à détacher
    }
    delete globalThis.focusPill;
  };
  globalThis.focusPill = dispose;

  // La pastille est posée dès qu'il y a une séance. Le temps, lui, ne défile que dans
  // l'onglet regardé, une fois par seconde, calé sur le changement de chiffre.
  const tick = () => {
    clearTimeout(timer);
    timer = null;
    if (!chrome.runtime?.id) return dispose(); // extension rechargée ou retirée
    if (!session) return;
    mount(); // certains sites refont leur page et emportent la pastille
    draw();
    if (document.hidden) return;
    keep();
    if (!session.endsAt) return;
    const left = leftOf(session);
    timer = setTimeout(tick, left > 0 ? (left % 1000) + 30 : 500);
  };

  function onVisible() {
    if (document.hidden) return;
    if (open && news && !folding) folding = setTimeout(fold, SHOW_MS);
    tick();
  }

  function onOutside(event) {
    if (open && event.target !== host) fold();
  }

  // Une vidéo en plein écran passe devant tout : la pastille repasse devant elle.
  function onFullscreen() {
    if (host.isConnected) raise();
  }

  // Ce qui est tapé dans la carte ne doit pas déclencher les raccourcis du site.
  function onKey(event) {
    if (event.target !== host) return;
    event.stopImmediatePropagation();
    if (event.type === 'keydown' && event.key === 'Escape') fold();
  }

  function onStorage(changes, area) {
    if (area !== 'local') return;
    if (changes.later) {
      later = changes.later.newValue ?? [];
      drawNotes();
    }
    if (changes.corner) corner = CORNERS.includes(changes.corner.newValue) ? changes.corner.newValue : CORNERS[0];
    if (changes.done) done = changes.done.newValue ?? null;
    if (changes.session) {
      const before = session;
      session = changes.session.newValue ?? null;
      if (!session) {
        // Allée au bout : on le dit. Arrêtée à la main : la pastille s'en va sans rien dire.
        if (!before || !done || Date.now() - done.at > 5000) return unmount();
        farewell = true;
        announce(t('announceEnd'));
        return draw();
      }
      farewell = false;
      if (!before) {
        // Nouvelle séance : rien ne reste de l'annonce de fin de la précédente.
        clearTimeout(folding);
        folding = null;
        open = false;
        news = '';
      }
      if (before && before.index !== session.index) announce(t(stepOf(session).kind === 'work' ? 'announceBreakOver' : 'announceBlockDone'));
    }
    tick();
  }

  onClick(pill, () => {
    open = true;
    draw();
  });
  onClick(closeButton, fold);
  onClick(cornerButton, () => chrome.storage.local.set({ corner: CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length] }));
  onClick(holdButton, () => send(session?.endsAt ? 'hold' : 'resume'));
  onClick(skipButton, () => send('next'));
  // Arrêter demande deux clics : un seul, par erreur, ferait perdre la séance.
  onClick(stopButton, () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      return send('stop');
    }
    stopButton.textContent = t('clickAgain');
    armed = setTimeout(() => {
      armed = null;
      draw();
    }, 4000);
  });
  // Tant qu'on se sert de la carte, elle ne se replie pas toute seule.
  card.addEventListener('pointerdown', () => {
    clearTimeout(folding);
    folding = null;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.isTrusted || !input.value.trim()) return;
    send('later', { text: input.value });
    input.value = '';
  });

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  window.addEventListener('focus', onVisible);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('fullscreenchange', onFullscreen);
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, onKey, true);
  chrome.storage.onChanged.addListener(onStorage);

  chrome.storage.local.get(['session', 'later', 'corner', 'done']).then((saved) => {
    session = saved.session ?? null;
    later = saved.later ?? [];
    corner = CORNERS.includes(saved.corner) ? saved.corner : CORNERS[0];
    done = saved.done ?? null;
    drawNotes();
    tick();
  });
})();
