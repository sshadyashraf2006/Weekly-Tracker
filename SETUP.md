# WeeklyQuest — Setup Guide

## 🚀 Getting Started

### Step 1: Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"** → give it a name (e.g. `weeklyquest`) → click through the setup
3. Disable Google Analytics if you don't need it (optional)

---

### Step 2: Enable Email/Password Authentication

1. In the Firebase console, click **Authentication** in the left sidebar
2. Click **"Get started"**
3. Under **Sign-in method**, click **Email/Password**
4. Toggle it **ON** → click **Save**

---

### Step 3: Create a Firestore Database

1. Click **Firestore Database** in the left sidebar
2. Click **"Create database"**
3. Choose **"Start in test mode"** (we'll secure it after)
4. Pick a region close to you → click **Enable**

---

### Step 4: Apply Security Rules

1. In Firestore → click **Rules** tab
2. Replace the default rules with the contents of `firestore.rules` in this project
3. Click **Publish**

---

### Step 5: Register a Web App & Get Config

1. Click the **gear icon** ⚙️ → **Project settings**
2. Scroll down to **"Your apps"** → click the **`</>`** (Web) icon
3. Enter an app nickname (e.g. `weeklyquest-web`) → click **Register app**
4. You'll see a code block like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

5. Open `js/firebase-config.js` in this project
6. **Replace the placeholder values** with your actual config

---

### Step 6: Open the App

- Open `index.html` directly in a browser, **or**
- Use a local dev server (recommended to avoid CORS issues):

```bash
# If you have Node.js:
npx -y serve .

# Or Python:
python -m http.server 8080
```

Then visit `http://localhost:8080`

---

## 🎮 Features Overview

### Tab 1 — Schedule
- ✅ Add tasks with start/end time, priority & category
- ✅ Custom categories with color picker
- ✅ Filter by priority, category, or status
- ✅ Check off tasks to earn XP
- ✅ XP converts to ⭐ stars at the end of the day

**XP Values:**
| Priority | XP |
|---|---|
| 🟢 Low | 10 XP |
| 🟡 Medium | 25 XP |
| 🟠 High | 50 XP |
| 🔴 Critical | 100 XP |

**Stars System:**
| XP Earned | Stars |
|---|---|
| 10+ | ⭐☆☆☆☆ |
| 50+ | ⭐⭐☆☆☆ |
| 100+ | ⭐⭐⭐☆☆ |
| 200+ | ⭐⭐⭐⭐☆ |
| 300+ | ⭐⭐⭐⭐⭐ |

---

### Tab 2 — Week Review
- 📊 Total XP, Stars, Level, and completion rate for the week
- 🌟 Benefits Gained section (manually add)
- ⚠️ Negative Feedback section (manually add)
- 🏆 Level Progression tracker (Lv 1–10)
- 📈 How I Improved section (manually add)
- 🎖️ 12 Achievement Badges (auto-unlocked based on progress)
- 📅 Day-by-day breakdown with stars and XP

---

### Tab 3 — Partner
- 🔑 Auto-generated weekly invite code (resets each week)
- 🔗 Enter a partner's code to connect
- 📊 See their XP, stars, tasks done, and level
- ⚔️ Head-to-head XP comparison bar
- 🔴 Real-time updates when partner completes tasks

---

## 🏆 Achievement Badges

| Badge | Requirement |
|---|---|
| 🗡️ First Quest | Complete 1 task |
| ⚔️ Warrior | Complete 10 tasks |
| 🛡️ Knight | Complete 50 tasks |
| 🔥 Critical Hit | Complete a Critical task |
| 🌟 On Fire | 3-day streak |
| 💫 Week Warrior | 7-day streak |
| ⚡ Energized | Earn 500 XP total |
| 🌩️ Thunder Lord | Earn 5000 XP total |
| 🏆 Perfect Day | Complete all tasks in a day |
| 👑 Royalty | Reach Level 5 |
| 🤝 Accountable | Connect with a partner |
| 🏷️ Organizer | Create 3 categories |

---

## 📁 File Structure

```
Weekly Tracker/
├── index.html              # Main app
├── css/
│   └── style.css           # Styling (glassmorphism, dark mode)
├── js/
│   ├── firebase-config.js  # 🔑 Your Firebase config goes here
│   └── app.js              # All app logic
├── firestore.rules         # Security rules for Firestore
└── SETUP.md                # This file
```
