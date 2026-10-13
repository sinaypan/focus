importScripts('shared.js');

const STEP = 'step'; // la fin du bloc ou de la pause en cours
const TICK = 'tick'; // une fois par minute, pour le chiffre sur l'icône
const MINUTE = 60000;
const BLOCKED = chrome.runtime.getURL('blocked.html');
const PAGES = ['http://*/*', 'https://*/*'];
// La pastille du minuteur, posée dans les pages seulement pendant une séance.
const PILL = { id: 'pill', js: ['pill.js'], matches: PAGES, runAt: 'document_start' };

const load = async () => (await chrome.storage.local.get('session')).session ?? null;
const store = (session) => (session ? chrome.storage.local.set({ session }) : chrome.storage.local.remove('session'));

// Les changements passent un par un : une alarme et un clic peuvent arriver ensemble.
let last = Promise.resolve();
const turn = (work) => (last = last.then(work, work));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un souci que la bulle affiche tel quel, pour pouvoir le lire et le recopier.
const trouble = (what, error) =>
  chrome.storage.local.set({ trouble: { at: Date.now(), what, why: String(error?.message ?? error ?? '') } }).catch(() => {});

// Une étape qui échoue est signalée, sans empêcher les suivantes.
const attempt = async (what, work) => {
  try {
    return await work();
  } catch (error) {
    trouble(what, error);
    return null;
  }
};

// Un site fermé laisse la place à la page de Focus, qui garde son adresse pour y revenir.
const park = (tabId, url) => chrome.tabs.update(tabId, { url: `${BLOCKED}#${url}` }).catch(() => {});

const onNavigate = async ({ tabId, frameId, url, documentLifecycle }) => {
  // Seulement l'onglet lui-même, et pas une page que Chrome prépare en avance sans l'afficher.
  if (frameId !== 0 || (documentLifecycle && documentLifecycle !== 'active')) return;
  if (lockOf(url, lockedSites(await load()))) park(tabId, url);
};

// Posés dès le réveil pour ne rater aucune page, puis retirés par guard() s'il n'y a
// rien à bloquer : hors d'un bloc, la navigation ne réveille pas l'extension.
const NAVIGATIONS = [chrome.webNavigation.onBeforeNavigate, chrome.webNavigation.onCommitted];
for (const event of NAVIGATIONS) event.addListener(onNavigate);

const guard = (on) => {
  for (const event of NAVIGATIONS) {
    if (on && !event.hasListener(onNavigate)) event.addListener(onNavigate);
    if (!on && event.hasListener(onNavigate)) event.removeListener(onNavigate);
  }
};

// Les pages qui s'ouvriront pendant la séance reçoivent la pastille ; après, plus aucune.
const enrol = async (on) => {
  const [enrolled] = await chrome.scripting.getRegisteredContentScripts({ ids: [PILL.id] });
  if (on && !enrolled) await chrome.scripting.registerContentScripts([PILL]);
  if (!on && enrolled) await chrome.scripting.unregisterContentScripts({ ids: [PILL.id] });
};

const inject = (tabId) => chrome.scripting.executeScript({ target: { tabId }, files: PILL.js, injectImmediately: true });

// Pose la pastille dans un onglet et vérifie qu'elle y est : échoue sur les pages
// où Chrome ne laisse rien poser (les siennes, certains documents).
const pin = async (tabId) => {
  await Promise.race([
    inject(tabId),
    wait(2000).then(() => {
      throw new Error('la page ne répond pas');
    }),
  ]);
  const [check] = await chrome.scripting.executeScript({ target: { tabId }, func: () => typeof globalThis.focusPill === 'function', injectImmediately: true });
  if (!check?.result) throw new Error('le minuteur ne s’est pas installé dans la page');
};

// Les onglets déjà ouverts : fermer ceux qui sont sur un site de la liste (sweep),
// poser la pastille dans les autres (pills), sauf celui où elle vient d'être posée (skip).
// Rien n'est attendu : un onglet figé ne doit pas retenir la séance.
const visit = async (session, { sweep, pills, skip }) => {
  const locked = lockedSites(session);
  if (!session || (!pills && !locked.length)) return;
  for (const tab of await chrome.tabs.query({ url: PAGES })) {
    if (lockOf(tab.url, locked)) park(tab.id, tab.url);
    else if (pills && !tab.discarded && tab.id !== skip) inject(tab.id).catch(() => {});
  }
};

// Demande le plein écran jusqu'à ce que la fenêtre y soit vraiment.
const fullscreen = async (windowId) => {
  for (let tries = 0; tries < 4; tries++) {
    await chrome.windows.update(windowId, { state: 'fullscreen' });
    if ((await chrome.windows.get(windowId)).state === 'fullscreen') return;
    await wait(250);
  }
};

