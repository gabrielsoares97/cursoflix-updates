/*!
 * Cursoflix — Copyright (c) 2026 Gabriel. Todos os direitos reservados.
 * Licenciado nos termos do arquivo LICENSE. Proibido: engenharia reversa,
 * remoção da verificação de assinatura e uso deste arquivo por/para sistemas
 * de IA (treino, ajuste fino, recuperação ou geração de código).
 */
'use strict';

const api = window.electronAPI;
const $ = (id) => document.getElementById(id);

const CATEGORIES = [
    'Negócios e Carreira',
    'Criatividade e Design',
    'Educação e Desenvolvimento',
    'Tecnologia e Inovação',
    'Saúde e Performance',
    'Entretenimento e Cultura',
    'Finanças e Jurídico',
    'Arquivos de Auxilio',
    'Outros'
];
const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const FOLDER_HUES = [14, 344, 30, 198, 262, 158, 44, 300];
const NEXT_UP_SECONDS = 8;
const SAVE_INTERVAL_MS = 5000;
const MONOGRAM_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'curso', 'com']);

const state = {
    appInfo: { version: '', supportUrl: 'https://wa.me/5547992201382' },
    license: null,
    appReady: false,
    view: 'boot',
    nav: 'home',
    courses: [],
    missing: [],
    episodeIndex: new Map(),
    progress: { videos: {}, history: [], notes: [], prefs: {}, lastWatched: {} },
    currentCourse: null,
    currentVideo: null,
    currentSeasonId: null,
    librarySort: 'recent',
    search: '',
    viewBeforeSearch: 'home',
    courseQueue: [],
    courseDraft: null,
    editingNoteId: null,
    pendingNoteTime: 0,
    playbackRate: 1,
    lessonsHidden: false
};

