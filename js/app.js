// ─── app.js ───────────────────────────────────────────
// Main application logic for WeeklyQuest
// Upgraded with Schedule Table, Timetable Grid, Week Strip, and robust sync

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
  updateDoc, query, where, onSnapshot, serverTimestamp
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
let currentUser        = null;
let userProfile        = null;
let allTasks           = [];       // all tasks real-time cache
let categories         = [];
let tasksUnsub         = null;
let weeklyNotes        = { benefits:[], negative:[], improvements:[] };
let partnerData        = null;
let partnerUnsub       = null;
let currentWeekOffset  = 0;       // 0 = current week for weekly review
let weeklyItemSection  = null;    // which section the modal is adding to
let editingTaskId      = null;
let filterState        = { priority: 'all', category: 'all', status: 'all' };

// Schedule tab state
let selectedDateKey    = null;    // YYYY-MM-DD
let currentScheduleView = localStorage.getItem('wq_schedule_view') || 'table'; // 'table' | 'timetable' | 'cards'

// ══════════════════════════════════════════════════════
//  HELPERS & DATE UTILITIES
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

function toISODate(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const parts = d.trim().split('-');
    if (parts.length === 3) {
      const y = parts[0];
      const m = String(parts[1]).padStart(2, '0');
      const day = String(parts[2]).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return toISODate(new Date());
}

function parseISODate(isoStr) {
  if (!isoStr) return new Date();
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function matchesDate(task, targetDateISO) {
  if (!task || !targetDateISO) return false;
  return toISODate(task.dateKey) === targetDateISO;
}

function getWeekKeyForDate(d, offset = 0) {
  const dateObj = d instanceof Date ? new Date(d) : parseISODate(d);
  dateObj.setDate(dateObj.getDate() - dateObj.getDay() + offset * 7); // Sunday start
  return `${dateObj.getFullYear()}-W${getWeekNumber(dateObj)}`;
}

function getWeekKey(offset = 0) {
  return getWeekKeyForDate(new Date(), offset);
}

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

function renderStars(count, max = 5) {
  return '⭐'.repeat(Math.max(0, Math.min(max, count))) + '☆'.repeat(Math.max(0, max - count));
}

function generateInviteCode(uid, weekKey) {
  let hash = 0;
  const str = uid + weekKey;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  return `QUEST-${hex}`;
}

function showToast(msg, icon = '✅') {
  const tIcon = $('toast-icon');
  const tMsg = $('toast-msg');
  const toast = $('toast');
  if (tIcon) tIcon.textContent = icon;
  if (tMsg) tMsg.textContent = msg;
  if (toast) {
    toast.classList.remove('hidden');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3000);
  }
}

function showXpPopup(xp) {
  const val = $('xp-popup-val');
  const pop = $('xp-popup');
  if (val) val.textContent = xp;
  if (pop) {
    pop.classList.remove('hidden');
    clearTimeout(pop._timeout);
    pop._timeout = setTimeout(() => pop.classList.add('hidden'), 2000);
  }
}

// ══════════════════════════════════════════════════════
//  THEME CONTROLLER
// ══════════════════════════════════════════════════════
function initThemes() {
  const savedTheme = localStorage.getItem('wq_theme') || 'cosmic';
  applyTheme(savedTheme);

  const themeBtn = $('theme-toggle-btn');
  const themeDropdown = $('theme-dropdown');

  if (themeBtn && themeDropdown) {
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      themeDropdown.classList.toggle('hidden');
    });

    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const theme = opt.dataset.theme;
        applyTheme(theme);
        themeDropdown.classList.add('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!themeDropdown.contains(e.target) && e.target !== themeBtn) {
        themeDropdown.classList.add('hidden');
      }
    });
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wq_theme', theme);
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
}

// ══════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════
$('go-register')?.addEventListener('click', () => {
  $('login-form').classList.remove('active');
  $('register-form').classList.add('active');
});
$('go-login')?.addEventListener('click', () => {
  $('register-form').classList.remove('active');
  $('login-form').classList.add('active');
});

