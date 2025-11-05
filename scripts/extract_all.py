#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
递归解压脚本
支持递归解压所有压缩文件，并显示进度
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
from typing import List, Set

# 解压密码
PASSWORD = "cosergirl.com"

# 支持的压缩文件扩展名
COMPRESSED_EXTENSIONS = {'.7z', '.zip', '.rar', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2', '.tar.xz'}


def is_compressed_file(file_path: Path) -> bool:
    """检查文件是否为压缩文件"""
    return file_path.suffix.lower() in COMPRESSED_EXTENSIONS or any(
        file_path.name.lower().endswith(ext) for ext in COMPRESSED_EXTENSIONS
    )


def extract_7z(file_path: Path, output_dir: Path, password: str = None) -> bool:
    """解压 7z 文件，优先使用系统 7z 命令，否则尝试 py7zr"""
    # 优先使用系统 7z 命令
    if shutil.which('7z') is not None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            cmd = ['7z', 'x', str(file_path), f'-o{output_dir}', '-y']
            if password:
                cmd.extend(['-p' + password])
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False
            )
            
            if result.returncode == 0:
                return True
            else:
                # 如果 7z 命令失败，继续尝试 py7zr
                pass
        except Exception as e:
            # 如果 7z 命令出错，继续尝试 py7zr
            pass
    
    # 尝试使用 py7zr 库
    try:
        try:
            import py7zr
        except ImportError:
            print(f"\n错误: 未安装 py7zr 库，且系统未找到 7z 命令")
            print("请选择以下方式之一安装:")
            print("  1. 安装 py7zr: pip3 install py7zr")
            print("  2. 安装 7z 工具: brew install p7zip  (需要 Homebrew)")
            return False
        
        # 确保输出目录存在
        output_dir.mkdir(parents=True, exist_ok=True)
        
        with py7zr.SevenZipFile(file_path, mode='r', password=password) as archive:
            archive.extractall(path=output_dir)
        
        return True
    except Exception as e:
        print(f"错误: 解压 {file_path.name} 时发生异常: {e}")
        return False


def extract_zip(file_path: Path, output_dir: Path, password: str = None) -> bool:
    """解压 ZIP 文件"""
    try:
        import zipfile
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            if password:
                zip_ref.setpassword(password.encode('utf-8'))
            zip_ref.extractall(output_dir)
        return True
    except Exception as e:
        print(f"错误: 解压 {file_path.name} 时发生异常: {e}")
        return False


def extract_file(file_path: Path, output_dir: Path, password: str = None) -> bool:
    """根据文件类型选择解压方法"""
    ext = file_path.suffix.lower()
    
    if ext == '.7z':
        return extract_7z(file_path, output_dir, password)
    elif ext == '.zip':
        return extract_zip(file_path, output_dir, password)
    else:
        # 对于其他格式，尝试使用 7z（它支持多种格式）
        return extract_7z(file_path, output_dir, password)


def find_compressed_files(directory: Path) -> List[Path]:
    """查找目录中的所有压缩文件"""
    compressed_files = []
    for file_path in directory.rglob('*'):
        if file_path.is_file() and is_compressed_file(file_path):
            compressed_files.append(file_path)
    return compressed_files


def recursive_extract(source_dir: Path, base_output_dir: Path = None, processed: Set[Path] = None):
    """
    递归解压所有压缩文件
    
    Args:
        source_dir: 源目录
        base_output_dir: 基础输出目录（如果为 None，则在源文件同级目录创建解压文件夹）
        processed: 已处理的文件集合（用于避免重复处理）
    """
    if processed is None:
        processed = set()
    
    if base_output_dir is None:
        base_output_dir = source_dir
    
    # 查找所有压缩文件
    compressed_files = find_compressed_files(source_dir)
    
    if not compressed_files:
        print("未找到压缩文件")
        return
    
    total_files = len(compressed_files)
    current = 0
    success_count = 0
    fail_count = 0
    
    print(f"\n找到 {total_files} 个压缩文件，开始解压...")
    print("=" * 60)
    
    while compressed_files:
        file_path = compressed_files.pop(0)
        
        # 跳过已处理的文件
        if file_path in processed:
            continue
        
        current += 1
        file_size = file_path.stat().st_size / (1024 * 1024)  # MB
        print(f"\n[{current}/{total_files}] 正在解压: {file_path.name} ({file_size:.2f} MB)")
        print(f"  路径: {file_path}")
        
        # 创建输出目录（在源文件同级目录）
        output_dir = file_path.parent / f"{file_path.stem}_extracted"
        
        # 解压文件
        success = extract_file(file_path, output_dir, PASSWORD)
        
        if success:
            print(f"  ✓ 解压成功 -> {output_dir}")
            processed.add(file_path)
            success_count += 1
            
            # 查找解压目录中的新压缩文件
            new_compressed = find_compressed_files(output_dir)
            for new_file in new_compressed:
                if new_file not in processed:
                    compressed_files.append(new_file)
                    total_files += 1
                    print(f"  → 发现新压缩文件: {new_file.name}")
        else:
            print(f"  ✗ 解压失败: {file_path.name}")
            processed.add(file_path)  # 标记为已处理，避免重复尝试
            fail_count += 1
        
        progress = current * 100 // total_files if total_files > 0 else 0
        print(f"  进度: {current}/{total_files} ({progress}%) | 成功: {success_count} | 失败: {fail_count}")
    
    print("\n" + "=" * 60)
    print(f"解压完成！")
    print(f"  总计: {current} 个文件")
    print(f"  成功: {success_count} 个")
    print(f"  失败: {fail_count} 个")


def main():
    """主函数"""
    # 检查是否有可用的解压工具
    has_7z = shutil.which('7z') is not None
    try:
        import py7zr
        has_py7zr = True
    except ImportError:
        has_py7zr = False
    
    if not has_7z and not has_py7zr:
        print("=" * 60)
        print("错误: 未找到解压工具")
        print("请选择以下方式之一安装:")
        print("  1. 安装 py7zr 库: pip3 install py7zr")
        print("  2. 安装 7z 工具: brew install p7zip  (需要 Homebrew)")
        print("=" * 60)
        sys.exit(1)
    
    if has_7z:
        print("使用系统 7z 工具进行解压")
    else:
        print("使用 py7zr 库进行解压")
    
    # 获取脚本所在目录的父目录（项目根目录）
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    # source 目录
    source_dir = project_root / 'source'
    
    if not source_dir.exists():
        print(f"错误: 源目录不存在: {source_dir}")
        sys.exit(1)
    
    print(f"源目录: {source_dir}")
    print(f"解压密码: {PASSWORD}")
    
    # 开始递归解压
    recursive_extract(source_dir)


if __name__ == '__main__':
    main()

