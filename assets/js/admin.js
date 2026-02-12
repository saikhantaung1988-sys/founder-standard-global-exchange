
(function () {
  'use strict';

  /* ----------------------------
     Default config (fallbacks)
     Replace these only if you want the key baked into the file.
     Prefer setting window.SUPABASE_URL / window.SUPABASE_ANON_KEY from HTML.
  ---------------------------- */
  const DEFAULT_SUPABASE_URL = window.SUPABASE_URL || "https://wanhwmcgvcmeqstkfukf.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indhbmh3bWNndmNtZXFzdGtmdWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NjgzODQsImV4cCI6MjA4NjA0NDM4NH0.jMVn9KRZ0U1XlgpzDrhcLAj55Dm9wK1V_XzfqBIkOrA";

  // Optional: if you create server endpoints for admin-only actions, configure here.
  const ADMIN_SERVER_ENDPOINT = window.ADMIN_SERVER_ENDPOINT || null; // e.g. "https://api.example.com/admin"

  /* ----------------------------
     Module state
  ---------------------------- */
  let supabaseClient = null;
  let adminSubscription = null;
  let currentChatUID = null;

  /* ----------------------------
     Helpers
  ---------------------------- */
  function safeEl(id) { return document.getElementById(id) || null; }
  function log(...args) { console.log('[admin]', ...args); }
  function warn(...args) { console.warn('[admin]', ...args); }
  function showToast(msg, type = 'info') { // minimal
    // Replace with a nicer toast if you add one
    console.log(`[${type}] ${msg}`);
  }

  function createSupabaseClientIfNeeded() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.supabase === 'undefined') {
      warn('window.supabase not found. Make sure supabase-js is loaded before admin.js');
      return null;
    }
    const url = window.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
    try {
      supabaseClient = window.supabase.createClient(url, key);
      return supabaseClient;
    } catch (e) {
      console.error('Failed to create supabase client', e);
      supabaseClient = null;
      return null;
    }
  }

function showTab(tabId, btnEl = null) {
  // hide all tabs
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tab = document.getElementById('tab-' + tabId);
  if (tab) tab.classList.add('active');
  if (btnEl) btnEl.classList.add('active');

  // side-effects per tab
  if (tabId === 'chat') {
    refreshChatUsers();
  }


}


  /* ----------------------------
     User lookup & balance
  ---------------------------- */
  async function checkUser() {
    try {
      const uid = (safeEl('targetUID')?.value || '').trim();
      if (!uid) return alert('Enter User UID');
      const db = createSupabaseClientIfNeeded();
      if (!db) return alert('DB client not available');

      const { data, error } = await db.from('users').select('*').eq('id', uid).single();
      if (error) return alert('DB Error: ' + error.message);
      if (!data) return alert('User Not Found');

      const username = data.content?.username ?? '—';
      const balance = Number(data.content?.balance ?? 0);
      alert(`User Found!\nName: ${username}\nBalance: $${balance}`);
    } catch (e) {
      console.error('checkUser', e);
      alert('Unexpected error in checkUser');
    }
  }

 async function adjustBalance(type = 'add') {
    try {
      const uid = (safeEl('targetUID')?.value || '').trim();
      const raw = safeEl('balanceValue')?.value;
      const amount = parseFloat(raw);
      if (!uid || isNaN(amount)) return alert('Fill UID and valid Amount');

      const db = createSupabaseClientIfNeeded();
      if (!db) return alert('DB client not available');

      // ၁။ User ရှိမရှိ အရင်စစ်မယ်
      const { data, error } = await db.from('users').select('*').eq('id', uid).single();
      if (error) return alert('User not found or DB Error');

      // ၂။ ငွေပမာဏ တွက်မယ်
      const oldBal = Number(data.content?.balance ?? 0);
      const newBal = type === 'add' ? oldBal + amount : oldBal - amount;

      // ၃။ Users table မှာ ပိုက်ဆံပြင်မယ်
      const { error: upErr } = await db.from('users').update({ content: { ...data.content, balance: newBal } }).eq('id', uid);
      if (upErr) return alert('DB update error: ' + upErr.message);

      // ၄။ (အသစ်ထည့်ထားသည်) History Table မှာ မှတ်တမ်းတင်မယ်
      await db.from('balance_history').insert([{
          uid: uid,
          amount: type === 'add' ? amount : -amount,
          transaction_type: 'admin_adjust', // deposit/withdraw မဟုတ်ဘဲ admin ပြင်တာမို့
          remark: 'Admin Panel မှ ပြုပြင်သည်'
      }]);

      alert(`Success! Updated Balance: $${newBal}`);
    } catch (e) {
      console.error('adjustBalance', e);
      alert('Unexpected error in adjustBalance');
    }
  }
