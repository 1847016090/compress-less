#!/usr/bin/env node
/**
 * SVG 转 PNG 脚本
 * 将 circle 和 square 文件夹中的所有 SVG 文件转换为 PNG 文件
 */

const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const lstat = promisify(fs.lstat);
const mkdir = promisify(fs.mkdir);

// 检查是否安装了 sharp
let sharp;
try {
  sharp = require("sharp");
} catch (error) {
  console.error("错误: 未找到 sharp 库");
  console.error("请先安装依赖: npm install sharp");
  console.error("或者使用: yarn add sharp");
  process.exit(1);
}

// 脚本所在目录
const SCRIPT_DIR = __dirname;
const CIRCLE_DIR = path.join(SCRIPT_DIR, "circle");
const SQUARE_DIR = path.join(SCRIPT_DIR, "square");

// PNG 输出尺寸配置（可选，默认使用 SVG 原始尺寸）
const PNG_SIZE = 512; // 可以根据需要调整

/**
 * 检查文件是否存在（处理符号链接）
 */
async function fileExists(filePath) {
  try {
    const lstatInfo = await lstat(filePath);
    if (lstatInfo.isSymbolicLink()) {
      // 如果是符号链接，检查目标文件是否存在
      const realPath = await fs.promises.realpath(filePath);
      const statInfo = await stat(realPath);
      return statInfo.isFile();
    }
    return lstatInfo.isFile();
  } catch (error) {
    return false;
  }
}

/**
 * 递归获取目录下所有 SVG 文件
 */
async function getAllSvgFiles(dir, baseDir = dir) {
  const files = [];
  const entries = await readdir(dir);

  for (const entry of entries) {
    // 跳过隐藏文件和系统文件
    if (entry.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dir, entry);

    try {
      const lstatInfo = await lstat(fullPath);

      if (lstatInfo.isDirectory()) {
        // 递归处理子目录
        const subFiles = await getAllSvgFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.toLowerCase().endsWith(".svg")) {
        // 检查文件是否真实存在（处理符号链接）
        const exists = await fileExists(fullPath);
        if (exists) {
          // 计算相对路径，用于保持目录结构
          const relativePath = path.relative(baseDir, fullPath);
          files.push({
            fullPath,
            relativePath,
            dir: path.dirname(fullPath),
            name: path.basename(entry, ".svg"),
          });
        } else {
          // 符号链接指向的文件不存在，跳过
          console.warn(
            `警告: 跳过无效的符号链接或文件: ${path.relative(
              baseDir,
              fullPath
            )}`
          );
        }
      }
    } catch (error) {
      // 如果无法访问文件，跳过
      console.warn(
        `警告: 无法访问文件 ${path.relative(baseDir, fullPath)}: ${
          error.message
        }`
      );
      continue;
    }
  }

  return files;
}

/**
 * 将 SVG 文件转换为 PNG
 */
async function convertSvgToPng(svgFile) {
  const pngPath = path.join(svgFile.dir, `${svgFile.name}.png`);

  try {
    // 再次检查文件是否存在（防止在扫描和转换之间文件被删除）
    const exists = await fileExists(svgFile.fullPath);
    if (!exists) {
      return {
        success: false,
        path: pngPath,
        error: "文件不存在或符号链接无效",
      };
    }

    // 读取 SVG 文件（使用 realpath 解析符号链接）
    const realPath = await fs.promises.realpath(svgFile.fullPath);
    const svgBuffer = await fs.promises.readFile(realPath);

    // 使用 sharp 转换为 PNG
    await sharp(svgBuffer)
      .resize(PNG_SIZE, PNG_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // 透明背景
      })
      .png()
      .toFile(pngPath);

    return { success: true, path: pngPath };
  } catch (error) {
    return { success: false, path: pngPath, error: error.message };
  }
}

/**
 * 主函数
 */
async function main() {
  console.log("开始转换 SVG 文件为 PNG...\n");

  const allSvgFiles = [];

  // 处理 circle 文件夹
  if (fs.existsSync(CIRCLE_DIR)) {
    console.log(`正在扫描: ${path.relative(SCRIPT_DIR, CIRCLE_DIR)}`);
    const circleFiles = await getAllSvgFiles(CIRCLE_DIR, CIRCLE_DIR);
    allSvgFiles.push(...circleFiles);
    console.log(`  找到 ${circleFiles.length} 个 SVG 文件\n`);
  } else {
    console.warn(`警告: 未找到 circle 文件夹: ${CIRCLE_DIR}\n`);
  }

  // 处理 square 文件夹
  if (fs.existsSync(SQUARE_DIR)) {
    console.log(`正在扫描: ${path.relative(SCRIPT_DIR, SQUARE_DIR)}`);
    const squareFiles = await getAllSvgFiles(SQUARE_DIR, SQUARE_DIR);
    allSvgFiles.push(...squareFiles);
    console.log(`  找到 ${squareFiles.length} 个 SVG 文件\n`);
  } else {
    console.warn(`警告: 未找到 square 文件夹: ${SQUARE_DIR}\n`);
  }

  if (allSvgFiles.length === 0) {
    console.log("未找到任何 SVG 文件，退出。");
    return;
  }

  console.log(`总共找到 ${allSvgFiles.length} 个 SVG 文件`);
  console.log("开始转换...\n");

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  // 批量转换（可以控制并发数）
  const batchSize = 10; // 每次处理 10 个文件
  for (let i = 0; i < allSvgFiles.length; i += batchSize) {
    const batch = allSvgFiles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (file) => {
        const result = await convertSvgToPng(file);
        const relativePath = path.relative(SCRIPT_DIR, file.fullPath);
        if (result.success) {
          console.log(
            `✓ ${relativePath} -> ${path.relative(SCRIPT_DIR, result.path)}`
          );
          successCount++;
        } else {
          console.error(`✗ ${relativePath} - 错误: ${result.error}`);
          failCount++;
          errors.push({ file: relativePath, error: result.error });
        }
        return result;
      })
    );
  }

  // 输出统计信息
  console.log("\n" + "=".repeat(50));
  console.log("转换完成！");
  console.log(`成功: ${successCount} 个`);
  console.log(`失败: ${failCount} 个`);

  if (errors.length > 0) {
    console.log("\n失败的文件:");
    errors.forEach(({ file, error }) => {
      console.log(`  - ${file}: ${error}`);
    });
  }
}

// 运行主函数
main().catch((error) => {
  console.error("发生错误:", error);
  process.exit(1);
});
