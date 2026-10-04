// ─── app.js ───────────────────────────────────────────
// Main application logic for WeeklyQuest

import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, collection, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  updateDoc, query, where, onSnapshot, serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ══════════════════════════════════════════════════════
//  CONSTANTS & CONFIG
// ══════════════════════════════════════════════════════
const XP_MAP = { low: 10, medium: 25, high: 50, critical: 100 };
const PRIORITY_LABEL = { low:'🟢 Low', medium:'🟡 Medium', high:'🟠 High', critical:'🔴 Critical' };

const LEVELS = [
  { level:1,  name:'Novice',        xp:0    },
  { level:2,  name:'Apprentice',    xp:200  },
  { level:3,  name:'Journeyman',    xp:500  },
  { level:4,  name:'Adept',         xp:1000 },
  { level:5,  name:'Expert',        xp:2000 },
  { level:6,  name:'Master',        xp:3500 },
  { level:7,  name:'Grand Master',  xp:5500 },
  { level:8,  name:'Champion',      xp:8000 },
  { level:9,  name:'Legend',        xp:12000},
  { level:10, name:'Mythic',        xp:20000},
];

const BADGES_DEF = [
  { id:'first_task',   icon:'🗡️',  name:'First Quest',    desc:'Complete your first task',   check: s => s.totalTasks >= 1         },
  { id:'ten_tasks',    icon:'⚔️',  name:'Warrior',        desc:'Complete 10 tasks',           check: s => s.totalTasks >= 10        },
  { id:'fifty_tasks',  icon:'🛡️',  name:'Knight',         desc:'Complete 50 tasks',           check: s => s.totalTasks >= 50        },
  { id:'first_crit',   icon:'🔥',  name:'Critical Hit',   desc:'Complete a Critical task',    check: s => s.criticalDone >= 1       },
  { id:'streak_3',     icon:'🌟',  name:'On Fire',        desc:'3-day task streak',           check: s => s.streak >= 3            },
  { id:'streak_7',     icon:'💫',  name:'Week Warrior',   desc:'7-day task streak',           check: s => s.streak >= 7            },
  { id:'xp_500',       icon:'⚡',  name:'Energized',      desc:'Earn 500 XP total',           check: s => s.totalXP >= 500          },
  { id:'xp_5000',      icon:'🌩️', name:'Thunder Lord',   desc:'Earn 5000 XP total',          check: s => s.totalXP >= 5000         },
  { id:'full_day',     icon:'🏆',  name:'Perfect Day',    desc:'Complete all tasks in a day', check: s => s.perfectDays >= 1       },
  { id:'level5',       icon:'👑',  name:'Royalty',        desc:'Reach Level 5',               check: s => s.level >= 5             },
  { id:'partner',      icon:'🤝',  name:'Accountable',    desc:'Connect with a partner',      check: s => s.hasPartner              },
  { id:'categories3',  icon:'🏷️', name:'Organizer',      desc:'Create 3 categories',         check: s => s.categoriesCount >= 3   },
];

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let currentUser      = null;
let userProfile      = null;
let tasks            = [];       // today's tasks
let categories       = [];
let weeklyNotes      = { benefits:[], negative:[], improvements:[] };
let partnerData      = null;
let partnerUnsub     = null;
let currentWeekOffset = 0;       // 0 = current week
let weeklyItemSection = null;    // which section the modal is adding to
let editingTaskId    = null;
let filterState = { priority: 'all', category: 'all', status: 'all' };

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const todayKey = () => {
  const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
};
const getWeekKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + offset * 7); // Sunday start
  return `${d.getFullYear()}-W${getWeekNumber(d)}`;
};
function getWeekNumber(d) {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
}
function calcLevel(xp) {
  let lv = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.xp) lv = l; else break; }
  return lv;
}
function xpToStars(dayXP) {
  if (dayXP >= 300) return 5;
  if (dayXP >= 200) return 4;
  if (dayXP >= 100) return 3;
  if (dayXP >=  50) return 2;
  if (dayXP >=  10) return 1;
  return 0;
}
function renderStars(count, max=5) {
  return '⭐'.repeat(count) + '☆'.repeat(max - count);
}
function generateInviteCode(uid, weekKey) {
  // Deterministic, week-scoped code derived from uid
  let hash = 0;
  const str = uid + weekKey;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  return `QUEST-${hex}`;
}
function showToast(msg, icon='✅') {
  $('toast-icon').textContent = icon;
  $('toast-msg').textContent = msg;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), 3000);
}
function showXpPopup(xp) {
  $('xp-popup-val').textContent = xp;
  $('xp-popup').classList.remove('hidden');
  setTimeout(() => $('xp-popup').classList.add('hidden'), 2000);
}

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════
$('go-register').addEventListener('click', () => {
  $('login-form').classList.remove('active');
  $('register-form').classList.add('active');
});
$('go-login').addEventListener('click', () => {
  $('register-form').classList.remove('active');
  $('login-form').classList.add('active');
});

