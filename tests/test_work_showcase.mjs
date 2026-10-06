import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/work-showcase.js', import.meta.url), 'utf8');
// Synthetic test-only entries; never seeded into a user's database.
const content = {
  projects: [
    { title: '个人空间', status: '开发中', visual: '个人空间', stack: 'HTML / CSS, JavaScript, SVG / Canvas, Python, SQLite' },
    { title: 'Peripheral Peek', status: '开发中', visual: '外设状态', stack: 'C#, WinForms / .NET Framework, Win32 / HID' }
  ],
  tech: ['HTML / CSS', 'JavaScript', 'SVG / Canvas', 'Python', 'SQLite', 'C#', 'WinForms / .NET Framework', 'Win32 / HID'].map((title, i) => ({ title, category: ['界面与交互', '服务与数据', '桌面与设备'][i < 3 ? 0 : i < 5 ? 1 : 2] }))
};
const entries = (kind, data = content[kind]) => data.map((item, i) => ({ id: kind + i, kind, data: item }));
function fixture(exported = false) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attrs = {}; this.classes = new Set(); this.style = { setProperty() {} }; this.offsetTop = 100; this.classList = { contains: c => this.classes.has(c), toggle: (c, on) => on ? this.classes.add(c) : this.classes.delete(c) }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.events[k] = fn; }
    get childElementCount() { return this.children.length; }
  }
  const nodes = Object.fromEntries(['tech-list', 'tech-detail', 'projects-list', 'projects'].map(id => [id, new Node('div')]));
  const document = { getElementById: id => nodes[id], createElement: tag => new Node(tag), documentElement: { hasAttribute: () => exported } };
  const frames = [], window = { requestAnimationFrame: fn => frames.push(fn) };
  vm.runInNewContext(script, { document, window, URL });
  return { ...nodes, render: window.WorkShowcase.render, frames };
}
const find = (node, tag) => [...(node.tag === tag ? [node] : []), ...node.children.flatMap(n => find(n, tag))];
const text = node => (node.textContent || '') + node.children.map(text).join(' ');

test('reviewed real projects display unpublished status without fake repository/demo links', () => {
  const h = fixture(); h.render(entries('tech'), entries('projects'));
  assert.equal(find(h['projects-list'], 'article').length, 2);
  assert.equal(find(h['tech-list'], 'button').length, 8);
  assert.equal(find(h['tech-list'], 'section').length, 3);
  const cards = find(h['projects-list'], 'article');
  for (const card of cards) { assert.match(text(card), /开发中/); assert.match(text(card), /源码暂未公开/); assert.match(text(card), /界面示意 · 非实时数据/); }
  assert.equal(find(h['projects-list'], 'a').filter(n => n.target === '_blank').length, 0);
  assert.doesNotMatch(text(h['projects-list']), /删除|编辑|下载|star/);
});

test('technology selection and project chips associate by full names and preserve selection on refresh', () => {
  const h = fixture(); const tech = entries('tech'), projects = entries('projects'); h.render(tech, projects);
  const csharp = find(h['tech-list'], 'button').find(n => text(n).includes('C#')); csharp.events.click();
  assert.equal(csharp.attrs['aria-pressed'], 'true');
  assert.equal(find(h['tech-list'], 'button').filter(n => n.attrs['aria-pressed'] === 'true').length, 1);
  assert.match(text(h['tech-detail']), /Peripheral Peek/); assert.doesNotMatch(text(h['tech-detail']), /个人空间/);
  h.projects.classes.add('is-active'); find(h['tech-detail'], 'a')[0].events.click(); h.frames.splice(0).forEach(fn => fn());
  assert.equal(find(h['projects-list'], 'article')[1].classes.has('is-highlighted'), true); assert.equal(h.projects.scrollTop, 76);
  h.render(tech.slice().reverse(), projects); assert.match(text(h['tech-detail']), /C#/);
  const js = find(h['projects-list'], 'a').find(n => n.textContent === 'JavaScript'); js.events.click();
  assert.match(text(h['tech-detail']), /JavaScript/); assert.match(text(h['tech-detail']), /个人空间/);
  assert.doesNotMatch(text(h['tech-detail']), /Peripheral Peek/);
  h.render(tech.filter(t => t.data.title !== 'JavaScript'), projects);
  assert.equal(find(h['tech-list'], 'button').filter(n => n.attrs['aria-pressed'] === 'true').length, 1);
});

test('empty or unrelated data remains empty; rendering never invents missing portfolio content', () => {
  const h = fixture(); h.render(entries('tech'), entries('projects')); h.render([], []);
  assert.equal(find(h['projects-list'], 'article').length, 0); assert.equal(find(h['tech-list'], 'button').length, 0); assert.equal(h['tech-detail'].hidden, true);
  h.render([{ kind: 'notes', data: { title: 'private' } }], [{ kind: 'photos', data: { title: 'private' } }]);
  assert.doesNotMatch(text(h['projects-list']) + text(h['tech-list']), /private/);
});

test('literal content, safe external URLs and hashed media boundaries also hold in offline exports', () => {
  const h = fixture(true), title = '<img src=x onerror=alert(1)>';
  h.render(entries('tech', [{ title, description: '<script>x</script>', image: '../private/photo.jpg' }]), entries('projects', [{ title, stack: title, description: '<script>x</script>', highlights: '<b>a</b>\nsecond', url: 'javascript:alert(1)', demo: 'file:///secret', image: 'https://example.com/x.png' }]));
  assert.equal(find(h['tech-list'], 'strong')[0].textContent, title);
  assert.equal(find(h['projects-list'], 'h3')[0].textContent, title);
  assert.equal(find(h['projects-list'], 'li')[0].textContent, '<b>a</b>');
  assert.equal(find(h['projects-list'], 'img').length, 0); assert.equal(find(h['tech-list'], 'img').length, 0);
  assert.equal(find(h['projects-list'], 'a').filter(a => a.target).length, 0);
  const image = 'a'.repeat(32) + '.png';
  h.render(entries('tech', [{ title: 'Python', image }]), entries('projects', [{ title: 'Project', image, url: 'https://example.com/repo', demo: 'https://example.com/demo' }]));
  for (const img of [...find(h['projects-list'], 'img'), ...find(h['tech-list'], 'img')]) {
    assert.equal(img.src, './media/public/' + image); img.events.error(); assert.equal(img.hidden, true);
  }
  const links = find(h['projects-list'], 'a'); assert.equal(links.length, 2);
  links.forEach(a => { assert.equal(a.target, '_blank'); assert.equal(a.rel, 'noopener noreferrer'); });
  assert.doesNotMatch(text(h['projects-list']), /源码暂未公开/);
});
