/* 彰基教學部深耕計畫｜簽到・簽退・滿意度 前台
   每個頁面只需：<body data-mode="checkin|checkout|feedback"> 並載入本檔。 */
{
const CFG = window.ATTEND_CONFIG || {};
const MODE = document.body.dataset.mode;
const $ = s => document.querySelector(s);
const val = s => (document.querySelector(s)?.value || '').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WEEK = '日一二三四五六';
const LABEL = {checkin: '簽到', checkout: '簽退', feedback: '滿意度問卷'};
const qs = new URLSearchParams(location.search);
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem('cch-attend-' + k)); } catch(e){ return null; } },
  set(k, v){ try { localStorage.setItem('cch-attend-' + k, JSON.stringify(v)); } catch(e){} }
};

/* ---------- 後端呼叫 ---------- */
async function api(action, data = {}){
  if (!CFG.gasUrl) return Demo[action](data);
  const body = new URLSearchParams({action, ...data});
  const r = await fetch(CFG.gasUrl, {method: 'POST', body});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---------- 示範模式（未設定 gasUrl 時，資料只存在本機瀏覽器） ---------- */
const Demo = (() => {
  const today = new Date(), pad = n => String(n).padStart(2, '0');
  const d = `${today.getFullYear()}/${pad(today.getMonth()+1)}/${pad(today.getDate())}`;
  const ev = {id: 'demo', title: '與時俱進課程（示範）', date: d, start: '12:20', end: '14:00', place: '教學研究大樓 11 樓講堂',
    speaker: '（講師）', regUrl: 'https://forms.cloud.microsoft/r/MtX0F6aNRr', note: '', needCode: false, test: true,
    orgs: ['彰化基督教醫院', '部立南投醫院', '南投基督教醫院', '埔里基督教醫院', '其他'],
    titles: ['醫師', '護理', '藥事', '醫事放射', '醫事檢驗', '物理治療', '職能治療', '呼吸治療', '營養', '臨床心理', '語言治療', '聽力', '牙醫', '中醫', '社工', '行政', '其他'],
    windows: {checkin: ['11:20', '14:00'], checkout: ['13:30', '16:00']},
    open: {checkin: true, checkout: true, feedback: true}, msg: {}};
  const Q = [['課程內容符合我的學習需求','量表',1],['講師表達清楚，時間掌控得宜','量表',1],['課程內容對我的臨床或教學工作有幫助','量表',1],
    ['場地與行政安排妥適','量表',1],['整體而言，我對本課程感到滿意','量表',1],['本課程讓我收穫最多的地方','文字',0],['對本課程或未來課程主題的建議','文字',0]]
    .map(([text,type,req],i) => ({id: 'q' + (i+1), text, type, options: [], required: !!req}));
  const k = s => String(s || '').replace(/\s/g, '').toLowerCase();
  const db = () => store.get('demo-db') || {att: [], fb: []};
  const save = x => store.set('demo-db', x);
  const hhmm = () => { const n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); };
  const find = (x, p) => x.att.find(a => k(a.name) === k(p.name) && k(a.org) === k(p.org));
  return {
    event: async () => ({ok: true, event: ev, questions: Q}),
    checkin: async p => { const x = db(); const f = find(x, p);
      if (!p.name) return {ok:false, error:'請填寫姓名'};
      if (f) return {ok:true, already:true, time:f.checkin, name:p.name};
      x.att.push({name:p.name, org:p.org, title:p.title, dept:p.dept, empno:p.empno, checkin:hhmm(), checkout:'', feedback:false}); save(x);
      return {ok:true, time:hhmm(), name:p.name}; },
    checkout: async p => { const x = db(); const f = find(x, p);
      if (!f) return {ok:false, error:'查無簽到紀錄。請確認姓名與服務機構和簽到時相同，或洽現場工作人員。'};
      if (f.checkout) return {ok:true, already:true, time:f.checkout, feedbackDone:f.feedback};
      f.checkout = hhmm(); save(x); return {ok:true, time:f.checkout, feedbackDone:f.feedback}; },
    feedback: async p => { const x = db(); const f = find(x, p);
      if (!f) return {ok:false, error:'查無簽到紀錄。請確認姓名與服務機構和簽到時相同。'};
      if (f.feedback) return {ok:true, already:true};
      f.feedback = true; x.fb.push(JSON.parse(p.answers)); save(x); return {ok:true}; },
    admin: async () => { const x = db();
      const stats = Q.map(q => { const v = x.fb.map(a => a[q.id]).filter(Boolean);
        if (q.type === '量表'){ const n = v.map(Number); const dist = [1,2,3,4,5].map(s => n.filter(m => m === s).length);
          return {text:q.text, type:q.type, n:n.length, avg:n.length ? n.reduce((a,b)=>a+b,0)/n.length : null, dist}; }
        return {text:q.text, type:q.type, n:v.length, answers:v}; });
      return {ok:true, events:[{id:'demo', title:ev.title, date:ev.date, active:true}], event:ev,
        attendees:x.att.map(a => ({...a, checkin:a.checkin, checkout:a.checkout, feedback:a.feedback})), stats}; }
  };
})();
window.AttendAPI = api;
window.AttendDemo = !CFG.gasUrl;