$('login-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;
  $('login-error').classList.add('hidden');
  if (!email || !pass) { showAuthError('login-error', 'Please fill in all fields.'); return; }
  try {
    $('login-btn').textContent = 'Logging in...';
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    showAuthError('login-error', friendlyAuthError(e.code));
    $('login-btn').textContent = 'Login';
  }
});

$('register-btn').addEventListener('click', async () => {
  const name  = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const pass  = $('reg-password').value;
  $('reg-error').classList.add('hidden');
  if (!name || !email || !pass) { showAuthError('reg-error', 'Please fill in all fields.'); return; }
  if (pass.length < 6) { showAuthError('reg-error', 'Password must be at least 6 characters.'); return; }
  try {
    $('register-btn').textContent = 'Creating...';
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      displayName: name, email, totalXP: 0, totalTasks: 0,
      criticalDone: 0, streak: 0, perfectDays: 0, categoriesCount: 0,
      hasPartner: false, level: 1, createdAt: serverTimestamp()
    });
  } catch(e) {
    showAuthError('reg-error', friendlyAuthError(e.code));
    $('register-btn').textContent = 'Create Account';
  }
});

$('logout-btn').addEventListener('click', async () => {
  if (partnerUnsub) partnerUnsub();
  await signOut(auth);
});

function showAuthError(id, msg) {
  const el = $(id); el.textContent = msg; el.classList.remove('hidden');
}
function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/email-already-in-use': 'Email already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password too weak.',
    'auth/too-many-requests': 'Too many attempts. Please wait.',
    'auth/invalid-credential': 'Invalid email or password.',
  };
  return map[code] || 'Something went wrong. Try again.';
}

// Auth state
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    $('auth-overlay').classList.add('hidden');
    $('app').classList.remove('hidden');
    await initApp();
  } else {
    currentUser = null;
    $('auth-overlay').classList.remove('hidden');
    $('app').classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════
async function initApp() {
  // Load user profile
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  userProfile = snap.exists() ? snap.data() : {};

  // Set UI
  const name = currentUser.displayName || 'User';
  $('user-initials').textContent = name.slice(0,2).toUpperCase();
  $('dropdown-name').textContent = name;
  $('dropdown-email').textContent = currentUser.email;

  $('today-date').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Load data
  await loadCategories();
  await loadTasks();
  await loadWeeklyNotes();
  updateHeaderStats();
  renderWeeklyReview();
  setupPartnerTab();
}

// ══════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}-panel`).classList.add('active');
    if (btn.dataset.tab === 'weekly') renderWeeklyReview();
    if (btn.dataset.tab === 'partner') setupPartnerTab();
  });
});

// User avatar dropdown
$('user-avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('user-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => $('user-dropdown').classList.add('hidden'));

// ══════════════════════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════════════════════
async function loadCategories() {
  const snap = await getDocs(collection(db, 'users', currentUser.uid, 'categories'));
  categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCategorySelects();
}

function renderCategorySelects() {
  const taskCatSel = $('task-category');
  const filterSel  = $('category-filter');
  // Task modal
  taskCatSel.innerHTML = '<option value="">Select category...</option>';
  // Filter
  filterSel.innerHTML  = '<option value="all">All Categories</option>';
  categories.forEach(c => {
    const o1 = new Option(c.name, c.id); taskCatSel.appendChild(o1);
    const o2 = new Option(c.name, c.id); filterSel.appendChild(o2);
  });
}

