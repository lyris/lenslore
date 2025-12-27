#!/usr/bin/env node
/**
 * 部署脚本 - 使用 rsync 上传 dist 到服务器
 * 配置从 .env.local 读取
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// 加载 .env.local
const envPath = resolve(projectRoot, '.env.local');
if (!existsSync(envPath)) {
    console.error('❌ Error: .env.local not found!');
    console.error('Please copy .env.local.example to .env.local and configure it.');
    process.exit(1);
}

dotenv.config({ path: envPath });

// 读取配置
const {
    RSYNC_BIN,
    SSH_BIN,
    DEPLOY_SSH_KEY_PATH,
    DEPLOY_SSH_PORT,
    DEPLOY_USER,
    DEPLOY_HOST,
    DEPLOY_PATH
} = process.env;

// 验证必需的配置
const requiredVars = {
    RSYNC_BIN,
    SSH_BIN,
    DEPLOY_SSH_KEY_PATH,
    DEPLOY_SSH_PORT,
    DEPLOY_USER,
    DEPLOY_HOST,
    DEPLOY_PATH
};

const missingVars = Object.entries(requiredVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    console.error('❌ Error: Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('\nPlease configure them in .env.local');
    process.exit(1);
}

// 检查 dist 目录
const distPath = resolve(projectRoot, 'dist');
if (!existsSync(distPath)) {
    console.error('❌ Error: dist/ directory not found!');
    console.error('Please run "npm run build" first.');
    process.exit(1);
}

// 构建 rsync 命令
const sshCommand = `${SSH_BIN} -i '${DEPLOY_SSH_KEY_PATH}' -p ${DEPLOY_SSH_PORT}`;
const remote = `${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}`;

const rsyncCommand = `"${RSYNC_BIN}" -acv --delete -e "${sshCommand}" ./dist/ ${remote}`;

console.log('📦 Deploying to server...');
console.log(`   Remote: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}`);
console.log('');

try {
    // 执行 rsync
    execSync(rsyncCommand, {
        stdio: 'inherit',
        cwd: projectRoot,
        shell: true
    });

    console.log('');
    console.log('✅ Deployment successful!');
    console.log(`   URL: https://${DEPLOY_HOST}/lenslore/`);

} catch (error) {
    console.error('');
    console.error('❌ Deployment failed!');
    console.error(error.message);
    process.exit(1);
}
