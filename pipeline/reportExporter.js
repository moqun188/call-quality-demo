const ExcelJS = require("exceljs");

async function exportToExcel(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "录音质检系统";
  workbook.created = new Date();

  // Sheet1: 质检总览
  const overviewSheet = workbook.addWorksheet("质检总览");
  overviewSheet.columns = [
    { header: "文件名", key: "fileName", width: 24 },
    { header: "总分", key: "totalScore", width: 10 },
    { header: "等级", key: "level", width: 10 },
    { header: "话术合规", key: "compliance", width: 12 },
    { header: "业务知识", key: "knowledge", width: 12 },
    { header: "流程完整", key: "process", width: 12 },
    { header: "沟通技巧", key: "communication", width: 12 },
    { header: "违规数", key: "violationCount", width: 10 },
    { header: "处理时间", key: "totalTime", width: 12 },
  ];

  const dims = data.quality.dimensions;
  const row = overviewSheet.addRow({
    fileName: data.fileName,
    totalScore: data.quality.totalScore,
    level: data.quality.level,
    compliance: dims.compliance.score,
    knowledge: dims.knowledge.score,
    process: dims.process.score,
    communication: dims.communication.score,
    violationCount: (data.quality.violations || []).length,
    totalTime: data.totalTime,
  });

  // Style header
  const headerRow = overviewSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF667EEA" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Conditional formatting for total score
  const scoreCol = overviewSheet.getColumn("totalScore");
  overviewSheet.addConditionalFormatting({
    ref: "B2:B2",
    rules: [
      { type: "cellIs", operator: "greaterThanOrEqual", priority: 1, formulae: [90], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFE8F5E9" } }, font: { color: { argb: "FF16A34A" } } } },
      { type: "cellIs", operator: "between", priority: 2, formulae: [70, 89], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEFCE8" } }, font: { color: { argb: "FFCA8A04" } } } },
      { type: "cellIs", operator: "lessThan", priority: 3, formulae: [70], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF2F2" } }, font: { color: { argb: "FFDC2626" } } } },
    ],
  });

  overviewSheet.getRow(1).height = 24;
  overviewSheet.autoFilter = { from: "A1", to: "I1" };

  // Sheet2: 对话明细
  const dialogSheet = workbook.addWorksheet("对话明细");
  dialogSheet.columns = [
    { header: "序号", key: "index", width: 6 },
    { header: "说话人", key: "speaker", width: 10 },
    { header: "角色", key: "role", width: 10 },
    { header: "文本", key: "text", width: 48 },
    { header: "情绪", key: "emotion", width: 12 },
    { header: "时间戳", key: "timestamp", width: 16 },
    { header: "语速(字/秒)", key: "speechRate", width: 12 },
  ];

  const dialogHeader = dialogSheet.getRow(1);
  dialogHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  dialogHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22C55E" } };
  dialogHeader.alignment = { horizontal: "center", vertical: "middle" };

  (data.utterances || []).forEach((u, i) => {
    const duration = u.end - u.start;
    const speechRate = duration > 0 ? (u.text.length / duration).toFixed(1) : "0.0";
    dialogSheet.addRow({
      index: i + 1,
      speaker: u.speaker || "",
      role: u.role === "agent" ? "客服" : "客户",
      text: u.text,
      emotion: u.emotion ? u.emotion.label : "",
      timestamp: `${formatTime(u.start)} ~ ${formatTime(u.end)}`,
      speechRate: parseFloat(speechRate),
    });
  });

  dialogSheet.autoFilter = { from: "A1", to: "G1" };

  // Sheet3: 违规记录
  const violationSheet = workbook.addWorksheet("违规记录");
  violationSheet.columns = [
    { header: "序号", key: "index", width: 6 },
    { header: "类型", key: "type", width: 16 },
    { header: "详情", key: "detail", width: 48 },
    { header: "严重度", key: "severity", width: 10 },
    { header: "时间点", key: "timestamp", width: 16 },
  ];

  const violationHeader = violationSheet.getRow(1);
  violationHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  violationHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEF4444" } };
  violationHeader.alignment = { horizontal: "center", vertical: "middle" };

  (data.quality.violations || []).forEach((v, i) => {
    violationSheet.addRow({
      index: i + 1,
      type: v.type || "",
      detail: v.detail,
      severity: severityLabel(v.severity),
      timestamp: v.timestamp ? formatTime(v.timestamp) : "",
    });
  });

  violationSheet.autoFilter = { from: "A1", to: "E1" };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

function exportToJSON(data) {
  const output = JSON.stringify(data, null, 2);
  return Buffer.from(output, "utf-8");
}

function formatTime(sec) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function severityLabel(s) {
  return { critical: "严重", major: "一般", minor: "轻微" }[s] || s;
}

module.exports = { exportToExcel, exportToJSON };
