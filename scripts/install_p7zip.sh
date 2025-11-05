#!/bin/bash
# p7zip 安装脚本

echo "正在尝试安装 p7zip..."

# 方法 1: 尝试使用 Homebrew（推荐）
if command -v brew &> /dev/null; then
    echo "检测到 Homebrew，尝试安装..."
    
    # 先尝试修复 Homebrew Ruby 问题
    echo "修复 Homebrew 缓存..."
    rm -rf /Users/$USER/Library/Caches/Homebrew/portable-ruby* 2>/dev/null
    pkill -f "brew vendor-install" 2>/dev/null
    
    # 尝试安装
    if HOMEBREW_NO_AUTO_UPDATE=1 brew install p7zip 2>&1 | tee /tmp/brew_install.log; then
        echo "✓ p7zip 安装成功！"
        which 7z
        exit 0
    else
        echo "Homebrew 安装失败，尝试其他方法..."
    fi
fi

# 方法 2: 检查是否已安装
if command -v 7z &> /dev/null; then
    echo "✓ 7z 已经安装: $(which 7z)"
    exit 0
fi

echo ""
echo "=========================================="
echo "安装失败，请手动安装："
echo ""
echo "方法 1: 修复 Homebrew 后安装"
echo "  1. 运行: rm -rf ~/Library/Caches/Homebrew/portable-ruby*"
echo "  2. 运行: brew install p7zip"
echo ""
echo "方法 2: 手动下载安装"
echo "  访问: https://www.7-zip.org/download.html"
echo "  或使用: curl -L https://sourceforge.net/projects/p7zip/files/latest/download -o p7zip.tar.bz2"
echo ""
echo "方法 3: 使用 MacPorts (如果已安装)"
echo "  sudo port install p7zip"
echo "=========================================="

