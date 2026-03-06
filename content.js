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
      const excluded = isExcluded(name);
      if (excluded) el.classList.add('standup-excluded');
      return {
        el,
        name,
        isUser: true,
        excluded: excluded,
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
      .filter(r => r.isUser && r.name && r.name.toLowerCase() !== 'no assignee')
      .map(r => r.name);
    if (names.length > 0) {
      chrome.storage.local.set({ knownUsers: names });
    }
  }

  function advanceToNext() {
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

  function startRow(row) {
    toggleGroup(row.el, { open: true });
    row.stopTimer = createTimer(row.el);
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
    if (row.stopTimer) row.stopTimer();
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

  function rowName(rowEl) {
    const span = [...rowEl.querySelectorAll('span')]
      .find(s => { const t = s.textContent.trim(); return t && t.length > 1 && !/^\d+$/.test(t); });
    return span ? span.textContent.trim() : '';
  }

  function formatTime(ms) {
    const tenths = Math.floor(ms / 100);
    const sec = Math.floor(tenths / 10) % 60;
    const min = Math.floor(tenths / 600);
    return `${min}:${sec.toString().padStart(2, '0')}.${tenths % 10}`;
  }

  function createTimer(rowEl) {
    const span = document.createElement('span');
    span.className = 'standup-timer standup-timer--active';
    span.textContent = formatTime(0);

    const countSpan = [...rowEl.querySelectorAll('span')].find(s => /^\d+$/.test(s.textContent.trim()));
    if (countSpan) {
      countSpan.parentElement.insertAdjacentElement('afterend', span);
    } else {
      const innerDiv = rowEl.querySelector(GROUP_BTN_SELECTOR)?.parentElement?.parentElement;
      if (innerDiv) innerDiv.appendChild(span);
    }

    const start = Date.now();
    const interval = setInterval(() => {
      span.textContent = formatTime(Date.now() - start);
    }, 100);

    return function stop() {
      clearInterval(interval);
      span.textContent = formatTime(Date.now() - start);
      span.classList.remove('standup-timer--active');
      span.classList.add('standup-timer--done');
    };
  }
})();