/* ---------- 共用畫面 ---------- */
function fmtDate(s){
  const m = String(s || '').match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return s || '';
  const d = new Date(+m[1], m[2]-1, +m[3]);
  return `${+m[2]}月${+m[3]}日（${WEEK[d.getDay()]}）`;
}
function eventCard(ev){
  const ok = ev.open[MODE], msg = ev.msg && ev.msg[MODE];
  let pill;
  if (ok) pill = `<span class="pill open">${LABEL[MODE]}開放中</span>`;
  else if (/尚未|當天才開放/.test(msg || '')) pill = `<span class="pill wait">${esc(msg)}</span>`;
  else pill = `<span class="pill closed">${esc(msg || '目前未開放')}</span>`;
  const time = ev.start ? `${ev.start}${ev.end ? '–' + ev.end : ''}` : '';
  return `<div class="ev">${pill}<h2>${esc(ev.title)}</h2><dl>
    ${ev.date ? `<dt>日期</dt><dd>${esc(fmtDate(ev.date))}　${esc(time)}</dd>` : ''}
    ${ev.place ? `<dt>地點</dt><dd>${esc(ev.place)}</dd>` : ''}
    ${ev.speaker ? `<dt>講師</dt><dd>${esc(ev.speaker)}</dd>` : ''}
    ${MODE === 'checkin' && ev.windows.checkin[0] ? `<dt>簽到</dt><dd>${ev.windows.checkin[0]}–${ev.windows.checkin[1]}</dd>` : ''}
    ${MODE === 'checkout' && ev.windows.checkout[0] ? `<dt>簽退</dt><dd>${ev.windows.checkout[0]}–${ev.windows.checkout[1]}</dd>` : ''}
  </dl></div><div class="tear" aria-hidden="true"></div>`;
}
const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function setErr(field, msg){
  const f = $(`[data-f="${field}"]`); if (!f) return;
  f.classList.toggle('bad', !!msg);
  const e = f.querySelector('.ferr'); if (e) e.textContent = msg || '';
}
function clearOnEdit(form){
  form.addEventListener('input', e => { const f = e.target.closest('[data-f]'); if (f) setErr(f.dataset.f, ''); $('#formErr').textContent = ''; });
  form.addEventListener('change', e => { const f = e.target.closest('[data-f]'); if (f) setErr(f.dataset.f, ''); $('#formErr').textContent = ''; });
}
function codeField(ev){
  if (!ev.needCode) return '';
  const c = qs.get('c') || '';
  return c ? `<input type="hidden" name="code" value="${esc(c)}">`
    : `<div class="field" data-f="code"><label for="code">現場代碼<span class="req">*</span></label>
       <input type="text" id="code" name="code" inputmode="text" autocomplete="off" placeholder="請看教室投影或海報">
       <div class="ferr"></div></div>`;
}
function orgFields(ev, me){
  const isOther = me.org && !ev.orgs.includes(me.org);
  const orgOpts = ev.orgs.map(o => `<option${(me.org === o || (isOther && o === '其他')) ? ' selected' : ''}>${esc(o)}</option>`).join('');
  return `<div class="field" data-f="name"><label for="name">姓名<span class="req">*</span></label>
      <input type="text" id="name" name="name" autocomplete="name" value="${esc(me.name || '')}" maxlength="30"><div class="ferr"></div></div>
    <div class="field" data-f="org"><label for="org">服務機構<span class="req">*</span></label>
      <select id="org" name="orgSel"><option value="">請選擇</option>${orgOpts}</select>
      <input type="text" class="other" id="orgOther" name="orgOther" placeholder="請填寫機構名稱" value="${isOther ? esc(me.org) : ''}" ${isOther ? '' : 'hidden'} maxlength="50">
      <div class="ferr"></div></div>`;
}
function bindOther(){
  const s = $('#org'), o = $('#orgOther');
  if (s && o) s.addEventListener('change', () => { o.hidden = s.value !== '其他'; if (!o.hidden) o.focus(); });
}
function readOrg(){
  const s = $('#org'); if (!s) return '';
  return s.value === '其他' ? $('#orgOther').value.trim() : s.value;
}
async function submitWith(btn, fn){
  btn.disabled = true; const t = btn.textContent; btn.textContent = '送出中…';
  try { return await fn(); }
  catch(e){ $('#formErr').textContent = '連線失敗，請確認網路後再按一次。'; return null; }
  finally { btn.disabled = false; btn.textContent = t; }
}
function stepBar(){
  const order = ['checkin', 'checkout', 'feedback'], cur = order.indexOf(MODE);
  return `<ol class="steps" aria-label="流程">${order.map((m,i) =>
    `<li class="${i === cur ? 'on' : i < cur ? 'done' : ''}"${i === cur ? ' aria-current="step"' : ''}>${['① 簽到','② 簽退','③ 問卷'][i]}</li>`).join('')}</ol>`;
}

