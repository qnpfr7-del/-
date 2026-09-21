import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, collection, getDocs, doc, setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD3KRLA4h-brLBwlvL_GOA0oLdwP-qnFQQ',
  authDomain: 'youth-program-scheduler.firebaseapp.com',
  projectId: 'youth-program-scheduler',
  storageBucket: 'youth-program-scheduler.firebasestorage.app',
  messagingSenderId: '228142010710',
  appId: '1:228142010710:web:2d22fbe8388e1f48d686f7'
};
const ALLOWED_EMAILS = new Set(['qnpfr7@gmail.com']);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let state = {
  programs: [],
  tasks: [],
  today: '',
  calendarDate: new Date(),
  taskFilter: 'today'
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
  onAuthStateChanged(auth, async user => {
    const allowed = user && ALLOWED_EMAILS.has((user.email || '').toLowerCase());
    document.getElementById('authGate').classList.toggle('hidden', !!allowed);
    document.getElementById('userBox').classList.toggle('hidden', !allowed);
    document.getElementById('userEmail').textContent = allowed ? user.email : '';
    document.getElementById('authMessage').textContent = user && !allowed ? '이 계정은 아직 사용 승인을 받지 않았습니다.' : '';
    if (allowed) await loadData();
  });
});

async function login() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { document.getElementById('authMessage').textContent = err.message || '로그인에 실패했습니다.'; }
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view, btn.textContent.trim()));
  });

  document.getElementById('openCreateBtn').addEventListener('click', () => openProgramModal());
  document.getElementById('closeModalBtn').addEventListener('click', closeProgramModal);
  document.getElementById('cancelBtn').addEventListener('click', closeProgramModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target.id === 'modalBackdrop') closeProgramModal();
  });

  document.getElementById('programForm').addEventListener('submit', saveProgram);
  document.getElementById('deleteProgramBtn').addEventListener('click', removeCurrentProgram);
  document.getElementById('programSearch').addEventListener('input', renderProgramTable);

  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    renderCalendar();
  });

  document.querySelectorAll('[data-task-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-task-filter]').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      state.taskFilter = btn.dataset.taskFilter;
      renderTasks();
    });
  });
}

async function loadData() {
  setLoading(true);
  try {
    const [programSnap, taskSnap] = await Promise.all([getDocs(collection(db, 'programs')), getDocs(collection(db, 'tasks'))]);
    state.programs = programSnap.docs.map(x => ({id:x.id, ...x.data()})).sort((a,b)=>(a.operationStart||'').localeCompare(b.operationStart||''));
    state.tasks = taskSnap.docs.map(x => ({id:x.id, ...x.data()}));
    state.today = toISO(new Date());
    state.calendarDate = parseDate(state.today);
    renderAll();
  } catch (err) { handleError(err); }
  finally { setLoading(false); }
}

function renderAll() {
  document.getElementById('todayText').textContent = `${formatDateK(state.today)} 기준`;
  renderDashboard();
  renderProgramTable();
  renderCalendar();
  renderTasks();
}

function renderDashboard() {
  const today = state.today;
  const thisMonth = today.slice(0,7);

  const recruiting = state.programs.filter(p => inRange(today, p.recruitStart, p.recruitEnd)).length;
  const operatingThisMonth = state.programs.filter(p => (p.operationStart || '').startsWith(thisMonth)).length;
  const todayTasks = state.tasks.filter(t => t.dueDate === today && !t.done).length;
  const overdue = state.tasks.filter(t => t.dueDate && t.dueDate < today && !t.done).length;

  document.getElementById('statGrid').innerHTML = [
    statCard('현재 모집중', recruiting, '모집기간 기준'),
    statCard('이번 달 운영', operatingThisMonth, '운영 시작일 기준'),
    statCard('오늘 할 일', todayTasks, '미완료 체크리스트'),
    statCard('기한 지난 업무', overdue, '확인 필요')
  ].join('');

  const upcoming = buildUpcomingEvents()
    .filter(x => x.date >= today && x.date <= addDays(today, 30))
    .slice(0, 10);

  document.getElementById('upcomingList').innerHTML = upcoming.length
    ? upcoming.map(x => `
      <div class="list-item">
        <span class="badge ${x.type}">${x.label}</span>
        <div class="grow">
          <strong>${esc(x.program.name)}</strong>
          <div class="muted">${formatDateK(x.date)} · ${esc(x.program.manager || '담당자 미지정')}</div>
        </div>
        <span class="muted">${dDay(x.date)}</span>
      </div>`).join('')
    : empty('30일 이내 등록된 일정이 없습니다.');

  const todayTaskItems = state.tasks.filter(t => t.dueDate === today && !t.done);
  document.getElementById('todayTaskCount').textContent = `${todayTaskItems.length}건`;
  document.getElementById('todayTaskList').innerHTML = todayTaskItems.length
    ? todayTaskItems.map(taskRow).join('')
    : empty('오늘 예정된 미완료 업무가 없습니다.');

  document.getElementById('programCards').innerHTML = state.programs.length
    ? state.programs.slice(0,9).map(p => {
        const rate = p.capacity > 0 ? Math.min(100, Math.round((p.applicants/p.capacity)*100)) : 0;
        return `
        <article class="program-card">
          <div class="panel-head">
            <h3>${esc(p.name)}</h3>
            <span class="badge">${esc(p.status)}</span>
          </div>
          <div class="muted">운영 ${formatRange(p.operationStart,p.operationEnd)}</div>
          <div class="muted">모집 ${formatRange(p.recruitStart,p.recruitEnd)}</div>
          <div style="margin-top:10px;font-size:12px">모집 ${p.applicants}/${p.capacity || '-'}명</div>
          <div class="progress"><span style="width:${rate}%"></span></div>
        </article>`;
      }).join('')
    : empty('등록된 프로그램이 없습니다.');
}

