/**
 * dsh-cn-menu-kit — client half.
 *
 * Surfaces (one data path: the official `skills/list` + `commands/list` remotes
 * plus the commandUi contribution registry):
 * 1. A `/` trigger source 「技能（中文）」 next to the built-in skill source,
 *    candidates titled `中文标题（english-name）`; picking inserts `/english-name `.
 * 2. A「+」panel command contribution 「技能」 (popupSelect) with fuzzy search
 *    over the Chinese titles.
 * 3. Two standalone「+」actions — 「技能排序」 and 「命令排序」 — opening a
 *    sortable panel that mirrors the command menu exactly (添加/指令 sections,
 *    host directory + client contributions), drag within a section.
 * 4. Direct in-menu drag: hovering a command row reveals a ⋮⋮ handle; grabbing
 *    it reorders rows in place. The handle press is intercepted on the listbox
 *    in the CAPTURE phase — capture stopPropagation keeps the native event
 *    from ever reaching React's root container, so the row's onMouseDown pick
 *    never fires. Orders persist in localStorage; a render observer re-applies
 *    them and re-injects handles after React re-renders.
 *
 * Titles come from each skill's description leading 「中文标题——」 segment
 * (written by the description pass over ~/.dsh/skills). The catalog fetch
 * keeps the built-in source's retained-session discipline.
 */