/* ---------- 頁面 ---------- */
async function main(){
  const root = $('#app');
  $('#steps').innerHTML = stepBar();
  if (!CFG.gasUrl) $('#banner').innerHTML = '<p class="demo">示範模式：尚未連接 Google Apps Script，資料只存在這台裝置上。</p>';
  let res;
  try { res = await api('event'); }
  catch(e){ root.innerHTML = '<div class="loading">無法連線，請確認網路後重新整理。</div>'; return; }
  if (!res.ok){ root.innerHTML = `<div class="loading">${esc(res.error || '目前沒有開放中的活動')}</div>`; return; }
  const ev = res.event, me = store.get('me') || {};
  if (ev.test && CFG.gasUrl) $('#banner').innerHTML = '<p class="test">測試模式：目前不限時間開放。正式上課前請到試算表取消「測試模式」。</p>';
  document.title = `${LABEL[MODE]}｜${ev.title}`;
  if (MODE === 'checkin') renderCheckin(root, ev, me);
  if (MODE === 'checkout') renderCheckout(root, ev, me);
  if (MODE === 'feedback') renderFeedback(root, ev, me, res.questions || []);
  // 還沒開放時，每分鐘自動重新整理，時間到就能直接填
  if (!ev.open[MODE] && /尚未|當天才開放/.test((ev.msg || {})[MODE] || '')) setTimeout(() => location.reload(), 60000);
  if (ev.regUrl && MODE === 'checkin') $('#foot').innerHTML = `還沒報名？<a href="${esc(ev.regUrl)}">前往報名表</a>`;
}

