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
/**
 * 检查磁盘空间是否足够
 */
function checkDiskSpace(filePath, outputDir) {
  try {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // 估算需要的空间（解压后可能是压缩前的 2-3 倍，但这里保守估计为 1.5 倍）
    const estimatedNeeded = fileSize * 1.5;

    // 获取输出目录所在磁盘的可用空间
    const outputParent = path.dirname(outputDir);
    const dfOutput = execSync(`df -k "${outputParent}"`, { encoding: "utf8" });
    const lines = dfOutput.trim().split("\n");
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      const availableKB = parseInt(parts[3], 10);
      const availableBytes = availableKB * 1024;

      if (availableBytes < estimatedNeeded) {
        const neededGB = (estimatedNeeded / (1024 * 1024 * 1024)).toFixed(2);
        const availableGB = (availableBytes / (1024 * 1024 * 1024)).toFixed(2);
        return {
          enough: false,
          needed: neededGB,
          available: availableGB,
        };
      }
    }
    return { enough: true };
  } catch (error) {
    // 如果检查失败，继续执行（可能是权限问题）
    return { enough: true, error: error.message };
  }
}

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

    // 检查磁盘空间
    const spaceCheck = checkDiskSpace(filePath, outputDir);
    if (!spaceCheck.enough) {
      reject(
        new Error(
          `磁盘空间不足！\n` +
            `需要空间: ${spaceCheck.needed} GB\n` +
            `可用空间: ${spaceCheck.available} GB\n` +
            `请清理磁盘空间后重试`
        )
      );
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
          const fileName = path.basename(filePath);
          const isRarFile = fileName.toLowerCase().endsWith(".rar");

          // 检查常见的错误类型并给出建议
          if (
            errorMsg.includes("No space left on device") ||
            errorMsg.includes("No space")
          ) {
            const spaceCheck = checkDiskSpace(filePath, outputDir);
            if (!spaceCheck.enough) {
              errorMsg =
                `磁盘空间不足！\n` +
                `需要空间: ${spaceCheck.needed} GB\n` +
                `可用空间: ${spaceCheck.available} GB\n` +
                `请清理磁盘空间后重试`;
            } else {
              errorMsg = `磁盘空间不足: ${errorMsg}\n` + `请清理磁盘空间后重试`;
            }
          } else if (
            errorMsg.includes("E_FAIL") ||
            errorMsg.includes("ERROR:")
          ) {
            if (isRarFile) {
              errorMsg =
                `7z 无法解压此 RAR 文件: ${fileName}\n` +
                `错误: ${errorMsg}\n` +
                `建议: 对于大型或特殊格式的 RAR 文件，建议使用 unar 工具 (brew install unar)\n` +
                `或者: 请检查文件是否完整，是否所有分卷文件都在同一目录`;
            } else {
              // 检查是否是磁盘空间问题
              const stats = fs.statSync(filePath);
              const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
              errorMsg =
                `解压失败: ${fileName} (${fileSizeGB} GB)\n` +
                `错误: ${errorMsg}\n` +
                `可能原因:\n` +
                `  1. 磁盘空间不足（大文件需要足够的可用空间）\n` +
                `  2. 文件损坏或不完整\n` +
                `  3. 分卷压缩文件缺少其他分卷\n` +
                `建议: 检查磁盘空间，确保有足够的可用空间（至少 ${fileSizeGB} GB）`;
            }
          } else if (
            errorMsg.includes("Can not open the file as") ||
            errorMsg.includes("Open ERROR")
          ) {
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
          } else if (errorMsg.trim() === "" || errorMsg.includes("ERROR:")) {
            // 对于空错误或只有 ERROR 的情况，提供更详细的说明
            if (isRarFile) {
              errorMsg =
                `RAR 文件解压失败: ${fileName}\n` +
                `可能原因:\n` +
                `  1. 7z 对该 RAR 文件格式支持不完整\n` +
                `  2. 文件较大，建议使用 unrar 工具 (brew install unrar)\n` +
                `  3. 文件可能损坏或不完整\n` +
                `  4. 可能需要所有分卷文件在同一目录`;
            } else {
              errorMsg = `解压失败: ${fileName} - 未知错误`;
            }
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
 * 使用 unar 命令解压 RAR 文件（macOS 推荐工具）
 */
function extractUnar(filePath, outputDir, password = null) {
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

    // unar 命令参数
    // -o 指定输出目录，-password 密码
    const args = ["-o", outputDir];
    if (password) {
      args.push("-password", password);
    }
    args.push(filePath);

    const child = spawn("unar", args, {
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
        // 提供更详细的错误信息
        let errorMsg = stderr || stdout;
        if (
          errorMsg.includes("Wrong password") ||
          errorMsg.includes("password")
        ) {
          errorMsg = `密码错误: ${errorMsg}`;
        } else if (
          errorMsg.includes("corrupted") ||
          errorMsg.includes("damaged")
        ) {
          errorMsg = `文件已损坏: ${path.basename(
            filePath
          )}\n原始错误: ${errorMsg}`;
        }
        reject(new Error(`unar 命令失败: ${errorMsg}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`unar 命令执行失败: ${err.message}`));
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
  const hasUnar = which("unar");
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
    // RAR 文件：优先使用 unar（macOS 推荐），其次 unrar，最后 7z
    else if (ext === ".rar") {
      if (hasUnar) {
        return await extractUnar(filePath, outputDir, password);
      } else if (hasUnrar) {
        return await extractRar(filePath, outputDir, password);
      } else if (has7z) {
        return await extract7z(filePath, outputDir, password);
      } else {
        throw new Error(
          `解压 ${ext} 格式需要 unar、unrar 或 7z 工具。请运行: brew install unar 或 brew install unrar 或 brew install p7zip`
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
 * 递归处理单个压缩包及其所有嵌套的压缩包
 * 处理完整个压缩包及其所有内容后，删除所有相关文件
 */
async function processSingleArchive(
  filePath,
  sourceDir,
  uploadDir,
  processed,
  movedFolders = new Set()
) {
  const fileName = path.basename(filePath);
  const stats = fs.statSync(filePath);
  const fileSize = formatFileSize(stats.size);

  console.log(`\n正在处理: ${fileName} (${fileSize} MB)`);
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
      throw new Error(`文件不存在: ${fileName}`);
    }

    // 解压文件
    await extractFile(filePath, tempOutputDir, PASSWORD);

    // 验证解压结果：检查解压目录是否存在且包含内容
    if (!fs.existsSync(tempOutputDir)) {
      throw new Error(`解压失败：解压目录不存在 ${tempOutputDir}`);
    }

    const extractedEntries = await readdir(tempOutputDir);
    if (extractedEntries.length === 0) {
      throw new Error(`解压失败：解压目录为空 ${tempOutputDir}`);
    }

    console.log(`  ✓ 解压成功 -> ${tempOutputDir}`);

    // 检查是否还有压缩文件需要处理（递归解压）
    const newCompressed = await findCompressedFiles(tempOutputDir);

    // 记录递归处理前已存在的文件夹，避免重复处理
    const existingFoldersBeforeNested = new Set();
    if (fs.existsSync(tempOutputDir)) {
      const entriesBefore = await readdir(tempOutputDir);
      for (const entry of entriesBefore) {
        const fullPath = path.join(tempOutputDir, entry);
        try {
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            existingFoldersBeforeNested.add(entry);
          }
        } catch (error) {
          // 忽略错误
        }
      }
    }

    // 递归处理所有嵌套的压缩文件
    for (const newFile of newCompressed) {
      if (!processed.has(newFile)) {
        processed.add(newFile);
        // 递归处理嵌套的压缩文件，传递已移动的文件夹集合
        const nestedSuccess = await processSingleArchive(
          newFile,
          sourceDir,
          uploadDir,
          processed,
          movedFolders
        );
        // 如果嵌套压缩文件处理失败，抛出错误以保留源文件
        if (!nestedSuccess) {
          throw new Error(`嵌套压缩文件处理失败: ${path.basename(newFile)}`);
        }
      }
    }

    // 递归处理完成后，重新读取 entries（因为嵌套压缩包可能已经移动了一些文件夹）
    // 检查解压后的内容，将包含媒体文件的文件夹移动到 upload 目录
    let entries = [];
    if (fs.existsSync(tempOutputDir)) {
      entries = await readdir(tempOutputDir);
    }

    // 先查找第一层包含媒体文件的文件夹
    // 但要排除已经被嵌套压缩包处理过的文件夹（它们应该已经被移动到upload了）
    const mediaFolders = await findFirstLevelMediaFolders(tempOutputDir);

    // 将包含媒体文件的文件夹整体移动到 upload
    const processedMediaFolders = new Set();
    for (const mediaFolder of mediaFolders) {
      // 检查文件夹是否还存在（递归处理时可能已经移动了）
      if (!fs.existsSync(mediaFolder)) {
        continue; // 跳过已经被移动的文件夹
      }

      const folderName = path.basename(mediaFolder);
      let targetDir = path.join(uploadDir, folderName);

      // 检查目标文件夹是否已存在，如果存在则添加序号
      let counter = 1;
      while (fs.existsSync(targetDir)) {
        targetDir = path.join(uploadDir, `${folderName}_${counter}`);
        counter++;
      }

      // 移动文件夹到 upload
      try {
        // 再次检查文件夹是否存在（可能在检查过程中被其他操作移动了）
        if (!fs.existsSync(mediaFolder)) {
          continue; // 跳过已经被移动的文件夹
        }

        const targetBaseName = path.basename(targetDir);
        // 检查这个文件夹名称是否已经被记录为已移动
        if (movedFolders.has(targetBaseName)) {
          console.log(`  → 跳过已移动的文件夹: ${folderName}`);
          continue;
        }

        fs.renameSync(mediaFolder, targetDir);
        processedMediaFolders.add(path.basename(mediaFolder));
        movedFolders.add(targetBaseName); // 记录已移动的文件夹
        console.log(`  → 移动媒体文件夹到 upload: ${path.basename(targetDir)}`);
      } catch (error) {
        // 如果移动失败，可能是文件夹已经被移动了
        if (error.code === "ENOENT") {
          // 文件夹不存在，说明已经被移动了
          continue;
        } else {
          console.error(
            `警告: 移动文件夹失败: ${folderName} - ${error.message}`
          );
        }
      }
    }

    // 处理剩余的非压缩文件和文件夹
    const nonCompressedEntries = [];
    for (const entry of entries) {
      const fullPath = path.join(tempOutputDir, entry);

      // 检查文件/文件夹是否还存在（可能已经被嵌套压缩包移动了）
      if (!fs.existsSync(fullPath)) {
        continue; // 跳过已经被移动的文件
      }

      const stats = await stat(fullPath);

      // 跳过已处理的媒体文件夹
      if (processedMediaFolders.has(entry)) {
        continue;
      }

      // 跳过压缩文件（它们已经被递归处理了）
      if (stats.isFile() && isCompressedFile(fullPath)) {
        continue;
      }

      // 跳过临时解压目录（_extracted 结尾的目录，这些是嵌套压缩包的临时目录）
      if (stats.isDirectory() && entry.endsWith("_extracted")) {
        continue;
      }

      nonCompressedEntries.push(entry);
    }

    // 如果有剩余的非压缩文件，移动到 upload
    if (nonCompressedEntries.length > 0) {
      for (const entry of nonCompressedEntries) {
        const sourcePath = path.join(tempOutputDir, entry);

        // 再次检查文件是否存在（可能在之前的操作中已经被移动）
        if (!fs.existsSync(sourcePath)) {
          continue;
        }

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

        try {
          if (fs.existsSync(sourcePath)) {
            fs.renameSync(sourcePath, finalTargetPath);
            console.log(`  → 移动到 upload: ${path.basename(finalTargetPath)}`);
          }
        } catch (error) {
          // 如果移动失败，可能是文件已经被移动了
          if (error.code !== "ENOENT") {
            console.error(`警告: 移动文件失败: ${entry} - ${error.message}`);
          }
        }
      }
    }

    // 清理临时解压目录（删除所有解压出来的内容）
    try {
      if (fs.existsSync(tempOutputDir)) {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
        console.log(`  ✓ 已清理临时目录: ${path.basename(tempOutputDir)}`);
      }
    } catch (error) {
      console.error(`警告: 清理临时目录失败: ${error.message}`);
    }

    // 删除源文件（压缩包）
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`  ✓ 已删除源文件: ${fileName}`);
      }
    } catch (error) {
      console.error(`警告: 删除源文件失败: ${fileName} - ${error.message}`);
    }

    return true; // 成功
  } catch (error) {
    console.error(`  ✗ 处理失败: ${fileName}`);
    console.error(`    错误: ${error.message}`);
    console.log(`  → 源文件已保留，可稍后重试`);

    // 解压失败时清理可能存在的临时目录，但保留源文件
    try {
      if (fs.existsSync(tempOutputDir)) {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
        console.log(`  → 已清理临时目录: ${path.basename(tempOutputDir)}`);
      }
    } catch (cleanupError) {
      console.error(`警告: 清理临时目录失败: ${cleanupError.message}`);
    }

    return false; // 失败
  }
}

/**
 * 递归解压所有压缩文件
 * 按顺序处理每个原始压缩包，完全处理完一个后再处理下一个
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

  // 按顺序处理每个原始压缩包
  for (const filePath of compressedFiles) {
    // 跳过已处理的文件
    if (processed.has(filePath)) {
      continue;
    }

    current++;
    processed.add(filePath);

    // 完全处理这个压缩包（包括所有嵌套的压缩包）
    // 使用一个共享的 movedFolders 集合来跟踪已移动的文件夹，避免重复
    const movedFolders = new Set();
    const success = await processSingleArchive(
      filePath,
      sourceDir,
      uploadDir,
      processed,
      movedFolders
    );

    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    const progress =
      totalFiles > 0 ? Math.floor((current * 100) / totalFiles) : 0;
    console.log(
      `\n进度: ${current}/${totalFiles} (${progress}%) | 成功: ${successCount} | 失败: ${failCount}`
    );
    console.log("=".repeat(60));
  }

  console.log("\n" + "=".repeat(60));
  console.log("解压完成！");
  console.log(`  总计: ${current} 个文件`);
  console.log(`  成功: ${successCount} 个`);
  console.log(`  失败: ${failCount} 个`);
}

/**
 * 清理 source 目录中的临时解压目录（_extracted 目录）
 * 只清理临时目录，不删除源文件（失败的文件需要保留以便重试）
 */
async function cleanTempDirectories(sourceDir) {
  try {
    const entries = await readdir(sourceDir);
    const tempDirs = entries.filter((entry) => entry.endsWith("_extracted"));

    if (tempDirs.length === 0) {
      return; // 没有临时目录需要清理
    }

    console.log("\n" + "=".repeat(60));
    console.log("清理临时解压目录...");

    let deletedCount = 0;
    for (const entry of tempDirs) {
      const fullPath = path.join(sourceDir, entry);
      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`  ✓ 删除临时目录: ${entry}`);
          deletedCount++;
        }
      } catch (error) {
        console.error(`  ✗ 删除临时目录失败: ${entry} - ${error.message}`);
      }
    }

    if (deletedCount > 0) {
      console.log(`清理完成！共删除 ${deletedCount} 个临时目录`);
    }
  } catch (error) {
    console.error(`警告: 清理临时目录失败: ${error.message}`);
  }
}

/**
 * 主函数
 */
async function main() {
  // 检查是否有可用的解压工具
  const has7z = which("7z");
  const hasUnzip = which("unzip");
  const hasUnar = which("unar");
  const hasUnrar = which("unrar");

  if (!has7z && !hasUnzip) {
    console.log("=".repeat(60));
    console.log("错误: 未找到解压工具");
    console.log("请选择以下方式之一安装:");
    console.log("  1. 安装 7z 工具: brew install p7zip  (推荐)");
    console.log("  2. 安装 unzip: brew install unzip");
    console.log("=".repeat(60));
    process.exit(1);
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

  // 检查是否有 RAR 文件
  const rarFiles = await findCompressedFiles(sourceDir);
  const hasRarFiles = rarFiles.some((file) =>
    file.toLowerCase().endsWith(".rar")
  );

  if (hasRarFiles && !hasUnar && !hasUnrar) {
    console.log("=".repeat(60));
    console.log("提示: 检测到 RAR 文件，但未安装 unar 或 unrar 工具");
    console.log("建议: 对于大型或特殊格式的 RAR 文件，建议安装 unar（推荐）");
    console.log("安装命令: brew install unar");
    console.log("当前将使用 7z 工具解压 RAR 文件（可能不完全支持）");
    console.log("=".repeat(60));
  }

  if (has7z) {
    console.log("使用系统 7z 工具进行解压");
  } else {
    console.log("使用系统 unzip 工具进行解压");
  }

  if (hasUnar) {
    console.log("使用系统 unar 工具进行解压（RAR 文件，推荐）");
  } else if (hasUnrar) {
    console.log("使用系统 unrar 工具进行解压（RAR 文件）");
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

    // 解压完成后，只清理 source 目录中的临时解压目录（_extracted 目录）
    // 解压成功的文件已经删除，解压失败的文件保留以便重试
    await cleanTempDirectories(sourceDir);
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
