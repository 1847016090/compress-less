# 解压脚本使用说明 (Node.js 版本)

## 功能特性

- ✅ 递归解压 source 文件夹中的所有压缩文件
- ✅ 实时显示解压进度
- ✅ 自动检测并解压嵌套的压缩包
- ✅ 支持密码保护的压缩文件（密码: cosergirl.com）
- ✅ 支持多种压缩格式（.7z, .zip, .rar 等）

## 系统要求

- Node.js >= 12.0.0
- 需要安装系统解压工具（二选一）：
  - **7z** (推荐): `brew install p7zip`
  - **unzip**: `brew install unzip` (仅支持 ZIP 文件)

## 安装依赖

Node.js 脚本无需额外安装 npm 包，只需要系统工具。

### 安装 7z 工具（推荐）

```bash
brew install p7zip
```

### 安装 unzip 工具（仅支持 ZIP）

```bash
brew install unzip
```

## 使用方法

### 方法 1: 直接运行脚本

```bash
node scripts/extract_all.js
```

### 方法 2: 使用可执行权限（已设置）

```bash
./scripts/extract_all.js
```

### 方法 3: 使用 npm script

```bash
cd scripts
npm start
```

## 解压说明

- 脚本会自动扫描 `source` 文件夹中的所有压缩文件
- 解压后的文件会保存在源文件同级目录的 `{文件名}_extracted` 文件夹中
- 如果解压出的文件中包含压缩包，会自动继续解压
- 所有压缩文件使用密码: `cosergirl.com`

## 输出示例

```
源目录: /path/to/source
解压密码: cosergirl.com

找到 3 个压缩文件，开始解压...
============================================================

[1/3] 正在解压: 042.7z (2.10 MB)
  路径: /path/to/source/042.7z
  ✓ 解压成功 -> /path/to/source/042_extracted
  进度: 1/3 (33%) | 成功: 1 | 失败: 0
...
```

## 注意事项

- 确保有足够的磁盘空间
- 解压大文件可能需要较长时间
- 如果解压失败，会在进度中显示失败数量

