/*!
 * Cursoflix — API simulada para pré-visualizar a interface no navegador.
 * Copyright (c) 2026 Gabriel. Todos os direitos reservados. Veja LICENSE.
 *
 * Não contém a lógica real do app (assinatura, leitura de pastas, player de
 * arquivos locais). Serve apenas para criar e testar temas e ajustes visuais.
 *
 * Estados de teste pela URL:
 *   ?estado=login     tela de login (senha de teste: demo)
 *   ?estado=expirado  assinatura expirada
 *   ?estado=vazio     biblioteca vazia
 */
(function () {
    'use strict';

    const params = new URLSearchParams(location.search);
    const startState = params.get('estado') || 'app';
    const DAY = 86400000;
    const now = Date.now();

    const listeners = { license: [], updater: [] };
    let licensed = startState === 'app' || startState === 'vazio';
    let license = licensed
        ? { valid: true, role: 'user', email: 'aluno@exemplo.com', expiresAt: now + 23 * DAY }
        : startState === 'expirado'
            ? { valid: false, reason: 'expired', email: 'aluno@exemplo.com', expiresAt: now - 2 * DAY }
            : { valid: false, reason: 'no_license' };

    const SAMPLE_VIDEO = 'dev/sample.mp4';

    function lesson(courseId, seasonPath, name, order, extra = {}) {
        return {
            id: `${courseId}|${seasonPath}/${name}`,
            name,
            path: `C:/Cursos/${courseId}/${seasonPath}/${name}`,
            order,
            hasPdf: Boolean(extra.pdf),
            pdfUrl: extra.pdf ? 'dev/sample.pdf' : null
        };
    }

    function course(id, name, category, modules, coverHue = null) {
        const seasons = [];
        modules.forEach(([moduleName, lessons, materials]) => {
            seasons.push({
                id: `${id}|${moduleName}`,
                name: moduleName,
                episodes: lessons.map((item, index) => lesson(id, moduleName, item.name || item, index + 1, item)),
                materials: (materials || []).map((material) => ({ name: material, url: 'dev/sample.pdf' }))
            });
        });
        return {
            id: `C:\\Cursos\\${id}`,
            name: id,
            path: `C:\\Cursos\\${id}`,
            registeredPath: `C:\\Cursos\\${id}`,
            displayName: name,
            category,
            coverUrl: coverHue === null ? null : cover(coverHue, name),
            seasons
        };
    }

    function cover(hue, title) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${hue + 40} 65% 22%)"/></linearGradient></defs>
            <rect width="640" height="420" fill="url(#g)"/>
            <circle cx="520" cy="90" r="160" fill="rgba(255,255,255,0.12)"/>
            <circle cx="120" cy="380" r="120" fill="rgba(0,0,0,0.18)"/>
            <text x="40" y="120" font-family="Segoe UI, sans-serif" font-size="44" font-weight="700" fill="rgba(255,255,255,0.35)">${title.split(' ')[0]}</text>
        </svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    const aulas = (prefix, count) => Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(2, '0')} ${prefix} ${i + 1}.mp4`);

    let courses = [
        course('Excel Completo', 'Excel do Zero ao Avançado', 'Negócios e Carreira', [
            ['Módulo 1 - Primeiros passos', [{ name: '01 Boas-vindas.mp4', pdf: true }, '02 Conhecendo a interface.mp4', '03 Células e intervalos.mp4', { name: '04 Formatação.mp4', pdf: true }], ['Apostila do módulo.pdf']],
            ['Módulo 2 - Fórmulas', aulas('Fórmula', 6)],
            ['Módulo 3 - Tabelas dinâmicas', aulas('Tabela dinâmica', 5)],
            ['Módulo 4 - Dashboards', aulas('Dashboard', 4)]
        ], 145),
        course('Fundamentos do ClickUp', 'Fundamentos do ClickUp', 'Negócios e Carreira', [
            ['Introdução', aulas('Aula', 3)],
            ['Espaços e listas', aulas('Aula', 5)],
            ['Automações', aulas('Automação', 4)]
        ]),
        course('Design de Interfaces', 'Design de Interfaces com Figma', 'Criatividade e Design', [
            ['Fundamentos', aulas('Fundamento', 6)],
            ['Componentes', aulas('Componente', 7)],
            ['Protótipos', aulas('Protótipo', 5)]
        ], 300),
        course('Fotografia', 'Fotografia com Celular', 'Criatividade e Design', [
            ['Luz', aulas('Luz', 4)],
            ['Composição', aulas('Composição', 4)],
            ['Edição', aulas('Edição', 6)]
        ]),
        course('JavaScript', 'JavaScript Moderno', 'Tecnologia e Inovação', [
            ['Módulo 1 - Base', aulas('Aula', 8)],
            ['Módulo 2 - DOM', aulas('Aula', 6)],
            ['Módulo 3 - Async', aulas('Aula', 6)],
            ['Módulo 4 - Projeto final', aulas('Aula', 5)]
        ], 210),
        course('Python', 'Python para Análise de Dados', 'Tecnologia e Inovação', [
            ['Introdução', aulas('Aula', 5)],
            ['Pandas', aulas('Pandas', 8)]
        ]),
        course('Inglês', 'Inglês para Viagem', 'Educação e Desenvolvimento', [
            ['Aeroporto', aulas('Aula', 4)],
            ['Hotel', aulas('Aula', 4)],
            ['Restaurante', aulas('Aula', 4)]
        ], 20),
        course('Finanças', 'Finanças Pessoais na Prática', 'Finanças e Jurídico', [
            ['Orçamento', aulas('Aula', 5)],
            ['Investimentos', aulas('Aula', 6)]
        ])
    ];

    const videos = {};
    const history = [];
    function watched(courseIndex, seasonIndex, lessonIndex, completed, minutesAgo, time = 300, duration = 900) {
        const ep = courses[courseIndex].seasons[seasonIndex].episodes[lessonIndex];
        const timestamp = now - minutesAgo * 60000;
        videos[ep.id] = { time: completed ? duration : time, duration, completed, timestamp };
        history.push({ courseId: courses[courseIndex].id, videoId: ep.id, timestamp });
    }
    [0, 1, 2, 3].forEach((i) => watched(0, 0, i, true, 3000 - i * 10));
    watched(0, 1, 0, true, 1500);
    watched(0, 1, 1, false, 12, 412, 1260);
    watched(4, 0, 0, true, 2900);
    watched(4, 0, 1, false, 300, 190, 840);
    watched(2, 0, 0, false, 1440, 600, 980);
    courses[6].seasons.forEach((season, s) => season.episodes.forEach((_, i) => watched(6, s, i, true, 9000 + s * 20 + i)));
    history.sort((a, b) => b.timestamp - a.timestamp);

    const progress = {
        courses: courses.map((item) => item.registeredPath),
        courseMetadata: {},
        videos,
        lastWatched: {
            [courses[0].id]: courses[0].seasons[1].episodes[1].id,
            [courses[4].id]: courses[4].seasons[0].episodes[1].id
        },
        history,
        notes: [
            { id: 'n1', courseId: courses[0].id, courseName: courses[0].displayName, videoId: courses[0].seasons[1].episodes[1].id, videoName: courses[0].seasons[1].episodes[1].name, time: 95, text: 'PROCV com correspondência exata: usar FALSO no último argumento.', createdAt: now - DAY },
            { id: 'n2', courseId: courses[0].id, courseName: courses[0].displayName, videoId: courses[0].seasons[1].episodes[1].id, videoName: courses[0].seasons[1].episodes[1].name, time: 340, text: 'Atalho Ctrl + Shift + L liga o filtro.', createdAt: now - DAY },
            { id: 'n3', courseId: courses[4].id, courseName: courses[4].displayName, videoId: courses[4].seasons[0].episodes[1].id, videoName: courses[4].seasons[0].episodes[1].name, time: 61, text: 'const não deixa reatribuir, mas o objeto continua mutável.', createdAt: now - 2 * DAY }
        ],
        prefs: { lastPatchNotesVersion: '1.3.0' }
    };

    if (startState === 'vazio') {
        courses = [];
        progress.courses = [];
    }

    const themes = [
        { id: 'builtin:padrao', name: 'Brasa', author: 'Cursoflix', description: 'Tema original do Cursoflix.', swatch: ['#16121A', '#FF8A3D', '#E0143C'], source: 'builtin' },
        { id: 'builtin:oceano', name: 'Oceano', author: 'Cursoflix', description: 'Azul profundo com destaque turquesa.', swatch: ['#0E1720', '#2DD4BF', '#3B82F6'], source: 'builtin' },
        { id: 'builtin:claro', name: 'Claro', author: 'Cursoflix', description: 'Fundo claro para ambientes iluminados.', swatch: ['#F7F3EF', '#FF7A2F', '#D9143A'], source: 'builtin' }
    ];
    let activeTheme = 'builtin:padrao';

    async function themeCss(id) {
        if (id === 'builtin:padrao') return '';
        const folder = id.split(':')[1];
        try {
            const response = await fetch(`themes/${folder}/theme.css`);
            return response.ok ? response.text() : '';
        } catch (error) {
            return '';
        }
    }

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const requireLicense = () => {
        if (!licensed) throw new Error('LICENSE_REQUIRED');
    };
    const emit = (channel, payload) => listeners[channel].forEach((callback) => callback(payload));

    window.electronAPI = {
        getAppInfo: async () => ({ version: '1.3.0', supportUrl: 'https://wa.me/5547992201382', isPackaged: false, platform: 'preview' }),
        openExternal: async (url) => {
            console.info('[preview] abriria no navegador:', url);
            return true;
        },

        checkLicense: async () => {
            await delay(500);
            return license;
        },
        login: async ({ email, password }) => {
            await delay(700);
            if (!email || !password) return { valid: false, reason: 'missing_credentials' };
            if (password !== 'demo') return { valid: false, reason: 'invalid_credentials' };
            if (email.startsWith('expirado')) {
                license = { valid: false, reason: 'expired', email, expiresAt: now - 3 * DAY };
                return license;
            }
            licensed = true;
            license = { valid: true, role: 'user', email, expiresAt: now + 23 * DAY };
            emit('license', license);
            return license;
        },
        logout: async () => {
            licensed = false;
            license = { valid: false, reason: 'logged_out' };
            return license;
        },
        onLicenseState: (callback) => {
            listeners.license.push(callback);
            return () => { };
        },

        loadLibrary: async () => {
            requireLicense();
            await delay(250);
            return { courses: JSON.parse(JSON.stringify(courses)), missing: [], progress: JSON.parse(JSON.stringify(progress)) };
        },
        pickCourseFolders: async () => {
            requireLicense();
            return ['C:\\Cursos\\Novo Curso de Exemplo'];
        },
        pickCover: async () => ({ path: 'C:\\capa.jpg', name: 'capa.jpg', preview: cover(28, 'Capa') }),
        saveCourse: async (payload) => {
            requireLicense();
            const existing = courses.find((item) => item.registeredPath === payload.path);
            if (existing) {
                existing.displayName = payload.name || existing.displayName;
                existing.category = payload.category;
                if (payload.removeCover) existing.coverUrl = null;
                if (payload.coverSourcePath) existing.coverUrl = cover(28, existing.displayName);
                return { ok: true, course: existing };
            }
            const created = course(payload.path.split('\\').pop(), payload.name || 'Novo curso', payload.category, [['Módulo 1', aulas('Aula', 4)]], payload.coverSourcePath ? 28 : null);
            courses.push(created);
            progress.courses.push(created.registeredPath);
            return { ok: true, course: created };
        },
        removeCourse: async (coursePath) => {
            courses = courses.filter((item) => item.registeredPath !== coursePath);
            progress.courses = progress.courses.filter((item) => item !== coursePath);
            return progress;
        },

        saveProgress: async (payload) => {
            requireLicense();
            const previous = progress.videos[payload.videoId] || {};
            progress.videos[payload.videoId] = { ...payload, completed: payload.completed || previous.completed, timestamp: Date.now() };
            return progress.videos[payload.videoId];
        },
        setCompleted: async ({ items, completed }) => {
            requireLicense();
            items.forEach(({ videoId }) => {
                if (completed) progress.videos[videoId] = { time: 900, duration: 900, completed: true, timestamp: Date.now() };
                else delete progress.videos[videoId];
            });
            return progress;
        },
        saveNotes: async (notes) => {
            progress.notes = notes;
            return notes;
        },
        setPreference: async (key, value) => {
            progress.prefs[key] = value;
            return progress.prefs;
        },

        prepareVideo: async () => {
            requireLicense();
            await delay(300);
            return { mode: 'native', url: SAMPLE_VIDEO, duration: 0 };
        },

        listThemes: async () => ({ themes, active: { id: activeTheme, css: await themeCss(activeTheme) } }),
        getTheme: async () => ({ id: activeTheme, css: await themeCss(activeTheme) }),
        setTheme: async (id) => {
            activeTheme = themes.some((theme) => theme.id === id) ? id : 'builtin:padrao';
            return { id: activeTheme, css: await themeCss(activeTheme) };
        },
        importTheme: async () => ({ ok: false, error: 'missing_css' }),
        removeTheme: async () => ({ ok: false }),

        getUpdateState: async () => ({ status: params.has('atualizacao') ? 'available' : 'none', version: '1.3.1', currentVersion: '1.3.0' }),
        downloadAndInstallUpdate: async () => {
            for (let percent = 0; percent <= 100; percent += 20) {
                emit('updater', { status: 'downloading', percent, version: '1.3.1', currentVersion: '1.3.0' });
                await delay(250);
            }
            return { status: 'downloaded', version: '1.3.1', currentVersion: '1.3.0' };
        },
        onUpdaterState: (callback) => {
            listeners.updater.push(callback);
            return () => { };
        }
    };
})();
