const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { uploadImage, publishItem } = require("./utils");
const { FOLDER_NAME_BLACKLIST } = require("./config");

// 模版文本
const TEMPLATE = `【高清美图素材】未修底片直出｜风格多样｜修图练习/影楼工作室都能用！

✅拍下发度盘链接，直接发全部底片，不用选片，修图练习很方便！文件齐全，支持多设备下载，直接看不用解压～

✅素材均来自网络公开渠道，仅供学习交流，版权归原作者，如有侵权请联系删除

包邮发货，价格可聊，喜欢直接拍，细节私聊～一旦发货～概不退换～

`;

// 从文件夹名中提取 NO 或 No 后面的部分，如果没有则提取 [] 外面的文字
// 并过滤掉黑名单中的内容
function extractNoContent(folderName) {
  let extracted = "";
  
  // 先尝试匹配 "NO" 或 "No"（不区分大小写）后面的内容
  const noMatch = folderName.match(/NO\.?\s*(.+)/i);
  if (noMatch) {
    extracted = noMatch[1].trim();
  } else {
    // 如果没有找到 NO/No，提取最后一个 [] 之前的内容（去掉最后的 [...]）
    // 例如：[IESS异思趣向] 2016.10.20 丝足便当019：《粉色记忆》小胖妞 [64P-49M]
    // 提取为：[IESS异思趣向] 2016.10.20 丝足便当019：《粉色记忆》小胖妞
    const lastBracketIndex = folderName.lastIndexOf('[');
    if (lastBracketIndex > 0) {
      extracted = folderName.substring(0, lastBracketIndex).trim();
    } else {
      // 如果连 [] 都没有，返回原文件夹名
      extracted = folderName.trim();
    }
  }
  
  // 过滤掉黑名单中的内容
  let result = extracted;
  for (const blacklistItem of FOLDER_NAME_BLACKLIST) {
    // 如果提取的内容包含黑名单项，将其移除
    result = result.replace(new RegExp(blacklistItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
  }
  
  // 清理多余的空格和标点
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

// 递归查找文件夹中的所有图片
function findAllImages(dirPath) {
  const images = [];
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  
  // 先查找当前目录下的图片文件
  for (const file of files) {
    if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
        images.push(path.join(dirPath, file.name));
      }
    }
  }
  
  // 如果当前目录没有图片，递归查找子目录
  if (images.length === 0) {
    for (const file of files) {
      if (file.isDirectory()) {
        const subDirPath = path.join(dirPath, file.name);
        const subImages = findAllImages(subDirPath);
        images.push(...subImages);
      }
    }
  }
  
  return images;
}

// 从数组中随机选择多个元素
function getRandomItems(array, count) {
  if (array.length === 0) return [];
  if (array.length <= count) return array;
  
  // 创建数组副本并打乱顺序
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// 将多张图片合成为一张图片（网格布局，不留白，最后一行铺满对齐）
async function compositeImages(imagePaths, outputPath) {
  if (imagePaths.length === 0) {
    throw new Error("至少需要一张图片");
  }

  // 计算网格布局，确保最后一行铺满对齐
  // 先尝试找到一个合适的列数，使得最后一行能够铺满
  let cols = Math.ceil(Math.sqrt(imagePaths.length));
  let rows = Math.ceil(imagePaths.length / cols);
  let lastRowCount = imagePaths.length % cols;
  
  // 如果最后一行不满，调整列数或图片数量，确保最后一行铺满
  if (lastRowCount !== 0) {
    // 尝试调整列数，找到能让最后一行铺满的方案
    // 方法1: 减少列数，让最后一行更接近满行
    let bestCols = cols;
    let bestRows = rows;
    let bestLastRowCount = lastRowCount;
    let bestDiff = lastRowCount;
    
    // 尝试不同的列数，找到最后一行最接近满行的方案
    for (let testCols = cols - 1; testCols >= Math.floor(Math.sqrt(imagePaths.length) * 0.8); testCols--) {
      const testRows = Math.ceil(imagePaths.length / testCols);
      const testLastRowCount = imagePaths.length % testCols;
      const diff = testLastRowCount === 0 ? 0 : testCols - testLastRowCount;
      
      if (diff < bestDiff) {
        bestCols = testCols;
        bestRows = testRows;
        bestLastRowCount = testLastRowCount;
        bestDiff = diff;
      }
      
      if (testLastRowCount === 0) {
        break; // 找到完美方案
      }
    }
    
    cols = bestCols;
    rows = bestRows;
    lastRowCount = bestLastRowCount;
    
    // 如果最后一行还是不满，需要调整图片数量（复制最后一张图片来填满）
    if (lastRowCount !== 0) {
      const needToFill = cols - lastRowCount;
      console.log(`  调整: 最后一行需要填充 ${needToFill} 张图片以铺满`);
      
      // 复制最后几张图片来填满最后一行
      const lastImages = imagePaths.slice(-lastRowCount);
      for (let i = 0; i < needToFill; i++) {
        imagePaths.push(lastImages[i % lastImages.length]);
      }
      
      // 重新计算
      rows = Math.ceil(imagePaths.length / cols);
      lastRowCount = imagePaths.length % cols;
      
      if (lastRowCount !== 0) {
        console.warn(`  警告: 填充后仍有 ${lastRowCount} 张图片未对齐`);
      }
    }
  }
  
  const actualCols = cols;
  const actualRows = rows;

  // 读取所有图片并调整大小
  const images = [];
  // 根据图片数量动态调整每张图片的尺寸，确保总文件大小不超过限制
  // 650张图片时，如果每张500x500，总尺寸约13000x12500，文件太大
  // 调整为每张300x300，总尺寸约7800x7500，文件大小更合理
  const targetWidth = 300; // 每张小图的宽度（调整为300以减小文件大小）
  const targetHeight = 300; // 每张小图的高度（调整为300以减小文件大小）
  const padding = 2; // 图片之间的间距（减小间距）

  console.log(`开始合成 ${imagePaths.length} 张图片，布局: ${actualRows}行 x ${actualCols}列`);

  for (let i = 0; i < imagePaths.length; i++) {
    try {
      const image = sharp(imagePaths[i]);
      const metadata = await image.metadata();
      
      // 判断图片是横向还是纵向
      const isLandscape = metadata.width > metadata.height;
      
      // 统一使用cover模式，确保所有图片都是相同尺寸，便于对齐
      const resized = image.resize(targetWidth, targetHeight, {
        fit: 'cover', // cover模式，填满不留白
        position: 'center' // 居中裁剪
      });

      const buffer = await resized.toBuffer();
      const resizedMetadata = await sharp(buffer).metadata();
      
      const row = Math.floor(i / actualCols);
      const col = i % actualCols;
      
      images.push({
        input: buffer,
        top: row * (targetHeight + padding),
        left: col * (targetWidth + padding)
      });

      if ((i + 1) % 20 === 0 || i === imagePaths.length - 1) {
        console.log(`  [${i + 1}/${imagePaths.length}] 已处理图片...`);
      }
    } catch (error) {
      console.warn(`  警告: 无法处理图片 ${imagePaths[i]}: ${error.message}`);
      // 创建一个随机颜色的占位图
      const placeholder = sharp({
        create: {
          width: targetWidth,
          height: targetHeight,
          channels: 3,
          background: { 
            r: Math.floor(Math.random() * 200 + 50), 
            g: Math.floor(Math.random() * 200 + 50), 
            b: Math.floor(Math.random() * 200 + 50) 
          }
        }
      });
      const buffer = await placeholder.png().toBuffer();
      const row = Math.floor(i / actualCols);
      const col = i % actualCols;
      images.push({
        input: buffer,
        top: row * (targetHeight + padding),
        left: col * (targetWidth + padding)
      });
    }
  }

  // 计算最终画布大小（精确计算，最后一行已铺满对齐）
  const canvasWidth = actualCols * targetWidth + (actualCols - 1) * padding;
  // 最后一行已铺满，所以高度就是 rows * (height + padding) - padding
  const canvasHeight = actualRows * targetHeight + (actualRows - 1) * padding;

  // 创建合成图片（使用深色背景）
  const composite = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 } // 黑色背景
    }
  });

  // 降低JPEG质量以减小文件大小（从90降到75）
  await composite.composite(images).jpeg({ quality: 75, mozjpeg: true }).toFile(outputPath);

  console.log(`✅ 图片合成完成: ${outputPath}`);
  console.log(`   画布大小: ${canvasWidth} x ${canvasHeight}`);
  console.log(`   每张图片: ${targetWidth} x ${targetHeight}`);
  console.log(`   实际布局: ${actualRows}行 x ${actualCols}列`);
  
  return outputPath;
}

