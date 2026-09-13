const state = {
  mode: "free",
  targetDistanceKm: 5.0,
  targetMinutes: 30,

  running: false,
  paused: false,
  startTime: null,
  pauseStartedAt: null,
  pausedTotalMs: 0,
  timerId: null,

  watchId: null,
  lastLocation: null,
  distanceMeters: 0,
  points: [],
  recentPoints: [],
  lastAccuracy: null
};

const $ = (id) => document.getElementById(id);

const el = {
  setupCard: $("setupCard"),
  runPanel: $("runPanel"),
  distanceSetting: $("distanceSetting"),
  timeSetting: $("timeSetting"),
  distanceValue: $("distanceValue"),
  timeValue: $("timeValue"),
  startButton: $("startButton"),
  pauseButton: $("pauseButton"),
  stopButton: $("stopButton"),
  distanceDisplay: $("distanceDisplay"),
  timeDisplay: $("timeDisplay"),
  currentPaceDisplay: $("currentPaceDisplay"),
  averagePaceDisplay: $("averagePaceDisplay"),
  runStatus: $("runStatus"),
  accuracyText: $("accuracyText"),
  progressLabel: $("progressLabel"),
  progressText: $("progressText"),
  progressBar: $("progressBar"),
  resultDialog: $("resultDialog"),
  resultDistance: $("resultDistance"),
  resultTime: $("resultTime"),
  resultPace: $("resultPace"),
  closeResultButton: $("closeResultButton"),
  historyButton: $("historyButton"),
  historyDialog: $("historyDialog"),
  historyList: $("historyList"),
  closeHistoryButton: $("closeHistoryButton"),
  clearHistoryButton: $("clearHistoryButton"),
  weekDistance: $("weekDistance"),
  monthDistance: $("monthDistance")
};

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;

    el.distanceSetting.classList.toggle("hidden", state.mode !== "distance");
    el.timeSetting.classList.toggle("hidden", state.mode !== "time");
  });
});

$("distanceMinus").addEventListener("click", () => {
  state.targetDistanceKm = Math.max(0.1, +(state.targetDistanceKm - 0.1).toFixed(1));
  el.distanceValue.textContent = state.targetDistanceKm.toFixed(1);
});

$("distancePlus").addEventListener("click", () => {
  state.targetDistanceKm = Math.min(100, +(state.targetDistanceKm + 0.1).toFixed(1));
  el.distanceValue.textContent = state.targetDistanceKm.toFixed(1);
});

$("timeMinus").addEventListener("click", () => {
  state.targetMinutes = Math.max(1, state.targetMinutes - 1);
  el.timeValue.textContent = state.targetMinutes;
});

$("timePlus").addEventListener("click", () => {
  state.targetMinutes = Math.min(600, state.targetMinutes + 1);
  el.timeValue.textContent = state.targetMinutes;
});

el.startButton.addEventListener("click", startRun);
el.pauseButton.addEventListener("click", togglePause);
el.stopButton.addEventListener("click", () => finishRun(false));

el.closeResultButton.addEventListener("click", () => {
  el.resultDialog.close();
  resetRunUI();
  updateSummary();
});

el.historyButton.addEventListener("click", () => {
  renderHistory();
  el.historyDialog.showModal();
});

el.closeHistoryButton.addEventListener("click", () => el.historyDialog.close());

el.clearHistoryButton.addEventListener("click", () => {
  if (!confirm("すべてのランニング履歴を削除しますか？")) return;
  localStorage.removeItem("runningPwaRuns");
  renderHistory();
  updateSummary();
});

function startRun() {
  if (!("geolocation" in navigator)) {
    alert("この端末では位置情報を利用できません。");
    return;
  }

  resetRunState();

  state.running = true;
  state.startTime = Date.now();

  el.setupCard.classList.add("hidden");
  el.runPanel.classList.remove("hidden");
  el.runStatus.textContent = "GPS取得中";

  state.timerId = setInterval(updateTimer, 250);

  state.watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );

  updateProgress();
}

function togglePause() {
  if (!state.running) return;

  state.paused = !state.paused;

  if (state.paused) {
    state.pauseStartedAt = Date.now();
    el.pauseButton.textContent = "再開";
    el.runStatus.textContent = "一時停止中";
  } else {
    state.pausedTotalMs += Date.now() - state.pauseStartedAt;
    state.pauseStartedAt = null;
    state.lastLocation = null;
    state.recentPoints = [];
    el.pauseButton.textContent = "一時停止";
    el.runStatus.textContent = "計測中";
  }
}

