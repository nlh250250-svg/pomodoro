// ── Stats Engine ─────────────────────────────────────────────────────────
// Depends on Chart.js UMD (window.Chart)

const StatsEngine = (() => {
  let weeklyChart = null;

  // Chart colors — matching CSS custom properties
  const COLORS = {
    tomato: '#A67C67',
    tomatoAlpha: 'rgba(166, 124, 103, 0.18)',
    green: '#9AA3AD',
    greenAlpha: 'rgba(154, 163, 173, 0.18)',
    accent: '#D9A066',
    text: '#4A3A33',
    textMuted: '#927F74',
    gridLine: '#E5D9CF',
  };

  // ── load stats ────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const [weeklyData, streakData] = await Promise.all([
        window.timerAPI.getWeeklyStats(),
        window.timerAPI.getStreak(),
      ]);
      updateStreakDisplay(streakData);
      updateSummary(weeklyData);
      renderWeeklyChart(weeklyData);
      return { weeklyData, streakData };
    } catch (err) {
      console.error('Failed to load stats:', err);
      return null;
    }
  }

  // ── streak display ────────────────────────────────────────────────────
  function updateStreakDisplay(streak) {
    if (!streak) return;
    const countEl = document.getElementById('streakCount');
    if (countEl) countEl.textContent = streak.currentStreak || 0;
  }

  // ── summary numbers ───────────────────────────────────────────────────
  function updateSummary(weeklyData) {
    if (!weeklyData || !weeklyData.length) return;

    let totalWorkMin = 0, totalWorkCount = 0;
    for (const day of weeklyData) {
      totalWorkMin += day.totalWorkMinutes || 0;
      totalWorkCount += day.workCount || 0;
    }

    const hours = (totalWorkMin / 60).toFixed(1);
    const hoursEl = document.getElementById('weeklyTotalHours');
    const pomosEl = document.getElementById('weeklyTotalPomos');
    if (hoursEl) hoursEl.textContent = hours;
    if (pomosEl) pomosEl.textContent = totalWorkCount;
  }

  // ── weekly bar chart ──────────────────────────────────────────────────
  function renderWeeklyChart(weeklyData) {
    const canvas = document.getElementById('weeklyChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Destroy previous chart instance
    if (weeklyChart) {
      weeklyChart.destroy();
      weeklyChart = null;
    }

    if (!weeklyData || !weeklyData.length) {
      // No data — draw empty state
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
    const labels = weeklyData.map(d => {
      const dayOfWeek = new Date(d.date).getDay();
      const dStr = d.date.slice(5); // MM-DD
      return dStr + '\n周' + dayLabels[dayOfWeek];
    });
    const workValues = weeklyData.map(d => d.totalWorkMinutes || 0);
    const maxVal = Math.max(...workValues, 1);

    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '专注分钟',
          data: workValues,
          backgroundColor: ctx => {
            const val = ctx.raw;
            return val === maxVal && val > 0
              ? COLORS.accent
              : COLORS.tomato;
          },
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw} 分钟`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: COLORS.textMuted,
              font: { size: 10 },
              maxRotation: 0,
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: COLORS.textMuted,
              font: { size: 10 },
              stepSize: Math.max(1, Math.ceil(maxVal / 4)),
              callback: (v) => v + 'min',
            },
            grid: {
              color: COLORS.gridLine,
              drawBorder: false,
            },
          },
        },
      },
    });
  }

  // ── cleanup ──────────────────────────────────────────────────────────
  function destroy() {
    if (weeklyChart) {
      weeklyChart.destroy();
      weeklyChart = null;
    }
  }

  // ── public API ───────────────────────────────────────────────────────
  return { loadStats, destroy };
})();