function renderCategoryManager() {
  const list = $('category-list-manage');
  list.innerHTML = '';
  if (!categories.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px">No categories yet.</p>';
    return;
  }
  categories.forEach(c => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <span class="cat-dot" style="background:${c.color}"></span>
      <span class="cat-name">${c.name}</span>
      <button class="cat-del-btn" data-id="${c.id}">🗑️</button>
    `;
    item.querySelector('.cat-del-btn').addEventListener('click', () => deleteCategory(c.id));
    list.appendChild(item);
  });
}

$('manage-categories-btn').addEventListener('click', () => {
  renderCategoryManager();
  $('category-modal').classList.remove('hidden');
});
$('close-category-modal').addEventListener('click', () => $('category-modal').classList.add('hidden'));
$('close-cat-footer').addEventListener('click', () => $('category-modal').classList.add('hidden'));

$('add-category-btn').addEventListener('click', async () => {
  const name  = $('new-category-input').value.trim();
  const color = $('new-category-color').value;
  if (!name) return;
  const ref = await addDoc(collection(db, 'users', currentUser.uid, 'categories'), { name, color });
  categories.push({ id: ref.id, name, color });
  $('new-category-input').value = '';
  renderCategorySelects();
  renderCategoryManager();
  // Update stats
  await updateDoc(doc(db, 'users', currentUser.uid), { categoriesCount: categories.length });
  showToast('Category added!', '🏷️');
});

async function deleteCategory(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'categories', id));
  categories = categories.filter(c => c.id !== id);
  renderCategorySelects();
  renderCategoryManager();
  showToast('Category deleted.', '🗑️');
}

// ══════════════════════════════════════════════════════
//  TASKS
// ══════════════════════════════════════════════════════
async function loadTasks() {
  const q = query(
    collection(db, 'users', currentUser.uid, 'tasks'),
    where('dateKey', '==', todayKey()),
    orderBy('createdAt', 'asc')
  );
  // Real-time listener
  onSnapshot(q, snap => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks();
    updateTodayStats();
    updateHeaderStats();
  });
}

function renderTasks() {
  const list = $('task-list');
  const empty = $('tasks-empty');

  let filtered = [...tasks];
  if (filterState.priority !== 'all') filtered = filtered.filter(t => t.priority === filterState.priority);
  if (filterState.category !== 'all') filtered = filtered.filter(t => t.categoryId === filterState.category);
  if (filterState.status !== 'all')   filtered = filtered.filter(t => filterState.status === 'done' ? t.done : !t.done);

  // Remove old cards (keep empty state)
  list.querySelectorAll('.task-card').forEach(c => c.remove());

  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  // Sort: pending first, then by time
  filtered.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });

  filtered.forEach(task => {
    const cat = categories.find(c => c.id === task.categoryId);
    const xp  = XP_MAP[task.priority] || 25;

    const card = document.createElement('div');
    card.className = `task-card ${task.done ? 'done' : ''}`;
    card.dataset.priority = task.priority;

    card.innerHTML = `
      <div class="task-check ${task.done ? 'checked' : ''}" data-id="${task.id}"></div>
      <div class="task-body">
        <div class="task-name">${task.name}</div>
        <div class="task-meta">
          ${task.startTime ? `<span class="task-time">${task.startTime}${task.endTime ? ' → '+task.endTime : ''}</span>` : ''}
          ${cat ? `<span class="task-cat-badge" style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}44">${cat.name}</span>` : ''}
          <span class="task-prio-badge" style="background:var(--prio-${task.priority})22;color:var(--prio-${task.priority})">${PRIORITY_LABEL[task.priority]}</span>
          <span class="task-xp-badge">+${xp} XP</span>
        </div>
        ${task.notes ? `<div class="task-notes">📝 ${task.notes}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit-btn" data-id="${task.id}" title="Edit">✏️</button>
        <button class="task-action-btn delete delete-btn" data-id="${task.id}" title="Delete">🗑️</button>
      </div>
    `;

    // Toggle done
    card.querySelector('.task-check').addEventListener('click', () => toggleTask(task.id, task.done, task.priority));

    // Edit
    card.querySelector('.edit-btn').addEventListener('click', () => openEditTask(task));

    // Delete
    card.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));

    list.appendChild(card);
  });
}

