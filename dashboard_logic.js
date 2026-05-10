let currentUser = JSON.parse(localStorage.getItem('mitsu_user'));
let currentAccountId = null;
let loadedAccounts = {};
let currentChart = null;
let currentTimeframe = '1M';
let historyLimit = 15;

const API_URL = "/api";

// --- AUTH LOGIC ---

function switchAuth(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');
    document.getElementById('formLogin').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('formSignup').style.display = tab === 'signup' ? 'block' : 'none';
}

async function handleSignup() {
    const firstName = document.getElementById('signFirst').value;
    const lastName = document.getElementById('signLast').value;
    const email = document.getElementById('signEmail').value;
    const password = document.getElementById('signPass').value;

    try {
        const res = await fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, email, password })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Account created! You can now login.");
            switchAuth('login');
        } else {
            alert(data.message);
        }
    } catch (e) { alert("Server connection failed"); }
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPass').value;

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.status === 'success') {
            localStorage.setItem('mitsu_user', JSON.stringify(data.user));
            currentUser = data.user;
            initDashboard();
        } else {
            alert(data.message);
        }
    } catch (e) { alert("Login failed"); }
}

function logout() {
    localStorage.removeItem('mitsu_user');
    location.reload();
}

async function changePassword() {
    const oldPassword = document.getElementById('oldPass').value;
    const newPassword = document.getElementById('newPass').value;
    if(!oldPassword || !newPassword) return alert("Fill all fields");

    try {
        const res = await fetch(`${API_URL}/update-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, oldPassword, newPassword })
        });
        const data = await res.json();
        if(data.status === 'success') {
            alert("Password updated successfully!");
            document.getElementById('oldPass').value = "";
            document.getElementById('newPass').value = "";
        } else {
            alert(data.message);
        }
    } catch (e) { alert("Error updating password"); }
}

// --- DASHBOARD LOGIC ---

async function initDashboard() {
    if (!currentUser) {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('dashContent').style.display = 'none';
        return;
    }

    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('dashContent').style.display = 'block';
    document.getElementById('userName').textContent = currentUser.fullName;

    await loadData();
    // Periodic refresh
    setInterval(loadData, 10000);
}

async function loadData() {
    try {
        const res = await fetch(`${API_URL}/dashboard?email=${currentUser.email}`);
        const accounts = await res.json();
        
        if (accounts.length > 0) {
            accounts.forEach(acc => loadedAccounts[acc.account_id] = acc);
            if (!currentAccountId) currentAccountId = accounts[0].account_id;
            
            // Render Tabs
            const tabContainer = document.getElementById('accountTabs');
            if (accounts.length > 1) {
                tabContainer.innerHTML = accounts.map(acc => `
                    <button class="btn-timeframe ${acc.account_id === currentAccountId ? 'active' : ''}" 
                            onclick="switchAccount('${acc.account_id}')">
                        MT5 #${acc.account_id}
                    </button>
                `).join('');
            } else {
                tabContainer.innerHTML = `<span style="font-size: 11px; color: var(--theme); font-weight: 700;">ACTIVE TERMINAL: #${accounts[0].account_id}</span>`;
            }

            updateUI();
        }
    } catch (e) { console.error("Data fetch error", e); }
}

function switchAccount(id) {
    currentAccountId = id;
    updateUI();
    loadData(); // Refresh UI tabs
}

function updateUI() {
    const acc = loadedAccounts[currentAccountId];
    if (!acc) return;

    document.getElementById('statBalance').textContent = '$' + (parseFloat(acc.balance)||0).toLocaleString();
    document.getElementById('statProfit').textContent = (parseFloat(acc.totalResult)>=0?'+':'') + '$' + (parseFloat(acc.totalResult)||0).toLocaleString();
    document.getElementById('statWin').textContent = acc.winRate;
    document.getElementById('statPF').textContent = acc.profitFactor;
    document.getElementById('inputLotMult').value = acc.config.lot_multiplier;

    renderHistory(acc.history || []);
    updateTimeframe(currentTimeframe);
}

function renderHistory(history) {
    const list = document.getElementById('historyList');
    const items = history.slice(0, historyLimit);
    
    list.innerHTML = items.map(h => `
        <div class="table-row">
            <span style="color: var(--theme); font-weight: 700;">#${h.id}</span>
            <span>${h.date}</span>
            <span class="hide-mobile" style="color: var(--text-dim);">${h.duration}</span>
            <span style="color: ${h.type === 'BUY' ? '#00ff88' : '#ff4444'}; font-weight: 700;">${h.type}</span>
            <span style="font-weight: 600;">${h.symbol}</span>
            <b style="text-align: right;" class="${h.isPositive ? 'profit-plus' : 'profit-minus'}">${h.resultStr}</b>
        </div>
    `).join('');

    document.getElementById('btnLoadMore').style.display = (history.length > historyLimit) ? 'inline-block' : 'none';
}

function loadMore() {
    historyLimit += 20;
    updateUI();
}

function updateTimeframe(tf) {
    currentTimeframe = tf;
    document.querySelectorAll('.btn-timeframe').forEach(b => {
        b.classList.toggle('active', b.innerText === tf);
    });
    
    const acc = loadedAccounts[currentAccountId];
    if (acc) {
        const points = calculateChart(acc.history, acc.balance);
        renderChart(points);
    }
}

function calculateChart(history, finalBalance) {
    const now = new Date();
    let limitDate = new Date();
    let isHourly = false;

    if (currentTimeframe === '1D') { limitDate.setDate(now.getDate() - 1); isHourly = true; }
    else if (currentTimeframe === '1W') { limitDate.setDate(now.getDate() - 7); }
    else if (currentTimeframe === '1M') { limitDate.setDate(now.getDate() - 30); }
    else if (currentTimeframe === '3M') { limitDate.setDate(now.getDate() - 90); }

    const filtered = (history || []).filter(h => new Date(h.date.replace(/\./g, '/')) >= limitDate);

    let buckets = {};
    filtered.forEach(h => {
        const d = new Date(h.date.replace(/\./g, '/'));
        const key = isHourly ? `${d.getHours()}h` : `${d.getDate()}/${d.getMonth()+1}`;
        if (!buckets[key]) buckets[key] = 0;
        buckets[key] += parseFloat(h.resultStr.replace('$', '').replace('+', '')) || 0;
    });

    let current = finalBalance;
    let points = [{ x: 'Now', y: current }];
    const keys = Object.keys(buckets).sort((a,b) => {
        if (isHourly) return parseInt(b) - parseInt(a);
        return new Date(b.split('/').reverse().join('/')) - new Date(a.split('/').reverse().join('/'));
    });

    keys.forEach(k => {
        current -= buckets[k];
        points.unshift({ x: k, y: current });
    });
    return points;
}

function renderChart(points) {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    if(currentChart) currentChart.destroy();
    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: points.map(p => p.x),
            datasets: [{
                data: points.map(p => p.y), borderColor: '#D4AF37', borderWidth: 2, fill: true,
                backgroundColor: 'rgba(212, 175, 55, 0.05)', tension: 0.3, pointRadius: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
            scales: { y: { grid: { color: 'rgba(255,255,255,0.02)' } }, x: { grid: { display: false } } }
        }
    });
}

async function saveConfig() {
    const lot_multiplier = parseFloat(document.getElementById('inputLotMult').value);
    try {
        await fetch(`${API_URL}/update-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentUser.email, account_id: currentAccountId, config: { lot_multiplier } })
        });
        alert("Configuration saved!");
    } catch (e) { alert("Save failed"); }
}

// Initial Run
initDashboard();