function renderProgramTable() {
  const q = (document.getElementById('programSearch').value || '').trim().toLowerCase();
  const items = state.programs.filter(p => `${p.name} ${p.manager}`.toLowerCase().includes(q));

  document.getElementById('programTableBody').innerHTML = items.length ? items.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${formatRange(p.recruitStart,p.recruitEnd)}</td>
      <td>${formatDateK(p.selectionDate)}</td>
      <td>${formatRange(p.operationStart,p.operationEnd)}</td>
      <td>${p.applicants}/${p.capacity || '-'}</td>
      <td><span class="badge">${esc(p.status)}</span></td>
      <td>${esc(p.manager || '-')}</td>
      <td><button class="link-btn" onclick="editProgram('${p.id}')">수정</button></td>
    </tr>`).join('') : `<tr><td colspan="8">${empty('조건에 맞는 프로그램이 없습니다.')}</td></tr>`;
}

function renderCalendar() {
  const y = state.calendarDate.getFullYear();
  const m = state.calendarDate.getMonth();
  document.getElementById('calendarTitle').textContent = `${y}년 ${m+1}월`;

  const first = new Date(y,m,1);
  const start = new Date(y,m,1-first.getDay());
  const events = buildUpcomingEvents();

  let html = ['일','월','화','수','목','금','토'].map(d => `<div class="cal-head">${d}</div>`).join('');
  for (let i=0;i<42;i++) {
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    const ds = toISO(d);
    const dayEvents = events.filter(e => e.date === ds).slice(0,4);
    html += `
      <div class="cal-cell ${d.getMonth() !== m ? 'other':''}">
        <div class="cal-date">${d.getDate()}</div>
        ${dayEvents.map(e => `<div class="cal-event ${e.type}" title="${esc(e.program.name)}">${esc(e.program.name)} · ${e.label}</div>`).join('')}
      </div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}

function renderTasks() {
  const today = state.today;
  let items = [...state.tasks];

  if (state.taskFilter === 'today') {
    items = items.filter(t => t.dueDate === today);
  } else if (state.taskFilter === 'week') {
    items = items.filter(t => t.dueDate >= today && t.dueDate <= addDays(today, 7));
  }

  items.sort((a,b) => Number(a.done)-Number(b.done) || (a.dueDate||'').localeCompare(b.dueDate||''));

  document.getElementById('taskList').innerHTML = items.length
    ? items.map(taskRow).join('')
    : empty('표시할 체크리스트가 없습니다.');
}

function taskRow(t) {
  const p = state.programs.find(x => x.id === t.programId);
  return `
    <label class="list-item">
      <input class="task-check" type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}', this.checked)">
      <div class="grow ${t.done?'task-done':''}">
        <strong>${esc(t.name)}</strong>
        <div class="muted">${esc(p ? p.name : '삭제된 프로그램')} · ${formatDateK(t.dueDate)} ${t.dueDate ? '· '+dDay(t.dueDate):''}</div>
      </div>
      <span class="badge">${esc(t.type)}</span>
    </label>`;
}

function buildUpcomingEvents() {
  const out = [];
  state.programs.forEach(p => {
    if (p.recruitStart) out.push({date:p.recruitStart,type:'recruit',label:'모집 시작',program:p});
    if (p.recruitEnd) out.push({date:p.recruitEnd,type:'recruit',label:'모집 마감',program:p});
    if (p.selectionDate) out.push({date:p.selectionDate,type:'select',label:'선정 안내',program:p});
    if (p.operationStart) out.push({date:p.operationStart,type:'operate',label:'운영 시작',program:p});
    if (p.operationEnd && p.operationEnd !== p.operationStart) out.push({date:p.operationEnd,type:'operate',label:'운영 종료',program:p});
    if (p.reportDue) out.push({date:p.reportDue,type:'report',label:'결과보고',program:p});
  });
  return out.sort((a,b) => a.date.localeCompare(b.date));
}

