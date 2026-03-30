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
    } else {
      els.record.classList.remove('playing');
      els.tonearm.classList.remove('active');
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
    // Load saved theme
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

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (!els.themeToggle.contains(e.target) && !els.themePanel.contains(e.target)) {
        els.themePanel.classList.remove('visible');
      }
    });
  }

  function setTheme(themeClass) {
    // Remove all theme classes
    els.app.className = themeClass;
    localStorage.setItem('lp-theme', themeClass);

    // Update active button
    els.themePanel.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === themeClass);
    });
  }

  // ===== Tonearm Drag Control =====
  let isDragging = false;
  let dragStartY = 0;
  let dragStartAngle = 0;

  function getTonearmAngle() {
    const transform = getComputedStyle(els.tonearm).transform;
    if (transform === 'none') return TONEARM_REST;
    // Parse rotation from matrix
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
    // Clamp between rest (-38) and play (20) positions
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
    // Remove active class so CSS transition doesn't fight drag
    els.tonearm.classList.remove('active');
  }

  function onDragMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    // Moving down = toward record (increase angle), up = away (decrease angle)
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
    els.tonearm.style.transform = ''; // Clear inline style, let CSS class take over

    // Restore active class if currently playing (in case drag interrupted it)
    if (currentState.isPlaying) {
      els.tonearm.classList.add('active');
    }

    if (finalAngle > TONEARM_THRESHOLD) {
      // Dragged onto record (toward positive angle) → play
      if (!currentState.isPlaying) {
        sendPlaybackCommand('TOGGLE_PLAYBACK');
      }
    } else {
      // Dragged off record (toward negative angle) → pause
      if (currentState.isPlaying) {
        sendPlaybackCommand('TOGGLE_PLAYBACK');
      }
    }
  }

  // Mouse events
  els.tonearm.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // Touch events
  els.tonearm.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);

  // Click on tonearm = quick toggle
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

  // ===== Init =====
  initTheme();
  connect();

  // Set idle state initially
  els.app.classList.add('idle');
})();
