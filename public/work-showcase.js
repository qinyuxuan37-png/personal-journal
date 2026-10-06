/* Public, data-backed project and technology exhibits. Editing stays in studio. */
(() => {
  const techRoot = document.getElementById('tech-list'), projectRoot = document.getElementById('projects-list');
  if (!techRoot || !projectRoot) return;
  const exported = document.documentElement.hasAttribute('data-export');
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const split = value => [...new Set(clean(value).split(/[,，;；\n]+/).map(s => s.trim()).filter(Boolean))];
  const key = value => clean(value).toLocaleLowerCase();
  const link = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const symbols = { 'html / css': '</>', javascript: 'JS', 'svg / canvas': '◈', python: 'Py', sqlite: 'SQL', 'c#': 'C#', 'winforms / .net framework': '.NET', 'win32 / hid': 'HID' };
  let technologies = [], projects = [], selectedTech = '', selectedProject = '';
  const techButtons = new Map(), projectCards = new Map();
  const el = (tag, cls, text) => {
    const node = document.createElement(tag); if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text; return node;
  };
  const group = data => ['界面与交互', '服务与数据', '桌面与设备'].includes(data.category) ? data.category : '更多实践';
  const tone = data => ({ '界面与交互': 'mint', '服务与数据': 'sand', '桌面与设备': 'lilac' })[group(data)] || 'mint';
  function external(label, url) {
    const a = el('a', 'work-link', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function selectProject(id) {
    selectedProject = id;
    for (const [entryId, node] of projectCards) node.classList.toggle('is-highlighted', entryId === id);
    // The route changes in the same click. Scroll only the foreground exhibit.
    window.requestAnimationFrame(() => {
      const node = projectCards.get(id), page = document.getElementById('projects');
      if (node && page?.classList.contains('is-active')) page.scrollTop = Math.max(0, node.offsetTop - 24);
    });
  }
  function selectTechnology(id) {
    const entry = technologies.find(item => item.id === id);
    if (!entry) return;
    selectedTech = id;
    for (const [entryId, node] of techButtons) node.setAttribute('aria-pressed', String(entryId === id));
    const detail = document.getElementById('tech-detail'); if (!detail) return;
    const heading = el('div', 'tool-detail-heading');
    heading.append(el('span', 'work-eyebrow', 'IN PRACTICE / 用在作品里'), el('h3', '', clean(entry.data.title) || '未命名技术'));
    const body = el('div', 'tool-detail-body');
    body.append(el('p', '', clean(entry.data.description) || '实践记录，慢慢补充。'));
    const related = projects.filter(p => split(p.data.stack).some(name => key(name) === key(entry.data.title)));
    const links = el('div', 'tool-project-links');
    for (const project of related) {
      const a = el('a', 'work-link', (clean(project.data.title) || '未命名项目') + ' ↗');
      a.href = '#projects'; a.addEventListener('click', () => selectProject(project.id)); links.append(a);
    }
    if (related.length) body.append(links);
    detail.replaceChildren(heading, body); detail.hidden = false;
  }
  function renderTechnologies() {
    techRoot.replaceChildren(); techButtons.clear();
    const detail = document.getElementById('tech-detail'); if (detail) detail.hidden = true;
    if (!technologies.length) { techRoot.append(el('p', 'work-empty', '下一次实践，会留下新的工具。')); return; }
    for (const category of [...new Set(technologies.map(entry => group(entry.data)))]) {
      const section = el('section', 'tool-group'), heading = el('div', 'tool-group-heading');
      const items = technologies.filter(entry => group(entry.data) === category);
      heading.append(el('h3', '', category), el('span', '', String(items.length).padStart(2, '0')));
      const grid = el('div', 'tool-grid');
      for (const entry of items) {
        const data = entry.data, button = el('button', 'tool-tile tool-' + tone(data)); button.type = 'button';
        button.setAttribute('aria-controls', 'tech-detail'); button.setAttribute('aria-pressed', 'false');
        const mark = el('span', 'tool-mark', symbols[key(data.title)] || clean(data.title).slice(0, 3) || '+'); mark.setAttribute('aria-hidden', 'true');
        const image = clean(data.image);
        if (/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(image)) {
          const img = el('img', 'tool-image'); img.src = (exported ? './media/public/' : '/media/public/') + image; img.alt = ''; img.loading = 'lazy';
          img.addEventListener('error', () => { img.hidden = true; mark.hidden = false; }); mark.hidden = true; button.append(img);
        }
        button.append(mark, el('strong', '', clean(data.title) || '未命名技术'), el('span', 'tool-cue', '查看实践 ↗'));
        button.addEventListener('click', () => selectTechnology(entry.id));
        grid.append(button); techButtons.set(entry.id, button);
      }
      section.append(heading, grid); techRoot.append(section);
    }
    if (!technologies.some(entry => entry.id === selectedTech)) selectedTech = technologies[0].id;
    selectTechnology(selectedTech);
  }
  function projectArt(data, index) {
    const style = data.visual === '个人空间' ? 'space' : data.visual === '外设状态' ? 'peripheral' : 'abstract';
    const art = el('div', 'work-art art-' + style); art.setAttribute('aria-hidden', 'true');
    const image = clean(data.image);
    if (/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(image)) {
      const img = el('img', 'work-image'); img.src = (exported ? './media/public/' : '/media/public/') + image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => { img.hidden = true; }); art.append(img);
    }
    if (style === 'space') {
      const window = el('div', 'space-mini'); window.append(el('div', 'mini-toolbar', 'PERSONAL / SPACE'));
      const layout = el('div', 'mini-layout'), profile = el('div', 'mini-profile');
      profile.append(el('i', 'mini-avatar'), el('span', '', '我的空间'), el('div', 'mini-stats', '作品 · 热爱 · 日常'));
      const map = el('div', 'mini-map'); map.append(el('i', 'mini-location'), el('span', '', 'A PLACE TO BE'));
      layout.append(profile, map); window.append(layout, el('div', 'mini-dots', '●  ·  ·  ·')); art.append(window);
    } else if (style === 'peripheral') {
      const window = el('div', 'device-mini'); window.append(el('div', 'mini-toolbar', 'PERIPHERAL PEEK'));
      for (const [symbol, label, connection, amount] of [['↖', '无线鼠标', '2.4G', '76%'], ['⌨', '键盘', 'USB', '已连接'], ['♧', '蓝牙外设', 'Bluetooth', '58%']]) {
        const row = el('div', 'device-mini-row'), name = el('div', 'device-mini-name'); name.append(el('strong', '', label), el('small', '', connection));
        row.append(el('span', 'device-symbol', symbol), name, el('span', 'device-charge', amount)); window.append(row);
      }
      art.append(window, el('div', 'mini-taskbar', '↖  外设状态，一眼可见'));
    } else {
      art.append(el('span', 'work-monogram', String(index + 1).padStart(2, '0')));
    }
    if (style !== 'abstract') art.append(el('small', 'work-art-caption', '界面示意 · 非实时数据'));
    return art;
  }
  function renderProjects() {
    projectRoot.replaceChildren(); projectCards.clear();
    if (!projects.length) { projectRoot.append(el('p', 'work-empty', '新的作品，正在酝酿。')); return; }
    projects.forEach((entry, index) => {
      const data = entry.data, card = el('article', 'work-card');
      card.classList.toggle('is-highlighted', entry.id === selectedProject);
      card.style.setProperty('--work-delay', Math.min(index, 5) * 65 + 'ms');
      card.append(projectArt(data, index));
      const body = el('div', 'work-card-body'), meta = el('div', 'work-meta');
      meta.append(el('span', 'work-eyebrow', 'PROJECT / ' + String(index + 1).padStart(2, '0')));
      if (clean(data.status)) meta.append(el('span', 'work-state', clean(data.status)));
      body.append(meta, el('h3', '', clean(data.title) || '未命名项目'));
      if (clean(data.tagline)) body.append(el('p', 'work-tagline', clean(data.tagline)));
      body.append(el('p', 'work-description', clean(data.description) || '作品正在生长，故事稍后补上。'));
      const features = clean(data.highlights).split(/\n/).map(s => s.trim()).filter(Boolean);
      if (features.length) { const list = el('ul', 'work-features'); features.forEach(text => list.append(el('li', '', text))); body.append(list); }
      const tags = el('div', 'work-stack');
      for (const name of split(data.stack)) {
        const technology = technologies.find(t => key(t.data.title) === key(name));
        const tag = el(technology ? 'a' : 'span', 'work-tag', name);
        if (technology) { tag.href = '#tech'; tag.addEventListener('click', () => selectTechnology(technology.id)); }
        tags.append(tag);
      }
      if (tags.childElementCount) body.append(tags);
      const footer = el('div', 'work-card-foot'), url = link(data.url), demo = link(data.demo);
      footer.append(url ? external('查看代码 ↗', url) : el('span', 'work-unpublished', '源码暂未公开'));
      if (demo) footer.append(external('查看演示 ↗', demo));
      body.append(footer); card.append(body); projectRoot.append(card); projectCards.set(entry.id, card);
    });
  }
  function render(tech = [], work = []) {
    technologies = tech.filter(e => e?.kind === 'tech' && e.data && typeof e.data === 'object');
    projects = work.filter(e => e?.kind === 'projects' && e.data && typeof e.data === 'object');
    renderProjects(); renderTechnologies();
  }
  window.WorkShowcase = Object.freeze({ render });
})();