async function toggleTask(id, wasDone, priority) {
  const nowDone = !wasDone;
  const xp = XP_MAP[priority] || 25;
  await updateDoc(doc(db, 'users', currentUser.uid, 'tasks', id), { done: nowDone });
  if (nowDone) {
    showXpPopup(xp);
    showToast(`+${xp} XP earned! Quest complete! ⚔️`, '✅');
    await updateUserStats(xp, priority);
  } else {
    await updateUserStats(-xp, null, true);
  }
}

async function updateUserStats(xpDelta, priority=null, reverse=false) {
  const uref = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(uref);
  const data = snap.data() || {};
  const newXP = Math.max(0, (data.totalXP || 0) + xpDelta);
  const newTasks = Math.max(0, (data.totalTasks || 0) + (reverse ? -1 : 1));
  const newCrit  = priority === 'critical' && !reverse ? (data.criticalDone || 0) + 1 : (data.criticalDone || 0);
  const level = calcLevel(newXP).level;
  await updateDoc(uref, { totalXP: newXP, totalTasks: newTasks, criticalDone: newCrit, level });
  userProfile = { ...userProfile, totalXP: newXP, totalTasks: newTasks, criticalDone: newCrit, level };
  updateHeaderStats();
}

async function deleteTask(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'tasks', id));
  showToast('Task deleted.', '🗑️');
}

// ──── Task Modal ────
$('open-add-task').addEventListener('click', () => openAddTask());
$('close-task-modal').addEventListener('click', closeTaskModal);
$('cancel-task-modal').addEventListener('click', closeTaskModal);
$('save-task-btn').addEventListener('click', saveTask);

function openAddTask() {
  editingTaskId = null;
  $('task-modal-title').textContent = 'New Quest';
  $('task-name').value = '';
  $('task-start').value = '';
  $('task-end').value = '';
  $('task-priority').value = 'medium';
  $('task-category').value = '';
  $('task-notes').value = '';
  $('task-modal-error').classList.add('hidden');
  $('task-modal').classList.remove('hidden');
  $('task-name').focus();
}

function openEditTask(task) {
  editingTaskId = task.id;
  $('task-modal-title').textContent = 'Edit Quest';
  $('task-name').value      = task.name || '';
  $('task-start').value     = task.startTime || '';
  $('task-end').value       = task.endTime || '';
  $('task-priority').value  = task.priority || 'medium';
  $('task-category').value  = task.categoryId || '';
  $('task-notes').value     = task.notes || '';
  $('task-modal-error').classList.add('hidden');
  $('task-modal').classList.remove('hidden');
  $('task-name').focus();
}

function closeTaskModal() { $('task-modal').classList.add('hidden'); }

async function saveTask() {
  const name = $('task-name').value.trim();
  if (!name) { showTaskError('Task name is required.'); return; }

  const payload = {
    name,
    startTime:  $('task-start').value || null,
    endTime:    $('task-end').value || null,
    priority:   $('task-priority').value,
    categoryId: $('task-category').value || null,
    notes:      $('task-notes').value.trim() || null,
    dateKey:    todayKey(),
    weekKey:    getWeekKey(),
    done:       false,
  };

  if (editingTaskId) {
    await updateDoc(doc(db, 'users', currentUser.uid, 'tasks', editingTaskId), payload);
    showToast('Quest updated!', '✏️');
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, 'users', currentUser.uid, 'tasks'), payload);
    showToast('Quest added!', '➕');
  }
  closeTaskModal();
}
function showTaskError(msg) {
  const el = $('task-modal-error'); el.textContent = msg; el.classList.remove('hidden');
}

// ──── Filters ────
$('priority-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $('priority-filter').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  filterState.priority = chip.dataset.value;
  renderTasks();
});
$('status-filter').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return;
  $('status-filter').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  filterState.status = chip.dataset.value;
  renderTasks();
});
$('category-filter').addEventListener('change', e => {
  filterState.category = e.target.value;
  renderTasks();
});

// ──── Today stats ────
function updateTodayStats() {
  const doneTasks = tasks.filter(t => t.done);
  const dayXP     = doneTasks.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
  const stars     = xpToStars(dayXP);
  $('today-xp-display').textContent  = `${dayXP} XP`;
  $('today-stars-display').textContent = renderStars(stars);
}

function updateHeaderStats() {
  const snap = userProfile || {};
  $('header-xp').textContent    = `${snap.totalXP || 0} XP`;
  $('header-stars').textContent = `${xpToStars(snap.totalXP || 0)} ⭐`;
}

