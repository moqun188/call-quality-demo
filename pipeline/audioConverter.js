/**
 * 音频格式转换工具
 * 将任意音频（wav/m4a/ogg/flac/amr）转换为 MP3
 * 使用 ffmpeg 二进制（通过 @ffmpeg-installer/ffmpeg 自动下载）
 */

const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { logger } = require("./logger");

ffmpeg.setFfmpegPath(ffmpegPath);

logger.info(`[音频转换] ffmpeg 路径: ${ffmpegPath}`);

/**
 * 准备音频文件：如果是 wav 直接返回，如果是 m4a/mp3 等格式则转为 MP3
 * 返回 { filePath, mimeType }
 * @param {string} audioPath - 原始音频文件路径
 * @param {object} options - 转换选项
 */
async function prepareAudioForASR(audioPath, options = {}) {
  const { kbps = 64, sampleRate = 16000, channels = 1 } = options;
  const ext = path.extname(audioPath).toLowerCase();

  if (ext === ".wav") {
    return { filePath: audioPath, mimeType: "audio/wav", converted: false, sampleRate, channels };
  }

  if (ext === ".mp3") {
    return { filePath: audioPath, mimeType: "audio/mpeg", converted: false, sampleRate, channels };
  }

  // 其他格式: 转 MP3
  const mp3Path = audioPath.replace(/\.[^/\\]+$/, ".converted.mp3");
  await convertToMp3(audioPath, mp3Path, { kbps, sampleRate, channels });
  return { filePath: mp3Path, mimeType: "audio/mpeg", converted: true, sampleRate, channels };
}

/**
 * 检查文件是否为 WAV（纯 PCM 的快速方式）
 */
function isPcmWav(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
  } catch (e) {
    return false;
  }
}

/**
 * 转换任意音频为 MP3
 * @param {string} inputPath - 输入文件路径
 * @param {string} outputPath - 输出 mp3 文件路径
 * @param {object} options - 选项 { kbps, sampleRate, channels }
 */
function convertToMp3(inputPath, outputPath, options = {}) {
  const { kbps = 64, sampleRate = 16000, channels = 1 } = options;
  const ext = path.extname(inputPath).toLowerCase();

  logger.info(`[音频转换] 开始: ${inputPath} (${ext}) -> ${outputPath}`);
  logger.info(`[音频转换] 目标: MP3, ${kbps}kbps, ${sampleRate}Hz, ${channels}ch`);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .audioCodec("libmp3lame")
      .audioBitrate(kbps)
      .audioFrequency(sampleRate)
      .audioChannels(channels)
      .format("mp3")
      .on("start", (commandLine) => {
        logger.debug(`[音频转换] ffmpeg 命令: ${commandLine}`);
      })
      .on("progress", (progress) => {
        if (progress && progress.timemark) {
          logger.debug(`[音频转换] 进度: ${progress.timemark}`);
        }
      })
      .on("error", (err, stdout, stderr) => {
        logger.error(`[音频转换] ffmpeg 失败: ${err.message}`);
        if (stderr) logger.debug(`[音频转换] stderr: ${stderr}`);
        reject(err);
      })
      .on("end", () => {
        const stat = fs.statSync(outputPath);
        logger.info(`[音频转换] 完成: ${outputPath}, ${(stat.size / 1024).toFixed(1)} KB`);
        resolve({
          outputPath,
          size: stat.size,
          duration: 0,
          sampleRate,
          channels,
        });
      });

    cmd.save(outputPath);
  });
}

module.exports = {
  convertToMp3,
  isPcmWav,
  prepareAudioForASR,
};
