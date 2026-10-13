const byId = (id) => document.getElementById(id);

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const icon = (d) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
};

const SHORTEST = 1;
const LONGEST = 180;
const MOST = 6; // blocs dans une séance
const PAUSES = [3, 5, 10];

let plan = structuredClone(DEFAULT_PLAN);
let session = null;
let later = [];
let day = null;
let trouble = null;

const savePlan = () => chrome.storage.local.set({ plan });
const hour = (date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ---------- Avant la séance ---------- */

const drawTotal = () => {
  const total = plan.blocks.reduce((sum, block) => sum + block.minutes, 0) + plan.pause * (plan.blocks.length - 1);
  byId('total').textContent = `${span(total)} · fin à ${hour(new Date(Date.now() + total * 60000))}`;
};

const drawBlocks = () => {
  byId('blocks').replaceChildren(
    ...plan.blocks.map((block, index) => {
      const name = make('input', { type: 'text', value: block.name, maxLength: 40, placeholder: index ? 'Et ensuite ?' : 'Quelle tâche ?' });
      name.setAttribute('aria-label', `Tâche du bloc ${index + 1}`);
      name.autocomplete = 'off';
      name.addEventListener('input', () => {
        block.name = name.value;
        savePlan();
      });

      // La durée s'écrit à la main (23 min), ou se règle de 5 en 5 avec − et +.
      const length = make('input', { type: 'text', value: block.minutes, maxLength: 3, inputMode: 'numeric' });
      length.setAttribute('aria-label', `Durée du bloc ${index + 1}, en minutes`);
      length.autocomplete = 'off';
      const set = (minutes) => {
        block.minutes = Math.min(LONGEST, Math.max(SHORTEST, minutes));
        savePlan();
        drawTotal();
      };
      length.addEventListener('focus', () => length.select());
      length.addEventListener('input', () => {
        length.value = length.value.replace(/\D/g, '');
        if (Number(length.value)) set(Number(length.value));
      });
      length.addEventListener('keydown', (event) => event.key === 'Enter' && length.blur());
      length.addEventListener('blur', () => (length.value = block.minutes));
      const change = (to) => () => {
        set(to(block.minutes));
        length.value = block.minutes;
      };
      const less = make('button', { type: 'button', title: 'Moins long' }, icon('M4.5 8h7'));
      const more = make('button', { type: 'button', title: 'Plus long' }, icon('M4.5 8h7M8 4.5v7'));
      less.setAttribute('aria-label', less.title);
      more.setAttribute('aria-label', more.title);
      less.addEventListener('click', change((minutes) => Math.ceil(minutes / 5) * 5 - 5));
      more.addEventListener('click', change((minutes) => Math.floor(minutes / 5) * 5 + 5));

      const remove = make('button', { type: 'button', className: 'remove', title: 'Retirer ce bloc' }, icon('M5 5l6 6M11 5l-6 6'));
      remove.setAttribute('aria-label', remove.title);
      remove.hidden = plan.blocks.length < 2;
      remove.addEventListener('click', () => {
        plan.blocks = plan.blocks.filter((other) => other !== block);
        savePlan();
        drawBlocks();
      });

      return make('li', {}, make('span', { className: 'n', textContent: index + 1 }), name, make('div', { className: 'stepper' }, less, make('label', {}, length, 'min'), more), remove);
    }),
  );
  byId('add').hidden = plan.blocks.length >= MOST;
  drawTotal();
};

const drawPause = () => {
  byId('pause').replaceChildren(
    ...PAUSES.map((minutes) => {
      const chip = make('button', { type: 'button', textContent: `${minutes} min` });
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(plan.pause === minutes));
      chip.addEventListener('click', () => {
        plan.pause = minutes;
        savePlan();
        drawPause();
        drawTotal();
      });
      return chip;
    }),
  );
};

const drawSites = () => {
  byId('sitesPanel').hidden = !plan.blocking;
  byId('sites').replaceChildren(
    ...plan.sites.map((site) => {
      const chip = make('button', { type: 'button', title: `Ne plus fermer ${site}` }, site, icon('M5 5l6 6M11 5l-6 6'));
      chip.addEventListener('click', () => {
        plan.sites = plan.sites.filter((other) => other !== site);
        savePlan();
        drawSites();
      });
      return chip;
    }),
  );
};

// "https://www.Lequipe.fr/Football/" → "lequipe.fr" ; vide si ce n'est pas un nom de site.
const siteFrom = (typed) => {
  const name = typed.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) ? name : '';
};

byId('add').addEventListener('click', () => {
  plan.blocks.push({ id: crypto.randomUUID(), name: '', minutes: 30 });
  savePlan();
  drawBlocks();
  byId('blocks').lastElementChild.querySelector('input').focus();
});

byId('fullscreen').addEventListener('change', () => {
  plan.fullscreen = byId('fullscreen').checked;
  savePlan();
});

byId('blocking').addEventListener('change', () => {
  plan.blocking = byId('blocking').checked;
  savePlan();
  drawSites();
});

byId('siteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const site = siteFrom(byId('siteInput').value);
  byId('siteError').hidden = Boolean(site);
  byId('siteError').textContent = 'Écris l’adresse du site, par exemple lequipe.fr';
  if (!site) return;
  if (!plan.sites.includes(site)) plan.sites.push(site);
  byId('siteInput').value = '';
  savePlan();
  drawSites();
});

byId('start').addEventListener('click', () => send('start'));