window.__ModuleLoader__.load({
    id: 'dsh-cn-menu-kit',
    factory: (require) => {
        const inject = ['inputTriggers', 'sessions', 'remote', 'remote.skills', 'commandUi', 'remote.commands'];

        const TITLE_SPLIT = /^(.{1,24}?)——/;
        const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
        const SKILL_ORDER_KEY = 'dsh-cn-skill-picker:order:v1';
        const CMD_ADD_KEY = 'dsh-cn-skill-picker:cmd-add-order:v1';
        const CMD_CMD_KEY = 'dsh-cn-skill-picker:command-order:v1';
        const STYLE_ID = 'cn-skill-picker-style';
        const TOOLTIP_ID = 'cn-skill-picker-tooltip';
        const SORT_DIALOG_ID = 'cn-skill-picker-sort';
        /** 官方 popupSelect 的分区固定名单（镜像 app 内 SECTION_ROWS） */
        const ADD_PINNED = ['file', 'goal', 'plan', 'feedback'];
        const CMD_PINNED = ['compact', 'permission', 'model', 'export'];
        const SECTION_TITLES = { add: ['添加', 'Add'], commands: ['指令', 'Commands'] };

        const loadList = (key) => {
            try {
                const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
                return Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : [];
            } catch { return []; }
        };
        const saveList = (key, names) => {
            try { localStorage.setItem(key, JSON.stringify(names)); } catch { /* private mode */ }
        };
        const applySavedOrder = (entries, key) => {
            const order = loadList(key);
            const index = new Map(order.map((n, i) => [n, i]));
            return entries
                .map((entry, i) => ({ entry, i, at: index.get(entry.id) ?? Number.MAX_SAFE_INTEGER }))
                .sort((a, b) => (a.at - b.at) || (a.i - b.i))
                .map((e) => e.entry);
        };

        const ensureStyles = () => {
            if (document.getElementById(STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
#${SORT_DIALOG_ID} .cn-sort-row { transition: transform .16s ease; }
#${SORT_DIALOG_ID} .cn-sort-row.cn-dragging { transition: none; z-index: 20; position: relative; box-shadow: 0 8px 28px rgba(0,0,0,.45); background: rgba(76,110,245,.28); border-color: rgba(76,110,245,.6); }
#${SORT_DIALOG_ID} .cn-sort-handle { cursor: grab; }
#${SORT_DIALOG_ID} .cn-sort-row.cn-dragging .cn-sort-handle { cursor: grabbing; }
.cn-menu-drag-handle:hover { color: #4c6ef5; }
#${TOOLTIP_ID} { opacity: 0; transform: translateY(4px); transition: opacity .14s ease, transform .14s ease; }
#${TOOLTIP_ID}.cn-tooltip-visible { opacity: 1; transform: translateY(0); }
.cn-menu-dragging { z-index: 30; box-shadow: 0 8px 24px rgba(0,0,0,.22); background: rgba(76,110,245,.10); }
`;
            document.head.appendChild(style);
        };

        function apply(ctx) {
            const inputTriggers = ctx.get('inputTriggers');
            const sessions = ctx.get('sessions');
            const skillsRemote = ctx.get('remote.skills');
            const commandsRemote = ctx.get('remote.commands');
            const commandUi = ctx.get('commandUi');
            const remoteSvc = ctx.get('remote');

            const fetches = new Map();
            const titleMap = new Map();
            const detailMap = new Map();
            let lastCatalog = [];
            let lastSessionId = null;
            let hostDirectory = null;

            const clearAll = () => {
                for (const entry of fetches.values()) entry.abort.abort();
                fetches.clear();
            };

            const fetchCatalog = (sessionId) => {
                const existing = fetches.get(sessionId);
                if (existing !== undefined) return existing;
                const abort = new AbortController();
                const promise = (async () => {
                    if (sessions.binding(sessionId) === undefined) {
                        throw new Error(`skill catalog requires a retained session "${sessionId}"`);
                    }
                    return await sessions.using(
                        sessionId,
                        { source: 'skillCnCatalog', signal: abort.signal },
                        async (reference) => {
                            abort.signal.throwIfAborted();
                            const state = reference.binding.session.getSnapshot();
                            if (state.openState !== 'open') {
                                throw state.openError ?? new Error(`session "${sessionId}" is not open`);
                            }
                            const result = await skillsRemote.list({ sessionId }, abort.signal);
                            abort.signal.throwIfAborted();
                            if (!result.ok) {
                                throw new Error(`skills/list failed: ${result.error.code}: ${result.error.message}`);
                            }
                            return result.value.skills;
                        }
                    );
                })();
                const entry = { promise, abort };
                promise.then(
                    (skills) => { lastCatalog = skills; },
                    () => {
                        // 一次瞬时失败不永久缓存：驱逐后下次进入会重试
                        if (fetches.get(sessionId)?.promise === promise) fetches.delete(sessionId);
                    },
                );
                fetches.set(sessionId, entry);
                return entry;
            };

            const rememberSession = (sessionId) => {
                if (typeof sessionId === 'string' && sessionId !== '' && lastSessionId !== sessionId) {
                    lastSessionId = sessionId;
                    hostDirectory = null;
                }
            };

            const titleOf = (skill) => {
                const description = (skill.description ?? '').trim();
                const match = description.match(TITLE_SPLIT);
                if (!match || !hasCJK(match[1])) return null;
                return { title: match[1], full: description, name: skill.name ?? '', rest: description.slice(match[0].length).trim() };
            };

            const inSubagent = (session) => {
                try {
                    return sessions.subagentAddress?.(session.sessionId) !== undefined;
                } catch {
                    return false;
                }
            };

            const groupOf = (skill) => {
                const path = String(skill.path ?? '').replace(/\\/g, '/').toLowerCase();
                if (path.includes('/.dsh/skills')) return '用户技能';
                if (path.includes('/.agents/skills')) return 'Agent 技能';
                if (path.includes('node_modules')) return '插件技能';
                return undefined;
            };

            /* ------------------------------------------------------------------ */
            /* 菜单镜像：宿主目录 ∪ 客户端贡献 → 添加/指令 两区                     */
            /* ------------------------------------------------------------------ */
            const buildMenuRows = async () => {
                let host = [];
                if (typeof lastSessionId === 'string' && lastSessionId !== '') {
                    if (hostDirectory === null) await ensureHostDirectory();
                    host = hostDirectory ?? [];
                }
                const contribs = [];
                try {
                    const live = commandUi?.live?.contributions;
                    if (live instanceof Map) {
                        for (const [contributionName, contribution] of live) {
                            let label;
                            let description;
                            try { const l = contribution?.label?.(); label = typeof l === 'string' ? l : undefined; } catch { /* 无 label */ }
                            try { description = contribution?.description?.() ?? ''; } catch { /* 无描述 */ }
                            contribs.push({ name: contributionName, label, description: description ?? '' });
                        }
                    }
                } catch { /* registry 不可达——退化为宿主目录 */ }
                const seen = new Set(host.map((h) => h.name));
                const rows = [...host, ...contribs.filter((c) => !seen.has(c.name)).map((c) => ({ ...c, isContribution: true }))];
                const byName = new Map(rows.map((r) => [r.name, r]));
                const pick = (names) => names.map((n) => byName.get(n)).filter(Boolean);
                return {
                    addRows: pick(ADD_PINNED),
                    cmdRows: [
                        ...pick(CMD_PINNED),
                        ...rows.filter((r) => !ADD_PINNED.includes(r.name) && !CMD_PINNED.includes(r.name)),
                    ],
                };
            };

            /* ------------------------------------------------------------------ */
            /* 悬浮详情层（跟随行定位 + 主题自适应 + 延迟淡入）                     */
            /* ------------------------------------------------------------------ */
            const TOOLTIP_SHOW_DELAY = 140;
            let tooltipShowTimer = null;

            const themeColors = () => {
                let dark = false;
                try {
                    const bg = getComputedStyle(document.body).backgroundColor;
                    const m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                    if (m) dark = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) < 128;
                } catch { /* 默认浅色 */ }
                return dark
                    ? { bg: '#1f2430', border: 'rgba(255,255,255,.14)', text: '#e8eaf0', sub: '#8f98ab', shadow: '0 12px 32px rgba(0,0,0,.45)' }
                    : { bg: '#ffffff', border: 'rgba(15,23,42,.12)', text: '#1f2937', sub: '#6b7280', shadow: '0 12px 32px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.08)' };
            };

            const ensureTooltip = () => {
                let tip = document.getElementById(TOOLTIP_ID);
                if (tip) return tip;
                tip = document.createElement('div');
                tip.id = TOOLTIP_ID;
                tip.setAttribute('role', 'tooltip');
                tip.style.cssText = [
                    'position:fixed', 'z-index:2147483000', 'display:none',
                    'width:400px', 'max-height:320px', 'overflow:auto',
                    'padding:10px 12px', 'border-radius:10px',
                    'pointer-events:none',
                ].join(';');
                document.body.appendChild(tip);
                return tip;
            };
            const hideTooltip = () => {
                if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
                const tip = document.getElementById(TOOLTIP_ID);
                if (tip) { tip.classList.remove('cn-tooltip-visible'); tip.style.display = 'none'; }
            };
            const showTooltipFor = (row) => {
                const text = (row.textContent ?? '').trim();
                // 取最长命中：标题互为子串（如「翻译」vs「翻译增强」）时选更具体的
                let detail = null;
                let best = '';
                for (const [displayName, cn] of detailMap) {
                    if (text.includes(displayName) && displayName.length > best.length) {
                        detail = cn;
                        best = displayName;
                    }
                }
                if (!detail) { hideTooltip(); return; }
                if (tooltipShowTimer) clearTimeout(tooltipShowTimer);
                tooltipShowTimer = setTimeout(() => {
                    const tip = ensureTooltip();
                    const c = themeColors();
                    tip.style.background = c.bg;
                    tip.style.border = `1px solid ${c.border}`;
                    tip.style.boxShadow = c.shadow;
                    tip.textContent = '';
                    const head = document.createElement('div');
                    head.style.cssText = 'display:flex;align-items:baseline;gap:7px;margin-bottom:5px';
                    const t1 = document.createElement('span');
                    t1.style.cssText = 'font-weight:600;font-size:13px';
                    t1.textContent = detail.title;
                    const t2 = document.createElement('span');
                    t2.style.cssText = `font-size:11px;color:${c.sub}`;
                    t2.textContent = detail.name;
                    head.appendChild(t1);
                    head.appendChild(t2);
                    const body = document.createElement('div');
                    body.style.cssText = 'font-size:12px;line-height:1.62';
                    body.textContent = detail.full;
                    tip.appendChild(head);
                    tip.appendChild(body);
                    tip.style.display = 'block';
                    // 定位：绝不遮挡菜单。候选顺序：菜单右侧外 → 左侧外 → 菜单上方 → 菜单下方
                    const rect = row.getBoundingClientRect();
                    const tw = tip.offsetWidth, th = tip.offsetHeight;
                    const vw = window.innerWidth, vh = window.innerHeight;
                    const lb = listboxEl()?.getBoundingClientRect();
                    // 菜单卡片范围：listbox 向上扩 64px（近似搜索框高度）
                    const card = lb
                        ? { left: lb.left, right: lb.right, top: Math.max(0, lb.top - 64), bottom: lb.bottom }
                        : { left: rect.left, right: rect.right, top: rect.top - 64, bottom: rect.bottom };
                    const fitsRight = card.right + 12 + tw <= vw - 8;
                    const fitsLeft = card.left - 12 - tw >= 8;
                    const fitsAbove = card.top - 12 - th >= 8;
                    const fitsBelow = card.bottom + 12 + th <= vh - 8;
                    const clampX = (x) => Math.min(Math.max(8, x), Math.max(8, vw - tw - 8));
                    const rowCenterTop = () => Math.min(
                        Math.max(8, rect.top + rect.height / 2 - th / 2),
                        Math.max(8, vh - th - 8),
                    );
                    let left;
                    let top;
                    if (fitsRight) {
                        left = card.right + 12;
                        top = rowCenterTop();
                    } else if (fitsLeft) {
                        left = card.left - 12 - tw;
                        top = rowCenterTop();
                    } else if (fitsAbove) {
                        left = clampX(rect.right - tw);
                        top = card.top - 12 - th;
                    } else if (fitsBelow) {
                        left = clampX(rect.right - tw);
                        top = card.bottom + 12;
                    } else {
                        // 窗口极窄：贴行显示（退化为旧行为）
                        left = rect.right + 10;
                        if (left + tw > vw - 8) left = Math.max(8, rect.left - tw - 10);
                        top = rowCenterTop();
                    }
                    tip.style.left = `${Math.round(left)}px`;
                    tip.style.top = `${Math.round(top)}px`;
                    tip.classList.add('cn-tooltip-visible');
                }, TOOLTIP_SHOW_DELAY);
            };
            const onPointerOver = (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                if (target.closest('.cn-menu-drag-handle')) return;
                const row = target.closest('[role="option"]');
                if (!row) { hideTooltip(); return; }
                showTooltipFor(row);
            };
            const onLeave = (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                const row = target.closest('[role="option"]');
                const next = event.relatedTarget;
                if (row && next instanceof Element && row.contains(next)) return;
                hideTooltip();
            };
            const onHideEvents = () => hideTooltip();
            try {
                document.addEventListener('pointerover', onPointerOver, true);
                document.addEventListener('pointerout', onLeave, true);
                window.addEventListener('scroll', onHideEvents, true);
                window.addEventListener('blur', onHideEvents);
            } catch {
                /* no DOM (unexpected host) — hover detail silently unavailable */
            }

            /* ------------------------------------------------------------------ */
            /* `/` 触发源                                                          */
            /* ------------------------------------------------------------------ */
            const source = {
                trigger: '/',
                name: '技能（中文）',
                order: 1,
                async candidates(session, { query, signal }) {
                    if (inSubagent(session)) return [];
                    rememberSession(session.sessionId);
                    let list;
                    try {
                        list = await fetchCatalog(session.sessionId).promise;
                    } catch {
                        return [];
                    }
                    if (signal?.aborted) return [];

                    const q = (query ?? '').trim().toLowerCase();
                    const rows = [];
                    for (const skill of list) {
                        const cn = titleOf(skill);
                        const displayName = cn ? `${cn.title}（${skill.name}）` : (skill.name ?? '');
                        const note = cn ? (cn.rest || skill.description || '') : (skill.description ?? '');
                        if (q !== '') {
                            const hay = `${displayName}\n${note}`.toLowerCase();
                            if (!hay.includes(q)) continue;
                        }
                        rows.push({
                            displayName,
                            note,
                            rank: q === ''
                                ? 0
                                : displayName.toLowerCase().startsWith(q) ? 0
                                : displayName.toLowerCase().includes(q) ? 1
                                : 2,
                        });
                        if (skill.name) titleMap.set(displayName, skill.name);
                        if (cn) detailMap.set(displayName, { title: cn.title, full: cn.full, name: cn.name });
                        else detailMap.delete(displayName);
                        if (rows.length >= 60) break;
                    }
                    rows.sort((a, b) => a.rank - b.rank);
                    const ordered = q === ''
                        ? applySavedOrder(rows.map((row) => ({ id: titleMap.get(row.displayName) ?? row.displayName, row })), SKILL_ORDER_KEY).map((entry) => entry.row)
                        : rows;
                    return ordered.map((row) => ({ name: row.displayName, description: row.note }));
                },
                warm(session) {
                    if (inSubagent(session)) return;
                    rememberSession(session.sessionId);
                    fetchCatalog(session.sessionId).promise.catch(() => {});
                    try { ensureHostDirectory().catch(() => {}); } catch { /* apply 尚未完成，observer 会补 */ }
                },
                onPick({ candidate }) {
                    const realName = titleMap.get(candidate?.name) ?? candidate?.name ?? '';
                    return { text: `/${realName} ` };
                },
            };

            /* ------------------------------------------------------------------ */
            /* 菜单镜像 + 拖拽基础设施                                              */
            /* ------------------------------------------------------------------ */
            const debugLog = (...args) => {
                try {
                    if (localStorage.getItem('dsh-cn-skill-picker:debug') === '1') console.debug('[cn-skill-picker]', ...args);
                } catch { /* 无 localStorage */ }
            };

            const listboxEl = () => document.querySelector('[role="listbox"]');
            const listboxRows = () => [...(listboxEl()?.querySelectorAll('[role="option"]') ?? [])];
            const scrollMenu = (delta) => { const el = listboxEl(); if (el) el.scrollTop += delta; };

            const knownCommandNames = () => {
                const names = new Set([
                    ...(hostDirectory ?? []).map((c) => c.name),
                    ...loadList(CMD_ADD_KEY), ...loadList(CMD_CMD_KEY),
                    ...ADD_PINNED, ...CMD_PINNED,
                ]);
                try {
                    const live = commandUi?.live?.contributions;
                    if (live instanceof Map) for (const contributionName of live.keys()) names.add(contributionName);
                } catch { /* registry 不可达 */ }
                return names;
            };

            const rowNameOf = (row) => commandNameAt(row.textContent ?? '', knownCommandNames());

            const sectionOfRow = (row) => {
                let el = row.previousElementSibling;
                while (el) {
                    if (el.getAttribute?.('role') === 'presentation') {
                        const text = (el.textContent ?? '').trim();
                        if (SECTION_TITLES.add.includes(text)) return 'add';
                        if (SECTION_TITLES.commands.includes(text)) return 'commands';
                        return null;
                    }
                    el = el.previousElementSibling;
                }
                return null;
            };

            const ensureHostDirectory = async () => {
                if (hostDirectory !== null) return hostDirectory;
                if (typeof lastSessionId !== 'string' || lastSessionId === '') return [];
                try {
                    const result = await commandsRemote.list(lastSessionId);
                    hostDirectory = result.ok
                        ? (result.value ?? []).map((c) => ({ name: c.name ?? '', description: c.description ?? '' })).filter((c) => c.name !== '')
                        : [];
                } catch { hostDirectory = []; }
                debugLog('host directory loaded:', hostDirectory.length);
                return hostDirectory;
            };

            /**
             * 架构核心：包裹官方「command」源的 candidates——浏览模式（空查询）
             * 下按保存的顺序重排各分区的行后再返回，React 由此原生按用户顺序
             * 渲染，完全不与 React 抢 DOM。搜索态保持官方匹配度排序。
             */
            const applyToCommandRows = (rows) => {
                if (!Array.isArray(rows) || !rows.some((row) => row && row.section)) return rows;
                const buckets = [];
                for (const row of rows) {
                    let bucket = buckets.find((b) => b.name === row.section);
                    if (!bucket) { bucket = { name: row.section, rows: [] }; buckets.push(bucket); }
                    bucket.rows.push(row);
                }
                return buckets.flatMap((bucket) => {
                    const key = SECTION_TITLES.add.includes(bucket.name) ? CMD_ADD_KEY : CMD_CMD_KEY;
                    return applySavedOrder(bucket.rows.map((r) => ({ id: r.name ?? '', row: r })), key).map((e) => e.row);
                });
            };

            const wrapCommandSource = () => {
                try {
                    const live = inputTriggers?.live?.sources;
                    if (!Array.isArray(live)) { debugLog('wrap: no live.sources'); return false; }
                    const cmd = live.find((s) => s.trigger === '/' && s.name === 'command');
                    if (!cmd) { debugLog('wrap: command source not found'); return false; }
                    if (cmd.__cnOrderWrapped) return true;
                    const original = cmd.candidates;
                    if (typeof original !== 'function') { debugLog('wrap: candidates missing'); return false; }
                    cmd.candidates = async (session, req) => {
                        const rows = await original.call(cmd, session, req);
                        try { return applyToCommandRows(rows); } catch (error) { debugLog('order apply failed', error); return rows; }
                    };
                    cmd.__cnOrderWrapped = true;
                    debugLog('command source wrapped');
                    return true;
                } catch (error) { debugLog('wrap failed', error); return false; }
            };

            /* ------------------------------------------------------------------ */
            /* 菜单内直接拖拽：把手注入 + 捕获阶段拦截 + transform 拖拽 + FLIP      */
            /* ------------------------------------------------------------------ */
            let menuDragState = null;
            const wiredListboxes = new WeakSet();

            const wireListbox = (listbox) => {
                if (wiredListboxes.has(listbox)) return;
                wiredListboxes.add(listbox);
                // 捕获阶段拦截把手上的指针事件：capture 的 stopPropagation
                // 让事件到不了 React 根容器，行的 onMouseDown pick 不会触发
                const intercept = (event) => {
                    const target = event.target;
                    if (!(target instanceof Element)) return;
                    if (!target.closest('.cn-menu-drag-handle')) return;
                    event.stopPropagation();
                    event.preventDefault();
                    if (event.type === 'pointerdown') {
                        if (event.button !== 0) return;
                        const row = target.closest('[role="option"]');
                        if (row) startMenuDrag(event, handle, row);
                    }
                };
                for (const type of ['pointerdown', 'mousedown', 'click']) {
                    listbox.addEventListener(type, intercept, true);
                }
                debugLog('listbox wired');
            };

            const startMenuDrag = (event, handle, row) => {
                if (menuDragState) return;
                const section = sectionOfRow(row);
                if (section === null) { debugLog('drag rejected: no section'); return; }
                const sectionRowsLive = () => listboxRows().filter((el) => sectionOfRow(el) === section);
                const startIndex = sectionRowsLive().indexOf(row);
                if (startIndex === -1) { debugLog('drag rejected: row replaced'); return; }
                menuDragState = { section };
                hideTooltip();
                try { handle.setPointerCapture(event.pointerId); } catch { /* 指针失效，lostpointercapture 兜底 */ }
                row.classList.add('cn-menu-dragging');
                const startIndexScroll = listboxEl()?.scrollTop ?? 0;
                let currentIndex = startIndex;
                const startY = event.clientY;
                const rowH = row.getBoundingClientRect().height
                    + parseFloat(getComputedStyle(row).marginTop || '0')
                    + parseFloat(getComputedStyle(row).marginBottom || '0');
                debugLog('drag start', rowNameOf(row), 'section', section, 'index', startIndex);

                let settled = false;
                const detach = () => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', onUp);
                    handle.removeEventListener('pointercancel', onCancel);
                    handle.removeEventListener('lostpointercapture', onLost);
                };
                const resetVisual = () => {
                    sectionRowsLive().forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
                    row.style.transition = '';
                    row.style.transform = '';
                    row.classList.remove('cn-menu-dragging');
                    menuDragState = null;
                };
                const move = (ev) => {
                    const dy = ev.clientY - startY + ((listboxEl()?.scrollTop ?? 0) - startIndexScroll);
                    row.style.transform = `translateY(${dy}px)`;
                    const lr = listboxEl()?.getBoundingClientRect();
                    if (lr) {
                        if (ev.clientY < lr.top + 34) scrollMenu(-9);
                        else if (ev.clientY > lr.bottom - 34) scrollMenu(9);
                    }
                    const rect = row.getBoundingClientRect();
                    const center = rect.top + rect.height / 2;
                    let idx = 0;
                    sectionRowsLive().forEach((el) => {
                        if (el === row) return;
                        const r = el.getBoundingClientRect();
                        if (center > r.top + r.height / 2) idx++;
                    });
                    if (idx === currentIndex) return;
                    sectionRowsLive().forEach((el, i) => {
                        if (el === row) return;
                        let shift = 0;
                        if (idx > startIndex && i > startIndex && i <= idx) shift = -rowH;
                        else if (idx < startIndex && i >= idx && i < startIndex) shift = rowH;
                        el.style.transform = shift ? `translateY(${shift}px)` : '';
                    });
                    currentIndex = idx;
                };
                const onUp = () => {
                    if (settled) return;
                    settled = true;
                    detach();
                    const siblings = sectionRowsLive();
                    if (currentIndex === startIndex) { resetVisual(); debugLog('drag no-op'); return; }
                    // 元素级重排：名字只在存盘时派生（贡献行可能识别不出，不参与名字数组）
                    const before = new Map(siblings.map((el) => [el, el.getBoundingClientRect().top]));
                    const ordered = [...siblings];
                    const [moved] = ordered.splice(startIndex, 1);
                    ordered.splice(currentIndex, 0, moved);
                    const anchorEl = siblings[siblings.length - 1].nextSibling;
                    const box = listboxEl();
                    if (box) for (const el of ordered) box.insertBefore(el, anchorEl);
                    siblings.forEach((el) => {
                        const delta = (before.get(el) ?? 0) - el.getBoundingClientRect().top;
                        el.style.transition = 'none';
                        el.style.transform = delta ? `translateY(${delta}px)` : '';
                    });
                    void box?.offsetHeight;
                    siblings.forEach((el) => {
                        el.style.transition = 'transform .18s ease';
                        el.style.transform = '';
                    });
                    row.style.transition = 'transform .18s ease';
                    row.style.transform = '';
                    saveList(section === 'add' ? CMD_ADD_KEY : CMD_CMD_KEY, ordered.map((el) => rowNameOf(el)).filter(Boolean));
                    debugLog('drag committed', ordered.map((el) => rowNameOf(el)));
                    menuDragState = null;
                };
                const onCancel = () => {
                    if (settled) return;
                    settled = true;
                    detach();
                    resetVisual();
                    debugLog('drag cancelled');
                };
                const onLost = () => {
                    // 把手/行被移除或捕获丢失：仍要复位状态，避免 menuDragState 卡死
                    onCancel();
                };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', onUp);
                handle.addEventListener('pointercancel', onCancel);
                handle.addEventListener('lostpointercapture', onLost);
            };

            const ensureMenuHandlesFor = (row) => {
                if (!row.querySelector('.cn-menu-drag-handle')) {
                    const handle = document.createElement('span');
                    handle.className = 'cn-menu-drag-handle';
                    handle.textContent = '⋮⋮';
                    handle.style.cssText = [
                        'position:absolute', 'left:3px', 'top:50%', 'transform:translateY(-50%)',
                        'opacity:0', 'transition:opacity .12s', 'color:#9aa3b5',
                        'font-size:12px', 'letter-spacing:-2px', 'cursor:grab',
                        'user-select:none', 'line-height:1',
                    ].join(';');
                    row.addEventListener('pointerenter', () => { handle.style.opacity = '1'; });
                    row.addEventListener('pointerleave', () => { if (!menuDragState) handle.style.opacity = '0'; });
                    row.insertBefore(handle, row.firstChild);
                }
                if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
            };

            const applyCommandOrderToMenu = () => {
                if (menuDragState) return;
                const listbox = listboxEl();
                if (!listbox) return;
                wireListbox(listbox);
                const rows = listboxRows();
                if (rows.length === 0) { debugLog('menu open but no option rows'); return; }
                if (hostDirectory === null && typeof lastSessionId === 'string' && lastSessionId !== '') {
                    // 菜单已开而目录未加载：先拉目录（完成后 observer 会再走一遍）
                    debugLog('menu open, directory missing — fetching');
                    ensureHostDirectory().catch(() => {});
                    return;
                }
                // 分区识别 + 把手注入（每次渲染后补齐）
                let currentSection = null;
                const sectionRowsMap = { add: [], commands: [] };
                for (const node of rows) {
                    if (node.getAttribute?.('role') === 'presentation') {
                        const text = (node.textContent ?? '').trim();
                        currentSection = SECTION_TITLES.add.includes(text) ? 'add'
                            : SECTION_TITLES.commands.includes(text) ? 'commands'
                            : null;
                        continue;
                    }
                    if (node.getAttribute?.('role') !== 'option') continue;
                    const name = rowNameOf(node);
                    if (name !== null && currentSection !== null) {
                        sectionRowsMap[currentSection].push({ row: node, name });
                        ensureMenuHandlesFor(node);
                    }
                }
                debugLog('menu pass', { add: sectionRowsMap.add.length, commands: sectionRowsMap.commands.length });
                // DOM 重排已废弃：顺序由包裹后的官方 candidates 原生返回，
                // React 自己按用户顺序渲染，不再与 React 抢 DOM。
            };

            let observerScheduled = false;
            const observer = new MutationObserver((records) => {
                if (observerScheduled) return;
                // 只响应菜单相关变更：输入框打字、tooltip 更新等不触发菜单扫描
                const relevant = records.some((record) => {
                    const target = record.target instanceof Element ? record.target : record.target?.parentElement;
                    return target !== undefined && target !== null && !!target.closest?.('[role="listbox"]');
                });
                if (!relevant) return;
                observerScheduled = true;
                requestAnimationFrame(() => {
                    observerScheduled = false;
                    try { applyCommandOrderToMenu(); } catch (error) { debugLog('apply failed:', error); }
                });
            });
            try {
                observer.observe(document.body, { childList: true, subtree: true });
            } catch { /* no DOM */ }

            /* ------------------------------------------------------------------ */
            /* 拖拽排序面板（技能 / 命令两标签，命令页镜像菜单两区）                 */
            /* ------------------------------------------------------------------ */
            const openSortDialog = async (initialTab) => {
                ensureStyles();
                if (document.getElementById(SORT_DIALOG_ID)) return;
                if (typeof lastSessionId !== 'string' || lastSessionId === '') {
                    if (lastCatalog.length === 0) {
                        throwOrLog('排序面板需要一个已打开的会话——请先进入任意会话再试。');
                        return;
                    }
                }
                const menu = await buildMenuRows();
                if (document.getElementById(SORT_DIALOG_ID)) return;


                const overlay = document.createElement('div');
                overlay.id = SORT_DIALOG_ID;
                overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
                const panel = document.createElement('div');
                panel.style.cssText = [
                    'width:min(560px,92vw)', 'max-height:80vh', 'display:flex', 'flex-direction:column',
                    'background:#232836', 'border:1px solid rgba(255,255,255,.14)', 'border-radius:14px',
                    'box-shadow:0 18px 60px rgba(0,0,0,.5)', 'overflow:hidden', 'color:#e8eaf0',
                ].join(';');

                const header = document.createElement('div');
                header.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.1)';
                const title = document.createElement('div');
                title.style.cssText = 'font-size:14px;font-weight:600;color:#fff';
                title.textContent = '调整顺序';
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:12px;color:#9aa3b5;margin-top:3px';
                hint.textContent = '抓住 ⋮⋮ 在分区内上下拖动；排在前面的在菜单中靠前。顺序保存在本机。';
                header.appendChild(title);
                header.appendChild(hint);

                const tabs = document.createElement('div');
                tabs.style.cssText = 'display:flex;gap:6px;padding:10px 14px 0';
                const list = document.createElement('div');
                list.style.cssText = 'flex:1;overflow:auto;padding:8px 10px;overscroll-behavior:contain';
                const footer = document.createElement('div');
                footer.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.1)';

                const rowStyle = [
                    'display:flex', 'align-items:center', 'gap:10px', 'padding:8px 10px', 'margin:4px 0',
                    'background:rgba(255,255,255,.05)', 'border:1px solid rgba(255,255,255,.09)',
                    'border-radius:9px', 'user-select:none', 'touch-action:none',
                ].join(';');
                const groupHeaderStyle = 'font-size:11.5px;color:#8f98ab;margin:10px 2px 2px';
                const tabStyle = (active) => [
                    'padding:6px 14px', 'border-radius:8px', 'font-size:12.5px', 'cursor:pointer', 'border:1px solid',
                    active ? 'background:#4c6ef5;border-color:#4c6ef5;color:#fff' : 'background:transparent;border-color:rgba(255,255,255,.16);color:#c8cede',
                ].join(';');

                let activeTab = initialTab === 'command' ? 'command' : 'skill';

                /**
                 * 可拖拽行：抓 ⋮⋮ 把手 → transform 跟手（含滚动补偿）+ 兄弟让位
                 * + FLIP 落位；pointercancel 回滚；lostpointercapture 兜底复位。
                 */
                const makeSortable = (listEl, scrollEl, row, onCommit) => {
                    const handle = row.querySelector('.cn-sort-handle');
                    if (!handle) return;
                    handle.addEventListener('pointerdown', (event) => {
                        if (event.button !== undefined && event.button !== 0) return;
                        event.preventDefault();
                        const rows = () => [...listEl.querySelectorAll('.cn-sort-row')];
                        const startIndex = rows().indexOf(row);
                        if (startIndex === -1) return;
                        const rowH = row.getBoundingClientRect().height
                            + parseFloat(getComputedStyle(row).marginTop || '0')
                            + parseFloat(getComputedStyle(row).marginBottom || '0');
                        const startY = event.clientY;
                        const startScroll = scrollEl?.scrollTop ?? 0;
                        let currentIndex = startIndex;
                        let settled = false;
                        try { handle.setPointerCapture(event.pointerId); } catch { /* lostpointercapture 兜底 */ }
                        row.classList.add('cn-dragging');

                        const detach = () => {
                            handle.removeEventListener('pointermove', move);
                            handle.removeEventListener('pointerup', onUp);
                            handle.removeEventListener('pointercancel', onCancel);
                            handle.removeEventListener('lostpointercapture', onLost);
                        };
                        const resetVisual = () => {
                            rows().forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
                            row.classList.remove('cn-dragging');
                        };
                        const move = (ev) => {
                            const dy = ev.clientY - startY + ((scrollEl?.scrollTop ?? 0) - startScroll);
                            row.style.transform = `translateY(${dy}px)`;
                            const lr = scrollEl?.getBoundingClientRect();
                            if (lr) {
                                if (ev.clientY < lr.top + 34) scrollEl.scrollTop -= 9;
                                else if (ev.clientY > lr.bottom - 34) scrollEl.scrollTop += 9;
                            }
                            const rect = row.getBoundingClientRect();
                            const center = rect.top + rect.height / 2;
                            let idx = 0;
                            rows().forEach((el) => {
                                if (el === row) return;
                                const r = el.getBoundingClientRect();
                                if (center > r.top + r.height / 2) idx++;
                            });
                            if (idx === currentIndex) return;
                            rows().forEach((el, i) => {
                                if (el === row) return;
                                let shift = 0;
                                if (idx > startIndex && i > startIndex && i <= idx) shift = -rowH;
                                else if (idx < startIndex && i >= idx && i < startIndex) shift = rowH;
                                el.style.transform = shift ? `translateY(${shift}px)` : '';
                            });
                            currentIndex = idx;
                        };
                        const onUp = () => {
                            if (settled) return;
                            settled = true;
                            detach();
                            const all = rows();
                            const before = new Map(all.map((el) => [el, el.getBoundingClientRect().top]));
                            const ordered = [...all];
                            const [moved] = ordered.splice(startIndex, 1);
                            ordered.splice(currentIndex, 0, moved);
                            ordered.forEach((el) => listEl.appendChild(el));
                            all.forEach((el) => {
                                const delta = (before.get(el) ?? 0) - el.getBoundingClientRect().top;
                                el.style.transition = 'none';
                                el.style.transform = delta ? `translateY(${delta}px)` : '';
                            });
                            void listEl.offsetHeight;
                            all.forEach((el) => {
                                el.style.transition = 'transform .18s ease';
                                el.style.transform = '';
                            });
                            onCommit(ordered.map((el) => el.dataset.entryId).filter(Boolean));
                        };
                        const onCancel = () => {
                            if (settled) return;
                            settled = true;
                            detach();
                            resetVisual();
                        };
                        const onLost = () => onCancel();
                        handle.addEventListener('pointermove', move);
                        handle.addEventListener('pointerup', onUp);
                        handle.addEventListener('pointercancel', onCancel);
                        handle.addEventListener('lostpointercapture', onLost);
                    });
                };

                const buildRow = (item, position) => {
                    const row = document.createElement('div');
                    row.className = 'cn-sort-row';
                    row.style.cssText = rowStyle;
                    row.dataset.entryId = item.id;
                    const handle = document.createElement('span');
                    handle.className = 'cn-sort-handle';
                    handle.textContent = '⋮⋮';
                    handle.style.cssText = 'color:#7d8698;font-size:13px;letter-spacing:-2px;flex:none;padding:0 2px';
                    const main = document.createElement('div');
                    main.style.cssText = 'flex:1;min-width:0';
                    const line1 = document.createElement('div');
                    line1.style.cssText = 'font-size:12.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                    line1.textContent = `${position + 1}. ${item.title}`;
                    const line2 = document.createElement('div');
                    line2.style.cssText = 'font-size:11px;color:#8f98ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
                    line2.textContent = item.detail || item.id;
                    main.appendChild(line1);
                    main.appendChild(line2);
                    row.appendChild(handle);
                    row.appendChild(main);
                    return row;
                };

                const renderSkillTab = () => {
                    const commit = (ids) => saveList(SKILL_ORDER_KEY, ids);
                    const order = loadList(SKILL_ORDER_KEY);
                    const index = new Map(order.map((n, i) => [n, i]));
                    const items = [...lastCatalog]
                        .map((skill, i) => {
                            const cn = titleOf(skill);
                            return {
                                id: skill.name ?? '',
                                title: cn ? cn.title : (skill.name ?? ''),
                                detail: cn ? cn.rest : (skill.description ?? ''),
                                i,
                                at: index.get(skill.name) ?? Number.MAX_SAFE_INTEGER,
                            };
                        })
                        .sort((a, b) => (a.at - b.at) || (a.i - b.i));
                    list.textContent = '';
                    items.forEach((item, position) => {
                        const row = buildRow(item, position);
                        makeSortable(list, list, row, commit);
                        list.appendChild(row);
                    });
                };

                const renderCommandTab = () => {
                    list.textContent = '';
                    // 每个分区一个独立容器：拖拽换位天然限定在分区内；滚动容器是外层 list
                    const box = (sectionTitle, entries, key, afterCommit) => {
                        const head = document.createElement('div');
                        head.style.cssText = groupHeaderStyle;
                        head.textContent = sectionTitle;
                        list.appendChild(head);
                        const boxList = document.createElement('div');
                        boxList.style.cssText = 'min-height:12px';
                        list.appendChild(boxList);
                        const commit = (ids) => {
                            saveList(key, ids);
                            afterCommit?.();
                        };
                        const order = loadList(key);
                        const index = new Map(order.map((n, i) => [n, i]));
                        const items = entries
                            .map((r, i) => ({
                                id: r.name,
                                title: r.label ?? r.name,
                                detail: r.description ?? '',
                                i,
                                at: index.get(r.name) ?? Number.MAX_SAFE_INTEGER,
                            }))
                            .sort((a, b) => (a.at - b.at) || (a.i - b.i));
                        if (items.length === 0) {
                            const empty = document.createElement('div');
                            empty.style.cssText = 'padding:10px 4px;color:#8f98ab;font-size:11.5px';
                            empty.textContent = '（此分区暂无命令）';
                            boxList.appendChild(empty);
                            return;
                        }
                        items.forEach((item, position) => {
                            const row = buildRow(item, position);
                            makeSortable(boxList, list, row, commit);
                            boxList.appendChild(row);
                        });
                    };
                    box('添加（无输入参数的命令）', menu.addRows, CMD_ADD_KEY);
                    box('指令', menu.cmdRows, CMD_CMD_KEY, () => applyCommandOrderToMenu());
                };

                let renderList = () => {};
                const renderTab = () => { renderList = activeTab === 'skill' ? renderSkillTab : renderCommandTab; renderList(); };
                const buildTabs = () => {
                    tabs.textContent = '';
                    for (const [key, labelText] of [['skill', '技能'], ['command', '命令']]) {
                        const button = document.createElement('button');
                        button.style.cssText = tabStyle(activeTab === key);
                        button.textContent = labelText;
                        button.addEventListener('click', () => {
                            activeTab = key;
                            buildTabs();
                            renderTab();
                        });
                        tabs.appendChild(button);
                    }
                };

                const reset = document.createElement('button');
                reset.textContent = '恢复默认顺序';
                reset.style.cssText = 'padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#c8cede;font-size:12px;cursor:pointer';
                reset.addEventListener('click', () => {
                    if (activeTab === 'skill') { saveList(SKILL_ORDER_KEY, []); renderTab(); }
                    else {
                        saveList(CMD_ADD_KEY, []);
                        saveList(CMD_CMD_KEY, []);
                        renderTab();
                        applyCommandOrderToMenu();
                    }
                });
                const close = document.createElement('button');
                close.textContent = '完成';
                close.style.cssText = 'padding:6px 16px;border-radius:8px;border:none;background:#4c6ef5;color:#fff;font-size:12px;cursor:pointer';
                close.addEventListener('click', () => overlay.remove());
                overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
                footer.appendChild(reset);
                footer.appendChild(close);

                panel.appendChild(header);
                panel.appendChild(tabs);
                panel.appendChild(list);
                panel.appendChild(footer);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);
                buildTabs();
                renderTab();
            };

            const throwOrLog = (message) => {
                try { ctx.logger?.warn?.(`dsh-cn-skill-picker: ${message}`); } catch { /* 无 logger */ }
            };

            // 包裹官方命令源：candidates 返回前按用户顺序重排（核心机制）。
            // 本 bundle 排在组合尾部，通常首试即中；重试兜底组合顺序变化。
            const wrapWithRetries = () => {
                if (wrapCommandSource()) return;
                let tries = 0;
                const timer = setInterval(() => {
                    tries += 1;
                    if (wrapCommandSource() || tries >= 10) clearInterval(timer);
                }, 400);
            };
            wrapWithRetries();

            /* ------------------------------------------------------------------ */
            /* 「+」面板命令贡献                                                   */
            /* ------------------------------------------------------------------ */
            const insertIntoComposer = (text) => {
                // DSH 输入框是 Lexical 编辑器：带 data-composer-input 标记的 contenteditable div
                const composer = document.querySelector('[data-composer-input]');
                if (composer) {
                    composer.focus();
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(composer);
                    range.collapse(false); // 光标移到末尾
                    selection.removeAllRanges();
                    selection.addRange(range);
                    // execCommand('insertText') 会派发 beforeinput，Lexical 由此接管
                    const ok = document.execCommand('insertText', false, text);
                    debugLog('lexical insertText:', ok);
                    return true;
                }
                // 通用兜底：textarea / contenteditable / 文本输入框（取视口最底部的可见者）
                const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
                    .filter((el) => {
                        const r = el.getBoundingClientRect();
                        return r.width > 40 && r.height > 10;
                    });
                const fallback = candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
                if (!fallback) return false;
                fallback.focus();
                if (fallback.isContentEditable) {
                    document.execCommand('insertText', false, text);
                    return true;
                }
                const proto = fallback instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                const start = fallback.selectionStart ?? fallback.value.length;
                const end = fallback.selectionEnd ?? start;
                const next = fallback.value.slice(0, start) + text + fallback.value.slice(end);
                if (setter) setter.call(fallback, next);
                else fallback.value = next;
                fallback.dispatchEvent(new Event('input', { bubbles: true }));
                const caret = start + text.length;
                try { fallback.setSelectionRange(caret, caret); } catch { /* detached */ }
                return true;
            };

            ctx.effect(() => {
                let icon;
                try {
                    const ui = require('@deepseek-ai/dsh-client-ui-primitives');
                    icon = ui.IconDataOutlineRegular
                        ?? Object.values(ui).find((v) => typeof v === 'function' && /^Icon[A-Z]/.test(v.name ?? ''));
                } catch { icon = undefined; }

                const dispose = commandUi.register({
                    name: 'skill',
                    label: () => '技能',
                    description: () => '选择技能并插入引用（中文列表，可搜索）',
                    icon,
                    available: (session) => !inSubagent(session),
                    ui: {
                        kind: 'popupSelect',
                        searchMode: 'fuzzy-label',
                        searchLabels: () => ({
                            placeholder: '搜索技能（支持中文）',
                            empty: '当前会话没有可见技能',
                            noResults: '没有匹配的技能',
                        }),
                        options: async (session) => {
                            rememberSession(session.sessionId);
                            let list;
                            try {
                                list = await fetchCatalog(session.sessionId).promise;
                            } catch { return []; }
                            const rows = [];
                            for (const skill of list) {
                                const cn = titleOf(skill);
                                // 弹窗行同样写入悬浮详情映射：悬停行即可看完整简介
                                if (cn) detailMap.set(`${cn.title}（${skill.name}）`, { title: cn.title, full: cn.full, name: cn.name });
                                rows.push({
                                    id: skill.name,
                                    label: cn ? `${cn.title}（${skill.name}）` : (skill.name ?? ''),
                                    detail: cn ? (cn.rest || skill.description || '') : (skill.description ?? ''),
                                    group: groupOf(skill),
                                });
                            }
                            return applySavedOrder(rows, SKILL_ORDER_KEY);
                        },
                        onSelect: async (option) => {
                            const ok = insertIntoComposer(`/${option.id} `);
                            if (!ok) throw new Error('未找到输入框（textarea/contenteditable 均未命中）——请截图发作者排查');
                        },
                    },
                });
                return () => {
                    try { dispose?.(); } catch { /* already disposed */ }
                };
            }, 'cn-skill-picker: command contribution');

            ctx.effect(() => {
                let icon;
                try {
                    const ui = require('@deepseek-ai/dsh-client-ui-primitives');
                    icon = ui.IconDataOutlineRegular
                        ?? Object.values(ui).find((v) => typeof v === 'function' && /^Icon[A-Z]/.test(v.name ?? ''));
                } catch { icon = undefined; }

                const disposeSort = commandUi.register({
                    name: 'skill-sort',
                    label: () => '技能排序',
                    description: () => '拖拽整理技能在菜单中的顺序',
                    icon,
                    available: (session) => !inSubagent(session),
                    ui: {
                        kind: 'action',
                        run: (session) => {
                            rememberSession(session?.sessionId);
                            openSortDialog('skill').catch((error) => throwOrLog(String(error)));
                        },
                    },
                });
                const disposeCmdSort = commandUi.register({
                    name: 'command-sort',
                    label: () => '命令排序',
                    description: () => '拖拽整理命令菜单中的条目顺序（添加 / 指令两区）',
                    icon,
                    available: (session) => !inSubagent(session),
                    ui: {
                        kind: 'action',
                        run: (session) => {
                            rememberSession(session?.sessionId);
                            openSortDialog('command').catch((error) => throwOrLog(String(error)));
                        },
                    },
                });
                return () => {
                    try { disposeSort?.(); disposeCmdSort?.(); } catch { /* already disposed */ }
                };
            }, 'cn-skill-picker: sort actions');

            let offPreset;
            let offPlugin;
            try {
                offPreset = remoteSvc?.$on?.('agent-preset/selected', clearAll);
                offPlugin = remoteSvc?.$on?.('plugin-manager/changed', clearAll);
            } catch {
                /* remote events unavailable — cache lives until reload */
            }
            try {
                ctx.on?.('connection/reset', () => { clearAll(); hostDirectory = null; });
            } catch {
                /* connection events unavailable */
            }
            ctx.effect(() => {
                ensureStyles();
                const unregister = inputTriggers.registerSource(source);
                return () => {
                    unregister();
                    clearAll();
                    observer.disconnect();
                    try { offPreset?.(); offPlugin?.(); } catch { /* noop */ }
                    document.removeEventListener('pointerover', onPointerOver, true);
                    document.removeEventListener('pointerout', onLeave, true);
                    window.removeEventListener('scroll', onHideEvents, true);
                    window.removeEventListener('blur', onHideEvents);
                    document.getElementById(TOOLTIP_ID)?.remove();
                    document.getElementById(SORT_DIALOG_ID)?.remove();
                    document.getElementById(STYLE_ID)?.remove();
                };
            }, 'cn-skill-picker: source');
        }

        return { apply, inject };
    },
});
