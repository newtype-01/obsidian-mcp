#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

// 递归添加文件，避免目录条目
function addFilesRecursively(archive, sourceDir, targetPrefix) {
  function addFiles(currentDir, currentPrefix) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const sourcePath = path.join(currentDir, item);
      const targetPath = path.join(currentPrefix, item).replace(/\\/g, '/');
      
      try {
        const stat = fs.statSync(sourcePath);
        
        if (stat.isFile()) {
          // 只添加文件，不添加目录
          archive.file(sourcePath, { name: targetPath });
        } else if (stat.isDirectory()) {
          // 递归处理子目录，但不添加目录条目本身
          addFiles(sourcePath, targetPath);
        }
      } catch (error) {
        // 跳过符号链接或无法访问的文件
        console.log(`跳过文件: ${sourcePath} (${error.code})`);
        continue;
      }
    }
  }
  
  addFiles(sourceDir, targetPrefix);
}

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
    zlib: { level: 9 }, // 最高压缩级别
    store: false // 禁用目录条目存储
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
  
  // 递归添加build目录中的所有文件（避免目录条目）
  console.log('添加build目录...');
  addFilesRecursively(archive, 'build', 'build');
  
  // 递归添加node_modules目录中的所有文件（避免目录条目）
  if (fs.existsSync('node_modules')) {
    console.log('添加node_modules目录...');
    addFilesRecursively(archive, 'node_modules', 'node_modules');
  }
  
  // 完成压缩
  await archive.finalize();
}

generateDXT().catch(console.error);