import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

// Helper to handle CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle OPTIONS request for CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Initialize Supabase Client using Environment Variables set on Cloudflare
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_KEY;
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "MITSU_ADMIN_2026";

    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ status: 'error', message: 'Cloudflare configuration error: SUPABASE_URL or SUPABASE_KEY is missing' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // --- 1. SIGNUP ---
        if (path === '/api/signup' && request.method === 'POST') {
            const { firstName, lastName, email, password } = await request.json();
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const { data, error } = await supabase.from('users').insert([{
                email,
                first_name: firstName,
                last_name: lastName,
                full_name: `${firstName} ${lastName}`,
                password: hashedPassword
            }]);

            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success', message: 'Account created' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 2. LOGIN ---
        if (path === '/api/login' && request.method === 'POST') {
            const { email, password } = await request.json();
            const { data, error } = await supabase.from('users').select('*').eq('email', email).single();

            if (data && await bcrypt.compare(password, data.password)) {
                return new Response(JSON.stringify({ status: 'success', user: { email: data.email, fullName: data.full_name } }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({ status: 'error', message: 'Invalid credentials' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 3. UPDATE PASSWORD ---
        if (path === '/api/update-password' && request.method === 'POST') {
            const { email, oldPassword, newPassword } = await request.json();
            const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
            
            if (user && await bcrypt.compare(oldPassword, user.password)) {
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                const { error } = await supabase.from('users').update({ password: hashedPassword }).eq('email', email);
                if (error) {
                    return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                return new Response(JSON.stringify({ status: 'success', message: 'Password updated' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({ status: 'error', message: 'Incorrect old password' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // --- 4. MT5 STATS PUSH ---
        if (path === '/api/stats' && request.method === 'POST') {
            const data = await request.json();
            if (!data || !data.email) {
                return new Response('Invalid data', { status: 400 });
            }

            // Auto-create user if not exists
            const { data: userExists } = await supabase.from('users').select('email').eq('email', data.email).single();
            if (!userExists) {
                const defaultHashed = await bcrypt.hash("change_me_123", 10);
                await supabase.from('users').insert([{
                    email: data.email,
                    full_name: data.name || "MT5 User",
                    password: defaultHashed
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

            if (upsertError) {
                return new Response(JSON.stringify({ status: 'error', message: upsertError.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success', config }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 5. ADMIN ALL DATA ---
        if (path === '/api/admin/all-data' && request.method === 'GET') {
            const password = url.searchParams.get('password');
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }
            
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
            
            return new Response(JSON.stringify(results), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 6. ADMIN TOGGLE ACCOUNT ---
        if (path === '/api/admin/toggle-account' && request.method === 'POST') {
            const { password, account_id, enabled } = await request.json();
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }
            
            const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
            if (acc) {
                const newConfig = { ...acc.config, enabled };
                await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response('Not Found', { status: 404 });
            }
        }

        // --- 7. ADMIN DELETE USER ---
        if (path === '/api/admin/delete-user' && request.method === 'POST') {
            const { password, email } = await request.json();
            if (password !== ADMIN_PASSWORD) {
                return new Response('Forbidden', { status: 403 });
            }
            
            await supabase.from('accounts').delete().eq('email', email);
            const { error } = await supabase.from('users').delete().eq('email', email);
            if (error) {
                return new Response(JSON.stringify({ status: 'error', message: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ status: 'success' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 8. DASHBOARD DATA ---
        if (path === '/api/dashboard' && request.method === 'GET') {
            const email = url.searchParams.get('email');
            const { data: accounts } = await supabase.from('accounts').select('*').eq('email', email);
            
            const result = accounts.map(a => ({
                account_id: a.account_id, balance: a.balance, totalResult: a.total_result,
                winRate: a.win_rate, profitFactor: a.profit_factor, chartData: a.chart_data,
                history: a.history, config: a.config
            }));
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // --- 9. UPDATE CONFIG ---
        if (path === '/api/update-config' && request.method === 'POST') {
            const { email, account_id, config } = await request.json();
            const { data: acc } = await supabase.from('accounts').select('config').eq('account_id', account_id).single();
            
            if (acc) {
                const newConfig = { ...acc.config, ...config };
                await supabase.from('accounts').update({ config: newConfig }).eq('account_id', account_id);
                return new Response(JSON.stringify({ status: 'success' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response('Not Found', { status: 404 });
            }
        }

        // 404 Default
        return new Response('Not Found', { status: 404 });

    } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