$('login-btn')?.addEventListener('click', async () => {
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

$('register-btn')?.addEventListener('click', async () => {
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

$('logout-btn')?.addEventListener('click', async () => {
  if (tasksUnsub) { tasksUnsub(); tasksUnsub = null; }
  if (partnerUnsub) { partnerUnsub(); partnerUnsub = null; }
  await signOut(auth);
});

function showAuthError(id, msg) {
  const el = $(id); if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}
function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/email-already-in-use': 'Email already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait.',
    'auth/invalid-credential': 'Invalid email or password.',
  };
  return map[code] || 'Something went wrong. Try again.';
}

// Auth state observer
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    $('auth-overlay').classList.add('hidden');
    $('app').classList.remove('hidden');
    await initApp();
  } else {
    currentUser = null;
    if (tasksUnsub) { tasksUnsub(); tasksUnsub = null; }
    if (partnerUnsub) { partnerUnsub(); partnerUnsub = null; }
    $('auth-overlay').classList.remove('hidden');
    $('app').classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════
async function initApp() {
  selectedDateKey = todayISO();

  // Load user profile
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  userProfile = snap.exists() ? snap.data() : {};

  // Setup UI elements
  const name = currentUser.displayName || 'Hero';
  $('user-initials').textContent = name.slice(0,2).toUpperCase();
  $('dropdown-name').textContent = name;
  $('dropdown-email').textContent = currentUser.email;

  // Initialize Theme
  initThemes();

  // Load categories and start real-time tasks listener
  await loadCategories();
  await loadTasks();
  await loadWeeklyNotes();

  // Setup Schedule Controls & View Switcher
  setupScheduleControls();

  updateHeaderStats();
  renderWeeklyReview();
  setupPartnerTab();
}

// ══════════════════════════════════════════════════════
//  TABS CONTROLLER
// ══════════════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}-panel`).classList.add('active');
    if (btn.dataset.tab === 'schedule') {
      renderActiveScheduleView();
      renderWeekStrip();
      updateDayStats();
    }
    if (btn.dataset.tab === 'weekly') renderWeeklyReview();
    if (btn.dataset.tab === 'partner') setupPartnerTab();
  });
});

// User avatar dropdown
$('user-avatar-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('user-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => $('user-dropdown')?.classList.add('hidden'));

// ══════════════════════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════════════════════
async function loadCategories() {
  try {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'categories'));
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategorySelects();
  } catch (err) {
    console.error('Error loading categories:', err);
  }
}

function renderCategorySelects() {
  const taskCatSel = $('task-category');
  const filterSel  = $('category-filter');
  if (taskCatSel) {
    taskCatSel.innerHTML = '<option value="">Select category...</option>';
    categories.forEach(c => taskCatSel.appendChild(new Option(c.name, c.id)));
  }
  if (filterSel) {
    filterSel.innerHTML = '<option value="all">All Categories</option>';
    categories.forEach(c => filterSel.appendChild(new Option(c.name, c.id)));
  }
}

