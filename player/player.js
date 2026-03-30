/**
 * LP Player Visualization
 * Connects to the background service worker to receive playback state
 * and drives the record animation + UI updates.
 */
(() => {
  'use strict';

  // DOM references
  const currentSlot = document.getElementById('record-wrapper');
  const incomingSlot = document.getElementById('record-incoming');
  const recordTray = document.getElementById('record-tray');

  const els = {
    app: document.getElementById('lp-app'),
    bgLayer: document.getElementById('bg-layer'),
    record: currentSlot.querySelector('.record-disc'),
    tonearm: document.getElementById('tonearm'),
    tonearmContainer: document.getElementById('tonearm-container'),
    albumArt: currentSlot.querySelector('.album-art'),
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
    navPrev: document.getElementById('nav-prev'),
    navNext: document.getElementById('nav-next'),
  };

  // Tonearm angle constants (must match CSS)
  const TONEARM_REST = -38;    // resting position (off record, swung right)
  const TONEARM_TRACK_START = 2;   // lead-in groove position near the record edge
  const TONEARM_TRACK_END = 26;    // run-out groove position, still outside the label art
  const TONEARM_THRESHOLD = -9; // crossing this = toggle play/pause
  const TONEARM_TRANSITION_MS = 1200; // must match CSS transition
  const RECORD_LEAD_IN_MS = 180;
  const PLAYBACK_CONFIRM_TIMEOUT_MS = 3000;

  // ===== State =====
  let currentState = {
    isPlaying: false,
    title: '',
    artist: '',
    albumArtUrl: '',
    currentTime: 0,
    duration: 0,
  };
  let lastProgress = { currentTime: -1, duration: -1 };
  const ambientColorCache = new Map();
  const tonearmControl = {
    isDragging: false,
    isPointerDown: false,
    suppressClick: false,
    activationPhase: 'idle', // idle | spinning-up | moving-to-play | awaiting-playback
    activationTimeoutId: null,
    leadInTimeoutId: null,
    playbackConfirmTimeoutId: null,
  };

  // ===== Formatting helpers =====
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== UI Update =====
  function setProgress(currentTime, duration) {
    if (currentTime === lastProgress.currentTime && duration === lastProgress.duration) {
      return;
    }

    if (duration > 0 && currentTime <= duration) {
      const pct = currentTime / duration;
      els.progressFill.style.transform = `scaleX(${pct})`;
      els.timeCurrent.textContent = formatTime(currentTime);
      els.timeDuration.textContent = formatTime(duration);
    } else {
      els.progressFill.style.transform = 'scaleX(0)';
      els.timeCurrent.textContent = formatTime(currentTime);
      els.timeDuration.textContent = formatTime(duration);
    }

    lastProgress = { currentTime, duration };
  }

  function updatePlaybackState(isPlaying) {
    const wasPlaying = currentState.isPlaying;

    if (isPlaying === currentState.isPlaying) {
      return;
    }

    if (isPlaying) {
      els.record.classList.add('playing');
      els.app.classList.remove('idle');
      requestWakeLock();
      if (!wasPlaying) {
        tonearmControl.activationPhase = 'idle';
        clearPendingTonearmActivationTimer();
        clearPendingTonearmLeadInTimer();
        clearPendingPlaybackConfirmationTimer();
      }
    } else {
      releaseWakeLock();
    }

    syncRecordVisualState();
    syncTonearmVisualState();
  }

  function updateSongInfo(title, artist) {
    if (title !== currentState.title) {
      els.songTitle.textContent = title || '';
    }

    if (artist !== currentState.artist) {
      els.songArtist.textContent = artist || '';
    }

    if (title) {
      els.app.classList.remove('idle');
    } else {
      els.app.classList.add('idle');
    }
  }

  function hasTrackChanged(nextState) {
    const metadataChanged =
      Boolean(nextState.title && nextState.title !== currentState.title) ||
      Boolean(nextState.artist && nextState.artist !== currentState.artist) ||
      Boolean(nextState.albumArtUrl && nextState.albumArtUrl !== currentState.albumArtUrl);

    const durationChanged =
      nextState.duration > 0 &&
      currentState.duration > 0 &&
      Math.abs(nextState.duration - currentState.duration) > 1;

    const restartedNearBeginning =
      currentState.currentTime > 15 &&
      nextState.currentTime < 3 &&
      nextState.currentTime < currentState.currentTime;

    return metadataChanged || durationChanged || restartedNearBeginning;
  }

  // ===== UI Update =====
  function updateUI(state) {
    // Detect song change and reset progress
    const songChanged = hasTrackChanged(state);

    updatePlaybackState(state.isPlaying);
    updateSongInfo(state.title, state.artist);

    if (songChanged) {
      lastProgress = { currentTime: -1, duration: -1 };
      setProgress(0, 0);
    }

    // Album art change
    if (state.albumArtUrl && state.albumArtUrl !== currentState.albumArtUrl) {
      if (songChanged && !isSwapping) {
        // Use pending direction from button click, or default to 'next' for natural transitions
        const direction = pendingSwapDirection || 'next';
        pendingSwapDirection = null;
        clearTimeout(pendingSwapTimeout);
        updateAmbientColor(state.albumArtUrl);
        setProgress(state.currentTime, state.duration);
        currentState = { ...state };
        syncTonearmVisualState();
        runSwapAnimation(direction, state.albumArtUrl);
        return;
      }

      // Normal album art update (no swap in progress)
      if (!isSwapping) {
        els.albumArt.src = state.albumArtUrl;
      }
      updateAmbientColor(state.albumArtUrl);
    }

    if (songChanged) {
      setProgress(state.currentTime, state.duration);
      currentState = { ...state };
      syncRecordVisualState();
      syncTonearmVisualState();
      return;
    }

    if (state.currentTime === 0 || state.duration > 0) {
      setProgress(state.currentTime, state.duration);
    }

    currentState = { ...state };
    if (!isSwapping) {
      syncRecordVisualState();
    }
    syncTonearmVisualState();
  }

  function clearPendingTonearmActivationTimer() {
    if (tonearmControl.activationTimeoutId !== null) {
      clearTimeout(tonearmControl.activationTimeoutId);
      tonearmControl.activationTimeoutId = null;
    }
  }

  function clearPendingTonearmLeadInTimer() {
    if (tonearmControl.leadInTimeoutId !== null) {
      clearTimeout(tonearmControl.leadInTimeoutId);
      tonearmControl.leadInTimeoutId = null;
    }
  }

  function clearPendingPlaybackConfirmationTimer() {
    if (tonearmControl.playbackConfirmTimeoutId !== null) {
      clearTimeout(tonearmControl.playbackConfirmTimeoutId);
      tonearmControl.playbackConfirmTimeoutId = null;
    }
  }

  function isRecordVisuallyPlaying() {
    return currentState.isPlaying || tonearmControl.activationPhase !== 'idle';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getTonearmProgressRatio() {
    if (!Number.isFinite(currentState.duration) || currentState.duration <= 0) {
      return 0;
    }

    return clamp(currentState.currentTime / currentState.duration, 0, 1);
  }

  function getTonearmTrackingAngle() {
    const progress = getTonearmProgressRatio();
    return TONEARM_TRACK_START + (TONEARM_TRACK_END - TONEARM_TRACK_START) * progress;
  }

  function getTonearmTargetAngle() {
    if (currentState.isPlaying ||
        tonearmControl.activationPhase === 'moving-to-play' ||
        tonearmControl.activationPhase === 'awaiting-playback') {
      return getTonearmTrackingAngle();
    }

    return TONEARM_REST;
  }

  function syncRecordVisualState() {
    const playing = isRecordVisuallyPlaying();
    els.record.classList.toggle('playing', playing);
    incomingSlot.querySelector('.record-disc').classList.toggle('playing', playing);
  }

  function syncTonearmVisualState() {
    if (tonearmControl.isDragging) {
      return;
    }

    const isTracking =
      currentState.isPlaying &&
      tonearmControl.activationPhase === 'idle' &&
      !tonearmControl.isPointerDown;

    els.tonearm.classList.toggle('tracking', isTracking);
    setTonearmAngle(getTonearmTargetAngle());
  }

  function finalizeTonearmPlaybackStart() {
    if (tonearmControl.activationPhase !== 'moving-to-play') {
      return;
    }

    tonearmControl.activationPhase = 'awaiting-playback';
    clearPendingTonearmActivationTimer();
    sendPlaybackCommand('TOGGLE_PLAYBACK');
    clearPendingPlaybackConfirmationTimer();
    tonearmControl.playbackConfirmTimeoutId = setTimeout(() => {
      if (tonearmControl.activationPhase === 'awaiting-playback' && !currentState.isPlaying) {
        tonearmControl.activationPhase = 'idle';
        syncRecordVisualState();
        syncTonearmVisualState();
      }
    }, PLAYBACK_CONFIRM_TIMEOUT_MS);
    syncRecordVisualState();
    syncTonearmVisualState();
  }

  function startTonearmPlaybackMotion() {
    if (tonearmControl.activationPhase !== 'spinning-up') {
      return;
    }

    tonearmControl.activationPhase = 'moving-to-play';
    clearPendingTonearmLeadInTimer();
    syncRecordVisualState();
    syncTonearmVisualState();

    clearPendingTonearmActivationTimer();
    tonearmControl.activationTimeoutId = setTimeout(() => {
      finalizeTonearmPlaybackStart();
    }, TONEARM_TRANSITION_MS + 80);
  }

  function beginTonearmPlaybackStart() {
    if (currentState.isPlaying || tonearmControl.activationPhase !== 'idle') {
      return;
    }

    tonearmControl.activationPhase = 'spinning-up';
    syncRecordVisualState();
    syncTonearmVisualState();

    clearPendingTonearmLeadInTimer();
    tonearmControl.leadInTimeoutId = setTimeout(() => {
      startTonearmPlaybackMotion();
    }, RECORD_LEAD_IN_MS);

    clearPendingTonearmActivationTimer();
  }

  // ===== Ambient background color from album art =====
  function updateAmbientColor(imageUrl) {
    const cached = ambientColorCache.get(imageUrl);
    if (cached) {
      els.bgLayer.style.background = cached;
      return;
    }

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
        const gradient = `radial-gradient(circle at 50% 50%, rgb(${r},${g},${b}), transparent 70%)`;
        ambientColorCache.set(imageUrl, gradient);
        els.bgLayer.style.background = gradient;
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
  let lastQueueSignature = '';

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
    const signature = JSON.stringify(tracks.map((track) => [
      track.index,
      track.title,
      track.artist,
      track.duration,
      track.isPlaying,
    ]));

    if (signature === lastQueueSignature) {
      return;
    }

    lastQueueSignature = signature;

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
  let dragStartY = 0;
  let dragStartAngle = 0;
  const DRAG_THRESHOLD_PX = 6;

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
    return getTonearmTargetAngle();
  }

  function setTonearmAngle(angle) {
    angle = clamp(angle, TONEARM_REST, TONEARM_TRACK_END);
    els.tonearm.style.transform = `rotate(${angle}deg)`;
    return angle;
  }

  function onDragStart(e) {
    e.preventDefault();
    tonearmControl.isPointerDown = true;
    tonearmControl.isDragging = false;
    tonearmControl.activationPhase = 'idle';
    clearPendingTonearmActivationTimer();
    clearPendingTonearmLeadInTimer();
    clearPendingPlaybackConfirmationTimer();
    syncRecordVisualState();
    dragStartY = e.clientY || e.touches?.[0]?.clientY || 0;
    dragStartAngle = getTonearmAngle();
  }

  function onDragMove(e) {
    if (!tonearmControl.isPointerDown) return;
    e.preventDefault();
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    const deltaY = clientY - dragStartY;

    if (!tonearmControl.isDragging && Math.abs(deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }

    if (!tonearmControl.isDragging) {
      tonearmControl.isDragging = true;
      tonearmControl.suppressClick = true;
      els.tonearm.classList.add('dragging');
      els.tonearm.classList.remove('active');
    }

    const sensitivity = 0.15;
    const newAngle = dragStartAngle + deltaY * sensitivity;
    setTonearmAngle(newAngle);
  }

  function onDragEnd() {
    if (!tonearmControl.isPointerDown) return;
    tonearmControl.isPointerDown = false;

    if (!tonearmControl.isDragging) {
      return;
    }

    tonearmControl.isDragging = false;
    els.tonearm.classList.remove('dragging');

    const finalAngle = getTonearmAngle();
    els.tonearm.style.transform = '';

    if (finalAngle > TONEARM_THRESHOLD) {
      if (!currentState.isPlaying) {
        beginTonearmPlaybackStart();
      }
    } else {
      if (currentState.isPlaying) {
        sendPlaybackCommand('TOGGLE_PLAYBACK');
      }
    }

    syncTonearmVisualState();
  }

  els.tonearm.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  els.tonearm.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);

  els.tonearm.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') {
      return;
    }

    finalizeTonearmPlaybackStart();
  });

  els.tonearm.addEventListener('click', (e) => {
    if (tonearmControl.isDragging || tonearmControl.suppressClick) {
      tonearmControl.suppressClick = false;
      return;
    }

    if (tonearmControl.activationPhase !== 'idle') {
      return;
    }

    if (currentState.isPlaying) {
      sendPlaybackCommand('TOGGLE_PLAYBACK');
      return;
    }

    beginTonearmPlaybackStart();
  });

  function sendPlaybackCommand(command) {
    try {
      chrome.runtime.sendMessage({ type: command });
    } catch {
      // Not running as extension — ignore
    }
  }

  // ===== Record swap animation =====
  let isSwapping = false;
  let pendingSwapDirection = null; // 'next' | 'prev' | null
  let pendingSwapTimeout = null;

  function requestTrackChange(direction) {
    if (isSwapping || pendingSwapDirection) return;
    pendingSwapDirection = direction;
    sendPlaybackCommand(direction === 'next' ? 'NEXT_TRACK' : 'PREV_TRACK');

    // Clear pending if no song change detected within 3s
    clearTimeout(pendingSwapTimeout);
    pendingSwapTimeout = setTimeout(() => {
      pendingSwapDirection = null;
    }, 3000);
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(); return; }
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
    });
  }

  function runSwapAnimation(direction, newAlbumArtUrl) {
    isSwapping = true;

    const incomingArt = incomingSlot.querySelector('.album-art');

    // Preload image, then animate
    preloadImage(newAlbumArtUrl).then(() => {
      if (newAlbumArtUrl) {
        incomingArt.src = newAlbumArtUrl;
      }

      // Incoming record should spin
      incomingSlot.querySelector('.record-disc').classList.add('playing');

      // Position incoming record on the correct side
      incomingSlot.style.left = direction === 'next' ? '100%' : '-100%';

      // Reset tray to origin (no transition)
      recordTray.classList.add('no-transition');
      recordTray.style.transform = 'translateX(0)';
      recordTray.offsetHeight;

      // Animate tray to slide both records together
      recordTray.classList.remove('no-transition');
      recordTray.style.transform = direction === 'next' ? 'translateX(-100%)' : 'translateX(100%)';

      function onSwapDone(e) {
        if (e && e.target !== recordTray) return;
        recordTray.removeEventListener('transitionend', onSwapDone);

        // Copy incoming art to current slot
        els.albumArt.src = incomingArt.src || '';

        // Reset tray instantly
        recordTray.classList.add('no-transition');
        recordTray.style.transform = 'translateX(0)';
        recordTray.offsetHeight;
        recordTray.classList.remove('no-transition');

        // Reset incoming position
        incomingSlot.style.left = '100%';

        syncRecordVisualState();
        isSwapping = false;
      }

      recordTray.addEventListener('transitionend', onSwapDone);
      setTimeout(() => { if (isSwapping) onSwapDone(null); }, 800);
    });
  }

  els.navPrev.addEventListener('click', () => requestTrackChange('prev'));
  els.navNext.addEventListener('click', () => requestTrackChange('next'));

  // ===== Connection to Background =====
  let port = null;

  function connect() {
    port = chrome.runtime.connect({ name: 'lp-player' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PLAYBACK_STATE' && !tonearmControl.isDragging) {
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