function openProgramModal(p=null) {
  document.getElementById('modalTitle').textContent = p ? '프로그램 수정' : '프로그램 등록';
  document.getElementById('programId').value = p?.id || '';
  [
    'name','manager','location','recruitStart','recruitEnd','selectionDate',
    'operationStart','operationEnd','reportDue','capacity','applicants','status','memo'
  ].forEach(id => {
    const el = document.getElementById(id);
    el.value = p ? (p[id] ?? '') : (['capacity','applicants'].includes(id) ? 0 : '');
  });
  if (!p) document.getElementById('status').value = '기획중';
  document.getElementById('deleteProgramBtn').classList.toggle('hidden', !p);
  document.getElementById('modalBackdrop').classList.remove('hidden');
}

function closeProgramModal() {
  document.getElementById('modalBackdrop').classList.add('hidden');
  document.getElementById('programForm').reset();
  document.getElementById('programId').value = '';
}

function editProgram(id) {
  const p = state.programs.find(x => x.id === id);
  if (p) openProgramModal(p);
}

async function saveProgram(e) {
  e.preventDefault();
  const payload = {};
  [
    'name','manager','location','recruitStart','recruitEnd','selectionDate',
    'operationStart','operationEnd','reportDue','capacity','applicants','status','memo'
  ].forEach(id => payload[id] = document.getElementById(id).value);
  payload.id = document.getElementById('programId').value || crypto.randomUUID();
  payload.capacity = Number(payload.capacity || 0);
  payload.applicants = Number(payload.applicants || 0);

  setLoading(true);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'programs', payload.id), payload);
    state.tasks.filter(t => t.programId === payload.id).forEach(t => batch.delete(doc(db, 'tasks', t.id)));
    milestoneTasks(payload).forEach(t => batch.set(doc(db, 'tasks', t.id), t));
    await batch.commit();
    closeProgramModal();
    await loadData();
    toast('저장했습니다.');
  } catch (err) { handleError(err); }
  finally { setLoading(false); }
}

function milestoneTasks(p) {
  const specs = [
    ['모집 시작','모집 공고 확인',p.recruitStart], ['모집 마감','신청자 명단 정리',p.recruitEnd],
    ['선정 안내','선정 결과 안내',p.selectionDate], ['운영 시작','운영 준비 최종 점검',p.operationStart],
    ['운영 종료','참여자 만족도 및 결과 정리',p.operationEnd], ['결과보고','결과보고서 제출',p.reportDue]
  ];
  const existing = Object.fromEntries(state.tasks.filter(t=>t.programId===p.id).map(t=>[t.type,!!t.done]));
  return specs.filter(([, , due])=>due).map(([type,name,dueDate])=>({id:`${p.id}-${type}`,programId:p.id,type,name,dueDate,done:existing[type]||false}));
}

async function removeCurrentProgram() {
  const id = document.getElementById('programId').value;
  if (!id) return;
  if (!confirm('이 프로그램과 연결된 체크리스트를 삭제할까요?')) return;

  setLoading(true);
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'programs', id));
    state.tasks.filter(t=>t.programId===id).forEach(t=>batch.delete(doc(db,'tasks',t.id)));
    await batch.commit();
    closeProgramModal();
    await loadData();
    toast('삭제했습니다.');
  } catch (err) { handleError(err); }
  finally { setLoading(false); }
}

async function toggleTask(taskId, done) {
  try {
    const task = state.tasks.find(t=>t.id===taskId);
    if (!task) return;
    await setDoc(doc(db,'tasks',taskId), {...task,done});
    task.done = done;
    renderDashboard();
    renderTasks();
  } catch (err) { handleError(err); }
}

function switchView(view, title) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = title;
}

function statCard(label, value, sub) {
  return `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}
function empty(msg){ return `<div class="empty">${msg}</div>`; }
function setLoading(on){ document.getElementById('loading').classList.toggle('hidden', !on); }
function handleError(err){ setLoading(false); alert(err.message || err); }
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),1800);
}
function esc(v=''){ return String(v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function parseDate(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function toISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function formatDateK(s){ if(!s) return '-'; const d=parseDate(s); return `${d.getMonth()+1}.${d.getDate()}`; }
function formatRange(a,b){ if(!a && !b) return '-'; if(a===b || !b) return formatDateK(a); return `${formatDateK(a)} ~ ${formatDateK(b)}`; }
function inRange(target,start,end){ if(!target||!start) return false; end=end||start; return target>=start && target<=end; }
function addDays(s,n){ const d=parseDate(s); d.setDate(d.getDate()+n); return toISO(d); }
function dDay(s){
  if(!s || !state.today) return '';
  const a=parseDate(state.today), b=parseDate(s);
  const diff=Math.round((b-a)/86400000);
  if(diff===0) return 'D-DAY';
  return diff>0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

window.editProgram = editProgram;
window.toggleTask = toggleTask;
