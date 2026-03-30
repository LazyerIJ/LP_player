document.getElementById('open-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_PLAYER' });
  window.close();
});

// Show current playback status
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
  if (!state) return;

  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  if (state.title) {
    dot.classList.add('active');
    text.textContent = state.isPlaying
      ? `Playing: ${state.title}`
      : `Paused: ${state.title}`;
  } else {
    text.textContent = 'Waiting for YouTube Music...';
  }
});