function handlePosition(position) {
  if (!state.running || state.paused) return;

  const { latitude, longitude, accuracy } = position.coords;
  const timestamp = position.timestamp || Date.now();

  state.lastAccuracy = accuracy;
  el.accuracyText.textContent = `精度 ${Math.round(accuracy)} m`;

  // 精度が悪すぎる点は距離計算に使わない
  if (accuracy > 40) {
    el.runStatus.textContent = "GPS精度低";
    return;
  }

  const point = { latitude, longitude, accuracy, timestamp };

  if (state.lastLocation) {
    const delta = haversineMeters(state.lastLocation, point);
    const dtSec = Math.max((point.timestamp - state.lastLocation.timestamp) / 1000, 0.1);
    const speedMps = delta / dtSec;

    // 3m未満の揺れと、35km/hを超える不自然なジャンプを除外
    if (delta >= 3 && speedMps <= 9.72) {
      state.distanceMeters += delta;
      state.points.push(point);
      state.recentPoints.push(point);
      state.recentPoints = state.recentPoints.filter(
        (p) => point.timestamp - p.timestamp <= 30000
      );
    }
  } else {
    state.points.push(point);
    state.recentPoints = [point];
  }

  state.lastLocation = point;
  el.runStatus.textContent = "計測中";

  updateMetrics();
  updateProgress();
  checkGoalReached();
}

function handleLocationError(error) {
  const messages = {
    1: "位置情報が許可されていません。",
    2: "現在地を取得できません。",
    3: "位置情報の取得がタイムアウトしました。"
  };
  el.runStatus.textContent = "GPSエラー";
  alert(messages[error.code] || "位置情報の取得中にエラーが発生しました。");
}

function updateTimer() {
  if (!state.running) return;
  updateMetrics();
  updateProgress();
  checkGoalReached();
}

function getElapsedMs() {
  if (!state.startTime) return 0;
  const now = Date.now();
  const currentPause = state.paused && state.pauseStartedAt
    ? now - state.pauseStartedAt
    : 0;
  return Math.max(0, now - state.startTime - state.pausedTotalMs - currentPause);
}

function updateMetrics() {
  const elapsedMs = getElapsedMs();
  const elapsedSec = elapsedMs / 1000;
  const km = state.distanceMeters / 1000;

  el.distanceDisplay.textContent = km.toFixed(2);
  el.timeDisplay.textContent = formatDuration(elapsedMs);

  if (km > 0.03 && elapsedSec > 10) {
    const avgPaceSecPerKm = elapsedSec / km;
    el.averagePaceDisplay.textContent = formatPace(avgPaceSecPerKm);
  }

  const currentPace = getRecentPace();
  el.currentPaceDisplay.textContent = currentPace
    ? formatPace(currentPace)
    : "--'--\"";
}

function getRecentPace() {
  if (state.recentPoints.length < 2) return null;

  let distance = 0;
  for (let i = 1; i < state.recentPoints.length; i++) {
    distance += haversineMeters(state.recentPoints[i - 1], state.recentPoints[i]);
  }

  const start = state.recentPoints[0];
  const end = state.recentPoints[state.recentPoints.length - 1];
  const seconds = (end.timestamp - start.timestamp) / 1000;

  if (distance < 20 || seconds < 5) return null;

  const metersPerSecond = distance / seconds;
  if (metersPerSecond < 0.5) return null;

  return 1000 / metersPerSecond;
}

function updateProgress() {
  const km = state.distanceMeters / 1000;
  const elapsedMin = getElapsedMs() / 60000;

  if (state.mode === "distance") {
    const pct = Math.min(100, (km / state.targetDistanceKm) * 100);
    el.progressLabel.textContent = `目標 ${state.targetDistanceKm.toFixed(1)} km`;
    el.progressText.textContent = `${pct.toFixed(0)}%`;
    el.progressBar.style.width = `${pct}%`;
  } else if (state.mode === "time") {
    const pct = Math.min(100, (elapsedMin / state.targetMinutes) * 100);
    el.progressLabel.textContent = `目標 ${state.targetMinutes}分`;
    el.progressText.textContent = `${pct.toFixed(0)}%`;
    el.progressBar.style.width = `${pct}%`;
  } else {
    el.progressLabel.textContent = "フリーラン";
    el.progressText.textContent = "--";
    el.progressBar.style.width = "0%";
  }
}