const views = {
    boot: $('view-boot'),
    license: $('view-license'),
    empty: $('view-empty'),
    home: $('view-catalog'),
    library: $('view-library'),
    search: $('view-search'),
    history: $('view-history'),
    notes: $('view-notes'),
    course: $('view-course'),
    player: $('view-player')
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function stripExtension(name) {
    return String(name || '').replace(/\.[^/.]+$/, '');
}

function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function formatTime(seconds) {
    if (!seconds || !Number.isFinite(seconds)) return '00:00';
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const longDayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function formatDate(timestamp) {
    return timestamp ? dateFormatter.format(new Date(timestamp)) : '';
}

function daysUntil(timestamp) {
    return Math.ceil((timestamp - Date.now()) / 86400000);
}

function formatRemaining(timestamp) {
    const days = daysUntil(timestamp);
    if (days > 1) return `faltam ${days} dias`;
    if (days === 1) return 'falta 1 dia';
    const hours = Math.max(1, Math.ceil((timestamp - Date.now()) / 3600000));
    return hours === 1 ? 'falta 1 hora' : `faltam ${hours} horas`;
}

function hashString(value) {
    let hash = 0;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function courseHue(course) {
    return FOLDER_HUES[hashString(course.id) % FOLDER_HUES.length];
}

function monogram(name) {
    const words = String(name || '').split(/\s+/).filter(Boolean);
    const meaningful = words.filter((word) => !MONOGRAM_STOPWORDS.has(word.toLowerCase()));
    const source = meaningful.length ? meaningful : words;
    if (source.length === 0) return 'C';
    if (source.length === 1) return source[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
    return (source[0][0] + source[1][0]).toUpperCase();
}

function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function isLicenseError(error) {
    return String(error && error.message ? error.message : error).includes('LICENSE_REQUIRED');
}

function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function makeActivatable(element, handler) {
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.addEventListener('click', handler);
    element.addEventListener('keydown', (event) => {
        if (event.target !== element) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handler(event);
        }
    });
}

function openExternal(url) {
    if (api && api.openExternal) api.openExternal(url);
}

function supportLink(message) {
    const base = state.appInfo.supportUrl || 'https://wa.me/5547992201382';
    return `${base}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Componentes de interface: avisos, modais, menus
// ---------------------------------------------------------------------------

function toast(message, { type = 'success', action = null, duration = 4200 } = {}) {
    const container = $('toasts');
    const item = document.createElement('div');
    item.className = `toast${type === 'error' ? ' is-error' : ''}`;
    const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
    item.innerHTML = `<i class="fas ${icon}"></i><span></span>`;
    item.querySelector('span').textContent = message;

    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-link';
        button.textContent = action.label;
        button.addEventListener('click', () => {
            action.onClick();
            dismiss();
        });
        item.appendChild(button);
    }

    function dismiss() {
        item.classList.add('is-leaving');
        setTimeout(() => item.remove(), 220);
    }

    container.appendChild(item);
    setTimeout(dismiss, duration);
}

function openModal(id) {
    const modal = $(id);
    modal.classList.add('active');
    hideMenus();
    showPlayerControls();
    requestAnimationFrame(() => {
        const focusTarget = modal.querySelector('[autofocus], input, textarea, select, .btn-primary');
        if (focusTarget) focusTarget.focus();
    });
}

function closeModal(id) {
    $(id).classList.remove('active');
    if (id === 'pdf-modal') $('pdf-modal-frame').removeAttribute('src');
    queueControlsHide();
}

function topModal() {
    const open = Array.from(document.querySelectorAll('.modal-overlay.active'));
    return open[open.length - 1] || null;
}

let confirmResolver = null;

function confirmDialog({ title, text = '', confirmLabel = 'Confirmar', danger = false }) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const ok = $('btn-confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    openModal('confirm-modal');
    ok.focus();
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
}

function settleConfirm(value) {
    closeModal('confirm-modal');
    if (confirmResolver) confirmResolver(value);
    confirmResolver = null;
}

function hideMenus() {
    $('context-menu').hidden = true;
    $('account-menu').hidden = true;
    $('btn-account').setAttribute('aria-expanded', 'false');
    $('speed-menu').classList.remove('active');
}

function showContextMenu(event, items) {
    event.preventDefault();
    event.stopPropagation();
    const menu = $('context-menu');
    menu.innerHTML = '';

    items.filter(Boolean).forEach((item) => {
        if (item === 'divider') {
            menu.appendChild(document.createElement('hr'));
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        if (item.danger) button.className = 'is-danger';
        button.innerHTML = `<i class="fas ${item.icon}"></i><span></span>`;
        button.querySelector('span').textContent = item.label;
        button.addEventListener('click', () => {
            hideMenus();
            item.onClick();
        });
        menu.appendChild(button);
    });

    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (!x && !y && event.currentTarget && event.currentTarget.getBoundingClientRect) {
        const anchor = event.currentTarget.getBoundingClientRect();
        x = anchor.left;
        y = anchor.bottom + 6;
    }
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 12)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 12)}px`;
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

const VIEWS_WITH_HEADER = new Set(['empty', 'home', 'library', 'search', 'history', 'notes', 'course']);
const SOLID_HEADER_VIEWS = new Set(['library', 'search', 'history', 'notes', 'empty']);

function showView(name) {
    Object.entries(views).forEach(([key, element]) => element.classList.toggle('active', key === name));
    state.view = name;
    document.body.dataset.view = name;
    $('app-header').hidden = !VIEWS_WITH_HEADER.has(name);
    updateHeaderSolid();
    if (name !== 'player') window.scrollTo(0, 0);
}

function setNav(name) {
    state.nav = name;
    document.querySelectorAll('.nav-link').forEach((link) => {
        link.classList.toggle('active', link.dataset.nav === name);
    });
}

function updateHeaderSolid() {
    $('app-header').classList.toggle('is-solid', SOLID_HEADER_VIEWS.has(state.view) || window.scrollY > 40);
}

function goTo(name) {
    hideMenus();
    if (state.search) clearSearch(false);

    if (state.courses.length === 0 && (name === 'home' || name === 'library')) {
        showView('empty');
        setNav(name);
        return;
    }

    if (name === 'home') renderHome();
    if (name === 'library') renderLibrary();
    if (name === 'history') renderHistory();
    if (name === 'notes') renderNotes();
    showView(name);
    setNav(name);
}

// ---------------------------------------------------------------------------
// Inicialização e assinatura
// ---------------------------------------------------------------------------

async function boot() {
    setupStaticListeners();
    setupUpdaterUi();

    try {
        state.appInfo = { ...state.appInfo, ...(await api.getAppInfo()) };
        $('menu-version').textContent = `Cursoflix ${state.appInfo.version}`;
        document.title = `Cursoflix ${state.appInfo.version}`;
    } catch (error) {
        console.error('Falha ao ler informações do app:', error);
    }

    applyTheme().catch(() => { });

    let license;
    try {
        license = await api.checkLicense();
    } catch (error) {
        console.error('Falha ao verificar assinatura:', error);
        license = { valid: false, reason: 'error' };
    }

    state.license = license;
    if (license && license.valid) {
        await enterApp();
    } else {
        showLicense(license);
    }

    api.onLicenseState((next) => {
        state.license = next;
        updateAccountMenu();
        if (!next.valid && state.appReady) {
            leaveApp(next);
        }
    });
}

const LOGIN_MESSAGES = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    missing_credentials: 'Preencha o e-mail e a senha.',
    invalid_email: 'Digite um e-mail válido.',
    offline: 'Sem conexão com a internet. Conecte-se para entrar.',
    rate_limited: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
    revoked: 'Sua sessão foi encerrada. Entre de novo.',
    session_expired: 'Sua sessão expirou. Entre de novo.',
    error: 'Não foi possível entrar agora. Tente de novo em instantes.'
};

const BLOCKED_STATES = {
    expired: {
        icon: 'fa-hourglass-end',
        title: 'Sua assinatura expirou',
        text: (license) => `O acesso de ${license.email || 'sua conta'} terminou em ${formatDate(license.expiresAt)}. Renove para voltar a assistir — seu progresso e suas notas continuam salvos.`,
        renew: true
    },
    no_plan: {
        icon: 'fa-user-clock',
        title: 'Sua conta ainda não tem um plano',
        text: (license) => `A conta ${license.email || ''} existe, mas nenhum plano foi ativado. Fale com o suporte para liberar o acesso.`,
        renew: true
    },
    suspended: {
        icon: 'fa-ban',
        title: 'Conta suspensa',
        text: () => 'O acesso desta conta foi suspenso. Fale com o suporte para saber o motivo.',
        renew: true
    },
    offline: {
        icon: 'fa-wifi',
        title: 'Conecte-se à internet',
        text: () => 'Faz mais de 7 dias que o Cursoflix não confirma sua assinatura. Conecte o computador à internet e verifique de novo.',
        renew: false
    },
    clock: {
        icon: 'fa-clock',
        title: 'Confira o relógio do computador',
        text: () => 'A data do computador parece estar atrasada. Ajuste a data e a hora do Windows e verifique de novo.',
        renew: false
    }
};

function showLicense(license = {}) {
    state.appReady = false;
    showView('license');

    const blocked = BLOCKED_STATES[license.reason];
    $('license-login').hidden = Boolean(blocked);
    $('license-blocked').hidden = !blocked;

    if (blocked) {
        $('blocked-icon').innerHTML = `<i class="fas ${blocked.icon}"></i>`;
        $('blocked-title').textContent = blocked.title;
        $('blocked-text').textContent = blocked.text(license);
        $('btn-renew-whatsapp').hidden = !blocked.renew;
        return;
    }

    const message = LOGIN_MESSAGES[license.reason];
    setLoginError(message || '');
    if (license.email) $('input-email').value = license.email;
    requestAnimationFrame(() => ($('input-email').value ? $('input-password') : $('input-email')).focus());
}

function setLoginError(message) {
    const element = $('login-error');
    element.textContent = message;
    element.hidden = !message;
}

async function handleLogin(event) {
    event.preventDefault();
    const email = $('input-email').value.trim();
    const password = $('input-password').value;
    const button = $('btn-login');

    if (!email || !password) {
        setLoginError(LOGIN_MESSAGES.missing_credentials);
        return;
    }

    button.disabled = true;
    button.textContent = 'Entrando…';
    setLoginError('');

    try {
        const result = await api.login({ email, password });
        state.license = result;
        if (result.valid) {
            $('input-password').value = '';
            await enterApp();
            return;
        }
        if (BLOCKED_STATES[result.reason]) {
            showLicense(result);
            return;
        }
        setLoginError(LOGIN_MESSAGES[result.reason] || LOGIN_MESSAGES.error);
    } catch (error) {
        console.error('Erro no login:', error);
        setLoginError(LOGIN_MESSAGES.error);
    } finally {
        button.disabled = false;
        button.textContent = 'Entrar';
    }
}

async function recheckLicense() {
    const button = $('btn-recheck');
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>Verificando…';
    try {
        const result = await api.checkLicense();
        state.license = result;
        if (result.valid) await enterApp();
        else showLicense(result);
    } catch (error) {
        toast('Não foi possível verificar agora. Tente de novo.', { type: 'error' });
    } finally {
        button.disabled = false;
        button.innerHTML = original;
    }
}

async function logout() {
    const confirmed = await confirmDialog({
        title: 'Sair da conta?',
        text: 'Seu progresso e suas notas continuam salvos neste computador.',
        confirmLabel: 'Sair'
    });
    if (!confirmed) return;
    stopPlayback();
    const result = await api.logout();
    state.license = result;
    showLicense(result);
}

function leaveApp(license) {
    stopPlayback();
    document.querySelectorAll('.modal-overlay.active').forEach((modal) => modal.classList.remove('active'));
    showLicense(license);
}

async function enterApp() {
    state.appReady = true;
    $('boot-text').textContent = 'Carregando sua biblioteca…';
    showView('boot');
    updateAccountMenu();

    try {
        await reloadLibrary();
    } catch (error) {
        if (isLicenseError(error)) {
            leaveApp(state.license || { reason: 'revoked' });
            return;
        }
        console.error('Falha ao carregar a biblioteca:', error);
        toast('Não foi possível ler a biblioteca. Tente reiniciar o app.', { type: 'error' });
    }

    const prefs = state.progress.prefs || {};
    state.playbackRate = PLAYBACK_SPEEDS.includes(prefs.playbackRate) ? prefs.playbackRate : 1;
    state.lessonsHidden = Boolean(prefs.lessonsPanelHidden);
    if (typeof prefs.volume === 'number') player.video.volume = Math.min(1, Math.max(0, prefs.volume));
    setPlaybackRate(state.playbackRate, false);
    setLessonsHidden(state.lessonsHidden, false);

    goTo('home');
    maybeShowWhatsNew();
    maybeWarnExpiry();
}

function updateAccountMenu() {
    const license = state.license || {};
    const email = license.email || 'Sua conta';
    $('account-email').textContent = email;
    $('account-initial').textContent = (email[0] || 'C').toUpperCase();

    const plan = $('account-plan');
    plan.classList.remove('is-warning');
    let text = '';
    if (license.role === 'admin' || (license.valid && !license.expiresAt)) {
        text = 'Acesso vitalício';
    } else if (license.expiresAt) {
        text = `Assinatura até ${formatDate(license.expiresAt)} (${formatRemaining(license.expiresAt)})`;
        if (daysUntil(license.expiresAt) <= 7) plan.classList.add('is-warning');
    }
    if (license.offline && license.offlineUntil) {
        text += `${text ? '. ' : ''}Modo offline até ${formatDate(license.offlineUntil)}`;
    }
    plan.textContent = text;
}

function maybeWarnExpiry() {
    const license = state.license || {};
    if (!license.expiresAt || license.role === 'admin') return;
    const days = daysUntil(license.expiresAt);
    if (days > 5) return;
    toast(`Sua assinatura termina em ${formatDate(license.expiresAt)}.`, {
        type: 'info',
        duration: 9000,
        action: { label: 'Renovar', onClick: () => openExternal(supportLink('Quero renovar minha assinatura do Cursoflix')) }
    });
}

function maybeShowWhatsNew() {
    const version = state.appInfo.version;
    if (!version) return;
    const seen = state.progress.prefs && state.progress.prefs.lastPatchNotesVersion;
    if (seen === version) return;
    rememberPreference('lastPatchNotesVersion', version);
    if (state.courses.length > 0) openModal('whats-new-modal');
}

function rememberPreference(key, value) {
    if (!state.progress.prefs) state.progress.prefs = {};
    state.progress.prefs[key] = value;
    api.setPreference(key, value).catch(() => { });
}

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------

async function reloadLibrary() {
    const library = await api.loadLibrary();
    state.courses = library.courses || [];
    state.missing = library.missing || [];
    state.progress = {
        videos: {},
        history: [],
        notes: [],
        prefs: {},
        lastWatched: {},
        ...(library.progress || {})
    };
    rebuildEpisodeIndex();
}

function rebuildEpisodeIndex() {
    state.episodeIndex = new Map();
    state.courses.forEach((course) => {
        course.hue = courseHue(course);
        course.lessonCount = 0;
        (course.seasons || []).forEach((season) => {
            season.episodes.forEach((episode) => {
                course.lessonCount += 1;
                state.episodeIndex.set(episode.id, { course, season, episode });
            });
        });
    });
}

function findCourse(courseId) {
    return state.courses.find((course) => course.id === courseId) || null;
}

function courseEpisodes(course) {
    const episodes = [];
    (course.seasons || []).forEach((season) => episodes.push(...season.episodes));
    return episodes;
}

function videoProgress(videoId) {
    return (state.progress.videos && state.progress.videos[videoId]) || null;
}

function progressStats(episodes) {
    const total = episodes.length;
    let completed = 0;
    let started = 0;
    let lastActivity = 0;
    episodes.forEach((episode) => {
        const progress = videoProgress(episode.id);
        if (!progress) return;
        lastActivity = Math.max(lastActivity, progress.timestamp || 0);
        if (progress.completed) completed += 1;
        else if (progress.time > 0) started += 1;
    });
    return {
        total,
        completed,
        started,
        lastActivity,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0
    };
}

function courseStats(course) {
    return progressStats(courseEpisodes(course));
}

function progressSummary(stats) {
    let text = `${stats.completed} de ${pluralize(stats.total, 'aula', 'aulas')}`;
    if (stats.started > 0) text += `, ${stats.started} em andamento`;
    return text;
}

function lessonStatusText(progress) {
    if (!progress) return 'Não iniciada';
    if (progress.completed) return 'Concluída';
    return `Parou em ${formatTime(progress.time)}`;
}

function buildModules(course) {
    const modules = [];
    const byName = new Map();

    (course.seasons || []).forEach((season) => {
        const parts = String(season.name || 'Geral').split(' / ').map((part) => part.trim()).filter(Boolean);
        const moduleName = parts[0] || 'Geral';
        const subName = parts.length > 1 ? parts.slice(1).join(' / ') : '';

        if (!byName.has(moduleName)) {
            const module = { name: moduleName, seasons: [], episodes: [] };
            byName.set(moduleName, module);
            modules.push(module);
        }
        const module = byName.get(moduleName);
        module.seasons.push({ ...season, displayName: subName });
        module.episodes.push(...season.episodes);
    });

    return modules;
}

function nextLessonToWatch(course) {
    const episodes = courseEpisodes(course);
    const lastId = state.progress.lastWatched && state.progress.lastWatched[course.id];
    const last = lastId ? episodes.find((episode) => episode.id === lastId) : null;
    if (last && !(videoProgress(last.id) || {}).completed) return { episode: last, resume: true };

    const startIndex = last ? episodes.indexOf(last) + 1 : 0;
    const ordered = [...episodes.slice(startIndex), ...episodes.slice(0, startIndex)];
    const next = ordered.find((episode) => !(videoProgress(episode.id) || {}).completed);
    if (next) return { episode: next, resume: Boolean(videoProgress(next.id)) };
    return { episode: episodes[0] || null, resume: false, finished: true };
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function setBackdrop(element, course) {
    element.classList.toggle('has-image', Boolean(course && course.coverUrl));
    if (course && course.coverUrl) {
        element.style.backgroundImage = `url("${course.coverUrl}")`;
    } else if (course) {
        const hue = course.hue;
        element.style.backgroundImage = `radial-gradient(90% 120% at 85% 20%, hsl(${hue} 60% 32% / 0.95), transparent 65%), radial-gradient(60% 80% at 60% 100%, hsl(${hue + 30} 55% 22% / 0.9), transparent 70%)`;
    } else {
        element.style.backgroundImage = '';
    }
}

function renderHome() {
    renderHero();
    renderMissingNotice();
    renderRows();
}

function latestHistoryEntry() {
    return (state.progress.history || []).map((entry) => state.episodeIndex.get(entry.videoId)).find(Boolean) || null;
}

function renderHero() {
    const latest = latestHistoryEntry();
    const kicker = $('hero-kicker');
    const playButton = $('btn-hero-play');
    const openButton = $('btn-hero-open');
    const progressWrap = $('hero-progress');

    let course;
    if (latest) {
        course = latest.course;
        const next = nextLessonToWatch(course);
        const episode = next.episode || latest.episode;
        const progress = videoProgress(episode.id);
        kicker.textContent = next.finished ? 'Você concluiu este curso' : 'Continue de onde parou';
        $('hero-title').textContent = course.displayName;
        $('hero-subtitle').textContent = stripExtension(episode.name);
        playButton.querySelector('span').textContent = next.finished ? 'Assistir de novo' : (next.resume ? 'Continuar aula' : 'Próxima aula');

        if (progress && progress.duration > 0 && !progress.completed) {
            progressWrap.hidden = false;
            $('hero-progress-fill').style.width = `${Math.min(100, (progress.time / progress.duration) * 100)}%`;
            $('hero-progress-text').textContent = `${formatTime(progress.time)} de ${formatTime(progress.duration)}`;
        } else {
            progressWrap.hidden = true;
        }
        playButton.onclick = () => playVideo(course, episode);
    } else {
        course = [...state.courses].pop();
        const stats = course ? courseStats(course) : null;
        kicker.textContent = 'Adicionado recentemente';
        $('hero-title').textContent = course ? course.displayName : '';
        $('hero-subtitle').textContent = course
            ? `${pluralize(buildModules(course).length, 'módulo', 'módulos')} e ${pluralize(stats.total, 'aula', 'aulas')} prontos para assistir.`
            : '';
        progressWrap.hidden = true;
        playButton.querySelector('span').textContent = 'Começar curso';
        playButton.onclick = () => {
            const first = course && courseEpisodes(course)[0];
            if (first) playVideo(course, first);
        };
    }

    openButton.onclick = () => course && openCourse(course);
    setBackdrop($('hero-backdrop'), course);

    const totals = state.courses.reduce((acc, item) => {
        const stats = courseStats(item);
        acc.lessons += stats.total;
        acc.completed += stats.completed;
        return acc;
    }, { lessons: 0, completed: 0 });

    $('hero-stats').innerHTML = `
        <div><dt>${state.courses.length === 1 ? 'curso' : 'cursos'}</dt><dd>${state.courses.length}</dd></div>
        <div><dt>aulas concluídas</dt><dd>${totals.completed}</dd></div>
        <div><dt>${(state.progress.notes || []).length === 1 ? 'nota' : 'notas'}</dt><dd>${(state.progress.notes || []).length}</dd></div>
    `;
}

function renderMissingNotice() {
    const notice = $('missing-notice');
    if (!state.missing.length) {
        notice.hidden = true;
        return;
    }
    const names = state.missing.map((item) => item.name).join(', ');
    notice.hidden = false;
    notice.innerHTML = `
        <i class="fas fa-triangle-exclamation"></i>
        <p></p>
        <button type="button" class="btn btn-ghost" data-action="retry">Procurar de novo</button>
        <button type="button" class="btn btn-link" data-action="remove">Remover da biblioteca</button>
    `;
    notice.querySelector('p').textContent = state.missing.length === 1
        ? `Não encontramos a pasta de "${names}". Ela pode ter sido movida ou o HD externo está desconectado.`
        : `Não encontramos as pastas de ${state.missing.length} cursos (${names}). Elas podem ter sido movidas ou o HD externo está desconectado.`;
    notice.querySelector('[data-action="retry"]').addEventListener('click', async () => {
        await reloadLibrary();
        goTo('home');
    });
    notice.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        const confirmed = await confirmDialog({
            title: 'Remover cursos não encontrados?',
            text: 'Os arquivos não são apagados. O progresso continua salvo caso você adicione as pastas de novo.',
            confirmLabel: 'Remover',
            danger: true
        });
        if (!confirmed) return;
        for (const item of state.missing) await api.removeCourse(item.path);
        await reloadLibrary();
        goTo('home');
    });
}

function createRow(title, items, { lessons = false, count = null } = {}) {
    const row = document.createElement('section');
    row.className = 'row';
    row.innerHTML = `
        <div class="row-head"><h2></h2>${count !== null ? `<span>${count}</span>` : ''}</div>
        <button type="button" class="row-arrow is-left" aria-label="Rolar para a esquerda"><i class="fas fa-chevron-left"></i></button>
        <div class="row-track${lessons ? ' is-lessons' : ''}"></div>
        <button type="button" class="row-arrow is-right" aria-label="Rolar para a direita"><i class="fas fa-chevron-right"></i></button>
    `;
    row.querySelector('h2').textContent = title;
    const track = row.querySelector('.row-track');
    items.forEach((item) => track.appendChild(item));

    const left = row.querySelector('.is-left');
    const right = row.querySelector('.is-right');
    const updateArrows = () => {
        left.disabled = track.scrollLeft <= 4;
        right.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    left.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' }));
    right.addEventListener('click', () => track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' }));
    track.addEventListener('scroll', updateArrows, { passive: true });
    requestAnimationFrame(updateArrows);
    return row;
}

function renderRows() {
    const container = $('catalog-rows');
    container.innerHTML = '';

    const inProgress = Object.entries(state.progress.videos || {})
        .filter(([, progress]) => progress && !progress.completed && progress.time > 5)
        .map(([videoId, progress]) => ({ entry: state.episodeIndex.get(videoId), progress }))
        .filter((item) => item.entry)
        .sort((a, b) => (b.progress.timestamp || 0) - (a.progress.timestamp || 0))
        .slice(0, 15);

    if (inProgress.length) {
        container.appendChild(createRow(
            'Continuar assistindo',
            inProgress.map(({ entry, progress }) => createLessonTile(entry.course, entry.episode, progress)),
            { lessons: true }
        ));
    }

    const byCategory = new Map();
    state.courses.forEach((course) => {
        const category = course.category || 'Outros';
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category).push(course);
    });

    const order = [...CATEGORIES, ...Array.from(byCategory.keys()).filter((name) => !CATEGORIES.includes(name))];
    order.forEach((category) => {
        const courses = byCategory.get(category);
        if (!courses || !courses.length) return;
        container.appendChild(createRow(category, courses.map(createCourseCard), { count: courses.length }));
    });
}

function createCourseCard(course) {
    const stats = courseStats(course);
    const card = document.createElement('div');
    card.className = `course-card${course.coverUrl ? ' has-cover' : ''}`;
    card.style.setProperty('--folder-hue', course.hue);
    card.dataset.courseId = course.id;
    card.setAttribute('aria-label', `${course.displayName}, ${stats.percent}% concluído`);

    card.innerHTML = `
        <div class="course-card-art">${course.coverUrl ? '<img alt="" loading="lazy">' : ''}</div>
        ${course.coverUrl ? '' : `<span class="course-monogram" aria-hidden="true">${escapeHtml(monogram(course.displayName))}</span>`}
        ${stats.percent === 100 ? '<span class="course-card-badge is-done"><i class="fas fa-check"></i>Concluído</span>' : ''}
        <span class="course-card-play" aria-hidden="true"><i class="fas fa-play"></i></span>
        <h3></h3>
        <div class="course-card-meta"><span>${escapeHtml(progressSummary(stats))}</span><strong>${stats.percent}%</strong></div>
        <div class="bar${stats.percent === 100 ? ' is-done' : ''}"><span style="width:${stats.percent}%"></span></div>
    `;
    if (course.coverUrl) card.querySelector('img').src = course.coverUrl;
    card.querySelector('h3').textContent = course.displayName;

    makeActivatable(card, () => openCourse(course));
    card.addEventListener('contextmenu', (event) => showCourseMenu(event, course));
    return card;
}

function createLessonTile(course, episode, progress) {
    const tile = document.createElement('div');
    tile.className = 'lesson-tile';
    const percent = progress && progress.duration ? Math.min(100, (progress.time / progress.duration) * 100) : 0;
    tile.innerHTML = `
        <div class="lesson-tile-art" style="--folder-hue:${course.hue}">
            ${course.coverUrl ? '<img alt="" loading="lazy">' : ''}
            <span class="play"><i class="fas fa-play"></i></span>
            <div class="bar"><span style="width:${percent}%"></span></div>
        </div>
        <div class="lesson-tile-body"><small></small><strong></strong></div>
    `;
    if (course.coverUrl) tile.querySelector('img').src = course.coverUrl;
    tile.querySelector('small').textContent = `${course.displayName} — parou em ${formatTime(progress ? progress.time : 0)}`;
    tile.querySelector('strong').textContent = stripExtension(episode.name);
    makeActivatable(tile, () => playVideo(course, episode));
    tile.addEventListener('contextmenu', (event) => showEpisodeMenu(event, course, episode));
    return tile;
}

// ---------------------------------------------------------------------------
// Biblioteca (grade) e busca
// ---------------------------------------------------------------------------

function renderLibrary() {
    const grid = $('library-grid');
    grid.innerHTML = '';
    const totalLessons = state.courses.reduce((sum, course) => sum + course.lessonCount, 0);
    $('library-count').textContent = `${pluralize(state.courses.length, 'curso', 'cursos')} e ${pluralize(totalLessons, 'aula', 'aulas')}.`;

    const courses = [...state.courses];
    const indexOf = new Map(state.courses.map((course, index) => [course.id, index]));
    if (state.librarySort === 'name') {
        courses.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    } else if (state.librarySort === 'progress') {
        courses.sort((a, b) => courseStats(b).percent - courseStats(a).percent);
    } else {
        courses.sort((a, b) => {
            const diff = courseStats(b).lastActivity - courseStats(a).lastActivity;
            return diff !== 0 ? diff : indexOf.get(b.id) - indexOf.get(a.id);
        });
    }

    courses.forEach((course) => grid.appendChild(createCourseCard(course)));
    document.querySelectorAll('#library-sort button').forEach((button) => {
        button.classList.toggle('active', button.dataset.sort === state.librarySort);
    });
}

function renderSearch() {
    const query = normalizeText(state.search.trim());
    const coursesGrid = $('search-courses');
    const lessonsList = $('search-lessons');
    coursesGrid.innerHTML = '';
    lessonsList.innerHTML = '';

    const courses = state.courses.filter((course) => normalizeText(course.displayName).includes(query));
    const lessons = [];
    state.episodeIndex.forEach((entry) => {
        if (lessons.length >= 60) return;
        if (normalizeText(stripExtension(entry.episode.name)).includes(query)) lessons.push(entry);
    });

    $('search-title').textContent = `“${state.search.trim()}”`;
    const found = [
        courses.length ? pluralize(courses.length, 'curso', 'cursos') : '',
        lessons.length ? pluralize(lessons.length, 'aula', 'aulas') : ''
    ].filter(Boolean);
    $('search-summary').textContent = found.length
        ? `Encontrado: ${found.join(' e ')}.`
        : 'Nada encontrado. Confira a grafia ou busque por outra palavra do nome da aula.';

    courses.forEach((course) => coursesGrid.appendChild(createCourseCard(course)));
    $('search-lessons-title').hidden = lessons.length === 0;
    lessons.forEach(({ course, episode }) => {
        lessonsList.appendChild(createLessonRow(course, episode, {
            side: lessonStatusText(videoProgress(episode.id))
        }));
    });
}

function handleSearchInput() {
    const value = $('search-input').value;
    if (!state.search && value) state.viewBeforeSearch = state.nav;
    state.search = value;
    if (!value.trim()) {
        clearSearch(true);
        return;
    }
    renderSearch();
    if (state.view !== 'search') showView('search');
}

function clearSearch(navigateBack) {
    state.search = '';
    $('search-input').value = '';
    if (navigateBack && state.view === 'search') goTo(state.viewBeforeSearch || 'home');
}

function createLessonRow(course, episode, { side = '', subtitle = null } = {}) {
    const progress = videoProgress(episode.id);
    const row = document.createElement('div');
    row.className = `lesson-row${progress && progress.completed ? ' is-done' : ''}`;
    row.innerHTML = `
        <span class="lesson-row-icon"><i class="fas ${progress && progress.completed ? 'fa-check' : 'fa-play'}"></i></span>
        <span class="lesson-row-copy"><small></small><strong></strong></span>
        <span class="lesson-row-side"></span>
    `;
    row.querySelector('small').textContent = subtitle || course.displayName;
    row.querySelector('strong').textContent = stripExtension(episode.name);
    row.querySelector('.lesson-row-side').textContent = side;
    makeActivatable(row, () => playVideo(course, episode));
    row.addEventListener('contextmenu', (event) => showEpisodeMenu(event, course, episode));
    return row;
}

// ---------------------------------------------------------------------------
// Histórico e notas
// ---------------------------------------------------------------------------

function dayLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hoje';
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
    const label = longDayFormatter.format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderHistory() {
    const list = $('history-list');
    list.innerHTML = '';

    const items = Object.entries(state.progress.videos || {})
        .map(([videoId, progress]) => ({ entry: state.episodeIndex.get(videoId), progress }))
        .filter((item) => item.entry && item.progress && item.progress.timestamp)
        .sort((a, b) => b.progress.timestamp - a.progress.timestamp)
        .slice(0, 200);

    if (!items.length) {
        list.innerHTML = '<p class="empty-text">Nenhuma aula assistida ainda. Quando você assistir, ela aparece aqui.</p>';
        return;
    }

    let lastLabel = '';
    items.forEach(({ entry, progress }) => {
        const label = dayLabel(progress.timestamp);
        if (label !== lastLabel) {
            const heading = document.createElement('h2');
            heading.className = 'history-day';
            heading.textContent = label;
            list.appendChild(heading);
            lastLabel = label;
        }
        list.appendChild(createLessonRow(entry.course, entry.episode, {
            side: `${lessonStatusText(progress)} às ${timeFormatter.format(new Date(progress.timestamp))}`
        }));
    });
}

function renderNotes() {
    const container = $('notes-list');
    container.innerHTML = '';
    const filter = normalizeText($('notes-filter').value.trim());
    const notes = (state.progress.notes || []).filter((note) => {
        if (!filter) return true;
        return normalizeText(`${note.text} ${note.videoName} ${note.courseName}`).includes(filter);
    });

    if (!notes.length) {
        container.innerHTML = filter
            ? '<p class="empty-text">Nenhuma nota com esse texto.</p>'
            : '<p class="empty-text">Você ainda não tem notas. No player, aperte N ou o botão Nota para marcar um momento da aula.</p>';
        return;
    }

    const groups = new Map();
    notes.forEach((note) => {
        const key = note.courseId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(note);
    });

    groups.forEach((items, courseId) => {
        const course = findCourse(courseId);
        const group = document.createElement('section');
        group.className = 'notes-group';
        const title = document.createElement('h2');
        title.textContent = course ? course.displayName : items[0].courseName;
        group.appendChild(title);

        items
            .sort((a, b) => (a.videoName || '').localeCompare(b.videoName || '', 'pt-BR', { numeric: true }) || a.time - b.time)
            .forEach((note) => group.appendChild(createNoteCard(note)));
        container.appendChild(group);
    });
}

function createNoteCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
        <span class="note-time"></span>
        <div class="note-body"><small></small><p></p></div>
        <div class="note-actions">
            <button type="button" class="icon-btn" data-action="edit" aria-label="Editar nota"><i class="fas fa-pen"></i></button>
            <button type="button" class="icon-btn" data-action="delete" aria-label="Excluir nota"><i class="fas fa-trash"></i></button>
        </div>
    `;
    card.querySelector('.note-time').textContent = formatTime(note.time);
    card.querySelector('small').textContent = stripExtension(note.videoName);
    card.querySelector('p').textContent = note.text;
    card.querySelector('[data-action="edit"]').addEventListener('click', (event) => {
        event.stopPropagation();
        openNoteModal(note);
    });
    card.querySelector('[data-action="delete"]').addEventListener('click', (event) => {
        event.stopPropagation();
        deleteNote(note.id);
    });
    makeActivatable(card, () => jumpToNote(note));
    return card;
}

async function copyAllNotes() {
    const notes = state.progress.notes || [];
    if (!notes.length) {
        toast('Ainda não há notas para copiar.', { type: 'info' });
        return;
    }
    const groups = new Map();
    notes.forEach((note) => {
        const course = findCourse(note.courseId);
        const name = course ? course.displayName : note.courseName;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(note);
    });
    const text = Array.from(groups.entries()).map(([courseName, items]) => {
        const lines = items
            .sort((a, b) => (a.videoName || '').localeCompare(b.videoName || '', 'pt-BR', { numeric: true }) || a.time - b.time)
            .map((note) => `  [${formatTime(note.time)}] ${stripExtension(note.videoName)}: ${note.text}`);
        return `${courseName}\n${lines.join('\n')}`;
    }).join('\n\n');

    try {
        await navigator.clipboard.writeText(text);
        toast(`${pluralize(notes.length, 'nota copiada', 'notas copiadas')} para a área de transferência.`);
    } catch (error) {
        toast('Não foi possível copiar as notas.', { type: 'error' });
    }
}

function jumpToNote(note) {
    const entry = state.episodeIndex.get(note.videoId);
    if (!entry) {
        toast('A aula desta nota não está na biblioteca. Adicione a pasta do curso de novo para abrir.', { type: 'error' });
        return;
    }
    playVideo(entry.course, entry.episode, { startAt: note.time });
}

function persistNotes() {
    api.saveNotes(state.progress.notes).catch(handleIpcError);
}

async function deleteNote(noteId) {
    const confirmed = await confirmDialog({
        title: 'Excluir esta nota?',
        text: 'Não dá para desfazer.',
        confirmLabel: 'Excluir',
        danger: true
    });
    if (!confirmed) return;
    state.progress.notes = state.progress.notes.filter((note) => note.id !== noteId);
    persistNotes();
    hideNoteTooltip(true);
    renderVideoNoteMarkers();
    if (state.view === 'notes') renderNotes();
    toast('Nota excluída.');
}

function openNoteModal(note = null) {
    if (!note && (!state.currentVideo || !state.currentCourse)) return;
    state.editingNoteId = note ? note.id : null;
    state.pendingNoteTime = note ? note.time : getCurrentTime();
    if (!note) player.video.pause();
    $('note-modal-title').textContent = note ? 'Editar nota' : 'Nova nota';
    $('note-time-label').textContent = `Em ${formatTime(state.pendingNoteTime)}${note ? ` de ${stripExtension(note.videoName)}` : ''}`;
    $('note-text').value = note ? note.text : '';
    hideNoteTooltip(true);
    openModal('note-modal');
}

function saveNote() {
    const text = $('note-text').value.trim();
    if (!text) {
        $('note-text').focus();
        return;
    }

    if (state.editingNoteId) {
        const note = state.progress.notes.find((item) => item.id === state.editingNoteId);
        if (note) {
            note.text = text;
            note.updatedAt = Date.now();
        }
    } else if (state.currentCourse && state.currentVideo) {
        state.progress.notes.unshift({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            courseId: state.currentCourse.id,
            courseName: state.currentCourse.displayName,
            videoId: state.currentVideo.id,
            videoName: state.currentVideo.name,
            videoPath: state.currentVideo.path,
            time: state.pendingNoteTime,
            text,
            createdAt: Date.now()
        });
    }

    persistNotes();
    closeModal('note-modal');
    renderVideoNoteMarkers();
    if (state.view === 'notes') renderNotes();
    toast(state.editingNoteId ? 'Nota atualizada.' : 'Nota salva.');
    state.editingNoteId = null;
}

// ---------------------------------------------------------------------------
// Página do curso
// ---------------------------------------------------------------------------

function openCourse(course, { focusVideoId = null } = {}) {
    state.currentCourse = course;
    renderCourse(course, focusVideoId);
    showView('course');
    if (focusVideoId) {
        requestAnimationFrame(() => {
            const row = document.querySelector(`.episode-row[data-video-id="${CSS.escape(focusVideoId)}"]`);
            if (row) row.scrollIntoView({ block: 'center' });
        });
    }
}

function renderCourse(course, focusVideoId = null) {
    const stats = courseStats(course);
    const modules = buildModules(course);
    const materials = (course.seasons || []).reduce((sum, season) => sum + (season.materials || []).length, 0)
        + courseEpisodes(course).filter((episode) => episode.hasPdf).length;

    setBackdrop($('course-backdrop'), course);
    $('course-category').textContent = course.category || 'Outros';
    $('course-title').textContent = course.displayName;
    $('course-meta').innerHTML = [
        `<li><i class="fas fa-layer-group"></i>${pluralize(modules.length, 'módulo', 'módulos')}</li>`,
        `<li><i class="fas fa-circle-play"></i>${pluralize(stats.total, 'aula', 'aulas')}</li>`,
        materials ? `<li><i class="fas fa-file-pdf"></i>${pluralize(materials, 'material', 'materiais')}</li>` : '',
        `<li><i class="fas fa-check"></i>${pluralize(stats.completed, 'concluída', 'concluídas')}</li>`
    ].join('');
    $('course-progress-fill').style.width = `${stats.percent}%`;
    $('course-progress-fill').parentElement.classList.toggle('is-done', stats.percent === 100);
    $('course-progress-text').textContent = `${stats.percent}% concluído`;

    const next = nextLessonToWatch(course);
    const playButton = $('btn-course-play');
    playButton.querySelector('span').textContent = next.finished
        ? 'Assistir de novo'
        : next.resume
            ? `Continuar: ${stripExtension(next.episode.name)}`
            : stats.completed > 0 ? `Próxima: ${stripExtension(next.episode.name)}` : 'Começar curso';
    playButton.onclick = () => next.episode && playVideo(course, next.episode);
    $('btn-course-more').onclick = (event) => showCourseMenu(event, course);

    renderModules(course, modules, focusVideoId || (next.episode && next.episode.id));
}

function renderModules(course, modules, focusVideoId) {
    const list = $('modules-list');
    list.innerHTML = '';

    let openIndex = modules.findIndex((module) => module.episodes.some((episode) => episode.id === focusVideoId));
    if (openIndex === -1) openIndex = 0;

    modules.forEach((module, index) => {
        const stats = progressStats(module.episodes);
        const group = document.createElement('section');
        group.className = 'module-group';
        group.classList.toggle('open', index === openIndex);
        group.classList.toggle('is-complete', stats.total > 0 && stats.percent === 100);

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'module-header';
        header.setAttribute('aria-expanded', String(index === openIndex));
        header.innerHTML = `
            <span class="module-number">${stats.total > 0 && stats.percent === 100 ? '<i class="fas fa-check"></i>' : index + 1}</span>
            <span class="module-header-copy">
                <h2></h2>
                <span>${escapeHtml(stats.total ? progressSummary(stats) : 'Materiais de apoio')}</span>
                ${stats.total ? `<div class="bar${stats.percent === 100 ? ' is-done' : ''}"><span style="width:${stats.percent}%"></span></div>` : ''}
            </span>
            <span class="module-header-side">${stats.total ? `<strong>${stats.percent}%</strong>` : ''}<i class="fas fa-chevron-down"></i></span>
        `;
        header.querySelector('h2').textContent = module.name;
        header.addEventListener('click', () => {
            const willOpen = !group.classList.contains('open');
            group.classList.toggle('open', willOpen);
            header.setAttribute('aria-expanded', String(willOpen));
        });

        const body = document.createElement('div');
        body.className = 'module-body';
        module.seasons.forEach((season) => {
            if (season.displayName) {
                const title = document.createElement('h3');
                title.className = 'submodule-title';
                title.textContent = season.displayName;
                body.appendChild(title);
            }
            season.episodes.forEach((episode) => body.appendChild(createEpisodeRow(course, season, episode, focusVideoId)));
            if (season.materials && season.materials.length) {
                const materials = document.createElement('div');
                materials.className = 'materials';
                season.materials.forEach((material) => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'material-chip';
                    chip.innerHTML = '<i class="fas fa-file-pdf"></i><span></span>';
                    chip.querySelector('span').textContent = stripExtension(material.name);
                    chip.title = material.name;
                    chip.addEventListener('click', () => openPdfModal(material.name, material.url));
                    materials.appendChild(chip);
                });
                body.appendChild(materials);
            }
        });

        group.appendChild(header);
        group.appendChild(body);
        list.appendChild(group);
    });
}

function createEpisodeRow(course, season, episode, focusVideoId) {
    const progress = videoProgress(episode.id);
    const row = document.createElement('div');
    row.className = 'episode-row';
    row.dataset.videoId = episode.id;
    row.classList.toggle('is-done', Boolean(progress && progress.completed));
    row.classList.toggle('is-current', episode.id === focusVideoId);

    const percent = progress && progress.duration && !progress.completed ? Math.min(100, (progress.time / progress.duration) * 100) : 0;
    row.innerHTML = `
        <span class="episode-order">${progress && progress.completed ? '<i class="fas fa-check"></i>' : episode.order}</span>
        <span class="episode-copy">
            <strong></strong>
            <small><span></span>${percent ? `<span class="bar mini-bar"><span style="width:${percent}%"></span></span>` : ''}</small>
        </span>
        <span class="episode-side">
            ${episode.hasPdf ? '<i class="fas fa-file-pdf" title="Tem material em PDF"></i>' : ''}
            <i class="fas fa-play"></i>
        </span>
    `;
    row.querySelector('strong').textContent = stripExtension(episode.name);
    row.querySelector('small > span').textContent = lessonStatusText(progress);
    makeActivatable(row, () => playVideo(course, episode, { seasonId: season.id }));
    row.addEventListener('contextmenu', (event) => showEpisodeMenu(event, course, episode));
    return row;
}

function openPdfModal(title, url) {
    $('pdf-modal-title').textContent = stripExtension(title);
    $('pdf-modal-frame').src = url;
    openModal('pdf-modal');
}

function refreshAfterProgressChange(course) {
    if (state.view === 'course' && state.currentCourse) renderCourse(state.currentCourse);
    if (state.view === 'home') renderHome();
    if (state.view === 'library') renderLibrary();
    if (state.view === 'history') renderHistory();
    if (state.view === 'search') renderSearch();
    if (state.view === 'player' && course === state.currentCourse) renderPlayerLessons(false);
}

async function setCompleted(course, episodes, completed) {
    try {
        const progress = await api.setCompleted({
            completed,
            items: episodes.map((episode) => ({ videoId: episode.id, courseId: course.id }))
        });
        state.progress = { ...state.progress, ...progress };
        refreshAfterProgressChange(course);
    } catch (error) {
        handleIpcError(error);
    }
}

function showCourseMenu(event, course) {
    const stats = courseStats(course);
    showContextMenu(event, [
        { icon: 'fa-play', label: stats.completed ? 'Continuar curso' : 'Começar curso', onClick: () => {
            const next = nextLessonToWatch(course);
            if (next.episode) playVideo(course, next.episode);
        } },
        { icon: 'fa-pen', label: 'Editar nome, categoria e capa', onClick: () => openCourseModalForEdit(course) },
        'divider',
        stats.percent < 100 ? { icon: 'fa-check-double', label: 'Marcar curso como concluído', onClick: () => setCompleted(course, courseEpisodes(course), true) } : null,
        stats.completed || stats.started ? { icon: 'fa-rotate-left', label: 'Zerar progresso do curso', onClick: async () => {
            const confirmed = await confirmDialog({
                title: 'Zerar o progresso deste curso?',
                text: 'As aulas voltam a aparecer como não iniciadas. Suas notas continuam salvas.',
                confirmLabel: 'Zerar progresso',
                danger: true
            });
            if (confirmed) setCompleted(course, courseEpisodes(course), false);
        } } : null,
        'divider',
        { icon: 'fa-trash', label: 'Remover da biblioteca', danger: true, onClick: () => removeCourse(course) }
    ]);
}

function showEpisodeMenu(event, course, episode) {
    const progress = videoProgress(episode.id);
    showContextMenu(event, [
        { icon: 'fa-play', label: 'Assistir', onClick: () => playVideo(course, episode) },
        episode.hasPdf ? { icon: 'fa-file-pdf', label: 'Abrir material', onClick: () => openPdfModal(episode.name, episode.pdfUrl) } : null,
        'divider',
        progress && progress.completed
            ? { icon: 'fa-rotate-left', label: 'Marcar como não assistida', onClick: () => setCompleted(course, [episode], false) }
            : { icon: 'fa-check', label: 'Marcar como concluída', onClick: () => setCompleted(course, [episode], true) }
    ]);
}

async function removeCourse(course) {
    const confirmed = await confirmDialog({
        title: `Remover "${course.displayName}"?`,
        text: 'Os arquivos continuam no computador. Se você adicionar a pasta de novo, o progresso volta.',
        confirmLabel: 'Remover',
        danger: true
    });
    if (!confirmed) return;
    try {
        await api.removeCourse(course.registeredPath || course.path);
        await reloadLibrary();
        goTo(state.view === 'library' ? 'library' : 'home');
        toast('Curso removido da biblioteca.');
    } catch (error) {
        handleIpcError(error);
    }
}

// ---------------------------------------------------------------------------
// Adicionar e editar cursos
// ---------------------------------------------------------------------------

async function startAddCourses() {
    let folders;
    try {
        folders = await api.pickCourseFolders();
    } catch (error) {
        handleIpcError(error);
        return;
    }
    if (!folders || !folders.length) return;

    state.courseQueue = folders.map((folder) => {
        const existing = state.courses.find((course) => course.path.toLowerCase() === folder.toLowerCase());
        return existing
            ? { path: existing.registeredPath, name: existing.displayName, category: existing.category, coverUrl: existing.coverUrl, editing: true }
            : { path: folder, name: folder.split(/[\\/]/).pop(), category: 'Outros', coverUrl: null, editing: false };
    });
    state.queueTotal = state.courseQueue.length;
    state.queueSaved = 0;
    openNextCourseInQueue();
}

function openCourseModalForEdit(course) {
    state.courseQueue = [{
        path: course.registeredPath || course.path,
        name: course.displayName,
        category: course.category,
        coverUrl: course.coverUrl,
        editing: true
    }];
    state.queueTotal = 1;
    state.queueSaved = 0;
    openNextCourseInQueue();
}

function openNextCourseInQueue() {
    const item = state.courseQueue.shift();
    if (!item) {
        finishCourseQueue();
        return;
    }

    state.courseDraft = { ...item, coverSourcePath: null, coverPreview: item.coverUrl, removeCover: false };
    const position = state.queueTotal - state.courseQueue.length;
    $('course-modal-step').hidden = state.queueTotal <= 1;
    $('course-modal-step').textContent = `Curso ${position} de ${state.queueTotal}`;
    $('course-modal-title').textContent = item.editing ? 'Editar curso' : 'Novo curso';
    $('course-modal-path').textContent = item.path;
    $('course-name-input').value = item.name || '';
    $('course-category-select').value = CATEGORIES.includes(item.category) ? item.category : 'Outros';
    $('btn-cancel-course').textContent = state.courseQueue.length > 0 ? 'Pular' : 'Cancelar';
    $('course-modal-error').hidden = true;
    updateCoverPreview();
    openModal('course-modal');
    $('course-name-input').select();
}

function updateCoverPreview() {
    const draft = state.courseDraft;
    const preview = $('cover-preview');
    const name = $('course-name-input').value || draft.name;
    preview.style.setProperty('--folder-hue', FOLDER_HUES[hashString(draft.path) % FOLDER_HUES.length]);
    $('cover-monogram').textContent = monogram(name);
    const image = draft.removeCover ? null : draft.coverPreview;
    preview.classList.toggle('has-image', Boolean(image));
    preview.style.backgroundImage = image ? `url("${image}")` : '';
    $('btn-clear-cover').hidden = !image;
}

async function pickCover() {
    try {
        const picked = await api.pickCover();
        if (!picked) return;
        state.courseDraft.coverSourcePath = picked.path;
        state.courseDraft.coverPreview = picked.preview;
        state.courseDraft.removeCover = false;
        updateCoverPreview();
    } catch (error) {
        handleIpcError(error);
    }
}

function clearCover() {
    state.courseDraft.coverSourcePath = null;
    state.courseDraft.coverPreview = null;
    state.courseDraft.removeCover = true;
    updateCoverPreview();
}

async function saveCourseDraft() {
    const draft = state.courseDraft;
    if (!draft) return;
    const button = $('btn-save-course');
    button.disabled = true;

    try {
        const result = await api.saveCourse({
            path: draft.path,
            name: $('course-name-input').value.trim(),
            category: $('course-category-select').value,
            coverSourcePath: draft.coverSourcePath,
            removeCover: draft.removeCover
        });

        if (!result || !result.ok) {
            const error = $('course-modal-error');
            error.textContent = 'Essa pasta não tem vídeos. Escolha a pasta do curso — a que contém os módulos ou as aulas.';
            error.hidden = false;
            return;
        }

        state.queueSaved += 1;
        closeModal('course-modal');
        openNextCourseInQueue();
    } catch (error) {
        handleIpcError(error);
    } finally {
        button.disabled = false;
    }
}

function skipCourseDraft() {
    closeModal('course-modal');
    state.courseDraft = null;
    openNextCourseInQueue();
}

async function finishCourseQueue() {
    state.courseDraft = null;
    if (!state.queueSaved) return;

    const editedCourseId = state.currentCourse && state.view === 'course' ? state.currentCourse.id : null;
    await reloadLibrary();

    if (editedCourseId && findCourse(editedCourseId)) {
        openCourse(findCourse(editedCourseId));
    } else {
        goTo(state.nav === 'library' ? 'library' : 'home');
    }
    toast(state.queueSaved === 1 ? 'Curso salvo.' : `${state.queueSaved} cursos salvos.`);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const player = {
    view: $('view-player'),
    shell: $('player-shell'),
    video: $('video-player'),
    loading: $('player-loading'),
    loadingText: $('player-loading-text'),
    courseName: $('player-course-name'),
    videoName: $('player-video-name'),
    timeline: $('player-timeline'),
    buffer: $('timeline-buffer'),
    progress: $('timeline-progress'),
    thumb: $('timeline-thumb'),
    markers: $('timeline-markers'),
    hover: $('timeline-hover'),
    tooltip: $('timeline-tooltip'),
    playPause: $('btn-play-pause'),
    mute: $('btn-mute'),
    volume: $('volume-slider'),
    currentTime: $('current-time'),
    durationTime: $('duration-time'),
    togglePdf: $('btn-toggle-pdf'),
    speedButton: $('btn-speed'),
    speedMenu: $('speed-menu'),
    nextLesson: $('btn-next-lesson'),
    fullscreen: $('btn-fullscreen'),
    toggleLessons: $('btn-toggle-lessons'),
    moduleName: $('player-module-name'),
    lessonsList: $('player-lessons-list'),
    pdfPane: $('pdf-pane'),
    pdfViewer: $('pdf-viewer'),
    centerFeedback: $('center-feedback'),
    nextUp: $('next-up')
};

const playback = {
    mode: 'native',
    url: '',
    fallbackDuration: 0,
    streamOffset: 0,
    lastSaveAt: 0,
    hideTimer: null,
    seeking: false,
    loadToken: 0,
    ready: false,
    triedStreamFallback: false,
    suppressErrorsUntil: 0,
    nextUpTimer: null,
    tooltipTimer: null
};

function getDuration() {
    const duration = player.video.duration;
    if (duration && Number.isFinite(duration)) return duration;
    return playback.fallbackDuration || 0;
}

function getCurrentTime() {
    const time = player.video.currentTime || 0;
    return playback.mode === 'stream' ? time + playback.streamOffset : time;
}

function streamUrlAt(time) {
    const url = new URL(playback.url);
    url.searchParams.set('start', time.toFixed(2));
    return url.toString();
}

function seekTo(time) {
    const duration = getDuration();
    const target = Math.max(0, duration ? Math.min(time, duration - 0.5) : time);
    if (playback.mode === 'stream') {
        playback.streamOffset = target;
        setLoading('Buscando…');
        player.video.src = streamUrlAt(target);
        player.video.play().catch(() => { });
    } else {
        player.video.currentTime = target;
    }
    updateTimeline();
}

function setLoading(text) {
    player.loading.hidden = !text;
    if (text) player.loadingText.textContent = text;
}

function resetVideoElement() {
    playback.ready = false;
    playback.suppressErrorsUntil = Date.now() + 1500;
    player.video.pause();
    player.video.removeAttribute('src');
    player.video.load();
}

async function playVideo(course, episode, { startAt = null, seasonId = null } = {}) {
    if (state.currentVideo && state.view === 'player' && state.currentVideo.id !== episode.id) {
        saveCurrentProgress();
    }
    cancelNextUp();
    hideMenus();

    const loadToken = ++playback.loadToken;
    const entry = state.episodeIndex.get(episode.id);
    state.currentCourse = course;
    state.currentVideo = episode;
    state.currentSeasonId = seasonId || (entry && entry.season.id) || null;

    player.courseName.textContent = course.displayName;
    player.videoName.textContent = stripExtension(episode.name);
    renderPlayerLessons();
    updateNextLessonButton();
    setupLessonPdf(episode);

    const saved = videoProgress(episode.id);
    const startTime = startAt !== null ? startAt : (saved && !saved.completed ? saved.time : 0);

    showView('player');
    resetPlayerControls();
    setLoading('Carregando aula…');

    try {
        const playable = await api.prepareVideo(episode.path);
        if (loadToken !== playback.loadToken) return;

        playback.triedStreamFallback = playable.mode === 'stream';
        await startPlayable(playable, startTime, loadToken);
    } catch (error) {
        if (loadToken !== playback.loadToken) return;
        if (isLicenseError(error)) {
            handleIpcError(error);
            return;
        }
        console.error('Erro ao abrir a aula:', error);
        setLoading('');
        showPlaybackError('Não foi possível abrir esta aula. Confira se o arquivo ainda está na pasta do curso.');
    }
}

async function startPlayable(playable, startTime, loadToken) {
    playback.mode = playable.mode;
    playback.url = playable.url;
    playback.fallbackDuration = playable.duration || 0;
    playback.streamOffset = 0;
    playback.lastSaveAt = Date.now();

    resetVideoElement();
    player.video.defaultPlaybackRate = state.playbackRate;
    player.video.playbackRate = state.playbackRate;

    if (playback.mode === 'stream' && startTime > 1) {
        playback.streamOffset = startTime;
        player.video.src = streamUrlAt(startTime);
    } else {
        player.video.src = playback.url;
        if (startTime > 1) {
            player.video.addEventListener('loadedmetadata', () => {
                if (loadToken === playback.loadToken) seekTo(startTime);
            }, { once: true });
        }
    }
    // O aviso de erro só fica suprimido durante a troca de fonte.
    playback.suppressErrorsUntil = 0;

    await player.video.play().catch((error) => {
        if (error && (error.name === 'AbortError' || error.name === 'NotSupportedError')) return;
        throw error;
    });
}

async function fallbackToStream() {
    // Alguns MP4 usam codecs que o Chromium não decodifica (ex.: HEVC sem
    // suporte de hardware). Nesses casos o vídeo é convertido na hora.
    const video = state.currentVideo;
    if (!video || playback.triedStreamFallback) return false;
    playback.triedStreamFallback = true;
    const loadToken = playback.loadToken;
    const resumeAt = getCurrentTime();
    setLoading('Convertendo o vídeo para reproduzir…');
    try {
        const playable = await api.prepareVideo(video.path, { forceStream: true });
        if (loadToken !== playback.loadToken) return true;
        await startPlayable(playable, resumeAt, loadToken);
        return true;
    } catch (error) {
        if (isLicenseError(error)) handleIpcError(error);
        return false;
    }
}

function showPlaybackError(message) {
    setLoading(message);
    player.loading.querySelector('.spinner').hidden = true;
    showPlayerControls();
}

function resetPlayerControls() {
    player.loading.querySelector('.spinner').hidden = false;
    player.currentTime.textContent = '00:00';
    player.durationTime.textContent = formatTime(playback.fallbackDuration);
    player.progress.style.width = '0%';
    player.buffer.style.width = '0%';
    player.thumb.style.left = '0%';
    player.markers.innerHTML = '';
    hideNoteTooltip(true);
    player.speedMenu.classList.remove('active');
    updatePlayPauseButton();
    updateVolumeButton();
    showPlayerControls();
}

function setupLessonPdf(episode) {
    player.togglePdf.hidden = !episode.hasPdf;
    if (!episode.hasPdf) {
        closeLessonPdf();
        return;
    }
    if (!player.pdfPane.hidden) player.pdfViewer.src = episode.pdfUrl;
}

function toggleLessonPdf() {
    if (!state.currentVideo || !state.currentVideo.hasPdf) return;
    if (player.pdfPane.hidden) {
        player.pdfViewer.src = state.currentVideo.pdfUrl;
        player.pdfPane.hidden = false;
        player.shell.classList.add('has-pdf');
    } else {
        closeLessonPdf();
    }
}

function closeLessonPdf() {
    player.pdfPane.hidden = true;
    player.shell.classList.remove('has-pdf');
    player.pdfViewer.removeAttribute('src');
}

function stopPlayback() {
    cancelNextUp();
    playback.loadToken += 1;
    if (state.view === 'player') saveCurrentProgress();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    resetVideoElement();
    closeLessonPdf();
}

function closePlayer() {
    const course = state.currentCourse;
    const video = state.currentVideo;
    stopPlayback();
    player.view.classList.remove('controls-hidden');
    clearTimeout(playback.hideTimer);

    if (course) {
        openCourse(course, { focusVideoId: video && video.id });
    } else {
        goTo('home');
    }
}

function saveCurrentProgress(forceCompleted = false) {
    const course = state.currentCourse;
    const video = state.currentVideo;
    if (!course || !video) return;

    // Durante a troca de fonte o elemento de vídeo volta a 0 — não salva isso.
    if (!forceCompleted && !playback.ready) return;

    const time = forceCompleted ? getDuration() : getCurrentTime();
    const duration = getDuration();
    const previous = videoProgress(video.id);
    if (!forceCompleted && time < 1 && !previous) return;

    const completed = forceCompleted || (duration > 0 && time / duration >= 0.95);
    const now = Date.now();
    const entry = {
        time,
        duration,
        completed: completed || Boolean(previous && previous.completed),
        timestamp: now
    };

    state.progress.videos[video.id] = entry;
    state.progress.lastWatched[course.id] = video.id;
    state.progress.history = (state.progress.history || []).filter((item) => item.videoId !== video.id);
    state.progress.history.unshift({ courseId: course.id, videoId: video.id, timestamp: now });
    playback.lastSaveAt = now;

    api.saveProgress({ videoId: video.id, courseId: course.id, time, duration, completed }).catch(handleIpcError);
}

function handleTimeUpdate() {
    updateTimeline();
    if (Date.now() - playback.lastSaveAt >= SAVE_INTERVAL_MS && !player.video.paused) {
        const wasCompleted = Boolean((videoProgress(state.currentVideo && state.currentVideo.id) || {}).completed);
        saveCurrentProgress();
        const nowCompleted = Boolean((videoProgress(state.currentVideo && state.currentVideo.id) || {}).completed);
        if (wasCompleted !== nowCompleted) renderPlayerLessons(false);
    }
}

function handleVideoEnded() {
    saveCurrentProgress(true);
    renderPlayerLessons(false);
    updateNextLessonButton();
    const next = getNextLesson();
    if (next) {
        startNextUp(next);
    } else {
        toast('Você terminou a última aula deste curso.');
        showPlayerControls();
    }
}

async function handleVideoError() {
    if (Date.now() < playback.suppressErrorsUntil || !player.video.error || !state.currentVideo) return;
    const code = player.video.error.code;
    if (playback.mode === 'native' && (code === 3 || code === 4) && await fallbackToStream()) return;
    const messages = {
        1: 'A reprodução foi interrompida.',
        2: 'Falha ao ler o arquivo. Se ele está em um HD externo, confira a conexão.',
        3: 'O vídeo está corrompido ou usa um codec sem suporte.',
        4: 'Este formato de vídeo não é suportado.'
    };
    showPlaybackError(messages[code] || 'Não foi possível reproduzir este vídeo.');
}

function getLessonQueue(course = state.currentCourse) {
    const queue = [];
    if (!course) return queue;
    (course.seasons || []).forEach((season) => {
        season.episodes.forEach((episode) => queue.push({ season, episode }));
    });
    return queue;
}

function getNextLesson() {
    if (!state.currentVideo) return null;
    const queue = getLessonQueue();
    const index = queue.findIndex((item) => item.episode.id === state.currentVideo.id);
    return index !== -1 ? queue[index + 1] || null : null;
}

function updateNextLessonButton() {
    const next = getNextLesson();
    player.nextLesson.disabled = !next;
    player.nextLesson.title = next ? `Próxima aula: ${stripExtension(next.episode.name)} (Shift + N)` : 'Esta é a última aula';
}

function playNextLesson() {
    const next = getNextLesson();
    if (next) playVideo(state.currentCourse, next.episode, { seasonId: next.season.id });
}

function startNextUp(next) {
    cancelNextUp();
    let remaining = NEXT_UP_SECONDS;
    $('next-up-title').textContent = stripExtension(next.episode.name);
    $('next-up-count').textContent = remaining;
    player.nextUp.hidden = false;
    showPlayerControls();
    playback.nextUpTimer = setInterval(() => {
        remaining -= 1;
        $('next-up-count').textContent = remaining;
        if (remaining <= 0) {
            cancelNextUp();
            playVideo(state.currentCourse, next.episode, { seasonId: next.season.id });
        }
    }, 1000);
}

function cancelNextUp() {
    clearInterval(playback.nextUpTimer);
    playback.nextUpTimer = null;
    player.nextUp.hidden = true;
}

function currentModule() {
    const course = state.currentCourse;
    if (!course) return null;
    const modules = buildModules(course);
    return modules.find((module) => module.episodes.some((episode) => state.currentVideo && episode.id === state.currentVideo.id)) || modules[0] || null;
}

function renderPlayerLessons(scrollToActive = true) {
    if (!state.currentCourse || !state.currentVideo) return;
    const module = currentModule();
    player.moduleName.textContent = module ? module.name : 'Aulas';
    player.lessonsList.innerHTML = '';
    if (!module) return;

    module.seasons.forEach((season) => {
        if (season.displayName && season.episodes.length) {
            const title = document.createElement('h3');
            title.className = 'submodule-title';
            title.textContent = season.displayName;
            player.lessonsList.appendChild(title);
        }
        season.episodes.forEach((episode) => {
            const progress = videoProgress(episode.id);
            const isCurrent = episode.id === state.currentVideo.id;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'player-lesson';
            item.classList.toggle('active', isCurrent);
            item.classList.toggle('completed', Boolean(progress && progress.completed));
            const icon = isCurrent ? 'fa-play' : progress && progress.completed ? 'fa-check' : '';
            item.innerHTML = `
                <span class="player-lesson-status">${icon ? `<i class="fas ${icon}"></i>` : episode.order}</span>
                <span><strong></strong><small></small></span>
            `;
            item.querySelector('strong').textContent = stripExtension(episode.name);
            item.querySelector('small').textContent = isCurrent ? 'Assistindo agora' : lessonStatusText(progress);
            item.addEventListener('click', () => {
                if (!isCurrent) playVideo(state.currentCourse, episode, { seasonId: season.id });
            });
            player.lessonsList.appendChild(item);
        });
    });

    if (scrollToActive) {
        requestAnimationFrame(() => {
            const active = player.lessonsList.querySelector('.player-lesson.active');
            if (active) active.scrollIntoView({ block: 'center' });
        });
    }
}

function setLessonsHidden(hidden, persist = true) {
    state.lessonsHidden = Boolean(hidden);
    player.view.classList.toggle('lessons-hidden', state.lessonsHidden);
    player.toggleLessons.setAttribute('aria-expanded', String(!state.lessonsHidden));
    player.toggleLessons.title = state.lessonsHidden ? 'Mostrar aulas do módulo' : 'Esconder aulas do módulo';
    if (persist) rememberPreference('lessonsPanelHidden', state.lessonsHidden);
}

function updateTimeline() {
    const duration = getDuration();
    const time = getCurrentTime();
    player.currentTime.textContent = formatTime(time);
    if (!duration) return;
    player.durationTime.textContent = formatTime(duration);
    const percent = Math.min(100, Math.max(0, (time / duration) * 100));
    player.progress.style.width = `${percent}%`;
    player.thumb.style.left = `${percent}%`;
    player.timeline.setAttribute('aria-valuenow', String(Math.round(percent)));
    player.timeline.setAttribute('aria-valuetext', `${formatTime(time)} de ${formatTime(duration)}`);
}

function updateBuffer() {
    const duration = getDuration();
    if (playback.mode !== 'native' || !duration || !player.video.buffered.length) return;
    const end = player.video.buffered.end(player.video.buffered.length - 1);
    player.buffer.style.width = `${Math.min(100, (end / duration) * 100)}%`;
}

function timelineTimeFromEvent(event) {
    const rect = player.timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return ratio * getDuration();
}

function startTimelineSeek(event) {
    if (!getDuration() || event.button !== 0) return;
    playback.seeking = true;
    player.timeline.classList.add('dragging');
    player.timeline.setPointerCapture(event.pointerId);
    previewSeek(event);

    const move = (moveEvent) => previewSeek(moveEvent);
    const up = (upEvent) => {
        playback.seeking = false;
        player.timeline.classList.remove('dragging');
        player.timeline.removeEventListener('pointermove', move);
        player.timeline.removeEventListener('pointerup', up);
        seekTo(timelineTimeFromEvent(upEvent));
    };
    player.timeline.addEventListener('pointermove', move);
    player.timeline.addEventListener('pointerup', up);
}

function previewSeek(event) {
    const duration = getDuration();
    const time = timelineTimeFromEvent(event);
    const percent = duration ? (time / duration) * 100 : 0;
    player.progress.style.width = `${percent}%`;
    player.thumb.style.left = `${percent}%`;
    player.currentTime.textContent = formatTime(time);
}

function updateTimelineHover(event) {
    const duration = getDuration();
    if (!duration) return;
    const rect = player.timeline.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    player.hover.style.left = `${ratio * 100}%`;
    player.hover.textContent = formatTime(ratio * duration);
}

function togglePlay() {
    if (!player.video.src) return;
    if (player.video.paused) {
        cancelNextUp();
        player.video.play().catch(() => { });
        flashCenter('play');
    } else {
        player.video.pause();
        flashCenter('pause');
    }
}

function flashCenter(type) {
    const icon = player.centerFeedback.querySelector('i');
    icon.className = `fas ${type === 'pause' ? 'fa-pause' : type === 'back' ? 'fa-rotate-left' : type === 'forward' ? 'fa-rotate-right' : 'fa-play'}`;
    player.centerFeedback.classList.add('active');
    clearTimeout(playback.centerTimer);
    playback.centerTimer = setTimeout(() => player.centerFeedback.classList.remove('active'), 380);
}

function updatePlayPauseButton() {
    const paused = player.video.paused;
    player.playPause.querySelector('i').className = paused ? 'fas fa-play' : 'fas fa-pause';
    player.playPause.setAttribute('aria-label', paused ? 'Reproduzir' : 'Pausar');
}

function showPlayerControls() {
    player.view.classList.remove('controls-hidden');
    queueControlsHide();
}

function queueControlsHide() {
    clearTimeout(playback.hideTimer);
    if (state.view !== 'player' || player.video.paused || player.speedMenu.classList.contains('active') || topModal() || !player.nextUp.hidden) {
        return;
    }
    playback.hideTimer = setTimeout(() => player.view.classList.add('controls-hidden'), 2600);
}

function toggleMute() {
    player.video.muted = !player.video.muted;
}

function changeVolume(delta) {
    player.video.muted = false;
    player.video.volume = Math.min(1, Math.max(0, player.video.volume + delta));
}

function updateVolumeButton() {
    const icon = player.mute.querySelector('i');
    const volume = player.video.muted ? 0 : player.video.volume;
    icon.className = `fas ${volume === 0 ? 'fa-volume-xmark' : volume < 0.5 ? 'fa-volume-low' : 'fa-volume-high'}`;
    player.volume.value = volume;
}

let volumeSaveTimer = null;
function handleVolumeEvent() {
    updateVolumeButton();
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(() => rememberPreference('volume', player.video.volume), 600);
}

function setPlaybackRate(speed, persist = true) {
    const value = PLAYBACK_SPEEDS.includes(speed) ? speed : 1;
    state.playbackRate = value;
    player.video.defaultPlaybackRate = value;
    player.video.playbackRate = value;
    player.speedButton.textContent = `${value}x`;
    player.speedMenu.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('active', Number(button.dataset.speed) === value);
    });
    if (persist) rememberPreference('playbackRate', value);
}

function stepPlaybackRate(direction) {
    const index = PLAYBACK_SPEEDS.indexOf(state.playbackRate);
    const next = PLAYBACK_SPEEDS[Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, index + direction))];
    setPlaybackRate(next);
    toast(`Velocidade ${next}x`, { type: 'info', duration: 1200 });
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
    } else {
        player.view.requestFullscreen().catch(() => { });
    }
}

function updateFullscreenButton() {
    const active = Boolean(document.fullscreenElement);
    player.fullscreen.querySelector('i').className = `fas ${active ? 'fa-compress' : 'fa-expand'}`;
    player.fullscreen.title = active ? 'Sair da tela cheia (F)' : 'Tela cheia (F)';
}

function currentVideoNotes() {
    if (!state.currentVideo) return [];
    return (state.progress.notes || [])
        .filter((note) => note.videoId === state.currentVideo.id)
        .sort((a, b) => a.time - b.time);
}

function renderVideoNoteMarkers() {
    player.markers.innerHTML = '';
    const duration = getDuration();
    if (!duration) return;

    currentVideoNotes().forEach((note) => {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'note-marker';
        marker.style.left = `${Math.min(100, Math.max(0, (note.time / duration) * 100))}%`;
        marker.setAttribute('aria-label', `Nota em ${formatTime(note.time)}`);
        marker.innerHTML = '<i class="fas fa-note-sticky"></i>';
        marker.addEventListener('pointerdown', (event) => event.stopPropagation());
        marker.addEventListener('mouseenter', () => showNoteTooltip(note));
        marker.addEventListener('mouseleave', () => hideNoteTooltip(false));
        marker.addEventListener('click', (event) => {
            event.stopPropagation();
            seekTo(note.time);
            showNoteTooltip(note, true);
        });
        player.markers.appendChild(marker);
    });
}

function showNoteTooltip(note, pinned = false) {
    clearTimeout(playback.tooltipTimer);
    const duration = getDuration() || 1;
    const percent = Math.min(100, Math.max(0, (note.time / duration) * 100));
    const tooltip = player.tooltip;
    tooltip.style.left = `clamp(140px, ${percent}%, calc(100% - 140px))`;
    tooltip.innerHTML = `
        <div class="note-tooltip-header">
            <span class="tooltip-time">${escapeHtml(formatTime(note.time))}</span>
            <div class="note-tooltip-actions">
                <button type="button" data-action="edit" aria-label="Editar nota"><i class="fas fa-pen"></i></button>
                <button type="button" data-action="delete" aria-label="Excluir nota"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        <div class="note-tooltip-text"></div>
    `;
    tooltip.querySelector('.note-tooltip-text').textContent = note.text;
    tooltip.querySelector('[data-action="edit"]').addEventListener('click', (event) => {
        event.stopPropagation();
        openNoteModal(note);
    });
    tooltip.querySelector('[data-action="delete"]').addEventListener('click', (event) => {
        event.stopPropagation();
        deleteNote(note.id);
    });
    tooltip.classList.toggle('pinned', pinned);
    tooltip.classList.add('active');
    showPlayerControls();
}

function hideNoteTooltip(force = false) {
    const tooltip = player.tooltip;
    if (!force && tooltip.classList.contains('pinned')) return;
    clearTimeout(playback.tooltipTimer);
    const hide = () => tooltip.classList.remove('active', 'pinned');
    if (force) hide();
    else playback.tooltipTimer = setTimeout(hide, 300);
}

function handlePlayerShortcut(event) {
    const key = event.key;
    const lower = key.toLowerCase();

    if (key === ' ' || lower === 'k') {
        togglePlay();
    } else if (key === 'ArrowLeft') {
        seekTo(getCurrentTime() - 10);
        flashCenter('back');
    } else if (key === 'ArrowRight') {
        seekTo(getCurrentTime() + 10);
        flashCenter('forward');
    } else if (key === 'ArrowUp') {
        changeVolume(0.05);
    } else if (key === 'ArrowDown') {
        changeVolume(-0.05);
    } else if (lower === 'm') {
        toggleMute();
    } else if (lower === 'f') {
        toggleFullscreen();
    } else if (lower === 'n' && event.shiftKey) {
        playNextLesson();
    } else if (lower === 'n') {
        openNoteModal();
    } else if (lower === 'p') {
        toggleLessonPdf();
    } else if (key === '>' || (event.shiftKey && key === '.')) {
        stepPlaybackRate(1);
    } else if (key === '<' || (event.shiftKey && key === ',')) {
        stepPlaybackRate(-1);
    } else if (key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
        else closePlayer();
    } else {
        return;
    }
    event.preventDefault();
    showPlayerControls();
}

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------

async function applyTheme(theme) {
    const active = theme || (await api.getTheme());
    $('theme-style').textContent = active && active.css ? active.css : '';
    return active;
}

async function openThemes() {
    openModal('themes-modal');
    await renderThemes();
}

async function renderThemes() {
    const grid = $('theme-grid');
    let data;
    try {
        data = await api.listThemes();
    } catch (error) {
        grid.innerHTML = '<p class="empty-text">Não foi possível carregar os temas.</p>';
        return;
    }
    grid.innerHTML = '';
    data.themes.forEach((theme) => {
        const card = document.createElement('div');
        card.className = 'theme-card';
        card.classList.toggle('active', theme.id === data.active.id);
        const swatches = (theme.swatch && theme.swatch.length ? theme.swatch : ['#333', '#666', '#999'])
            .map((color) => `<span style="background:${escapeHtml(color)}"></span>`).join('');
        card.innerHTML = `
            <div class="swatches">${swatches}</div>
            <strong></strong>
            <small></small>
            ${theme.source === 'custom' ? '<button type="button" class="icon-btn theme-remove" aria-label="Remover tema"><i class="fas fa-trash"></i></button>' : ''}
        `;
        card.querySelector('strong').textContent = theme.name;
        card.querySelector('small').textContent = theme.description || (theme.author ? `por ${theme.author}` : 'Tema importado');
        makeActivatable(card, async () => {
            const active = await api.setTheme(theme.id);
            await applyTheme(active);
            renderThemes();
        });
        const remove = card.querySelector('.theme-remove');
        if (remove) {
            remove.addEventListener('click', async (event) => {
                event.stopPropagation();
                const result = await api.removeTheme(theme.id);
                if (result.ok) {
                    await applyTheme(result.active);
                    renderThemes();
                }
            });
        }
        grid.appendChild(card);
    });
}

async function importTheme() {
    try {
        const result = await api.importTheme();
        if (result.canceled) return;
        if (!result.ok) {
            const messages = {
                missing_css: 'A pasta escolhida não tem um arquivo theme.css.',
                too_big: 'O theme.css passa do limite de 512 KB.'
            };
            toast(messages[result.error] || 'Não foi possível importar o tema.', { type: 'error' });
            return;
        }
        await applyTheme(result.active);
        renderThemes();
        toast('Tema importado e aplicado.');
    } catch (error) {
        toast('Não foi possível importar o tema.', { type: 'error' });
    }
}

// ---------------------------------------------------------------------------
// Atualizações
// ---------------------------------------------------------------------------

function setupUpdaterUi() {
    const toastEl = $('update-toast');
    const button = $('btn-download-update');
    let lastState = null;
    let dismissedStatus = null;

    function setButton(label, icon, disabled) {
        button.disabled = disabled;
        button.innerHTML = `<i class="${icon}"></i>${escapeHtml(label)}`;
    }

    function setProgress(percent) {
        $('update-progress').hidden = percent === null;
        if (percent === null) return;
        const safe = Math.max(0, Math.min(100, Number(percent) || 0));
        $('update-progress-bar').style.width = `${safe}%`;
        $('update-progress-percent').textContent = `${Math.round(safe)}%`;
    }

    function render(updateState) {
        lastState = updateState || {};
        const status = lastState.status;
        const visible = ['available', 'downloading', 'downloaded', 'installing'].includes(status)
            || (status === 'error' && lastState.version);
        toastEl.hidden = !visible || dismissedStatus === status;
        if (!visible) return;

        const target = lastState.version ? `versão ${lastState.version}` : 'nova versão';
        $('update-title').textContent = `Cursoflix ${lastState.version || ''}`.trim();

        if (status === 'downloading') {
            $('update-message').textContent = `Baixando a ${target}…`;
            setProgress(lastState.percent);
            setButton('Baixando…', 'fas fa-spinner fa-spin', true);
        } else if (status === 'downloaded') {
            $('update-message').textContent = 'Download concluído. O app reinicia para instalar.';
            setProgress(100);
            setButton('Instalar e reiniciar', 'fas fa-rotate', false);
        } else if (status === 'installing') {
            $('update-message').textContent = 'Reiniciando para atualizar…';
            setProgress(100);
            setButton('Reiniciando…', 'fas fa-spinner fa-spin', true);
        } else if (status === 'error') {
            $('update-message').textContent = `Não foi possível baixar a ${target}. Confira a internet e tente de novo.`;
            setProgress(null);
            setButton('Tentar de novo', 'fas fa-rotate-right', false);
        } else {
            $('update-message').textContent = `A ${target} está disponível. Você usa a ${lastState.currentVersion || 'versão atual'}.`;
            setProgress(null);
            setButton('Baixar e instalar', 'fas fa-download', false);
        }
    }

    button.addEventListener('click', async () => {
        if (lastState && ['downloading', 'installing'].includes(lastState.status)) return;
        setButton('Preparando…', 'fas fa-spinner fa-spin', true);
        try {
            render(await api.downloadAndInstallUpdate());
        } catch (error) {
            render({ ...(lastState || {}), status: 'error' });
        }
    });

    $('btn-dismiss-update').addEventListener('click', () => {
        dismissedStatus = lastState && lastState.status;
        toastEl.hidden = true;
    });

    api.onUpdaterState(render);
    api.getUpdateState().then(render).catch(() => { });
}

// ---------------------------------------------------------------------------
// Erros de IPC
// ---------------------------------------------------------------------------

function handleIpcError(error) {
    if (isLicenseError(error)) {
        api.checkLicense().then((license) => {
            state.license = license;
            if (!license.valid) leaveApp(license);
        }).catch(() => leaveApp({ reason: 'error' }));
        return;
    }
    console.error(error);
    toast('Algo deu errado. Tente de novo.', { type: 'error' });
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setupStaticListeners() {
    const categorySelect = $('course-category-select');
    CATEGORIES.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category === 'Arquivos de Auxilio' ? 'Arquivos de Auxílio' : category;
        categorySelect.appendChild(option);
    });

    // Login e assinatura
    $('login-form').addEventListener('submit', handleLogin);
    $('btn-toggle-password').addEventListener('click', () => {
        const input = $('input-password');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        $('btn-toggle-password').innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        $('btn-toggle-password').setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
    });
    $('btn-contract-plan').addEventListener('click', () => openExternal(supportLink('Olá! Quero assinar o Cursoflix.')));
    $('btn-renew-whatsapp').addEventListener('click', () => openExternal(supportLink(`Olá! Quero renovar o Cursoflix da conta ${(state.license && state.license.email) || ''}.`)));
    $('btn-recheck').addEventListener('click', recheckLicense);
    $('btn-switch-account').addEventListener('click', async () => {
        const result = await api.logout();
        state.license = result;
        $('input-email').value = '';
        showLicense({ reason: 'logged_out' });
    });

    // Navegação
    document.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', () => goTo(link.dataset.nav));
    });
    $('nav-logo').addEventListener('click', () => goTo('home'));
    $('btn-add-course').addEventListener('click', startAddCourses);
    $('btn-empty-add').addEventListener('click', startAddCourses);
    $('search-input').addEventListener('input', handleSearchInput);
    $('btn-back-catalog').addEventListener('click', () => goTo(state.nav === 'course' ? 'home' : state.nav));
    document.querySelectorAll('#library-sort button').forEach((button) => {
        button.addEventListener('click', () => {
            state.librarySort = button.dataset.sort;
            renderLibrary();
        });
    });
    $('notes-filter').addEventListener('input', renderNotes);
    $('btn-copy-notes').addEventListener('click', copyAllNotes);
    window.addEventListener('scroll', updateHeaderSolid, { passive: true });

    // Conta
    $('btn-account').addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = $('account-menu');
        const willOpen = menu.hidden;
        hideMenus();
        menu.hidden = !willOpen;
        $('btn-account').setAttribute('aria-expanded', String(willOpen));
        if (willOpen) menu.querySelector('button').focus();
    });
    $('account-menu').addEventListener('click', (event) => event.stopPropagation());
    $('menu-renew').addEventListener('click', () => {
        hideMenus();
        openExternal(supportLink(`Olá! Quero renovar o Cursoflix da conta ${(state.license && state.license.email) || ''}.`));
    });
    $('menu-themes').addEventListener('click', () => {
        hideMenus();
        openThemes();
    });
    $('menu-shortcuts').addEventListener('click', () => {
        hideMenus();
        openModal('shortcuts-modal');
    });
    $('menu-whats-new').addEventListener('click', () => {
        hideMenus();
        openModal('whats-new-modal');
    });
    $('menu-support').addEventListener('click', () => {
        hideMenus();
        openExternal(supportLink('Olá! Preciso de ajuda com o Cursoflix.'));
    });
    $('menu-logout').addEventListener('click', () => {
        hideMenus();
        logout();
    });

    // Modais
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => closeModal(button.closest('.modal-overlay').id));
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('mousedown', (event) => {
            if (event.target !== overlay) return;
            if (overlay.id === 'confirm-modal') settleConfirm(false);
            else if (overlay.id === 'course-modal') skipCourseDraft();
            else closeModal(overlay.id);
        });
    });
    $('btn-confirm-ok').addEventListener('click', () => settleConfirm(true));
    $('btn-confirm-cancel').addEventListener('click', () => settleConfirm(false));
    $('btn-select-cover').addEventListener('click', pickCover);
    $('btn-clear-cover').addEventListener('click', clearCover);
    $('course-name-input').addEventListener('input', updateCoverPreview);
    $('btn-save-course').addEventListener('click', saveCourseDraft);
    $('btn-cancel-course').addEventListener('click', skipCourseDraft);
    $('btn-save-note').addEventListener('click', saveNote);
    $('btn-cancel-note').addEventListener('click', () => closeModal('note-modal'));
    $('btn-import-theme').addEventListener('click', importTheme);
    $('btn-close-themes').addEventListener('click', () => closeModal('themes-modal'));

    // Player
    const video = player.video;
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('progress', updateBuffer);
    video.addEventListener('loadedmetadata', () => {
        playback.ready = true;
        updateTimeline();
        renderVideoNoteMarkers();
    });
    video.addEventListener('waiting', () => setLoading('Carregando…'));
    video.addEventListener('playing', () => setLoading(''));
    video.addEventListener('canplay', () => {
        if (!video.error) setLoading('');
    });
    video.addEventListener('play', () => {
        updatePlayPauseButton();
        queueControlsHide();
    });
    video.addEventListener('pause', () => {
        updatePlayPauseButton();
        showPlayerControls();
        if (state.view === 'player' && !video.ended) saveCurrentProgress();
    });
    video.addEventListener('volumechange', handleVolumeEvent);
    video.addEventListener('ended', handleVideoEnded);
    video.addEventListener('error', handleVideoError);
    video.addEventListener('click', togglePlay);
    video.addEventListener('dblclick', toggleFullscreen);

    player.view.addEventListener('mousemove', showPlayerControls);
    player.playPause.addEventListener('click', togglePlay);
    $('btn-rewind').addEventListener('click', () => seekTo(getCurrentTime() - 10));
    $('btn-forward').addEventListener('click', () => seekTo(getCurrentTime() + 10));
    player.timeline.addEventListener('pointerdown', startTimelineSeek);
    player.timeline.addEventListener('mousemove', updateTimelineHover);
    player.tooltip.addEventListener('pointerdown', (event) => event.stopPropagation());
    player.tooltip.addEventListener('mouseenter', () => clearTimeout(playback.tooltipTimer));
    player.tooltip.addEventListener('mouseleave', () => hideNoteTooltip(false));
    player.mute.addEventListener('click', toggleMute);
    player.volume.addEventListener('input', () => {
        video.volume = Number(player.volume.value);
        video.muted = video.volume === 0;
    });
    player.speedButton.addEventListener('click', (event) => {
        event.stopPropagation();
        player.speedMenu.classList.toggle('active');
        showPlayerControls();
    });
    player.speedMenu.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            setPlaybackRate(Number(button.dataset.speed));
            player.speedMenu.classList.remove('active');
            queueControlsHide();
        });
    });
    $('btn-add-note').addEventListener('click', () => openNoteModal());
    player.togglePdf.addEventListener('click', toggleLessonPdf);
    $('btn-close-pdf').addEventListener('click', closeLessonPdf);
    player.nextLesson.addEventListener('click', playNextLesson);
    player.fullscreen.addEventListener('click', toggleFullscreen);
    player.toggleLessons.addEventListener('click', () => setLessonsHidden(!state.lessonsHidden));
    $('btn-back-details').addEventListener('click', closePlayer);
    $('btn-next-now').addEventListener('click', () => {
        const next = getNextLesson();
        cancelNextUp();
        if (next) playVideo(state.currentCourse, next.episode, { seasonId: next.season.id });
    });
    $('btn-next-cancel').addEventListener('click', () => {
        cancelNextUp();
        showPlayerControls();
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);

    // Global
    document.addEventListener('click', () => {
        hideMenus();
        hideNoteTooltip(true);
    });
    document.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('beforeunload', () => {
        if (state.view === 'player') saveCurrentProgress();
    });
}

function handleGlobalKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && state.appReady && state.view !== 'player') {
        event.preventDefault();
        $('search-input').focus();
        $('search-input').select();
        return;
    }

    const modal = topModal();
    if (modal) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (modal.id === 'confirm-modal') settleConfirm(false);
            else if (modal.id === 'course-modal') skipCourseDraft();
            else closeModal(modal.id);
        } else if (modal.id === 'note-modal' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            saveNote();
        } else if (modal.id === 'course-modal' && event.key === 'Enter'
            && (event.target.id === 'course-name-input' || !isTypingTarget(event.target))) {
            event.preventDefault();
            saveCourseDraft();
        }
        return;
    }

    if (event.key === 'Escape' && (!$('context-menu').hidden || !$('account-menu').hidden)) {
        hideMenus();
        return;
    }

    if (isTypingTarget(event.target)) {
        if (event.key === 'Escape' && event.target.id === 'search-input') {
            clearSearch(true);
            event.target.blur();
        }
        return;
    }

    if (state.view === 'player') {
        handlePlayerShortcut(event);
    } else if (event.key === 'Escape' && state.view === 'course') {
        goTo(state.nav);
    }
}

boot();
