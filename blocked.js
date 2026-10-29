// La page qui prend la place d'un site fermé pendant un bloc.
// L'adresse du site est gardée après le # pour pouvoir y retourner.
const byId = (id) => document.getElementById(id);

const target = location.hash.slice(1);
const host = hostOf(target);
const WAIT = 10; // secondes avant de rouvrir un site « dont j'ai besoin »

let session = null;
let opening = null; // le compte à rebours en cours, s'il y en a un

const leave = () => host && location.replace(target);

const cancel = () => {
  clearInterval(opening?.timer);
  opening = null;
};

const draw = () => {
  const step = stepOf(session);
  // Rouvert exprès pour ce bloc : on y retourne tout de suite.
  if (step?.kind === 'work' && lockOf(target, session.allowed)) return leave();

  const locked = Boolean(lockOf(target, lockedSites(session)));
  const held = Boolean(session) && !session.endsAt;
  if (!locked) cancel();

  document.title = locked ? t('closedDuring', host) : 'Focus';
  document.body.classList.toggle('free', !locked);
  document.body.classList.toggle('held', held);
  byId('laterForm').hidden = !locked;
  byId('need').hidden = !locked;
  byId('back').hidden = locked || !host;
  byId('back').textContent = t('backTo', host);
  byId('clock').hidden = !session;
  if (session) byId('clock').textContent = clock(leftOf(session));

  if (locked) {
    const works = session.steps.filter((entry) => entry.kind === 'work');
    const position = session.steps.slice(0, session.index + 1).filter((entry) => entry.kind === 'work').length;
    byId('why').textContent = t('waitsForBreak', host);
    byId('task').textContent = step.name;
    byId('where').textContent = held ? t('sessionHeld') : t('blockOf', position, works.length);
    byId('need').textContent = opening ? t('openingIn', opening.left) : t('needIt');
  } else {
    byId('why').textContent = host ? t('reopened', host) : '';
    const pause = step?.kind === 'pause';
    byId('task').textContent = pause ? t('itsBreak') : step ? step.name : t('sessionOver');
    byId('where').textContent = pause && !held ? t('resumeWith', session.steps[session.index + 1].name) : '';
    byId('noted').hidden = true;
  }
};

byId('back').addEventListener('click', leave);

byId('laterForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!byId('laterInput').value.trim()) return;
  send('later', { text: byId('laterInput').value });
  byId('laterInput').value = '';
  byId('noted').hidden = false;
});

// Rouvrir demande d'attendre : assez pour qu'une envie passe, pas assez pour gêner un vrai besoin.
byId('need').addEventListener('click', () => {
  if (opening) {
    cancel();
    draw();
    return;
  }
  opening = {
    left: WAIT,
    timer: setInterval(() => {
      opening.left -= 1;
      if (opening.left > 0) return draw();
      cancel();
      send('allow', { site: lockOf(target, session?.sites ?? []) });
    }, 1000),
  };
  draw();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.session) return;
  session = changes.session.newValue ?? null;
  draw();
});

// Le temps ne défile que si la page est regardée.
let ticking = null;
const watch = () => {
  clearInterval(ticking);
  ticking = document.hidden ? null : setInterval(draw, 500);
  if (!document.hidden) draw();
};
document.addEventListener('visibilitychange', watch);

(async () => {
  session = (await chrome.storage.local.get('session')).session ?? null;
  watch();
})();
