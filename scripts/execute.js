#!/usr/bin/env node
/**
 * 自动递归解压脚本
 * 自动递归解压 source 文件夹中的压缩包，解压后将内容放到 upload 中
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { promisify } = require("util");

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);

// 解压密码
const PASSWORD = "cosergirl.com";

// 支持的压缩文件扩展名
const COMPRESSED_EXTENSIONS = [
  ".7z",
  ".zip",
  ".rar",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
];

// 支持的图片文件扩展名
const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".tiff",
  ".tif",
  ".heic",
  ".heif",
];

// 支持的视频文件扩展名
const VIDEO_EXTENSIONS = [
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".ts",
  ".mts",
];

/**
 * 检查文件是否为压缩文件（包括分卷压缩）
 */
function isCompressedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  // 检查标准压缩格式
  if (COMPRESSED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return true;
  }

  // 检查分卷压缩文件（.001, .002, .003 等）
  // 注意：只处理 .001 文件，7z 在解压 .001 时会自动找到并合并其他分卷
  const splitExtMatch = name.match(/\.(\d{3})$/);
  if (splitExtMatch) {
    const partNum = parseInt(splitExtMatch[1], 10);
    // 只处理 .001 文件（第一个分卷）
    if (partNum === 1) {
      // 检查是否是压缩格式的分卷（.7z.001, .rar.001 等）
      const baseName = name.substring(0, name.length - 4); // 移除 .001
      return COMPRESSED_EXTENSIONS.some((ext) => baseName.endsWith(ext));
    }
    // 对于 .002, .003 等分卷文件，也标记为压缩文件（用于在移动文件时跳过）
    // 这些文件不会被单独处理，只会在解压对应的 .001 时被 7z 自动使用
    else if (partNum > 1) {
      const baseName = name.substring(0, name.length - 4);
      return COMPRESSED_EXTENSIONS.some((ext) => baseName.endsWith(ext));
    }
  }

  return false;
}

/**
 * 查找分卷文件的所有部分并移动到同一目录
 */
async function ensureSplitFilesTogether(filePath, targetDir) {
  const name = path.basename(filePath).toLowerCase();
  const splitExtMatch = name.match(/\.(\d{3})$/);

  if (!splitExtMatch) {
    return; // 不是分卷文件
  }

  const partNum = parseInt(splitExtMatch[1], 10);
  if (partNum !== 1) {
    return; // 只处理 .001 文件
  }

  const baseName = name.substring(0, name.length - 4); // 移除 .001
  const dir = path.dirname(filePath);
  const targetPath = path.join(targetDir, path.basename(filePath));

  // 查找所有分卷文件（.002, .003, ...）
  let partNum2 = 2;
  while (true) {
    const partFileName = `${baseName}.${String(partNum2).padStart(3, "0")}`;
    const partFilePath = path.join(dir, partFileName);

    // 也在 upload 目录中查找（可能已经被移动了）
    const partFilePathInUpload = path.join(
      path.dirname(targetDir),
      "upload",
      partFileName
    );

    let foundPath = null;
    if (fs.existsSync(partFilePath)) {
      foundPath = partFilePath;
    } else if (fs.existsSync(partFilePathInUpload)) {
      foundPath = partFilePathInUpload;
    }

    if (!foundPath) {
      break; // 没有更多分卷文件
    }

    // 将分卷文件移动到目标目录
    const targetPartPath = path.join(targetDir, partFileName);
    if (!fs.existsSync(targetPartPath)) {
      fs.renameSync(foundPath, targetPartPath);
      console.log(`  → 移动分卷文件: ${partFileName}`);
    }

    partNum2++;
  }
}

/**
 * 检查命令是否存在
 */