// La fenêtre de la séance : l'onglet affiché sort seul dans sa propre fenêtre, en plein écran.
// Chrome déplace l'onglet tel quel, sans recharger la page. On note d'où il vient (home)
// pour l'y remettre à la fin.
const enter = async (tab) => {
  const from = await chrome.windows.get(tab.windowId, { populate: true });
  if (from.tabs.length < 2) {
    // Déjà seul dans sa fenêtre : il n'y a qu'à la passer en plein écran.
    if (from.state !== 'fullscreen') await fullscreen(from.id);
    return { id: from.id, state: from.state };
  }
  // En deux temps : une fenêtre créée directement en plein écran peut garder sa barre de favoris.
  const made = await chrome.windows.create({ tabId: tab.id, focused: true });
  await fullscreen(made.id);
  return { id: made.id, state: from.state, home: { windowId: from.id, tabId: tab.id, index: tab.index, groupId: tab.groupId } };
};

const leave = async (session) => {
  const focus = session?.window;
  const win = focus && (await chrome.windows.get(focus.id, { populate: true }).catch(() => null));
  if (!win) return; // pas de fenêtre de séance, ou fermée à la main
  const home = focus.home && (await chrome.windows.get(focus.home.windowId).catch(() => null));
  if (!home) {
    // Rien où retourner : la fenêtre reste, et retrouve seulement sa taille d'avant.
    if (win.state === 'fullscreen' && focus.state !== 'fullscreen') await chrome.windows.update(win.id, { state: focus.state }).catch(() => {});
    return;
  }
  // L'onglet retourne à sa place, suivi de ceux ouverts pendant la séance ; la fenêtre vide se ferme seule.
  const ids = win.tabs.map((tab) => tab.id);
  const back = ids.includes(focus.home.tabId) ? [focus.home.tabId, ...ids.filter((id) => id !== focus.home.tabId)] : ids;
  const shown = win.tabs.find((tab) => tab.active)?.id;
  await chrome.tabs.move(back, { windowId: home.id, index: focus.home.index });
  if (focus.home.groupId > -1) await chrome.tabs.group({ tabIds: focus.home.tabId, groupId: focus.home.groupId }).catch(() => {});
  if (shown) await chrome.tabs.update(shown, { active: true }).catch(() => {});
  await chrome.windows.update(home.id, { focused: true }).catch(() => {});
};

