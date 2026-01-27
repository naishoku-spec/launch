/**
 * お弁当注文表 - メインアプリケーション (Firebase対応版)
 */

// ========================================
// 定数・初期データ
// ========================================

const STORAGE_KEY = 'bentoOrderData';

const DEFAULT_EMPLOYEES = [
    '横井', '横井②', '克也', '牛田', '西岡', '今枝', '滝沢',
    '村田', '大竹', '木村', '荒井', '藤野', '佐藤', '山本', '優花'
];

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ========================================
// アプリケーション状態
// ========================================

let appState = {
    employees: [...DEFAULT_EMPLOYEES],
    currentMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
    companyShare: 280,
    personalShare: 200,
    orders: {} // { 'YYYY-MM-DD': { '社員名': 'circle' | 'cross' | null } }
};

let db = null;
let isFirebaseEnabled = false;

// ========================================
// 初期化
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Firebaseが初期化されているか確認
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        db = firebase.database();
        isFirebaseEnabled = true;
        console.log("Firebase is enabled.");

        // クラウドからデータをリアルタイム取得
        const dataRef = db.ref('bentoData');
        dataRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                appState = { ...appState, ...data };
                renderAll();
                updateInputValues();
            } else {
                // 初回アクセス時などはローカルデータをアップロード
                loadLocalDataAndSync();
            }
        });
    } else {
        console.warn("Firebase is not configured. Using local storage only.");
        loadLocalDataAndSync();
    }

    initializeEventListeners();
});

// ========================================
// データ管理
// ========================================

function loadLocalDataAndSync() {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            appState = { ...appState, ...parsed };

            // 名前の移行処理 (荒野 -> 荒井、木井の削除)
            migrateEmployeeNames();

            if (isFirebaseEnabled) {
                saveData(); // Firebaseに同期
            }
        } catch (e) {
            console.error('データの読み込みに失敗しました:', e);
        }
    }
    renderAll();
    updateInputValues();
}

function migrateEmployeeNames() {
    let changed = false;
    // 荒野 -> 荒井
    const araiIndex = appState.employees.indexOf('荒野');
    if (araiIndex !== -1) {
        appState.employees[araiIndex] = '荒井';
        Object.keys(appState.orders).forEach(date => {
            if (appState.orders[date]['荒野']) {
                appState.orders[date]['荒井'] = appState.orders[date]['荒野'];
                delete appState.orders[date]['荒野'];
            }
        });
        changed = true;
    }
    // 木井削除
    const kiiIndex = appState.employees.indexOf('木井');
    if (kiiIndex !== -1) {
        appState.employees.splice(kiiIndex, 1);
        Object.keys(appState.orders).forEach(date => {
            if (appState.orders[date]['木井']) delete appState.orders[date]['木井'];
        });
        changed = true;
    }
    return changed;
}

function saveData() {
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.classList.add('saving');
    saveStatus.querySelector('.save-text').textContent = '保存中...';

    // ローカルにも予備保存
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));

    if (isFirebaseEnabled) {
        // Firebaseに保存
        db.ref('bentoData').set(appState)
            .then(() => {
                showSavedStatus();
            })
            .catch((error) => {
                console.error("Firebase save failed:", error);
                saveStatus.querySelector('.save-text').textContent = '保存エラー';
            });
    } else {
        setTimeout(showSavedStatus, 300);
    }
}

function showSavedStatus() {
    const saveStatus = document.getElementById('saveStatus');
    saveStatus.classList.remove('saving');
    saveStatus.querySelector('.save-text').textContent = isFirebaseEnabled ? 'クラウド同期済み' : '自動保存済み(ローカル)';
}

// ========================================
// イベントリスナー
// ========================================

function initializeEventListeners() {
    // 月選択
    const monthSelector = document.getElementById('monthSelector');
    monthSelector.addEventListener('change', (e) => {
        appState.currentMonth = e.target.value;
        saveData();
        renderTable();
        updatePeriodDisplay();
    });

    // 金額入力
    const companyShare = document.getElementById('companyShare');
    const personalShare = document.getElementById('personalShare');

    companyShare.addEventListener('input', (e) => {
        appState.companyShare = parseInt(e.target.value) || 0;
        updateTotalPrice();
        saveData();
    });

    personalShare.addEventListener('input', (e) => {
        appState.personalShare = parseInt(e.target.value) || 0;
        updateTotalPrice();
        saveData();
    });

    // 社員管理ボタンなど
    document.getElementById('addEmployeeBtn').addEventListener('click', openAddEmployeeModal);
    document.getElementById('closeAddModal').addEventListener('click', closeAddEmployeeModal);
    document.getElementById('cancelAddEmployee').addEventListener('click', closeAddEmployeeModal);
    document.getElementById('confirmAddEmployee').addEventListener('click', addEmployee);
    document.getElementById('manageEmployeesBtn').addEventListener('click', openManageEmployeesModal);
    document.getElementById('closeManageModal').addEventListener('click', closeManageEmployeesModal);
    document.getElementById('closeManageEmployees').addEventListener('click', closeManageEmployeesModal);
}

function updateInputValues() {
    document.getElementById('monthSelector').value = appState.currentMonth;
    document.getElementById('companyShare').value = appState.companyShare;
    document.getElementById('personalShare').value = appState.personalShare;
}

// ========================================
// レンダリング (既存のロジックを流用)
// ========================================

function renderAll() {
    updatePeriodDisplay();
    updateTotalPrice();
    renderTable();
}

