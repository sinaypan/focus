// Ce que la bulle, la page de blocage et le fond ont en commun.

const DEFAULT_PLAN = {
  blocks: [
    { id: 'a', name: '', minutes: 30 },
    { id: 'b', name: '', minutes: 30 },
  ],
  pause: 5,
  fullscreen: true, // l'onglet sort dans sa propre fenêtre, en plein écran, pendant la séance
  blocking: false, // les sites de la liste sont fermés pendant les blocs
  sites: ['youtube.com', 'instagram.com', 'tiktok.com', 'x.com', 'facebook.com', 'reddit.com', 'twitch.tv', 'netflix.com'],
};

// "https://www.youtube.com/watch" → "youtube.com" ; vide pour ce qui n'est pas une page web.
const hostOf = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) ? hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

// Le site de la liste qui couvre cette adresse : lui-même ou un de ses sous-domaines.
const lockOf = (url, sites) => {
  const host = hostOf(url);
  return (host && sites.find((site) => host === site || host.endsWith(`.${site}`))) || null;
};

// Une séance : { steps: [{ kind: 'work' | 'pause', name, minutes }], index, endsAt, sites, allowed, window }.
// Suspendue, elle n'a plus d'heure de fin (endsAt) mais un temps restant (left).
const stepOf = (session) => session?.steps[session.index] ?? null;

const leftOf = (session, now = Date.now()) => Math.max(0, session.endsAt ? session.endsAt - now : session.left);

// Les sites fermés en ce moment : ceux de la liste pendant un bloc, aucun pendant une pause.
const lockedSites = (session) =>
  stepOf(session)?.kind === 'work' ? session.sites.filter((site) => !session.allowed.includes(site)) : [];

// 754000 → "12:34", 4500000 → "1:15:00"
const clock = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const [hours, minutes] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60)];
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
};

// 30 → "30 min", 95 → "1 h 35"
const span = (minutes) => {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  return whole % 60 ? `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')}` : `${whole / 60} h`;
};

const today = () => new Date().toLocaleDateString('sv');

// Tout changement de séance passe par le fond, qui est le seul à l'écrire.
const send = (focus, more = {}) => chrome.runtime.sendMessage({ focus, ...more });