function renderCategoryManager() {
  const list = $('category-list-manage');
  if (!list) return;
  list.innerHTML = '';
  if (!categories.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px">No categories yet.</p>';
    return;
  }
  categories.forEach(c => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <span class="cat-dot" style="background:${c.color || '#7c3aed'}"></span>
      <span class="cat-name">${c.name}</span>
      <button class="cat-del-btn" data-id="${c.id}" title="Delete">🗑️</button>
    `;
    item.querySelector('.cat-del-btn').addEventListener('click', () => deleteCategory(c.id));
    list.appendChild(item);
  });
}

$('manage-categories-btn')?.addEventListener('click', () => {
  renderCategoryManager();
  $('category-modal').classList.remove('hidden');
});
$('close-category-modal')?.addEventListener('click', () => $('category-modal').classList.add('hidden'));
$('close-cat-footer')?.addEventListener('click', () => $('category-modal').classList.add('hidden'));

$('add-category-btn')?.addEventListener('click', async () => {
  const name  = $('new-category-input').value.trim();
  const color = $('new-category-color').value;
  if (!name) return;
  const ref = await addDoc(collection(db, 'users', currentUser.uid, 'categories'), { name, color });
  categories.push({ id: ref.id, name, color });
  $('new-category-input').value = '';
  renderCategorySelects();
  renderCategoryManager();
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
//  SCHEDULE & REAL-TIME TASKS SYNC
// ══════════════════════════════════════════════════════
async function loadTasks() {
  if (tasksUnsub) { tasksUnsub(); tasksUnsub = null; }
  
  // Real-time listener on user's tasks collection
  // No composite index required — guarantees tasks immediately appear!
  const q = collection(db, 'users', currentUser.uid, 'tasks');
  
  tasksUnsub = onSnapshot(q, snap => {
    allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderActiveScheduleView();
    renderWeekStrip();
    updateDayStats();
    updateHeaderStats();
    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'weekly') {
      renderWeeklyReview();
    }
  }, err => {
    console.error("Tasks onSnapshot error:", err);
    showToast('Sync error: ' + err.message, '⚠️');
  });
}

function getSelectedDayTasks() {
  let list = allTasks.filter(t => matchesDate(t, selectedDateKey));

  if (filterState.priority !== 'all') list = list.filter(t => t.priority === filterState.priority);
  if (filterState.category !== 'all') list = list.filter(t => t.categoryId === filterState.category);
  if (filterState.status !== 'all')   list = list.filter(t => filterState.status === 'done' ? t.done : !t.done);

  // Sort by startTime, then createdAt
  list.sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    const timeA = a.createdAt?.seconds || 0;
    const timeB = b.createdAt?.seconds || 0;
    return timeA - timeB;
  });

  return list;
}

function renderActiveScheduleView() {
  updateDateDisplays();
  
  // Show active view container
  $('view-schedule-table-container')?.classList.toggle('hidden', currentScheduleView !== 'table');
  $('view-timetable-container')?.classList.toggle('hidden', currentScheduleView !== 'timetable');
  $('view-cards-container')?.classList.toggle('hidden', currentScheduleView !== 'cards');

  // Update view switcher buttons
  document.querySelectorAll('.view-switch-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === currentScheduleView);
  });

  if (currentScheduleView === 'table') {
    renderScheduleTable();
  } else if (currentScheduleView === 'timetable') {
    renderTimetableGrid();
  } else {
    renderCardsView();
  }
}

// ──── VIEW 1: SCHEDULE TABLE ────
function renderScheduleTable() {
  const tbody = $('schedule-table-tbody');
  const empty = $('table-empty');
  if (!tbody) return;

  tbody.innerHTML = '';
  const dayTasks = getSelectedDayTasks();

  if (!dayTasks.length) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  dayTasks.forEach(task => {
    const cat = categories.find(c => c.id === task.categoryId);
    const xp  = XP_MAP[task.priority] || 25;

    const tr = document.createElement('tr');
    tr.className = `schedule-row ${task.done ? 'done' : ''}`;
    tr.dataset.priority = task.priority;

    const timeHtml = task.startTime
      ? `<span class="table-time-badge">⏰ ${task.startTime}${task.endTime ? ' → ' + task.endTime : ''}</span>`
      : `<span class="table-time-empty">Anytime</span>`;

    const catHtml = cat
      ? `<span class="table-cat-badge" style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55">${cat.name}</span>`
      : `<span style="color:var(--text-muted);font-size:0.75rem">—</span>`;

    tr.innerHTML = `
      <td class="table-time-cell">${timeHtml}</td>
      <td class="table-quest-cell">
        <div class="table-quest-title-wrap">
          <div class="table-check ${task.done ? 'checked' : ''}" data-id="${task.id}" title="${task.done ? 'Mark pending' : 'Complete quest'}"></div>
          <span class="table-quest-title">${escapeHtml(task.name)}</span>
        </div>
        ${task.notes ? `<div class="table-quest-notes">📝 ${escapeHtml(task.notes)}</div>` : ''}
      </td>
      <td>${catHtml}</td>
      <td>
        <span class="table-prio-badge" style="background:var(--prio-${task.priority})22;color:var(--prio-${task.priority})">
          ${PRIORITY_LABEL[task.priority]}
          <span class="table-xp-pill">+${xp} XP</span>
        </span>
      </td>
      <td>
        <span class="table-status-pill ${task.done ? 'done' : 'pending'}" data-id="${task.id}">
          ${task.done ? '✓ Done' : '⏳ Pending'}
        </span>
      </td>
      <td>
        <div class="table-actions">
          <button class="task-action-btn edit-btn" data-id="${task.id}" title="Edit Quest">✏️</button>
          <button class="task-action-btn delete delete-btn" data-id="${task.id}" title="Delete Quest">🗑️</button>
        </div>
      </td>
    `;

    // Toggle done on check or status click
    tr.querySelector('.table-check').addEventListener('click', () => toggleTask(task.id, task.done, task.priority));
    tr.querySelector('.table-status-pill').addEventListener('click', () => toggleTask(task.id, task.done, task.priority));

    // Edit & delete
    tr.querySelector('.edit-btn').addEventListener('click', () => openEditTask(task));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));

    tbody.appendChild(tr);
  });
}

