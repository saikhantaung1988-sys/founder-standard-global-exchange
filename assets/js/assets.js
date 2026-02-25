// assets.js
const supabaseUrl = 'https://qonmwtjznyrfenikqffk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvbm13dGp6bnlyZmVuaWtxZmZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDQ3NzEsImV4cCI6MjA4NjMyMDc3MX0.OgTzG55xr_zkK8pIRp_S4lPG4eTIHunqz5PP_EPEFrs';

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// profile table name (မင်း project ထဲက table name ကို တိတိကျကျပြောင်း)
const PROFILE_TABLE = 'profiles'; // ဥပမာ: profiles

async function checkUser() {
  const uid = document.getElementById('targetUID').value.trim();

  if (!uid || uid.length !== 6) {
    alert('UID ၆ လုံးထည့်ပါ');
    return;
  }

  const { data, error } = await supabase
    .from(PROFILE_TABLE)
    .select('uid, balance')
    .eq('uid', uid)
    .single();

  if (error || !data) {
    alert('User မတွေ့ပါ');
    console.error(error);
    return;
  }

  alert(`User Found\nUID: ${data.uid}\nBalance: $${data.balance ?? 0}`);
}


async function adjustBalance(type) {
  const uid = document.getElementById('targetUID').value.trim();
  const amount = Number(document.getElementById('balanceValue').value);

  if (!uid || uid.length !== 6) {
    alert('UID ၆ လုံးထည့်ပါ');
    return;
  }
  if (!amount || amount <= 0) {
    alert('Amount ကိုမှန်ကန်စွာထည့်ပါ');
    return;
  }

  // 1) Current balance ကိုယူ
  const { data: user, error: fetchErr } = await supabase
    .from(PROFILE_TABLE)
    .select('balance')
    .eq('uid', uid)
    .single();

  if (fetchErr || !user) {
    alert('User မတွေ့ပါ');
    console.error(fetchErr);
    return;
  }

  const current = Number(user.balance || 0);
  let nextBalance = current;

  if (type === 'add') {
    nextBalance = current + amount;
  } else if (type === 'sub') {
    nextBalance = current - amount;
    if (nextBalance < 0) {
      alert('Balance မလုံလောက်ပါ');
      return;
    }
  }

  // 2) Update balance
  const { error: updateErr } = await supabase
    .from(PROFILE_TABLE)
    .update({ balance: nextBalance })
    .eq('uid', uid);

  if (updateErr) {
    alert('Update မအောင်မြင်ပါ');
    console.error(updateErr);
    return;
  }

  alert(`Success!\nNew Balance: $${nextBalance}`);
  document.getElementById('balanceValue').value = '';
}