function which(command) {
  try {
    const result = execSync(`which ${command}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 使用 7z 命令解压文件
 */
function extract7z(filePath, outputDir, password = null) {
  return new Promise((resolve, reject) => {
    // 验证文件是否存在
    if (!fs.existsSync(filePath)) {
      reject(new Error(`文件不存在: ${filePath}`));
      return;
    }

    // 验证文件大小
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        reject(new Error(`文件为空: ${filePath}`));
        return;
      }
    } catch (error) {
      reject(new Error(`无法读取文件: ${filePath} - ${error.message}`));
      return;
    }

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const args = ["x", filePath, `-o${outputDir}`, "-y"];
    if (password) {
      args.push(`-p${password}`);
    }

    const child = spawn("7z", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        // 对于 .rar 文件，7z 可能返回非 0 但实际成功（部分成功）
        // 检查输出中是否有解压成功的迹象
        const output = (stderr || stdout).toLowerCase();
        if (
          output.includes("extracting") ||
          output.includes("everything is ok")
        ) {
          resolve(true);
        } else {
          // 提供更详细的错误信息
          let errorMsg = stderr || stdout;

          // 检查常见的错误类型并给出建议
          if (
            errorMsg.includes("Can not open the file as") ||
            errorMsg.includes("Open ERROR")
          ) {
            const fileName = path.basename(filePath);
            errorMsg =
              `文件可能已损坏或不是有效的压缩文件: ${fileName}\n` +
              `原始错误: ${errorMsg}\n` +
              `建议: 请检查文件是否完整，或是否为分卷压缩文件（需要所有分卷在同一目录）`;
          } else if (
            errorMsg.includes("Wrong password") ||
            errorMsg.includes("password")
          ) {
            errorMsg = `密码错误: ${errorMsg}`;
          } else if (errorMsg.includes("No such file or directory")) {
            errorMsg = `文件不存在或已被删除: ${filePath}`;
          }

          reject(new Error(errorMsg));
        }
      }
    });

    child.on("error", (err) => {
      reject(new Error(`7z 命令执行失败: ${err.message}`));
    });
  });
}

/**
 * 使用 unzip 命令解压 ZIP 文件
 */
function extractZip(filePath, outputDir, password = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const args = ["-o", filePath, "-d", outputDir];
    if (password) {
      args.push(`-P${password}`);
    }

    const child = spawn("unzip", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        // unzip 可能返回非 0 但实际成功，检查输出
        if (stdout.includes("extracting") || stdout.includes("inflating")) {
          resolve(true);
        } else {
          reject(new Error(`unzip 命令失败: ${stderr || stdout}`));
        }
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * 使用 unrar 命令解压 RAR 文件
 */
function extractRar(filePath, outputDir, password = null) {
  return new Promise((resolve, reject) => {
    // 验证文件是否存在
    if (!fs.existsSync(filePath)) {
      reject(new Error(`文件不存在: ${filePath}`));
      return;
    }

    // 验证文件大小
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        reject(new Error(`文件为空: ${filePath}`));
        return;
      }
    } catch (error) {
      reject(new Error(`无法读取文件: ${filePath} - ${error.message}`));
      return;
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // unrar 命令参数
    // x = 解压到完整路径，-y = 自动确认，-p = 密码
    const args = ["x", "-y"];
    if (password) {
      args.push(`-p${password}`);
    }
    args.push(filePath, `${outputDir}/`);

    const child = spawn("unrar", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        // unrar 返回 0 表示成功，1 表示警告但成功
        resolve(true);
      } else {
        // 提供更详细的错误信息
        let errorMsg = stderr || stdout;
        if (errorMsg.includes("CRC failed") || errorMsg.includes("corrupted")) {
          errorMsg = `文件已损坏: ${path.basename(
            filePath
          )}\n原始错误: ${errorMsg}`;
        } else if (
          errorMsg.includes("Wrong password") ||
          errorMsg.includes("password")
        ) {
          errorMsg = `密码错误: ${errorMsg}`;
        }
        reject(new Error(`unrar 命令失败: ${errorMsg}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`unrar 命令执行失败: ${err.message}`));
    });
  });
}

/**
 * 获取文件的基础扩展名（处理分卷压缩）
 */
