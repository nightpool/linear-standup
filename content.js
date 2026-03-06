(() => {
  let excludedUsers = [];

  let standupActive = false;
  let userRows = []; // filtered, shuffled user row elements
  let currentIndex = -1; // -1 means not started yet
  let timerIntervals = new Map(); // row element -> interval id
  let timerStartTimes = new Map(); // row element -> start timestamp
  let timerSpans = new Map(); // row element -> timer span element
  let standupStartTime = null;

  // --- DOM Helpers ---

  const GROUP_BTN_SELECTOR = 'button[aria-label="Open group"], button[aria-label="Collapse group"]';

  function findContainer() {
    const btns = document.querySelectorAll(GROUP_BTN_SELECTOR);
    if (btns.length === 0) return null;

    // Walk up from the first group button to find the container
    // The container is the element whose children are all the user rows
    let el = btns[0];
    for (let i = 0; i < 15; i++) {
      el = el.parentElement;
      if (!el) return null;
      const childGroupBtns = [];
      for (const child of el.children) {
        if (child.querySelector(GROUP_BTN_SELECTOR)) {
          childGroupBtns.push(child);
        }
      }
      if (childGroupBtns.length > 1) {
        return el;
      }
    }
    return null;
  }

  function getUserName(rowEl) {
    const spans = rowEl.querySelectorAll('span');
    for (const s of spans) {
      const t = s.textContent.trim();
      if (t && t.length > 1 && !/^\d+$/.test(t)) {
        return t;
      }
    }
    return '';
  }

  function isExcluded(name) {
    const lower = name.toLowerCase();
    if (lower === 'no assignee') return true;
    return excludedUsers.some(ex => ex.toLowerCase() === lower);
  }

  function getGroupButton(rowEl) {
    return rowEl.querySelector(GROUP_BTN_SELECTOR);
  }

  function isGroupOpen(rowEl) {
    const btn = getGroupButton(rowEl);
    return btn && btn.getAttribute('aria-label') === 'Collapse group';
  }

  // Find the count span to insert timer after it
  function getCountSpan(rowEl) {
    const spans = rowEl.querySelectorAll('span');
    for (const s of spans) {
      const t = s.textContent.trim();
      if (/^\d+$/.test(t)) {
        return s;
      }
    }
    return null;
  }

  // --- Timer ---

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  function createTimerSpan(rowEl) {
    const existing = timerSpans.get(rowEl);
    if (existing) return existing;

    const span = document.createElement('span');
    span.className = 'standup-timer';
    span.textContent = '0:00';

    const countSpan = getCountSpan(rowEl);
    if (countSpan) {
      // Insert after the count span's parent (to stay in the same flex row)
      countSpan.parentElement.insertAdjacentElement('afterend', span);
    } else {
      // Fallback: append to the row's inner content area
      const innerDiv = rowEl.querySelector('button[aria-label="Open group"]')?.parentElement?.parentElement;
      if (innerDiv) {
        innerDiv.appendChild(span);
      }
    }

    timerSpans.set(rowEl, span);
    return span;
  }

  function startTimer(rowEl) {
    const span = createTimerSpan(rowEl);
    span.textContent = '0:00';
    span.classList.remove('standup-timer--done');
    span.classList.add('standup-timer--active');

    const start = Date.now();
    timerStartTimes.set(rowEl, start);

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      span.textContent = formatTime(elapsed);
    }, 1000);

    timerIntervals.set(rowEl, interval);
  }

  function stopTimer(rowEl) {
    const interval = timerIntervals.get(rowEl);
    if (interval) {
      clearInterval(interval);
      timerIntervals.delete(rowEl);
    }

    const span = timerSpans.get(rowEl);
    if (span) {
      // Final update
      const start = timerStartTimes.get(rowEl);
      if (start) {
        span.textContent = formatTime(Date.now() - start);
      }
      span.classList.remove('standup-timer--active');
      span.classList.add('standup-timer--done');
    }
  }

  // --- Shuffle (Fisher-Yates) ---

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Core ---

  async function disableVirtualizer() {
    let scroller = document.querySelector('[data-virtuoso-scroller]');
    if (!scroller) {
      scroller = await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const el = document.querySelector('[data-virtuoso-scroller]');
          if (el) {
            observer.disconnect();
            resolve(el);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
    scroller.parentElement.style.height = '99999px';
    scroller.parentElement.style.overflow = 'hidden';
    scroller.parentElement.style.overscrollBehavior = 'unset';
    scroller.parentElement.style.scrollPadding = 'unset';
    scroller.parentElement.parentElement.style.overflow = 'scroll';

    // Let the virtualizer re-render all rows
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  async function startStandup(excluded) {
    excludedUsers = excluded;

    // Wait for the virtualizer to appear, then disable it so all rows render
    await disableVirtualizer();

    const container = findContainer();
    if (!container) {
      return { error: 'Could not find user rows. Is this a standup view?' };
    }

    // Collect all child rows
    const allChildren = Array.from(container.children);
    const userRowElements = [];
    const nonUserRows = [];
    const allUserNames = [];

    const excludedRows = [];

    for (const child of allChildren) {
      const btn = child.querySelector(GROUP_BTN_SELECTOR);
      if (btn) {
        const name = getUserName(child);
        if (name && name.toLowerCase() !== 'no assignee') {
          allUserNames.push(name);
        }
        if (isExcluded(name)) {
          excludedRows.push(child);
        } else {
          userRowElements.push(child);
          // Close any open groups
          if (isGroupOpen(child)) {
            getGroupButton(child).click();
          }
        }
      } else {
        nonUserRows.push(child);
      }
    }

    // Save discovered users for the popup
    if (allUserNames.length > 0) {
      chrome.storage.local.set({ knownUsers: allUserNames });
    }

    if (userRowElements.length === 0) {
      return { error: 'No users found to include in standup' };
    }

    // Shuffle
    shuffle(userRowElements);

    // Re-order in DOM: active users, then excluded (deemphasized), then non-user rows
    for (const row of userRowElements) {
      container.appendChild(row);
    }
    for (const row of excludedRows) {
      row.classList.add('standup-excluded');
      container.appendChild(row);
    }
    for (const row of nonUserRows) {
      container.appendChild(row);
    }

    userRows = userRowElements;
    currentIndex = -1;
    standupActive = true;
    standupStartTime = Date.now();

    return { ok: true };
  }

  function advanceToNext() {
    if (!standupActive) return;

    // Stop current user's timer and collapse their group
    if (currentIndex >= 0 && currentIndex < userRows.length) {
      const currentRow = userRows[currentIndex];
      stopTimer(currentRow);
      const btn = getGroupButton(currentRow);
      if (btn && btn.getAttribute('aria-label') === 'Collapse group') {
        btn.click();
      }
    }

    currentIndex++;

    if (currentIndex >= userRows.length) {
      // Standup complete
      standupActive = false;
      showComplete();
      return;
    }

    // Expand the next user's group, then scroll into view after it renders
    const nextRow = userRows[currentIndex];
    const btn = getGroupButton(nextRow);
    if (btn && btn.getAttribute('aria-label') === 'Open group') {
      btn.click();
    }
    startTimer(nextRow);

    let debounceTimer;
    const observer = new ResizeObserver(() => {
      nextRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        observer.disconnect();
        nextRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
    observer.observe(nextRow);
  }

  function showComplete() {
    userRows[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    const totalTime = formatTime(Date.now() - standupStartTime);
    const overlay = document.createElement('div');
    overlay.className = 'standup-complete-overlay';
    overlay.innerHTML = `
      <div class="standup-complete-card">
        <div class="standup-complete-check">&#10003;</div>
        <div class="standup-complete-title">Standup Complete!</div>
        <div class="standup-complete-time">Total time: ${totalTime}</div>
        <button class="standup-complete-close">Close</button>
      </div>
    `;
    overlay.querySelector('.standup-complete-close').addEventListener('click', () => {
      overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  // --- Event Listeners ---

  document.addEventListener('keydown', (e) => {
    if (!standupActive) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      advanceToNext();
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'initStandup') {
      startStandup(msg.excludedUsers || []);
    }
  });
})();
