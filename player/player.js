/**
 * LP Player Visualization
 * Connects to the background service worker to receive playback state
 * and drives the record animation + UI updates.
 */
(() => {
  'use strict';

  // DOM references
  const els = {
    app: document.getElementById('lp-app'),
    bgLayer: document.getElementById('bg-layer'),
    record: document.getElementById('record'),
    tonearm: document.getElementById('tonearm'),
    tonearmContainer: document.getElementById('tonearm-container'),
    albumArt: document.getElementById('album-art'),
    songTitle: document.getElementById('song-title'),
    songArtist: document.getElementById('song-artist'),
    timeCurrent: document.getElementById('time-current'),
    timeDuration: document.getElementById('time-duration'),
    progressFill: document.getElementById('progress-fill'),
    themeToggle: document.getElementById('theme-toggle'),
    themePanel: document.getElementById('theme-panel'),
    tracklistToggle: document.getElementById('tracklist-toggle'),
    tracklistPanel: document.getElementById('tracklist-panel'),
    tracklistItems: document.getElementById('tracklist-items'),
  };

  // Tonearm angle constants (must match CSS)
  const TONEARM_REST = -38;    // resting position (off record, swung right)
  const TONEARM_PLAY = 20;     // playing position (pointing at record center)
  const TONEARM_THRESHOLD = -9; // crossing this = toggle play/pause

  // ===== State =====
  let currentState = {
    isPlaying: false,
    title: '',
    artist: '',
    albumArtUrl: '',
    currentTime: 0,
    duration: 0,
  };

  // ===== Formatting helpers =====
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== UI Update =====
  function updateUI(state) {
    // Record spin
    if (state.isPlaying) {
      els.record.classList.add('playing');
      els.tonearm.classList.add('active');
      els.app.classList.remove('idle');
      requestWakeLock();
    } else {
      els.record.classList.remove('playing');
      els.tonearm.classList.remove('active');
      releaseWakeLock();
    }

    // Song info
    if (state.title) {
      els.songTitle.textContent = state.title;
      els.songArtist.textContent = state.artist;
      els.app.classList.remove('idle');
    } else {
      els.songTitle.textContent = '';
      els.songArtist.textContent = '';
      els.app.classList.add('idle');
    }

    // Album art
    if (state.albumArtUrl && state.albumArtUrl !== els.albumArt.src) {
      els.albumArt.src = state.albumArtUrl;
      updateAmbientColor(state.albumArtUrl);
    }

    // Progress
    if (state.duration > 0) {
      const pct = (state.currentTime / state.duration) * 100;
      els.progressFill.style.width = `${pct}%`;
    } else {
      els.progressFill.style.width = '0%';
    }

    els.timeCurrent.textContent = formatTime(state.currentTime);
    els.timeDuration.textContent = formatTime(state.duration);

    currentState = state;
  }

  // ===== Ambient background color from album art =====
  function updateAmbientColor(imageUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        els.bgLayer.style.background = `radial-gradient(circle at 50% 50%, rgb(${r},${g},${b}), transparent 70%)`;
      } catch {
        // CORS or other issue — keep default gradient
      }
    };
    img.src = imageUrl;
  }

  // ===== Theme System =====
  function initTheme() {
    const saved = localStorage.getItem('lp-theme') || 'theme-dark';
    setTheme(saved);

    els.themeToggle.addEventListener('click', () => {
      els.themePanel.classList.toggle('visible');
    });

    els.themePanel.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        setTheme(btn.dataset.theme);
        els.themePanel.classList.remove('visible');
      });
    });

    document.addEventListener('click', (e) => {
      if (!els.themeToggle.contains(e.target) && !els.themePanel.contains(e.target)) {
        els.themePanel.classList.remove('visible');
      }
    });
  }

  function setTheme(themeClass) {
    els.app.className = themeClass;
    localStorage.setItem('lp-theme', themeClass);

    els.themePanel.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === themeClass);
    });
  }

  // ===== Tracklist =====
  let tracklistOpen = false;
  let queuePollInterval = null;

  els.tracklistToggle.addEventListener('click', () => {
    tracklistOpen = !tracklistOpen;
    els.tracklistPanel.classList.toggle('visible', tracklistOpen);

    if (tracklistOpen) {
      fetchQueue();
      // Poll queue while panel is open
      queuePollInterval = setInterval(fetchQueue, 3000);
    } else {
      clearInterval(queuePollInterval);
      queuePollInterval = null;
    }
  });

  // Close tracklist on outside click
  document.addEventListener('click', (e) => {
    if (tracklistOpen &&
        !els.tracklistPanel.contains(e.target) &&
        !els.tracklistToggle.contains(e.target)) {
      tracklistOpen = false;
      els.tracklistPanel.classList.remove('visible');
      clearInterval(queuePollInterval);
      queuePollInterval = null;
    }
  });

  function fetchQueue() {
    chrome.runtime.sendMessage({ type: 'GET_QUEUE' }, (tracks) => {
      if (!tracks) return;
      renderTracklist(tracks);
    });
  }

  function renderTracklist(tracks) {
    const container = els.tracklistItems;
    // Preserve scroll position
    const scrollTop = container.scrollTop;

    container.innerHTML = '';

    tracks.forEach((track) => {
      const item = document.createElement('div');
      item.className = 'track-item' + (track.isPlaying ? ' active' : '');

      item.innerHTML =
        `<span class="track-index">${track.index + 1}</span>` +
        `<div class="track-info">` +
          `<div class="track-title">${escapeHtml(track.title)}</div>` +
          `<div class="track-artist">${escapeHtml(track.artist)}</div>` +
        `</div>` +
        `<span class="track-duration">${escapeHtml(track.duration)}</span>`;

      item.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'PLAY_TRACK', index: track.index });
      });

      container.appendChild(item);
    });

    container.scrollTop = scrollTop;

    // Auto-scroll to active track on first render
    if (scrollTop === 0) {
      const activeItem = container.querySelector('.track-item.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Tonearm Drag Control =====
  let isDragging = false;
  let dragStartY = 0;
  let dragStartAngle = 0;

  function getTonearmAngle() {
    const transform = getComputedStyle(els.tonearm).transform;
    if (transform === 'none') return TONEARM_REST;
    const values = transform.match(/matrix\((.+)\)/);
    if (values) {
      const parts = values[1].split(', ');
      const a = parseFloat(parts[0]);
      const b = parseFloat(parts[1]);
      return Math.round(Math.atan2(b, a) * (180 / Math.PI));
    }
    return currentState.isPlaying ? TONEARM_PLAY : TONEARM_REST;
  }

  function setTonearmAngle(angle) {
    angle = Math.max(TONEARM_REST, Math.min(TONEARM_PLAY, angle));
    els.tonearm.style.transform = `rotate(${angle}deg)`;
    return angle;
  }

  function onDragStart(e) {
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY || e.touches?.[0]?.clientY || 0;
    dragStartAngle = getTonearmAngle();
    els.tonearm.classList.add('dragging');
    els.tonearm.classList.remove('active');
  }

  function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    const deltaY = clientY - dragStartY;
    const sensitivity = 0.15;
    const newAngle = dragStartAngle + deltaY * sensitivity;
    setTonearmAngle(newAngle);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    els.tonearm.classList.remove('dragging');

    const finalAngle = getTonearmAngle();
    els.tonearm.style.transform = '';

    if (currentState.isPlaying) {
      els.tonearm.classList.add('active');
    }

    if (finalAngle > TONEARM_THRESHOLD) {
      if (!currentState.isPlaying) {
        sendPlaybackCommand('TOGGLE_PLAYBACK');
      }
    } else {
      if (currentState.isPlaying) {
        sendPlaybackCommand('TOGGLE_PLAYBACK');
      }
    }
  }

  els.tonearm.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  els.tonearm.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);

  els.tonearm.addEventListener('click', (e) => {
    if (isDragging) return;
    sendPlaybackCommand('TOGGLE_PLAYBACK');
  });

  function sendPlaybackCommand(command) {
    try {
      chrome.runtime.sendMessage({ type: command });
    } catch {
      // Not running as extension — ignore
    }
  }

  // ===== Connection to Background =====
  let port = null;

  function connect() {
    port = chrome.runtime.connect({ name: 'lp-player' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PLAYBACK_STATE' && !isDragging) {
        updateUI(msg.payload);
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 2000);
    });
  }

  // ===== Fullscreen =====
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullscreen);

  document.addEventListener('dblclick', (e) => {
    if (els.tonearm.contains(e.target)) return;
    toggleFullscreen();
  });

  // ===== Wake Lock (prevent screen sleep during playback) =====
  let wakeLock = null;

  async function requestWakeLock() {
    try {
      if (!wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch {
      // Wake Lock API not supported or failed
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  // Re-acquire wake lock when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentState.isPlaying) {
      requestWakeLock();
    }
  });

  // ===== Init =====
  initTheme();
  connect();
  els.app.classList.add('idle');
})();
