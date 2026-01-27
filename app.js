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

let appState = {
    employees: [...DEFAULT_EMPLOYEES],
    currentMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
    companyShare: 280,
    personalShare: 200,
    orders: {} // { 'YYYY-MM-DD': { '社員名': 'circle' | 'cross' | null } }
};

let db = null;
let isFirebaseEnabled = false;
let isFooterExpanded = false; // 集計詳細の開閉状態

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

    // 一括入力ボタンの開閉
    document.getElementById('bulkOrderBtn').addEventListener('click', openBulkOrderModal);
    document.getElementById('closeBulkModal').addEventListener('click', closeBulkOrderModal);
    document.getElementById('cancelBulkOrder').addEventListener('click', closeBulkOrderModal);

    document.getElementById('confirmBulkCircle').addEventListener('click', () => executeBulkOrder('circle'));
    document.getElementById('confirmBulkCross').addEventListener('click', () => executeBulkOrder('cross'));

    // データ整理関連
    document.getElementById('deleteOldDataBtn').addEventListener('click', executeDeleteOldData);
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
        const isHoliday = getHolidayName(dateStr);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday;
        const month = date.getMonth() + 1;
        const day = date.getDate();

        let dayClass = '';
        if (dayOfWeek === 6) dayClass = 'saturday';
        if (dayOfWeek === 0 || isHoliday) dayClass = 'sunday'; // 祝日も赤色（sundayクラス）にする

        // 祝日や会社休日に合わせた色付け（土日の背景色）
        html += `<tr class="${isWeekend ? 'weekend-row' : ''}">`;
        const holidayName = isHoliday ? `<span class="holiday-name">${isHoliday}</span>` : '';
        html += `<td class="date-cell">${month}/${day}${holidayName}<span class="day-name ${dayClass}">(${dayNames[dayOfWeek]})</span></td>`;

        // 今日の日付 (YYYY-MM-DD)
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
        const isPast = dateStr < todayStr;

        let dailyTotal = 0;
        appState.employees.forEach(emp => {
            const status = getOrderStatus(dateStr, emp);
            let cellClass = 'order-cell';
            if (isWeekend) cellClass += ' disabled';
            if (isPast) cellClass += ' locked'; // 過去の日は操作不可
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
    }

    tfoot.innerHTML = html;
}

function toggleFooter() {
    isFooterExpanded = !isFooterExpanded;
    renderTableFoot();
}

function handleCellClick(e) {
    const cell = e.target;
    const dateStr = cell.dataset.date;
    const employee = cell.dataset.employee;

    // 土日・祝日はクリック無効
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const isHoliday = getHolidayName(dateStr);
    if (dayOfWeek === 0 || dayOfWeek === 6 || isHoliday) {
        return;
    }

    // 過去の日は変更不可
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    if (dateStr < todayStr) {
        alert('過去の注文は変更できません。');
        return;
    }

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
    list.innerHTML = appState.employees.map((emp, i) => `<li><span class="employee-name">${escapeHtml(emp)}</span> <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${i})">削除</button></li>`).join('');
    document.getElementById('manageEmployeesModal').classList.add('active');
}
function closeManageEmployeesModal() { document.getElementById('manageEmployeesModal').classList.remove('active'); }

// 一括入力モーダル処理
function openBulkOrderModal() {
    const select = document.getElementById('bulkEmployeeSelect');
    select.innerHTML = appState.employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('');
    document.getElementById('bulkOrderModal').classList.add('active');
}
function closeBulkOrderModal() { document.getElementById('bulkOrderModal').classList.remove('active'); }

function executeBulkOrder(status) {
    const employee = document.getElementById('bulkEmployeeSelect').value;
    if (!employee) return;

    const markName = status === 'circle' ? '◯' : '×';
    if (!confirm(`${employee} さんの今月の全営業分を「${markName}」に一括変更しますか？\n（すでに入力されている分は ${markName} で上書きされます）`)) return;

    const dates = getDatesInMonth(appState.currentMonth);
    dates.forEach(dateStr => {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay();
        const isHoliday = getHolidayName(dateStr);

        // 土日・祝日以外の営業日のみ更新
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday) {
            setOrderStatus(dateStr, employee, status);
        }
    });

    saveData();
    closeBulkOrderModal();
    renderAll();
}

function executeDeleteOldData() {
    const currentYear = new Date().getFullYear();
    const targetYear = currentYear - 1;

    if (!confirm(`${targetYear}年以前の全ての注文データを削除しますか？\n（この操作は取り消せません）`)) return;
    if (!confirm(`本当によろしいですか？\n${targetYear}年12月31日までのデータが全て消去されます。`)) return;

    let deleteCount = 0;
    Object.keys(appState.orders).forEach(dateStr => {
        const year = parseInt(dateStr.split('-')[0]);
        if (year <= targetYear) {
            delete appState.orders[dateStr];
            deleteCount++;
        }
    });

    if (deleteCount > 0) {
        saveData();
        renderAll();
        alert(`${deleteCount}件の過去データを削除しました。`);
    } else {
        alert('削除対象の古いデータは見つかりませんでした。');
    }
}

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