function renderCheckin(root, ev, me){
  const tOpts = ev.titles.map(t => `<option${me.title === t ? ' selected' : ''}>${esc(t)}</option>`).join('');
  root.innerHTML = eventCard(ev) + `<form id="f" novalidate>
    <p class="formerr" id="formErr" role="alert"></p>
    ${orgFields(ev, me)}
    <div class="field" data-f="title"><label for="title">職類<span class="req">*</span></label>
      <select id="title" name="title"><option value="">請選擇</option>${tOpts}</select><div class="ferr"></div></div>
    <div class="field"><label for="dept">單位／科別<span class="opt">選填</span></label>
      <input type="text" id="dept" name="dept" value="${esc(me.dept || '')}" maxlength="40"></div>
    <div class="field"><label for="empno">員工編號<span class="opt">選填，彰基同仁請填</span></label>
      <input type="text" id="empno" name="empno" inputmode="numeric" value="${esc(me.empno || '')}" maxlength="20"></div>
    ${codeField(ev)}
    <button class="btn" type="submit" ${ev.open.checkin ? '' : 'disabled'}>確認簽到</button>
    <p class="hint" style="margin-top:12px">填寫的資料僅用於本課程出席紀錄、教育學分登錄與課程改善。</p>
  </form>`;
  bindOther();
  const form = $('#f'); clearOnEdit(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = {name: val('#name'), org: readOrg(), title: val('#title'), dept: val('#dept'), empno: val('#empno'),
      code: val('[name=code]'), ua: navigator.userAgent.slice(0, 60)};
    let bad = false;
    if (!p.name){ setErr('name', '請填寫姓名'); bad = true; }
    if (!p.org){ setErr('org', $('#org').value === '其他' ? '請填寫機構名稱' : '請選擇服務機構'); bad = true; }
    if (!p.title){ setErr('title', '請選擇職類'); bad = true; }
    if (form.querySelector('[name=code]') && !p.code){ setErr('code', '請輸入現場代碼'); bad = true; }
    if (bad){ form.querySelector('.bad input, .bad select')?.focus(); return; }
    const r = await submitWith(form.querySelector('button[type=submit]'), () => api('checkin', p));
    if (!r) return;
    if (!r.ok){ if (r.needCode) setErr('code', r.error); else $('#formErr').textContent = r.error; return; }
    store.set('me', {name: p.name, org: p.org, title: p.title, dept: p.dept, empno: p.empno});
    root.innerHTML = eventCard({...ev, open: {...ev.open}}) + `<div class="done-box" role="status">
      <div class="mark">${checkSvg}</div><h3>${esc(p.name)}，${r.already ? '您已完成簽到' : '簽到成功'}</h3>
      <div class="t">${esc(r.time)}</div><p>${r.already ? '這是您先前的簽到時間，不需重複簽到。' : '請保留此畫面，下課時記得簽退。'}</p>
      <div class="next">課程結束前 30 分鐘開放簽退${ev.windows.checkout[0] ? `（<b>${ev.windows.checkout[0]}</b> 起）` : ''}。屆時掃描「簽退」QR Code 即可，姓名會自動帶入。</div></div>`;
  });
}

function renderCheckout(root, ev, me){
  root.innerHTML = eventCard(ev) + `<form id="f" novalidate>
    <p class="formerr" id="formErr" role="alert"></p>
    ${orgFields(ev, me)}
    <p class="hint" style="margin:-6px 0 14px">請填寫和簽到時相同的姓名與服務機構。</p>
    ${codeField(ev)}
    <button class="btn" type="submit" ${ev.open.checkout ? '' : 'disabled'}>確認簽退</button>
  </form>`;
  bindOther();
  const form = $('#f'); clearOnEdit(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = {name: val('#name'), org: readOrg(), code: val('[name=code]')};
    let bad = false;
    if (!p.name){ setErr('name', '請填寫姓名'); bad = true; }
    if (!p.org){ setErr('org', '請選擇服務機構'); bad = true; }
    if (form.querySelector('[name=code]') && !p.code){ setErr('code', '請輸入現場代碼'); bad = true; }
    if (bad) return;
    const r = await submitWith(form.querySelector('button[type=submit]'), () => api('checkout', p));
    if (!r) return;
    if (!r.ok){ if (r.needCode) setErr('code', r.error); else $('#formErr').textContent = r.error; return; }
    store.set('me', {...me, name: p.name, org: p.org});
    root.innerHTML = eventCard(ev) + `<div class="done-box" role="status">
      <div class="mark">${checkSvg}</div><h3>${r.already ? '您已完成簽退' : '簽退成功'}</h3>
      <div class="t">${esc(r.time)}</div>
      ${r.feedbackDone ? '<p>您也已完成滿意度問卷，感謝參與！</p>'
        : `<p>最後一步：請花 1 分鐘填寫滿意度問卷。</p><a class="btn gold" href="../feedback/${location.search}">填寫滿意度問卷</a>`}</div>`;
  });
}

