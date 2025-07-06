#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

async function generateDXT() {
  console.log('生成 DXT 文件...');
  
  // 确保build目录存在
  if (!fs.existsSync('build')) {
    console.error('错误: build目录不存在。请先运行 npm run build');
    process.exit(1);
  }
  
  // 创建输出流
  const output = fs.createWriteStream('obsidian-mcp.dxt');
  const archive = archiver('zip', {
    zlib: { level: 9 } // 最高压缩级别
  });
  
  // 监听事件
  output.on('close', function() {
    console.log(`DXT文件生成完成: ${archive.pointer()} 字节`);
    console.log('文件路径: obsidian-mcp.dxt');
  });
  
  archive.on('error', function(err) {
    throw err;
  });
  
  // 管道输出
  archive.pipe(output);
  
  // 添加文件到压缩包
  console.log('添加文件到DXT包...');
  
  // 添加manifest.json
  archive.file('manifest.json', { name: 'manifest.json' });
  
  // 添加package.json
  archive.file('package.json', { name: 'package.json' });
  
  // 添加package-lock.json
  archive.file('package-lock.json', { name: 'package-lock.json' });
  
  // 添加README.md
  if (fs.existsSync('README.md')) {
    archive.file('README.md', { name: 'README.md' });
  }
  
  // 添加LICENSE
  if (fs.existsSync('LICENSE')) {
    archive.file('LICENSE', { name: 'LICENSE' });
  }
  
  // 添加图标文件（如果存在）
  if (fs.existsSync('icon.png')) {
    archive.file('icon.png', { name: 'icon.png' });
  }
  
  // 添加build目录
  archive.directory('build/', 'build/');
  
  // 添加整个node_modules目录（生产构建已经只包含必要依赖）
  if (fs.existsSync('node_modules')) {
    console.log('添加node_modules目录...');
    archive.directory('node_modules/', 'node_modules/');
  }
  
  // 确保node_modules/bin目录和可执行文件被正确添加
  if (fs.existsSync('node_modules/bin')) {
    console.log('添加node_modules/bin目录...');
    archive.directory('node_modules/bin/', 'node_modules/bin/');
  }
  
  // 完成压缩
  await archive.finalize();
}

generateDXT().catch(console.error);