// ──── VIEW 2: HOURLY TIMETABLE GRID ────
function renderTimetableGrid() {
  const grid = $('timetable-grid');
  const untimedBox = $('untimed-quests-box');
  const untimedList = $('untimed-list');
  const untimedCount = $('untimed-count');
  if (!grid) return;

  grid.innerHTML = '';
  const dayTasks = getSelectedDayTasks();

  // Separate untimed tasks
  const timedTasks = dayTasks.filter(t => !!t.startTime);
  const untimedTasks = dayTasks.filter(t => !t.startTime);

  if (untimedBox && untimedList) {
    if (untimedTasks.length > 0) {
      untimedBox.classList.remove('hidden');
      untimedCount.textContent = `${untimedTasks.length} quest${untimedTasks.length > 1 ? 's' : ''}`;
      untimedList.innerHTML = '';
      untimedTasks.forEach(task => {
        const card = createTimetableQuestCard(task);
        untimedList.appendChild(card);
      });
    } else {
      untimedBox.classList.add('hidden');
    }
  }

  // Current time marker calculation (if today)
  const isToday = selectedDateKey === todayISO();
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();

  // Generate hourly slots from 06:00 to 23:00
  for (let h = 6; h <= 23; h++) {
    const hourStr = String(h).padStart(2, '0') + ':00';
    const displayHour = formatHourLabel(h);

    const row = document.createElement('div');
    row.className = 'time-row';

    // If current time falls in this hour
    if (isToday && currentHour === h) {
      const topOffsetPercent = (currentMinutes / 60) * 100;
      const marker = document.createElement('div');
      marker.className = 'current-time-marker';
      marker.style.top = `${topOffsetPercent}%`;
      row.appendChild(marker);
    }

    const slot = document.createElement('div');
    slot.className = 'time-slot';

    // Find tasks in this hour
    const slotTasks = timedTasks.filter(t => {
      const taskHour = parseInt(t.startTime.split(':')[0], 10);
      return taskHour === h;
    });

    slotTasks.forEach(task => {
      slot.appendChild(createTimetableQuestCard(task));
    });

    // Quick add button
    const addBtn = document.createElement('button');
    addBtn.className = 'time-slot-add-btn';
    addBtn.innerHTML = `+ Add at ${hourStr}`;
    addBtn.addEventListener('click', () => openAddTask(selectedDateKey, hourStr));
    slot.appendChild(addBtn);

    row.innerHTML = `<div class="time-label">${displayHour}</div>`;
    row.appendChild(slot);
    grid.appendChild(row);
  }
}

function createTimetableQuestCard(task) {
  const cat = categories.find(c => c.id === task.categoryId);
  const xp  = XP_MAP[task.priority] || 25;

  const card = document.createElement('div');
  card.className = `timetable-quest-card ${task.done ? 'done' : ''}`;
  card.dataset.priority = task.priority;

  card.innerHTML = `
    <div class="table-check ${task.done ? 'checked' : ''}" data-id="${task.id}" title="Toggle complete"></div>
    <span class="t-quest-name">${escapeHtml(task.name)}</span>
    ${task.startTime ? `<span class="t-quest-time">${task.startTime}${task.endTime ? ' - '+task.endTime : ''}</span>` : ''}
    ${cat ? `<span class="table-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.name}</span>` : ''}
    <span class="table-xp-pill">+${xp} XP</span>
    <div class="table-actions">
      <button class="task-action-btn edit-btn" title="Edit">✏️</button>
      <button class="task-action-btn delete delete-btn" title="Delete">🗑️</button>
    </div>
  `;

  card.querySelector('.table-check').addEventListener('click', () => toggleTask(task.id, task.done, task.priority));
  card.querySelector('.edit-btn').addEventListener('click', () => openEditTask(task));
  card.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));
  return card;
}

function formatHourLabel(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayH = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayH}:00 ${period}`;
}

// ──── VIEW 3: CARDS VIEW ────
function renderCardsView() {
  const list  = $('task-list');
  const empty = $('tasks-empty');
  if (!list) return;

  list.querySelectorAll('.task-card').forEach(c => c.remove());
  const dayTasks = getSelectedDayTasks();

  if (!dayTasks.length) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  dayTasks.forEach(task => {
    const cat = categories.find(c => c.id === task.categoryId);
    const xp  = XP_MAP[task.priority] || 25;

    const card = document.createElement('div');
    card.className = `task-card ${task.done ? 'done' : ''}`;
    card.dataset.priority = task.priority;

    card.innerHTML = `
      <div class="task-check ${task.done ? 'checked' : ''}" data-id="${task.id}"></div>
      <div class="task-body">
        <div class="task-name">${escapeHtml(task.name)}</div>
        <div class="task-meta">
          ${task.startTime ? `<span class="task-time">⏰ ${task.startTime}${task.endTime ? ' → '+task.endTime : ''}</span>` : ''}
          ${cat ? `<span class="task-cat-badge" style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}44">${cat.name}</span>` : ''}
          <span class="task-prio-badge" style="background:var(--prio-${task.priority})22;color:var(--prio-${task.priority})">${PRIORITY_LABEL[task.priority]}</span>
          <span class="task-xp-badge">+${xp} XP</span>
        </div>
        ${task.notes ? `<div class="task-notes">📝 ${escapeHtml(task.notes)}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit-btn" data-id="${task.id}" title="Edit">✏️</button>
        <button class="task-action-btn delete delete-btn" data-id="${task.id}" title="Delete">🗑️</button>
      </div>
    `;

    card.querySelector('.task-check').addEventListener('click', () => toggleTask(task.id, task.done, task.priority));
    card.querySelector('.edit-btn').addEventListener('click', () => openEditTask(task));
    card.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));

    list.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════
//  WEEK STRIP & DAY NAVIGATION
// ══════════════════════════════════════════════════════
function setupScheduleControls() {
  // Day navigation buttons
  $('prev-day-btn')?.addEventListener('click', () => changeSelectedDate(-1));
  $('next-day-btn')?.addEventListener('click', () => changeSelectedDate(1));
  $('go-today-btn')?.addEventListener('click', () => {
    selectedDateKey = todayISO();
    renderActiveScheduleView();
    renderWeekStrip();
    updateDayStats();
  });

  // Direct date picker
  const dateInput = $('date-jump-input');
  if (dateInput) {
    dateInput.value = selectedDateKey || todayISO();
    dateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        selectedDateKey = toISODate(e.target.value);
        renderActiveScheduleView();
        renderWeekStrip();
        updateDayStats();
      }
    });
  }

  // View switchers
  document.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentScheduleView = btn.dataset.view;
      localStorage.setItem('wq_schedule_view', currentScheduleView);
      renderActiveScheduleView();
    });
  });

  // Empty state button
  $('table-add-first-btn')?.addEventListener('click', () => openAddTask(selectedDateKey));

  // Filters
  $('priority-filter')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    $('priority-filter').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filterState.priority = chip.dataset.value;
    renderActiveScheduleView();
  });

  $('status-filter')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    $('status-filter').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    filterState.status = chip.dataset.value;
    renderActiveScheduleView();
  });

  $('category-filter')?.addEventListener('change', e => {
    filterState.category = e.target.value;
    renderActiveScheduleView();
  });
}