function renderFeedback(root, ev, me, questions){
  const known = me.name && me.org;
  const who = known
    ? `<div class="who" id="who"><span>填寫人：<b>${esc(me.name)}</b>（${esc(me.org)}）</span><button type="button" id="chg">不是我</button></div>
       <div id="whoFields" hidden>${orgFields(ev, me)}</div>`
    : orgFields(ev, me);
  const qHtml = questions.map((q, i) => {
    const req = q.required ? '<span class="req">*</span>' : '<span class="opt">選填</span>';
    let body = '';
    if (q.type === '量表'){
      const lab = ['非常不同意', '不同意', '普通', '同意', '非常同意'];
      body = `<div class="scale" role="radiogroup" aria-label="${esc(q.text)}">${[1,2,3,4,5].map(n =>
        `<label><input type="radio" name="${q.id}" value="${n}"><span>${n}<small>${lab[n-1]}</small></span></label>`).join('')}</div>`;
    } else if (q.type === '單選' || q.type === '複選'){
      const t = q.type === '單選' ? 'radio' : 'checkbox';
      body = `<div class="choices">${q.options.map(o => `<label><input type="${t}" name="${q.id}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</div>`;
    } else {
      body = `<textarea name="${q.id}" maxlength="1000" aria-label="${esc(q.text)}"></textarea>`;
    }
    return `<div class="q field" data-f="${q.id}"><div class="lab"><span class="num">${i+1}.</span>${esc(q.text)}${req}</div>${body}<div class="ferr"></div></div>`;
  }).join('');
  root.innerHTML = eventCard(ev) + `<form id="f" novalidate>
    <p class="formerr" id="formErr" role="alert"></p>${who}${qHtml}
    <button class="btn" type="submit" ${ev.open.feedback ? '' : 'disabled'}>送出問卷</button></form>`;
  bindOther();
  if (known) $('#chg').onclick = () => { $('#who').hidden = true; $('#whoFields').hidden = false; $('#name').focus(); };
  const form = $('#f'); clearOnEdit(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const useStored = known && $('#whoFields').hidden;
    const p = {name: useStored ? me.name : val('#name'), org: useStored ? me.org : readOrg()};
    let first = null; const ans = {};
    if (!p.name){ setErr('name', '請填寫姓名'); first = first || '#name'; }
    if (!p.org){ setErr('org', '請選擇服務機構'); first = first || '#org'; }
    questions.forEach(q => {
      let v;
      if (q.type === '複選') v = [...form.querySelectorAll(`[name="${q.id}"]:checked`)].map(x => x.value);
      else if (q.type === '量表' || q.type === '單選') v = form.querySelector(`[name="${q.id}"]:checked`)?.value || '';
      else v = form.querySelector(`[name="${q.id}"]`).value.trim();
      const empty = Array.isArray(v) ? !v.length : !v;
      if (q.required && empty){ setErr(q.id, '請回答這一題'); first = first || `[data-f="${q.id}"]`; }
      ans[q.id] = v;
    });
    if (first){ $('#formErr').textContent = '還有題目沒有填完，請看紅色提示。'; document.querySelector(first)?.scrollIntoView({behavior: 'smooth', block: 'center'}); return; }
    const r = await submitWith(form.querySelector('button[type=submit]'), () => api('feedback', {...p, answers: JSON.stringify(ans)}));
    if (!r) return;
    if (!r.ok){ $('#formErr').textContent = r.error; $('#formErr').scrollIntoView({block: 'center'}); return; }
    store.set('me', {...me, name: p.name, org: p.org});
    root.innerHTML = eventCard(ev) + `<div class="done-box" role="status"><div class="mark">${checkSvg}</div>
      <h3>${r.already ? '您已填寫過問卷' : '感謝您的回饋！'}</h3><p>${r.already ? '每人每場課程填寫一次即可。' : '您的意見會用於改善後續課程。'}</p>
      <a class="btn line" href="../">回深耕計畫專區</a></div>`;
    scrollTo({top: 0, behavior: 'smooth'});
  });
}

if (MODE) main();
}