/* ---------- Pendant la séance ---------- */

const drawRun = () => {
  const step = stepOf(session);
  const works = session.steps.filter((entry) => entry.kind === 'work');
  // Le bloc en cours, ou celui qui vient de finir pendant une pause.
  const position = session.steps.slice(0, session.index + 1).filter((entry) => entry.kind === 'work').length;
  const left = leftOf(session);
  const held = !session.endsAt;
  const working = step.kind === 'work';
  const after = session.steps[session.index + 1];

  document.body.dataset.kind = step.kind;
  document.body.classList.toggle('held', held);
  byId('where').textContent = working ? `Bloc ${position} sur ${works.length}` : `Bloc ${position} sur ${works.length} terminé`;
  byId('task').textContent = working ? step.name : 'Pause';
  byId('clock').textContent = clock(left);

  let next = works.length > 1 ? 'Dernier bloc de la séance' : '';
  if (held) next = 'Séance suspendue';
  else if (after?.kind === 'pause') next = `Ensuite : pause de ${span(after.minutes)}, puis ${session.steps[session.index + 2].name}`;
  else if (after) next = `Ensuite : ${after.name} · ${span(after.minutes)}`;
  byId('next').textContent = next;

  // Un segment par bloc, qui se remplit pendant qu'on y travaille.
  const track = byId('track');
  if (track.childElementCount !== works.length) track.replaceChildren(...works.map(() => make('i', {}, make('b'))));
  works.forEach((work, index) => {
    const done = index + 1 < position || (index + 1 === position && !working);
    const share = done ? 1 : index + 1 === position ? 1 - left / (work.minutes * 60000) : 0;
    track.children[index].firstChild.style.width = `${Math.round(share * 100)}%`;
  });

  byId('hold').textContent = held ? 'Reprendre' : 'Suspendre';
  byId('skip').textContent = working ? 'J’ai fini ce bloc' : 'Finir la pause';
  byId('skip').hidden = held;
};

byId('hold').addEventListener('click', () => send(session.endsAt ? 'hold' : 'resume'));
byId('skip').addEventListener('click', () => send('next'));

byId('laterForm').addEventListener('submit', (event) => {
  event.preventDefault();
  send('later', { text: byId('laterInput').value });
  byId('laterInput').value = '';
});

// Arrêter demande deux clics : un seul, par erreur, ferait perdre la séance.
let armed = null;
const disarm = () => {
  clearTimeout(armed);
  armed = null;
  byId('stop').textContent = 'Arrêter la séance';
};
byId('stop').addEventListener('click', () => {
  if (armed) {
    disarm();
    send('stop');
    return;
  }
  byId('stop').textContent = 'Clique encore pour arrêter';
  armed = setTimeout(disarm, 3000);
});

/* ---------- Les notes, et l'ensemble ---------- */

const drawLater = () => {
  const working = stepOf(session)?.kind === 'work';
  // Pendant un bloc, les notes restent rangées : seul leur nombre s'affiche.
  byId('laterCount').hidden = !working || !later.length;
  byId('laterCount').textContent = `${later.length} note${later.length > 1 ? 's' : ''} pour la pause`;
  byId('laterBox').hidden = working || !later.length;
  byId('later').replaceChildren(
    ...later.map((note) => {
      const done = make('button', { type: 'button', title: 'C’est fait' }, icon('M3.5 8.5l3 3 6-7'));
      done.setAttribute('aria-label', done.title);
      done.addEventListener('click', () => send('forget', { id: note.id }));
      return make('li', {}, make('span', { textContent: note.text, title: note.text }), done);
    }),
  );
};

const drawDay = () => {
  const blocks = day?.date === today() ? day.blocks : 0;
  byId('day').hidden = !blocks;
  byId('day').textContent = `Aujourd’hui : ${blocks} bloc${blocks > 1 ? 's' : ''} fini${blocks > 1 ? 's' : ''} · ${span(day?.minutes ?? 0)}`;
};

const drawTrouble = () => {
  byId('trouble').hidden = !trouble;
  byId('trouble').textContent = trouble ? `${trouble.what}${trouble.why ? ` (${trouble.why})` : ''}.` : '';
};

const draw = () => {
  drawTrouble();
  byId('setup').hidden = Boolean(session);
  byId('run').hidden = !session;
  if (session) drawRun();
  else {
    delete document.body.dataset.kind;
    drawTotal();
    drawDay();
  }
  drawLater();
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Le plan n'est écrit que par cette bulle : le relire ici ferait perdre le curseur en pleine frappe.
  if (changes.session) session = changes.session.newValue ?? null;
  if (changes.later) later = changes.later.newValue ?? [];
  if (changes.day) day = changes.day.newValue ?? null;
  if (changes.trouble) trouble = changes.trouble.newValue ?? null;
  if (changes.session || changes.later || changes.day || changes.trouble) draw();
});

setInterval(() => session && drawRun(), 500);

(async () => {
  const saved = await chrome.storage.local.get(['plan', 'session', 'later', 'day', 'trouble']);
  trouble = saved.trouble ?? null;
  // Un plan enregistré avant ces réglages prend leurs valeurs de départ.
  plan = { ...plan, ...saved.plan };
  byId('fullscreen').checked = plan.fullscreen;
  byId('blocking').checked = plan.blocking;
  session = saved.session ?? null;
  later = saved.later ?? [];
  day = saved.day ?? null;
  drawBlocks();
  drawPause();
  drawSites();
  draw();
})();
