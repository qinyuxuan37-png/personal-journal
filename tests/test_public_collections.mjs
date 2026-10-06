import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split('function clock(profile)')[0];

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
  }
  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
}

const document = {
  documentElement: { hasAttribute: () => false },
  createElement: (tag) => new Element(tag)
};
const context = vm.createContext({ document, URL });
vm.runInContext(`${source}\nglobalThis.builders = { skill, project, interest, music };`, context);

function collect(node, predicate, result = []) {
  if (predicate(node)) result.push(node);
  for (const child of node.children) collect(child, predicate, result);
  return result;
}

test('technology tiles show uploaded images and editable descriptions', () => {
  const image = 'a'.repeat(32) + '.png';
  const tile = context.builders.skill({ title: 'TypeScript', description: '项目里的实践记录', image }, 0);
  assert.equal(tile.tag, 'details');
  assert.equal(collect(tile, (node) => node.tag === 'summary').length, 1);
  assert.equal(collect(tile, (node) => node.tag === 'img')[0].src, '/media/public/' + image);
  assert.ok(collect(tile, (node) => node.textContent === '项目里的实践记录').length);
});

test('project labels expand safely to image, description and external links', () => {
  const row = context.builders.project({
    title: '开源工具', description: '这个项目的说明', stack: 'Python',
    url: 'https://github.com/example/repo', demo: 'javascript:alert(1)'
  }, 1);
  assert.equal(row.tag, 'details');
  assert.equal(collect(row, (node) => node.tag === 'summary').length, 1);
  assert.ok(collect(row, (node) => node.textContent === '开源工具').length);
  assert.ok(collect(row, (node) => node.textContent === '这个项目的说明').length);
  const links = collect(row, (node) => node.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://github.com/example/repo');
});

test('game and anime shelves keep separate cover images and text', () => {
  const image = 'b'.repeat(32) + '.webp';
  const card = context.builders.interest({ title: '作品名', description: '我的感想', image }, 0, 'GAME');
  assert.equal(card.tag, 'details');
  assert.equal(collect(card, (node) => node.tag === 'img')[0].src, '/media/public/' + image);
  assert.ok(collect(card, (node) => node.textContent === '作品名').length);
  assert.ok(collect(card, (node) => node.textContent === '我的感想').length);
});

test('music records show literal artist, cover, notes and a safe external listening link', () => {
  const card = context.builders.music({ title: '<b>歌名</b>', artist: '音乐人', description: '夜晚的旋律', image: 'c'.repeat(32) + '.jpg', url: 'https://example.com/song' }, 0);
  assert.equal(card.tag, 'article');
  assert.ok(collect(card, n => n.textContent === '<b>歌名</b>').length);
  assert.ok(collect(card, n => n.textContent === '音乐人').length);
  assert.equal(collect(card, n => n.tag === 'img').length, 1);
  const link = collect(card, n => n.tag === 'a')[0];
  assert.equal(link.href, 'https://example.com/song');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(collect(card, n => ['button', 'input', 'audio', 'iframe'].includes(n.tag)).length, 0);
  const unsafe = context.builders.music({ title: '音乐', url: 'javascript:alert(1)' }, 1);
  assert.equal(collect(unsafe, n => n.tag === 'a').length, 0);
});

test('public content has no editing shortcuts; only topbar and editor fallback link to studio', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const content = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.doesNotMatch(content, /\/studio|panel-tools|管理照片|编辑项目|编辑技术/);
  assert.doesNotMatch(html, /id="map-edit"/);
  assert.equal((html.match(/href="\/studio[^"]*"/g) || []).length, 2);
  assert.match(content, /id="music-list"/);
  assert.ok(content.indexOf('id="music-list"') > content.indexOf('id="anime-list"'));
  assert.doesNotMatch(source, /\/studio\?view=public-profile/);
});
