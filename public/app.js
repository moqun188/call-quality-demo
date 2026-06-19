/**
 * 录音质检系统 MVP — 前端逻辑
 */
(function () {
  const DOM = {
    loadingOverlay: document.getElementById("loadingOverlay"),
    themeToggle: document.getElementById("themeToggle"),
    uploadArea: document.getElementById("uploadArea"),
    fileInput: document.getElementById("fileInput"),
    uploadBtn: document.getElementById("uploadBtn"),
    demoBtn: null,
    fileInfo: document.getElementById("fileInfo"),
    pipeline: document.getElementById("pipeline"),
    steps: document.getElementById("steps"),
    progressBar: document.getElementById("progressBar"),
    progressFill: document.getElementById("progressFill"),
    progressPercent: document.getElementById("progressPercent"),
    progressPercentOuter: document.getElementById("progressPercentOuter"),
    progressStatus: document.getElementById("progressStatus"),
    results: document.getElementById("results"),
    scoreBadge: document.getElementById("scoreBadge"),
    scoreValue: document.getElementById("scoreValue"),
    summaryCard: document.getElementById("summaryCard"),
    dimensionGrid: document.getElementById("dimensionGrid"),
    transcript: document.getElementById("transcript"),
    violations: document.getElementById("violations"),
    suggestions: document.getElementById("suggestions"),
    emotionChart: document.getElementById("emotionChart"),
    resetBtn: document.getElementById("resetBtn"),
    scenarioList: document.getElementById("scenarioList"),
    waveformContainer: document.getElementById("waveformContainer"),
    exportExcelBtn: document.getElementById("exportExcelBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
  };

  var currentResultData = null;

  var waveform = null;

  const STEP_ICONS = {
    "音频预处理": "🎵",
    "语音转写 (ASR)": "📝",
    "说话人分离": "👥",
    "语气语调分析": "💬",
    "通话总结生成": "📋",
    "质检评分": "✅",
  };

  const STEP_SUBSTEPS = {
    "音频预处理": ["检测音频格式", "降噪处理", "音量标准化"],
    "语音转写 (ASR)": ["加载语音模型", "执行转写", "校验转写结果"],
    "说话人分离": ["提取声纹特征", "聚类分离", "标注说话人"],
    "语气语调分析": ["提取韵律特征", "分析情绪维度", "标注情绪标签"],
    "通话总结生成": ["生成通话摘要", "提取关键要点", "识别客户诉求"],
    "质检评分": ["规则引擎评分", "多维度打分", "生成质检报告"],
  };

  var currentTranscriptFilter = "all";
  var storedUtterances = [];

  // --- Event Handlers ---

  DOM.uploadBtn.addEventListener("click", function () {
    DOM.fileInput.click();
  });

  DOM.fileInput.addEventListener("change", function (e) {
    if (e.target.files.length > 0) {
      startInspection(e.target.files[0]);
    }
  });

  DOM.uploadArea.addEventListener("dragover", function (e) {
    e.preventDefault();
    DOM.uploadArea.classList.add("dragover");
  });

  DOM.uploadArea.addEventListener("dragleave", function () {
    DOM.uploadArea.classList.remove("dragover");
  });

  DOM.uploadArea.addEventListener("drop", function (e) {
    e.preventDefault();
    DOM.uploadArea.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      startInspection(e.dataTransfer.files[0]);
    }
  });

  if (DOM.demoBtn) {
    DOM.demoBtn.addEventListener("click", function () {
      runDemo();
    });
  }

  if (DOM.exportExcelBtn) {
    DOM.exportExcelBtn.addEventListener("click", function () {
      downloadReport("excel");
    });
  }

  if (DOM.exportJsonBtn) {
    DOM.exportJsonBtn.addEventListener("click", function () {
      downloadReport("json");
    });
  }

  DOM.resetBtn.addEventListener("click", function () {
    DOM.results.hidden = true;
    DOM.pipeline.hidden = true;
    DOM.pipeline.classList.remove("processing");
    DOM.uploadArea.hidden = false;
    DOM.uploadArea.hidden = false;
    DOM.fileInfo.hidden = true;
    DOM.fileInput.value = "";
    DOM.uploadArea.classList.add("fade-in");
    waveform = null;
  });

  // --- Load Scenarios ---

  fetch("/api/scenarios")
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.success && res.data) {
        var html = "";
        for (var i = 0; i < res.data.length; i++) {
          var s = res.data[i];
          html += '<button class="scenario-btn ripple-btn" data-scenario="' + s.id + '">';
          html += '<span class="scenario-icon">' + s.icon + '</span>';
          html += '<span class="scenario-name">' + s.name + '</span>';
          html += '<span class="scenario-desc">' + s.description + '</span>';
          html += '</button>';
        }
        DOM.scenarioList.innerHTML = html;

        DOM.scenarioList.querySelectorAll(".scenario-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            runDemo(btn.dataset.scenario);
          });
        });
      }
    })
    .catch(function () {});

  // --- Ripple Effect ---

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".ripple-btn");
    if (!btn) return;
    var circle = document.createElement("span");
    var diameter = Math.max(btn.clientWidth, btn.clientHeight);
    var radius = diameter / 2;
    var rect = btn.getBoundingClientRect();
    circle.style.width = circle.style.height = diameter + "px";
    circle.style.left = e.clientX - rect.left - radius + "px";
    circle.style.top = e.clientY - rect.top - radius + "px";
    circle.classList.add("ripple");
    var existingRipple = btn.querySelector(".ripple");
    if (existingRipple) existingRipple.remove();
    btn.appendChild(circle);
  });

  // --- Collapsible Sections ---

  document.querySelectorAll(".section-header").forEach(function (header) {
    header.addEventListener("click", function () {
      var section = header.closest(".collapsible-section");
      section.classList.toggle("collapsed");
    });
  });

  // --- Transcript Filters ---

  var transcriptFiltersEl = document.getElementById("transcriptFilters");
  if (transcriptFiltersEl) {
    transcriptFiltersEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".filter-btn");
    if (!btn) return;
    document.querySelectorAll(".filter-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    currentTranscriptFilter = btn.dataset.filter;
    renderTranscript(storedUtterances);
  });
  }

  // --- Dark Mode ---

  function initTheme() {
    var saved = localStorage.getItem("cqd-theme");
    if (saved === "dark") {
      document.body.classList.add("dark-mode");
      DOM.themeToggle.textContent = "\u2600\uFE0F";
    }
  }

  function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    var isDark = document.body.classList.contains("dark-mode");
    DOM.themeToggle.textContent = isDark ? "\u2600\uFE0F" : "\uD83C\uDF19";
    localStorage.setItem("cqd-theme", isDark ? "dark" : "light");
  }

  if (DOM.themeToggle) {
    DOM.themeToggle.addEventListener("click", toggleTheme);
  }
  initTheme();

  // --- Keyboard Shortcuts ---

  document.addEventListener("keydown", function (e) {
    if (e.key === "d" || e.key === "D") {
      var tag = document.activeElement.tagName.toLowerCase();
      if (tag !== "input" && tag !== "textarea") {
        toggleTheme();
      }
    }
    if (e.key === "Escape") {
      if (!DOM.results.hidden) {
        DOM.resetBtn.click();
      }
    }
  });

  // --- Loading Overlay ---

  function showLoading() {
    DOM.loadingOverlay.hidden = false;
  }

  function hideLoading() {
    DOM.loadingOverlay.hidden = true;
  }

  // --- Core Logic ---

  function startInspection(file) {
    DOM.fileInfo.hidden = false;
    DOM.fileInfo.textContent = "\uD83D\uDCC4 " + file.name + " (" + formatSize(file.size) + ")";
    DOM.uploadArea.hidden = true;
    DOM.pipeline.hidden = false;
    DOM.pipeline.classList.add("processing");
    DOM.pipeline.classList.add("fade-in");

    var formData = new FormData();
    formData.append("audio", file);

    renderSteps();
    DOM.progressFill.style.width = "0%";
    if (DOM.progressPercent) DOM.progressPercent.textContent = "0%";
    if (DOM.progressPercentOuter) DOM.progressPercentOuter.textContent = "0%";
    if (DOM.progressStatus) DOM.progressStatus.textContent = "准备中...";

    // 使用 fetch + ReadableStream 读取流式 NDJSON 响应
    fetch("/api/inspect", {
      method: "POST",
      body: formData,
    })
      .then(function (response) {
        if (!response.ok) throw new Error("请求失败: " + response.status);
        var reader = response.body.getReader();
        var decoder = new TextDecoder("utf-8");
        var buffer = "";

        return reader.read().then(function processChunk(result) {
          if (result.done) {
            buffer = "";
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
              var obj = JSON.parse(line);
              if (obj.type === "step") {
                updateStep(obj.stepIndex, obj.step);
                var elapsed = (obj.elapsed / 1000).toFixed(1);
                if (DOM.progressStatus) {
                  if (obj.step.status === "processing") {
                    DOM.progressStatus.textContent = "步骤 " + (obj.stepIndex + 1) + "/6 · " + obj.step.name + "... (" + elapsed + "s)";
                  } else if (obj.step.status === "completed") {
                    DOM.progressStatus.textContent = "✓ " + obj.step.name + " (" + elapsed + "s)";
                  } else {
                    DOM.progressStatus.textContent = obj.step.name + " " + (obj.step.detail || "");
                  }
                }
              } else if (obj.type === "complete") {
                if (DOM.progressStatus) DOM.progressStatus.textContent = "✓ 质检完成 · 共 " + (obj.data ? obj.data.totalTime : "");
                displayResults(obj.data);
                DOM.pipeline.classList.remove("processing");
              } else if (obj.type === "error") {
                showError(obj.error);
                DOM.pipeline.classList.remove("processing");
              }
            } catch (e) {
              console.warn("解析失败:", e, line);
            }
          }

          return reader.read().then(processChunk);
        });
      })
      .catch(function (err) {
        showError(err.message);
        DOM.pipeline.classList.remove("processing");
      });
  }

  function runDemo(scenarioId) {
    DOM.uploadArea.hidden = true;
    DOM.pipeline.hidden = false;
    DOM.pipeline.classList.add("processing");
    DOM.pipeline.classList.add("fade-in");

    renderSteps();
    animateProgress(0);

    var url = "/api/inspect/demo";
    if (scenarioId) url += "?scenario=" + scenarioId;

    fetch(url, { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success) {
          displayResults(res.data);
        } else {
          showError(res.error);
        }
      })
      .catch(function (err) { showError(err.message); });
  }

  function renderSteps() {
    var names = ["音频预处理", "语音转写 (ASR)", "说话人分离", "语气语调分析", "通话总结生成", "质检评分"];
    var html = "";
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var substeps = STEP_SUBSTEPS[name] || [];
      var subHtml = "";
      for (var j = 0; j < substeps.length; j++) {
        subHtml += '<div class="step-substep">' + substeps[j] + '</div>';
      }
      html += '<div class="step pending" data-step="' + i + '" id="step-' + i + '">';
      html += '<div class="step-icon">' + (STEP_ICONS[name] || "○") + '</div>';
      html += '<div class="step-name">' + name + '</div>';
      html += '<div class="step-detail" id="stepDetail-' + i + '"></div>';
      html += '</div>';
      html += '<div class="step-substeps" id="stepSubsteps-' + i + '">' + subHtml + '</div>';
    }
    DOM.steps.innerHTML = html;
  }

  // 更新单个步骤状态
  function updateStep(stepIndex, step) {
    var el = document.getElementById("step-" + stepIndex);
    if (!el) return;
    el.className = "step " + step.status;
    if (step.status === "processing") {
      el.className = "step processing pulse";
    }
    var detail = document.getElementById("stepDetail-" + stepIndex);
    if (detail && step.detail) {
      detail.textContent = step.detail;
    }
    if (step.status === "completed") {
      animateStepSubsteps(stepIndex);
    }
    // 更新进度条宽度与百分比文本
    var totalSteps = 6;
    var pct;
    if (step.status === "processing") {
      pct = ((stepIndex + 0.4) / totalSteps) * 100;
    } else if (step.status === "completed") {
      pct = ((stepIndex + 1) / totalSteps) * 100;
    } else {
      pct = (stepIndex / totalSteps) * 100;
    }
    pct = Math.max(2, Math.min(100, pct));
    DOM.progressFill.style.width = pct + "%";
    var pctText = Math.round(pct) + "%";
    if (DOM.progressPercent) DOM.progressPercent.textContent = pctText;
    if (DOM.progressPercentOuter) DOM.progressPercentOuter.textContent = pctText;
  }

  function animateStepSubsteps(stepIndex) {
    var substeps = document.getElementById("stepSubsteps-" + stepIndex);
    if (!substeps) return;
    var items = substeps.querySelectorAll(".step-substep");
    items.forEach(function (item, i) {
      setTimeout(function () {
        item.classList.add("visible");
      }, i * 400);
    });
    substeps.classList.add("expanded");
  }

  function animateProgress(duration) {
    var totalSteps = 5;
    var current = 0;
    var interval = (duration || 6000) / totalSteps;
    DOM.progressFill.style.width = "0%";

    var timer = setInterval(function () {
      current++;
      var pct = (current / totalSteps) * 100;
      DOM.progressFill.style.width = pct + "%";

      for (var i = 0; i < totalSteps; i++) {
        var el = document.getElementById("step-" + i);
        if (i < current) {
          el.className = "step completed";
        } else if (i === current) {
          el.className = "step processing";
          animateStepSubsteps(i);
        } else {
          el.className = "step pending";
        }
      }

      if (current >= totalSteps) {
        clearInterval(timer);
        DOM.pipeline.classList.remove("processing");
      }
    }, interval);
  }

  function displayResults(data) {
    currentResultData = data;
    DOM.progressFill.style.width = "100%";
    for (var i = 0; i < 5; i++) {
      var el = document.getElementById("step-" + i);
      el.className = "step completed";
      var sub = document.getElementById("stepSubsteps-" + i);
      if (sub) sub.classList.add("expanded");
    }

    if (data.steps) {
      data.steps.forEach(function (s, i) {
        var detail = document.getElementById("stepDetail-" + i);
        if (detail && s.detail) detail.textContent = s.detail;
      });
    }

    setTimeout(function () {
      DOM.pipeline.hidden = true;
      DOM.pipeline.classList.remove("processing");
      DOM.results.hidden = false;
      DOM.results.classList.add("fade-in");

      var q = data.quality;
      animateScoreCount(q.totalScore, q.level);
      renderSummary(data.summary);
      renderDimensions(q.dimensions);
      storedUtterances = data.utterances || [];
      currentTranscriptFilter = "all";
      renderTranscript(storedUtterances);
      renderViolations(q.violations);
      renderSuggestions(q.suggestions);
      renderEmotionChart(data.utterances);
      renderWaveform(data.utterances);
    }, 500);
  }

  // --- Score Count Animation ---

  function animateScoreCount(target, level) {
    var el = DOM.scoreValue;
    var duration = 800;
    var startTime = performance.now();
    var from = 0;

    function tick(now) {
      var elapsed = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (target - from) * eased);
      el.textContent = current;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = target;
      }
    }

    DOM.scoreBadge.className = "score-badge level-" + level;
    requestAnimationFrame(tick);
  }

  // --- Render Functions ---

  function renderScore(score, level) {
    DOM.scoreValue.textContent = score;
    DOM.scoreBadge.className = "score-badge level-" + level;
  }

  function renderSummary(summary) {
    var highlights = summary.highlights.map(function (h) {
      return '<div>\u2022 ' + h + '</div>';
    }).join("");
    DOM.summaryCard.innerHTML =
      '<div class="verdict">' + summary.title + " \u2014 " + summary.verdict + '</div>' +
      '<div class="highlights">' + highlights +
      '<div style="margin-top:6px;color:#888">\uD83D\uDE0A ' + summary.emotionSummary + '</div>' +
      '</div>';
  }

  function renderDimensions(dims) {
    var labels = {
      compliance: { name: "话术合规", color: "#667eea" },
      knowledge: { name: "业务知识", color: "#22c55e" },
      process: { name: "流程完整", color: "#f59e0b" },
      communication: { name: "沟通技巧", color: "#ec4899" },
    };

    var html = "";
    var keys = Object.keys(dims);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var dim = dims[key];
      var info = labels[key] || { name: key, color: "#888" };
      var pct = (dim.score / 10) * 100;
      html += '<div class="dimension-card">';
      html += '<div class="dim-header">';
      html += '<span class="dim-name">' + info.name + '</span>';
      html += '<span class="dim-score" style="color:' + info.color + '">' + dim.score + '/10</span>';
      html += '</div>';
      html += '<div class="dim-reason">' + dim.reason + '</div>';
      html += '<div class="dim-bar">';
      html += '<div class="dim-bar-fill" style="width:' + pct + '%;background:' + info.color + '"></div>';
      html += '</div></div>';
    }
    DOM.dimensionGrid.innerHTML = html;
  }

  function renderTranscript(utterances) {
    if (!utterances || utterances.length === 0) {
      DOM.transcript.innerHTML = '<div class="empty-state">无对话记录</div>';
      return;
    }

    var filtered = utterances;
    if (currentTranscriptFilter !== "all") {
      filtered = utterances.filter(function (u) {
        return u.role === currentTranscriptFilter;
      });
    }

    if (filtered.length === 0) {
      DOM.transcript.innerHTML = '<div class="empty-state">无匹配记录</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < filtered.length; i++) {
      var u = filtered[i];
      var roleLabel = u.role === "agent" ? "客服" : "客户";
      var emoji = u.emotion ? getEmotionEmoji(u.emotion.label) : "";
      var emoText = u.emotion ? u.emotion.label : "";
      var originalIndex = utterances.indexOf(u);
      html += '<div class="transcript-item" data-index="' + originalIndex + '" style="cursor:pointer;">';
      html += '<span class="role-tag ' + u.role + '">' + roleLabel + '</span>';
      html += '<span class="text">' + u.text + '</span>';
      html += '<span class="emotion-tag">' + emoji + ' ' + emoText + '</span>';
      html += '<span class="time">' + formatTime(u.start) + ' ~ ' + formatTime(u.end) + '</span>';
      html += '</div>';
    }
    DOM.transcript.innerHTML = html;

    DOM.transcript.querySelectorAll(".transcript-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var idx = parseInt(item.dataset.index);
        if (waveform) {
          waveform.highlightSegment(idx);
          waveform.canvas.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  }

  function renderViolations(violations) {
    if (!violations || violations.length === 0) {
      DOM.violations.innerHTML = '<div class="empty-state">\u2705 未检出违规项</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < violations.length; i++) {
      var v = violations[i];
      html += '<div class="violation-item">';
      html += '<span class="severity-tag ' + v.severity + '">' + severityLabel(v.severity) + '</span>';
      html += '<span>' + v.detail + '</span>';
      html += '</div>';
    }
    DOM.violations.innerHTML = html;
  }

  function renderSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      DOM.suggestions.innerHTML = '<div class="empty-state">无改进建议</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < suggestions.length; i++) {
      html += '<div class="suggestion-item">\uD83D\uDCA1 ' + suggestions[i] + '</div>';
    }
    DOM.suggestions.innerHTML = html;
  }

  function renderEmotionChart(utterances) {
    if (!utterances || utterances.length === 0) return;

    var customer = utterances.filter(function (u) { return u.role === "customer"; });
    if (customer.length === 0) return;

    var maxValence = 0.1;
    for (var i = 0; i < customer.length; i++) {
      var v = (customer[i].emotion && customer[i].emotion.dimensions)
        ? customer[i].emotion.dimensions.valence || 0.5
        : 0.5;
      if (v > maxValence) maxValence = v;
    }

    var html = "";
    for (var j = 0; j < customer.length; j++) {
      var u = customer[j];
      var val = (u.emotion && u.emotion.dimensions)
        ? u.emotion.dimensions.valence || 0.5
        : 0.5;
      var h = (val / maxValence) * 100;
      var color = getValenceColor(val);
      var label = (u.emotion && u.emotion.label) ? u.emotion.label : "";
      html += '<div class="emotion-bar" style="height:' + h + '%;background:' + color + ';" title="' + label + '">';
      html += '<div class="bar-label">#' + (j + 1) + '</div>';
      html += '</div>';
    }
    DOM.emotionChart.innerHTML = html;

    var legend = document.createElement("div");
    legend.style.cssText = "display:flex;gap:16px;margin-top:28px;font-size:12px;color:#666;justify-content:center;flex-wrap:wrap;";
    legend.innerHTML =
      '<span>\uD83D\uDD34 负向</span>' +
      '<span>\uD83D\uDFE1 中性</span>' +
      '<span>\uD83D\uDFE2 正向</span>' +
      '<span style="margin-left:16px">客户对话情绪走向 (' + customer.length + ' 句)</span>';
    DOM.emotionChart.appendChild(legend);
  }

  function renderWaveform(utterances) {
    if (!utterances || utterances.length === 0) return;
    var totalDuration = utterances[utterances.length - 1].end || 1;

    if (!waveform) {
      waveform = new WaveformVisualizer("waveformContainer");
      waveform.onSegmentClick = function (index, utterance) {
        // Scroll transcript to the clicked segment
        var items = DOM.transcript.querySelectorAll(".transcript-item");
        // Find the matching item by matching start time
        for (var i = 0; i < items.length; i++) {
          var timeEl = items[i].querySelector(".time");
          if (timeEl && timeEl.textContent.indexOf(formatTime(utterance.start)) === 0) {
            items[i].scrollIntoView({ behavior: "smooth", block: "center" });
            items[i].style.background = "#eef0ff";
            setTimeout(function () { items[i].style.background = ""; }, 2000);
            break;
          }
        }
      };
    }

    waveform.render(utterances, totalDuration);
  }

  function showError(msg) {
    DOM.pipeline.hidden = true;
    DOM.pipeline.classList.remove("processing");
    DOM.uploadArea.hidden = false;
    DOM.fileInfo.hidden = true;
    alert("\u8D28\u68C0\u5931\u8D25: " + msg);
  }

  function downloadReport(type) {
    if (!currentResultData) return;

    var extension = type === "excel" ? "xlsx" : "json";
    fetch("/api/export/" + type, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentResultData),
    })
      .then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            throw new Error(readErrorMessage(text));
          });
        }
        return response.blob().then(function (blob) {
          return { blob: blob, fileName: getExportFileName(response, extension) };
        });
      })
      .then(function (result) {
        var url = URL.createObjectURL(result.blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = result.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch(function (err) {
        alert("报告导出失败: " + (err.message || "请稍后重试"));
      });
  }

  function readErrorMessage(text) {
    try {
      var parsed = JSON.parse(text);
      if (parsed && parsed.error) return parsed.error;
    } catch (e) {}
    return text || "服务器未返回导出文件";
  }

  function getExportFileName(response, extension) {
    var header = response.headers.get("Content-Disposition") || "";
    var utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (e) {}
    }

    var asciiMatch = header.match(/filename="?([^";]+)"?/i);
    if (asciiMatch) return asciiMatch[1];

    var baseName = String(currentResultData.fileName || "质检报告").replace(/\.[^.]+$/, "");
    return baseName + "_质检报告." + extension;
  }

  // --- Helpers ---

  function formatTime(sec) {
    if (sec == null) return "";
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m > 0 ? m + ":" + (s < 10 ? "0" : "") + s : s + "s";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
    return (bytes / 1024 / 1024).toFixed(1) + "MB";
  }

  function severityLabel(s) {
    var map = { critical: "严重", major: "一般", minor: "轻微" };
    return map[s] || s;
  }

  function getEmotionEmoji(label) {
    var map = {
      "\u5E73\u9759": "\uD83D\uDE10",
      "\u6109\u60A6": "\uD83D\uDE0A",
      "\u7126\u6025": "\uD83D\uDE30",
      "\u6124\u6012": "\uD83D\uDE21",
      "\u4E0D\u6EE1": "\uD83D\uDE12",
      "\u56F0\u60D1": "\uD83E\uDD14",
      "\u51B7\u6F20": "\uD83D\uDE11",
      "\u60CA\u8BB6": "\uD83D\uDE32",
    };
    return map[label] || "";
  }

  function getValenceColor(v) {
    if (v < 0.3) return "#ef4444";
    if (v < 0.5) return "#f97316";
    if (v < 0.7) return "#f59e0b";
    return "#22c55e";
  }

  // --- S5-012: 质检员反馈 ---

  (function initFeedback() {
    var feedbackActions = document.getElementById("feedbackActions");
    var feedbackForm = document.getElementById("feedbackForm");
    var feedbackResult = document.getElementById("feedbackResult");
    var confirmBtn = document.getElementById("feedbackConfirmBtn");
    var correctBtn = document.getElementById("feedbackCorrectBtn");
    var submitBtn = document.getElementById("feedbackSubmitBtn");
    var cancelBtn = document.getElementById("feedbackCancelBtn");
    var humanScoreInput = document.getElementById("humanScore");
    var feedbackNotes = document.getElementById("feedbackNotes");

    if (!confirmBtn) return;

    confirmBtn.addEventListener("click", function () {
      submitFeedback("confirm");
    });

    correctBtn.addEventListener("click", function () {
      feedbackActions.hidden = true;
      feedbackForm.hidden = false;
      if (currentResultData && currentResultData.quality) {
        humanScoreInput.value = currentResultData.quality.totalScore;
      }
    });

    cancelBtn.addEventListener("click", function () {
      feedbackForm.hidden = true;
      feedbackActions.hidden = false;
    });

    submitBtn.addEventListener("click", function () {
      submitFeedback("correct");
    });

    function submitFeedback(type) {
      if (!currentResultData || !currentResultData.inspectionId) {
        showFeedbackResult("error", "无法提交反馈：缺少质检记录 ID");
        return;
      }

      var body = {
        inspectionId: currentResultData.inspectionId,
        feedbackType: type,
      };

      if (type === "correct") {
        body.humanScore = parseInt(humanScoreInput.value) || null;
        body.notes = feedbackNotes.value || null;
      }

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success) {
            feedbackActions.hidden = true;
            feedbackForm.hidden = true;
            showFeedbackResult(
              "success",
              type === "confirm" ? "已确认 AI 质检结果准确" : "纠正已提交，感谢反馈！"
            );
          } else {
            showFeedbackResult("error", res.error || "提交失败");
          }
        })
        .catch(function (err) {
          showFeedbackResult("error", "网络错误: " + err.message);
        });
    }

    function showFeedbackResult(type, msg) {
      feedbackResult.hidden = false;
      feedbackResult.className = "feedback-result feedback-" + type;
      feedbackResult.textContent = msg;
    }

    // 重置反馈状态（重新质检时）
    var origReset = DOM.resetBtn.onclick;
    DOM.resetBtn.addEventListener("click", function () {
      feedbackActions.hidden = false;
      feedbackForm.hidden = true;
      feedbackResult.hidden = true;
      humanScoreInput.value = "";
      feedbackNotes.value = "";
    });
  })();
})();