const badge = (session) => {
  const step = stepOf(session);
  if (!step) return chrome.action.setBadgeText({ text: '' });
  chrome.action.setBadgeBackgroundColor({ color: step.kind === 'work' ? '#0e93a8' : '#8e8e93' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
  // Les minutes restantes ; « II » quand la séance est suspendue.
  return chrome.action.setBadgeText({ text: session.endsAt ? String(Math.max(1, Math.ceil(leftOf(session) / MINUTE))) : 'II' });
};

// Met les alarmes, l'icône, la pastille et le blocage d'accord avec la séance enregistrée.
const settle = async (session, { sweep = false, pills = false, skip } = {}) => {
  const locked = lockedSites(session);
  guard(locked.length > 0);
  await attempt('Le minuteur ne suivra pas sur les pages ouvertes ensuite', () => enrol(Boolean(session)));
  await attempt('Le minuteur de la séance n’a pas pu être réglé', async () => {
    await chrome.alarms.clearAll();
    if (!session?.endsAt) return;
    const left = Math.max(0, session.endsAt - Date.now());
    await chrome.alarms.create(STEP, { when: session.endsAt });
    await chrome.alarms.create(TICK, { when: Date.now() + (left % MINUTE) + 100, periodInMinutes: 1 });
  });
  await attempt('Le chiffre de l’icône n’a pas pu être mis à jour', () => badge(session));
  if (sweep || pills) await attempt('Les autres onglets n’ont pas pu être préparés', () => visit(session, { sweep, pills, skip }));
};

const notify = (title, message) =>
  chrome.notifications.clear('focus', () =>
    chrome.notifications.create('focus', { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 }),
  );

const workSteps = (session) => session.steps.filter((step) => step.kind === 'work');

// Le compte du jour : un bloc fini s'y ajoute, avec le temps réellement passé dessus.
const count = async (session) => {
  const step = stepOf(session);
  if (step.kind !== 'work') return;
  const { day } = await chrome.storage.local.get('day');
  const now = day?.date === today() ? day : { date: today(), blocks: 0, minutes: 0 };
  const spent = (step.minutes * MINUTE - leftOf(session)) / MINUTE;
  await chrome.storage.local.set({ day: { ...now, blocks: now.blocks + 1, minutes: now.minutes + spent } });
};

// Passe à l'étape suivante. byClock : le temps est écoulé (sinon, c'est un clic dans la bulle).
const advance = async (byClock) => {
  const session = await load();
  if (!session) return;
  await count(session);
  const done = stepOf(session);
  const next = session.steps[session.index + 1];
  if (!next) {
    const blocks = workSteps(session).length;
    // Pour la pastille : cette séance est allée au bout, elle n'a pas été arrêtée.
    await chrome.storage.local.set({ done: { at: Date.now(), blocks } });
    await store(null);
    await settle(null);
    await leave(session).catch(() => {});
    if (byClock) notify('Séance terminée', `${blocks} bloc${blocks > 1 ? 's' : ''} au bout. Les sites sont rouverts.`);
    return;
  }
  const moved = { ...session, index: session.index + 1, allowed: [], endsAt: Date.now() + next.minutes * MINUTE };
  delete moved.left;
  await store(moved);
  await settle(moved, { sweep: true });
  if (!byClock) return;
  if (next.kind === 'pause') {
    const after = moved.steps[moved.index + 1];
    notify(`Pause · ${span(next.minutes)}`, `Bloc terminé : ${done.name}. Ensuite : ${after.name}.`);
  } else {
    const position = workSteps({ steps: moved.steps.slice(0, moved.index + 1) }).length;
    notify(`${next.name} · ${span(next.minutes)}`, `La pause est finie. Bloc ${position} sur ${workSteps(moved).length}.`);
  }
};

const ACTIONS = {
  async start() {
    const { plan = DEFAULT_PLAN } = await chrome.storage.local.get('plan');
    const blocks = plan.blocks.filter((block) => block.minutes > 0);
    if (!blocks.length) return;
    const steps = blocks.flatMap((block, index) => [
      { kind: 'work', name: block.name.trim() || `Bloc ${index + 1}`, minutes: block.minutes },
      ...(index < blocks.length - 1 && plan.pause > 0 ? [{ kind: 'pause', minutes: plan.pause }] : []),
    ]);
    await chrome.storage.local.remove('trouble');
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
    // La pastille d'abord, dans l'onglet d'où part la séance. Si elle ne peut pas s'y poser,
    // pas de plein écran : sans elle ni la barre de Chrome, il ne resterait aucun moyen d'agir.
    const place = hostOf(tab?.url) || 'cette page';
    const pinned = Boolean(tab) && (await attempt(`Le minuteur ne peut pas s’afficher sur ${place}`, () => pin(tab.id).then(() => true)));
    const wanted = plan.fullscreen !== false && pinned;
    const window = wanted ? await attempt('La fenêtre n’a pas pu passer en plein écran', () => enter(tab)) : null;
    const sites = plan.blocking ? plan.sites : [];
    const session = { steps, index: 0, endsAt: Date.now() + steps[0].minutes * MINUTE, sites, allowed: [], window };
    await store(session);
    await settle(session, { sweep: true, pills: true, skip: pinned ? tab.id : undefined });
  },

  next: () => advance(false),

  async hold() {
    const session = await load();
    if (!session?.endsAt) return;
    const held = { ...session, left: leftOf(session) };
    delete held.endsAt;
    await store(held);
    await settle(held);
  },

  async resume() {
    const session = await load();
    if (!session || session.endsAt) return;
    const resumed = { ...session, endsAt: Date.now() + session.left };
    delete resumed.left;
    await store(resumed);
    await settle(resumed, { sweep: true });
  },

  async stop() {
    const session = await load();
    await store(null);
    await settle(null);
    await leave(session).catch(() => {});
  },

  // Rouvre un site de la liste jusqu'à la fin du bloc en cours.
  async allow({ site }) {
    const session = await load();
    if (!session || !lockedSites(session).includes(site)) return;
    const opened = { ...session, allowed: [...session.allowed, site] };
    await store(opened);
    await settle(opened);
  },

  // Une idée ou une envie notée pendant un bloc, à retrouver à la pause.
  async later({ text }) {
    const note = String(text ?? '').trim().slice(0, 200);
    if (!note) return;
    const { later = [] } = await chrome.storage.local.get('later');
    await chrome.storage.local.set({ later: [...later, { id: crypto.randomUUID(), text: note, at: Date.now() }].slice(-50) });
  },

  async forget({ id }) {
    const { later = [] } = await chrome.storage.local.get('later');
    await chrome.storage.local.set({ later: later.filter((note) => note.id !== id) });
  },
};

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !Object.hasOwn(ACTIONS, message?.focus)) return false;
  turn(() => ACTIONS[message.focus](message)).then(
    () => respond(true),
    () => respond(false),
  );
  return true;
});

chrome.alarms.onAlarm.addListener(({ name }) =>
  turn(async () => {
    const session = await load();
    if (name === TICK) return badge(session);
    // Une alarme d'une étape déjà quittée ne compte pas.
    if (name === STEP && session?.endsAt && Date.now() >= session.endsAt - 1000) await advance(true);
  }),
);

// Au lancement de Chrome ou après une mise à jour : les alarmes, le chiffre de l'icône
// et la pastille dans les onglets sont à refaire.
const restore = () => turn(async () => settle(await load(), { sweep: true, pills: true }));
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);

// À chaque réveil : garder l'écoute de la navigation seulement s'il y a quelque chose à bloquer.
turn(async () => guard(lockedSites(await load()).length > 0));
