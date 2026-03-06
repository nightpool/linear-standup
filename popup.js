const startBtn = document.getElementById('startBtn');
const status = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes('linear.app')) {
    status.textContent = 'Navigate to Linear first';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: 'startStandup' }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Reload the Linear page first';
      return;
    }
    if (response && response.ok) {
      status.textContent = 'Standup started! Press Space to advance';
      startBtn.disabled = true;
    } else if (response && response.error) {
      status.textContent = response.error;
    }
  });
});
