# dsh-cn-menu-kit

[简体中文](./README.md) · **English**

<p align="center">
  <img src="./docs/images/popup-cn-list.png" alt="Skill list with Chinese titles" width="720" />
</p>

**Chinese enhancement for DeepSeek Harness (DSH) skills & commands** — Chinese titles for skills in the `/` menu and the `+` panel, Chinese fuzzy search, hover detail cards, and free **drag-to-reorder** for both skills and commands, so your most-used entries always sit on top.

Pure client-side plugin. Zero intrusion: no official files are modified, and uninstalling restores everything.

## ✨ Features

- **Chinese skill list**: rows show `中文标题（english-name）`, with instant Chinese filtering (type 「面试」 to find interview skills)
- **Hover detail card**: hover any row for the full description — theme-aware (light/dark) and never covers the menu
- **In-menu drag**: hovering a row reveals a ⋮⋮ handle — grab it and reorder rows right inside the menu
- **Sort panel**: two new `+` panel actions — 「技能排序」 (skills) and 「命令排序」 (commands) — mirroring the menu's Add/Commands sections
- **Persistent order**: stored locally, shared between the `+` panel and the `/` menu
- **Where do Chinese titles come from**: author your `SKILL.md` description as `中文标题——description` (see below). Skills without the prefix gracefully fall back to their English name

## 📦 Install

Requires DSH `>= 0.2.2-rc.1`.

- **DSH Market**: search `dsh-cn-menu-kit`
- **Plugins page**: Plugins → Install plugin → `dsh-cn-menu-kit`, then restart DSH
- **CLI**: `dsh plugin --profile web add dsh-cn-menu-kit`

## 🚀 Usage

| Surface | Action |
| --- | --- |
| `+` → 「技能」 | Chinese skill popup: search, hover for details, click to insert a reference |
| `+` → 「技能排序」 / 「命令排序」 | Drag-to-reorder panel (per-section, saved instantly) |
| `/` menu, 「技能（中文）」 group | The same Chinese list; picking inserts a `/english-name` reference |
| Hover a command row in the `/` menu | A ⋮⋮ handle appears on the left — drag to reorder |

Picking a skill inserts `/english-name` into the composer (blue = recognized by DSH). Send it to load the skill.

## ✍️ Authoring Chinese titles

In a skill's `SKILL.md`, start the `description` with **`中文标题——`**:

```markdown
---
name: agent-dev
description: Agent 开发方法论——构建 agent 系统的完整方法论……
---
```

The segment before `——` is shown as the title in the menus.

## 🛠 Debug

In the browser DevTools console:

```js
localStorage.setItem('dsh-cn-skill-picker:debug', '1')
```

## ⚠️ Known limitations

- Menu rows are rendered by the official React components; after official updates change the menu DOM, the drag layer may need adaptation
- The Add/Commands section assignment follows the official pinned list; dragging across sections intentionally does nothing

## 📄 License

[MIT](./LICENSE)