// ══════════════════════════════════════════════════════
//  WEEKLY REVIEW
// ══════════════════════════════════════════════════════
async function loadWeeklyNotes() {
  const wk = getWeekKey(currentWeekOffset);
  const ref = doc(db, 'users', currentUser.uid, 'weeklyNotes', wk);
  const snap = await getDoc(ref);
  weeklyNotes = snap.exists() ? snap.data() : { benefits:[], negative:[], improvements:[] };
}

async function saveWeeklyNotes() {
  const wk = getWeekKey(currentWeekOffset);
  await setDoc(doc(db, 'users', currentUser.uid, 'weeklyNotes', wk), weeklyNotes);
}

async function renderWeeklyReview() {
  await loadWeeklyNotes();
  await renderWeekStats();
  renderWeeklyNotesSections();
  renderBadges();
  renderDayByDay();
  renderLevelJourney();
}

async function renderWeekStats() {
  const wk = getWeekKey(currentWeekOffset);
  // Get week date range
  const weekStart = getWeekStartDate(currentWeekOffset);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  $('week-range-display').textContent =
    `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

  // Query all tasks for the week
  const q = query(collection(db, 'users', currentUser.uid, 'tasks'), where('weekKey', '==', wk));
  const snap = await getDocs(q);
  const weekTasks = snap.docs.map(d => d.data());
  const doneTasks = weekTasks.filter(t => t.done);
  const weekXP = doneTasks.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
  const weekStars = doneTasks.reduce((s,t) => s + xpToStars(XP_MAP[t.priority] || 0), 0);
  const completionRate = weekTasks.length ? Math.round((doneTasks.length / weekTasks.length) * 100) : 0;
  const lv = calcLevel((userProfile?.totalXP || 0));

  $('week-total-xp').textContent   = weekXP;
  $('week-total-stars').textContent = weekStars;
  $('week-level').textContent      = `Lv ${lv.level}`;
  $('week-level-badge').textContent = lv.name;
  $('week-tasks-done').textContent = doneTasks.length;
  $('week-completion-rate').textContent = `${completionRate}% Done`;

  // XP bar (max 1000 XP/week)
  $('week-xp-bar').style.width = `${Math.min(100, (weekXP / 1000) * 100)}%`;

  // Stars row
  $('week-star-row').textContent = renderStars(Math.min(5, Math.floor(weekStars / 5)));
}

function getWeekStartDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  d.setHours(0,0,0,0);
  return d;
}

function renderWeeklyNotesSections() {
  renderNoteList('benefits', $('benefits-list'), $('benefits-empty'));
  renderNoteList('negative', $('negative-list'), $('negative-empty'));
  renderNoteList('improvements', $('improvements-list'), $('improvements-empty'));
}

function renderNoteList(key, listEl, emptyEl) {
  listEl.innerHTML = '';
  const items = weeklyNotes[key] || [];
  if (!items.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');
  const dotColorMap = { benefits:'var(--neon-green)', negative:'var(--neon-red)', improvements:'var(--neon-cyan)' };
  items.forEach((text, idx) => {
    const li = document.createElement('li');
    li.className = 'wcard-item';
    li.innerHTML = `
      <span class="wcard-item-dot" style="background:${dotColorMap[key]}"></span>
      <span class="wcard-item-text">${text}</span>
      <button class="wcard-item-del" data-key="${key}" data-idx="${idx}">✕</button>
    `;
    li.querySelector('.wcard-item-del').addEventListener('click', () => deleteWeeklyItem(key, idx));
    listEl.appendChild(li);
  });
}

async function deleteWeeklyItem(key, idx) {
  weeklyNotes[key].splice(idx, 1);
  await saveWeeklyNotes();
  renderWeeklyNotesSections();
}

// ──── Weekly item modal ────
document.querySelectorAll('.wcard-add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    weeklyItemSection = btn.dataset.section;
    const titles = { benefits:'Add Benefit', negative:'Add Negative', improvements:'Add Improvement' };
    $('weekly-item-modal-title').textContent = titles[weeklyItemSection] || 'Add Entry';
    $('weekly-item-text').value = '';
    $('weekly-item-modal').classList.remove('hidden');
    $('weekly-item-text').focus();
  });
});
$('close-weekly-item-modal').addEventListener('click', () => $('weekly-item-modal').classList.add('hidden'));
$('cancel-weekly-item').addEventListener('click', () => $('weekly-item-modal').classList.add('hidden'));
$('save-weekly-item').addEventListener('click', async () => {
  const text = $('weekly-item-text').value.trim();
  if (!text || !weeklyItemSection) return;
  if (!weeklyNotes[weeklyItemSection]) weeklyNotes[weeklyItemSection] = [];
  weeklyNotes[weeklyItemSection].push(text);
  await saveWeeklyNotes();
  $('weekly-item-modal').classList.add('hidden');
  renderWeeklyNotesSections();
  showToast('Entry saved!', '✅');
});

// Week nav
$('prev-week-btn').addEventListener('click', async () => { currentWeekOffset--; await renderWeeklyReview(); });
$('next-week-btn').addEventListener('click', async () => { currentWeekOffset++; await renderWeeklyReview(); });

// ──── Level Journey ────
function renderLevelJourney() {
  const totalXP = userProfile?.totalXP || 0;
  const currentLv = calcLevel(totalXP);
  const container = $('level-journey');
  container.innerHTML = '';
  LEVELS.slice(0, 6).forEach(lv => {
    const div = document.createElement('div');
    div.className = `level-row ${lv.level === currentLv.level ? 'current-level' : ''}`;
    const reached = totalXP >= lv.xp;
    const nextLv = LEVELS.find(l => l.level === lv.level + 1);
    div.innerHTML = `
      <span class="level-num">${reached ? '✅' : '🔒'} Lv${lv.level}</span>
      <span class="level-name">${lv.name}</span>
      <span class="level-xp-req">${lv.xp.toLocaleString()} XP</span>
    `;
    container.appendChild(div);
  });
}

// ──── Badges ────
function renderBadges() {
  const stats = {
    totalXP:       userProfile?.totalXP || 0,
    totalTasks:    userProfile?.totalTasks || 0,
    criticalDone:  userProfile?.criticalDone || 0,
    streak:        userProfile?.streak || 0,
    perfectDays:   userProfile?.perfectDays || 0,
    level:         userProfile?.level || 1,
    hasPartner:    userProfile?.hasPartner || false,
    categoriesCount: userProfile?.categoriesCount || 0,
  };
  const grid = $('badges-grid'); grid.innerHTML = '';
  BADGES_DEF.forEach(b => {
    const unlocked = b.check(stats);
    const div = document.createElement('div');
    div.className = `badge-item ${unlocked ? 'unlocked' : 'locked'}`;
    div.title = b.desc;
    div.innerHTML = `
      <span class="badge-icon">${b.icon}</span>
      <span class="badge-name">${b.name}</span>
      <span class="badge-desc">${b.desc}</span>
    `;
    grid.appendChild(div);
  });
}

// ──── Day by Day ────
async function renderDayByDay() {
  const container = $('days-row');
  container.innerHTML = '';
  const wk = getWeekKey(currentWeekOffset);
  const q = query(collection(db, 'users', currentUser.uid, 'tasks'), where('weekKey', '==', wk));
  const snap = await getDocs(q);
  const allWeekTasks = snap.docs.map(d => d.data());

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const start = getWeekStartDate(currentWeekOffset);
  const todayStr = todayKey();

  days.forEach((name, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dk = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const dayTasks = allWeekTasks.filter(t => t.dateKey === dk);
    const doneTasks = dayTasks.filter(t => t.done);
    const dayXP = doneTasks.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
    const stars = xpToStars(dayXP);
    const isToday = dk === todayStr;

    const pill = document.createElement('div');
    pill.className = `day-pill ${isToday ? 'today' : ''}`;
    pill.innerHTML = `
      <div class="day-name">${name} ${d.getDate()}</div>
      <div class="day-stars">${renderStars(stars)}</div>
      <div class="day-xp">${dayXP} XP</div>
    `;
    container.appendChild(pill);
  });
}

// ══════════════════════════════════════════════════════
//  PARTNER TAB
// ══════════════════════════════════════════════════════
function setupPartnerTab() {
  const uid  = currentUser.uid;
  const code = generateInviteCode(uid, getWeekKey());
  $('invite-code-text').textContent = code;

  // Store invite code in Firestore for lookup
  setDoc(doc(db, 'inviteCodes', code), { uid, weekKey: getWeekKey() }, { merge: true });

  // Check if already connected
  const saved = localStorage.getItem(`partner_${uid}_${getWeekKey()}`);
  if (saved) {
    const pd = JSON.parse(saved);
    loadPartnerProgress(pd.uid, pd.name);
  }
}

$('copy-code-btn').addEventListener('click', () => {
  navigator.clipboard.writeText($('invite-code-text').textContent)
    .then(() => showToast('Invite code copied!', '📋'));
});

$('connect-partner-btn').addEventListener('click', async () => {
  const code = $('partner-code-input').value.trim().toUpperCase();
  if (!code) return;
  $('connect-error').classList.add('hidden');

  // Look up invite code
  const ref = doc(db, 'inviteCodes', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) { showConnectError('Invalid invite code. Ask your partner to share theirs.'); return; }
  const { uid: partnerUid } = snap.data();
  if (partnerUid === currentUser.uid) { showConnectError("That's your own code!"); return; }

  // Load partner profile
  const pSnap = await getDoc(doc(db, 'users', partnerUid));
  if (!pSnap.exists()) { showConnectError('Partner account not found.'); return; }
  const pData = pSnap.data();

  // Save connection locally
  const weekKey = getWeekKey();
  localStorage.setItem(`partner_${currentUser.uid}_${weekKey}`, JSON.stringify({ uid: partnerUid, name: pData.displayName }));
  await updateDoc(doc(db, 'users', currentUser.uid), { hasPartner: true });
  userProfile = { ...userProfile, hasPartner: true };

  showToast(`Connected with ${pData.displayName}!`, '🤝');
  loadPartnerProgress(partnerUid, pData.displayName);
});

function showConnectError(msg) {
  const el = $('connect-error'); el.textContent = msg; el.classList.remove('hidden');
}

async function loadPartnerProgress(partnerUid, partnerName) {
  const pSnap = await getDoc(doc(db, 'users', partnerUid));
  if (!pSnap.exists()) return;
  const pd = pSnap.data();

  // Get partner's week tasks
  const wk = getWeekKey();
  const q = query(collection(db, 'users', partnerUid, 'tasks'), where('weekKey', '==', wk));
  const tSnap = await getDocs(q);
  const pTasks = tSnap.docs.map(d => d.data());
  const pDone = pTasks.filter(t => t.done);
  const pWeekXP = pDone.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
  const pLevel = calcLevel(pd.totalXP || 0);

  // Show partner section
  $('partner-progress-section').classList.remove('hidden');
  const initials = (partnerName || 'P').slice(0,2).toUpperCase();
  $('partner-avatar').textContent = initials;
  $('partner-name').textContent = partnerName;
  $('partner-level-label').textContent = `Level ${pLevel.level} — ${pLevel.name}`;
  $('partner-xp').textContent   = pWeekXP;
  $('partner-stars').textContent = xpToStars(pWeekXP);
  $('partner-tasks').textContent = pDone.length;
  $('partner-level').textContent = `Lv ${pLevel.level}`;

  // H2H
  const myXP = (userProfile?.totalXP || 0);
  const total = myXP + pWeekXP || 1;
  $('h2h-you-name').textContent     = currentUser.displayName?.split(' ')[0] || 'You';
  $('h2h-partner-name').textContent = partnerName.split(' ')[0];
  $('h2h-you-xp').textContent       = myXP;
  $('h2h-partner-xp').textContent   = pWeekXP;
  $('h2h-you-bar').style.width      = `${(myXP / total) * 100}%`;
  $('h2h-partner-bar').style.width  = `${(pWeekXP / total) * 100}%`;

  // Real-time updates
  if (partnerUnsub) partnerUnsub();
  partnerUnsub = onSnapshot(doc(db, 'users', partnerUid), snap => {
    if (snap.exists()) loadPartnerProgress(partnerUid, partnerName);
  });
}

$('disconnect-partner-btn').addEventListener('click', () => {
  const weekKey = getWeekKey();
  localStorage.removeItem(`partner_${currentUser.uid}_${weekKey}`);
  if (partnerUnsub) { partnerUnsub(); partnerUnsub = null; }
  $('partner-progress-section').classList.add('hidden');
  $('partner-code-input').value = '';
  showToast('Disconnected from partner.', '👋');
});