/* ---------- Trading Control UI (NO DB - UI only) ---------- */

let globalTradeUI = { mode: null, percent: null };
let filteredUsers = {}; // { uid: { mode: 'win'|'lose', percent: number|null } }

// Global Mode ခလုတ်နှိပ်ရင် (Win/Lose)
  async function setGlobalMode(mode) {
    globalTradeUI.mode = mode;
    // UI အရောင်ပြောင်းမယ်
    document.getElementById('globalWinBtn')?.classList.toggle('btn-green', mode === 'win');
    document.getElementById('globalLoseBtn')?.classList.toggle('btn-red', mode === 'lose');
    document.getElementById('globalWinBtn')?.classList.toggle('active', mode === 'win'); // CSS အတွက်
    document.getElementById('globalLoseBtn')?.classList.toggle('active', mode === 'lose');
  }

  // Apply နှိပ်မှ Database ထဲထည့်မယ်
  async function applyGlobalTradeUI() {
    const percent = Number(document.getElementById('globalPercent')?.value);
    if (!globalTradeUI.mode) return alert("Select WIN or LOSE first");
    if (isNaN(percent) || percent < 0) return alert("Enter valid %");

    const db = createSupabaseClientIfNeeded();
    if (!db) return;

    // "GLOBAL" ဆိုတဲ့ target_uid နဲ့ Row ရှိလားအရင်ရှာမယ်
    const { data: existing } = await db.from('game_control').select('id').eq('target_uid', 'GLOBAL').single();

    let error;
    if (existing) {
        // ရှိရင် Update လုပ်မယ်
        const { error: err } = await db.from('game_control').update({
            mode: globalTradeUI.mode,
            percentage: percent,
            updated_at: new Date()
        }).eq('target_uid', 'GLOBAL');
        error = err;
    } else {
        // မရှိရင် အသစ်ထည့်မယ်
        const { error: err } = await db.from('game_control').insert([{
            target_uid: 'GLOBAL',
            mode: globalTradeUI.mode,
            percentage: percent,
            is_active: true
        }]);
        error = err;
    }

    if (error) return alert('Error saving Global settings: ' + error.message);
    
    // UI မှာစာပြမယ်
    const el = document.getElementById('globalStatus');
    if (el) el.innerText = `SAVED: ${globalTradeUI.mode.toUpperCase()} ${percent}% (Active)`;
    alert("Global Settings Saved to Database!");
  }
/* ---- Filtered Users ---- */

function addFilteredUser(){
  const uid = document.getElementById('filterUIDInput')?.value.trim();
  if (!uid) return alert("Enter User ID");
  if (!filteredUsers[uid]) {
    filteredUsers[uid] = { mode: null, percent: null };
    renderFilteredUsers();
  }
  document.getElementById('filterUIDInput').value = "";
}

function setUserMode(uid, mode){
  if (!filteredUsers[uid]) return;
  filteredUsers[uid].mode = mode;
  renderFilteredUsers();
}

async function applyUserTradeUI(uid) {
    const input = document.getElementById(`userPercent-${uid}`);
    const percent = Number(input?.value);
    
    // Memory ထဲက data ကိုယူမယ်
    const currentMode = filteredUsers[uid]?.mode;

    if (!currentMode) return alert("Select WIN or LOSE for this user");
    if (isNaN(percent) || percent < 0) return alert("Enter valid %");

    const db = createSupabaseClientIfNeeded();
    
    // Database ထဲလှမ်းထည့်မယ်
    const { data: existing } = await db.from('game_control').select('id').eq('target_uid', uid).single();

    let error;
    if (existing) {
        // Update existing rule
        const { error: err } = await db.from('game_control').update({
            mode: currentMode,
            percentage: percent,
            is_active: true,
            updated_at: new Date()
        }).eq('target_uid', uid);
        error = err;
    } else {
        // Insert new rule
        const { error: err } = await db.from('game_control').insert([{
            target_uid: uid,
            mode: currentMode,
            percentage: percent,
            is_active: true
        }]);
        error = err;
    }

    if (error) {
        alert("Database Error: " + error.message);
    } else {
        filteredUsers[uid].percent = percent;
        renderFilteredUsers(); // UI ပြန်ဆွဲမယ်
        alert(`User ${uid} set to ${currentMode.toUpperCase()} ${percent}%`);
    }
  }

function removeFilteredUser(uid){
  delete filteredUsers[uid];
  renderFilteredUsers();
}