function checkGoalReached() {
  if (!state.running || state.paused) return;

  const km = state.distanceMeters / 1000;
  const elapsedMin = getElapsedMs() / 60000;

  if (state.mode === "distance" && km >= state.targetDistanceKm) {
    finishRun(true);
  }

  if (state.mode === "time" && elapsedMin >= state.targetMinutes) {
    finishRun(true);
  }
}

function finishRun(goalReached) {
  if (!state.running) return;

  state.running = false;

  if (state.timerId) clearInterval(state.timerId);
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);

  const elapsedMs = getElapsedMs();
  const km = state.distanceMeters / 1000;
  const pace = km > 0.03 ? (elapsedMs / 1000) / km : null;

  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: new Date().toISOString(),
    distanceKm: +km.toFixed(3),
    durationMs: Math.round(elapsedMs),
    averagePaceSec: pace ? Math.round(pace) : null,
    mode: state.mode,
    goalReached
  };

  saveRun(record);

  el.resultDistance.textContent = `${km.toFixed(2)} km`;
  el.resultTime.textContent = formatDuration(elapsedMs);
  el.resultPace.textContent = pace ? `${formatPace(pace)}/km` : `--'--"/km`;

  el.resultDialog.showModal();
}

function resetRunState() {
  if (state.timerId) clearInterval(state.timerId);
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);

  state.running = false;
  state.paused = false;
  state.startTime = null;
  state.pauseStartedAt = null;
  state.pausedTotalMs = 0;
  state.timerId = null;
  state.watchId = null;
  state.lastLocation = null;
  state.distanceMeters = 0;
  state.points = [];
  state.recentPoints = [];
  state.lastAccuracy = null;
}

function resetRunUI() {
  resetRunState();

  el.setupCard.classList.remove("hidden");
  el.runPanel.classList.add("hidden");
  el.pauseButton.textContent = "一時停止";
  el.distanceDisplay.textContent = "0.00";
  el.timeDisplay.textContent = "00:00:00";
  el.currentPaceDisplay.textContent = "--'--\"";
  el.averagePaceDisplay.textContent = "--'--\"";
  el.progressBar.style.width = "0%";
  el.accuracyText.textContent = "精度 -- m";
  el.runStatus.textContent = "GPS準備中";
}

function saveRun(record) {
  const runs = getRuns();
  runs.unshift(record);
  localStorage.setItem("runningPwaRuns", JSON.stringify(runs));
}

function getRuns() {
  try {
    return JSON.parse(localStorage.getItem("runningPwaRuns") || "[]");
  } catch {
    return [];
  }
}

function renderHistory() {
  const runs = getRuns();

  if (!runs.length) {
    el.historyList.innerHTML = `<div class="empty">まだ記録がありません。</div>`;
    return;
  }

  el.historyList.innerHTML = runs.map((run) => {
    const date = new Date(run.date);
    const dateText = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);

    return `
      <article class="history-item">
        <h3>${dateText}</h3>
        <div class="history-meta">
          <span>${run.distanceKm.toFixed(2)} km</span>
          <span>${formatDuration(run.durationMs)}</span>
          <span>${run.averagePaceSec ? `${formatPace(run.averagePaceSec)}/km` : "--"}</span>
        </div>
      </article>
    `;
  }).join("");
}

function updateSummary() {
  const runs = getRuns();
  const now = new Date();

  const startOfWeek = new Date(now);
  const day = (now.getDay() + 6) % 7;
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - day);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const weekKm = runs
    .filter((r) => new Date(r.date) >= startOfWeek)
    .reduce((sum, r) => sum + Number(r.distanceKm || 0), 0);

  const monthKm = runs
    .filter((r) => new Date(r.date) >= startOfMonth)
    .reduce((sum, r) => sum + Number(r.distanceKm || 0), 0);

  el.weekDistance.textContent = `${weekKm.toFixed(1)} km`;
  el.monthDistance.textContent = `${monthKm.toFixed(1)} km`;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) {
    return "--'--\"";
  }

  let min = Math.floor(secPerKm / 60);
  let sec = Math.round(secPerKm % 60);

  if (sec === 60) {
    min += 1;
    sec = 0;
  }

  return `${min}'${String(sec).padStart(2, "0")}"`;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => deg * Math.PI / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h = sinLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinLon ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

updateSummary();
