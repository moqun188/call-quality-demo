(function () {
  const LEVEL_COLORS = { A: "#16a34a", B: "#22c55e", C: "#ca8a04", D: "#ea580c", E: "#dc2626" };
  const DIM_LABELS = { compliance: "话术合规", knowledge: "业务知识", process: "流程完整", communication: "沟通技巧" };
  const DIM_COLORS = { compliance: "#667eea", knowledge: "#22c55e", process: "#f59e0b", communication: "#ec4899" };

  let autoRefreshTimer = null;
  let currentDetailItem = null;
  let currentTab = 'summary';

  function init() {
    loadStats();
    loadHistory();
    document.getElementById("refreshBtn").addEventListener("click", refresh);
    document.getElementById("closeDetail").addEventListener("click", () => {
      document.getElementById("detailPanel").hidden = true;
      document.getElementById("exportObsidianBtn").disabled = true;
      currentDetailItem = null;
      currentTab = 'summary';
    });
    document.getElementById("exportObsidianBtn").addEventListener("click", exportToObsidian);
    document.getElementById("exportObsidianBtn").disabled = true;
    
    document.getElementById("historyTable").addEventListener("change", (e) => {
      if (e.target.type === "radio") {
        const id = parseInt(e.target.value);
        if (!isNaN(id)) {
          viewDetail(id);
        }
      }
    });
    
    autoRefreshTimer = setInterval(refresh, 30000);
  }

  function refresh() {
    loadStats();
    loadHistory();
  }

  function loadStats() {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(renderStats);
  }

  function loadHistory() {
    fetch("/api/history?page=1&pageSize=50")
      .then((r) => r.json())
      .then(renderHistory);
  }

  function renderStats(data) {
    document.getElementById("kpiTotal").textContent = data.total;
    document.getElementById("kpiAvgScore").textContent = data.avgScore;

    const aCount = data.levelDistribution.A || 0;
    const aPct = data.total > 0 ? Math.round(aCount / data.total * 100) : 0;
    document.getElementById("kpiARatio").textContent = aPct + "%";
    document.getElementById("kpiViolations").textContent = data.violationsTotal;

    renderPieChart(data.levelDistribution, data.total);
    renderBarChart(data.avgDimensions);
  }

  function renderPieChart(dist, total) {
    const container = document.getElementById("pieChart");
    const legend = document.getElementById("pieLegend");
    container.innerHTML = "";
    legend.innerHTML = "";

    if (total === 0) {
      container.style.background = "#e8ecf4";
      legend.innerHTML = '<span style="color:#aaa;font-size:13px">暂无数据</span>';
      return;
    }

    const entries = Object.entries(dist).filter(([, v]) => v > 0);
    if (entries.length === 0) {
      container.style.background = "#e8ecf4";
      return;
    }

    let gradientParts = [];
    let cumulativeDeg = 0;

    entries.forEach(([level, count]) => {
      const deg = (count / total) * 360;
      const color = LEVEL_COLORS[level] || "#ccc";
      gradientParts.push(`${color} ${cumulativeDeg}deg ${cumulativeDeg + deg}deg`);
      cumulativeDeg += deg;

      const item = document.createElement("div");
      item.className = "pie-legend-item";
      item.innerHTML = `<span class="pie-legend-dot" style="background:${color}"></span>${level}级: ${count} (${Math.round(count / total * 100)}%)`;
      legend.appendChild(item);
    });

    container.style.background = `conic-gradient(${gradientParts.join(", ")})`;
  }

  function renderBarChart(dims) {
    const container = document.getElementById("barChart");
    container.innerHTML = "";

    const maxScore = 10;
    Object.entries(dims).forEach(([key, score]) => {
      const col = document.createElement("div");
      col.className = "bar-col";
      const pct = (score / maxScore) * 100;
      const color = DIM_COLORS[key] || "#888";
      col.innerHTML = `
        <div class="bar-fill" style="height:${pct}%;background:${color};">
          <span class="bar-fill-value">${score}</span>
        </div>
        <div class="bar-label">${DIM_LABELS[key] || key}</div>
      `;
      container.appendChild(col);
    });
  }

  function renderHistory(data) {
    const tbody = document.getElementById("historyBody");
    const empty = document.getElementById("emptyState");

    if (data.items.length === 0) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    tbody.innerHTML = data.items
      .map((r) => {
        const time = new Date(r.timestamp).toLocaleString("zh-CN");
        const isSelected = currentDetailItem && currentDetailItem.id === r.id;
        return `
          <tr class="history-row ${isSelected ? 'selected' : ''}" data-id="${r.id}">
            <td class="row-checkbox">
              <input type="radio" name="inspection-select" value="${r.id}" ${isSelected ? 'checked' : ''}>
            </td>
            <td>#${r.id}</td>
            <td>${time}</td>
            <td title="${r.fileName}">${truncate(r.fileName, 16)}</td>
            <td><strong>${r.totalScore}</strong></td>
            <td><span class="level-badge level-${r.level}">${r.level}级</span></td>
            <td>${r.emotion || "-"}</td>
            <td>${r.violationsCount}</td>
          </tr>
        `;
      })
      .join("");
  }

  function viewDetail(id) {
    fetch("/api/history?page=1&pageSize=1000")
      .then((r) => r.json())
      .then((data) => {
        document.getElementById("detailId").textContent = id;
        renderDetailPanel(id, data);
      });
  }

  function renderDetailPanel(id, allData) {
    const panel = document.getElementById("detailPanel");
    const body = document.getElementById("detailBody");
    document.getElementById("detailId").textContent = id;
    panel.hidden = false;

    const item = allData.items.find((i) => i.id === id);
    currentDetailItem = item;
    document.getElementById("exportObsidianBtn").disabled = !item;
    if (!item) {
      body.innerHTML = '<div class="empty-state">未找到记录</div>';
      return;
    }

    body.innerHTML = `
      <div class="detail-tabs">
        <button class="tab-btn active" data-tab="summary" data-id="${id}">📊 质检报告</button>
        <button class="tab-btn" data-tab="transcript" data-id="${id}">📝 转写内容</button>
      </div>
      <div class="tab-content" id="tab-summary-${id}">
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-dims">
            <div class="detail-dim"><span class="dim-name">文件</span><br><span class="dim-val">${escapeHtml(item.fileName)}</span></div>
            <div class="detail-dim"><span class="dim-name">时间</span><br><span class="dim-val">${new Date(item.timestamp).toLocaleString("zh-CN")}</span></div>
            <div class="detail-dim"><span class="dim-name">总分</span><br><span class="dim-val">${item.totalScore}分 (${item.level}级)</span></div>
            <div class="detail-dim"><span class="dim-name">情绪</span><br><span class="dim-val">${escapeHtml(item.emotion || "-")}</span></div>
          </div>
        </div>
        <div class="detail-section">
          <h4>维度评分</h4>
          <div class="detail-dims">
            ${Object.entries(item.dimensions || {})
              .map(
                ([k, v]) => `
              <div class="detail-dim">
                <span class="dim-name">${DIM_LABELS[k] || k}</span>
                <span class="dim-val" style="color:${DIM_COLORS[k]}">${v.score || v}/10</span>
                ${v.reason ? `<span class="dim-reason">${escapeHtml(v.reason)}</span>` : ''}
              </div>
            `
              )
              .join("")}
          </div>
        </div>
        <div class="detail-section">
          <h4>违规记录 (${item.violationsCount}项)</h4>
          <ul class="detail-violations" id="detailViolations-${id}"></ul>
        </div>
        <div class="detail-section">
          <h4>通话总结</h4>
          <div class="detail-summary">
            <p><strong>${escapeHtml(item.callSummary?.callPurpose || item.summary?.title || '通话总结')}</strong></p>
            <p>${escapeHtml(item.callSummary?.overallAssessment || item.summary?.verdict || '')}</p>
            <p><strong>客户诉求：</strong>${escapeHtml(item.callSummary?.customerRequest || '无')}</p>
            <p><strong>解决状态：</strong>${escapeHtml(item.callSummary?.resolutionStatus || '未知')}</p>
            <p><strong>关键要点：</strong></p>
            <ul>
              ${(Array.isArray(item.callSummary?.keyPoints) ? item.callSummary.keyPoints : (Array.isArray(item.summary?.highlights) ? item.summary.highlights : [])).map(h => `<li>${escapeHtml(h)}</li>`).join('')}
            </ul>
            <p><strong>后续行动：</strong></p>
            <ul>
              ${(Array.isArray(item.callSummary?.actionItems) ? item.callSummary.actionItems : []).map(a => `<li>${escapeHtml(a)}</li>`).join('')}
            </ul>
            <p><strong>改进建议：</strong></p>
            <ul>
              ${(Array.isArray(item.callSummary?.improvementSuggestions) ? item.callSummary.improvementSuggestions : []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
      <div class="tab-content hidden" id="tab-transcript-${id}">
        <div class="detail-section">
          <h4>完整转写 (${(item.utterances || []).length}句)</h4>
          ${renderTranscript(item.utterances || [])}
        </div>
      </div>
    `;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = e.target.getAttribute('data-tab');
        switchTab(id, tabId);
      });
    });

    renderViolations(id, item.violations || []);
  }

  function switchTab(id, tabId) {
    document.querySelectorAll(`#tab-summary-${id}, #tab-transcript-${id}`).forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}-${id}`)?.classList.remove('hidden');
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('active');
    currentTab = tabId;
  }

  function renderTranscript(utterances) {
    if (!utterances || utterances.length === 0) {
      return '<div class="empty-state compact">暂无转写内容</div>';
    }

    const getEmotionEmoji = (label) => {
      const map = {
        "平静": "😐", "愉悦": "😊", "焦急": "😰", "愤怒": "😠",
        "不满": "😒", "困惑": "😔", "冷漠": "😑", "惊讶": "😲"
      };
      return map[label] || "";
    };

    return `
      <div class="transcript-full">
        ${utterances.map((u, index) => {
          const role = u.role === "agent" ? "客服" : "客户";
          const emotion = u.emotion || {};
          const prosody = u.prosody || {};
          const emotionEmoji = getEmotionEmoji(emotion.label);
          
          return `
            <div class="transcript-full-item">
              <div class="transcript-header">
                <div class="transcript-left">
                  <span class="role-pill ${u.role || "unknown"}">${role}</span>
                  <span class="transcript-time">⏱ ${formatTime(u.start)} - ${formatTime(u.end)}</span>
                </div>
                <div class="transcript-right">
                  ${emotion.label ? `<span class="emotion-tag" title="置信度: ${(emotion.confidence * 100).toFixed(1)}%">${emotionEmoji} ${escapeHtml(emotion.label)}</span>` : ""}
                </div>
              </div>
              <div class="transcript-content">${escapeHtml(u.text || "")}</div>
              ${(prosody.speakingRate || prosody.avgPitch || prosody.volumeDb) ? `
              <div class="transcript-analysis">
                <span class="analysis-item" title="语速">语速: ${(prosody.speakingRate || 0).toFixed(1)} 字/秒</span>
                <span class="analysis-item" title="音调">音调: ${(prosody.avgPitch || 0).toFixed(0)} Hz</span>
                <span class="analysis-item" title="音量">音量: ${(prosody.volumeDb || 0).toFixed(1)} dB</span>
              </div>
              ` : ''}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderViolations(id, violations) {
    const list = document.getElementById(`detailViolations-${id}`);
    if (!list) return;

    if (violations.length === 0) {
      list.innerHTML = '<li style="color:#aaa">无违规记录</li>';
      return;
    }

    list.innerHTML = violations
      .map((v) => `<li><span class="severity-tag ${v.severity}">${severityLabel(v.severity)}</span>${escapeHtml(v.detail || "")}</li>`)
      .join("");
  }

  function severityLabel(s) {
    return { critical: "严重", major: "一般", minor: "轻微" }[s] || s;
  }

  function truncate(str, len) {
    return str && str.length > len ? str.slice(0, len) + "…" : str || "";
  }

  function formatTime(sec) {
    if (sec == null) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function exportToObsidian() {
    if (!currentDetailItem) {
      alert("请先选择一条质检记录");
      return;
    }

    const btn = document.getElementById("exportObsidianBtn");
    const originalText = btn.textContent;
    btn.textContent = "导出中...";
    btn.disabled = true;

    fetch("/api/export/obsidian", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(currentDetailItem),
    })
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          alert(`✅ 成功导出到 Obsidian!\n\n文件路径:\n${result.filePath}`);
        } else {
          alert(`❌ 导出失败: ${result.error}`);
        }
      })
      .catch((err) => {
        alert(`❌ 导出失败: ${err.message}`);
      })
      .finally(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      });
  }

  init();
})();