function getBaseExtension(filePath) {
  const name = path.basename(filePath).toLowerCase();

  // 检查是否是分卷文件（.001, .002 等）
  const splitExtMatch = name.match(/\.(\d{3})$/);
  if (splitExtMatch) {
    // 移除分卷后缀，获取基础扩展名
    const baseName = name.substring(0, name.length - 4);
    const baseExt = path.extname(baseName).toLowerCase();
    return baseExt;
  }

  return path.extname(filePath).toLowerCase();
}

/**
 * 根据文件类型选择解压方法
 */
async function extractFile(filePath, outputDir, password = null) {
  const ext = getBaseExtension(filePath);
  const has7z = which("7z");
  const hasUnzip = which("unzip");
  const hasUnrar = which("unrar");

  try {
    // ZIP 文件：优先使用 unzip，否则使用 7z
    if (ext === ".zip") {
      if (hasUnzip) {
        return await extractZip(filePath, outputDir, password);
      } else if (has7z) {
        return await extract7z(filePath, outputDir, password);
      } else {
        throw new Error("未找到可用的解压工具 (需要 7z 或 unzip)");
      }
    }
    // RAR 文件：优先使用 unrar，否则使用 7z
    else if (ext === ".rar") {
      if (hasUnrar) {
        return await extractRar(filePath, outputDir, password);
      } else if (has7z) {
        return await extract7z(filePath, outputDir, password);
      } else {
        throw new Error(
          `解压 ${ext} 格式需要 unrar 或 7z 工具。请运行: brew install unrar 或 brew install p7zip`
        );
      }
    }
    // 其他格式（.7z 等，包括分卷）：使用 7z
    else {
      if (has7z) {
        return await extract7z(filePath, outputDir, password);
      } else {
        throw new Error(
          `解压 ${ext} 格式需要 7z 工具。请运行: brew install p7zip`
        );
      }
    }
  } catch (error) {
    throw error;
  }
}

/**
 * 检查文件是否为需要处理的分卷文件（只处理 .001）
 */
function shouldProcessSplitFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const splitExtMatch = name.match(/\.(\d{3})$/);

  if (splitExtMatch) {
    const partNum = parseInt(splitExtMatch[1], 10);
    // 只处理 .001 文件（第一个分卷），7z 会自动处理其他分卷
    return partNum === 1;
  }

  return true; // 非分卷文件或标准压缩文件
}

/**
 * 检查文件是否为分卷文件（.002, .003 等，非 .001）
 */
function isSplitFilePart(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const splitExtMatch = name.match(/\.(\d{3})$/);

  if (splitExtMatch) {
    const partNum = parseInt(splitExtMatch[1], 10);
    // 返回是否为 .002, .003 等分卷文件（非 .001）
    return partNum > 1;
  }

  return false;
}

/**
 * 递归查找目录中的所有压缩文件
 */
async function findCompressedFiles(directory) {
  const compressedFiles = [];

  async function scanDir(dir) {
    try {
      const entries = await readdir(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          await scanDir(fullPath);
        } else if (stats.isFile() && isCompressedFile(fullPath)) {
          // 对于分卷文件，只处理 .001 文件
          // .002, .003 等分卷文件会被跳过，它们在解压 .001 时会被 7z 自动使用
          if (shouldProcessSplitFile(fullPath)) {
            compressedFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      // 忽略权限错误等
      console.error(`警告: 无法扫描目录 ${dir}: ${error.message}`);
    }
  }

  await scanDir(directory);
  return compressedFiles;
}

/**
 * 检查文件是否为图片或视频
 */
function isMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

/**
 * 检查文件夹是否包含图片或视频文件（递归检查）
 */
async function containsMediaFiles(dirPath) {
  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // 递归检查子文件夹
        const subDirHasMedia = await containsMediaFiles(fullPath);
        if (subDirHasMedia) {
          return true;
        }
      } else if (stats.isFile()) {
        // 检查文件是否为媒体文件
        if (isMediaFile(fullPath)) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error(`警告: 无法检查目录 ${dirPath}: ${error.message}`);
    return false;
  }
}

/**
 * 查找第一层包含媒体文件的文件夹
 */
async function findFirstLevelMediaFolders(dirPath) {
  const mediaFolders = [];

  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // 检查这个直接子文件夹是否包含媒体文件
        const hasMedia = await containsMediaFiles(fullPath);
        if (hasMedia) {
          mediaFolders.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`警告: 无法扫描目录 ${dirPath}: ${error.message}`);
  }

  return mediaFolders;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(2);
}

