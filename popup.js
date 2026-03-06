const urlInput = document.getElementById('url-input');
const includeContainer = document.getElementById('include-chips');
const excludeContainer = document.getElementById('exclude-chips');
const startBtn = document.getElementById('start-btn');

let knownUsers = [];
let excludedUsers = [];

// --- Render ---

function renderChips() {
  const included = knownUsers.filter(u => !excludedUsers.includes(u));

  includeContainer.innerHTML = '';
  excludeContainer.innerHTML = '';

  if (included.length === 0 && excludedUsers.length === 0) {
    includeContainer.innerHTML = '<span class="empty-msg">Run a standup to discover users</span>';
    return;
  }

  for (const name of included) {
    const chip = document.createElement('span');
    chip.className = 'chip chip--include';
    chip.textContent = name;
    const btn = document.createElement('button');
    btn.textContent = '\u00d7';
    btn.title = 'Exclude';
    btn.addEventListener('click', () => excludeUser(name));
    chip.appendChild(btn);
    includeContainer.appendChild(chip);
  }

  for (const name of excludedUsers) {
    const chip = document.createElement('span');
    chip.className = 'chip chip--exclude';
    chip.textContent = name;
    const btn = document.createElement('button');
    btn.textContent = '+';
    btn.title = 'Include';
    btn.addEventListener('click', () => includeUser(name));
    chip.appendChild(btn);
    excludeContainer.appendChild(chip);
  }

  if (included.length === 0) {
    includeContainer.innerHTML = '<span class="empty-msg">All users excluded</span>';
  }
  if (excludedUsers.length === 0) {
    excludeContainer.innerHTML = '<span class="empty-msg">None</span>';
  }
}

// --- Chip interactions ---

function excludeUser(name) {
  if (!excludedUsers.includes(name)) {
    excludedUsers.push(name);
  }
  renderChips();
}

function includeUser(name) {
  excludedUsers = excludedUsers.filter(u => u !== name);
  renderChips();
}

// --- Submit ---

async function submit() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    urlInput.focus();
    return;
  }

  // Save settings
  await chrome.storage.local.set({ standupUrl: rawUrl, excludedUsers });

  // Build URL with noRedirect param
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    urlInput.focus();
    return;
  }
  url.searchParams.set('noRedirect', '1');

  // Tell background to open tab and inject scripts
  await chrome.runtime.sendMessage({ action: 'startStandup', url: url.toString(), excludedUsers });
  window.close();
}

startBtn.addEventListener('click', submit);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

// --- Init ---

chrome.storage.local.get(['standupUrl', 'excludedUsers', 'knownUsers'], (data) => {
  if (data.standupUrl) urlInput.value = data.standupUrl;
  knownUsers = data.knownUsers || [];
  excludedUsers = data.excludedUsers || [];
  renderChips();
});