function changeSelectedDate(deltaDays) {
  const current = parseISODate(selectedDateKey);
  current.setDate(current.getDate() + deltaDays);
  selectedDateKey = toISODate(current);
  renderActiveScheduleView();
  renderWeekStrip();
  updateDayStats();
}

function updateDateDisplays() {
  const curDate = parseISODate(selectedDateKey);
  const isToday = selectedDateKey === todayISO();

  const formattedFull = curDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const formattedShort = curDate.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  if ($('today-date')) $('today-date').textContent = formattedFull;
  if ($('nav-day-label')) $('nav-day-label').textContent = isToday ? "Today" : curDate.toLocaleDateString('en-US', { weekday: 'short' });
  if ($('nav-day-date')) $('nav-day-date').textContent = formattedShort;
  if ($('date-jump-input')) $('date-jump-input').value = selectedDateKey;
}

function renderWeekStrip() {
  const container = $('week-strip-container');
  if (!container) return;
  container.innerHTML = '';

  const curDate = parseISODate(selectedDateKey);
  // Find Sunday of this week
  const sunday = new Date(curDate);
  sunday.setDate(sunday.getDate() - sunday.getDay());

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayStr = todayISO();

  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(d.getDate() + i);
    const iso = toISODate(d);
    const dayTasks = allTasks.filter(t => matchesDate(t, iso));
    const dayDone = dayTasks.filter(t => t.done).length;
    const isSelected = iso === selectedDateKey;
    const isToday = iso === todayStr;

    const card = document.createElement('div');
    card.className = `strip-day-card ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`;
    card.innerHTML = `
      <span class="strip-day-name">${dayNames[i]}</span>
      <span class="strip-day-num">${d.getDate()}</span>
      <div class="strip-day-meta">
        ${dayTasks.length > 0 ? `<span class="strip-day-badge">${dayDone}/${dayTasks.length}</span>` : '<span class="strip-day-badge">0</span>'}
      </div>
    `;

    card.addEventListener('click', () => {
      selectedDateKey = iso;
      renderActiveScheduleView();
      renderWeekStrip();
      updateDayStats();
    });

    container.appendChild(card);
  }
}

// ══════════════════════════════════════════════════════
//  TASK ACTIONS (TOGGLE, ADD, EDIT, DELETE)
// ══════════════════════════════════════════════════════
async function toggleTask(id, wasDone, priority) {
  const nowDone = !wasDone;
  const xp = XP_MAP[priority] || 25;

  // Optimistic UI update
  const t = allTasks.find(item => item.id === id);
  if (t) t.done = nowDone;
  renderActiveScheduleView();
  renderWeekStrip();
  updateDayStats();

  try {
    await updateDoc(doc(db, 'users', currentUser.uid, 'tasks', id), { done: nowDone });
    if (nowDone) {
      showXpPopup(xp);
      showToast(`+${xp} XP! Quest completed! ⚔️`, '✅');
      await updateUserStats(xp, priority);
    } else {
      await updateUserStats(-xp, null, true);
    }
  } catch (err) {
    console.error('Error toggling task:', err);
    showToast('Failed to update task: ' + err.message, '⚠️');
  }
}

