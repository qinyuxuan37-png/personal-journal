import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').split('function clock(profile)')[0];
function setup(exported = false) {
  const elements = new Map();
  const document = {
    documentElement: { hasAttribute: () => exported },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        hidden: false, textContent: '', attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; if (name !== 'hidden') delete this[name]; }
      });
      return elements.get(id);
    }
  };
  const context = vm.createContext({ document, URL });
  vm.runInContext(`${source}\nglobalThis.render = renderProfile;`, context);
  return { render: context.render, get: (id) => document.getElementById(id) };
}
const entries = { tech: [{}, {}], projects: [{}], games: [{}, {}], anime: [{}] };
test('interest count includes music while older snapshots remain supported', () => {
  const { render, get } = setup();
  render({}, { ...entries, music: [{}, {}] });
  assert.equal(get('profile-interests-count').textContent, '5');
  render({}, entries);
  assert.equal(get('profile-interests-count').textContent, '3');
});

test('profile card uses real public counts and literal editable text', () => {
  const { render, get } = setup();
  render({ name: '秦', intro: '<b>我的介绍</b>', github: 'https://github.com/example' }, entries);
  assert.equal(get('profile-name').textContent, '秦');
  assert.equal(get('profile-intro').textContent, '<b>我的介绍</b>');
  assert.equal(get('profile-tech-count').textContent, '2');
  assert.equal(get('profile-projects-count').textContent, '1');
  assert.equal(get('profile-interests-count').textContent, '3');
  assert.equal(get('github-link').href, 'https://github.com/example');
  assert.equal(get('avatar-placeholder').textContent, '');
  assert.equal(get('github-link').target, '_blank');
  assert.equal(get('github-link').attributes['data-local-only'], undefined);
  assert.equal(get('social2-brand').attributes.hidden, undefined);
  assert.equal(get('social2-icon').hidden, true);
});

test('public refresh removes stale avatar, bio and unsafe social links', () => {
  const { render, get } = setup();
  render({ name: 'Leon', intro: 'hello', avatar: 'a'.repeat(32) + '.png', github: 'https://github.com/example' }, entries);
  assert.equal(get('avatar').hidden, false);
  assert.equal(get('avatar-placeholder').hidden, true);
  render({ intro: ' ', github: 'javascript:alert(1)' }, { tech: [], projects: [], games: [], anime: [] });
  assert.equal(get('avatar').hidden, true);
  assert.equal(get('avatar').src, undefined);
  assert.equal(get('avatar-placeholder').hidden, false);
  assert.equal(get('avatar-placeholder').textContent, '');
  assert.equal(get('profile-intro').hidden, true);
  assert.equal(get('github-link').hidden, false);
  assert.equal(get('github-link').href, undefined);
  assert.equal(get('github-link').target, undefined);
  assert.equal(get('github-link').attributes['data-local-only'], undefined);
  assert.equal(get('github-link').attributes['aria-disabled'], 'true');
  assert.equal(get('profile-interests-count').textContent, '0');
});

test('missing image falls back to an empty circle and a later valid avatar can recover', () => {
  const { render, get } = setup();
  const profile = { name: '🪷秦', avatar: 'b'.repeat(32) + '.webp' };
  render(profile, entries);
  get('avatar').onerror();
  assert.equal(get('avatar').hidden, true);
  assert.equal(get('avatar-placeholder').hidden, false);
  assert.equal(get('avatar-placeholder').textContent, '');
  render(profile, entries);
  assert.equal(get('avatar').hidden, false);
  assert.equal(get('avatar-placeholder').hidden, true);
});

test('exported card keeps portable public image paths', () => {
  const { render, get } = setup(true);
  const filename = 'c'.repeat(32) + '.jpg';
  render({ name: 'Leon', avatar: filename }, entries);
  assert.equal(get('avatar').src, './media/public/' + filename);
  assert.equal(get('avatar').alt, 'Leon的头像');
  assert.equal(get('github-link').href, undefined);
  assert.equal(get('github-link').attributes['aria-disabled'], 'true');
  assert.equal(get('github-link').attributes['data-local-only'], undefined);
});

test('three icons remain visible and custom account links update without stale targets', () => {
  const { render, get } = setup();
  render({ github: 'https://github.com/example', social2Name: '博客', social2Url: 'https://example.com/me', social3Name: 'B站', social3Url: 'https://space.bilibili.com/123' }, entries);
  for (const id of ['github-link', 'social2-link', 'social3-link']) {
    assert.equal(get(id).hidden, false);
    assert.equal(get(id).rel, 'noopener noreferrer');
  }
  assert.equal(get('social2-icon').textContent, '博客');
  assert.equal(get('social2-brand').attributes.hidden, '');
  assert.equal(get('social2-icon').hidden, false);
  assert.equal(get('social3-brand').attributes.hidden, undefined);
  assert.equal(get('social3-icon').hidden, true);
  assert.equal(get('social2-link').href, 'https://example.com/me');
  render({ social3Name: '微博', social3Url: 'data:text/html,test' }, entries);
  assert.equal(get('social3-brand').attributes.hidden, '');
  assert.equal(get('social3-icon').hidden, false);
  assert.equal(get('social3-icon').textContent, '微博');
  assert.equal(get('social3-link').href, undefined);
  render({}, entries);
  assert.equal(get('social2-brand').attributes.hidden, undefined);
  assert.equal(get('social2-icon').hidden, true);
  assert.equal(get('social3-brand').attributes.hidden, undefined);
});
