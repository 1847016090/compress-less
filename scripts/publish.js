const fs = require("fs");
const path = require("path");
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

// 从数组中选择中间位置的元素
function getMiddleItem(array) {
  if (array.length === 0) return null;
  // 选择中间位置的索引（如果数组长度为偶数，选择中间偏后的那个）
  const middleIndex = Math.floor((array.length - 1) / 2);
  return array[middleIndex];
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
  
  // 提取每个文件夹的 NO 内容，并从每个文件夹选择中间位置的图片
  const noContents = [];
  const selectedImages = [];
  
  for (const folderName of folders) {
    const noContent = extractNoContent(folderName);
    noContents.push(noContent);
    console.log(`提取: ${noContent}`);
    
    // 查找该文件夹中的所有图片
    const folderPath = path.join(sourceDir, folderName);
    const allImages = findAllImages(folderPath);
    
    if (allImages.length > 0) {
      // 对图片进行排序，确保顺序一致
      const sortedImages = allImages.sort((a, b) => {
        // 按文件名排序
        return a.localeCompare(b, 'zh-CN', { numeric: true });
      });
      
      // 选择中间位置的图片
      const middleImage = getMiddleItem(sortedImages);
      const middleIndex = Math.floor((sortedImages.length - 1) / 2);
      selectedImages.push({
        folderName: noContent,
        imagePath: middleImage,
      });
      console.log(`  选择中间位置图片: ${path.basename(middleImage)} (第 ${middleIndex + 1}/${sortedImages.length} 张)`);
    } else {
      console.warn(`  警告: 在文件夹 ${folderName} 中未找到图片`);
    }
  }
  
  console.log("=".repeat(50));
  
  if (selectedImages.length === 0) {
    console.error("错误: 没有找到任何图片");
    process.exit(1);
  }
  
  // 构建描述文本（模版 + 提取的内容，隔行显示）
  const descLines = noContents.map(content => content);
  const description = TEMPLATE + descLines.join("\n\n");
  
  console.log("\n生成的描述文本:");
  console.log("-".repeat(50));
  console.log(description);
  console.log("-".repeat(50));
  
  console.log(`\n共选择了 ${selectedImages.length} 张图片，准备上传...`);
  
  try {
    // 第一步：上传所有图片
    console.log("\n" + "=".repeat(50));
    console.log("步骤 1: 上传所有图片");
    console.log("=".repeat(50));
    
    const uploadResults = [];
    for (let i = 0; i < selectedImages.length; i++) {
      const { folderName, imagePath } = selectedImages[i];
      console.log(`\n[${i + 1}/${selectedImages.length}] 上传: ${folderName}`);
      console.log(`图片路径: ${imagePath}`);
      
      try {
        const uploadResult = await uploadImage(imagePath);
        uploadResults.push(uploadResult);
        console.log(`✅ 上传成功`);
        
        // 添加延迟，避免请求过快
        if (i < selectedImages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ 上传失败:`, error.message);
        // 继续上传其他图片
        continue;
      }
    }
    
    if (uploadResults.length === 0) {
      console.error("错误: 没有成功上传任何图片");
      process.exit(1);
    }
    
    console.log(`\n✅ 共成功上传 ${uploadResults.length} 张图片`);
    
    // 第二步：发布商品（只发布一次，使用所有上传的图片）
    console.log("\n" + "=".repeat(50));
    console.log("步骤 2: 发布商品");
    console.log("=".repeat(50));
    
    const title = "【高清美图素材】未修底片直出｜风格多样｜修图练习/影楼工作室都能用！";
    const publishResult = await publishItem(uploadResults, title, description);
    
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
