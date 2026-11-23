import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const origin = process.env.DEMO_SOURCE_URL || 'http://localhost:8090';
const publicUrl = 'https://delphifinaly1.github.io/sarovmsu-demo';
const output = resolve('docs');
const visitedAssets = new Set();

const fixedPages = [
    '', 'education/schedule', 'events', 'sveden', 'school-tamm',
    ...['budget', 'catering', 'common', 'document', 'education', 'eduStandarts', 'employees', 'grants', 'inter', 'managers', 'objects', 'ovz', 'paid_edu', 'struct', 'vacant'].map(code => `sveden/${code}`),
];

function localPath(pathname, html = false) {
    const safe = normalize(pathname.replace(/^\/+/, '')).replace(/^\.\.(?:\/|$)/, '');
    return html ? join(output, safe, 'index.html') : join(output, safe || 'index.html');
}

function sourceUrl(pathname) {
    return new URL(pathname, `${origin}/`).toString();
}

function isLocalAsset(value) {
    try {
        return new URL(value, `${origin}/`).origin === new URL(origin).origin;
    } catch {
        return false;
    }
}

function isDocument(value) {
    return /\.(?:pdf|docx?|xlsx?|pptx?)(?:[?#].*)?$/i.test(value) || /\/media\/\d+\/[^?#]+\.(?:pdf|docx?|xlsx?|pptx?)(?:[?#].*)?$/i.test(value);
}

function addDemoMetadata(html, pathname) {
    const marker = '<meta name="robots" content="noindex,nofollow,noarchive">';
    const banner = '<aside class="demo-notice" role="status">Демонстрационная версия сайта. Информация показана как снимок и может отличаться от актуальной.</aside>';
    const style = '<style>.demo-notice{position:sticky;top:0;z-index:10000;padding:.8rem 1.25rem;background:#0c3d7a;color:#fff;text-align:center;font:600 14px/1.4 system-ui,sans-serif}.demo-document-unavailable{color:#60718d;font-style:italic}</style>';
    let result = html.replace(/<meta\s+name=["']robots["'][^>]*>/i, '');
    result = result.replace(/<\/head>/i, `${marker}${style}</head>`);
    result = result.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
    result = result.replaceAll(origin, publicUrl);
    result = result.replace(/<a\b([^>]*?)\bhref=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gis, (all, before, href, after, label) => {
        if (!isDocument(href)) return all;
        return `<span class="demo-document-unavailable">${label} <span aria-label="документ не опубликован">(документ недоступен в демоверсии)</span></span>`;
    });
    result = result.replace(/<form\b[^>]*>/gi, '<div role="group" aria-disabled="true">').replace(/<\/form>/gi, '</div>');
    result = result.replace(/<input\b[^>]*\bname=["']_token["'][^>]*>/gi, '');
    if (pathname === 'school-tamm') {
        result = result.replace(
            /<video\b[^>]*>\s*<\/video>/i,
            '<img src="/images/tamm-school/%D0%A8%D0%BA%D0%BE%D0%BB%D0%B0%20%D0%A2%D0%B0%D0%BC%D0%BC%D0%B0%20%D0%BE%D1%82%D0%BA%D1%80%D1%8B%D1%82%D0%B8%D0%B5%2005%2012%202025-2.jpg" alt="Школа Тамма: статичное превью видео" style="width:100%;height:100%;object-fit:cover">',
        );
    }
    result = result.replace(/\b(href|src)=(['"])\/(?!\/)/gi, `$1=$2${publicUrl}/`);
    const schedulePatch = `<script>if(location.pathname.includes('/education/schedule')){const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>{const value=String(input);if(!value.includes('/api/public/schedule'))return originalFetch(input,init);const course=new URL(value,location.href).searchParams.get('course')||'1';return originalFetch('${publicUrl}/demo-data/schedule-course-'+course+'.json',init)}}<\/script>`;
    result = result.replace(/<\/head>/i, `${schedulePatch}</head>`);
    return result;
}

function htmlAssets(html) {
    const urls = [];
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
        const value = match[1];
        const pathname = new URL(value, `${origin}/`).pathname;
        if (isLocalAsset(value) && !isDocument(value) && /\.(?:css|js|mjs|png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/i.test(pathname)) urls.push(value);
    }
    return urls;
}

function cssAssets(css) {
    const urls = [];
    for (const match of css.matchAll(/url\((?:["']?)([^"')]+)(?:["']?)\)/gi)) {
        const value = match[1];
        if (isLocalAsset(value) && !isDocument(value)) urls.push(value);
    }
    return urls;
}

async function fetchText(pathname) {
    const response = await fetch(sourceUrl(pathname));
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    return response.text();
}

async function copyAsset(value) {
    const url = new URL(value, `${origin}/`);
    const key = `${url.pathname}${url.search}`;
    if (visitedAssets.has(key) || isDocument(url.pathname)) return;
    visitedAssets.add(key);

    const response = await fetch(url);
    if (!response.ok) return;
    const target = localPath(url.pathname);
    await mkdir(dirname(target), { recursive: true });
    const buffer = Buffer.from(await response.arrayBuffer());
    let content = buffer;

    if (extname(url.pathname).toLowerCase() === '.css') {
        const css = buffer.toString('utf8');
        await Promise.all(cssAssets(css).map(copyAsset));
        content = Buffer.from(css
            .replaceAll(origin, publicUrl)
            .replace(/url\((['"]?)\/(?!\/)/gi, `url($1${publicUrl}/`), 'utf8');
    }
    await writeFile(target, content);
}

async function exportPage(pathname) {
    const raw = await fetchText(pathname);
    const html = addDemoMetadata(raw, pathname);
    const target = localPath(pathname, true);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
    await Promise.all(htmlAssets(raw).map(copyAsset));
}

async function writeScheduleSnapshot() {
    const date = new Date().toISOString().slice(0, 10);
    for (const course of [1, 2]) {
        const response = await fetch(sourceUrl(`/api/public/schedule?course=${course}&date=${date}`));
        if (!response.ok) continue;
        const target = join(output, 'demo-data', `schedule-course-${course}.json`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await response.text());
    }
}

async function main() {
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const materials = JSON.parse(await fetchText('/api/public/materials'));
    const slugs = materials.map(item => item.slug === 'home' ? '' : item.slug).filter(Boolean);
    const pages = [...new Set([...fixedPages, ...slugs])];

    for (const page of pages) {
        await exportPage(page);
    }
    await writeScheduleSnapshot();
    await writeFile(join(output, '.nojekyll'), '');
    await writeFile(join(output, 'README.txt'), 'Статичный публичный снимок сайта. Админка, база данных и документы в этой папке отсутствуют.\n');
    console.log(`Exported ${pages.length} public pages and ${visitedAssets.size} local assets.`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
