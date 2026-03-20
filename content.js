(() => {
  const GROUP_BTN_SELECTOR = 'button[aria-label="Open group"], button[aria-label="Collapse group"]';

  let standupActive = false;
  let standupRows = [];
  let currentIndex = -1;
  let standupStartTime = null;

  document.addEventListener('keydown', (e) => {
    if (!standupActive) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      advanceToNext();
    }
    if (e.code === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      goBack();
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'initStandup') {
      startStandup(msg.excludedUsers || []);
    }
  });

  async function startStandup(excluded) {
    await disableVirtualizer();

    const isExcluded = (name) => {
      return name === 'No assignee' ||
        excluded.some(ex => ex.toLowerCase() === name.toLowerCase());
    };

    const container = document.querySelector('[data-testid="virtuoso-item-list"]');
    if (!container) alert("No container found");

    const allRows = Array.from(container.children).map(el => {
      if (!el.querySelector(GROUP_BTN_SELECTOR)) {
        return {el, isUser: false};
      }

      toggleGroup(el, { open: false });

      const name = rowName(el);
      const isUser = !!name;
      const excluded = !isUser || isExcluded(name);
      if (excluded) el.classList.add('standup-excluded');
      return {
        el,
        name,
        isUser,
        excluded,
        randomKey: Math.random(),
      };
    });

    saveKnownUsers(allRows);

    allRows.sort((a, b) => {
      const aKey = !a.isUser ? 2 : a.excluded ? 1 : 0;
      const bKey = !b.isUser ? 2 : b.excluded ? 1 : 0;
      if (aKey !== bKey) return aKey - bKey;
      if (aKey === 0) return a.randomKey - b.randomKey;
      return 0;
    });

    for (const row of allRows) {
      container.appendChild(row.el);
    }

    standupRows = allRows.filter(r => r.isUser && !r.excluded);
    if (standupRows.length === 0) return;

    currentIndex = -1;
    standupActive = true;
    standupStartTime = Date.now();
  }

  function saveKnownUsers(allRows) {
    const names = allRows
      .filter(r => r.isUser)
      .map(r => r.name);
    if (names.length > 0) {
      chrome.storage.local.set({ knownUsers: names });
    }
  }

  async function advanceToNext() {
    if (!standupActive) return;

    if (standupRows[currentIndex]) {
      stopRow(standupRows[currentIndex]);
    }

    currentIndex++;

    if (currentIndex >= standupRows.length) {
      standupActive = false;
      showComplete();
      return;
    }

    startRow(standupRows[currentIndex]);
  }

  function goBack() {
    if (!standupActive || currentIndex <= 0) return;

    stopRow(standupRows[currentIndex]);
    currentIndex--;
    startRow(standupRows[currentIndex]);
  }

  // Watch for SPA navigation: when standupRows go stale, reattach on return
  new MutationObserver(() => {
    if (!standupActive || standupRows.length === 0) return;
    if (standupRows[0].el.isConnected) return;
    reattach();
  }).observe(document.body, { childList: true, subtree: true });

  async function reattach() {
    await disableVirtualizer();

    const container = document.querySelector('[data-testid="virtuoso-item-list"]');
    if (!container) return;

    // Map new DOM elements by name
    const elByName = new Map();
    const nonUserEls = [];
    for (const el of container.children) {
      if (el.querySelector(GROUP_BTN_SELECTOR)) {
        elByName.set(rowName(el), el);
      } else {
        nonUserEls.push(el);
      }
    }

    // Update standupRows with new DOM elements, preserving order and elapsed
    for (let i = 0; i < standupRows.length; i++) {
      const row = standupRows[i];
      const newEl = elByName.get(row.name);
      if (!newEl) continue;

      row.el = newEl;
      row.stopTimer = null;

      if (i < currentIndex && row.elapsed) {
        // Completed row: restore done timer
        toggleGroup(row.el, { open: false });
        createDoneTimer(row.el, row.elapsed);
      } else if (i === currentIndex) {
        // Current row: compute elapsed and restart live timer
        if (row.timerStart) row.elapsed = Date.now() - row.timerStart;
        startRow(row);
      } else {
        // Future row: just close it
        toggleGroup(row.el, { open: false });
      }
    }

    // Re-sort DOM: standupRows first (in saved order), then excluded, then rest
    for (const row of standupRows) {
      container.appendChild(row.el);
    }
    for (const [name, el] of elByName) {
      if (!standupRows.some(r => r.name === name)) {
        el.classList.add('standup-excluded');
        container.appendChild(el);
      }
    }
    for (const el of nonUserEls) {
      container.appendChild(el);
    }
  }

  function startRow(row) {
    toggleGroup(row.el, { open: true });
    row.timerStart = Date.now() - (row.elapsed || 0);
    row.stopTimer = createTimer(row.el, row.elapsed || 0);
    let debounceTimer;
    const observer = new ResizeObserver(() => {
      row.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        observer.disconnect();
        row.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
    observer.observe(row.el);
  }

  function stopRow(row) {
    if (row.stopTimer) row.elapsed = row.stopTimer();
    toggleGroup(row.el, { open: false });
  }

  function showComplete() {
    standupRows[0].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  function toggleGroup(el, { open }) {
    const label = open ? 'Open group' : 'Collapse group';
    const btn = el.querySelector(`button[aria-label="${label}"]`);
    if (btn) btn.click();
  }

  // --- Helpers ---

  function rowName(row) {
    const profileLink = row.querySelector('a[href*="/profiles/"]');
    if (profileLink) return profileLink.textContent.trim();
    const avatarDiv = row.querySelector('div[aria-label]');
    if (avatarDiv) return avatarDiv.getAttribute('aria-label');
    const avatarImg = row.querySelector('img[alt]');
    if (avatarImg) return avatarImg.getAttribute('alt').replace(/^Avatar of /, '');
  }

  function formatTime(ms) {
    const tenths = Math.floor(ms / 100);
    const sec = Math.floor(tenths / 10) % 60;
    const min = Math.floor(tenths / 600);
    return `${min}:${sec.toString().padStart(2, '0')}.${tenths % 10}`;
  }

  function createDoneTimer(rowEl, elapsed) {
    const existing = rowEl.querySelector('.standup-timer');
    if (existing) existing.remove();

    const span = document.createElement('span');
    span.className = 'standup-timer standup-timer--done';
    span.textContent = formatTime(elapsed);

    const countSpan = [...rowEl.querySelectorAll('span')].find(s => /^\d+$/.test(s.textContent.trim()));
    if (countSpan) {
      countSpan.parentElement.insertAdjacentElement('afterend', span);
    } else {
      const innerDiv = rowEl.querySelector(GROUP_BTN_SELECTOR)?.parentElement?.parentElement;
      if (innerDiv) innerDiv.appendChild(span);
    }
  }

  function createTimer(rowEl, initialElapsed = 0) {
    const existing = rowEl.querySelector('.standup-timer');
    if (existing) existing.remove();

    const span = document.createElement('span');
    span.className = 'standup-timer standup-timer--active';
    span.textContent = formatTime(initialElapsed);

    const countSpan = [...rowEl.querySelectorAll('span')].find(s => /^\d+$/.test(s.textContent.trim()));
    if (countSpan) {
      countSpan.parentElement.insertAdjacentElement('afterend', span);
    } else {
      const innerDiv = rowEl.querySelector(GROUP_BTN_SELECTOR)?.parentElement?.parentElement;
      if (innerDiv) innerDiv.appendChild(span);
    }

    const start = Date.now() - initialElapsed;
    const interval = setInterval(() => {
      span.textContent = formatTime(Date.now() - start);
    }, 100);

    return function stop() {
      clearInterval(interval);
      const elapsed = Date.now() - start;
      span.textContent = formatTime(elapsed);
      span.classList.remove('standup-timer--active');
      span.classList.add('standup-timer--done');
      return elapsed;
    };
  }
})();
