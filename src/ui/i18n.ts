import type { Lang } from '../state/store'

// App-chrome strings that have no key in the game's localization files
// (game keys go through db.loc/locOr instead — see UnitPicker's categories).
const STRINGS = {
  expanded: { eng: 'Expanded', chi: '详细' },
  compact: { eng: 'Compact', chi: '默认' },
  logs: { eng: 'Logs', chi: '日志' },
  legacy: { eng: 'Legacy', chi: '旧版' },
  legacyHint: {
    eng: 'Legacy card style (hides the battlegroup timer, weapon Suppressed/CQC icons, and ammo guidance icons)',
    chi: '旧版卡片样式（隐藏归队计时、武器消音/近战图标与弹药制导图标）',
  },
  edit: { eng: 'Edit', chi: '编辑' },
  editing: { eng: 'Editing…', chi: '编辑中…' },
  portrait: { eng: 'Import...', chi: '导入图片…' },
  reset: { eng: 'Reset', chi: '重置' },
  exportPng: { eng: 'Export PNG', chi: '导出 PNG' },
  exporting: { eng: 'Exporting…', chi: '导出中…' },
  unsavedTitle: { eng: 'Unsaved edits', chi: '未保存的修改' },
  unsavedBody: {
    eng: 'Switching cards will discard your current edits.',
    chi: '切换卡片将放弃当前的修改。',
  },
  discard: { eng: 'Discard edits', chi: '放弃修改' },
  saveAndSwitch: { eng: 'Save & switch', chi: '保存并切换' },
  cancel: { eng: 'Cancel', chi: '取消' },
  save: { eng: 'Save', chi: '保存' },
  savedCards: { eng: 'Saved Cards', chi: '已保存卡片' },
  savedEmpty: {
    eng: 'Nothing saved yet — Save keeps the current card here.',
    chi: '尚未保存卡片——点击「保存」将当前卡片存到这里。',
  },
  load: { eng: 'Load', chi: '载入' },
  delete: { eng: 'Delete', chi: '删除' },
  deleteConfirm: { eng: 'Delete this saved card?', chi: '删除这张已保存的卡片？' },
  saveFailed: {
    eng: 'Save failed: browser storage is full.',
    chi: '保存失败：浏览器存储空间已满。',
  },
  exportJson: { eng: 'Export JSON', chi: '导出 JSON' },

  // Page login (one shared account)
  loginTitle: { eng: 'Log in', chi: '登录' },
  loginHint: {
    eng: 'Log in to use the online library and the China specialization page.',
    chi: '登录后才能使用在线卡库和中国专精页。',
  },
  account: { eng: 'Account', chi: '账号' },
  password: { eng: 'Password', chi: '密码' },
  loginButton: { eng: 'Log in', chi: '登录' },
  loginFailed: { eng: 'Wrong account or password.', chi: '账号或密码不对。' },
  loginBusy: { eng: 'Too many attempts. Wait a minute and try again.', chi: '尝试次数太多，请等一分钟再试。' },
  loginError: {
    eng: 'Could not reach the server. Check the connection and try again.',
    chi: '连不上服务器，请检查网络后再试。',
  },
  loginExpired: { eng: 'Your login has expired. Please log in again.', chi: '登录已过期，请重新登录。' },
  logout: { eng: 'Log out', chi: '退出登录' },

  // China specialization setup page
  chinaPage: { eng: 'China specs', chi: '中国专精' },
  chinaTitle: { eng: 'China specialization setup', chi: '中国专精设置' },
  chinaHint: {
    eng: 'Saved online and shared by everyone who logs in. Each specialization saves on its own.',
    chi: '在线保存，登录的人都能看到和修改。每个专精单独保存。',
  },
  backToCards: { eng: '← Back to cards', chi: '← 返回卡片' },
  expandAll: { eng: 'Expand all', chi: '全部展开' },
  moveLeft: { eng: 'Move left', chi: '左移' },
  moveRight: { eng: 'Move right', chi: '右移' },
  collapseAll: { eng: 'Collapse all', chi: '全部折叠' },
  refresh: { eng: 'Refresh', chi: '刷新' },
  specName: { eng: 'Name', chi: '名称' },
  specDescription: { eng: 'Description', chi: '介绍' },
  specDescriptionHint: { eng: 'What this specialization is about…', chi: '写一段专精介绍…' },
  changeIcon: { eng: 'Change icon…', chi: '更换图标…' },
  removeIcon: { eng: 'Remove icon', chi: '清除图标' },
  specUnits: { eng: 'Units', chi: '单位' },
  addUnits: { eng: '+ Add units', chi: '+ 添加单位' },
  specNoUnits: { eng: 'No units yet.', chi: '还没有分配单位。' },
  revertChanges: { eng: 'Undo changes', chi: '撤销修改' },
  specSaved: { eng: 'Saved.', chi: '已保存。' },
  specUnsaved: { eng: 'Unsaved changes', chi: '有未保存的修改' },
  specConflict: {
    eng: 'Someone else saved this specialization meanwhile. Undo your changes to see their version, then redo yours.',
    chi: '这个专精刚被别人保存过。请点“撤销修改”看最新版本，再重新修改。',
  },
  specsMissing: {
    eng: 'The server has no specialization table yet (set it up with server/install.sh).',
    chi: '服务器上还没有专精表（用 server/install.sh 安装）。',
  },
  customUnit: { eng: 'Custom', chi: '自制' },
  deletedCard: { eng: '(deleted card)', chi: '（卡片已删除）' },
  categoryOther: { eng: 'Other', chi: '其他' },
  openInEditor: { eng: 'Open in the card editor', chi: '在卡片编辑器中打开' },
  pickerGameUnits: { eng: 'Game units', chi: '游戏单位' },
  added: { eng: 'Added', chi: '已添加' },
  done: { eng: 'Done', chi: '完成' },

  // Shared online library
  cloudTitle: { eng: 'Online library', chi: '在线卡库' },
  cloudHint: {
    eng: 'Shared with everyone who logs in.',
    chi: '登录的人都能看到和修改。',
  },
  cloudAuthor: { eng: 'Your name (optional)', chi: '你的名字（可选）' },
  cloudSave: { eng: 'Upload current card', chi: '上传当前卡片' },
  cloudUpdate: { eng: 'Save changes online', chi: '保存修改到在线卡库' },
  cloudSaveAsNew: { eng: 'Save as new online card', chi: '另存为新的在线卡片' },
  cloudEditing: { eng: 'Editing online card', chi: '正在编辑在线卡片' },
  cloudRefresh: { eng: 'Refresh list', chi: '刷新列表' },
  cloudFilter: { eng: 'Filter by name or author…', chi: '按卡名或作者筛选…' },
  cloudEmpty: { eng: 'Nothing online yet.', chi: '在线卡库还是空的。' },
  cloudLoading: { eng: 'Loading…', chi: '加载中…' },
  cloudWorking: { eng: 'Working…', chi: '处理中…' },
  cloudCreated: { eng: 'Uploaded to the online library.', chi: '已上传到在线卡库。' },
  cloudUpdated: { eng: 'Online card saved.', chi: '在线卡片已保存。' },
  cloudDeleted: { eng: 'Online card deleted.', chi: '在线卡片已删除。' },
  cloudConflict: {
    eng: 'Someone saved this card after you opened it. Open it again to see their version, or save yours as a new card.',
    chi: '这张卡片在你打开后被别人保存过。请重新打开查看最新版本，或把你的版本另存为新卡片。',
  },
  cloudMissing: { eng: 'That card is no longer online.', chi: '这张卡片已经不在在线卡库里了。' },
  cloudFailed: { eng: 'Online library error', chi: '在线卡库出错' },
  cloudDeleteConfirm: {
    eng: 'Delete this online card for everyone?',
    chi: '删除这张在线卡片？所有人都将看不到它。',
  },
  importJson: { eng: 'Import JSON…', chi: '导入 JSON…' },
  importFailed: {
    eng: 'Import failed: not an exported card file.',
    chi: '导入失败：不是导出的卡片文件。',
  },
  colorTitle: { eng: 'Color', chi: '颜色' },
  colorHint: {
    eng: 'Click text or an icon to recolor it.',
    chi: '点击文字或图标以更改颜色。',
  },
  themeDefault: { eng: 'Theme default', chi: '主题默认色' },
  pickColor: { eng: 'Pick color', chi: '选择颜色' },

  // App chrome
  loadFailed: { eng: 'Failed to load data', chi: '数据加载失败' },
  loading: { eng: 'Loading unit database…', chi: '正在加载单位数据库…' },
  viewSource: { eng: 'View source on GitHub', chi: '在 GitHub 查看源代码' },
  langToggle: {
    eng: 'Language of the app and the card text (game wording; names stay as in game)',
    chi: '界面与卡片文字的语言（用游戏内译名，单位和武器名保持游戏原样）',
  },
  emptyWorkspace: { eng: 'Select a unit to build its card.', chi: '选择一个单位以生成卡片。' },

  // Unit picker / variant panel
  searchUnits: { eng: 'Search units…', chi: '搜索单位…' },
  nationFilter: { eng: 'Nation', chi: '阵营' },
  allNations: { eng: 'All', chi: '全部' },
  specFilter: { eng: 'Specialization', chi: '专精' },
  allSpecs: { eng: 'All specializations', chi: '全部专精' },
  allCategories: { eng: 'All', chi: '全部' },
  noUnits: { eng: 'No units match these filters.', chi: '没有符合筛选条件的单位。' },
  variants: { eng: 'Variants', chi: '变体' },

  // Icon picker dialog (weapons / ammo / tag icons)
  close: { eng: 'Close', chi: '关闭' },
  search: { eng: 'Search…', chi: '搜索…' },
  noMatches: { eng: 'No matches.', chi: '无匹配结果。' },
  uploadImage: { eng: 'Upload image…', chi: '上传图片…' },
  clear: { eng: 'Clear', chi: '清除' },
  selectWeapon: { eng: 'Select weapon', chi: '选择武器' },
  selectAmmo: { eng: 'Select ammo', chi: '选择弹药' },
  selectTagIcon: { eng: 'Select tag icon', chi: '选择标签图标' },

  // Card edit chrome
  remove: { eng: 'Remove', chi: '移除' },
  addWeapon: { eng: '+ Add weapon', chi: '+ 添加武器' },
  addWeaponShort: { eng: '+ Add', chi: '+ 添加' },
  addAmmo: { eng: '+ Add ammo', chi: '+ 添加弹药' },
  changeWeapon: { eng: 'Change weapon / icon', chi: '更换武器 / 图标' },
  changeAmmo: { eng: 'Change ammo / icon', chi: '更换弹药 / 图标' },
  changeTag: { eng: 'Change or clear tag icon', chi: '更换或清除标签图标' },
  addTagIcon: { eng: 'Add tag icon', chi: '添加标签图标' },

  // Crop dialog
  usePortrait: { eng: 'Use portrait', chi: '使用此立绘' },

  // Kill-log board
  emptyLog: { eng: 'Enable Edit to build a kill log.', chi: '开启「编辑」以创建击杀日志。' },
  addKill: { eng: '+ Add kill', chi: '+ 添加击杀' },
  addVictim: { eng: '+ Add victim', chi: '+ 添加受害者' },
  addVictimInline: { eng: '+ victim', chi: '+ 受害者' },
  swapSides: { eng: 'Swap sides', chi: '交换阵营' },
  swapSidesHint: {
    eng: 'Trade the two sides’ colors (killers red, victims blue)',
    chi: '交换双方的颜色（击杀方红色，被击杀方蓝色）',
  },
  removeKill: { eng: 'Remove kill', chi: '移除击杀' },
  removeVictim: { eng: 'Remove victim', chi: '移除受害者' },
  chooseUnitUpload: { eng: 'Choose unit / upload icon', chi: '选择单位 / 上传图标' },
  recolorIcon: { eng: 'Recolor icon', chi: '更改图标颜色' },

  // Log unit picker
  selectUnit: { eng: 'Select unit', chi: '选择单位' },
  chooseVariant: { eng: 'Choose variant', chi: '选择变体' },
  uploadIcon: { eng: 'Upload icon…', chi: '上传图标…' },
  clearIcon: { eng: 'Clear icon', chi: '清除图标' },
  back: { eng: '← Back', chi: '← 返回' },
  useUnit: { eng: 'Use unit', chi: '使用此单位' },
} satisfies Record<string, Record<Lang, string>>

export type UiStringKey = keyof typeof STRINGS

export function t(lang: Lang, key: UiStringKey): string {
  return STRINGS[key][lang]
}