/**
 * 递归移动目录内容到目标目录
 */
async function moveContentsToUpload(sourceDir, targetDir) {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const entries = await readdir(sourceDir);

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      const targetPath = path.join(targetDir, entry);

      // 如果目标已存在，添加序号
      let finalTargetPath = targetPath;
      let counter = 1;
      while (fs.existsSync(finalTargetPath)) {
        const ext = path.extname(entry);
        const nameWithoutExt = path.basename(entry, ext);
        finalTargetPath = path.join(
          targetDir,
          `${nameWithoutExt}_${counter}${ext}`
        );
        counter++;
      }

      // 移动文件或文件夹
      fs.renameSync(sourcePath, finalTargetPath);
      console.log(`  → 移动到 upload: ${path.basename(finalTargetPath)}`);
    }
  } catch (error) {
    console.error(`警告: 移动文件失败: ${error.message}`);
  }
}

/**
 * 递归解压所有压缩文件
 */
async function recursiveExtract(sourceDir, uploadDir) {
  const processed = new Set();
  let compressedFiles = await findCompressedFiles(sourceDir);

  if (compressedFiles.length === 0) {
    console.log("未找到压缩文件");
    return;
  }

  let totalFiles = compressedFiles.length;
  let current = 0;
  let successCount = 0;
  let failCount = 0;

  console.log(`\n找到 ${totalFiles} 个压缩文件，开始解压...`);
  console.log("=".repeat(60));

  while (compressedFiles.length > 0) {
    const filePath = compressedFiles.shift();

    // 跳过已处理的文件
    if (processed.has(filePath)) {
      continue;
    }

    current++;
    const stats = fs.statSync(filePath);
    const fileSize = formatFileSize(stats.size);
    const fileName = path.basename(filePath);

    console.log(
      `\n[${current}/${totalFiles}] 正在解压: ${fileName} (${fileSize} MB)`
    );
    console.log(`  路径: ${filePath}`);

    // 计算输出目录：先解压到临时位置（源文件同级目录）
    const dir = path.dirname(filePath);
    const baseExt = getBaseExtension(filePath);
    let fileNameWithoutExt = path.basename(filePath, baseExt);
    if (fileNameWithoutExt.match(/\.\d{3}$/)) {
      fileNameWithoutExt = fileNameWithoutExt.replace(/\.\d{3}$/, "");
    }

    // 临时解压目录（在源文件同级）
    const tempOutputDir = path.join(dir, `${fileNameWithoutExt}_extracted`);

    try {
      // 在解压前验证文件是否存在
      if (!fs.existsSync(filePath)) {
        console.error(`  ✗ 文件不存在: ${fileName}`);
        processed.add(filePath);
        failCount++;
        continue;
      }

      await extractFile(filePath, tempOutputDir, PASSWORD);
      console.log(`  ✓ 解压成功 -> ${tempOutputDir}`);
      processed.add(filePath);
      successCount++;

      // 先检查是否还有压缩文件需要处理（递归解压）
      const newCompressed = await findCompressedFiles(tempOutputDir);
      if (newCompressed.length > 0) {
        console.log(
          `  → 发现 ${newCompressed.length} 个压缩文件，移动到 source 目录继续处理...`
        );
        for (const newFile of newCompressed) {
          if (!processed.has(newFile)) {
            // 将新发现的压缩文件移动到 source 目录，以便后续处理
            const fileName = path.basename(newFile);
            const targetPath = path.join(sourceDir, fileName);

            // 如果目标文件已存在，添加序号
            let finalTargetPath = targetPath;
            let counter = 1;
            while (fs.existsSync(finalTargetPath)) {
              const ext = path.extname(fileName);
              const nameWithoutExt = path.basename(fileName, ext);
              finalTargetPath = path.join(
                sourceDir,
                `${nameWithoutExt}_${counter}${ext}`
              );
              counter++;
            }

            fs.renameSync(newFile, finalTargetPath);

            // 如果是分卷文件，确保所有分卷都在同一目录（包括临时目录中的分卷）
            const name = path.basename(finalTargetPath).toLowerCase();
            const splitExtMatch = name.match(/\.(\d{3})$/);
            if (splitExtMatch && parseInt(splitExtMatch[1], 10) === 1) {
              // 查找临时目录中的所有分卷文件
              const baseName = name.substring(0, name.length - 4);
              let partNum2 = 2;
              while (true) {
                const partFileName = `${baseName}.${String(partNum2).padStart(
                  3,
                  "0"
                )}`;
                const partFilePath = path.join(tempOutputDir, partFileName);

                if (fs.existsSync(partFilePath)) {
                  const targetPartPath = path.join(sourceDir, partFileName);
                  if (!fs.existsSync(targetPartPath)) {
                    fs.renameSync(partFilePath, targetPartPath);
                    console.log(`  → 移动分卷文件: ${partFileName}`);
                  }
                } else {
                  break; // 没有更多分卷文件
                }
                partNum2++;
              }
            }

            compressedFiles.push(finalTargetPath);
            totalFiles++;
            console.log(
              `  → 发现新压缩文件: ${path.basename(finalTargetPath)}`
            );
          }
        }
      }

      // 检查解压后的内容，将包含媒体文件的文件夹移动到 upload 目录
      const entries = await readdir(tempOutputDir);

      // 先查找第一层包含媒体文件的文件夹
      const mediaFolders = await findFirstLevelMediaFolders(tempOutputDir);

      // 将包含媒体文件的文件夹整体移动到 upload
      const processedMediaFolders = new Set();
      for (const mediaFolder of mediaFolders) {
        const folderName = path.basename(mediaFolder);
        let targetDir = path.join(uploadDir, folderName);

        // 检查目标文件夹是否已存在，如果存在则添加序号
        let counter = 1;
        while (fs.existsSync(targetDir)) {
          targetDir = path.join(uploadDir, `${folderName}_${counter}`);
          counter++;
        }

        // 移动文件夹到 upload
        fs.renameSync(mediaFolder, targetDir);
        processedMediaFolders.add(path.basename(mediaFolder));
        console.log(`  → 移动媒体文件夹到 upload: ${path.basename(targetDir)}`);
      }

      // 处理剩余的非压缩文件和文件夹
      const nonCompressedEntries = [];
      for (const entry of entries) {
        const fullPath = path.join(tempOutputDir, entry);
        const stats = await stat(fullPath);

        // 跳过已处理的媒体文件夹
        if (processedMediaFolders.has(entry)) {
          continue;
        }

        // 跳过压缩文件（包括所有分卷文件 .001, .002, .003 等）
        // 注意：.001 文件已经在上面被处理或加入队列，所以这里所有分卷都会被跳过
        if (stats.isFile() && isCompressedFile(fullPath)) {
          continue;
        }

        nonCompressedEntries.push(entry);
      }

      // 如果有剩余的非压缩文件，移动到 upload
      if (nonCompressedEntries.length > 0) {
        for (const entry of nonCompressedEntries) {
          const sourcePath = path.join(tempOutputDir, entry);
          const targetPath = path.join(uploadDir, entry);

          let finalTargetPath = targetPath;
          let counter = 1;
          while (fs.existsSync(finalTargetPath)) {
            const stats = await stat(sourcePath);
            if (stats.isFile()) {
              const ext = path.extname(entry);
              const nameWithoutExt = path.basename(entry, ext);
              finalTargetPath = path.join(
                uploadDir,
                `${nameWithoutExt}_${counter}${ext}`
              );
            } else {
              finalTargetPath = path.join(uploadDir, `${entry}_${counter}`);
            }
            counter++;
          }

          fs.renameSync(sourcePath, finalTargetPath);
          console.log(`  → 移动到 upload: ${path.basename(finalTargetPath)}`);
        }
      }

      // 清理临时解压目录
      try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
      } catch (error) {
        console.error(`警告: 清理临时目录失败: ${error.message}`);
      }
    } catch (error) {
      console.error(`  ✗ 解压失败: ${fileName}`);
      console.error(`    错误: ${error.message}`);
      processed.add(filePath); // 标记为已处理，避免重复尝试
      failCount++;
    }

    const progress =
      totalFiles > 0 ? Math.floor((current * 100) / totalFiles) : 0;
    console.log(
      `  进度: ${current}/${totalFiles} (${progress}%) | 成功: ${successCount} | 失败: ${failCount}`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("解压完成！");
  console.log(`  总计: ${current} 个文件`);
  console.log(`  成功: ${successCount} 个`);
  console.log(`  失败: ${failCount} 个`);
}

/**
 * 清理 source 目录中的所有内容
 */
async function cleanSourceDirectory(sourceDir) {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("开始清理 source 目录...");

    const entries = await readdir(sourceDir);

    if (entries.length === 0) {
      console.log("source 目录已经是空的，无需清理");
      return;
    }

    let deletedCount = 0;
    for (const entry of entries) {
      const fullPath = path.join(sourceDir, entry);
      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`  ✓ 删除目录: ${entry}`);
        } else {
          fs.unlinkSync(fullPath);
          console.log(`  ✓ 删除文件: ${entry}`);
        }
        deletedCount++;
      } catch (error) {
        console.error(`  ✗ 删除失败: ${entry} - ${error.message}`);
      }
    }

    console.log(`\n清理完成！共删除 ${deletedCount} 个项目`);
  } catch (error) {
    console.error(`警告: 清理 source 目录失败: ${error.message}`);
  }
}

