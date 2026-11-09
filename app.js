/**
 * お弁当注文表 - メインアプリケーション (Firebase対応版)
 */

// ========================================
// 定数・初期データ
// ========================================

const STORAGE_KEY = 'bentoOrderData';
const SECRET_KEY = 'bento-secure-2026-xyz-789254bb'; // ← ここにFirebaseのルールと同じ合言葉を入れてください
const DB_PATH = `bentoData/${SECRET_KEY}`;

const DEFAULT_EMPLOYEES = [
    '横井', '横井②', '克也', '牛田', '西岡', '今枝', '滝沢',
    '村田', '大竹', '木村', '荒井', '藤野', '佐藤', '山本', '優花'
];

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日本の祝日を動的に計算する関数
 * (2027年以降も対応)
 */
function getHolidayName(dateStr) {
    const date = new Date(dateStr);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = date.getDay(); // 0: 日, 1: 月, ...

    // 第n月曜日を判定するための補助
    const nthMonday = Math.floor((d - 1) / 7) + 1;

    // 固定の祝日
    if (m === 1 && d === 1) return '元日';
    if (m === 2 && d === 11) return '建国記念の日';
    if (m === 2 && d === 23) return '天皇誕生日';
    if (m === 4 && d === 29) return '昭和の日';
    if (m === 5 && d === 3) return '憲法記念日';
    if (m === 5 && d === 4) return 'みどりの日';
    if (m === 5 && d === 5) return 'こどもの日';
    if (m === 8 && d === 11) return '山の日';
    if (m === 11 && d === 3) return '文化の日';
    if (m === 11 && d === 23) return '勤労感謝の日';

    // ハッピーマンデー (第n月曜日)
    if (m === 1 && nthMonday === 2 && w === 1) return '成人の日';
    if (m === 7 && nthMonday === 3 && w === 1) return '海の日';
    if (m === 9 && nthMonday === 3 && w === 1) return '敬老の日';
    if (m === 10 && nthMonday === 2 && w === 1) return 'スポーツの日';

    // 春分・秋分 (簡易計算式: 2099年まで有効)
    if (m === 3) {
        const shunbun = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
        if (d === shunbun) return '春分の日';
    }
    if (m === 9) {
        const shubun = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
        if (d === shubun) return '秋分の日';
    }

    // 振替休日の判定
    // 前日が日曜日かつ祝日の場合
    const yesterday = new Date(date);
    yesterday.setDate(d - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${(yesterday.getMonth() + 1).toString().padStart(2, '0')}-${yesterday.getDate().toString().padStart(2, '0')}`;
    const yesterdayName = getHolidayName(yesterdayStr);
    if (yesterdayName && yesterday.getDay() === 0) {
        // GWなどの連続祝日の場合の振替
        if (yesterdayName !== '振替休日') return '振替休日';
    }
    // 月曜・火曜が振替休日になるパターン (5/6など) の補助
    if (m === 5 && d === 6 && (w === 2 || w === 3)) {
        if (getHolidayName(`${y}-05-03`) && getHolidayName(`${y}-05-04`) && getHolidayName(`${y}-05-05`)) return '振替休日';
    }

    return null;
}

// ========================================
// アプリケーション状態
// ========================================

const RATE_DEFAULTS = {
    companyShare: 280,
    personalShare: 200,
    minoyaCompanyShare: 280,
    minoyaPersonalShare: 220,
};
const RATE_FIELDS = Object.keys(RATE_DEFAULTS);
const VERIFIED_CACHE = STORAGE_KEY + ':verified';
const PREVIOUS_CACHE = STORAGE_KEY + ':previous';
const VIEW_MONTH_KEY = STORAGE_KEY + ':viewMonth';
const ARCHIVE_PATH = 'bentoBackups/' + SECRET_KEY;
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 32_400_000;
const ARCHIVE_SLOTS = 31;
const MARKS = new Set(['circle', 'cross', 'special']);
const EDIT_CONTROLS = [
    ...RATE_FIELDS, 'addEmployeeBtn', 'manageEmployeesBtn', 'bulkOrderBtn', 'confirmAddEmployee',
    'confirmBulkCircle', 'confirmBulkCross', 'confirmBulkSpecial',
];

let appState = {
    employees: [...DEFAULT_EMPLOYEES],
    currentMonth: japanDate().slice(0, 7),
    ...RATE_DEFAULTS,
    orders: {},
};

let db;
let connected = false;
let syncStarted = false;
let liveState = null;
let displayedState = null;
let readProblem = '';
let editMessage = '';
let saving = false;
let isFooterExpanded = false;
let serverOffset = null;
let savedArchiveDay = null;
let archiveInProgress = false;
let lastArchiveAttempt = null;

function japanDate(ms = Date.now()) {
    return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function isMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
        Number(value.slice(0, 4)) >= 100;
}

function isEmployeeName(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 80 &&
        !/[.#$\[\]/\x00-\x1f\x7f]/.test(value);
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRoster(value) {
    let names;
    if (Array.isArray(value)) {
        names = value.filter(name => name !== null);
    } else if (isObject(value) && Object.keys(value).every(key => /^\d+$/.test(key))) {
        names = Object.values(value);
    } else {
        return null;
    }
    return names.length && names.every(isEmployeeName) && new Set(names).size === names.length ? names : null;
}

function isRate(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function readOrderState(value) {
    if (!isObject(value) || !isObject(value.orders)) return null;
    const employees = readRoster(value.employees);
    if (!employees || !isRate(value.companyShare) || !isRate(value.personalShare)) return null;
    if (RATE_FIELDS.some(field => Object.hasOwn(value, field) && !isRate(value[field]))) return null;

    let hasOrders = false;
    for (const [date, row] of Object.entries(value.orders)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isObject(row)) return null;
        for (const [employee, mark] of Object.entries(row)) {
            if (!isEmployeeName(employee) || !MARKS.has(mark)) return null;
            hasOrders = true;
        }
    }
    if (!hasOrders) return null;

    const state = { employees, orders: value.orders };
    for (const field of RATE_FIELDS) {
        if (Object.hasOwn(value, field)) state[field] = value[field];
    }
    if (isMonth(value.currentMonth)) state.currentMonth = value.currentMonth;
    return state;
}

function readLocal(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeLocal(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function readBackup(raw) {
    try {
        return readOrderState(JSON.parse(raw));
    } catch {
        return null;
    }
}

function rememberVerifiedState(state) {
    const next = JSON.stringify(state);
    const previous = readLocal(VERIFIED_CACHE);
    if (next === previous) return;
    if (readBackup(previous) && !writeLocal(PREVIOUS_CACHE, previous)) return;
    writeLocal(VERIFIED_CACHE, next);
}

function showState(state) {
    displayedState = state;
    appState.employees = state.employees;
    appState.orders = state.orders;
    for (const field of RATE_FIELDS) appState[field] = state[field] ?? RATE_DEFAULTS[field];
    renderAll();
    updateInputValues();
}

function onCloudValue(snapshot) {
    const state = readOrderState(snapshot.val());
    if (!state) {
        liveState = null;
        readProblem = '共有の注文データを確認できないため、入力を止めています。';
    } else {
        liveState = state;
        readProblem = '';
        showState(state);
        rememberVerifiedState(state);
        void saveDailyArchive();
    }
    showSyncStatus();
}

function onReadError() {
    liveState = null;
    readProblem = 'クラウドと同期できないため、入力を止めています。';
    showSyncStatus();
}

function canEdit() {
    return connected && liveState !== null && !saving;
}

function showSyncStatus() {
    let message = editMessage;
    if (saving) {
        message = connected ? '変更した項目を保存中です。' : '接続が切れました。再接続後に保存結果を確認します。';
    } else if (readProblem) {
        message = readProblem;
    } else if (!connected) {
        message = syncStarted ? 'クラウドへの接続を待っています。' : '最新の注文を確認中です。';
    } else if (!liveState) {
        message = '注文データを読み込み中です。';
    }
    if ((!connected || !liveState) && !saving && displayedState) {
        message += ' 今回サーバーから受信した注文を表示しています。';
    } else if (!displayedState) {
        message += ' 灰色の「—」は注文を確認中の欄です。';
    }
    updateTodayTotal();

    const notice = document.getElementById('syncNotice');
    notice.hidden = !message;
    notice.textContent = message;
    const status = document.getElementById('saveStatus');
    status.classList.toggle('saving', !canEdit());
    status.querySelector('.save-text').textContent = message ||
        (savedArchiveDay !== null && savedArchiveDay === archiveDay() ? 'クラウド同期済み・本日の控えあり' : 'クラウド同期済み');

    for (const id of EDIT_CONTROLS) document.getElementById(id).disabled = !canEdit();
    document.getElementById('orderTable').classList.toggle('read-only', !canEdit());
    document.getElementById('downloadBackupBtn').disabled = !displayedState;
}

function japanDayNumber(timestamp) {
    return Math.floor((timestamp + JST_OFFSET_MS) / DAY_MS);
}

function archiveDay() {
    return serverOffset === null ? null : japanDayNumber(Date.now() + serverOffset);
}

function archiveIsFromDay(snapshot, day) {
    const timestamp = snapshot.val();
    return typeof timestamp === 'number' && japanDayNumber(timestamp) === day;
}

async function saveDailyArchive() {
    const day = archiveDay();
    if (day === null || !connected || !liveState || archiveInProgress || day === savedArchiveDay) return;
    if (lastArchiveAttempt?.day === day && Date.now() - lastArchiveAttempt.at < 5 * 60_000) return;

    const stateToKeep = liveState;
    const archive = db.ref(ARCHIVE_PATH + '/' + (day % ARCHIVE_SLOTS));
    const timestamp = archive.child('createdAt');
    archiveInProgress = true;
    lastArchiveAttempt = { day, at: Date.now() };

    try {
        const existing = await timestamp.get();
        if (!archiveIsFromDay(existing, day)) {
            if (!connected || !liveState || day !== archiveDay()) return;
            await archive.set({ createdAt: firebase.database.ServerValue.TIMESTAMP, state: stateToKeep });
        }
        savedArchiveDay = day;
    } catch {
        // 別の端末が先に作成した場合も、控えを上書きしない。
        if (connected) {
            try {
                if (archiveIsFromDay(await timestamp.get(), day)) savedArchiveDay = day;
            } catch {
                // 次の接続や保存の機会に再試行する。
            }
        }
    } finally {
        archiveInProgress = false;
        showSyncStatus();
    }
}

function downloadBackup() {
    if (!displayedState) return;
    const state = { ...displayedState, currentMonth: appState.currentMonth };
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'お弁当注文表_控え_' + japanDate() + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveEdits(edits) {
    if (!canEdit() || !edits.length) return false;
    saving = true;
    editMessage = '';
    showSyncStatus();

    try {
        const results = await Promise.allSettled(edits.map(async ({ path, expected, next }) => {
            return db.ref(DB_PATH + '/' + path).transaction(current => {
                const unchanged = path === 'employees' ?
                    JSON.stringify(readRoster(current)) === JSON.stringify(expected) : current === expected;
                return unchanged ? next : undefined;
            }, undefined, false);
        }));
        const conflicts = results.filter(result => result.status === 'fulfilled' && !result.value.committed).length;
        const failures = results.filter(result => result.status === 'rejected').length;
        const completed = results.length - conflicts - failures;
        if (conflicts || failures) {
            const reason = failures ? '保存に失敗した項目があります。' : '別の端末の変更が先に保存されました。';
            editMessage = completed + '件を保存しました。' + reason + ' 表示を確認してから再入力してください。';
            updateInputValues();
            return false;
        }
        return true;
    } finally {
        saving = false;
        showSyncStatus();
    }
}

async function readOrdersForDisplay(viewAtStart) {
    if (typeof firebaseConfig === 'undefined' || !firebaseConfig.databaseURL) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
        const url = new URL('/' + DB_PATH + '.json', firebaseConfig.databaseURL);
        const response = await fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal,
        });
        if (!response.ok) return;
        const state = readOrderState(await response.json());
        // リアルタイム同期で先に表示が更新された場合は、その表示を使う。
        if (!state || displayedState !== viewAtStart) return;
        showState(state);
        rememberVerifiedState(state);
        showSyncStatus();
    } catch {
        // 通常の Firebase 同期で読み込みを続ける。
    } finally {
        clearTimeout(timer);
    }
}

function initializeOrderView() {
    const month = readLocal(VIEW_MONTH_KEY);
    if (isMonth(month)) appState.currentMonth = month;
    initializeEventListeners();

    renderAll();
    updateInputValues();
    showSyncStatus();

    // 毎回サーバーから読み取り、端末に保存した控えは表示に使わない。
    void readOrdersForDisplay(displayedState);
}

function startRealtimeSync() {
    if (typeof firebase === 'undefined' || typeof firebase.database !== 'function') {
        onReadError();
        return;
    }
    try {
        if (!firebase.apps.length) {
            if (typeof firebaseConfig === 'undefined' || firebaseConfig.apiKey === 'YOUR_API_KEY') {
                onReadError();
                return;
            }
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
        syncStarted = true;
        db.ref('.info/connected').on('value', snapshot => {
            connected = snapshot.val() === true;
            if (connected) void saveDailyArchive();
            showSyncStatus();
        });
        db.ref('.info/serverTimeOffset').on('value', snapshot => {
            const value = snapshot.val();
            if (typeof value === 'number' && Number.isFinite(value)) serverOffset = value;
            void saveDailyArchive();
        });
        db.ref(DB_PATH).on('value', onCloudValue, onReadError);
        setInterval(saveDailyArchive, 60_000);
        showSyncStatus();
    } catch {
        onReadError();
    }
}

// app.js は Firebase の SDK より先に実行される。注文の表示を SDK の準備から切り離す。
if (document.readyState === 'interactive') {
    initializeOrderView();
    document.addEventListener('DOMContentLoaded', startRealtimeSync, { once: true });
} else if (document.readyState === 'complete') {
    initializeOrderView();
    startRealtimeSync();
} else {
    document.addEventListener('DOMContentLoaded', () => {
        initializeOrderView();
        startRealtimeSync();
    }, { once: true });
}

function initializeEventListeners() {
    const listen = (id, event, handler) => document.getElementById(id).addEventListener(event, handler);

    listen('monthSelector', 'change', event => {
        if (!isMonth(event.target.value)) {
            event.target.value = appState.currentMonth;
            return;
        }
        appState.currentMonth = event.target.value;
        writeLocal(VIEW_MONTH_KEY, appState.currentMonth);
        renderAll();
    });

    for (const field of RATE_FIELDS) {
        listen(field, 'change', async event => {
            const value = event.target.valueAsNumber;
            const current = liveState?.[field] ?? null;
            if (!canEdit() || !isRate(value) || value === current) {
                event.target.value = appState[field];
                return;
            }
            if (!await saveEdits([{ path: field, expected: current, next: value }])) updateInputValues();
        });
    }

    listen('addEmployeeBtn', 'click', openAddEmployeeModal);
    listen('closeAddModal', 'click', closeAddEmployeeModal);
    listen('cancelAddEmployee', 'click', closeAddEmployeeModal);
    listen('confirmAddEmployee', 'click', addEmployee);
    listen('manageEmployeesBtn', 'click', openManageEmployeesModal);
    listen('closeManageModal', 'click', closeManageEmployeesModal);
    listen('closeManageEmployees', 'click', closeManageEmployeesModal);

    listen('bulkOrderBtn', 'click', openBulkOrderModal);
    listen('closeBulkModal', 'click', closeBulkOrderModal);
    listen('cancelBulkOrder', 'click', closeBulkOrderModal);
    listen('confirmBulkCircle', 'click', () => executeBulkOrder('circle'));
    listen('confirmBulkCross', 'click', () => executeBulkOrder('cross'));
    listen('confirmBulkSpecial', 'click', () => executeBulkOrder('special'));

    listen('downloadBackupBtn', 'click', downloadBackup);
}

function updateInputValues() {
    document.getElementById('monthSelector').value = appState.currentMonth;
    document.getElementById('companyShare').value = displayedState ? appState.companyShare : '';
    document.getElementById('personalShare').value = displayedState ? appState.personalShare : '';
    document.getElementById('minoyaCompanyShare').value = displayedState ? appState.minoyaCompanyShare : '';
    document.getElementById('minoyaPersonalShare').value = displayedState ? appState.minoyaPersonalShare : '';
}

// ========================================
// レンダリング (既存のロジックを流用)
// ========================================

function renderAll() {
    updatePeriodDisplay();
    updateTotalPrice();
    renderTable();
    updateTodayTotal();
}

function updatePeriodDisplay() {
    const dates = getDatesInMonth(appState.currentMonth);
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);

    const [year, month] = appState.currentMonth.split('-');
    const periodDisplay = document.getElementById('periodDisplay');

    // 期間の表示例: 2026年2月 (1/16 〜 2/15)
    const startStr = `${startDate.getUTCMonth() + 1}/${startDate.getUTCDate()}`;
    const endStr = `${endDate.getUTCMonth() + 1}/${endDate.getUTCDate()}`;
    periodDisplay.innerHTML = `${year}年${parseInt(month)}月 <br class="period-br">(${startStr} 〜 ${endStr})`;
}

function updateTotalPrice() {
    if (!displayedState) {
        document.getElementById('totalPrice').textContent = '—';
        document.getElementById('minoyaTotalPrice').textContent = '—';
        return;
    }
    const total = appState.companyShare + appState.personalShare;
    document.getElementById('totalPrice').textContent = total.toLocaleString();

    const minoyaTotal = (appState.minoyaCompanyShare || 0) + (appState.minoyaPersonalShare || 0);
    document.getElementById('minoyaTotalPrice').textContent = minoyaTotal.toLocaleString();
}

function renderTable() {
    renderTableHead();
    renderTableBody(getDatesInMonth(appState.currentMonth));
    if (displayedState) renderTableFoot();
    else document.getElementById('tableFoot').textContent = '';
}

function updateTodayTotal() {
    const banner = document.getElementById('todayTotalText');
    if (!displayedState) {
        banner.textContent = '本日の注文を確認中';
        return;
    }
    const row = appState.orders[japanDate()] ?? {};
    const total = Object.values(row).filter(status => status === 'circle' || status === 'special').length;
    banner.textContent = '本日は ' + total + ' 食です';
}

function renderTableHead() {
    const thead = document.getElementById('tableHead');
    let html = '<tr><th class="date-header">月/日</th>';
    appState.employees.forEach(emp => {
        html += `<th>${escapeHtml(emp)}</th>`;
    });
    html += '<th class="total-header">合計</th></tr>';
    thead.innerHTML = html;
}

function renderTableBody(dates) {
    const tbody = document.getElementById('tableBody');
    let html = '';
    const pendingMark = displayedState ? '' : '<span class="pending-order" aria-label="注文を確認中">—</span>';

    const todayStr = japanDate();

    dates.forEach(dateStr => {
        const date = new Date(dateStr);
        const dayOfWeek = date.getUTCDay();
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const isHoliday = getHolidayName(dateStr);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        const isToday = dateStr === todayStr;
        const isPast = dateStr < todayStr;

        let dayClass = '';
        if (dayOfWeek === 6) dayClass = 'saturday';
        if (dayOfWeek === 0 || isHoliday) dayClass = 'sunday'; // 祝日も赤色（sundayクラス）にする

        // 祝日や会社休日に合わせた色付け
        let rowClass = isWeekend ? 'weekend-row' : '';
        if (isToday) rowClass += ' today-row';

        html += `<tr class="${rowClass}">`;
        const holidayName = isHoliday ? `<span class="holiday-name">${isHoliday}</span>` : '';
        html += `<td class="date-cell">${month}/${day}${holidayName}<span class="day-name ${dayClass}">(${dayNames[dayOfWeek]})</span></td>`;

        let dailyTotal = 0;
        appState.employees.forEach(emp => {
            const status = getOrderStatus(dateStr, emp);
            let cellClass = 'order-cell';
            if (isWeekend) cellClass += ' disabled';
            if (isPast) cellClass += ' locked'; // 過去の日は操作不可
            if (status === 'circle') { cellClass += ' circle'; dailyTotal++; }
            else if (status === 'cross') { cellClass += ' cross'; }
            else if (status === 'special') { cellClass += ' special-mark'; }
            html += `<td class="${cellClass}" data-date="${dateStr}" data-employee="${escapeHtml(emp)}">${pendingMark}</td>`;
        });
        html += `<td class="total-cell">${pendingMark || (dailyTotal > 0 ? dailyTotal : '')}</td></tr>`;
    });
    tbody.innerHTML = html;
    tbody.querySelectorAll('.order-cell').forEach(cell => cell.addEventListener('click', handleCellClick));
}

function renderTableFoot() {
    const tfoot = document.getElementById('tableFoot');
    let html = '';

    // お弁当(食) - 常に表示
    html += '<tr><td class="label-cell">お弁当(食)</td>';
    let grandTotal = 0;
    appState.employees.forEach(emp => {
        const count = getEmployeeOrderCount(emp);
        grandTotal += count;
        html += `<td>${count > 0 ? count : ''}</td>`;
    });
    html += `<td class="total-cell">${grandTotal}</td></tr>`;

    // 詳細表示切り替えボタン行
    html += `<tr class="toggle-row"><td colspan="${appState.employees.length + 2}" onclick="toggleFooter()">`;
    html += `${isFooterExpanded ? '▲ 詳細を閉じる' : '▼ 集計詳細（金額・氏名）を表示'}`;
    html += '</td></tr>';

    if (isFooterExpanded) {
        // 会社負担(円)
        html += '<tr class="detail-row"><td class="label-cell">会社負担(円)</td>';
        appState.employees.forEach(emp => {
            const amount = getEmployeeOrderCount(emp) * appState.companyShare;
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(grandTotal * appState.companyShare).toLocaleString()}</td></tr>`;

        // 個人負担(円)
        html += '<tr class="detail-row"><td class="label-cell">個人負担(円)</td>';
        appState.employees.forEach(emp => {
            const amount = getEmployeeOrderCount(emp) * appState.personalShare;
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(grandTotal * appState.personalShare).toLocaleString()}</td></tr>`;

        // 合計(円)
        const rate = appState.companyShare + appState.personalShare;
        html += '<tr class="detail-row"><td class="label-cell">合計(円)</td>';
        appState.employees.forEach(emp => {
            const amount = getEmployeeOrderCount(emp) * rate;
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(grandTotal * rate).toLocaleString()}</td></tr>`;

        // 氏名行（下部）
        html += '<tr class="detail-row"><td class="label-cell">氏名</td>';
        appState.employees.forEach(emp => {
            html += `<td style="font-weight: 500; background: #fffbeb !important;">${escapeHtml(emp)}</td>`;
        });
        html += '<td class="total-cell">合計</td></tr>';

        // ミノヤ(食)
        html += '<tr class="detail-row"><td class="label-cell" style="color: #f97316;">ミノヤ(食)</td>';
        let specialTotalCount = 0;
        appState.employees.forEach(emp => {
            const count = getEmployeeSpecialCount(emp);
            specialTotalCount += count;
            html += `<td>${count > 0 ? count : ''}</td>`;
        });
        html += `<td class="total-cell">${specialTotalCount}</td></tr>`;

        // ミノヤ会社負担(円)
        html += '<tr class="detail-row"><td class="label-cell" style="color: #f97316;">ミノヤ会社負担(円)</td>';
        appState.employees.forEach(emp => {
            const count = getEmployeeSpecialCount(emp);
            const amount = count * (appState.minoyaCompanyShare || 0);
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(specialTotalCount * (appState.minoyaCompanyShare || 0)).toLocaleString()}</td></tr>`;

        // ミノヤ個人負担(円)
        html += '<tr class="detail-row"><td class="label-cell" style="color: #f97316;">ミノヤ個人負担(円)</td>';
        appState.employees.forEach(emp => {
            const count = getEmployeeSpecialCount(emp);
            const amount = count * (appState.minoyaPersonalShare || 0);
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(specialTotalCount * (appState.minoyaPersonalShare || 0)).toLocaleString()}</td></tr>`;

        // ミノヤ合計(円)
        const minoyaRate = (appState.minoyaCompanyShare || 0) + (appState.minoyaPersonalShare || 0);
        html += '<tr class="detail-row"><td class="label-cell" style="color: #f97316; font-weight: 700;">ミノヤ合計(円)</td>';
        appState.employees.forEach(emp => {
            const count = getEmployeeSpecialCount(emp);
            const amount = count * minoyaRate;
            html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell">${(specialTotalCount * minoyaRate).toLocaleString()}</td></tr>`;

        // 総合計 (通常 + ミノヤ)
        const regularRate = appState.companyShare + appState.personalShare;

        // 総合計：総額
        html += '<tr class="detail-row"><td class="label-cell" style="font-weight: 800; background: #dcfce7 !important; color: #16a34a;">総合計：総額(円)</td>';
        let grandGrandTotal = 0;
        appState.employees.forEach(emp => {
            const regCount = getEmployeeOrderCount(emp);
            const spCount = getEmployeeSpecialCount(emp);
            const amount = (regCount * regularRate) + (spCount * minoyaRate);
            grandGrandTotal += amount;
            html += `<td style="background: #dcfce7 !important; font-weight: 700;">${amount > 0 ? amount.toLocaleString() : ''}</td>`;
        });
        html += `<td class="total-cell" style="background: #bbf7d0 !important; color: #16a34a;">${grandGrandTotal.toLocaleString()}</td></tr>`;
    }

    tfoot.innerHTML = html;
}

function toggleFooter() {
    isFooterExpanded = !isFooterExpanded;
    renderTableFoot();
}

async function handleCellClick(event) {
    if (!canEdit()) return;
    const { date, employee } = event.currentTarget.dataset;
    if (!liveState.employees.includes(employee) || !isBusinessDay(date)) return;
    if (date < japanDate()) {
        alert('過去の注文は変更できません。');
        return;
    }
    const expected = getOrderStatus(date, employee);
    let next = null;
    if (expected === null) next = 'circle';
    else if (expected === 'circle') next = 'cross';
    else if (expected === 'cross' && employee === '大竹') next = 'special';

    await saveEdits([{ path: orderPath(date, employee), expected, next }]);
}

function isBusinessDay(date) {
    const day = new Date(date).getUTCDay();
    return day >= 1 && day <= 5 && !getHolidayName(date);
}

function orderPath(date, employee) {
    return 'orders/' + date + '/' + employee;
}

function getOrderStatus(date, employee) {
    const row = appState.orders[date];
    return row && Object.hasOwn(row, employee) ? row[employee] : null;
}

function getEmployeeOrderCount(emp) {
    const dates = getDatesInMonth(appState.currentMonth);
    let count = 0;
    dates.forEach(date => {
        const status = appState.orders[date] && appState.orders[date][emp];
        if (status === 'circle') count++;
    });
    return count;
}
function getEmployeeSpecialCount(emp) {
    const dates = getDatesInMonth(appState.currentMonth);
    let count = 0;
    dates.forEach(date => {
        const status = appState.orders[date] && appState.orders[date][emp];
        if (status === 'special') count++;
    });
    return count;
}

function openAddEmployeeModal() {
    if (canEdit()) document.getElementById('addEmployeeModal').classList.add('active');
}

function closeAddEmployeeModal() {
    document.getElementById('addEmployeeModal').classList.remove('active');
}

async function addEmployee() {
    if (!canEdit()) return;
    const field = document.getElementById('newEmployeeName');
    const names = field.value.split(/[\n,，]/).map(name => name.trim()).filter(Boolean);
    if (!names.length) return;
    if (!names.every(isEmployeeName)) {
        alert('社員名は80文字以内で、. # $ [ ] / を含まない名前を入力してください。');
        return;
    }
    const expected = liveState.employees;
    const next = [...new Set([...expected, ...names])];
    if (next.length === expected.length) {
        alert('入力された社員はすでに名簿にあります。');
        return;
    }
    if (await saveEdits([{ path: 'employees', expected, next }])) {
        field.value = '';
        closeAddEmployeeModal();
    }
}

function openManageEmployeesModal() {
    if (!canEdit()) return;
    const list = document.getElementById('employeeList');
    const items = appState.employees.map(name => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'employee-name';
        label.textContent = name;
        const button = document.createElement('button');
        button.className = 'btn btn-danger btn-sm';
        button.type = 'button';
        button.textContent = '名簿から外す';
        button.addEventListener('click', () => removeEmployee(name));
        row.append(label, button);
        return row;
    });
    list.replaceChildren(...items);
    document.getElementById('manageEmployeesModal').classList.add('active');
}

function closeManageEmployeesModal() {
    document.getElementById('manageEmployeesModal').classList.remove('active');
}

async function removeEmployee(name) {
    if (!canEdit()) return;
    const expected = liveState.employees;
    if (!expected.includes(name)) {
        openManageEmployeesModal();
        return;
    }
    if (expected.length === 1) {
        alert('名簿には1人以上必要です。');
        return;
    }
    if (!confirm(name + 'さんを名簿から外しますか？ 過去の注文記録は残ります。')) return;
    const next = expected.filter(employee => employee !== name);
    await saveEdits([{ path: 'employees', expected, next }]);
    openManageEmployeesModal();
}

function openBulkOrderModal() {
    if (!canEdit()) return;
    const select = document.getElementById('bulkEmployeeSelect');
    select.replaceChildren(...appState.employees.map(name => new Option(name, name)));
    document.getElementById('bulkOrderModal').classList.add('active');
}

function closeBulkOrderModal() {
    document.getElementById('bulkOrderModal').classList.remove('active');
}

async function executeBulkOrder(status) {
    if (!canEdit() || !MARKS.has(status)) return;
    const employee = document.getElementById('bulkEmployeeSelect').value;
    if (!liveState.employees.includes(employee)) return;
    if (status === 'special' && employee !== '大竹') {
        alert('「㋯」の一括入力は大竹さんのみ適用可能です。');
        return;
    }

    const today = japanDate();
    const edits = [];
    for (const date of getDatesInMonth(appState.currentMonth)) {
        if (date < today || !isBusinessDay(date)) continue;
        const expected = getOrderStatus(date, employee);
        if (expected !== status) edits.push({ path: orderPath(date, employee), expected, next: status });
    }
    if (!edits.length) {
        alert('この表示月に変更する営業日がありません。');
        return;
    }
    const mark = { circle: '◯', cross: '×', special: '㋯' }[status];
    if (!confirm(employee + 'さんの ' + edits.length + ' 日分を「' + mark + '」に変更しますか？')) return;
    closeBulkOrderModal();
    await saveEdits(edits);
}

function getDatesInMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    const d = [];

    // 15日締め: 前月16日 〜 当月15日
    // new Date(y, mo - 1, 15) は当月15日 (moは1-indexedなので、Dateの引数としてはmo-1が当月)
    // 前月16日は new Date(y, mo - 2, 16)
    const startDate = new Date(y, mo - 2, 16);
    const endDate = new Date(y, mo - 1, 15);

    let current = new Date(startDate);
    while (current <= endDate) {
        // YYYY-MM-DD 形式に変換
        const year = current.getFullYear();
        const month = (current.getMonth() + 1).toString().padStart(2, '0');
        const date = current.getDate().toString().padStart(2, '0');
        d.push(`${year}-${month}-${date}`);

        current.setDate(current.getDate() + 1);
    }
    return d;
}
function escapeHtml(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, character => entities[character]);
}