function updatePeriodDisplay() {
    const dates = getDatesInMonth(appState.currentMonth);
    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);

    const [year, month] = appState.currentMonth.split('-');
    const periodDisplay = document.getElementById('periodDisplay');

    // 期間の表示例: 2026年2月 (1/16 〜 2/15)
    const startStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
    const endStr = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
    periodDisplay.textContent = `${year}年${parseInt(month)}月 (${startStr} 〜 ${endStr})`;
}

function updateTotalPrice() {
    const total = appState.companyShare + appState.personalShare;
    document.getElementById('totalPrice').textContent = total.toLocaleString();
}

function renderTable() {
    const dates = getDatesInMonth(appState.currentMonth);
    renderTableHead();
    renderTableBody(dates);
    renderTableFoot();
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
    dates.forEach(dateStr => {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay();
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const month = date.getMonth() + 1;
        const day = date.getDate();
        let dayClass = dayOfWeek === 6 ? 'saturday' : (dayOfWeek === 0 ? 'sunday' : '');

        html += `<tr class="${isWeekend ? 'weekend-row' : ''}">`;
        html += `<td class="date-cell">${month}/${day}<span class="day-name ${dayClass}">(${dayNames[dayOfWeek]})</span></td>`;

        let dailyTotal = 0;
        appState.employees.forEach(emp => {
            const status = getOrderStatus(dateStr, emp);
            let cellClass = 'order-cell';
            if (status === 'circle') { cellClass += ' circle'; dailyTotal++; }
            else if (status === 'cross') { cellClass += ' cross'; }
            html += `<td class="${cellClass}" data-date="${dateStr}" data-employee="${escapeHtml(emp)}"></td>`;
        });
        html += `<td class="total-cell">${dailyTotal > 0 ? dailyTotal : ''}</td></tr>`;
    });
    tbody.innerHTML = html;
    tbody.querySelectorAll('.order-cell').forEach(cell => cell.addEventListener('click', handleCellClick));
}

function renderTableFoot() {
    const tfoot = document.getElementById('tableFoot');
    let html = '';

    // お弁当(食)
    html += '<tr><td class="label-cell">お弁当(食)</td>';
    let grandTotal = 0;
    appState.employees.forEach(emp => {
        const count = getEmployeeOrderCount(emp);
        grandTotal += count;
        html += `<td>${count > 0 ? count : ''}</td>`;
    });
    html += `<td class="total-cell">${grandTotal}</td></tr>`;

    // 会社負担(円)
    html += '<tr><td class="label-cell">会社負担(円)</td>';
    appState.employees.forEach(emp => {
        const amount = getEmployeeOrderCount(emp) * appState.companyShare;
        html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
    });
    html += `<td class="total-cell">${(grandTotal * appState.companyShare).toLocaleString()}</td></tr>`;

    // 個人負担(円)
    html += '<tr><td class="label-cell">個人負担(円)</td>';
    appState.employees.forEach(emp => {
        const amount = getEmployeeOrderCount(emp) * appState.personalShare;
        html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
    });
    html += `<td class="total-cell">${(grandTotal * appState.personalShare).toLocaleString()}</td></tr>`;

    // 合計(円)
    const rate = appState.companyShare + appState.personalShare;
    html += '<tr><td class="label-cell">合計(円)</td>';
    appState.employees.forEach(emp => {
        const amount = getEmployeeOrderCount(emp) * rate;
        html += `<td>${amount > 0 ? amount.toLocaleString() : ''}</td>`;
    });
    html += `<td class="total-cell">${(grandTotal * rate).toLocaleString()}</td></tr>`;

    tfoot.innerHTML = html;
}

function handleCellClick(e) {
    const cell = e.target;
    const dateStr = cell.dataset.date;
    const employee = cell.dataset.employee;
    const current = getOrderStatus(dateStr, employee);
    let next = current === null ? 'circle' : (current === 'circle' ? 'cross' : null);
    setOrderStatus(dateStr, employee, next);
    saveData(); // Firebaseに送信
}

function getOrderStatus(date, emp) { return (appState.orders[date] && appState.orders[date][emp]) || null; }
function setOrderStatus(date, emp, status) {
    if (!appState.orders[date]) appState.orders[date] = {};
    if (status) appState.orders[date][emp] = status;
    else delete appState.orders[date][emp];
}
function getEmployeeOrderCount(emp) {
    const dates = getDatesInMonth(appState.currentMonth);
    let count = 0;
    dates.forEach(date => {
        if (appState.orders[date] && appState.orders[date][emp] === 'circle') count++;
    });
    return count;
}

// モーダル処理用 (addEmployee, deleteEmployee 等は既存と同様に appState を更新して saveData() を呼ぶ)
function openAddEmployeeModal() { document.getElementById('addEmployeeModal').classList.add('active'); }
function closeAddEmployeeModal() { document.getElementById('addEmployeeModal').classList.remove('active'); }
function addEmployee() {
    const name = document.getElementById('newEmployeeName').value.trim();
    if (name && !appState.employees.includes(name)) {
        appState.employees.push(name);
        saveData();
        closeAddEmployeeModal();
    }
}
function openManageEmployeesModal() {
    const list = document.getElementById('employeeList');
    list.innerHTML = appState.employees.map((emp, i) => `<li>${escapeHtml(emp)} <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${i})">削除</button></li>`).join('');
    document.getElementById('manageEmployeesModal').classList.add('active');
}
function closeManageEmployeesModal() { document.getElementById('manageEmployeesModal').classList.remove('active'); }
function deleteEmployee(i) {
    if (confirm('削除しますか？')) {
        appState.employees.splice(i, 1);
        saveData();
        openManageEmployeesModal();
    }
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
function escapeHtml(s) { const t = document.createElement('div'); t.textContent = s; return t.innerHTML; }
