const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const crypto = require("crypto");
const { COOKIE } = require("./config");

// 上传图片的函数
async function uploadImage(imagePath, cookie = null) {
  try {
    // 读取图片文件
    const imageStream = fs.createReadStream(imagePath);
    const formData = new FormData();

    // 添加文件到 FormData，字段名为 "file"
    formData.append("file", imageStream, {
      filename: path.basename(imagePath),
      contentType: "image/jpeg",
    });

    // API 地址
    const url =
      "https://stream-upload.goofish.com/api/upload.api?floderId=0&appkey=fleamarket&_input_charset=utf-8";

    // 请求头配置
    const headers = {
      accept: "*/*",
      "accept-language": "zh,zh-CN;q=0.9",
      "access-control-allow-origin": "*",
      origin: "https://www.goofish.com",
      priority: "u=1, i",
      referer: "https://www.goofish.com/",
      "sec-ch-ua":
        '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "x-requested-with": "XMLHttpRequest",
      cookie: cookie || COOKIE,
      ...formData.getHeaders(), // 添加 FormData 的 Content-Type 和 boundary
    };

    // 发送请求
    console.log("开始上传图片...");
    const response = await axios.post(url, formData, { headers });

    console.log("上传成功！");
    console.log("响应数据:", JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error("上传失败:", error.message);
    if (error.response) {
      console.error("响应状态:", error.response.status);
      console.error("响应数据:", error.response.data);
    }
    throw error;
  }
}

// 解析pix字段，格式为 "2364x1773"
function parsePix(pix) {
  const [width, height] = pix.split("x").map(Number);
  return { width, height };
}

// 从 cookie 字符串中提取 _m_h5_tk 的值
function extractMTopToken(cookieString) {
  const match = cookieString.match(/_m_h5_tk=([^;]+)/);
  return match ? match[1] : null;
}

// 生成 mtop API 的 sign 参数
// 参考：https://blog.csdn.net/John_Lenon/article/details/151934748
// 格式：token + "&" + t + "&" + appKey + "&" + data
function generateSign(timestamp, appKey, cookieString, dataString) {
  // 从 cookie 中提取 _m_h5_tk
  const mTopToken = extractMTopToken(cookieString);
  if (!mTopToken) {
    throw new Error("无法从 cookie 中提取 _m_h5_tk");
  }

  // 提取 token（下划线前的部分）
  const token = mTopToken.split("_")[0];

  // 确保时间戳是字符串格式
  const t = String(timestamp);

  // 构建签名字符串：token + "&" + t + "&" + appKey + "&" + data
  const signString = `${token}&${t}&${appKey}&${dataString}`;

  // 生成 MD5 签名
  const sign = crypto
    .createHash("md5")
    .update(signString, "utf8")
    .digest("hex");

  return sign;
}

// 发布商品的函数
// uploadResult 可以是单个对象或对象数组
async function publishItem(uploadResult, title, desc = null, cookie = null) {
  try {
    // 支持单个对象或数组
    const uploadResults = Array.isArray(uploadResult) ? uploadResult : [uploadResult];
    
    if (uploadResults.length === 0) {
      throw new Error("至少需要一张图片");
    }

    // 构建图片信息列表
    const imageInfoDOList = uploadResults.map((result, index) => {
      const { width, height } = parsePix(result.object.pix);
      const imageUrl = result.object.url;
      
      return {
        extraInfo: {
          isH: "false",
          isT: "false",
          raw: "false",
        },
        isQrCode: false,
        url: imageUrl,
        heightSize: height,
        widthSize: width,
        major: index === 0, // 第一张图片作为主图
        type: 0,
        status: "done",
      };
    });

    // 生成时间戳
    const timestamp = Date.now();
    const uniqueCode = `${timestamp}${Math.floor(Math.random() * 1000000)}`;

    // 如果没有提供 desc，使用 title 作为 desc
    const finalDesc = desc || title;

    // 构建请求数据
    const requestData = {
      freebies: false,
      itemTypeStr: "b",
      quantity: "1",
      simpleItem: "true",
      imageInfoDOList: imageInfoDOList,
      itemTextDTO: {
        desc: finalDesc,
        title: title,
        titleDescSeparate: false,
      },
      itemLabelExtList: [
        {
          channelCateName: "其他闲置",
          valueId: null,
          channelCateId: "201459411",
          valueName: null,
          tbCatId: "50014945",
          subPropertyId: null,
          labelType: "common",
          subValueId: null,
          labelId: null,
          propertyName: "分类",
          isUserClick: "1",
          isUserCancel: null,
          from: "newPublishChoice",
          propertyId: "-10000",
          labelFrom: "newPublish",
          text: "其他闲置",
          properties: "-10000##分类:201459411##其他闲置",
        },
      ],
      itemPriceDTO: {
        origPriceInCent: "250",
        priceInCent: "200",
      },
      userRightsProtocols: [],
      itemPostFeeDTO: {
        canFreeShipping: true,
        supportFreight: true,
        onlyTakeSelf: false,
      },
      itemAddrDTO: {
        area: "双流区",
        city: "成都",
        divisionId: 510116,
        gps: "30.483576,104.101310",
        poiId: "B0FFGHUNHR",
        poiName: "东林春天",
        prov: "四川",
      },
      defaultPrice: false,
      itemCatDTO: {
        catId: "50023914",
        catName: "其他闲置",
        channelCatId: "201459411",
        tbCatId: "50014945",
      },
      uniqueCode: uniqueCode,
      sourceId: "pcMainPublish",
      bizcode: "pcMainPublish",
      publishScene: "pcMainPublish",
    };

    // 准备 data 字符串（用于生成 sign）
    const dataString = JSON.stringify(requestData);

    // URL编码数据
    const encodedData = querystring.stringify({
      data: dataString,
    });

    // Cookie 字符串（用于生成 sign）
    const cookieString = cookie || COOKIE;
    if (!cookie) {
      console.warn("⚠️  警告: 发布时未传入 cookie，使用默认 cookie");
    }

    // 构建 URL 参数（先不包含 sign）
    const appKey = "34839810";
    const urlParamsObj = {
      jsv: "2.7.2",
      appKey: appKey,
      t: timestamp.toString(),
      v: "1.0",
      type: "originaljson",
      accountSite: "xianyu",
      dataType: "json",
      timeout: "20000",
      api: "mtop.idle.pc.idleitem.publish",
      sessionOption: "AutoLoginOnly",
      spm_cnt: "a21ybx.publish.0.0",
      spm_pre: "a21ybx.home.sidebar.1.4c053da6164WFB",
      log_id: "4c053da6164WFB",
    };

    // 生成 sign（格式：token + "&" + t + "&" + appKey + "&" + data）
    const sign = generateSign(timestamp, appKey, cookieString, dataString);
    urlParamsObj.sign = sign;

    // 调试信息：输出生成的 sign
    console.log("生成的 sign:", sign);
    console.log("时间戳 t:", timestamp.toString());
    console.log("data 字符串长度:", dataString.length);

    // 构建完整 URL
    const baseUrl =
      "https://h5api.m.goofish.com/h5/mtop.idle.pc.idleitem.publish/1.0/";
    const urlParams = new URLSearchParams(urlParamsObj);
    const url = `${baseUrl}?${urlParams.toString()}`;

    // 请求头配置
    const headers = {
      accept: "application/json",
      "accept-language": "zh,zh-CN;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://www.goofish.com",
      priority: "u=1, i",
      referer: "https://www.goofish.com/",
      "sec-ch-ua":
        '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      cookie: cookieString,
    };

    // 发送请求
    console.log("开始发布商品...");
    console.log("标题:", title);
    console.log("描述预览:");
    console.log(finalDesc);
    console.log("描述长度:", finalDesc.length, "字符");
    const response = await axios.post(url, encodedData, { headers });

    // 检查响应结果
    const responseData = response.data;
    const isSuccess =
      responseData.ret &&
      responseData.ret[0] &&
      responseData.ret[0].includes("SUCCESS");

    if (isSuccess) {
      console.log("✅ 发布成功！");
      if (responseData.data && responseData.data.itemId) {
        console.log(`商品ID: ${responseData.data.itemId}`);
      }
    } else {
      console.error("❌ 发布失败！");
      console.error("响应 ret:", responseData.ret);
      console.error("完整响应数据:", JSON.stringify(responseData, null, 2));
    }

    return responseData;
  } catch (error) {
    console.error("发布失败:", error.message);
    if (error.response) {
      console.error("响应状态:", error.response.status);
      console.error("响应数据:", error.response.data);
    }
    throw error;
  }
}

// 主函数
async function main() {
  // 获取命令行参数（影视剧名）
  const movieName = process.argv[2] || "测试影视";

  // 获取图片路径（相对于脚本文件）
  const imagePath = path.join(__dirname, "test.jpg");

  // 检查文件是否存在
  if (!fs.existsSync(imagePath)) {
    console.error(`错误: 文件不存在 ${imagePath}`);
    process.exit(1);
  }

  try {
    // 第一步：上传图片
    console.log("=".repeat(50));
    console.log("步骤 1: 上传图片");
    console.log("=".repeat(50));
    const uploadResult = await uploadImage(imagePath);

    // 第二步：发布商品
    console.log("\n" + "=".repeat(50));
    console.log("步骤 2: 发布商品");
    console.log("=".repeat(50));
    const publishResult = await publishItem(uploadResult, movieName, movieName);

    console.log("\n" + "=".repeat(50));
    console.log("全部完成！");
    console.log("=".repeat(50));
  } catch (error) {
    console.error("程序执行失败:", error);
    process.exit(1);
  }
}

// 如果直接运行此脚本，执行主函数
if (require.main === module) {
  main();
}

module.exports = { uploadImage, publishItem };
