/**
 * 音频波形可视化模块
 * Canvas 绘制模拟波形 + 说话人分段标注
 */
class WaveformVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.utterances = [];
    this.totalDuration = 0;
    this.currentHighlight = -1;
    this.onSegmentClick = null;
    this._init();
  }

  _init() {
    this.container.innerHTML = "";
    this.container.style.cssText =
      "background:white;border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid #e8ecf4;";

    const label = document.createElement("div");
    label.style.cssText =
      "font-size:15px;font-weight:600;margin-bottom:12px;color:#333;";
    label.textContent = "🎵 音频波形";
    this.container.appendChild(label);

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "width:100%;height:120px;border-radius:8px;cursor:pointer;display:block;";
    this.container.appendChild(this.canvas);

    const legend = document.createElement("div");
    legend.style.cssText =
      "display:flex;gap:16px;margin-top:8px;font-size:11px;color:#888;flex-wrap:wrap;";
    legend.innerHTML =
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#667eea;margin-right:4px;"></span>客服</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f59e0b;margin-right:4px;"></span>客户</span>' +
      '<span style="margin-left:auto;">点击波形跳转到对应句子</span>';
    this.container.appendChild(legend);

    this._resize();
    window.addEventListener("resize", () => this._resize());

    this.canvas.addEventListener("click", (e) => this._handleClick(e));
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(dpr, dpr);
    this.W = rect.width;
    this.H = rect.height;
    this.render();
  }

  render(utterances, totalDuration) {
    if (utterances) this.utterances = utterances;
    if (totalDuration != null) this.totalDuration = totalDuration;
    if (!this.ctx) return;
    this._draw();
  }

  highlightSegment(index) {
    this.currentHighlight = index;
    this._draw();
  }

  _draw() {
    const { ctx, W, H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Draw speaker segment backgrounds
    for (const u of this.utterances) {
      const x1 = (u.start / this.totalDuration) * W;
      const x2 = (u.end / this.totalDuration) * W;
      ctx.fillStyle =
        u.role === "agent"
          ? "rgba(102,126,234,0.08)"
          : "rgba(245,158,11,0.08)";
      ctx.fillRect(x1, 0, x2 - x1, H);
    }

    // Draw waveform (multiple layers for realism)
    this._drawWaveform();

    // Draw time axis
    this._drawTimeAxis();

    // Draw segment dividers and labels
    for (let i = 0; i < this.utterances.length; i++) {
      const u = this.utterances[i];
      const x1 = (u.start / this.totalDuration) * W;
      const x2 = (u.end / this.totalDuration) * W;

      // Divider line
      if (i > 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, H);
        ctx.stroke();
      }

      // Highlight
      if (i === this.currentHighlight) {
        ctx.fillStyle = "rgba(102,126,234,0.2)";
        ctx.fillRect(x1, 0, x2 - x1, H);
        ctx.strokeStyle = "#667eea";
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, 0, x2 - x1, H);
      }
    }
  }

  _drawWaveform() {
    const { ctx, W, H } = this;
    const midY = H / 2;
    const seed = 42;

    // Layer 1: Low frequency body
    ctx.beginPath();
    ctx.strokeStyle = "rgba(102,126,234,0.5)";
    ctx.lineWidth = 1.5;
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const timePos = t * this.totalDuration;
      // Find which segment we're in
      const seg = this.utterances.find(
        (u) => timePos >= u.start && timePos <= u.end
      );
      const inSpeech = !!seg;

      const baseAmp = inSpeech ? 25 + Math.sin(t * 15 + seed) * 10 : 3;
      const noise =
        Math.sin(t * 47.3 + seed) * 0.3 +
        Math.sin(t * 93.7 + seed) * 0.2 +
        Math.sin(t * 171.1 + seed) * 0.15;
      const amp = baseAmp + noise * baseAmp * 0.8;

      const y = midY + amp * Math.sin(t * 30 + seed * 2);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Layer 2: Mid frequency detail
    ctx.beginPath();
    ctx.strokeStyle = "rgba(102,126,234,0.3)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const timePos = t * this.totalDuration;
      const seg = this.utterances.find(
        (u) => timePos >= u.start && timePos <= u.end
      );
      const inSpeech = !!seg;

      const baseAmp = inSpeech ? 18 + Math.sin(t * 23 + seed * 3) * 8 : 2;
      const noise =
        Math.sin(t * 67.1 + seed * 4) * 0.4 +
        Math.sin(t * 129.3 + seed * 5) * 0.25;
      const amp = baseAmp + noise * baseAmp * 0.6;

      const y = midY + amp * Math.cos(t * 45 + seed * 6);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Layer 3: High frequency peaks
    ctx.beginPath();
    ctx.strokeStyle = "rgba(102,126,234,0.2)";
    ctx.lineWidth = 0.8;
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const timePos = t * this.totalDuration;
      const seg = this.utterances.find(
        (u) => timePos >= u.start && timePos <= u.end
      );
      const inSpeech = !!seg;

      const baseAmp = inSpeech ? 12 : 1;
      const noise =
        Math.sin(t * 153.7 + seed * 7) * 0.5 +
        Math.sin(t * 281.3 + seed * 8) * 0.3 +
        Math.sin(t * 419.1 + seed * 9) * 0.2;
      const amp = baseAmp + noise * baseAmp;

      const y = midY + amp * Math.sin(t * 80 + seed * 10);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Mirrored waveform (lower half)
    ctx.beginPath();
    ctx.strokeStyle = "rgba(118,75,162,0.3)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const timePos = t * this.totalDuration;
      const seg = this.utterances.find(
        (u) => timePos >= u.start && timePos <= u.end
      );
      const inSpeech = !!seg;

      const baseAmp = inSpeech ? 20 + Math.cos(t * 19 + seed * 11) * 8 : 2;
      const noise =
        Math.sin(t * 73.3 + seed * 12) * 0.35 +
        Math.sin(t * 137.9 + seed * 13) * 0.2;
      const amp = baseAmp + noise * baseAmp * 0.7;

      const y = midY - amp * Math.sin(t * 35 + seed * 14);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawTimeAxis() {
    const { ctx, W, H } = this;
    ctx.fillStyle = "#aaa";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";

    const step = Math.ceil(this.totalDuration / 10);
    for (let t = 0; t <= this.totalDuration; t += step) {
      const x = (t / this.totalDuration) * W;
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      const label = m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
      ctx.fillText(label, x, H - 4);
    }
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timePos = (x / this.W) * this.totalDuration;

    for (let i = 0; i < this.utterances.length; i++) {
      const u = this.utterances[i];
      if (timePos >= u.start && timePos <= u.end) {
        this.highlightSegment(i);
        if (this.onSegmentClick) this.onSegmentClick(i, u);
        return;
      }
    }

    // Find nearest
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.utterances.length; i++) {
      const mid = (this.utterances[i].start + this.utterances[i].end) / 2;
      const dist = Math.abs(timePos - mid);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    this.highlightSegment(nearest);
    if (this.onSegmentClick)
      this.onSegmentClick(nearest, this.utterances[nearest]);
  }
}

window.WaveformVisualizer = WaveformVisualizer;