// 主函数
async function main() {
  const sourceDir = path.join(__dirname, "..", "publish-source");
  
  // 检查源目录是否存在
  if (!fs.existsSync(sourceDir)) {
    console.error(`错误: 目录不存在 ${sourceDir}`);
    process.exit(1);
  }
  
  // 读取第一层文件夹
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const folders = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  
  if (folders.length === 0) {
    console.error("错误: 在 publish-source 目录下没有找到文件夹");
    process.exit(1);
  }
  
  console.log(`找到 ${folders.length} 个文件夹`);
  console.log("=".repeat(50));
  
  // 提取每个文件夹的 NO 内容，并收集所有图片
  const noContents = [];
  const allImages = [];
  
  for (const folderName of folders) {
    const noContent = extractNoContent(folderName);
    noContents.push(noContent);
    console.log(`提取: ${noContent}`);
    
    // 查找该文件夹中的所有图片
    const folderPath = path.join(sourceDir, folderName);
    const folderImages = findAllImages(folderPath);
    
    if (folderImages.length > 0) {
      // 对图片进行排序，确保顺序一致
      const sortedImages = folderImages.sort((a, b) => {
        // 按文件名排序
        return a.localeCompare(b, 'zh-CN', { numeric: true });
      });
      
      // 将所有图片添加到总列表中
      allImages.push(...sortedImages);
      console.log(`  找到 ${sortedImages.length} 张图片`);
    } else {
      console.warn(`  警告: 在文件夹 ${folderName} 中未找到图片`);
    }
  }
  
  console.log("=".repeat(50));
  
  if (allImages.length === 0) {
    console.error("错误: 没有找到任何图片");
    process.exit(1);
  }
  
  // 随机选择600-800张图片
  const minCount = 600;
  const maxCount = 800;
  let targetCount;
  
  if (allImages.length < minCount) {
    // 如果总数不足600张，选择所有图片
    targetCount = allImages.length;
    console.warn(`⚠️  警告: 图片总数不足600张，实际选择了 ${targetCount} 张`);
  } else if (allImages.length <= maxCount) {
    // 如果总数在600-800之间，选择所有图片
    targetCount = allImages.length;
  } else {
    // 如果总数超过800张，随机选择600-800张
    targetCount = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
  }
  
  const selectedImages = getRandomItems(allImages, targetCount);
  
  console.log(`\n总共找到 ${allImages.length} 张图片`);
  console.log(`随机选择了 ${selectedImages.length} 张图片用于合成`);
  
  // 构建描述文本（模版 + 提取的内容，隔行显示）
  const descLines = noContents.map(content => content);
  const description = TEMPLATE + descLines.join("\n\n");
  
  console.log("\n生成的描述文本:");
  console.log("-".repeat(50));
  console.log(description);
  console.log("-".repeat(50));
  
  try {
    // 第一步：合成图片
    console.log("\n" + "=".repeat(50));
    console.log("步骤 1: 合成图片");
    console.log("=".repeat(50));
    
    const outputDir = path.join(__dirname, "..");
    const compositeImagePath = path.join(outputDir, `composite_${Date.now()}.jpg`);
    
    await compositeImages(selectedImages, compositeImagePath);
    
    // 第二步：上传合成后的图片
    console.log("\n" + "=".repeat(50));
    console.log("步骤 2: 上传合成图片");
    console.log("=".repeat(50));
    console.log(`图片路径: ${compositeImagePath}`);
    
    const uploadResult = await uploadImage(compositeImagePath);
    console.log(`✅ 上传成功`);
    
    // 清理临时文件
    try {
      fs.unlinkSync(compositeImagePath);
      console.log(`✅ 已删除临时文件: ${compositeImagePath}`);
    } catch (error) {
      console.warn(`警告: 无法删除临时文件: ${error.message}`);
    }
    
    // 第三步：发布商品（只发布一次，使用合成后的图片）
    console.log("\n" + "=".repeat(50));
    console.log("步骤 3: 发布商品");
    console.log("=".repeat(50));
    
    const title = "【高清美图素材】未修底片直出｜风格多样｜修图练习/影楼工作室都能用！";
    const publishResult = await publishItem(uploadResult, title, description);
    
    console.log("\n" + "=".repeat(50));
    console.log("✅ 发布完成！");
    console.log("=".repeat(50));
    
  } catch (error) {
    console.error("\n❌ 处理失败:", error.message);
    if (error.response) {
      console.error("响应状态:", error.response.status);
      console.error("响应数据:", error.response.data);
    }
    process.exit(1);
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main().catch(error => {
    console.error("程序执行失败:", error);
    process.exit(1);
  });
}

module.exports = { main };