async function updateUserStats(xpDelta, priority = null, reverse = false) {
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
  if (!confirm('Are you sure you want to delete this quest?')) return;
  // Optimistic remove
  allTasks = allTasks.filter(t => t.id !== id);
  renderActiveScheduleView();
  renderWeekStrip();
  updateDayStats();

  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'tasks', id));
    showToast('Quest deleted.', '🗑️');
  } catch (err) {
    console.error('Error deleting task:', err);
    showToast('Delete failed: ' + err.message, '⚠️');
  }
}

// ──── Task Modal ────
$('open-add-task')?.addEventListener('click', () => openAddTask(selectedDateKey));
$('close-task-modal')?.addEventListener('click', closeTaskModal);
$('cancel-task-modal')?.addEventListener('click', closeTaskModal);
$('save-task-btn')?.addEventListener('click', saveTask);

function openAddTask(initialDate = null, initialStartTime = null) {
  editingTaskId = null;
  $('task-modal-title').textContent = 'New Quest';
  $('task-name').value      = '';
  $('task-date').value      = initialDate || selectedDateKey || todayISO();
  $('task-start').value     = initialStartTime || '';
  $('task-end').value       = '';
  $('task-priority').value  = 'medium';
  $('task-category').value  = '';
  $('task-notes').value     = '';
  $('task-modal-error').classList.add('hidden');
  $('task-modal').classList.remove('hidden');
  $('task-name').focus();
}

function openEditTask(task) {
  editingTaskId = task.id;
  $('task-modal-title').textContent = 'Edit Quest';
  $('task-name').value      = task.name || '';
  $('task-date').value      = toISODate(task.dateKey) || selectedDateKey || todayISO();
  $('task-start').value     = task.startTime || '';
  $('task-end').value       = task.endTime || '';
  $('task-priority').value  = task.priority || 'medium';
  $('task-category').value  = task.categoryId || '';
  $('task-notes').value     = task.notes || '';
  $('task-modal-error').classList.add('hidden');
  $('task-modal').classList.remove('hidden');
  $('task-name').focus();
}

function closeTaskModal() {
  $('task-modal').classList.add('hidden');
}

async function saveTask() {
  const name = $('task-name').value.trim();
  if (!name) { showTaskError('Task name is required.'); return; }

  const taskDateISO = toISODate($('task-date').value) || selectedDateKey || todayISO();
  const weekKey = getWeekKeyForDate(taskDateISO);

  const payload = {
    name,
    startTime:  $('task-start').value || null,
    endTime:    $('task-end').value || null,
    priority:   $('task-priority').value,
    categoryId: $('task-category').value || null,
    notes:      $('task-notes').value.trim() || null,
    dateKey:    taskDateISO,
    weekKey:    weekKey,
  };

  const saveBtn = $('save-task-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    if (editingTaskId) {
      await updateDoc(doc(db, 'users', currentUser.uid, 'tasks', editingTaskId), payload);
      // Update local object immediately
      const idx = allTasks.findIndex(t => t.id === editingTaskId);
      if (idx !== -1) allTasks[idx] = { ...allTasks[idx], ...payload };
      showToast('Quest updated!', '✏️');
    } else {
      payload.done = false;
      payload.createdAt = serverTimestamp();
      const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'tasks'), payload);
      allTasks.push({ id: docRef.id, ...payload });
      showToast('Quest scheduled!', '⚔️');
    }

    // Switch view to the task's date so user immediately sees their created quest!
    selectedDateKey = taskDateISO;
    closeTaskModal();
    renderActiveScheduleView();
    renderWeekStrip();
    updateDayStats();
  } catch (err) {
    console.error('Error saving task:', err);
    showTaskError('Failed to save quest: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Quest';
  }
}

