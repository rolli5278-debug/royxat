// Ishga tushirish: node --env-file=.env server.js
import http from 'node:http';
import fs from 'node:fs';
import XLSX from 'xlsx';

const { BOT_TOKEN, ADMIN_IDS = '', PORT = 3000, DATA_FILE = './data.json' } = process.env;
const admins = ADMIN_IDS.split(',').map((s) => s.trim()).filter(Boolean);
const DB = DATA_FILE; // Render'da doimiy disk: DATA_FILE=/var/data/data.json

// Forma maydonlari shu yerda: [kalit, sarlavha, majburiymi]
const FIELDS = [
  ['ism', 'Ism-familiya', true],
  ['telefon', 'Telefon', true],
  ['izoh', 'Izoh', false],
];

// ponytail: JSON fayl, sinxron yozuv — minglab yozuvgacha yetadi; undan keyin sqlite
const rows = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : [];

const page = `<!doctype html><html lang="uz"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ro'yxatdan o'tish</title>
<style>body{font:16px system-ui;max-width:420px;margin:0 auto;padding:24px 16px}
input,textarea,button{width:100%;box-sizing:border-box;font:inherit;padding:12px;margin:6px 0 14px;border:1px solid #bbb;border-radius:8px}
button{background:#2563eb;color:#fff;border:0}p{min-height:1.4em}</style>
<h2>Ro'yxatdan o'tish</h2>
<form id=f>${FIELDS.map(([k, label, req]) =>
  `<label>${label}${req ? ' *' : ''}${k === 'izoh'
    ? `<textarea name=${k} maxlength=500></textarea>`
    : `<input name=${k} maxlength=100 ${req ? 'required' : ''} ${k === 'telefon' ? 'type=tel placeholder="+998 90 123 45 67"' : ''}>`}</label>`).join('')}
<button>Yuborish</button><p id=m></p></form>
<script>f.onsubmit=async e=>{e.preventDefault();m.textContent='...';
const r=await fetch('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
if(r.ok){f.reset();m.innerHTML='✅ Ro\\'yxatdan o\\'tdingiz, rahmat!<br><br><a href="https://t.me/turktili_ku" style="display:block;text-align:center;background:#229ed9;color:#fff;padding:12px;border-radius:8px;text-decoration:none">Telegram guruhiga qo\\'shilish</a>'}else m.textContent='❌ '+(await r.text())}</script>`;

function xlsxBuffer() {
  const ws = XLSX.utils.json_to_sheet(rows.map((r, i) => ({
    '№': i + 1, ...Object.fromEntries(FIELDS.map(([k, label]) => [label, r[k]])), Vaqt: r.vaqt,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ro'yxat");
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------- Telegram ----------
const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', body }).then((r) => r.json());
const BTN = '📥 Excel olish';
const keyboard = JSON.stringify({ keyboard: [[{ text: BTN }]], resize_keyboard: true });
const say = (chat_id, text, admin = true) =>
  tg('sendMessage', new URLSearchParams(admin ? { chat_id, text, reply_markup: keyboard } : { chat_id, text }));

async function sendExcel(chat_id) {
  const fd = new FormData();
  fd.set('chat_id', chat_id);
  fd.set('caption', `Jami: ${rows.length}`);
  fd.set('document', new Blob([xlsxBuffer()]), `royxat-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await tg('sendDocument', fd);
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const res = await tg('getUpdates', new URLSearchParams({ offset, timeout: 30 }));
      if (!res.ok) throw new Error(res.description); // noto'g'ri token va h.k.
      for (const u of res.result) {
        offset = u.update_id + 1;
        const chat = String(u.message?.chat.id ?? '');
        if (!chat) continue;
        if (!admins.includes(chat)) { await say(chat, `Ruxsat yo'q. ID: ${chat}`, false); continue; }
        const text = u.message.text ?? '';
        const del = text.match(/^\/ochir\s+([1-9]\d*)/); // /ochir 3 — Excel'dagi № bo'yicha o'chirish
        if (del) {
          const [gone] = rows.splice(del[1] - 1, 1);
          if (gone) fs.writeFileSync(DB, JSON.stringify(rows));
          await say(chat, gone ? `O'chirildi: ${gone.ism}, ${gone.telefon}\nQoldi: ${rows.length}` : `№${del[1]} topilmadi`);
        } else if (text === BTN || text.split(/[ @]/)[0] === '/excel') await sendExcel(chat);
        else await say(chat, `Jami ro'yxatdan o'tganlar: ${rows.length}\nFaylni olish uchun pastdagi tugmani bosing.`);
      }
    } catch (e) {
      console.error('poll:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------- HTTP ----------
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  }
  if (req.method === 'POST' && req.url === '/api/register') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d;
      try { d = JSON.parse(body); } catch { return res.writeHead(400).end("Noto'g'ri so'rov"); }
      const row = { vaqt: new Date().toLocaleString('sv', { timeZone: 'Asia/Tashkent' }) };
      for (const [k, label, req_] of FIELDS) {
        row[k] = String(d[k] ?? '').trim().slice(0, 500);
        if (req_ && !row[k]) return res.writeHead(400).end(`"${label}" to'ldirilmagan`);
      }
      if (!/^\+?[\d\s()-]{7,20}$/.test(row.telefon)) return res.writeHead(400).end("Telefon raqami noto'g'ri");
      rows.push(row);
      fs.writeFileSync(DB, JSON.stringify(rows));
      admins.forEach((a) => say(a, `🆕 №${rows.length}: ${row.ism}, ${row.telefon}`));
      res.writeHead(200).end('ok');
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

// Render bepul tarifi 15 daqiqa so'rovsiz uxlaydi — o'zimizga tashqi URL orqali so'rov yuborib uyg'oq turamiz
// ponytail: bepul tarifda ham ishlaydi (oyiga 750 soat yetadi); ma'lumot saqlanishi uchun baribir doimiy disk kerak
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL).catch(() => {}), 10 * 60 * 1000);
}

if (BOT_TOKEN) poll(); else console.warn('BOT_TOKEN yo\'q — bot o\'chiq');