/**
 * 主函数
 */
async function main() {
  // 检查是否有可用的解压工具
  const has7z = which("7z");
  const hasUnzip = which("unzip");

  if (!has7z && !hasUnzip) {
    console.log("=".repeat(60));
    console.log("错误: 未找到解压工具");
    console.log("请选择以下方式之一安装:");
    console.log("  1. 安装 7z 工具: brew install p7zip  (推荐)");
    console.log("  2. 安装 unzip: brew install unzip");
    console.log("=".repeat(60));
    process.exit(1);
  }

  if (has7z) {
    console.log("使用系统 7z 工具进行解压");
  } else {
    console.log("使用系统 unzip 工具进行解压");
  }

  // 获取脚本所在目录的父目录（项目根目录）
  const scriptDir = __dirname;
  const projectRoot = path.dirname(scriptDir);

  // source 目录
  const sourceDir = path.join(projectRoot, "source");

  if (!fs.existsSync(sourceDir)) {
    console.error(`错误: 源目录不存在: ${sourceDir}`);
    process.exit(1);
  }

  // upload 目录（使用当前日期命名：YYYYMMDD）
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}${month}${day}`;
  const uploadDir = path.join(projectRoot, dateStr);

  // 确保 upload 目录存在
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`创建输出目录: ${uploadDir}`);
  }

  console.log(`源目录: ${sourceDir}`);
  console.log(`输出目录: ${uploadDir} (${dateStr})`);
  console.log(`解压密码: ${PASSWORD}`);

  // 开始递归解压
  try {
    await recursiveExtract(sourceDir, uploadDir);

    // 解压完成后，清理 source 目录中的所有内容
    await cleanSourceDirectory(sourceDir);
  } catch (error) {
    console.error("发生错误:", error.message);
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main().catch((error) => {
    console.error("未捕获的错误:", error);
    process.exit(1);
  });
}

module.exports = { recursiveExtract, extractFile, findCompressedFiles };