function renderFilteredUsers(){
  const container = document.getElementById('filteredUsersTable');
  if (!container) return;
  container.innerHTML = "";

  const uids = Object.keys(filteredUsers);
  if (uids.length === 0) {
    container.innerHTML = `<p style="opacity:.6">No filtered users yet.</p>`;
    return;
  }

  uids.forEach(uid => {
    const u = filteredUsers[uid];
    const row = document.createElement('div');
    row.className = "card";
    row.style.marginBottom = "10px";
    row.style.background = "#0b0e11";

    row.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <strong>User: ${uid}</strong>

        <div>
          <button class="btn ${u.mode === 'win' ? 'btn-green' : ''}" onclick="setUserMode('${uid}', 'win')">WIN</button>
          <button class="btn ${u.mode === 'lose' ? 'btn-red' : ''}" onclick="setUserMode('${uid}', 'lose')">LOSE</button>
        </div>

        <input id="userPercent-${uid}" type="number" min="0" max="100" placeholder="%" style="width:80px;" value="${u.percent ?? ''}">
        <button class="btn" onclick="applyUserTradeUI('${uid}')">Apply</button>

        <span style=" font-size:12px;">
          ${u.mode && u.percent != null ? `Current: ${u.mode.toUpperCase()} ${u.percent}%` : 'Not set'}
        </span>

        <button class="btn" onclick="removeFilteredUser('${uid}')">✖</button>
      </div>
    `;
    container.appendChild(row);
  });
}


  /* ----------------------------
     Realtime chat: listener & routing
  ---------------------------- */
  function initAdminListener() {
    try {
      const db = createSupabaseClientIfNeeded();
      if (!db) return warn('Supabase client not initialized. Skipping realtime listener.');

      // cleanup old
      if (adminSubscription) {
        try { adminSubscription.unsubscribe(); } catch (e) { /* ignore */ }
        try { db.removeChannel(adminSubscription); } catch (e) { /* ignore */ }
        adminSubscription = null;
      }

      adminSubscription = db.channel('admin-global-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          if (!payload || !payload.new) return;
          const newMsg = payload.new;
          refreshChatUsers();
          checkActiveChatRouting(newMsg);
        })
        .subscribe(status => log('Realtime status:', status));
    } catch (e) {
      console.error('initAdminListener', e);
    }
  }

  function checkActiveChatRouting(msg) {
    try {
      if (!msg || !msg.uid) return;
      const isAdminMsg = Boolean(msg.is_admin);
      if (currentChatUID && currentChatUID === msg.uid) {
        if (!isAdminMsg) appendAdminMessageToUI(msg.content, false, msg.type);
      } else {
        // background message: optionally show badge / toast
        log('Background message from', msg.uid);
      }
    } catch (e) {
      console.error('checkActiveChatRouting', e);
    }
  }

  /* ----------------------------
     Chat list & history
  ---------------------------- */
  async function refreshChatUsers() {
    try {
      const db = createSupabaseClientIfNeeded();
      if (!db) return;
      const { data, error } = await db.from('messages').select('uid, created_at').order('created_at', { ascending: false });
      if (error) { console.warn('refreshChatUsers error', error); return; }
      if (!data) return;

      const uniqueUsers = [...new Set(data.map(m => m.uid))];
      const listContainer = safeEl('chat-user-list'); if (!listContainer) return;
      listContainer.innerHTML = '';
      uniqueUsers.forEach(uid => {
        const item = document.createElement('div');
        item.className = 'user-item' + (currentChatUID === uid ? ' active' : '');
        item.setAttribute('role', 'button');
        item.style.cursor = 'pointer';
        item.textContent = `User ID: ${uid}`;
        item.addEventListener('click', () => selectUserChat(uid));
        listContainer.appendChild(item);
      });
    } catch (e) {
      console.error('refreshChatUsers', e);
    }
  }

  async function selectUserChat(uid) {
    try {
      if (!uid) return;
      currentChatUID = uid;
      const headerInfo = safeEl('chat-header-info'); if (headerInfo) headerInfo.textContent = 'Chatting with: ' + uid;
      const db = createSupabaseClientIfNeeded();
      if (!db) return appendAdminMessageToUI('DB client not available', true, 'text');
      const { data, error } = await db.from('messages').select('*').eq('uid', uid).order('created_at', { ascending: true });
      const display = safeEl('admin-chat-display'); if (!display) return;
      display.innerHTML = '';
      if (error) { appendAdminMessageToUI('Error loading messages: ' + error.message, true, 'text'); return; }
      if (!data || data.length === 0) {
        const placeholder = document.createElement('div'); placeholder.textContent = 'No messages yet.'; placeholder.style.opacity = '0.6'; display.appendChild(placeholder); return;
      }
      data.forEach(m => appendAdminMessageToUI(m.content, !!m.is_admin, m.type));
    } catch (e) {
      console.error('selectUserChat', e);
    }
  }

  async function sendAdminReply() {
    try {
      const input = safeEl('admin-reply-input'); if (!input) return;
      const text = input.value.trim(); if (!text) return;
      if (!currentChatUID) return alert('Select a user first.');

      // optimistic UI
      appendAdminMessageToUI(text, true, 'text');
      input.value = '';
      const display = safeEl('admin-chat-display'); if (display) display.scrollTop = display.scrollHeight;

      const db = createSupabaseClientIfNeeded();
      if (!db) return alert('DB not available');

      const { error } = await db.from('messages').insert([{ uid: currentChatUID, content: text, type: 'text', is_admin: true }]);
      if (error) { console.error('sendAdminReply DB error', error); alert('Error sending: ' + error.message); }
    } catch (e) {
      console.error('sendAdminReply', e);
    }
  }

  /* ----------------------------
     UI append (XSS-safe)
  ---------------------------- */
  function appendAdminMessageToUI(content, isAdmin = false, type = 'text') {
    try {
      const display = safeEl('admin-chat-display'); if (!display) return;
      const msgDiv = document.createElement('div'); msgDiv.className = 'chat-msg ' + (isAdmin ? 'admin' : 'user');
      if (type === 'image' && typeof content === 'string' && /^https?:\/\//i.test(content)) {
        const img = document.createElement('img'); img.style.maxWidth = '220px'; img.style.borderRadius = '10px'; img.alt = 'image'; img.src = content; msgDiv.appendChild(img);
      } else {
        const t = document.createElement('div'); t.className = 'msg-content'; t.textContent = String(content ?? ''); msgDiv.appendChild(t);
      }
      display.appendChild(msgDiv); display.scrollTop = display.scrollHeight;
    } catch (e) {
      console.error('appendAdminMessageToUI', e);
    }
  }

  /* ----------------------------
     Cleanup helpers
  ---------------------------- */
  function cleanup() {
    if (adminSubscription) {
      try { adminSubscription.unsubscribe(); } catch (e) { /* ignore */ }
      try { supabaseClient.removeChannel(adminSubscription); } catch (e) { /* ignore */ }
      adminSubscription = null;
    }
  }

  /* ----------------------------
     Export functions (global for inline HTML handlers)
  ---------------------------- */
  window.showTab = showTab;
  window.checkUser = checkUser;
  window.adjustBalance = adjustBalance;
  window.setGlobalMode = setGlobalMode;
window.applyGlobalTradeUI = applyGlobalTradeUI;
window.addFilteredUser = addFilteredUser;
window.setUserMode = setUserMode;
window.applyUserTradeUI = applyUserTradeUI;
window.removeFilteredUser = removeFilteredUser;
  window.sendAdminReply = sendAdminReply;
  window.selectUserChat = selectUserChat;
  window.cleanupAdmin = cleanup; // optional manual cleanup

  /* ----------------------------
     Load Saved Settings (Database မှ ပြန်ဆွဲတင်ခြင်း)
  ---------------------------- */
  async function loadSavedSettings() {
    const db = createSupabaseClientIfNeeded();
    if (!db) return;

    // ၁။ Global Setting ဆွဲမယ်
    const { data: globalData } = await db.from('game_control').select('*').eq('target_uid', 'GLOBAL').single();
    if (globalData) {
        globalTradeUI = { mode: globalData.mode, percent: globalData.percentage };
        // UI ပြန်ဖြည့်မယ်
        if(document.getElementById('globalPercent')) document.getElementById('globalPercent').value = globalData.percentage;
        setGlobalMode(globalData.mode);
        const el = document.getElementById('globalStatus');
        if (el) el.innerText = `Loaded: ${globalData.mode.toUpperCase()} ${globalData.percentage}%`;
    }

    // ၂။ Filtered Users တွေဆွဲမယ် (GLOBAL မဟုတ်တဲ့ဟာတွေ)
    const { data: usersData } = await db.from('game_control').select('*').neq('target_uid', 'GLOBAL');
    if (usersData) {
        usersData.forEach(row => {
            filteredUsers[row.target_uid] = { mode: row.mode, percent: row.percentage };
        });
        renderFilteredUsers(); // Table ပြန်ဆောက်မယ်
    }
  }

  /* ----------------------------
     Initialization on DOM ready
  ---------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    // create client (or warn)
    createSupabaseClientIfNeeded();

    // initial fetches
    refreshChatUsers();
    initAdminListener();
    loadSavedSettings(); // Setting ဟောင်းတွေ ပြန်ခေါ်မယ်

    // cleanup on unload
    window.addEventListener('beforeunload', cleanup);
  });

})(); // End of IIFE