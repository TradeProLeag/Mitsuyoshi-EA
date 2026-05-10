const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "MITSU_ADMIN_2026";

// Configuration Supabase (Variables à configurer sur Vercel)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
// Vérification des variables au démarrage
if (!supabaseUrl || !supabaseKey) {
    console.error("CRITICAL ERROR: SUPABASE_URL or SUPABASE_KEY is missing in environment variables!");
}
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// --- AUTH ENDPOINTS ---

app.post('/api/signup', async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data, error } = await supabase.from('users').insert([{
        email,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        password: hashedPassword
    }]);

    if (error) return res.status(400).json({ status: 'error', message: error.message });
    res.json({ status: 'success', message: 'Account created' });
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.from('users').select('*').eq('email', email).single();

    if (data && await bcrypt.compare(password, data.password)) {
        res.json({ status: 'success', user: { email: data.email, fullName: data.full_name } });
    } else {
        res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }
});

app.post('/api/update-password', async (req, res) => {
    const { email, oldPassword, newPassword } = req.body;
    
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    
    if (user && await bcrypt.compare(oldPassword, user.password)) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error } = await supabase.from('users').update({ password: hashedPassword }).eq('email', email);
        if (error) return res.status(500).json({ status: 'error', message: error.message });
        res.json({ status: 'success', message: 'Password updated' });
    } else {
        res.status(401).json({ status: 'error', message: 'Incorrect old password' });
    }
});

// --- EA DATA ENDPOINT ---

app.post('/api/stats', async (req, res) => {
    const data = req.body;
    if (!data || !data.email) return res.status(400).send('Invalid data');

    // Auto-create user if not exists
    const { data: userExists } = await supabase.from('users').select('email').eq('email', data.email).single();
    if (!userExists) {
        await supabase.from('users').insert([{
            email: data.email,
            full_name: data.name || "MT5 User",
            password: "change_me_123"
        }]);
    }

    // Process Stats
    const history = data.history || [];
    let totalProfit = 0, wins = 0, losses = 0, grossProfit = 0, grossLoss = 0, maxLoss = 0;
    history.forEach(trade => {
        const p = Number(trade.profit) || 0;
        totalProfit += p;
        if (p > 0) { wins++; grossProfit += p; }
        else if (p < 0) { losses++; grossLoss += Math.abs(p); if (Math.abs(p) > maxLoss) maxLoss = Math.abs(p); }
    });

    let dailyProfits = {};
    history.forEach(trade => {
        const dateKey = trade.date.split(' ')[0];
        if (!dailyProfits[dateKey]) dailyProfits[dateKey] = 0;
        dailyProfits[dateKey] += Number(trade.profit);
    });

    const sortedDays = Object.keys(dailyProfits).sort();
    let currentBal = Number(data.balance) || 0;
    let chartDataPoints = [{ x: 'Now', y: currentBal }];
    for (let i = sortedDays.length - 1; i >= 0; i--) {
        currentBal -= dailyProfits[sortedDays[i]];
        chartDataPoints.unshift({ x: sortedDays[i], y: currentBal });
        if (chartDataPoints.length >= 31) break;
    }

    const winRate = (wins + losses > 0) ? (wins / (wins + losses) * 100).toFixed(1) : 0;
    const profitFactor = (grossLoss > 0) ? (grossProfit / grossLoss).toFixed(2) : grossProfit.toFixed(2);

    const formattedHistory = [...history].reverse().slice(0, 100).map(h => ({
        id: h.id, date: h.date, duration: h.duration, type: h.type,
        symbol: h.symbol, size: h.size, isPositive: Number(h.profit) >= 0,
        resultStr: (Number(h.profit) >= 0 ? "+" : "") + "$" + Number(h.profit).toFixed(2)
    }));

    // Fetch existing config
    const { data: existingAcc } = await supabase.from('accounts').select('config').eq('account_id', data.account_id).single();
    const config = (existingAcc && existingAcc.config) ? existingAcc.config : { lot_multiplier: 1.0, enabled: true };

    // Upsert Account
    const { error: upsertError } = await supabase.from('accounts').upsert({
        account_id: String(data.account_id),
        email: data.email,
        balance: data.balance,
        equity: data.equity,
        broker: data.broker,
        server: data.server,
        currency: data.currency,
        leverage: data.leverage,
        win_rate: winRate + "%",
        profit_factor: String(profitFactor),
        total_result: totalProfit.toFixed(2),
        max_loss: "-$" + maxLoss.toFixed(2),
        chart_data: chartDataPoints,
        history: formattedHistory,
        config: config,
        last_update: new Date().toISOString()
    });

    if (upsertError) console.error("Upsert Error:", upsertError);
    res.status(200).json({ status: 'success', config });
});

// --- ADMIN ENDPOINTS ---

app.get('/api/admin/all-data', async (req, res) => {
    if (req.query.password !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
    
    const { data: users } = await supabase.from('users').select('*');
    const { data: accounts } = await supabase.from('accounts').select('*');
    
    let results = users.map(u => ({
        user: { email: u.email, fullName: u.full_name },
        accounts: accounts.filter(a => a.email === u.email).map(a => ({
            account_id: a.account_id, balance: a.balance, totalResult: a.total_result,
            winRate: a.win_rate, profitFactor: a.profit_factor, chartData: a.chart_data,
            history: a.history, config: a.config
        }))
    }));
    
    res.json(results);
});

app.post('/api/admin/toggle-account', async (req, res) => {
    const { password, account_id, enabled } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
    
    const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
    if (acc) {
        const newConfig = { ...acc.config, enabled };
        await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
        res.json({ status: 'success' });
    } else {
        res.status(404).send('Not Found');
    }
});

// --- DASHBOARD DATA ---

app.get('/api/dashboard', async (req, res) => {
    const email = req.query.email;
    const { data: accounts } = await supabase.from('accounts').select('*').eq('email', email);
    
    res.json(accounts.map(a => ({
        account_id: a.account_id, balance: a.balance, totalResult: a.total_result,
        winRate: a.win_rate, profitFactor: a.profit_factor, chartData: a.chart_data,
        history: a.history, config: a.config
    })));
});

app.post('/api/update-config', async (req, res) => {
    const { email, account_id, config } = req.body;
    const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
    
    if (acc) {
        const newConfig = { ...acc.config, ...config };
        await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
        res.json({ status: 'success' });
    } else {
        res.status(404).send('Not Found');
    }
});

// Export pour Vercel (Mode Serverless)
module.exports = app;

// Garder le listen uniquement pour le local (si lancé via node api_server.js)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`API Server running on port ${PORT}`));
}
