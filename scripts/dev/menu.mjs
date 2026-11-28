// Dev scripts' way into the main menu (Menu tidy): a button by its test id, its sub-menu opened first.
// The same table as e2e/helpers.ts `MAIN_MENU_HOME`.
const HOME = {
  'main-new': 'play',
  'main-load': 'play',
  'main-scenarios': 'play',
  'main-learn': 'play',
  'main-friends': 'multiplayer',
  'main-match': 'multiplayer',
  'main-join-code': 'multiplayer',
  'main-join': 'multiplayer',
  'main-buildings': 'create',
  'main-editor': 'create',
};

/** Click (or tap) a main-menu button, through Back and its sub-menu as needed. */
export async function clickMain(page, id, { tap = false, timeout = 120_000 } = {}) {
  const menu = page.getByTestId('main-menu');
  await menu.waitFor({ timeout });
  const want = HOME[id] ?? '';
  const press = (testid) => (tap ? page.getByTestId(testid).tap() : page.getByTestId(testid).click());
  const sub = () => menu.getAttribute('data-sub');
  const until = async (v) => {
    for (let i = 0; i < 100 && (await sub()) !== v; i++) await page.waitForTimeout(100);
  };
  const open = (await sub()) ?? '';
  if (open !== want) {
    if (open) {
      await press('main-back');
      await until('');
    }
    if (want) {
      await press(`main-${want}`);
      await until(want);
    }
  }
  await press(id);
}
