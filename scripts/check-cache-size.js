/**
 * 检查浏览器 Cache Storage 中 transformers-cache 的大小
 * 在浏览器控制台中运行此脚本
 */

async function checkTransformersCacheSize() {
    try {
        console.log('正在检查 Cache Storage...');

        // 获取所有缓存名称
        const cacheNames = await caches.keys();
        console.log('找到的缓存:', cacheNames);

        // 查找 transformers-cache
        const transformersCaches = cacheNames.filter(name =>
            name.includes('transformers') || name.includes('huggingface')
        );

        if (transformersCaches.length === 0) {
            console.warn('未找到 transformers 相关的缓存');
            return;
        }

        let totalSize = 0;
        const fileDetails = [];

        for (const cacheName of transformersCaches) {
            console.log(`\n检查缓存: ${cacheName}`);
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();

            console.log(`  文件数量: ${requests.length}`);

            for (const request of requests) {
                const response = await cache.match(request);
                if (response) {
                    const blob = await response.blob();
                    const size = blob.size;
                    totalSize += size;

                    fileDetails.push({
                        cache: cacheName,
                        url: request.url,
                        size: size,
                        sizeFormatted: formatBytes(size)
                    });
                }
            }
        }

        // 排序：按大小降序
        fileDetails.sort((a, b) => b.size - a.size);

        // 打印结果
        console.log('\n' + '='.repeat(80));
        console.log('📊 Cache Storage 统计结果');
        console.log('='.repeat(80));

        console.log(`\n总缓存大小: ${formatBytes(totalSize)}`);
        console.log(`总文件数量: ${fileDetails.length}`);

        console.log('\n📁 文件详情 (按大小排序):');
        console.log('-'.repeat(80));

        fileDetails.forEach((file, index) => {
            const fileName = file.url.split('/').pop().split('?')[0];
            console.log(`${index + 1}. ${fileName}`);
            console.log(`   大小: ${file.sizeFormatted}`);
            console.log(`   URL: ${file.url}`);
            console.log(`   缓存: ${file.cache}`);
            console.log('');
        });

        // 按缓存分组统计
        const cacheGroups = {};
        fileDetails.forEach(file => {
            if (!cacheGroups[file.cache]) {
                cacheGroups[file.cache] = { count: 0, size: 0 };
            }
            cacheGroups[file.cache].count++;
            cacheGroups[file.cache].size += file.size;
        });

        console.log('\n📦 按缓存分组统计:');
        console.log('-'.repeat(80));
        Object.entries(cacheGroups).forEach(([cacheName, stats]) => {
            console.log(`${cacheName}:`);
            console.log(`  文件数: ${stats.count}`);
            console.log(`  总大小: ${formatBytes(stats.size)}`);
            console.log('');
        });

        // 返回结构化数据
        return {
            totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            fileCount: fileDetails.length,
            files: fileDetails,
            cacheGroups
        };

    } catch (error) {
        console.error('检查缓存时出错:', error);
        throw error;
    }
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 检查 IndexedDB 中的模型缓存
 */
async function checkIndexedDBSize() {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🗄️  检查 IndexedDB 中的模型缓存');
        console.log('='.repeat(80));

        // 获取所有数据库
        const databases = await indexedDB.databases();
        console.log('找到的数据库:', databases.map(db => db.name));

        // 查找 transformers.js 相关的数据库
        const transformersDBs = databases.filter(db =>
            db.name && (
                db.name.includes('transformers') ||
                db.name.includes('huggingface') ||
                db.name.includes('onnx')
            )
        );

        if (transformersDBs.length === 0) {
            console.warn('未找到 transformers 相关的 IndexedDB');
            return;
        }

        for (const dbInfo of transformersDBs) {
            console.log(`\n检查数据库: ${dbInfo.name}`);

            // 打开数据库
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(dbInfo.name);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            const storeNames = Array.from(db.objectStoreNames);
            console.log(`  对象存储: ${storeNames.join(', ')}`);

            for (const storeName of storeNames) {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);

                // 获取所有键
                const keys = await new Promise((resolve, reject) => {
                    const request = store.getAllKeys();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                console.log(`  ${storeName}: ${keys.length} 条记录`);

                // 获取所有值并计算大小
                const values = await new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                let storeSize = 0;
                values.forEach(value => {
                    // 估算对象大小
                    const jsonStr = JSON.stringify(value);
                    storeSize += new Blob([jsonStr]).size;
                });

                console.log(`  ${storeName} 大小: ${formatBytes(storeSize)}`);
            }

            db.close();
        }

    } catch (error) {
        console.error('检查 IndexedDB 时出错:', error);
    }
}

/**
 * 完整检查：Cache Storage + IndexedDB
 */
async function checkAllModelCache() {
    console.log('🔍 开始检查所有模型缓存...\n');

    const cacheResult = await checkTransformersCacheSize();
    await checkIndexedDBSize();

    console.log('\n' + '='.repeat(80));
    console.log('✅ 检查完成');
    console.log('='.repeat(80));

    return cacheResult;
}

// 自动执行（如果在浏览器环境中）
if (typeof window !== 'undefined') {
    console.log('使用方法:');
    console.log('  checkAllModelCache()    - 检查所有缓存（推荐）');
    console.log('  checkTransformersCacheSize() - 只检查 Cache Storage');
    console.log('  checkIndexedDBSize()    - 只检查 IndexedDB');

    // 暴露到全局
    window.checkAllModelCache = checkAllModelCache;
    window.checkTransformersCacheSize = checkTransformersCacheSize;
    window.checkIndexedDBSize = checkIndexedDBSize;
}

// 如果直接运行（非导入），自动执行
if (typeof module === 'undefined') {
    checkAllModelCache().catch(console.error);
}