function showTaskError(msg) {
  const el = $('task-modal-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

// ──── Stats updates ────
function updateDayStats() {
  const dayTasks = allTasks.filter(t => matchesDate(t, selectedDateKey));
  const doneTasks = dayTasks.filter(t => t.done);
  const dayXP     = doneTasks.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
  const stars     = xpToStars(dayXP);

  if ($('today-xp-display')) $('today-xp-display').textContent  = `${dayXP} XP`;
  if ($('today-stars-display')) $('today-stars-display').textContent = renderStars(stars);
  
  const progBadge = $('day-progress-badge');
  if (progBadge) {
    const pct = dayTasks.length ? Math.round((doneTasks.length / dayTasks.length) * 100) : 0;
    progBadge.textContent = `${doneTasks.length}/${dayTasks.length} Quests Done (${pct}%)`;
  }
}

function updateHeaderStats() {
  const snap = userProfile || {};
  if ($('header-xp')) $('header-xp').textContent    = `${snap.totalXP || 0} XP`;
  if ($('header-stars')) $('header-stars').textContent = `${xpToStars(snap.totalXP || 0)} ⭐`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ══════════════════════════════════════════════════════
//  WEEKLY REVIEW TAB
// ══════════════════════════════════════════════════════
async function loadWeeklyNotes() {
  const wk = getWeekKey(currentWeekOffset);
  try {
    const ref = doc(db, 'users', currentUser.uid, 'weeklyNotes', wk);
    const snap = await getDoc(ref);
    weeklyNotes = snap.exists() ? snap.data() : { benefits:[], negative:[], improvements:[] };
  } catch (err) {
    console.error('Error loading weekly notes:', err);
    weeklyNotes = { benefits:[], negative:[], improvements:[] };
  }
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
  const weekStart = getWeekStartDate(currentWeekOffset);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);

  if ($('week-range-display')) {
    $('week-range-display').textContent =
      `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  }

  // Filter tasks from cached allTasks for this week
  const weekTasks = allTasks.filter(t => t.weekKey === wk);
  const doneTasks = weekTasks.filter(t => t.done);
  const weekXP = doneTasks.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
  const weekStars = doneTasks.reduce((s,t) => s + xpToStars(XP_MAP[t.priority] || 0), 0);
  const completionRate = weekTasks.length ? Math.round((doneTasks.length / weekTasks.length) * 100) : 0;
  const lv = calcLevel((userProfile?.totalXP || 0));

  if ($('week-total-xp')) $('week-total-xp').textContent       = weekXP;
  if ($('week-total-stars')) $('week-total-stars').textContent = weekStars;
  if ($('week-level')) $('week-level').textContent            = `Lv ${lv.level}`;
  if ($('week-level-badge')) $('week-level-badge').textContent = lv.name;
  if ($('week-tasks-done')) $('week-tasks-done').textContent   = doneTasks.length;
  if ($('week-completion-rate')) $('week-completion-rate').textContent = `${completionRate}% Done`;

  if ($('week-xp-bar')) $('week-xp-bar').style.width = `${Math.min(100, (weekXP / 1000) * 100)}%`;
  if ($('week-star-row')) $('week-star-row').textContent = renderStars(Math.min(5, Math.floor(weekStars / 5)));
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
  if (!listEl || !emptyEl) return;
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
      <span class="wcard-item-text">${escapeHtml(text)}</span>
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

// Weekly item modal
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
$('close-weekly-item-modal')?.addEventListener('click', () => $('weekly-item-modal').classList.add('hidden'));
$('cancel-weekly-item')?.addEventListener('click', () => $('weekly-item-modal').classList.add('hidden'));
$('save-weekly-item')?.addEventListener('click', async () => {
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
$('prev-week-btn')?.addEventListener('click', async () => { currentWeekOffset--; await renderWeeklyReview(); });
$('next-week-btn')?.addEventListener('click', async () => { currentWeekOffset++; await renderWeeklyReview(); });

// Level Journey
function renderLevelJourney() {
  const totalXP = userProfile?.totalXP || 0;
  const currentLv = calcLevel(totalXP);
  const container = $('level-journey');
  if (!container) return;
  container.innerHTML = '';
  LEVELS.slice(0, 6).forEach(lv => {
    const div = document.createElement('div');
    div.className = `level-row ${lv.level === currentLv.level ? 'current-level' : ''}`;
    const reached = totalXP >= lv.xp;
    div.innerHTML = `
      <span class="level-num">${reached ? '✅' : '🔒'} Lv${lv.level}</span>
      <span class="level-name">${lv.name}</span>
      <span class="level-xp-req">${lv.xp.toLocaleString()} XP</span>
    `;
    container.appendChild(div);
  });
}

// Badges
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
  const grid = $('badges-grid');
  if (!grid) return;
  grid.innerHTML = '';
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

// Day by Day
function renderDayByDay() {
  const container = $('days-row');
  if (!container) return;
  container.innerHTML = '';

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const start = getWeekStartDate(currentWeekOffset);
  const todayStr = todayISO();

  days.forEach((name, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dk = toISODate(d);
    const dayTasks = allTasks.filter(t => matchesDate(t, dk));
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
  if (!currentUser) return;
  const uid  = currentUser.uid;
  const code = generateInviteCode(uid, getWeekKey());
  if ($('invite-code-text')) $('invite-code-text').textContent = code;

  // Store invite code in Firestore for lookup
  setDoc(doc(db, 'inviteCodes', code), { uid, weekKey: getWeekKey() }, { merge: true });

  // Check if already connected
  const saved = localStorage.getItem(`partner_${uid}_${getWeekKey()}`);
  if (saved) {
    try {
      const pd = JSON.parse(saved);
      loadPartnerProgress(pd.uid, pd.name);
    } catch(e) {}
  }
}

$('copy-code-btn')?.addEventListener('click', () => {
  navigator.clipboard.writeText($('invite-code-text').textContent)
    .then(() => showToast('Invite code copied!', '📋'));
});

$('connect-partner-btn')?.addEventListener('click', async () => {
  const code = $('partner-code-input').value.trim().toUpperCase();
  if (!code) return;
  $('connect-error').classList.add('hidden');

  try {
    const ref = doc(db, 'inviteCodes', code);
    const snap = await getDoc(ref);
    if (!snap.exists()) { showConnectError('Invalid invite code. Ask your partner to share theirs.'); return; }
    const { uid: partnerUid } = snap.data();
    if (partnerUid === currentUser.uid) { showConnectError("That's your own code!"); return; }

    const pSnap = await getDoc(doc(db, 'users', partnerUid));
    if (!pSnap.exists()) { showConnectError('Partner account not found.'); return; }
    const pData = pSnap.data();

    const weekKey = getWeekKey();
    localStorage.setItem(`partner_${currentUser.uid}_${weekKey}`, JSON.stringify({ uid: partnerUid, name: pData.displayName }));
    await updateDoc(doc(db, 'users', currentUser.uid), { hasPartner: true });
    userProfile = { ...userProfile, hasPartner: true };

    showToast(`Connected with ${pData.displayName}!`, '🤝');
    loadPartnerProgress(partnerUid, pData.displayName);
  } catch (err) {
    showConnectError('Failed to connect: ' + err.message);
  }
});

function showConnectError(msg) {
  const el = $('connect-error'); if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

async function loadPartnerProgress(partnerUid, partnerName) {
  try {
    const pSnap = await getDoc(doc(db, 'users', partnerUid));
    if (!pSnap.exists()) return;
    const pd = pSnap.data();

    const wk = getWeekKey();
    const q = query(collection(db, 'users', partnerUid, 'tasks'), where('weekKey', '==', wk));
    const tSnap = await getDocs(q);
    const pTasks = tSnap.docs.map(d => d.data());
    const pDone = pTasks.filter(t => t.done);
    const pWeekXP = pDone.reduce((s,t) => s + (XP_MAP[t.priority] || 0), 0);
    const pLevel = calcLevel(pd.totalXP || 0);

    $('partner-progress-section')?.classList.remove('hidden');
    const initials = (partnerName || 'P').slice(0,2).toUpperCase();
    if ($('partner-avatar')) $('partner-avatar').textContent = initials;
    if ($('partner-name')) $('partner-name').textContent = partnerName;
    if ($('partner-level-label')) $('partner-level-label').textContent = `Level ${pLevel.level} — ${pLevel.name}`;
    if ($('partner-xp')) $('partner-xp').textContent   = pWeekXP;
    if ($('partner-stars')) $('partner-stars').textContent = xpToStars(pWeekXP);
    if ($('partner-tasks')) $('partner-tasks').textContent = pDone.length;
    if ($('partner-level')) $('partner-level').textContent = `Lv ${pLevel.level}`;

    const myXP = (userProfile?.totalXP || 0);
    const total = myXP + pWeekXP || 1;
    if ($('h2h-you-name')) $('h2h-you-name').textContent     = currentUser.displayName?.split(' ')[0] || 'You';
    if ($('h2h-partner-name')) $('h2h-partner-name').textContent = partnerName.split(' ')[0];
    if ($('h2h-you-xp')) $('h2h-you-xp').textContent       = myXP;
    if ($('h2h-partner-xp')) $('h2h-partner-xp').textContent   = pWeekXP;
    if ($('h2h-you-bar')) $('h2h-you-bar').style.width      = `${(myXP / total) * 100}%`;
    if ($('h2h-partner-bar')) $('h2h-partner-bar').style.width  = `${(pWeekXP / total) * 100}%`;

    if (partnerUnsub) partnerUnsub();
    partnerUnsub = onSnapshot(doc(db, 'users', partnerUid), snap => {
      if (snap.exists()) loadPartnerProgress(partnerUid, partnerName);
    });
  } catch (err) {
    console.error('Error loading partner progress:', err);
  }
}

$('disconnect-partner-btn')?.addEventListener('click', () => {
  const weekKey = getWeekKey();
  localStorage.removeItem(`partner_${currentUser.uid}_${weekKey}`);
  if (partnerUnsub) { partnerUnsub(); partnerUnsub = null; }
  $('partner-progress-section')?.classList.add('hidden');
  $('partner-code-input').value = '';
  showToast('Disconnected from partner.', '👋');
});
